import type { BiRowQuery, OrgTreeData } from '@/api/api'
import type { ApprovalFlow, ApprovalModal, NodeDecision } from '@/types/approval'
/**
 * 「流程模拟」的状态与推进逻辑（pages/sandbox 用）。
 *
 * ## 一句话
 * 沙盒就是把**生产建单期那条编译管线**再跑一遍，然后**不落库**地在这份 flow 快照上
 * 用 `rebuildChain` 走流程。所以模拟出来的走向与真实单据**同源**：
 * 引用模板、数据查询、组间轮询、动态审批人、分流条件、回退，全部走的是同一套代码。
 *
 * ## 三条硬边界（改这个文件前先看）
 *  1. 只调用**读**接口（模板 / bi_rows / 组织架构）。这里绝不出现 create/update/delete。
 *  2. **不发飞书**：提醒只走 `planArrivedNotifies` 算出"本来会发给谁"（纯函数），
 *     发送在 `sendArrivedNotifies` 里，本文件不引用它。
 *  3. **不占编号**：单号固定成「模拟单」，不调任何编号生成。
 *
 * ## 与生产的一处刻意差别
 * 真实建单会把 `slimFlowMembers` 的结果存成快照；沙盒同样瘦身（成员体积小、行为一致），
 * 但那份快照只在内存里，刷新即丢 —— 沙盒不需要、也不该留下任何持久化痕迹。
 */
import { computed, ref } from 'vue'
import { fetchBiRows, fetchOrgTreeCache } from '@/api/api'
import {
  APPROVAL_RESULTS,
  branchTerminalMapOf,
  collectStepOptionItems,
  rebuildChain,
  slimFlowMembers,
} from '@/types/approval'
import { toFlowContext } from '@/utils/approvalFlow'
import { flowHasRoles, resolveFlowRoles } from '@/utils/approvalRoles'
import { type ApprovalTypeTemplate, defaultTypeTemplateOf, resolveTypeTemplates } from '@/utils/approvalTypes'
import { loadApprovalTypeOverrides } from '@/utils/approvalTypeStore'
import { APPROVAL_BI_COMPONENT_ID } from '@/utils/biComponent'
import { getApproval } from '@/utils/collection'
import { expandFlowForOrder } from '@/utils/expandFlowForOrder'
import { type NotifyPlan, planArrivedNotifies } from '@/utils/notifySteps'
import { buildOrgDirectory, memberOpenId } from '@/utils/orgDirectory'

/**
 * bi_rows 一页几行（挑一行够用，多了只会把左栏撑长）。
 * 导出：页面要用它算"共几页"（页数 = ceil(total / 每页行数)），别再在页面里硬编码一个 8。
 */
export const SANDBOX_ROW_PAGE_SIZE = 8
/** 搜索框查哪几列（与审批任务表格的关键列一致，含 SKU 才好定位具体货品） */
const ROW_SEARCH_COLUMNS = ['SKU', '产品名称', '团队']
/** 模拟单号：固定值，既方便在消息预览里认出来，也提醒"这不是真单" */
const SIM_ORDER_NO = '模拟单'

/**
 * 一次推进的"事后说明"：沙盒最值钱的产出不是结果，而是**为什么**。
 */
export interface SandboxMemo {
  /** 提交的环节名 */
  stepName: string
  /** 提交的结论文案 */
  resultLabel: string
  /** 这一步新到达的环节（名字，顺序同链路） */
  arrived: string[]
  /** 提醒预演：本来会发几条、发给谁、文案是什么（**不发送**） */
  notify: NotifyPlan
}

