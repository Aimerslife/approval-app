<template>
  <v-container class="bg-app h-[calc(100vh-32px)]" fluid>
    <v-sheet class="overflow-hidden mt-3 p-4 card-border" rounded="15">
      <!-- 标题行：与 home / mine 同款（block-title + 右侧计数与刷新） -->
      <div class="d-flex align-center justify-space-between">
        <div class="block-title">独立审批</div>

        <div class="d-flex align-center">
          <span class="text-[12px] text-medium-emphasis mr-2">共 {{ filteredRows.length }} 条</span>

          <v-icon-btn size="x-small" title="刷新列表" variant="text" @click="load">
            <v-icon size="16">mdi-refresh</v-icon>
          </v-icon-btn>
        </div>
      </div>

      <div class="text-[12px] text-medium-emphasis mt-1">
        分配给你的独立审批任务在这里逐条办理。提交结论后直接回写到对应的主审批单（办理流水追加进主单的
        decisions），主流程的走向与状态不受影响。管理员以上权限可以看到所有独立审批环。
      </div>

      <!-- 状态筛选：待我办理（默认）/ 已审批（只摆办完的环）/ 全部（管理员看所有人的环） -->
      <v-tabs v-model="filter" class="mt-2" color="primary" density="compact">
        <v-tab value="todo">待我办理</v-tab>
        <v-tab value="done">已审批</v-tab>
        <v-tab value="all">全部</v-tab>
      </v-tabs>

      <v-divider />

      <v-data-table
        v-model:page="page"
        border
        class="text-[12px]"
        density="compact"
        fixed-footer
        fixed-header
        :headers="headers"
        hover
        :items="filteredRows"
        :items-per-page="perPage"
        :loading="loading"
        no-data-text="当前筛选下没有独立审批任务"
        :page-count="pageCount"
        striped="odd"
      >
        <!-- 单号列：单号 + 建单时间 -->
        <template #item.orderNo="{ item }">
          <div class="font-bold">{{ item.orderNo }}</div>
          <div class="text-[11px] text-medium-emphasis">{{ item.createdText }}</div>
        </template>

        <!-- 独立审批列：卡片名；子流程模式附当前环名 -->
        <template #item.title="{ item }">
          <div>{{ item.title }}</div>
          <div v-if="item.stepLabel" class="text-[11px] text-medium-emphasis">{{ item.stepLabel }}</div>
        </template>

        <!--
         * 审批结论列：只摆**最后一环**的结论摘要（环名 + 逐人紧凑一行，不含意见），
         * 完整历史（全部环节 + 意见）点一下弹详情看 —— 行高稳定，不被多环结论撑爆。
        -->
        <template #item.history="{ item }">
          <div
            v-if="item.history.length"
            class="sj-conclusion"
            role="button"
            tabindex="0"
            title="点击查看全部结论"
            @click="openHistory(item)"
            @keydown.enter="openHistory(item)"
          >
            <div class="text-[11px] font-weight-medium text-medium-emphasis mb-0.5">{{ lastGroupOf(item).step }}</div>

            <div class="sj-conclusion-main">
              <template v-for="(e, i) in lastGroupOf(item).entries" :key="`${e.name}-${i}`">
                <span v-if="i > 0" class="text-medium-emphasis">、</span>
                <span class="d-inline-flex align-center ga-1">
                  <span class="result-dot" :style="{ background: `rgb(var(--v-theme-${radioColorOf(e.result)}))` }" />
                  <span>{{ e.name }} <span class="font-weight-medium">{{ e.label }}</span></span>
                </span>
              </template>
            </div>

            <div class="sj-conclusion-hint text-[11px]">
              <v-icon size="12">mdi-eye-outline</v-icon>
              <span>全部结论</span>
            </div>
          </div>
          <span v-else class="text-[11px] text-medium-emphasis">{{ item.prevEmptyText }}</span>
        </template>

        <template #item.progress="{ item }">
          <span class="text-medium-emphasis">已提交 {{ item.progress }}</span>
        </template>

        <!-- 状态：chip（管理员看所有环时同样成立）+ 我提交过的结论小字 -->
        <template #item.statusChip="{ item }">
          <v-chip :color="item.statusColor" label size="x-small">
            {{ item.statusText }}
          </v-chip>

          <div v-if="item.myResultText" class="text-[11px] text-medium-emphasis mt-1">{{ item.myResultText }}</div>
        </template>

        <template #item.action="{ item }">
          <v-btn v-if="item.canHandle" color="primary" variant="text" @click="openDialog(item)">
            <span class="text-[13px]">填写结论</span>
          </v-btn>

          <!-- 超管代批：不是成员（或已提交过）但环里还有人没交，可以代他们提交整环结论 -->
          <v-btn v-else-if="item.canOverride" color="orange" variant="text" @click="openDialog(item)">
            <span class="text-[13px]">代批</span>
          </v-btn>

          <span v-else class="text-[11px] text-medium-emphasis">—</span>
        </template>

        <!-- 页脚只留一条紧凑分页（与 mine 表格同款） -->
        <template #bottom>
          <div class="d-flex justify-center">
            <v-pagination v-model="page" :length="pageCount" size="small" :total-visible="7" />
          </div>
        </template>
      </v-data-table>
    </v-sheet>

    <!--
     * 办理弹窗：与全站办理弹窗同一形态 ——
     *   · 标题条 = HandleDock dialog 同款（图标 + 标题 + tonal chip + 分隔线）；
     *   · 表单栅格 = ApprovalHandleForm 同款（88px label 列、outlined compact 输入、结论语义色）。
     * 只动视觉，提交逻辑（submit → useIndependentSubmit）完全不变。
     -->
    <v-dialog v-model="dialog" max-width="440">
      <v-card v-if="activeRow">
        <v-card-title class="d-flex align-center ga-2 text-[15px] py-3">
          <v-icon color="primary" size="18">mdi-check-decagram</v-icon>
          <span>独立审批办理</span>

          <v-chip color="primary" label size="x-small" variant="tonal">
            {{ activeRow.stepLabel || activeRow.title }}
          </v-chip>
        </v-card-title>

        <v-divider />

        <div class="px-4 py-3 text-[13px]">
          <!-- 责任划分：本单原因对应的各部门承担比率（开始审批即显示在开头；查不到规则/还没选原因时整块隐藏） -->
          <div v-if="activeResp" class="resp-block mb-3">
            <div class="text-[12px] text-medium-emphasis mb-1">责任划分（{{ activeResp.reason }}）</div>

            <div class="d-flex flex-wrap ga-1">
              <v-chip
                v-for="(ratio, dept) in activeResp.ratios"
                :key="dept"
                color="primary"
                label
                size="x-small"
                variant="tonal"
              >
                {{ dept }} {{ formatRatio(ratio) }}
              </v-chip>
            </div>
          </div>
          <!-- 已提交结论：引用块，渲染全部环节（环名分组 + 结论色点）；无结论时给占位说明 -->
          <div v-if="activeRow.history.length" class="prev-block mb-3">
            <div class="text-[12px] text-medium-emphasis mb-1">已提交的审批结论</div>

            <div v-for="g in activeRow.history" :key="g.step" class="mb-2 last:mb-0">
              <div class="text-[12px] font-weight-medium mb-1">{{ g.step }}</div>

              <div class="sj-group-rows d-flex flex-column ga-1">
                <div
                  v-for="(e, i) in g.entries"
                  :key="`${e.name}-${i}`"
                  class="d-flex align-center ga-2"
                >
                  <span class="result-dot" :style="{ background: `rgb(var(--v-theme-${radioColorOf(e.result)}))` }" />
                  <span>
                    {{ e.name }}：<span class="font-weight-medium">{{ e.label }}</span>
                    <template v-if="e.opinion"><span class="text-medium-emphasis">（{{ e.opinion }}）</span></template>
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="text-[12px] text-medium-emphasis mb-3">{{ activeRow.prevEmptyText }}</div>

          <!-- 超管代批提示：结论记到未提交成员名下，意见里会标注真正的办理人 -->
          <v-alert
            v-if="activeRow.canOverride && !activeRow.canHandle"
            class="mb-3"
            density="compact"
            type="warning"
            variant="tonal"
          >
            超级管理员代批：结论将记到 {{ activeRow.pendingMembers.length }} 位未提交成员名下（意见里会标注代批人）
          </v-alert>

          <div class="d-flex align-start ga-3">
            <div class="field-label pt-2">审批结论</div>

            <v-radio-group v-model="form.result" class="flex-1-1 mt-0" density="compact" hide-details>
              <v-radio
                v-for="opt in activeRow.options"
                :key="opt"
                :color="radioColorOf(opt)"
                :label="optionLabel(opt)"
                :value="opt"
              />
            </v-radio-group>
          </div>

          <div class="d-flex align-start ga-3 mt-1">
            <div class="field-label mt-3">办理意见</div>

            <v-textarea
              v-model="form.opinion"
              auto-grow
              class="flex-1-1"
              density="compact"
              hide-details
              placeholder="选填"
              rows="2"
              variant="outlined"
            />
          </div>
        </div>

        <v-card-actions class="px-4 pb-4">
          <v-spacer />
          <v-btn :disabled="submitting" variant="text" @click="dialog = false">取消</v-btn>

          <v-btn
            color="primary"
            :disabled="!form.result"
            :loading="submitting"
            variant="flat"
            @click="submit"
          >
            提交结论
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!--
     * 结论详情弹窗：表格「审批结论」列点开的只读视图 ——
     * 完整摆出该环全部环节的已提交结论（环名分组 + 结论色点 + 意见），
     * 与办理弹窗的「已提交的审批结论」块同一版式；多环时最新一环带（最新）标记。
    -->
    <v-dialog v-model="historyDialog" max-width="440">
      <v-card v-if="historyRow">
        <v-card-title class="d-flex align-center ga-2 text-[15px] py-3">
          <v-icon color="primary" size="18">mdi-check-decagram</v-icon>
          <span>审批结论详情</span>

          <v-chip color="primary" label size="x-small" variant="tonal">
            {{ historyRow.orderNo }}
          </v-chip>
        </v-card-title>

        <v-divider />

        <div class="px-4 py-3 text-[13px]">
          <div class="text-[12px] text-medium-emphasis mb-2">
            {{ historyRow.title }}<template v-if="historyRow.stepLabel"> · {{ historyRow.stepLabel }}</template>
          </div>

          <div v-for="(g, gi) in historyRow.history" :key="g.step" class="mb-2 last:mb-0">
            <div class="text-[12px] font-weight-medium mb-1">
              {{ g.step }}
              <span
                v-if="gi === historyRow.history.length - 1 && historyRow.history.length > 1"
                class="text-[11px] text-medium-emphasis"
              >（最新）</span>
            </div>

            <div class="sj-group-rows d-flex flex-column ga-1">
              <div
                v-for="(e, i) in g.entries"
                :key="`${e.name}-${i}`"
                class="d-flex align-center ga-2"
              >
                <span class="result-dot" :style="{ background: `rgb(var(--v-theme-${radioColorOf(e.result)}))` }" />
                <span>
                  {{ e.name }}：<span class="font-weight-medium">{{ e.label }}</span>
                  <template v-if="e.opinion"><span class="text-medium-emphasis">（{{ e.opinion }}）</span></template>
                </span>
              </div>
            </div>
          </div>
        </div>

        <v-card-actions class="px-4 pb-4">
          <v-spacer />
          <v-btn variant="text" @click="historyDialog = false">关闭</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="tip.show" :color="tip.color" location="top" timeout="3000">
      {{ tip.text }}
    </v-snackbar>
  </v-container>
