import type { ApprovalFlow } from '@/types/approval'
import pb from '@/pocketbase.ts'
import { collectProbes } from '@/utils/approvalProbe'
import { bindFilterParams } from '@/utils/rotationQuery'

/** 查询结果：节点 id → 是否存在记录 */
export type ProbeAnswers = Record<string, boolean>

/**
 * 「数据查询」节点的**建单期取数**（唯一打库的地方）。
 *
 * 用 `getList(1, 1)` 读 `totalItems`（服务端 COUNT）：只关心"有没有"，
 * 不把记录拉回来 —— 与 stores/pending.ts 的角标同一个做法。
 *
 * 查不出来**不猜**：直接抛错，交由建单侧判这一条失败（口径与轮转 / 角色解析一致）。
 *
 * 为什么单独一个文件：本模块 import 了 pb（用到 `import.meta.env`），在 Node 里跑不起来；
 * 纯逻辑（收集 / 展开 / 校验）下沉在 utils/approvalProbe.ts，那里能被 tsx 直接断言。
 */
export async function resolveProbes (
  flow: ApprovalFlow,
  ctx: Record<string, unknown>,
): Promise<ProbeAnswers> {
  const answers: ProbeAnswers = {}
  for (const { id, label, spec } of collectProbes(flow)) {
    const collection = (spec.collection ?? '').trim()
    const raw = (spec.filter ?? '').trim()
    let filter = ''
    if (raw) {
      try {
        // 占位符从**当前单**取值：与轮转行条件共用同一套绑定与报错
        filter = pb.filter(raw, bindFilterParams(raw, ctx))
      } catch (e) {
        throw new Error(`${label}：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    try {
      const res = await pb.collection(collection).getList(1, 1, filter ? { filter } : {})
      answers[id] = res.totalItems > 0
    } catch (e) {
      // PB 的 400 文案对配置者没有意义（通常是列名不对），把原始信息带上便于定位
      const why = e instanceof Error ? e.message : String(e)
      throw new Error(`${label}：查询失败 —— ${why}`)
    }
  }
  return answers
}
