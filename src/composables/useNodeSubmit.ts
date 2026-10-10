import type {
  ApprovalAttachment,
  ApprovalFlow,
  ApprovalOrder,
  NodeDecision,
  NodeSubmitPayload,
} from '@/types/approval'
import { ref, type Ref } from 'vue'
import {
  APPROVAL_STATUS,
  buildBranchTerminalMap,
  PICK_MEMBERS_RESULT,
  PICK_TEAM_RESULT,
  rebuildChain,
} from '@/types/approval'
import { flowContextOfOrder } from '@/utils/approvalFlow'
// 「下一环还是不是同一个人办」：与页面上「连续同人环节合并成一条节点」同一口径
import { nextStepSameApprover } from '@/utils/approvalRuntime'
import { updateApprovalOrder, uploadApprovalFile } from '@/utils/collection'
// 到达提醒：这一步办完后**新到达**的「飞书提醒」环要发消息（与建单时同一套，见 utils/notifySteps）
import { sendArrivedNotifies } from '@/utils/notifySteps'

/**
 * 到达提醒：把这一步办完**新到达**的「飞书提醒」环发给它们的提醒对象。
 *
 * 与建单时同一套（`sendArrivedNotifies` 的文件头就是按"刚推进到"设计的）：
 * 拿"推进前 / 推进后"两次 chain 的 `stepIds` 差分，定位这一轮刚到达的提醒环。
 * "推进前"那份用**提交前**的 decisions 重算（此刻 decisions 里已追加了本次结论）。
 *
 * ⚠️ 故意**不 await**：库已经写完了，消息慢（飞书一跳几百毫秒）不该把用户的弹窗卡住；
 *    发失败只记日志 —— 与"发送失败绝不能回滚审批"同一口径（见 utils/notifySteps 的文件头）。
 * ⚠️ 测试期由 NOTIFY_TEST_GATE 收口（只发给指定姓名那个人）。
 */
function fireArrivedNotifies (args: {
  flow: ApprovalFlow
  /** 提交**前**的整份快照（只用它的 decisions 重算"推进前"到过哪些提醒环） */
  snapshot: ApprovalOrder['chain']
  terminalMap: ReturnType<typeof buildBranchTerminalMap>
  context: ReturnType<typeof flowContextOfOrder>
  afterStepIds: string[]
  orderNo?: string
}) {
  void sendArrivedNotifies({
    flow: args.flow,
    before: rebuildChain(args.flow, args.snapshot?.decisions ?? [], args.terminalMap, args.context).stepIds,
    after: args.afterStepIds,
    orderNo: args.orderNo,
    context: args.context,
  }).catch(error => {
    console.warn('[useNodeSubmit] 到达提醒发送异常（不影响已保存的审批）:', error)
  })
}

/**
 * 审批环节「提交办理」的**唯一实现**：
 * 上传附件 → 追加一条办理流水 → 用流水重算 chain → 定终态 status → 写库。
 *
 * 为什么要抽出来：这段逻辑原先只写在 approvalPage.vue 的 onNodeSubmit 里。
 * 首页抽屉（home.vue）的 onDrawerSubmit 没有它，只能「关掉弹窗 + 跳到审批页」，
 * 用户填的结论 / 意见 / 附件被**静默丢弃**。两边各写一份必然漂
 * （结论结构、终态判定、必填校验都可能不一致），所以只留一份。
 *
 * 为什么**不**塞进 ApprovalNode.vue：它是纯表单组件，只负责收集并 emit。
 * 把写库放进去，就得给它喂整张审批单，它还得引入路由 / 提示 / 集合调用 ——
 * 「又画界面又写库」。页面负责落库、组件负责收集，职责边界更清楚，也更好复用。
 */
