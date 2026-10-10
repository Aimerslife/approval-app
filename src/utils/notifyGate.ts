/**
 * ⚠️⚠️ **测试期闸门**（NOTIFY-TEST-GATE）—— 测完把 `enabled` 改回 `false`，或**直接删掉本文件**
 * 与 `utils/notifySteps.ts` 里那两行闸门调用即可。
 *
 * 为什么单独一个模块：
 *  1. 它**零依赖**（不碰 PocketBase / fetch），所以能被 `tsx` 直接跑断言；
 *  2. "测试开关"这种东西最怕散落在业务代码里删不干净 —— 收在一个文件里，删起来一眼可见。
 *
 * 为什么需要它：这套「到达提醒」一跑就会**真的给同事发飞书消息**。
 * 测试阶段只放行一个人，免得把不相干的人卷进来。
 *
 * 口径：
 *  · 只作用于**「飞书提醒」环节**（`notifySteps.ts` 只处理这类环节；别的环节本来就不发消息）；
 *  · 匹配是**姓名去空白后的精确匹配** —— 飞书昵称带部门 / 后缀会对不上，
 *    所以跳过时业务侧会把"这一环实际的提醒对象名字"打到控制台，照抄那个名字填进来即可。
 */

/** 提醒对象的**最小形状**：只需要姓名（这里刻意不收 email，免得与业务类型耦合） */
export interface GateCandidate {
  name?: string
  email?: string
}

export const NOTIFY_TEST_GATE = {
  /** true = 只发给 `onlyToName` 那一个人；false = 正常发给所有提醒对象 */
  enabled: true,
  /** 只发给他（姓名，去空白后精确匹配） */
  onlyToName: '陈培锋',
}

/** 姓名比较：去空白（人工录入的名字里常带多余空格） */
function sameName (a: unknown, b: unknown): boolean {
  return String(a ?? '').replace(/\s+/g, '') === String(b ?? '').replace(/\s+/g, '')
}

/**
 * 按闸门筛出**真正要发的人**。
 *
 * @returns allowed = 放行的人；blocked = 被跳过的人（调用方据此在控制台留痕）
 *
 * 闸门关掉时 `blocked` 恒为空 —— 调用方不需要自己判 `enabled`。
 */
export function applyNotifyTestGate<T extends GateCandidate> (
  recipients: readonly T[],
): { allowed: T[], blocked: T[] } {
  if (!NOTIFY_TEST_GATE.enabled) {
    return { allowed: [...recipients], blocked: [] }
  }
  const allowed: T[] = []
  const blocked: T[] = []
  for (const m of recipients) {
    if (sameName(m.name, NOTIFY_TEST_GATE.onlyToName)) {
      allowed.push(m)
    } else {
      blocked.push(m)
    }
  }
  return { allowed, blocked }
}
