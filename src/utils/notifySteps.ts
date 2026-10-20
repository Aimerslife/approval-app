import type { ApprovalChain, ApprovalChainItem, ApprovalFlow } from '@/types/approval'
import { sendFeishuCard } from '@/api/api'
import { collectApprovalSteps, collectNotifySteps } from '@/types/approval'
// 测试闸门（⚠️ 临时，见该文件头）：测试期把所有到达通知**改发**给指定的人
import { notifyTestRecipient } from '@/utils/notifyGate'
// 到达通知的纯逻辑（文案 / 位置计算）：不依赖 PB 客户端，能被 tsx 直接跑断言
import { arrivedFrom, buildArrivalText, previousApprovalText } from '@/utils/arrivalNotice'
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
 * @param opts.afterChain 推进后的链路（与 after 同序）：用来取「上一轮审批信息」。
 *                    不传就只是不发那一行（老调用方零影响）
 * @param opts.orderNo 单号，拼进消息正文便于对方定位
 * @param opts.context 业务上下文（建单时冻结的数据快照）：用来把文案里的 `{{字段}}` 换成真实值
 *
 * ## 谁在什么时候收到
 * 每个**新到达**的环节都发一条：
 *   · 「飞书提醒」环 → 发给它的提醒对象（文案是模板里配的那段）；
 *   · **审批环节** → 发给这一环的办理人，正文含**单号 + 上一轮审批信息**
 *     （见 utils/arrivalNotice）。
 * 两条都走同一套"认收件人 → 过白名单 → 发"的口径（见下面的 deliver）；
 * 测试期则由 NOTIFY-TEST-GATE 统一**改发**给指定的人（见 utils/notifyGate）。
 *
 * **连排的提醒环只算一次到达（本轮的核心口径）**：
 * 「飞书提醒」环是"到达即穿过"的（见 types/approval 的 pushNotify），一次推进里链路会把
 * **连着的几个提醒环**从头穿到尾 —— 模板里很常见（实测单号 1792493682581：审批办完后
 * 链路里一次多出「提醒14 / 提醒15 / 提醒3」三环，同一个人连收三条）。
 * 这三环并不是三次到达，而是**同一个事件的三个环**，所以：
 *   · **同一个人本轮只收一条提醒环消息**（见 deliver 的 `dedupe`）：第一环发给他之后，
 *     后面几环只要还是发给同一个人，就直接跳过（不静默：`console.info` 会打出来）；
 *   · 换个人**不合并** —— 提醒对象各不相同的那几条，该谁收还是谁收。
 *
 * 提醒环与审批环节的通知**不互相去重**：「提醒」和「待审批」是两件事，
 * 同一个人既被提醒又被要求办理时，两条都该收到。
 */
