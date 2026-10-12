import type { ApprovalChainItem, ApprovalFlow } from '@/types/approval'
import { sendFeishuCard } from '@/api/api'
import { collectNotifySteps } from '@/types/approval'
// 测试闸门（⚠️ 临时，见该文件头）：只发给指定姓名的那一个人
import { applyNotifyTestGate, NOTIFY_TEST_GATE } from '@/utils/notifyGate'
// 纯函数单独成模块（不依赖 PB 客户端），这样它能被 tsx 直接跑断言，见该文件顶部说明
import { renderNotifyText } from '@/utils/notifyText'
// 推送规则里的白名单：名单内的人不推送 —— 与定时催办同一份规则、同一个过滤口径
import { excludeWhitelist, type PushPerson } from '@/utils/pushRules'
import { loadPushRules } from '@/utils/pushRulesStore'

/** 一轮「到达提醒」的发送结果 */
export interface NotifySendResult {
  /** 发成功的环节名 */
  sent: string[]
  /** 发不出去 / 发送失败的说明（只收集，不抛错） */
  failed: string[]
  /** 按测试闸门**故意跳过**的说明（见 NOTIFY_TEST_GATE；正式上线后应恒为空） */
  skipped: string[]
  /** 这一轮实际发出的消息条数 */
  messages: number
}

/**
 * 给「刚推进到」的飞书提醒环发通知。
 *
 * ## 为什么用 stepIds 差分定位、而不是别的方式
 * `rebuildChain` 是**纯函数且每次读取都重算**（审批页 / 首页抽屉 / 我的都会调它），
 * 所以发送这件事**只能**挂在"流程推进"这个动作上，不能在重算里做 —— 否则每读一次就轰炸一遍。
 * 于是这里拿"推进前 / 推进后"两次 chain 的 `stepIds` 做差分：
 * 出现在 after 里、又不在 before 里的提醒环，就是这一轮刚到达的。
 *
 * ## 两条刻意的口径
 *  1. **已在链上不重发**：驳回重审再次走回同一个提醒环时不会重发。
 *     靠 `before` 集合天然实现（第一次到达时就进 before 了）。
 *     这是"不骚扰"优先的选择；若业务要求"每次到达都提醒"，把这条判断去掉即可。
 *  2. **发送失败只收集、不抛**：调用方是在审批**已经写库之后**才发通知的，
 *     一条消息发不出去绝不能把审批回滚 —— 那会让用户以为没提交成功而重复提交。
 *
 * @param opts.flow   该单的流程快照（成员已由 resolveFlowRoles 解析成真人）
 * @param opts.before 推进前的 chain stepIds（用推进前的 decisions 重算）
 * @param opts.after  推进后的 chain stepIds
 * @param opts.orderNo 单号，拼进消息正文便于对方定位
 * @param opts.context 业务上下文（建单时冻结的数据快照）：用来把文案里的 `{{字段}}` 换成真实值
 */
export async function sendArrivedNotifies (opts: {
  flow: ApprovalFlow
  before: string[]
  after: string[]
  orderNo?: string
  context?: Record<string, unknown>
}): Promise<NotifySendResult> {
  const out: NotifySendResult = { sent: [], failed: [], skipped: [], messages: 0 }
  const notifySteps = collectNotifySteps(opts.flow)
  // 一个提醒环 id 只会出现一次；用它顺便去重，防止同一轮里重复进入
  const arrived = new Set<string>()
  const beforeSet = new Set(opts.before)

  /*
   * 白名单（「提醒设置」里配的那份）只读一次：一轮里可能有好几个提醒环，但规则是同一份。
   * 惰性读 —— 这一轮没有任何提醒环时不该白发一个请求。读失败会回落默认规则（空白名单），不抛。
   */
  let whitelistCache: PushPerson[] | undefined
  async function whitelistOf (): Promise<PushPerson[]> {
    whitelistCache ??= (await loadPushRules()).rules.whitelist
    return whitelistCache
  }

  for (const stepId of opts.after) {
    if (beforeSet.has(stepId) || arrived.has(stepId)) {
      continue
    }
    const info = notifySteps[stepId]
    if (!info) {
      continue
    }
    arrived.add(stepId)

    const ctx = opts.context ?? {}
    // 环节名与文案都支持 {{字段}} 插值。注意：时间线上显示的仍是**原始**环节名，
    // 这里只影响发出去的消息 —— 时间线是静态快照，不该随业务数据变。
    const title = renderNotifyText(info.name || '飞书提醒', ctx)
    // 收件人必须能落到邮箱：飞书的 receive_id_type 用 email
    const to = (info.members ?? []).filter((m): m is ApprovalChainItem & { email: string } => !!m.email)
    if (to.length === 0) {
      out.failed.push(`「${title}」没有可发送的提醒对象（提醒对象缺邮箱，或这一环没配人）`)
      continue
    }

    /*
     * 白名单（「提醒设置」里配的）：名单内的人**一条都不发**。
     * 放在测试闸门**之前**：白名单是用户的明确意愿（免打扰），测试闸门只是上线前的临时收口。
     * 全被白名单挡掉时要记一条 —— 否则现象是"流程走到了提醒环，却谁都没收到消息"，无从查起。
     */
    const allowedByWhitelist = excludeWhitelist(to, await whitelistOf())
    if (allowedByWhitelist.length === 0) {
      const names = to.map(m => m.name || m.email).join('、')
      out.skipped.push(`「${title}」的提醒对象都在推送白名单里（${names}），未发送`)
      continue
    }
    if (allowedByWhitelist.length < to.length) {
      const kept = new Set(allowedByWhitelist.map(m => m.email))
      const dropped = to.filter(m => !kept.has(m.email)).map(m => m.name || m.email).join('、')
      out.skipped.push(`「${title}」按推送白名单跳过 ${dropped}`)
    }

    /*
     * ⚠️ 测试闸门（NOTIFY-TEST-GATE）：只放行指定姓名的那一个人，其余跳过。
     * 跳过时把"本环节实际的提醒对象"打出来 —— 姓名对不上时能一眼看出该填哪个名字。
     */
    const { allowed, blocked } = applyNotifyTestGate(allowedByWhitelist)
    if (allowed.length === 0) {
      const names = allowedByWhitelist.map(m => m.name || m.email).join('、')
      const why = `「${title}」按测试闸门跳过：只发给「${NOTIFY_TEST_GATE.onlyToName}」，`
        + `而这一环的提醒对象是 ${names}`
      out.skipped.push(why)
      console.info(`[notify-test-gate] ${why}`)
      continue
    }
    if (blocked.length > 0) {
      const names = blocked.map(m => m.name || m.email).join('、')
      out.skipped.push(`「${title}」只发给 ${NOTIFY_TEST_GATE.onlyToName}，跳过了 ${names}`)
      console.info(`[notify-test-gate] 「${title}」按测试闸门跳过 ${names}`)
    }

    const body = renderNotifyText(info.content || '', ctx)
    const text = [
      `【审批提醒】${title}`,
      opts.orderNo ? `单号：${opts.orderNo}` : '',
      body,
    ].filter(Boolean).join('\n')

    let ok = 0
    for (const m of allowed) {
      try {
        await sendFeishuCard({
          receive_id: m.email,
          receive_id_type: 'email',
          msg_type: 'text',
          content: JSON.stringify({ text }),
        })
        ok++
      } catch (error) {
        out.failed.push(
          `「${title}」发给 ${m.name || m.email} 失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    if (ok > 0) {
      out.sent.push(title)
      out.messages += ok
    }
  }
  return out
}