</template>

<script lang="ts" setup>
  import { computed, onMounted, reactive, ref } from 'vue'
  import { useIndependentSubmit } from '@/composables/useNodeSubmit'
  import { useUserStore } from '@/stores/user'
  import {
    APPROVAL_RESULTS,
    type ApprovalChainItem,
    type ApprovalOrder,
    branchTerminalMapOf,
    INDEPENDENT_DEFAULT_OPTIONS,
    RECEIVE_QTY_RESULT,
    rebuildChain,
    sameApprover,
    type SubApprovalState,
    subApprovalStateOf,
  } from '@/types/approval'
  // 订单业务上下文：子链分支要承接主链前面卡片的结论，必须与展示/提交侧完全一致
  import { flowContextOfOrder } from '@/utils/approvalFlow'
  import { getApprovalOrder, loadResponsibilities } from '@/utils/collection'
  // 动作权限：管理员以上（approval:manageAll）看所有独立审批环
  import { canAct } from '@/utils/permissions'
  // 责任划分：办理弹窗开头按本单原因显示各部门承担比率（规则维护入口在角色设置页）
  import { formatRatio, type ResponsibilityRow } from '@/utils/responsibility'
  // 日期格式化：与 mine / home 表格同一份实现，别各写各的
  import { formatDate } from '@/utils/utils'

  /**
   * 「独立审批」专属办理页（表格视图，/singleJudge）。
   *
   * 为什么单独一页：主审批页（/approvalPage、首页抽屉）的时间线按**链路**摆环，
   * 独立审批混在里面既不好找、也看不清"只需要我看上一审批人结论"的轻量语义。
   * 这一页把独立审批从链路里抽出来：
   *   · 一行 = 「我参与的」一个独立审批环（简单模式一个环 / 子流程模式当前到我的一环）；
   *   · 只显示**上一审批人的结论**（子流程取前一环全员结论；单环节取同环其他成员已提交的），
   *     不渲染整条链路；
   *   · 提交走 `useIndependentSubmit`：结论回写主审批单的 decisions（主单 status 不动）。
   *
   * 数据零存储（与独立审批整体同一设计）：所有状态由
   * `subApprovalStateOf(flow, decisions, reachedIds, context)` 现算 ——
   * flow / decisions 全在主单快照里，这里只读不写（写只发生在提交那一刻）。
   */

  /** 一条已提交结论（结构化：姓名 / 结论码 / 文案 / 意见，渲染侧自己组版式与着色） */
  interface HistoryEntry {
    name: string
    result: string
    label: string
    opinion: string
  }

  /** 表格行：一个"我参与且已发起"的独立审批环 */
  interface JudgeRow {
    /** 行 key：单号 + 环 stepId（跨单唯一） */
    key: string
    orderId: string
    orderNo: string
    createdText: string
    /** 独立审批名（画布卡片标题） */
    title: string
    /** 子流程模式的环名（简单模式为空） */
    stepLabel: string
    /** decisions.stepId —— 提交时的 nodeId */
    stepId: string
    /** 结论选项（空配置兜底 通过/驳回） */
    options: string[]
    /** 全部已提交结论（按环节分组）：子流程=前面每一环+当前环；单环节=同环一个组 */
    history: Array<{ step: string, entries: HistoryEntry[] }>
    /** 没有任何已提交结论时的占位文案 */
    prevEmptyText: string
    /** 进度文案（已提交人数） */
    progress: string
    statusText: string
    statusColor: string
    /** 我提交过的结论（小字，空 = 还没提交） */
    myResultText: string
    /** 出「填写结论」按钮 */
    canHandle: boolean
    /** 超管代批入口（'approval:independent'）：环没办完、已解锁、还有成员没提交时出「代批」按钮 */
    canOverride: boolean
    /** 还没提交结论的成员姓名（代批时逐人写流水，见 useIndependentSubmit 的 onBehalfOf） */
    pendingMembers: string[]
    /** 这一环已办完（整环全员提交）或我已提交过 —— 「已审批」档的行 */
    finished: boolean
  }

  const userStore = useUserStore()
  const loading = ref(false)
  const rows = ref<JudgeRow[]>([])
  /** 单号 → 整单（提交时喂给 useIndependentSubmit 的 order ref） */
  const ordersById = new Map<string, ApprovalOrder>()

  /**
   * 状态筛选：待我办理（默认）/ 已审批 / 全部。
   * 「已审批」只摆办完的环（整环全员提交或我已提交过）——
   * 之前这一档返回全部行，未审批的混在里面，用户分不清哪些还没办。
   */
  const filter = ref<'todo' | 'done' | 'all'>('todo')
  const filteredRows = computed(() => {
    const list = rows.value
    // 「待我办理」= 我自己的活 + 超管可代批的环（不然超管在待办档里永远一条都翻不到）
    if (filter.value === 'todo') return list.filter(r => r.canHandle || r.canOverride)
    // 「已审批」= 办完的（整环完成 / 我已提交）；「全部」= 所有行（管理员看所有人的环用）
    if (filter.value === 'done') return list.filter(r => r.finished)
    return list
  })

  /**
   * 管理员以上权限（superAdmin / approval，走既有动作 'approval:manageAll'）：
   * 展示**所有**独立审批环，不按「分配给我」过滤；普通成员维持原口径。
   */
  const canSeeAll = computed(() => canAct(userStore.appRole, 'approval:manageAll'))

  /**
   * 超级管理员「代批」（'approval:independent'，只给 superAdmin）：环没办完时代
   * 未提交成员提交整环结论（按成员姓名记到他们名下，意见标注代批人留痕）。
   * 比 canSeeAll（看得到）高一档：代批是替人做决定，不给「管理员」。
   */
  const adminCanOverride = computed(() => canAct(userStore.appRole, 'approval:independent'))

  // 客户端分页（与 mine 表格同款：一次全量拉取、前端分页）
  const page = ref(1)
  const perPage = 10
  const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / perPage)))

  const headers = [
    { title: '单号', key: 'orderNo', sortable: false },
    { title: '独立审批', key: 'title', sortable: false },
    { title: '审批结论', key: 'history', sortable: false },
    { title: '进度', key: 'progress', sortable: false, align: 'center' as const },
    { title: '状态', key: 'statusChip', sortable: false },
    { title: '操作', key: 'action', sortable: false, align: 'center' as const },
  ]

  /** 结论码 → 文案（自定义码原样显示，与时间线同一口径） */
  function optionLabel (code: string): string {
    return APPROVAL_RESULTS.find(r => r.value === code)?.label ?? code
  }

  /**
   * 结论语义色：与 ApprovalHandleForm.radioColorOf 完全同口径 ——
   * 驳回/处置类 = error、推进类（通过 / 接收 / 收量 / 进入审批）= success、其余 = primary。
   * 那边是私有函数抽不出来，这里按同一份清单复制；改口径要两处一起改。
   */
  function radioColorOf (result: string): string {
    if (['reject', 'discard', 'scrap', 'dispose'].includes(result)) return 'error'
    return ['pass', 'receive', RECEIVE_QTY_RESULT, 'enter_approval'].includes(result)
      ? 'success'
      : 'primary'
  }

  /** 一条已提交结论的展示文案：「张三：通过（同意）」 */
  function conclusionText (h: { name?: string, result?: string, resultLabel?: string, opinion?: string }): string {
    const label = h.resultLabel || (h.result ? optionLabel(h.result) : '')
    const head = `${h.name ?? '—'}：${label || '—'}`
    return h.opinion?.trim() ? `${head}（${h.opinion.trim()}）` : head
  }

  /** 我在这个环里对应的成员位（open_id 优先，与全站认人同一口径） */
  function myMemberOf (members: ApprovalChainItem[]): ApprovalChainItem | undefined {
    const me = userStore.member
    return members.find(m => m?.type === 'manager' && sameApprover(m, me))
  }
  /**
   * 把一张单派生成「我的独立审批」行（写入 next）。
   *
   * 为什么单独一个函数：load 的循环要**逐单容错** —— 一张单的数据脏（坏快照 /
   * 未展开结构 / 拍平后一环不剩的容器等）只跳过它自己，不能把整页炸成「加载失败」。
   */
  function deriveOrderRows (order: ApprovalOrder, next: JudgeRow[]): void {
    const me = userStore.member
    const meName = String(me?.name ?? '').trim()
    const snapshot = order.chain
    const flow = snapshot?.flow
    // 旧单（无 flow 流水结构）没有独立审批语义，跳过
    if (!order?.id || !flow?.length || !snapshot) return
    if (!me) return
    ordersById.set(order.id, order)

    const decisions = snapshot.decisions ?? []
    const context = flowContextOfOrder(order)
    /*
     * reachedIds：主链已到达的环节集合（独立审批"发起"就是主线推进到它的那一刻）。
     * 与时间线组件同一份算法（rebuildChain）；简单模式环靠它判发起，
     * 子流程模式的游标重放（flattenIndependentChain）自带到达判定，这里只兜容器级。
     */
    const reachedIds = new Set(
      rebuildChain(flow, decisions, branchTerminalMapOf(snapshot), context).stepIds,
    )
    const states = subApprovalStateOf(flow, decisions, reachedIds, context)

    for (const state of states) {
      // 主链还没推进到这个独立审批：成员不该看到它（"发起"前没有办理一说）
      if (!state.reached) continue

      /** 组装一行（子流程传 step，简单模式 step 缺省） */
      const buildRow = (step?: NonNullable<SubApprovalState['steps']>[number]) => {
        const members = step?.members ?? state.members
        const mine = myMemberOf(members)
        // 管理员以上：所有环都摆出来；普通成员只摆「分配给我」的（多人环里别人同样在他们的页里看到）
        if (!mine && !canSeeAll.value) return

        const handled = step?.handled ?? state.handled
        const myEntry = meName ? handled.find(h => h.name === meName && h.result) : undefined
        const doneCount = step?.doneCount ?? state.doneCount
        const total = members.length
        const stepDone = step?.done ?? state.done

        /*
         * 已提交结论：渲染**全部**环节（用户要求，不再只取上一环）——
         *   · 子流程模式 = 前面每一环全员结论（逐环带环名）+ 当前环已提交成员；
         *   · 单环节模式 = 同环全员已提交的（含我自己的，进度视图里本人结论同样算信息）。
         * 结构化成 history 数组，表格与弹窗各自组版式（着色用 radioColorOf）。
         */
        const toEntry = (h: { name?: string, result?: string, resultLabel?: string, opinion?: string }): HistoryEntry => ({
          name: h.name ?? '—',
          result: h.result ?? '',
          label: h.resultLabel || (h.result ? optionLabel(h.result) : '—'),
          opinion: h.opinion?.trim() ?? '',
        })
        const history: Array<{ step: string, entries: HistoryEntry[] }> = []

        if (step) {
          const idx = state.steps?.findIndex(st => st.id === step.id) ?? -1
          // 前面每一环的全员结论（会签口径，unlocked 就是按它判的）
          for (const st of state.steps?.slice(0, idx) ?? []) {
            const entries = st.handled.filter(h => h.result).map(toEntry)
            if (entries.length) history.push({ step: st.name, entries })
          }
        }

        // 当前环已提交的（单环节模式这里就是同环全员；子流程是本环已交的成员）
        const currentEntries = handled.filter(h => h.result).map(toEntry)
        if (currentEntries.length) history.push({ step: step?.name ?? state.name, entries: currentEntries })

        let prevEmptyText = ''
        if (!history.length) {
          if (!step) {
            prevEmptyText = '还没有成员提交结论'
          } else {
            const idx = state.steps?.findIndex(st => st.id === step.id) ?? -1
            prevEmptyText = idx > 0 ? '前面的环节还没有人提交' : '这是第一环，还没有结论'
          }
        }

        const myDone = !!myEntry
        // 只有环内成员能办：结论落库认的是环里的成员位
        const canHandle = !!mine && !myDone && !stepDone
        /*
         * 超管代批：环没办完、这一环已解锁（子流程会签顺序，与提交侧 useIndependentSubmit
         * 的解锁检查同一口径）、还有成员没提交时，可以代他们一次提交整环结论。
         * handled 与 members 同序（见 SubApprovalState），没提交的名字直接从 handled 里取。
         */
        const pendingMembers = handled.filter(h => !h.result).map(h => h.name).filter(Boolean)
        const rowOverride = adminCanOverride.value && !stepDone
          && (!step || step.unlocked) && pendingMembers.length > 0
        /*
         * 状态色沿用全站口径（utils/approvalFilters 的 APPROVAL_STAGE_META）：
         * 待办=warning（待定同款）、等待=secondary（未审批同款）、
         * 我已提交=success（通过同款）、整环完成=teal（已接收同款）。
         */
        let statusText = mine ? '待我办理' : '待成员提交'
        let statusColor = mine ? 'warning' : 'info'
        if (myDone) {
          statusText = '我已提交'
          statusColor = 'success'
        } else if (stepDone) {
          statusText = '已完成'
          statusColor = 'teal'
        } else if (step && !step.unlocked) {
          statusText = '等待上一环提交'
          statusColor = 'secondary'
        }

        const myLabel = myEntry ? conclusionText(myEntry).replace(`${meName}：`, '') : ''

        next.push({
          key: `${order.id}::${step?.id ?? state.nodeId}`,
          orderId: order.id,
          orderNo: order.order_no ?? '',
          createdText: formatDate(order.created),
          title: state.name,
          stepLabel: step ? `${state.name} · ${step.name}` : '',
          stepId: step?.id ?? state.nodeId,
          options: (step?.options ?? state.options)?.length
            ? (step?.options ?? state.options)
            : [...INDEPENDENT_DEFAULT_OPTIONS],
          prevEmptyText,
          history,
          progress: `${doneCount}/${total}`,
          statusText,
          statusColor,
          myResultText: myLabel,
          canHandle,
          canOverride: rowOverride,
          pendingMembers,
          finished: stepDone || myDone,
        })
      }

      if (state.steps?.length) {
        // 子流程模式：每一环单独一行（普通成员的「可办」只落在自己的那环，管理员全部可见）
        for (const step of state.steps) {
          buildRow(step)
        }
      } else {
        buildRow()
      }
    }
  }

  /**
   * 拉全部审批单 → 派生「我的独立审批」行。
   *
   * 为什么全量拉再前端筛：与首页/我的审批单同一口径（集合里是审批单全量），
   * 单量级小（前端分页），后端没有"按成员+环节"的组合查询，派生逻辑必须在前端跑
   * （subApprovalStateOf 是纯函数，天然在展示侧算）。
   */
  async function load () {
    loading.value = true
    try {
      const orders = await getApprovalOrder()
      ordersById.clear()
      const next: JudgeRow[] = []

      for (const order of orders) {
        // 每单独立容错：一张单的数据脏只跳过它自己，不炸整页（外层 catch 只兜真正的意外）
        try {
          deriveOrderRows(order, next)
        } catch (error) {
          console.error(`[singleJudge] 单 ${order.order_no ?? order.id} 派生失败，已跳过:`, error)
        }
      }

      /*
       * 待办的排前面，其余保持 PB 返回序（getApprovalOrder 已按 -created 排好，新的在前，
       * 与原先的 createdText 降序比较器语义一致）。
       * 不用 Array#sort：项目 TS lib 未到 ES2023（无 toSorted）、unicorn/no-array-sort
       * 又禁原地排序 —— 按 utils/warehouse.ts 同款思路「先归档再取回」，比较器自然消失。
       */
      rows.value = [
        ...next.filter(r => r.canHandle || r.canOverride),
        ...next.filter(r => !r.canHandle && !r.canOverride),
      ]
      // 责任划分清单与行加载并行：失败只影响弹窗开头那块（读不到就不显示），不拦办理
      void loadRespRows()
    } catch (error) {
      console.error('[singleJudge] 加载独立审批失败:', error)
      tip.text = '加载失败，请稍后重试'
      tip.color = 'error'
      tip.show = true
    } finally {
      loading.value = false
    }
  }

  /* ---------------- 办理弹窗 ---------------- */

  const dialog = ref(false)
  const activeRow = ref<JudgeRow | null>(null)
  /** 提交用的审批单 ref：openDialog 时指向该行的整单 */
  const activeOrder = ref<ApprovalOrder | null>(null)
  const form = reactive({ result: '', opinion: '' })

  /* ---------------- 责任划分（弹窗开头显示） ---------------- */

  /** 责任划分清单：维护表为准（空表回落文件默认 24 条）；读失败就静默，弹窗不显示该块 */
  const respRows = ref<ResponsibilityRow[]>([])
  async function loadRespRows () {
    try {
      respRows.value = (await loadResponsibilities()).rows
    } catch (error) {
      console.error('[singleJudge] 责任划分清单读取失败:', error)
    }
  }

  /**
   * 本单最新一次原因决策对应的责任划分规则（办理弹窗开头显示）。
   * 原因键同源：办理选项叶子写入 extra.reason 的值 = REASON_OPTIONS 的值 = 规则表的 reason 键，
   * 决策倒序取最近一次（原因可能在多环里被改选，以最新为准）。
   * 没选过原因 / 规则表里没配 → 返回 null，弹窗就不显示这块。
   */
  const activeResp = computed<ResponsibilityRow | null>(() => {
    const decisions = activeOrder.value?.chain?.decisions ?? []
    for (let i = decisions.length - 1; i >= 0; i--) {
      const reason = String(decisions[i]?.extra?.reason ?? '').trim()
      if (!reason) continue
      return respRows.value.find(r => r.reason === reason) ?? null
    }
    return null
  })

  const tip = reactive({ show: false, text: '', color: 'success' })
  function showToast (text: string, color: string) {
    tip.text = text
    tip.color = color
    tip.show = true
  }

  const { submitIndependent, submitting } = useIndependentSubmit({
    order: activeOrder,
    onUpdated: () => {
      void load()
    },
    onMessage: (text, color) => showToast(text, color),
  })

  function openDialog (row: JudgeRow) {
    activeRow.value = row
    activeOrder.value = ordersById.get(row.orderId) ?? null
    form.result = row.options[0] ?? ''
    form.opinion = ''
    dialog.value = true
  }

  /* ---------------- 结论详情弹窗 ---------------- */

  /** 表格「审批结论」列点开的只读详情：完整摆出该环全部环节的已提交结论 */
  const historyDialog = ref(false)
  const historyRow = ref<JudgeRow | null>(null)

  /**
   * 最后一环 = 摘要列只显示的结论（history 派生时按环节顺序 push，末位即最新一环；
   * 单环节模式只有一个组，同样是它）。调用方保证 history 非空（模板 v-if 已挡），
   * 这里兜底空组防索引越界。
   */
  function lastGroupOf (row: JudgeRow) {
    return row.history[row.history.length - 1] ?? { step: '', entries: [] as HistoryEntry[] }
  }

  function openHistory (row: JudgeRow) {
    historyRow.value = row
    historyDialog.value = true
  }

  async function submit () {
    const row = activeRow.value
    if (!row || !form.result) return
    await submitIndependent({
      // nodeId = decisions.stepId（简单模式是节点 id、子流程是组合 id，派生时已对齐）
      nodeId: row.stepId,
      result: form.result,
      resultLabel: optionLabel(form.result),
      opinion: form.opinion,
      // 超管代批（走的不是成员入口）：结论逐人记到未提交成员名下；成员本人提交不带这个字段
      ...((row.canOverride && !row.canHandle) ? { onBehalfOf: row.pendingMembers } : {}),
      done: ok => {
        if (ok) {
          dialog.value = false
          // 回到默认"待我办理"筛选，刚办完的行自然消失
          filter.value = 'todo'
          page.value = 1
        }
      },
    })
  }

  onMounted(() => {
    void load()
  })
