/**
 * ⚠️⚠️ **测试期闸门**（NOTIFY-TEST-GATE）—— 测完把 `enabled` 改回 `false`，或**直接删掉本文件**
 * 与 `utils/notifySteps.ts` 里那一处调用即可。
 *
 * 为什么单独一个模块：
 *  1. 它**零依赖**（不碰 PocketBase / fetch），所以能被 `tsx` 直接跑断言；
 *  2. "测试开关"这种东西最怕散落在业务代码里删不干净 —— 收在一个文件里，删起来一眼可见。
 *
 * 为什么需要它：这套「到达通知」一跑就会**真的给同事发飞书消息**。
 * 测试阶段只发给一个人，免得把不相干的人卷进来。
 *
 * ## 口径：**改发**，不是"筛掉"
 * 测试期把**每一条**到达通知都改发给 `TEST_RECIPIENT`，不管这一环本来该谁办。
 *
 * 早先写的是"只放行同名的收件人"，那等于：**只要这张单的办理人不是他，就一条都发不出去** ——
 * 现象是"通知功能好像坏了"，其实是被闸门全挡了（实测踩过：被测单据的办理人是张舒凡 / 周开胜等，
 * 一个都不是陈培锋）。所以改成改发：测试期能看见每一条消息，也顺带看得到"本该发给谁"。
 *
 * `open_id` 是**发飞书消息要用的身份**（姓名只用于日志）；上线时连同本文件一起删。
 */
export const TEST_RECIPIENT = {
  name: '陈培锋',
  open_id: 'ou_6b6abc721d2c7421703b78dc4db51b4d',
  email: 'chenpf@gzyanxun.com',
}

export const NOTIFY_TEST_GATE = {
  /** true = 所有到达通知都**改发**给 TEST_RECIPIENT；false = 按业务收件人正常发 */
  enabled: true,
}

/** 测试期要改发的人；闸门关着时返回 null（调用方据此走正常收件人） */
export function notifyTestRecipient (): typeof TEST_RECIPIENT | null {
  return NOTIFY_TEST_GATE.enabled ? TEST_RECIPIENT : null
}
