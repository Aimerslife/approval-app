import type { Ref } from 'vue'
import { ref } from 'vue'
import { fetchOrgTreeCache, type OrgTreeData } from '@/api/api'
import { useUserStore } from '@/stores/user'
import {
  APPROVAL_STATUS, type ApprovalFlow, type ApprovalOrder,
  branchTerminalMapOf, compactBranchTerminal, compactFlowSnapshot, flowToChain, mainOf, rebuildChain,
  renameBranchTerminalKeys, slimFlowMembers,
} from '@/types/approval'
import { toFlowContext } from '@/utils/approvalFlow'
import { flowHasRoles, resolveFlowRoles } from '@/utils/approvalRoles'
import { runtimeOf } from '@/utils/approvalRuntime'
import { resolveTypeTemplates, slimTypeTemplates } from '@/utils/approvalTypes'
import { loadApprovalTypeOverrides } from '@/utils/approvalTypeStore'
import { makeSyncKey } from '@/utils/biRowFields'
import { createApprocalModel, getApprovalFirstByFilter, getOrdersByRow, getOrdersByRows } from '@/utils/collection'
// 建单期把「数据查询」「组间轮询」展开掉：少了这步，快照里会留下没展开的节点，
// 办到那一环提交时会报「没有在建单时展开，单据数据不完整」
import { expandFlowForOrder } from '@/utils/expandFlowForOrder'
import { buildOrgDirectory, memberOpenId } from '@/utils/orgDirectory'

/**
 * 「勾选数据行 → 开启审批任务」的整套能力：任务状态、勾选闸门、模板解析、建单、执行记录。
 *
 * 为什么抽成一个 composable 而不是留在页面里：数据页（pages/workStream）与数据管理页
 * （pages/setDatas）都要这个能力，抄两遍的话"用哪张模板 / 什么时候该拦 / 失败算不算跳过"
 * 迟早两处不一致 —— 而这几点恰恰是建单的**正确性**边界（重复建单、建出谁都办不了的单）。
 * 页面只留界面（按钮、弹窗、表格列），判断与数据都在这里。
 *
 * 口径（原样搬自 pages/workStream）：
 *   · 一行数据只对应一张单：**只要已有单就锁住**（进行中 / 已通过 / 已驳回都算）；
 *   · 模板**按行**取：行里的 `团队` +「模板」= 模板名，一批里不同团队各用各的；
 *   · 建单前空跑一次引擎，拦掉"建出来就走完 / 第一个待办环节没审批人"的单。
 */

/** 表格「任务状态」列的展示信息 */
export interface TaskView {
  text: string
  color: string
  variant: 'flat' | 'tonal'
  title: string
  /**
   * 这一行**有没有单**。
   *
   * 为什么不拿 `taskOf(...) === NO_TASK` 判断：`taskByRowId` 取出来的是响应式代理，
   * 与常量 `NO_TASK` 不是同一个引用 —— 那样写会让所有行都被判成"已有单"（全表勾不上）。
   */
  hasOrder: boolean
  /** 进行中但实际办不下去（流程卡住 / 当前环节没有审批人），chip 上补个警示图标 */
  alert?: boolean
}

/** 单条处理结果 */
export interface TaskResult {
  kind: 'created' | 'skipped' | 'failed'
  /** 展示用行标识（SKU） */
  label: string
  /** 成功时是单号；跳过 / 失败时是原因 */
  detail?: string
}

/**
 * 一次「开启任务」的执行记录。
 *
 * 记在**本机**而不入库：它回答"刚才那批成了几条、哪几条失败、为什么"，属调试旁路信息；
 * 失败原因（流程展开失败、动态审批人没解析出来、PB 拒单）只在建单**当场**存在于错误对象里，
 * 事后翻 approval_chain 查不到。为此单开一张表要配迁移 / 清库 / 权限，收益不对等。
 */
export interface TaskRun {
  id: string
  /** 执行时间（ISO，显示时转本地时间） */
  at: string
  total: number
  created: number
  skipped: number
  failed: number
  /** 因为"已有单"被剔除、没进入这一批的条数 */
  locked: number
  results: TaskResult[]
  /** 超出上限没存明细的行数 */
  dropped: number
}