export function useNodeSubmit (options: {
  /** 要办理的审批单（本函数只读它；写回由 onUpdated 交回调用方决定） */
  order: Ref<ApprovalOrder | null | undefined>
  /** 落库成功后回调（调用方据此更新自己的列表 / 详情） */
  onUpdated?: (updated: ApprovalOrder) => void
  /** 提示回调（各页面的 snackbar 不同，交回调用方展示） */
  onMessage?: (text: string, color: 'success' | 'error' | 'warning') => void
}) {
  /** 提交中：防止连点造成两条流水 */
  const submitting = ref(false)

  /**
     * 最近一次写入成功的记录。
     *
     * ⚠️ 为什么要自己记：一次提交是「读现有 decisions → 追加 → 写回」（读-改-写）。
     * 若只读 order.value，一旦调用方在 onUpdated 里**忘了回写**（onUpdated 是可选的
     * 通知机制，不是必须的动作），第二次提交就会拿着旧 decisions 覆盖上一次的结果 ——
     * 已经办过的流水凭空消失，而且不报任何错。
     * 在这里自己跟踪，调用方回不回写都不影响正确性。
     */
  let latest: ApprovalOrder | null = null

  /** 以哪份记录为准：同一条单优先用本地这份（它来自服务端响应，不会比 order.value 旧） */
  function currentRecord (): ApprovalOrder | null | undefined {
    const o = options.order.value
    return latest && o?.id === latest.id ? latest : o
  }

  /**
     * 提交一个环节的办理结果。
     *
     * @returns 落库后的最新审批单；校验失败或写入失败返回 null（此时已调用 payload.done(false)）
     *
     * 约定：无论成败都会调用 payload.done(ok) —— ApprovalNode 靠它决定
     * 关闭弹窗（true）还是保持打开便于重试（false）。
     */
  async function submitNode (payload: NodeSubmitPayload): Promise<ApprovalOrder | null> {
    // 已经在提交：保持弹窗打开，不重复写入
    if (submitting.value) {
      payload.done(false)
      return null
    }

    const order = currentRecord()
    const snapshot = order?.chain
    const flow = snapshot?.flow
    // 旧单（只有 chain 没有 flow）没有流水结构，无法按 decisions 重算 —— 与审批页同一口径
    if (!order?.id || !flow?.length) {
      options.onMessage?.('审批单数据未加载，请稍后重试', 'warning')
      payload.done(false)
      return null
    }
    // 审批意见必填：留空提交等于没留痕，后续追溯时看不出为什么这么判。
    // 判空要 trim：全是空格等于没写（ApprovalNode 提交前已 trim，这里再兜一道）
    if (!(payload.opinion ?? '').trim()) {
      options.onMessage?.('请填写审批意见', 'warning')
      payload.done(false)
      return null
    }

    // stepId 由 flow + decisions **重算**得出，不从页面注入 ——
    // 注入的话，页面手里那份 stepIds 一旦和当前 decisions 不同步，
    // 结论就会被记到别的环节上（而且看不出来）。
    const terminalMap = buildBranchTerminalMap(snapshot?.graph)
    // ⚠️ 业务上下文必须与展示侧**完全一致**：分支条件会按它选路，
    //    上下文不同 → 算出的 stepIds 不同 → 结论记到别的环节上
    const context = flowContextOfOrder(order)
    const stepId = rebuildChain(flow, snapshot?.decisions ?? [], terminalMap, context).stepIds[payload.index]
    if (!stepId) {
      options.onMessage?.('环节不存在，提交失败', 'error')
      payload.done(false)
      return null
    }

    submitting.value = true
    try {
      // 1. 上传该环节的附件（approval_chain 没有 file 字段，文件单独存 approval_files）
      const files: ApprovalAttachment[] = []
      for (const file of payload.files) {
        files.push(await uploadApprovalFile(order.id, payload.index, file))
      }

      // 2. 追加办理流水。重审 = 同一 stepId **再追加一条**，旧结论完整保留可追溯
      const decisions: NodeDecision[] = [
        ...(snapshot?.decisions ?? []),
        {
          stepId,
          result: payload.result,
          result_label: payload.result_label,
          extra: payload.extra,
          opinion: payload.opinion,
          handled_at: new Date().toISOString(),
          ...(files.length > 0 ? { files } : {}),
        },
      ]

      // 3. 用最新流水重算 chain（结论落到各环节的审批人上，供 ApprovalNode 展示）
      const rebuilt = rebuildChain(flow, decisions, terminalMap, context)

      /*
       * 3.5 「选择接收组别 / 选择接收团队」：只校验"选了没有"，**不往后续环节写人**。
       *
       * 为什么不填充下一环（早先那版写过，已按业务口径改掉）：
       * 这两条都是**终结**结论 —— 接收方是结果（谁接下这批货），不是下一环的审批人。
       * 选完之后流程即结束、后面的环节不再展开，也就没人有权限办 ——
       * 终止这件事由 rebuildChain 按 CLOSE_FLOW_RESULTS 完成（见 types/approval.ts）。
       * 选中的**组别 / 团队**记在本环节的办理流水里（decisions[].extra.members），
       * 时间线按「接收组别」或「接收团队」展示（粒度看 ReceiverTeam.pick）。
       *
       * 没选人仍然拦下来（与"审批意见必填"同一档）：这条结论就是"选了谁"，不选等于没办。
       */
      if ((payload.result === PICK_MEMBERS_RESULT || payload.result === PICK_TEAM_RESULT)
        && !hasPickedMember(payload.extra?.members)) {
        options.onMessage?.(payload.result === PICK_TEAM_RESULT ? '请选择接收团队' : '请选择接收组别', 'warning')
        payload.done(false)
        return null
      }

      // 4. 终态写进 status：还有环节待办 → 进行中；否则按终止走向判通过 / 驳回
      const status = STATUS_BY_OUTCOME[rebuilt.outcome]

      // 5. 写库（两个字段是一次请求，不会出现「chain 已推进但 status 没跟上」的中间态）
      const updated = await updateApprovalOrder(order.id, {
        chain: {
          ...snapshot, chain: rebuilt.chain, decisions,
        },
        status,
      })

      // 记下最新版本，供下一次提交的「读-改-写」使用（见 latest 的说明）
      latest = { ...order, ...updated }
      options.onUpdated?.(updated)

      /*
       * 6. 到达提醒：这一步办完**新到达**的「飞书提醒」环，发消息给它们的提醒对象。
       * 抽成独立函数（见文件下方 fireArrivedNotifies）：本函数的圈复杂度已经贴着上限，
       * 而且发送是"副作用尾巴"，独立出来后主流程一眼看得清。
       */
      fireArrivedNotifies({ flow, snapshot, terminalMap, context, afterStepIds: rebuilt.stepIds, orderNo: order.order_no })
      options.onMessage?.('审批信息已保存', 'success')
      /*
       * 回传「下一环还是不是同一个人办」：是的话弹窗**先不关** ——
       * 页面上那两个环节本来就会被合并成一条节点，父组件把新链路传回来后
       * activeStep 会落到下一环，用户在同一个窗口里接着办（见 ApprovalNode.handleConfirm）。
       */
      payload.done(true, { sameApproverNext: nextStepSameApprover(rebuilt.chain, payload.index) })
      return updated
    } catch (error) {
      console.error('[useNodeSubmit] 保存审批信息失败:', error)
      options.onMessage?.('保存失败，请稍后重试', 'error')
      payload.done(false)
      return null
    } finally {
      submitting.value = false
    }
  }

  return { submitNode, submitting }
}

/**
 * 「选择接收组别」是否真的选了人。
 * 兼容两种形状：单选时 `extra.members` 是成员对象，多选时是成员数组。
 */
function hasPickedMember (raw: unknown): boolean {
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : []
  return arr.some(item => !!item && typeof item === 'object'
    && String((item as { name?: unknown }).name ?? '').trim() !== '')
}

/** 流程终态 → 审批单状态（approval_chain.status） */
const STATUS_BY_OUTCOME = {
  pending: APPROVAL_STATUS.PENDING,
  approved: APPROVAL_STATUS.APPROVED,
  rejected: APPROVAL_STATUS.REJECTED,
} as const