export async function sendArrivedNotifies (opts: {
  flow: ApprovalFlow
  before: string[]
  after: string[]
  /** 推进后的链路（与 after 同序，由 rebuildChain 产出） */
  afterChain?: ApprovalChain
  orderNo?: string
  context?: Record<string, unknown>
}): Promise<NotifySendResult> {
  const out: NotifySendResult = { sent: [], failed: [], skipped: [], messages: 0 }
  const notifySteps = collectNotifySteps(opts.flow)
  const approvalSteps = collectApprovalSteps(opts.flow)
  // 同一个环节 id 一轮只发一次（驳回重审的链路里同一个 id 可能出现多次）
  const arrived = new Set<string>()
  /*
   * 新到达的环节从第几个开始：与推进前的链路取**公共前缀**（见 utils/arrivalNotice 的 arrivedFrom）。
   * 用集合差是错的 —— 驳回回到走过的环节时，那个 id 早在 before 里，集合差看不见它。
   */
  const from = arrivedFrom(opts.before, opts.after)
  const ctx = opts.context ?? {}

  /*
   * 本轮**已经收到过提醒环消息**的人（按 `receive_id`：open_id 优先，缺了才用邮箱）。
   *
   * 一次推进里连着穿过几个提醒环时，它们属于同一个到达事件 —— 第一个人已经在第一环
   * 收到消息了，后面几环再发给他就是"只办了一次却收到好几条"（见文件头那段说明）。
   * 只记**提醒环**的收件人：审批环节的「待审批」另算，不去重。
   */
  const ringSentInRound = new Set<string>()

  /*
   * 排查用：把这一轮"推进前 / 推进后"的环节序列与真正要发的那一段打出来。
   *
   * 收到多条到达通知时先看这里：一次推进通常只多 **1** 环（跳到目标 / 到下一环）；
   * `newSteps` 有多条只可能是这几种情况 ——
   *   · 连排的几个「飞书提醒」环（提醒环到达即穿过，`newSteps` 里会连着好几环）。
   *     它们属于同一次到达：**同一个人本轮只在第一环收到一条**，后面几环跳过
   *     （见 ringSentInRound / deliver 的 dedupe，日志会打"本轮已收到过提醒"）；
   *   · 该环节有多个办理人 / 提醒对象（`deliver` 按人逐个发，`messages` 会大于 `sent.length`）；
   *   · `before` 用的是**过期的单据快照**（首页抽屉 / 列表里那份），公共前缀被提前截断，
   *     于是"已经到过的环节"又被当成新到达重发一遍。
   */
  console.info('[notifySteps] 本轮到达', {
    from,
    before: opts.before,
    after: opts.after,
    newSteps: opts.after.slice(from),
  })

  /*
   * 白名单（「提醒设置」里配的那份）只读一次：一轮里可能有好几个环节，但规则是同一份。
   * 惰性读 —— 这一轮没有任何环节要发时不该白发一个请求。读失败会回落默认规则（空白名单），不抛。
   */
  let whitelistCache: PushPerson[] | undefined
  async function whitelistOf (): Promise<PushPerson[]> {
    whitelistCache ??= (await loadPushRules()).rules.whitelist
    return whitelistCache
  }

  /**
   * 把一条消息发出去：本轮去重 → 白名单 → 测试闸门 → 逐个发送。
   *
   * 抽出来是因为**两种到达（提醒环 / 审批环节）用的口径完全一样**，
   * 各写一遍迟早漂（一处改了白名单、另一处忘了改，表现是"有的人收到有的人收不到"）。
   *
   * @param dedupe 这一条是不是「飞书提醒」环：是就套"同一个人本轮只收一条"（见文件头）。
   *               审批环节的「待审批」不套 —— 与「提醒」是两件事，同一个人两条都该收到。
   */
  async function deliver (title: string, targets: NotifyTarget[], text: string, dedupe = false) {
    /*
     * 同一个人本轮只收一条提醒环消息：连着穿过的几个提醒环是**同一次到达**，
     * 第一环发给他之后再发就是刷屏（实测单号 1792493682581 连收三条）。
     *
     * 去重按**本环原本的收件人**算，且在测试闸门**之前**：
     * 闸门会把每条消息都改发给同一个人，若按改发后的收件人去重，
     * "本该发给别人"的那几条也会被吞掉，测试期就看不出真实效果了
     * （口径见 utils/notifyGate："测试期能看见每一条消息"）。
     */
    const receivers = dedupe ? targets.filter(t => !ringSentInRound.has(t.receive_id)) : targets
    if (dedupe) {
      if (receivers.length === 0) {
        // 不静默：模板里连排了几个提醒环时，日志要能看出"为什么某某只收到一条"
        console.info(`[notifySteps] 「${title}」的提醒对象本轮已收到过提醒，这一环不再发`)
        return
      }
      for (const t of receivers) {
        ringSentInRound.add(t.receive_id)
      }
    }

    /*
     * ⚠️ 测试期（NOTIFY-TEST-GATE）：**改发**给指定的人，不管这一环本来该谁办 ——
     * 这样测试期能看见每一条消息，也看得到"本该发给谁"。闸门关掉后这一段是死代码
     * （见 utils/notifyGate，上线连同那个文件一起删）。
     *
     * ⚠️ 有意**放在漏斗最前面**：连"这一环没配人 / 收件人认不出"的情况也照发 ——
     * 测试期要看的正是"哪些环节会通知、内容长什么样"，被前置校验挡掉就看不到。
     */
    const testTo = notifyTestRecipient()
    if (testTo) {
      const original = receivers.map(t => t.member.name || t.member.email).filter(Boolean).join('、')
      const why = `「${title}」按测试闸门改发给 ${testTo.name}（原本应发给：${original || '（这一环没配人）'}）`
      out.skipped.push(why)
      console.info(`[notify-test-gate] ${why}`)
      try {
        await sendFeishuCard({
          receive_id: testTo.open_id,
          receive_id_type: 'open_id',
          msg_type: 'text',
          // 前缀标明是测试期改发的，收到的人一眼知道这条本来不是发给自己的
          content: JSON.stringify({ text: `[测试] ${text}` }),
        })
        out.sent.push(title)
        out.messages++
      } catch (error) {
        out.failed.push(
          `「${title}」测试期发给 ${testTo.name} 失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
      return
    }
    if (receivers.length === 0) {
      out.failed.push(`「${title}」没有可发送的对象（办理人 / 提醒对象缺 open_id 与邮箱，或这一环没配人）`)
      return
    }
    // 白名单与测试闸门都是按"人"匹配的，所以先取出成员，最后再用它把收件人筛回来
    const members = receivers.map(t => t.member)
    /*
     * 白名单（「提醒设置」里配的）：名单内的人**一条都不发**。
     * 放在测试闸门**之前**：白名单是用户的明确意愿（免打扰），测试闸门只是上线前的临时收口。
     * 全被白名单挡掉时要记一条 —— 否则现象是"流程走到了这一环，却谁都没收到消息"，无从查起。
     */
    const allowedByWhitelist = excludeWhitelist(members, await whitelistOf())
    if (allowedByWhitelist.length === 0) {
      const names = members.map(m => m.name || m.email).join('、')
      out.skipped.push(`「${title}」的对象都在推送白名单里（${names}），未发送`)
      return
    }
    if (allowedByWhitelist.length < members.length) {
      // 按对象本身比对（不是按 email）：没有邮箱的人同样要能对上
      const kept = new Set(allowedByWhitelist)
      const dropped = members.filter(m => !kept.has(m)).map(m => m.name || m.email).join('、')
      out.skipped.push(`「${title}」按推送白名单跳过 ${dropped}`)
    }

    // 白名单放行的人 → 各自的收件地址（open_id 优先，见 notifyTargets）
    const allowedSet = new Set(allowedByWhitelist)
    let ok = 0
    for (const t of receivers.filter(x => allowedSet.has(x.member))) {
      try {
        await sendFeishuCard({
          receive_id: t.receive_id,
          receive_id_type: t.receive_id_type,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        })
        ok++
      } catch (error) {
        out.failed.push(
          `「${title}」发给 ${t.member.name || t.receive_id} 失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    if (ok > 0) {
      out.sent.push(title)
      out.messages += ok
    }
  }

  for (let i = from; i < opts.after.length; i++) {
    const stepId = opts.after[i]
    if (arrived.has(stepId)) {
      continue
    }
    arrived.add(stepId)

    /* ① 「飞书提醒」环：文案是模板里配的那一段 */
    const info = notifySteps[stepId]
    if (info) {
      // 环节名与文案都支持 {{字段}} 插值。注意：时间线上显示的仍是**原始**环节名，
      // 这里只影响发出去的消息 —— 时间线是静态快照，不该随业务数据变。
      const title = renderNotifyText(info.name || '飞书提醒', ctx)
      const body = renderNotifyText(info.content || '', ctx)
      const text = [
        `【审批提醒】${title}`,
        opts.orderNo ? `单号：${opts.orderNo}` : '',
        body,
      ].filter(Boolean).join('\n')
      // dedupe：连排的提醒环是**同一次到达**，同一个人只在第一环收到一条（见文件头）
      await deliver(title, notifyTargets(info.members), text, true)
      continue
    }

    /* ② 审批环节：通知这一环的办理人，正文含**单号 + 上一轮审批信息** */
    const step = approvalSteps[stepId]
    if (!step) {
      continue
    }
    const text = buildArrivalText({
      title: step.name,
      orderNo: opts.orderNo,
      previous: opts.afterChain ? previousApprovalText(opts.afterChain, i) : '',
    })
    await deliver(step.name || '审批环节', notifyTargets(step.members), text)
  }
  // `messages` 是**实际发出的条数**（按人计），`sent` 是按环节计 —— 两者差得多就是"一环多人"
  console.info('[notifySteps] 发送结果', {
    sent: out.sent,
    failed: out.failed,
    skipped: out.skipped,
    messages: out.messages,
  })
  return out
}

/** 一条消息的收件人：成员本身 + 发消息要用的飞书 id */
interface NotifyTarget {
  member: ApprovalChainItem
  receive_id: string
  receive_id_type: 'open_id' | 'email'
}

/**
 * 把成员转成"真的发得出去"的收件人：**优先 open_id，缺了才退回邮箱**。
 *
 * 为什么不再要求有邮箱：飞书发消息本来就有两种 id，邮件只是其中之一。
 * 通讯录里**有些人根本没有邮箱**（实测 205 人里有 64 人），
 * 按邮箱筛等于把这些人都排除在通知之外 —— 那就是原来"必须能落到邮箱"那句口径的问题。
 * 现在 open_id 基本人人都有（组织架构缓存 205/205），所以主用 open_id；
 * 老单据的成员（那时快照里没存 open_id）才退回用邮箱。
 *
 * 两种都没有的人才发不出去，会被记进 `failed`（不静默丢掉）。
 */
function notifyTargets (members?: ApprovalChainItem[]): NotifyTarget[] {
  const out: NotifyTarget[] = []
  for (const m of members ?? []) {
    const openId = String(m.open_id ?? '').trim()
    if (openId) {
      out.push({ member: m, receive_id: openId, receive_id_type: 'open_id' })
      continue
    }
    const email = String(m.email ?? '').trim()
    if (email) {
      out.push({ member: m, receive_id: email, receive_id_type: 'email' })
    }
  }
  return out
}