export interface TaskStarterOptions {
  /** 当前页表格行（需带 `id`） */
  rows: Ref<Record<string, unknown>[]>
  /**
   * `id → 未格式化的原始行`。表格行常做过千分位格式化（"1,234"），
   * 而建单要拿它求条件、算唯一键 —— 那些必须用原始值。能提供就提供，否则回落到行本身。
   */
  rawRows?: Ref<Record<string, Record<string, unknown>>>
  /** 页面自己的提示条 */
  showMsg: (text: string, color?: 'success' | 'error' | 'warning') => void
  /** localStorage 里执行记录的 key 前缀：两个页面各存各的 */
  runsKey: string
  /** 控制台日志前缀 */
  logTag: string
}

/** 没有单 = 未开启任务。共用一个常量：一页最多几百行，不要每行新建对象 */
const NO_TASK: TaskView = {
  text: '未开启任务', color: 'secondary', variant: 'tonal', title: '该行还没有审批单', hasOrder: false,
}

/** 保留最近几次：够回溯"昨天下午那批"就够了 */
const MAX_RUNS = 10
/** 单次最多存多少行明细：上百行的批次会把 localStorage 撑大，而人只看失败那几条 */
const MAX_RUN_RESULTS = 300

const RUN_KIND_LABEL: Record<TaskResult['kind'], string> = {
  created: '成功',
  skipped: '跳过',
  failed: '失败',
}

/**
 * 单次等待上限：超时判**这一行**失败，整批继续。
 *
 * 为什么必须有（线上反馈过「开启任务一直卡在处理中，谁也点不动」）：PB 的请求、模板读取、
 * 数据查询都是普通 fetch，**没有内建超时** —— 网络抖一下那个 await 就永远不返回：
 * 按钮一直 loading、starting 一直 true、后面所有行都不再处理，只能刷新页面。
 */
const TEMPLATE_TIMEOUT_MS = 20_000
const ROW_TIMEOUT_MS = 30_000
const STATUS_TIMEOUT_MS = 15_000