</script>

<!--
 * 弹窗专用样式（数值与 ApprovalHandleForm 的栅格逐值一致）：
 *   · field-label = 88px 定宽 label 列（12px / medium-emphasis）；
 *   · prev-block  = 上一审批人结论引用块（on-surface 低透明度底 + 主题色左竖条，随深浅色主题走）。
-->
<style scoped lang="scss">
.field-label {
  flex: none;
  min-width: 88px;
  font-size: 12px;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.prev-block {
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-left: 3px solid rgba(var(--v-theme-primary), 0.45);
}

/* 结论语义色点：通过=success / 驳回=error / 其它=primary（颜色值走 radioColorOf 内联 style） */
.result-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

/* 环节分组行：挂一条主色细竖线，「环名 → 成员结论行」的归属与时间线 ind-members 同款 */
.sj-group-rows {
  margin-left: 5px;
  padding-left: 9px;
  border-left: 2px solid rgba(var(--v-theme-primary), 0.25);
}

/* 结论列摘要块：整块可点击（hover 高亮 + 键盘可达），点开只读详情弹窗 */
.sj-conclusion {
  cursor: pointer;
  border-radius: 6px;
  transition: background-color 0.15s;

  &:hover {
    background: rgba(var(--v-theme-on-surface), 0.04);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--v-theme-primary), 0.5);
    outline-offset: 1px;
  }
}

/* 摘要主体：多人会签时逐人「、」拼接，允许自然换行 */
.sj-conclusion-main {
  line-height: 1.6;
}

/* 「全部结论」小字提示：主色弱化，暗示可点击 */
.sj-conclusion-hint {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-top: 2px;
  color: rgba(var(--v-theme-primary), 0.75);
}
</style>
