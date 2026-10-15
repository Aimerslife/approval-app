import pb from '@/pocketbase.ts'
import { PB_REQUEST_KEY } from '@/utils/pbRequestKeys'
// 规则的类型 / 默认值 / 收敛与字段映射都在 pushRules（纯函数，服务端跑批读的是同一份）
import {
  DEFAULT_PUSH_RULES,
  pushRulesFromRecord,
  pushRulesToRecord,
  type PushRules,
} from '@/utils/pushRules'

/**
 * 飞书推送规则的**落库**（「提醒设置」页面读写用的那一层）。
 *
 * ## 为什么不放在 utils/collection.ts
 * 那里是"设置类"读写的集中地（组别默认审批人、仓库清单…），推则规则本该也放那儿 ——
 * 但到达提醒（utils/notifySteps）也要读白名单，而 collection.ts **已经 import 了** notifySteps
 * （建单即发的通知），两边再互相 import 就成环。环本身在纯函数模块间通常"也能跑"，
 * 但这个仓库的约定是**不成环**（见 types/approval 里 mainOf 特意放在基础模块的说明），
 * 所以这里独立成一个只管"规则 ↔ PB"的小模块：它只依赖 pocketbase 与 utils/pushRules，
 * 谁都能引（页面 / 通知发送 / 以后的定时任务）。
 *
 * ## 口径（与仓库清单同一套，见 utils/warehouse 的文件头）
 *   · 表里**一条记录都没有** → 用 utils/pushRules 的默认规则（= 改造前的行为）；
 *   · 表里**有记录** → 以最新那条为准（页面「恢复默认」= 清空本表）；
 *   · **读失败不抛**（回落默认规则）、**写失败必抛**（否则用户以为改好了）。
 */
const PUSH_RULES_COLLECTION = 'push_rules'

/** 记录形状（字段是 snake_case）；映射见 utils/pushRules 的 pushRulesFromRecord / pushRulesToRecord */
type PushRulesRecord = Record<string, unknown> & { id: string, updated?: string }

/** "环境没准备好"的错误名：界面据此把原因原样展示（见 collection.ts 的 WAREHOUSE_SETUP_ERROR） */
export const PUSH_RULES_SETUP_ERROR = 'PushRulesSetupError'

function pushRulesWriteError (error: unknown): Error {
  if ((error as { status?: number } | null)?.status === 404) {
    const e = new Error('推送规则表还没建：请重启 PocketBase 以应用迁移 1790800000_created_push_rules')
    e.name = PUSH_RULES_SETUP_ERROR
    return e
  }
  return error instanceof Error ? error : new Error(String(error))
}

export interface PushRulesLoadResult {
  rules: PushRules
  /** true = 用的是库里的那份；false = 默认规则（界面据此显示"默认 / 已自定义"） */
  custom: boolean
}

/**
 * 读推送规则（取最新那条）。
 *
 * ⚠️ **失败不抛**、回落默认规则：集合可能还没建（迁移没跑），那种情况下页面要能正常打开，
 * 定时提醒与到达提醒也要照常按默认口径发送（默认规则 = 改造前的行为）。
 */
export async function loadPushRules (): Promise<PushRulesLoadResult> {
  try {
    const list = await pb
      .collection(PUSH_RULES_COLLECTION)
      .getList<PushRulesRecord>(1, 1, { sort: '-updated', requestKey: PB_REQUEST_KEY.pushRulesLoad })
    const rec = list.items[0]
    return rec ? { rules: pushRulesFromRecord(rec), custom: true } : { rules: DEFAULT_PUSH_RULES, custom: false }
  } catch (error) {
    console.warn('[pushRules] 读取推送规则失败（多半是还没应用迁移），先用默认规则:', error)
    return { rules: DEFAULT_PUSH_RULES, custom: false }
  }
}

/**
 * 保存推送规则（**单条 upsert**）：表里有记录就改它，没有就建一条。
 *
 * 为什么不允许多条：规则是全局的，多条记录会出现"到底哪条算数"的歧义
 * （读取侧只认最新那条，用户在页面上却可能改到旧的）。所以这里保证表里最多一条。
 * 失败**向上抛**（与读取相反）：这是"改数据"的动作，静默失败会让用户以为改好了。
 */
export async function savePushRules (rules: PushRules): Promise<void> {
  try {
    const existing = await pb
      .collection(PUSH_RULES_COLLECTION)
      .getList<PushRulesRecord>(1, 1, { sort: '-updated', requestKey: PB_REQUEST_KEY.pushRulesWrite })
    const payload = pushRulesToRecord(rules)
    const rec = existing.items[0]
    if (rec) {
      await pb.collection(PUSH_RULES_COLLECTION).update(rec.id, payload)
      return
    }
    await pb.collection(PUSH_RULES_COLLECTION).create(payload)
  } catch (error) {
    throw pushRulesWriteError(error)
  }
}

/** 恢复默认：删掉记录（之后 `loadPushRules` 会回落到 utils/pushRules 的默认规则） */
export async function resetPushRules (): Promise<void> {
  try {
    const existing = await pb.collection(PUSH_RULES_COLLECTION).getFullList<PushRulesRecord>({
      requestKey: PB_REQUEST_KEY.pushRulesReset,
    })
    for (const rec of existing) {
      await pb.collection(PUSH_RULES_COLLECTION).delete(rec.id)
    }
  } catch (error) {
    throw pushRulesWriteError(error)
  }
}
