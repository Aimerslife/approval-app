import { ref, type Ref } from 'vue'
import {
    APPROVAL_STATUS,
    buildBranchTerminalMap,
    PICK_MEMBERS_RESULT,
    rebuildChain,
} from '@/types/approval'
import type {
    ApprovalAttachment,
    ApprovalChainItem,
    ApprovalOrder,
    NodeDecision,
    NodeSubmitPayload,
} from '@/types/approval'
import { updateApprovalOrder, uploadApprovalFile } from '@/utils/collection'
import { flowContextOfOrder } from '@/utils/approvalFlow'

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
export function useNodeSubmit(options: {
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
    function currentRecord(): ApprovalOrder | null | undefined {
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
    async function submitNode(payload: NodeSubmitPayload): Promise<ApprovalOrder | null> {
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
                    ...(files.length ? { files } : {}),
                },
            ]

            // 3. 用最新流水重算 chain（结论落到各环节的审批人上，供 ApprovalNode 展示）
            const rebuilt = rebuildChain(flow, decisions, terminalMap, context)

            /*
             * 3.5 「选择接收人员」：把办理人选的人**填充到下一环节**。
             *
             * 为什么写 extraMembers 而不是改 flow：flow 是**模板**，改它会波及这张模板
             * 之后新建的所有单据；extraMembers 是「本单在运行期追加的成员」——
             * 抄送 / 转办用的就是它，展示时由 mergeExtraMembers 合并回 chain，不新增数据结构。
             *
             * 没选人：**拦下来**（与"审批意见必填"同一档）—— 结论已经定了、人也该定，
             * 放过去的话下一环还是空的、单子照样卡住，却看不出是谁漏的。
             */
            const picked = payload.result === PICK_MEMBERS_RESULT ? toFilledMembers(payload.extra?.members) : []
            if (payload.result === PICK_MEMBERS_RESULT && !picked.length) {
                options.onMessage?.('请选择接收人员', 'warning')
                payload.done(false)
                return null
            }
            const nextIndex = payload.index + 1
            const nextStepId = rebuilt.stepIds[nextIndex]
            let extraMembers: Record<string, ApprovalChainItem[]> | undefined
            if (picked.length) {
                if (!nextStepId) {
                    // 后面没有环节可填（结论绑在了最后一环）：不拦提交，但要说明白，
                    // 否则用户以为人已经指派好了
                    options.onMessage?.('这一环后面没有环节，选中的人只记在了本环节的办理记录里', 'warning')
                } else {
                    // 已在这一环的人不重复加（会签名单里出现两个同名的人，看起来像两个人）
                    const exist = rebuilt.chain[nextIndex] ?? []
                    const fresh = picked.filter(m =>
                        !exist.some(x => (x.email && x.email === m.email) || (!x.email && x.name === m.name)),
                    )
                    if (fresh.length) {
                        const old = snapshot?.extraMembers?.[nextStepId] ?? []
                        extraMembers = { ...(snapshot?.extraMembers ?? {}), [nextStepId]: [...old, ...fresh] }
                    }
                }
            }

            // 4. 终态写进 status：还有环节待办 → 进行中；否则按终止走向判通过 / 驳回
            const status = STATUS_BY_OUTCOME[rebuilt.outcome]

            // 5. 写库（两个字段是一次请求，不会出现「chain 已推进但 status 没跟上」的中间态）
            const updated = await updateApprovalOrder(order.id, {
                chain: {
                    ...snapshot, chain: rebuilt.chain, decisions,
                    ...(extraMembers ? { extraMembers } : {}),
                },
                status,
            })

            // 记下最新版本，供下一次提交的「读-改-写」使用（见 latest 的说明）
            latest = { ...order, ...updated }
            options.onUpdated?.(updated)
            options.onMessage?.('审批信息已保存', 'success')
            payload.done(true)
            return updated
        } catch (err) {
            console.error('[useNodeSubmit] 保存审批信息失败:', err)
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
 * 「选择接收人员」选中的人 → 可写进单据的成员。
 * 做一次形状校验：这些是要写进 approval_chain.chain.extraMembers 的，
 * 缺 name、不是对象、同一个人重复出现，都挡在这里，脏数据不带进单据。
 */
function toFilledMembers(raw: unknown): ApprovalChainItem[] {
    if (!Array.isArray(raw)) return []
    const out: ApprovalChainItem[] = []
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue
        const m = item as Partial<ApprovalChainItem>
        const name = typeof m.name === 'string' ? m.name.trim() : ''
        if (!name) continue
        if (out.some(x => (x.email && x.email === m.email) || (!x.email && x.name === name))) continue
        out.push({
            name,
            ...(m.email ? { email: m.email } : {}),
            ...(m.avatar ? { avatar: m.avatar } : {}),
            // 接收人是要**办**这一环的人，不是抄送
            type: 'manager',
        })
    }
    return out
}

/** 流程终态 → 审批单状态（approval_chain.status） */
const STATUS_BY_OUTCOME = {
    pending: APPROVAL_STATUS.PENDING,
    approved: APPROVAL_STATUS.APPROVED,
    rejected: APPROVAL_STATUS.REJECTED,
} as const
