import type { Ref } from 'vue'
import type { UserBrief } from '@/api/api'
import type { ApprovalChainItem, ApprovalOrder } from '@/types/approval'
import { updateApprovalOrder } from '@/utils/collection'

/**
 * 「抄送 / 转办」的落库逻辑 —— 审批页、首页抽屉、我的抽屉共用**同一份**。
 *
 * 原先只有审批页写了这段，三个入口里另外两个没有入口可点。抄一份过去必然分叉
 * （去重口径、写哪个字段、转办怎么标 delegated_from 各写一遍迟早不一致），所以抽到这里。
 *
 * ## 写哪儿、为什么不改 chain 本身
 *
 * 两者都写进快照的 `extraMembers`（`stepId -> [成员]`）：
 *   · chain 每次由 flow + decisions **重算**，直接改数组里的成员下次重算就丢了；
 *   · 也不能写 flow —— 那是模板，会影响这张模板之后的所有审批单。
 *
 * 区别只在成员类型与标记（见 types/approval 的 mergeExtraMembers）：
 *   · 抄送 → `type: 'cc'`（ApprovalNode 的 nodeTargets 渲染 type != 'manager' 的成员）；
 *   · 转办 → `type: 'manager'` + `delegated_from`（接替该环节办理）。
 */
export interface UseApprovalSelectOptions {
  /** 当前打开的单据（要 id 与快照） */
  order: Ref<ApprovalOrder | null>
  /** 重算后的链路（`runtimeOf(order).chain`） */
  chain: Ref<ApprovalChainItem[][]>
  /** 每一环的 stepId（`runtimeOf(order).stepIds`），用来定位 extraMembers 的键 */
  stepIds: Ref<string[]>
  /** 当前待办环节在 chain 里的下标（-1 = 流程已走完） */
  currentStep: Ref<number>
  onMessage?: (text: string, color?: 'success' | 'warning' | 'error') => void
  /** 写库成功后回填最新单据（页面刷新时间线 / 行快照） */
  onUpdated?: (order: ApprovalOrder) => void
}

export function useApprovalSelect (options: UseApprovalSelectOptions) {
  const message = options.onMessage ?? (() => {})

  async function handleSelect (payload: { action: 'cc' | 'transfer', user: UserBrief }) {
    const order = options.order.value
    const snapshot = order?.chain
    if (!order?.id || !snapshot) {
      message('审批单数据未加载，请稍后重试', 'warning')
      return
    }
    const isTransfer = payload.action === 'transfer'

    // 挂到当前待办环节；流程已走完时挂到最后一步
    const chain = options.chain.value
    const idx = options.currentStep.value >= 0 ? options.currentStep.value : chain.length - 1
    const stepId = options.stepIds.value[idx]
    if (!stepId) {
      message('没有可添加抄送人的环节', 'warning')
      return
    }

    const u = payload.user
    /*
     * 转办的「从谁转来」= 当前经办人：同一环节可能已被转过几次，
     * 追加的 manager 排在后面，所以取链上**最后一位** manager 才是现在的经办人。
     */
    const managers = (chain[idx] ?? []).filter(m => m.type === 'manager')
    const fromName = managers.at(-1)?.name ?? ''
    const member: ApprovalChainItem = {
      ...(u.open_id ? { open_id: u.open_id } : {}),
      name: u.name,
      avatar: u.avatar,
      email: u.email,
      type: isTransfer ? 'manager' : 'cc',
      ...(isTransfer
        ? { delegated_from: fromName || '（未指定）', delegated_at: new Date().toISOString() }
        : {}),
    }

    const extraMembers = { ...snapshot.extraMembers }
    const existed = extraMembers[stepId] ?? []
    /*
     * 去重：**优先按 open_id 认人** —— 同名不同人按姓名比会误判成"已经在环节里"，
     * 于是加不进人（以前存进 chain 的成员没有 open_id，只能按姓名比，这次补上了）。
     */
    if (existed.some(m => (m.open_id && member.open_id
      ? m.open_id === member.open_id
      : m.name === member.name))) {
      message(isTransfer ? '该审批人已在当前环节' : '该抄送人已在列表中', 'warning')
      return
    }
    extraMembers[stepId] = [...existed, member]

    try {
      const updated = await updateApprovalOrder(order.id, {
        chain: { ...snapshot, extraMembers },
      })
      options.onUpdated?.({ ...order, ...updated })
      message(isTransfer ? `已转办给 ${u.name}` : `已添加抄送人：${u.name}`, 'success')
    } catch (error) {
      console.error(isTransfer ? '转办失败:' : '添加抄送人失败:', error)
      message(isTransfer ? '转办失败，请稍后重试' : '添加失败，请稍后重试', 'error')
    }
  }

  return { handleSelect }
}
