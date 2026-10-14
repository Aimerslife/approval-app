/**
 * ⚠️ **测试期闸门**（NOTIFY-TEST-GATE）：把「到达通知」**改发**给指定的人，
 * 免得测试阶段把不相干的人卷进来（这套通知一跑就会真的发飞书消息）。
 *
 * ## 上线前必读：默认是**关**的
 *
 * 开关**不再写死在代码里**，由环境变量决定 —— 没配就是关。这一点很重要：
 * 原先是 `enabled: true` 加一个同事的 open_id 写死在源码里，直接部署到云上，
 * 会把**全公司的到达通知都改发给那一个人**（而且是静默的：别人收不到通知，
 * 没人体感"功能坏了"，只有那个人被刷屏）。
 *
 * 打开方式（**仅测试环境**，前端构建期变量）：
 *
 *   VITE_NOTIFY_TEST_OPEN_ID=ou_xxxxxxxxxxxxxxxx   # 必填：改发给谁（飞书 open_id）
 *   VITE_NOTIFY_TEST_NAME=张三                     # 选填：只用于日志
 *
 * ⚠️ 这两个变量会被**打进前端产物**（VITE_ 一律如此），所以只放**非敏感**的 open_id；
 *    **生产构建千万不要设**它们（不设 = 闸门关闭 = 按业务收件人正常发）。
 *
 * ## 口径：**改发**，不是"筛掉"
 * 测试期把每一条到达通知都改发给 `TEST_RECIPIENT`，不管这一环本来该谁办。
 * 早先写的是"只放行同名的收件人"，那等于：**只要这张单的办理人不是他，就一条都发不出去** ——
 * 现象是"通知功能好像坏了"，其实是被闸门全挡了（实测踩过：被测单据的办理人是张舒凡 / 周开胜等，
 * 一个都不是那个人）。改成改发之后，测试期能看见每一条消息，也顺带看得到"本该发给谁"。
 *
 * 为什么单独一个模块：① 零依赖（不碰 PocketBase / fetch），能被 tsx 直接跑断言；
 * ② "临时开关"最怕散落在业务代码里删不干净 —— 收在这里，配不上就整个失效，删起来一眼可见。
 */

/** 收件人（`open_id` 是发飞书消息要用的身份；姓名只用于日志） */
export interface NotifyTestRecipient {
  name: string
  open_id: string
  email?: string
}

const openId = String(import.meta.env.VITE_NOTIFY_TEST_OPEN_ID ?? '').trim()

/**
 * 测试期要改发的人：**没配 open_id 就是 null**（闸门关闭）。
 * 用"配没配"当开关，而不是再加一个布尔变量 —— 少一处能配出矛盾状态的地方。
 */
export const TEST_RECIPIENT: NotifyTestRecipient | null = openId
  ? {
    name: String(import.meta.env.VITE_NOTIFY_TEST_NAME ?? '').trim() || '测试收件人',
    open_id: openId,
    ...(String(import.meta.env.VITE_NOTIFY_TEST_EMAIL ?? '').trim()
      ? { email: String(import.meta.env.VITE_NOTIFY_TEST_EMAIL ?? '').trim() }
      : {}),
  }
  : null

export const NOTIFY_TEST_GATE = {
  /** true = 所有到达通知都**改发**给 TEST_RECIPIENT；false = 按业务收件人正常发 */
  enabled: TEST_RECIPIENT !== null,
}

/** 测试期要改发的人；闸门关着时返回 null（调用方据此走正常收件人） */
export function notifyTestRecipient (): NotifyTestRecipient | null {
  return TEST_RECIPIENT
}