export function useSandbox () {
  /* ==================== 模板 ==================== */
  const templates = ref<ApprovalModal[]>([])
  const templatesLoading = ref(false)
  const templateId = ref('')

  /* ==================== 业务数据（bi_rows，只读） ==================== */
  const rows = ref<Record<string, unknown>[]>([])
  const rowsLoading = ref(false)
  const rowTotal = ref(0)
  const rowPage = ref(1)
  const rowKeyword = ref('')
  const rowId = ref('')

  /* ==================== 运行状态（全部在内存） ==================== */
  /** 展开后的 flow 快照：与真实单据里存的那份同源（见文件头） */
  const flow = ref<ApprovalFlow>()
  /** 业务上下文：`toFlowContext(行)` 的结果，分支条件是按它求值的 */
  const context = ref<Record<string, unknown>>({})
  /** 模拟出来的办理流水：每提交一次追加一条 */
  const decisions = ref<NodeDecision[]>([])
  /** 展开 / 解析失败的原因（不静默：沙盒的价值一半在暴露模板问题） */
  const issues = ref<string[]>([])
  const building = ref(false)
  /** 最近一次推进的说明 */
  const lastMemo = ref<SandboxMemo>()

  const template = computed(() => templates.value.find(t => t.id === templateId.value))

  /* ==================== 审批类型（选中结论后要填什么） ==================== */

  /**
   * code → 该模板下**最终生效**的类型模板（内置默认 → 全局覆盖 → 模板级覆盖）。
   *
   * 为什么在选模板时解析一次、而不是每渲染一次现查：
   * 与 utils/approvalTypes 文件头第 2 条边界同一时机 —— 真实单据也是建单期定下来再随单走。
   * 沙盒把同一份解析结果留在内存里，于是"这一环能填什么"与真单看到的是同一份口径。
   */
  const typeTemplates = ref<Record<string, ApprovalTypeTemplate>>({})
  /** 这张模板上是否有自定义覆盖（只用于界面标记「已自定义 / 默认」） */
  const typeCustom = ref(false)
  const typesLoading = ref(false)

  /**
   * 读两层覆盖并合成。
   *
   * `loadApprovalTypeOverrides` **失败不抛**（集合没建 / 读不到 → 该层按"没有覆盖"），
   * 所以这里不需要 try：最差的结果就是全部落回内置默认（= 改造前的行为）。
   */
  async function loadTypes (id: string) {
    typesLoading.value = true
    try {
      const globalRow = await loadApprovalTypeOverrides({ kind: 'global' })
      const row = id
        ? await loadApprovalTypeOverrides({ kind: 'template', templateId: id })
        : { overrides: {}, custom: false }
      const list = resolveTypeTemplates([globalRow.overrides, row.overrides])
      typeTemplates.value = Object.fromEntries(list.map(t => [t.code, t]))
      typeCustom.value = row.custom
    } finally {
      typesLoading.value = false
    }
  }

  /** 某个结论码生效的类型模板（认不出的码回落成空壳，调用方永远拿得到对象） */
  function typeTemplateOf (code: string): ApprovalTypeTemplate {
    return typeTemplates.value[code] ?? defaultTypeTemplateOf(code)
  }

  /**
   * 分支出口表：从**模板画布**算（与建单期同一口径，见 types/approval 的 branchTerminalMapOf）。
   * 没有它，「命中这条分支是不是整单结束」就判不出来，时间线会少一个出口。
   */
  const terminalMap = computed(() => {
    const graph = template.value?.chain?.graph
    return branchTerminalMapOf(graph ? { graph } : null)
  })

  /**
   * 链路重算（纯函数，见 types/approval 的 rebuildChain）。
   *
   * 用 `runtimeState` 包一层 try/catch 而不是直接 computed + throw：
   * 沙盒要能**把报错显示出来**（模板有问题时正是要看这个），而不是把页面搞白。
   */
  const runtimeState = computed(() => {
    if (!flow.value) {
      return {} as {
        data?: ReturnType<typeof rebuildChain>
        error?: string
      }
    }
    try {
      return {
        data: rebuildChain(flow.value, decisions.value, terminalMap.value, context.value),
      }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  const runtime = computed(() => runtimeState.value.data)
  const runtimeError = computed(() => runtimeState.value.error ?? '')

  /** 当前待办环节 id（流程已结束时为空） */
  const currentStepId = computed(() => {
    const r = runtime.value
    if (!r || r.done || r.currentStep < 0) {
      return ''
    }
    return r.stepIds[r.currentStep] ?? ''
  })

  /** 当前待办这一环的成员（空 = 没有待办） */
  const currentMembers = computed(() => {
    const r = runtime.value
    if (!r || !currentStepId.value) {
      return []
    }
    return r.chain[r.currentStep] ?? []
  })

  /**
   * 当前环节"能选哪些结论"：**由模板上它的出线决定**（见 collectStepOptionItems）。
   * 模板一条结果线都没配时退回结论目录 —— 否则沙盒会卡在"没有可选项"，
   * 而那种模板在真实单据里同样办不了（这里至少能让人把流程走完看走向）。
   */
  const currentOptions = computed(() => {
    const f = flow.value
    const stepId = currentStepId.value
    if (!f || !stepId) {
      return []
    }
    const list = collectStepOptionItems(f)[stepId] ?? []
    return list.length > 0
      ? list
      : APPROVAL_RESULTS.map(r => ({ text: r.label, result: r.value }))
  })

  /* ==================== 读取（只读） ==================== */

  async function loadTemplates () {
    templatesLoading.value = true
    try {
      templates.value = await getApproval()
    } finally {
      templatesLoading.value = false
    }
  }

  async function loadRows (page = 1) {
    rowsLoading.value = true
    try {
      const keyword = rowKeyword.value.trim()
      const query: BiRowQuery = {
        componentId: APPROVAL_BI_COMPONENT_ID,
        page,
        perPage: SANDBOX_ROW_PAGE_SIZE,
        ...(keyword
          ? { search: { columns: ROW_SEARCH_COLUMNS, value: keyword } }
          : {}),
      }
      const res = await fetchBiRows(query)
      rows.value = res.rows
      rowTotal.value = res.totalItems
      rowPage.value = page
    } finally {
      rowsLoading.value = false
    }
  }

  /** 组织架构只拉一次（同一页面里模板、行切换都会用到） */
  let orgCache: OrgTreeData | null | undefined
  async function orgTree (): Promise<OrgTreeData | null> {
    if (orgCache !== undefined) {
      return orgCache
    }
    try {
      orgCache = (await fetchOrgTreeCache()).data ?? null
    } catch (error) {
      console.warn('[sandbox] 组织架构读取失败（动态审批人会解析不出来）:', error)
      orgCache = null
    }
    return orgCache
  }

  /* ==================== 构建快照 ==================== */

  /**
   * 用「模板 + 业务数据」重建一份可模拟的 flow。
   *
   * 顺序与生产**完全一致**（见 pages/workStream 的建单流程）：
   *   ① 引用模板 → ② 数据查询 → ③ 组间轮询（= expandFlowForOrder）
   *   → ④ 动态审批人解析成真人（resolveFlowRoles）
   *   → ⑤ 成员瘦身 + 补 open_id（slimFlowMembers）
   * 顺序反了就会漏展开（轮询展开出来的环节成员是"该组负责人"，得让 ④ 去填人）。
   */
  async function buildPlan () {
    const tpl = template.value
    issues.value = []
    flow.value = undefined
    decisions.value = []
    lastMemo.value = undefined

    if (!tpl) {
      issues.value = ['先选一张审批模板']
      return
    }
    const templateFlow = tpl.chain?.flow
    if (!templateFlow?.length) {
      issues.value = ['这张模板还没有流程（先去设计器里保存一次）']
      return
    }

    building.value = true
    try {
      const expanded = await expandFlowForOrder(templateFlow, context.value)
      if (expanded.issues.length > 0) {
        issues.value = expanded.issues
        return
      }
      let next = expanded.flow

      if (flowHasRoles(next)) {
        const resolved = resolveFlowRoles(next, await orgTree(), context.value)
        if (resolved.unresolved.length > 0) {
          // 解析不出人 = 真实建单也会失败，沙盒直接把原因摊开（正是要暴露的问题）
          issues.value = resolved.unresolved.map(u => `${u.where}：${u.reason}`)
          return
        }
        next = resolved.flow
      }

      const dir = buildOrgDirectory((await orgTree())?.tree)
      flow.value = slimFlowMembers(next, m => memberOpenId(dir, m))
    } catch (error) {
      issues.value = [error instanceof Error ? error.message : String(error)]
    } finally {
      building.value = false
    }
  }

  /* ==================== 选择 / 推进 ==================== */

  async function selectTemplate (id: string) {
    templateId.value = id
    /*
     * 先读审批类型再建快照：两者的**结果**互不依赖（类型管"选中后填什么"、快照管"往哪走"），
     * 但界面上是同一个动作触发的，先拿类型能让"选完结论立刻有表单"，不必等链路重算。
     */
    await loadTypes(id)
    await buildPlan()
  }

  /** 挑一行业务数据：上下文换了，分支走向会跟着变，所以立刻重建快照 */
  async function pickRow (row: Record<string, unknown>) {
    rowId.value = String(row.id ?? '')
    context.value = toFlowContext(row)
    await buildPlan()
  }

  /** 业务上下文里值得看的字段（挑几个关键列展示，不是全部） */
  const contextChips = computed(() => {
    const entries = Object.entries(context.value)
    const picked = ['SKU', '产品名称', '团队', '部门', '总库存数量', '总库存金额', '是否属于灯具']
      .map(key => [key, context.value[key]] as const)
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
    // 上面一个都没命中（比如换了数据源）时退回前 6 个字段，避免"上下文一片空白"
    if (picked.length === 0) {
      return entries.slice(0, 6).map(([k, v]) => [k, v] as const)
    }
    return picked
  })

  /**
   * 推进一环。
   *
   * 注意这里**没有写库、没有发通知**：
   *   · 结论只追加进内存里的 decisions；
   *   · 用最新 decisions 重算一次 chain（与真实提交时的第 3 步同一个调用）；
   *   · 提醒只是算出计划（planArrivedNotifies），摆给人看。
   */
  function submit (payload: {
    result: string
    resultLabel: string
    extra?: Record<string, unknown>
    opinion?: string
  }): { ok: boolean, message: string } {
    const f = flow.value
    const r = runtime.value
    if (!f || !r) {
      return { ok: false, message: '还没有可模拟的流程' }
    }
    if (r.done) {
      return { ok: false, message: '流程已经结束了' }
    }
    const stepId = r.stepIds[r.currentStep]
    if (!stepId) {
      return { ok: false, message: '当前环节没算出来（流程可能已结束）' }
    }

    const before = r.stepIds
    const stepName = r.chain[r.currentStep]?.[0]?.name || stepId
    const next: NodeDecision[] = [
      ...decisions.value,
      {
        stepId,
        result: payload.result,
        result_label: payload.resultLabel,
        ...(payload.extra && Object.keys(payload.extra).length > 0 ? { extra: payload.extra } : {}),
        ...(payload.opinion?.trim() ? { opinion: payload.opinion.trim() } : {}),
        handled_at: new Date().toISOString(),
      },
    ]
    decisions.value = next

    const after = rebuildChain(f, next, terminalMap.value, context.value)
    const notify = planArrivedNotifies({
      flow: f,
      before,
      after: after.stepIds,
      afterChain: after.chain,
      orderNo: SIM_ORDER_NO,
      context: context.value,
    })
    const arrived = after.stepIds
      .slice(notify.from)
      .map((id, k) => after.chain[notify.from + k]?.[0]?.name || id)
    lastMemo.value = {
      stepName,
      resultLabel: payload.resultLabel,
      arrived,
      notify,
    }
    return { ok: true, message: `已模拟「${stepName}」→ ${payload.resultLabel}` }
  }

  /** 撤回上一步（回到推进前，重算链路） */
  function undo () {
    if (decisions.value.length === 0) {
      return false
    }
    decisions.value = decisions.value.slice(0, -1)
    lastMemo.value = undefined
    return true
  }

  /** 从头再来（保留模板与业务数据，只清流水） */
  function resetRun () {
    decisions.value = []
    lastMemo.value = undefined
  }

  return {
    // 模板
    templates,
    templatesLoading,
    templateId,
    template,
    loadTemplates,
    selectTemplate,
    // 审批类型（选中结论后要填什么）
    typeTemplates,
    typeCustom,
    typesLoading,
    typeTemplateOf,
    // 业务数据
    rows,
    rowsLoading,
    rowTotal,
    rowPage,
    rowKeyword,
    rowId,
    loadRows,
    pickRow,
    // 运行
    flow,
    context,
    contextChips,
    decisions,
    issues,
    building,
    runtime,
    runtimeError,
    currentStepId,
    currentMembers,
    currentOptions,
    lastMemo,
    buildPlan,
    submit,
    undo,
    resetRun,
  }
}
