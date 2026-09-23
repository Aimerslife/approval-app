import type {
  ApprovalAttachment,
  ApprovalOrder,
  NodeDecision,
  NodeSubmitPayload,
} from '@/types/approval'
import { ref, type Ref } from 'vue'
import {
  APPROVAL_STATUS,
  buildBranchTerminalMap,
  PICK_MEMBERS_RESULT,
  rebuildChain,
} from '@/types/approval'
import { flowContextOfOrder } from '@/utils/approvalFlow'
import { updateApprovalOrder, uploadApprovalFile } from '@/utils/collection'
import { sendArrivedNotifies } from '@/utils/notifySteps'

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
    // 推进**前**的链路：既用来定位本次要办的环节，也用来差分出"这一轮刚到达的提醒环"
    const before = rebuildChain(flow, snapshot?.decisions ?? [], terminalMap, context)
    const stepId = before.stepIds[payload.index]
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
       * 3.5 「选择接收团队」：只校验"选了没有"，**不往后续环节写人**。
       *
       * 为什么不填充下一环（早先那版写过，已按业务口径改掉）：
       * 「选择接收团队」是**终结**结论 —— 接收方是结果（谁接下这批货），不是下一环的审批人。
       * 选完之后流程即结束、后面的环节不再展开，也就没人有权限办 ——
       * 终止这件事由 rebuildChain 按 CLOSE_FLOW_RESULTS 完成（见 types/approval.ts）。
       * 选中的人记在本环节的办理流水里（decisions[].extra.members），时间线按「接收人员」展示。
       *
       * 没选人仍然拦下来（与"审批意见必填"同一档）：这条结论就是"选了谁"，不选等于没办。
       */
      if (payload.result === PICK_MEMBERS_RESULT && !hasPickedMember(payload.extra?.members)) {
        options.onMessage?.('请选择接收团队', 'warning')
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
       * 6. 「飞书提醒」环：把这一轮**刚到达**的通知环节各发一条飞书消息。
       *
       * 必须放在写库**之后**：审批已经落库，发消息失败绝不能把审批回滚 ——
       * 回滚会让用户以为没提交成功，于是再提交一遍，反而造成重复办理。
       * 所以这里只提示失败，不 throw（见 utils/notifySteps 的口径说明）。
       */
      const notify = await sendArrivedNotifies({
        flow,
        /*
         * "推进前"必须用**重算结果**，不能图省事取空集。
         *
         * 流程开头就是提醒环的那种模板，已经在**建单那一刻**发过了
         * （见 utils/collection.ts 里 createApprocalModel 的 notifyOnCreate）；
         * 这里若取空集会把同一批环再发一遍 → 每次建单都重复通知一次。
         * 用差分则天然不会重复：已经在链上的环不进"刚到达"集合。
         */
        before: before.stepIds,
        after: rebuilt.stepIds,
        orderNo: order.order_no,
        context,
      }).catch(error => {
        console.warn('[useNodeSubmit] 发送飞书提醒时出错:', error)
        return null
      })

      if (notify?.failed.length) {
        options.onMessage?.(`审批已保存，但提醒发送失败：${notify.failed.join('；')}`, 'warning')
      } else {
        options.onMessage?.('审批信息已保存', 'success')
      }
      payload.done(true)
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
 * 「选择接收团队」是否真的选了人。
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