/** 给 promise 套倒计时；超时抛错（由调用方归到某一行） */
function withTimeout<T> (task: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${what}超时（${Math.round(ms / 1000)} 秒）`))
    }, ms)
    task.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** 错误 → 给人看的一句话 */
function errorText (error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const PB_RECORD_ID_RE = /^[a-z0-9]{15}$/

/** 这一行该用哪张审批模板：`<团队>模板` */
const TASK_TEMPLATE_WORD = '模板'

export function useTaskStarter (options: TaskStarterOptions) {
  const { rows, showMsg, runsKey, logTag } = options
  const userStore = useUserStore()

  /** 取某行的原始数据（没提供 rawRows 就用行本身） */
  function rawOf (rowId: string, fallback: Record<string, unknown>): Record<string, unknown> {
    return options.rawRows?.value[rowId] ?? fallback
  }

  /* ==================== 任务状态（表格列 + 勾选闸门） ==================== */

  /**
   * 一张单 → 表格展示。缺值 / 未知值都兜住，库里出现新状态时不会渲染成空白。
   *
   * ⚠️ 不能只看 `status`：`status = 0（进行中）` 里混着两种**永远动不了**的单 ——
   *   · 流程卡住（`end.kind === 'stuck'`）；
   *   · 当前环节**没有审批人**（模板里那一环空着，所有人的待办里都不会出现它）。
   * 这两种以前都只显示「进行中」，用户等半天以为正常流转，实际谁都办不了。
   */
  function statusView (order: ApprovalOrder): TaskView {
    // 提示里点明"不能重新开启"：勾选框是灰的，光给个单号不足以说明为什么点不动
    const title = `${order.order_no ? `单号 ${order.order_no} · ` : ''}已有单，不能重新开启任务`
    const base = { title, hasOrder: true }
    const status = order.status === undefined ? undefined : Number(order.status)

    if (status === APPROVAL_STATUS.PENDING) {
      const rt = runtimeOf(order)
      if (rt.end?.kind === 'stuck') {
        return {
          ...base, text: '进行中', color: 'deep-orange', variant: 'flat', alert: true,
          title: `${title}；流程卡住：${rt.end.reason}`,
        }
      }
      const step = rt.currentStep >= 0 ? rt.chain[rt.currentStep] : undefined
      if (!mainOf(step)) {
        return {
          ...base, text: '进行中', color: 'deep-orange', variant: 'flat', alert: true,
          title: `${title}；当前环节没有审批人，这张单谁都办不了 —— 请在模板里给该环节补上审批人`,
        }
      }
      return { ...base, text: '进行中', color: 'primary', variant: 'flat' }
    }
    if (status === APPROVAL_STATUS.APPROVED) {
      return { ...base, text: '已通过', color: 'success', variant: 'flat' }
    }
    if (status === APPROVAL_STATUS.REJECTED) {
      return { ...base, text: '已驳回', color: 'error', variant: 'flat' }
    }
    return {
      ...base,
      text: status === undefined ? '状态未知' : `状态 ${status}`,
      color: 'secondary',
      variant: 'tonal',
    }
  }

  /** 行 id → 该行当前单的展示信息（没有单的行也会写进去 = 未开启任务） */
  const taskByRowId = ref<Record<string, TaskView>>({})

  function taskOf (rowId: unknown): TaskView {
    return taskByRowId.value[String(rowId ?? '')] ?? NO_TASK
  }

  /**
   * 这一行现在还能不能开启任务：**只要已有单就锁住**（见 TaskView.hasOrder）。
   *
   * 为什么不能只拦"进行中"：已通过 / 已驳回同样是结束状态，放过去就会给同一条数据再开一张单，
   * 两张各跑各的流程 —— 业务上说不清哪张算数，审批人也可能收到两份待办。
   * ⚠️ 若以后要让"已驳回"的行能重提：这里与建单闸门 `findBlockingOrder` **必须一起改**。
   */
  function canStartTask (rowId: unknown): boolean {
    return !taskOf(rowId).hasOrder
  }

  /** 给 v-data-table 的 `item-selectable`：已有单的行连勾都勾不上（含全选 / Shift 连选） */
  function isRowSelectable (row: Record<string, unknown> | undefined): boolean {
    return canStartTask(row?.id)
  }

  /** 给 v-chip 的属性（不含 text，否则会被当成 DOM 属性写到元素上） */
  function taskChip (rowId: unknown) {
    const { color, variant, title } = taskOf(rowId)
    return { color, variant, title }
  }

  function currentOrderOf (list: ApprovalOrder[]): ApprovalOrder | undefined {
    return list.find(o => o.status === APPROVAL_STATUS.PENDING) ?? list[0]
  }

  async function loadTaskStatus (list: Record<string, unknown>[]) {
    const keys = list.map(row => ({
      id: String(row.id ?? ''),
      syncKey: makeSyncKey(rawOf(String(row.id ?? ''), row)),
    }))
    try {
      const orders = await getOrdersByRows(keys.filter(k => k.id))
      // 按行归并：relation 与 sync_key 两个口径可能命中同一张单，按单 id 去重
      const byId = new Map<string, ApprovalOrder[]>()
      const byKey = new Map<string, ApprovalOrder[]>()
      const add = (map: Map<string, ApprovalOrder[]>, key: string, order: ApprovalOrder) => {
        if (!key) {
          return
        }
        const arr = map.get(key) ?? []
        if (!arr.some(x => x.id === order.id)) {
          arr.push(order)
        }
        map.set(key, arr)
      }
      for (const o of orders) {
        add(byId, o.relation ?? '', o)
        add(byKey, o.sync_key ?? '', o)
      }
      const next: Record<string, TaskView> = {}
      for (const k of keys) {
        if (!k.id) {
          continue
        }
        const merged = [...(byId.get(k.id) ?? []), ...(byKey.get(k.syncKey) ?? [])]
          .filter((o, i, arr) => arr.findIndex(x => x.id === o.id) === i)
        const current = currentOrderOf(merged)
        next[k.id] = current ? statusView(current) : NO_TASK
      }
      taskByRowId.value = next
    } catch (error) {
      console.warn(`${logTag} 读取任务状态失败，本页按「未开启任务」显示:`, error)
      taskByRowId.value = {}
    }
  }

  /** 建单后重新拉一次，让新建的单立刻显示成「进行中」 */
  function refreshTaskStatus () {
    return loadTaskStatus(rows.value.map(row => rawOf(String(row.id ?? ''), row)))
  }

  /* ==================== 建单：模板 / 闸门 / 空跑 ==================== */

  /**
   * 这一行该用哪张审批模板：`<团队>模板`（团队 `美2组` → 模板 `美2组模板`）。
   * 一张模板对应一个团队，所以"用哪张"是**按行**算的 —— 一批里混着不同团队也各用各的。
   * 拿不到团队 → 返回 `''`，由调用方按"这一行用不了模板"报出来（不猜、也不静默换模板）。
   */
  function taskTemplateNameOf (row: Record<string, unknown>): string {
    const group = String(row['团队'] ?? '').trim()
    return group ? `${group}${TASK_TEMPLATE_WORD}` : ''
  }

  /** 行的展示标识（报错 / 汇总同口径） */
  function rowLabelOf (row: Record<string, unknown>): string {
    return String(row.SKU ?? row['库存SKU'] ?? row.id ?? '—')
  }

  /**
   * 取某张模板的建单快照（流程 + 拍平的 chain）。
   *
   * `flow` 是唯一事实源：**没配流程的模板不给建单**。找不到 / 没配置 → null，
   * 由调用方把原因归到**那一行**上（不整批中断，因为不同团队的行用不同模板）。
   */
  async function taskPayloadOf (templateName: string): Promise<NonNullable<ApprovalOrder['chain']> | null> {
    // 团队是数据里的值：用 JSON.stringify 生成带引号的字面量（顺带把引号 / 反斜杠转义好）
    const template = await getApprovalFirstByFilter(`name=${JSON.stringify(templateName)}`)
    const flow = template?.chain?.flow
    if (!flow?.length) {
      return null
    }
    /*
     * 快照只带运行期真正要用的：flow（执行）+ branchTerminal（分支出口表）+ types（审批类型）。
     * **不带模板的 `graph`**：那是编辑器的画布（坐标、连线弯曲点、卡片内小画布…），
     * 实测占整份快照的 47%，而单据这侧从不画图 —— 运行期只取"这条分支线是不是直达结束"，
     * 出口表在建单这一刻算好带走即可（口径见 types/approval 的 branchTerminalMapOf）。
     */
    const [globalTypes, templateTypes] = await Promise.all([
      loadApprovalTypeOverrides({ kind: 'global' }),
      loadApprovalTypeOverrides({ kind: 'template', templateId: template?.id ?? '' }),
    ])
    const types = slimTypeTemplates(resolveTypeTemplates([globalTypes.overrides, templateTypes.overrides]))

    return {
      chain: flowToChain(flow),
      flow,
      branchTerminal: compactBranchTerminal(branchTerminalMapOf(template?.chain)),
      decisions: [],
      types,
    }
  }

  /** 建单进行中：防止连点建出多张单 */
  const starting = ref(false)
  /** 表格勾选的行 id（服务端分页：勾选只在当前页内累积，翻页不跨页保留） */
  const selectedIds = ref<string[]>([])
  /** 批量建单的进度文案，挂在按钮上（如「处理中 3/20」） */
  const batchText = ref('')

  /**
   * 查这一行**已有的单**里，有没有挡住重新开启的那张（建单闸门，按库里的单判断）。
   *
   * 口径与 `canStartTask` 一致：**只要有单就挡**。之前这里只找 `PENDING`，
   * 于是已通过 / 已驳回的行会被重新开启，建出第二张单。
   * 读失败时**只告警、不阻断**：这是防重复的安全网，不该因一次读失败就让功能不可用。
   */
  async function findBlockingOrder (biRowId: string, syncKey: string) {
    try {
      const list = await getOrdersByRow(biRowId, syncKey)
      // 优先报"进行中"那张（对用户最要紧），否则报最新那张（getOrdersByRow 按新到旧给）
      return list.find(o => o.status === APPROVAL_STATUS.PENDING) ?? list[0]
    } catch (error) {
      console.warn(`${logTag} 查该数据已有审批单失败，继续建单:`, error)
      return undefined
    }
  }

  /** 被挡下的原因，写成给用户看的一句话（点名单号与状态） */
  function blockReasonOf (order: ApprovalOrder): string {
    const no = order.order_no ?? order.id ?? '—'
    if (order.status === APPROVAL_STATUS.PENDING) {
      return `已有进行中的单 ${no}`
    }
    if (order.status === APPROVAL_STATUS.APPROVED) {
      return `已有已通过的单 ${no}，已结束不能再开启`
    }
    if (order.status === APPROVAL_STATUS.REJECTED) {
      return `已有已驳回的单 ${no}，已结束不能再开启`
    }
    return `已有单 ${no}（状态 ${order.status}），不能再开启`
  }

  /**
   * 组织架构缓存（一次会话取一次；建单时用它解析动态审批人）。
   * undefined = 还没取过；null = 取失败（后面按"解析不出来"处理）。
   */
  let orgCache: OrgTreeData | null | undefined
  async function orgTree (): Promise<OrgTreeData | null> {
    if (orgCache !== undefined) {
      return orgCache
    }
    try {
      const res = await fetchOrgTreeCache()
      orgCache = res?.data ?? null
      if (!orgCache) {
        console.warn(`${logTag} 组织架构缓存为空，动态审批人无法解析`)
      }
    } catch (error) {
      console.warn(`${logTag} 组织架构缓存取不到，动态审批人无法解析:`, error)
      orgCache = null
    }
    return orgCache
  }

  /* ==================== 本机执行记录 ==================== */

  /** 按用户隔离：同一台电脑换人登录，不该看到别人的执行结果 */
  function runsStorageKey (): string {
    return `${runsKey}.${userStore.user?.id || 'anon'}`
  }

  const runs = ref<TaskRun[]>([])

  function readRuns (): TaskRun[] {
    try {
      const raw = localStorage.getItem(runsStorageKey())
      const list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? (list as TaskRun[]) : []
    } catch {
      // 无痕模式 / 存储被禁用 / 内容被改坏：按"没有记录"处理，不能连带影响开单
      return []
    }
  }

  function writeRuns () {
    try {
      localStorage.setItem(runsStorageKey(), JSON.stringify(runs.value))
    } catch (error) {
      // 存不下（配额满 / 存储被禁用）只影响回溯，记在内存里，刷新即丢
      console.warn(`${logTag} 执行记录写入失败:`, error)
    }
  }

  function recordRun (results: TaskResult[], locked: number) {
    if (results.length === 0 && !locked) {
      return
    }
    const countOf = (kind: TaskResult['kind']) => results.filter(r => r.kind === kind).length
    const run: TaskRun = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      at: new Date().toISOString(),
      total: results.length,
      created: countOf('created'),
      skipped: countOf('skipped'),
      failed: countOf('failed'),
      locked,
      results: results.slice(0, MAX_RUN_RESULTS),
      dropped: Math.max(0, results.length - MAX_RUN_RESULTS),
    }
    runs.value = [run, ...readRuns()].slice(0, MAX_RUNS)
    writeRuns()
  }

  /** 读一次本机记录（弹窗开合由界面自己管：见 TaskStartBar） */
  function openRuns () {
    runs.value = readRuns()
  }

  function clearRuns () {
    runs.value = []
    try {
      localStorage.removeItem(runsStorageKey())
    } catch {
      // 存储不可用：清掉内存里的即可
    }
  }

  function runKindColor (kind: TaskResult['kind']): string {
    if (kind === 'created') {
      return 'success'
    }
    if (kind === 'skipped') {
      return 'warning'
    }
    return 'error'
  }

  /** 存的 ISO → 本地时间；值坏了原样显示，别让人看到 Invalid Date */
  function runTimeText (iso: string): string {
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('zh-CN')
  }

  /* ==================== 批量开启任务 ==================== */

  /**
   * 对**一行**建单。
   *
   * `payload` 是**这张模板**的建单快照 —— 调用方按该行的团队取好（见 taskPayloadOf），
   * 所以同一批里不同团队的行用的是不同模板。
   */
  async function createTaskForRow (
    row: Record<string, unknown>,
    payload: NonNullable<ApprovalOrder['chain']>,
    seen: Set<string>,
  ): Promise<TaskResult> {
    const label = rowLabelOf(row)
    // 只认 PB 记录 id（形如 15 位 [a-z0-9]）：relation 必须是真实记录 id，否则 PB 会拒
    const biRowId = String(row.id ?? '')
    if (!PB_RECORD_ID_RE.test(biRowId)) {
      return { kind: 'failed', label, detail: '拿不到记录 id' }
    }
    const rowData = rawOf(biRowId, row)
    // 业务的兜底键，与服务端同步用的是同一个 makeSyncKey（第一段 SKU 为空时返回 ''）
    const syncKey = makeSyncKey(rowData)
    if (syncKey && seen.has(syncKey)) {
      return { kind: 'skipped', label, detail: '本批重复' }
    }
    if (syncKey) {
      seen.add(syncKey)
    }

    try {
      /*
       * 同一条数据只允许一张单：**在流程中**或**已经结束**（已通过 / 已驳回）都不再重开。
       * 页面上的勾选已被 `isRowSelectable` 挡住，这里再按库里的单判一次 ——
       * 页面那份状态是批量查出来缓存的，可能过期（或那次查询失败），不能当成唯一依据。
       */
      const blocker = await findBlockingOrder(biRowId, syncKey)
      if (blocker) {
        return { kind: 'skipped', label, detail: blockReasonOf(blocker) }
      }
      const context = toFlowContext(rowData)
      const templateFlow = payload.flow as ApprovalFlow | undefined
      let flow = templateFlow
      if (templateFlow) {
        /*
         * 建单期展开：先展开「引用模板」，再求值「数据查询」（只留命中那条分支），
         * 最后按组展开「组间轮询」。见 utils/expandFlowForOrder —— flow 是**静态快照**，
         * 运行期不再求值，漏掉这一步会留下没展开的 ref/probe/loop，办到那一环提交直接报错。
         * 引用在这一步被"拍平"进本单快照：源模板以后改了，已建的单不受影响。
         */
        const expanded = await expandFlowForOrder(templateFlow, context)
        if (expanded.issues.length > 0) {
          return { kind: 'failed', label, detail: `流程展开失败 —— ${expanded.issues.join('；')}` }
        }
        flow = expanded.flow
        /*
         * 动态审批人（角色）在**建单时**解析成真人，并写进本单的 flow 快照。
         * 必须**按行**解析：部门可能来自这一行的数据（如「组别」），批内每行都不同。
         * 也必须排在展开**之后**：轮询展开出来的那一环，成员是「该组负责人」，
         * 得让角色解析去填人（见 utils/approvalRotation）。解析不出来就判这一条失败 ——
         * 没人办的环节会让单子永远停住，当场报出来比事后追查好。
         */
        if (flowHasRoles(flow)) {
          const resolved = resolveFlowRoles(flow, await orgTree(), context)
          if (resolved.unresolved.length > 0) {
            const why = resolved.unresolved.map(u => `${u.where}：${u.reason}`).join('；')
            return { kind: 'failed', label, detail: `动态审批人没解析出来 —— ${why}` }
          }
          flow = resolved.flow
        }
      }
      /*
       * 成员瘦身 + **补 open_id**（见 types/approval 的 slimFlowMembers）：
       * 快照只留"身份 + 展示"要用的字段；老模板画布里的成员只有邮箱/姓名（那时还没存 open_id），
       * 按通讯录补上 —— 发飞书通知与查头像都优先用 open_id。
       * 必须排在**展开与角色解析之后**：角色解析会新增成员，提前做就管不到它们。
       */
      const dir = buildOrgDirectory((await orgTree())?.tree)
      const slim = flow ? slimFlowMembers(flow, m => memberOpenId(dir, m)) : undefined
      /*
       * **快照压缩**（成员瘦身后第二刀，见 types/approval 的 compactFlowSnapshot）：
       * id 短化 + 裁冗余字段，只压**写进单据的那一份**（preview 的空跑照用 slim，
       * 两者引擎行为完全一致）。branchTerminal 出口表的键是 branch id，跟着映射换 ——
       * 注意 payload 是按模板缓存的复用对象，重映射做副本、不动它本体。
       */
      const compact = compactFlowSnapshot(slim ?? [])
      const branchTerminal = renameBranchTerminalKeys(payload.branchTerminal ?? {}, compact.branchIdMap)
      /*
       * 建单前**空跑一次引擎**：专门拦"建出来就动不了的单"。
       *
       * 两种能造成这种单的情况：
       *   · 流程一建出来就已经走完（没有任何待办环节）—— status 仍是 0，没人会去改，
       *     表格里就永远写着「进行中」；
       *   · 第一个待办环节**没有审批人** —— 所有人的「待办」里都不会出现它。
       * 口径与运行期完全一致（同一个 rebuildChain + 同一份 branchTerminal + 同一份业务上下文），
       * 所以这里判"能办"的单建出来一定有人能办；宁可少一张单，也不要在库里留一张谁也推不动的单。
       */
      if (slim) {
        const preview = rebuildChain(slim, [], branchTerminalMapOf(payload), context)
        if (preview.done || preview.outcome !== 'pending' || preview.currentStep < 0) {
          return {
            kind: 'failed', label,
            detail: '这张模板在该行建单时会直接走到结束（没有任何需要审批的环节），请检查模板的流程走向',
          }
        }
        if (!mainOf(preview.chain[preview.currentStep])) {
          return {
            kind: 'failed', label,
            detail: `第一个待办环节（第 ${preview.currentStep + 1} 环）没有审批人，建单后会永远停在「进行中」`,
          }
        }
      }
      const order = await createApprocalModel(
        {
          ...payload,
          branchTerminal,
          ...(slim ? { flow: compact.flow, chain: flowToChain(compact.flow) } : {}),
          context,
        },
        { relation: biRowId, syncKey },
      ) as { id?: string, order_no?: string } | undefined
      if (!order?.id) {
        return { kind: 'failed', label, detail: '创建被拒（字段级报错见控制台）' }
      }
      return { kind: 'created', label, detail: order.order_no ?? order.id }
    } catch (error) {
      console.error(`${logTag} 建单失败:`, label, error)
      return { kind: 'failed', label, detail: errorText(error) }
    }
  }

  /**
   * 把一批结果汇总成一条提示（snackbar 装不下就举例，不逐条列）。
   *
   * @param lockedCount 因为"已有单"被剔掉的条数
   */
  function reportTaskResults (results: TaskResult[], lockedCount = 0) {
    const created = results.filter(r => r.kind === 'created')
    const skipped = results.filter(r => r.kind === 'skipped')
    const failed = results.filter(r => r.kind === 'failed')
    const head = [`共 ${results.length} 条`, `成功 ${created.length}`]
    if (skipped.length > 0) {
      head.push(`跳过 ${skipped.length}`)
    }
    if (failed.length > 0) {
      head.push(`失败 ${failed.length}`)
    }
    if (lockedCount) {
      head.push(`已有单不可重开 ${lockedCount}`)
    }
    const rest = [...skipped, ...failed]
    const detail = rest.slice(0, 3).map(r => `${r.label}：${r.detail ?? r.kind}`).join('；')
    const text = head.join('、') + (detail ? `（${detail}${rest.length > 3 ? ` 等 ${rest.length} 条` : ''}）` : '')
    // 全成功 = success；只是「跳过」= warning（没出错，但什么也没做）；有失败 = error
    showMsg(text, created.length > 0 ? 'success' : (failed.length > 0 ? 'error' : 'warning'))
  }

  async function startTasks () {
    if (starting.value) {
      return
    }
    const picked = rows.value.filter(r => selectedIds.value.includes(String(r.id ?? '')))
    if (picked.length === 0) {
      showMsg('请先勾选要开启任务的数据（表头复选框可全选当前页）', 'error')
      return
    }
    const targets = picked.filter(r => canStartTask(r.id))
    const lockedCount = picked.length - targets.length
    if (targets.length === 0) {
      showMsg(`选中的 ${picked.length} 条都已有单（在流程中或已结束），不能重新开启任务`, 'warning')
      return
    }

    starting.value = true
    const results: TaskResult[] = []
    try {
      /*
       * 模板**按行**取：模板名 = 「团队」+「模板」（见 taskTemplateNameOf），
       * 一批里不同团队各用各的模板。同名只查一次（cache 存"快照 or null"），
       * 同一团队的几十行不会重复打库。
       */
      const cache = new Map<string, NonNullable<ApprovalOrder['chain']> | null>()

      // 批内去重：同一个业务键在一次批量里只处理一次
      const seen = new Set<string>()
      for (let i = 0; i < targets.length; i++) {
        batchText.value = `处理中 ${i + 1}/${targets.length}`
        const row = targets[i]
        const label = rowLabelOf(row)
        const templateName = taskTemplateNameOf(row)
        if (!templateName) {
          // 没有团队就没法确定模板：报在这一行上，继续处理别的行
          results.push({ kind: 'failed', label, detail: '这一行没有「团队」，无法确定用哪张审批模板' })
          continue
        }
        /*
         * 取模板也套超时：读不到就**记成 null**（同一团队的后续行直接失败，不重复等一次超时），
         * 而且不再让这个 await 把整批卡死。
         */
        if (!cache.has(templateName)) {
          try {
            cache.set(
              templateName,
              await withTimeout(taskPayloadOf(templateName), TEMPLATE_TIMEOUT_MS, `读取审批模板「${templateName}」`),
            )
          } catch (error) {
            cache.set(templateName, null)
            results.push({ kind: 'failed', label, detail: `读取模板失败 —— ${errorText(error)}` })
            continue
          }
        }
        const payload = cache.get(templateName)
        if (!payload) {
          results.push({
            kind: 'failed', label,
            detail: `找不到审批模板「${templateName}」，或该模板没有配置流程`,
          })
          continue
        }
        /*
         * 单行处理同样套超时：一行出问题（网络挂住 / 某个查询不返回）只失败这一行，
         * 不会让整批停在「处理中 n/m」上再也走不动。
         */
        try {
          results.push(await withTimeout(createTaskForRow(row, payload, seen), ROW_TIMEOUT_MS, `${label} 的处理`))
        } catch (error) {
          results.push({
            kind: 'failed', label,
            detail: `${errorText(error)}；可能已在后台建单，刷新页面确认后再决定要不要重试`,
          })
        }
      }
      selectedIds.value = []
      // 建完单立刻把状态刷成「进行中」，否则用户会以为没成功（刷不动不影响建单结果，所以不抛）
      await withTimeout(refreshTaskStatus(), STATUS_TIMEOUT_MS, '刷新任务状态').catch(() => {})
      reportTaskResults(results, lockedCount)
    } catch (error) {
      console.error(`${logTag} 批量开启任务失败:`, error)
      showMsg(`开启任务失败：${errorText(error)}`, 'error')
    } finally {
      /*
       * 放 finally 而不是 try 末尾：中途抛错时 results 里是**已经处理完的那部分**，
       * 那恰恰是最需要留下来的一段（否则只能看到一条汇总 snackbar，刷新就没了）。
       */
      recordRun(results, lockedCount)
      starting.value = false
      batchText.value = ''
    }
  }

  return {
    // 任务状态
    taskByRowId, taskOf, taskChip, canStartTask, isRowSelectable, loadTaskStatus, refreshTaskStatus,
    // 勾选 / 建单
    selectedIds, starting, batchText, startTasks,
    // 执行记录
    runs, MAX_RUNS, MAX_RUN_RESULTS, RUN_KIND_LABEL, openRuns, clearRuns, runKindColor, runTimeText,
  }
}

/** 页面里拿到的实例类型（给 TaskStartBar 的 props 用） */
export type TaskStarter = ReturnType<typeof useTaskStarter>
