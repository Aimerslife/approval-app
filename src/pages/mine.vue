<template>
  <v-container class="py-2 px-4 h-[calc(100vh-32px)] bg-app" fluid>
    <v-sheet class="overflow-hidden mt-3 p-4" rounded="15">
      <div class="block-title">我的审批</div>

      <div class="p-2 d-flex items-center justify-between gap-4">
        <v-text-field
          v-model="search"
          density="compact"
          flat
          class="filter-input"
          hide-details
          label="搜索"
          prepend-inner-icon="mdi-magnify"
          single-line
          variant="solo-filled"
        />

        <v-select
          v-model="typeFilter"
          clearable
          class="filter-select"
          flat
          hide-details
          :items="['通过', '驳回']"
          label="类型选择"
          :menu-props="{ contentClass: 'filter-menu' }"
          single-line
          variant="outlined"
        />

        <v-select
          v-model="modelFilter"
          class="filter-select"
          clearable
          density="compact"
          flat
          hide-details
          :items="modelOptions"
          label="主MODEL"
          :menu-props="{ contentClass: 'filter-menu' }"
          single-line
          variant="outlined"
        />

        <v-date-input
          v-model="dateRange"
          class="filter-select"
          density="compact"
          label="日期选择"
          hide-details
          max-width="368"
          multiple="range"
          prepend-icon=""
          prepend-inner-icon="$calendar"
          single-line
          variant="outlined"
        />

        <v-btn color="surface-variant" size="small" variant="flat" @click="resetFilters">
          <span>重置</span>
        </v-btn>

        <v-btn color="#0052D9" size="small" variant="flat">确认</v-btn>
      </div>

      <v-divider class="mt-3" />

      <v-data-table
        v-model:page="page"
        class="text-[12px]"
        border
        density="compact"
        fixed-header
        :headers="headers"
        fixed-footer
        hover
        :items="filteredRows"
        :items-per-page="itemsPerPage"
        striped="odd"
        @click:row="handleRowClick"
      >
        <template #item.order_no="{ value }">
          <span class="font-bold">{{ value }}</span>
        </template>

        <template #bottom>
          <div class="text-center pt-2">
            <v-pagination v-model="page" :length="pageCount" />
          </div>
        </template>
        <!-- 状态：两个 tab 共用同一套映射（原来这里被复制了 5 份，vue 编译器报 Duplicate slot names） -->
        <template #item.status="{ value }">
          <v-chip :color="statusMeta(value).color" label size="x-small">{{ statusMeta(value).text }}</v-chip>
        </template>

        <template #item.created="{ value }">
          {{ formatDate(value) }}
        </template>

        <template #item.actions="{ item }">
          <v-btn color="primary" variant="text" @click.stop="goApproval(item)">
            <span class="text-[13px]">审批</span>
          </v-btn>

          <!-- 删除审批单：按钮里自带权限判断（只有超级管理员看得见）与确认框 -->
          <DeleteOrderButton :row="item" @deleted="onOrderDeleted" @error="onDeleteFailed" />
        </template>
      </v-data-table>
    </v-sheet>
  </v-container>

  <v-navigation-drawer
    v-model="setOpen"
    location="right"
    permanent
    temporary
    width="950"
  >
    <template #prepend>
      <div class="d-flex justify-space-between align-center px-2 py-1">
        <span class="text-[13px]">审批视图</span>

        <v-icon-btn color="#727272" size="40" variant="text" @click="setClose">
          <v-icon size="20">mdi-unfold-less-vertical</v-icon>
        </v-icon-btn>
      </div>

      <v-divider />
    </template>
    <!-- 默认槽位在 .v-navigation-drawer__content 内自动滚动 -->
    <v-container>
      <v-sheet class="text-[13px] mb-2 d-flex items-center justify-between">
        <span>审批单号：{{ selectedNode?.order_no ?? '—' }}
          <!-- 没有上/下一条时置灰（v-icon-btn 的 disabled 会加 .v-icon-btn--disabled：
               opacity .26 + graytext + pointer-events: none） -->
          <v-icon-btn :disabled="!hasPrevStep" size="x-small" title="上一条" @click="backStep">
            <v-icon>mdi-menu-left</v-icon>
          </v-icon-btn>

          <v-icon-btn :disabled="!hasNextStep" size="x-small" title="下一条" @click="nextStep">
            <v-icon>mdi-menu-right</v-icon>
          </v-icon-btn>
        </span>

        <span>当前审批人：{{ selectedNode?.approver ?? '—' }}</span>

        <span>审批状态：<v-chip :color="statusMeta(selectedNode?.status).color" size="x-small">
          {{ statusMeta(selectedNode?.status).text }}
        </v-chip>
        </span>
      </v-sheet>

      <GoodsInfo :product="selectedOrder?.expand?.relation" />

      <div class="px-2 py-4  rounded bg-app">
        <v-timeline density="compact" side="end" truncate-line="both" width="100%">
          <!--
            时间线按**合并后的节点**渲染：同一审批人连续办理的相邻环节合成一条（见 selectedStepGroups），
            弹窗里把这一串动作连着办（办完自动接下一环）。
          -->
          <ApprovalNode
            v-for="(g, gi) in selectedStepGroups"
            :key="`${selectedOrder?.id}-${g.stepIds[0] || gi}`"
            :allowed-options="selectedOptionItems[g.stepIds[0]]"
            :allowed-results="selectedResultOptions[g.stepIds[0]]"
            :can-handle="g.indexes.includes(selectedCurrentStep)"
            :data="g.steps[0]"
            :index="g.indexes[0]"
            :in-discard-segment="discardIndexOf(g)"
            :discard-segment-size="discardNodeCount"
            :length="selectedChain.length"
            :next-steps="nextStepsOf(g, selectedOptionItems, selectedResultOptions)"
            :option-context="optionContextOf(selectedOrder, selectedChain, g.indexes[0])"
            :prev-time="g.startTimes[0]"
            :receiver-team="selectedReceiverTeam"
            :start-time="selectedOrder?.created"
            :remaining-qty="selectedRemainingQty"
            :stock-amount="selectedStockAmount"
            :stock-qty="selectedStockQty"
            @submit="onDrawerSubmit"
          />

          <!-- 时间线最后一条：流转为什么停下（与审批页同一口径） -->
          <FlowEndNote :end="selectedFlowEnd" />
        </v-timeline>
      </div>
    </v-container>
  </v-navigation-drawer>

  <v-snackbar
    v-model="snackbar.show"
    :color="snackbar.color"
    location="top"
    timeout="3000"
    variant="tonal"
  >
    {{ snackbar.text }}
  </v-snackbar>
</template>

<script setup lang="ts">
  import type { ApprovalChainItem, ApprovalOrder, NodeSubmitPayload } from '@/types/approval'
  import { sendFeishuCard, type DeleteOrderSummary } from '@/api/api'
  import ApprovalNode from '@/components/ApprovalNode.vue'
  // 操作栏的「删除审批单」：按钮内置权限判断与确认框（与 home.vue 共用同一个组件）
  import DeleteOrderButton from '@/components/DeleteOrderButton.vue'
  // 时间线最后一条：流转为什么停下（见 types/approval 的 FlowEndInfo）
  import FlowEndNote from '@/components/FlowEndNote.vue'
  import GoodsInfo from '@/components/GoodsInfo.vue'
  import { drawerSet } from '@/composables/useEditorFullscreen'
  // 环节办理的落库逻辑与审批页共用同一份（原先这里只关弹窗+跳页，用户填的内容被丢弃）
  import { useNodeSubmit } from '@/composables/useNodeSubmit'
  import {
    APPROVAL_STATUS,
    collectStepOptionItems,
    collectStepResultOptions,
    receivedQuantities,
  } from '@/types/approval'
  // 条件求值上下文（建单快照优先）：算剩余接收数量要用它，与流程引擎同源
  import { flowContextOfOrder, optionContextOf, receiverTeamOf } from '@/utils/approvalFlow'
  /*
   * 重算链路 / 每步起始时间 / 连续同人环节合并：全部用共享模块，别在本页再抄一份。
   * 本页原来自己抄了一份 runtimeOf —— **漏传了业务上下文**（flowContextOfOrder），
   * 有业务条件分支的单会把当前环节算偏（表格的「当前审批人」跟着错），
   * 与首页/审批页的口径就此漂开。见 utils/approvalRuntime 的说明。
   */
  import {
    discardSegmentStart,
    groupApproverSteps,
    mainOf,
    nextStepsOf,
    runtimeOf,
    stepStartTimesOf,
    type ApproverStepGroup,
  } from '@/utils/approvalRuntime'
  // PB 的 bi_rows 记录（含 data 快照）→ 界面用的中文 key 产品对象
  import { toProductView } from '@/utils/biRowFields'
  import { getApprovalOrder } from '@/utils/collection'
  import { formatDate, formatTimeDiff, generateApprovalChain } from '@/utils/utils'

  // 两个 tab 就是同一批数据的两个切面：当前 = 未结束，历史 = 已结束
  const tab = ref<'home' | 'history'>('home')
  const open = shallowRef(false)
  const router = useRouter()
  const setOpen = computed(() => open.value && tab.value === 'home')
  const page = ref(1)
  const itemsPerPage = ref(17)

  interface ApprovalRow {
    id: string
    order_no: string
    status: number
    /** 以下三项来自关联产品；没关联数据（或调用方未登录）时是 '—' */
    sku: string
    主MODEL: string
    部门: string
    /** 当前待办环节的审批人；流程已走完则显示最后一个环节的审批人 */
    approver: string
    duration: string
    created: string
  }

  /** 状态 → 文案 + 颜色（0 待审批 / 1 通过 / 2 驳回，即 APPROVAL_STATUS） */
  const STATUS_META: Record<number, { text: string, color: string }> = {
    [APPROVAL_STATUS.PENDING]: { text: '待审批', color: 'primary' },
    [APPROVAL_STATUS.APPROVED]: { text: '通过', color: 'success' },
    [APPROVAL_STATUS.REJECTED]: { text: '驳回', color: 'error' },
  }
  const statusMeta = (v: unknown) => STATUS_META[Number(v)] ?? STATUS_META[APPROVAL_STATUS.PENDING]

  /** 与审批页同一套口径：有 flow 就按 flow + decisions 重算，旧单（只有 chain、没有 flow）原样沿用 */
  function toRow (order: ApprovalOrder): ApprovalRow {
    const p = toProductView(order.expand?.relation)
    const rt = runtimeOf(order)
    // 当前审批人：有未办环节取它；全办完则取最后一环
    const idx = rt.currentStep >= 0 ? rt.currentStep : rt.chain.length - 1
    // 办结时间 = 最后一个有办理时间的环节；还没办结就算到当下
    let finishedAt: string | undefined
    for (const step of rt.chain) {
      const m = mainOf(step)
      if (m?.handled_at) finishedAt = m.handled_at
    }
    return {
      id: order.id,
      order_no: order.order_no ?? order.id,
      status: Number(order.status ?? APPROVAL_STATUS.PENDING),
      sku: String(p.SKU ?? p['库存SKU'] ?? '—'),
      主MODEL: String(p['主MODEL'] ?? '—'),
      部门: String(p['部门'] ?? '—'),
      approver: mainOf(rt.chain[idx])?.name ?? '—',
      duration: formatTimeDiff(order.created, finishedAt ?? null),
      created: order.created ?? '',
    }
  }

  /** 全部审批单（approval_chain），已按创建时间倒序 —— 见 getApprovalOrder */
  const orders = ref<ApprovalOrder[]>([])
  const rows = computed(() => orders.value.map(toRow))
  /** 当前审批单 = 未结束；历史审批单 = 已结束 */
  const pendingRows = computed(() => rows.value.filter(r => r.status === APPROVAL_STATUS.PENDING))
  // const currentProduct=computed(()=> pendingRows.value.filter(r=>r.order_no==selectedNode.value.order_no))

  const search = ref('')

  const typeFilter = ref<string | null>(null)
  const modelFilter = ref<string | null>(null)

  const dateRange = ref<(Date | string)[]>([])
  /**
   * 下拉选项：从**本页展示的那批行**（待办）推导，不是从全部单据。
   *
   * 两条口径：
   *  · 用"全部待办"而不是"筛过之后的行" —— 否则选了主MODEL=A 之后别的选项就没了；
   *  · 不用已办结的单 —— 它们在本页（只列待办）筛不出东西，列出来只会让人选中后得到空表。
   *    这里原来是从已办结的单推的，所以选项经常是空的。
   */
  const modelOptions = computed(() =>
    [...new Set(pendingRows.value.map(r => r.主MODEL))].filter(v => v && v !== '—'),
  )

  function isoDay (v: Date | string) {
    return typeof v === 'string' ? v.slice(0, 10) : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }

  /**
   * 本页实际展示的行 = 待办单据 ∩ 筛选条件（各条件之间是 **and**）。
   *
   * 这张表绑的就是它 —— 之前表格绑 `pendingRows`（未过滤），筛选条点了不会有任何反应。
   */
  const filteredRows = computed(() =>
    pendingRows.value.filter(r => {
      if (typeFilter.value && statusMeta(r.status).text !== typeFilter.value) return false
      if (modelFilter.value && r.主MODEL !== modelFilter.value) return false
      if (dateRange.value.length > 0) {
        // created 是 '2026-09-17 02:05:41.542Z'，前 10 位就是日期，可直接按字典序比
        const day = r.created.slice(0, 10)
        // .at(-1) 返回 string | Date | undefined（eslint 的 prefer-at 自动改的），先收窄再用
        const first = dateRange.value[0]
        const last = dateRange.value.at(-1)
        if (!first || !last) return false
        const from = isoDay(first)
        const to = isoDay(last)
        if (!day || day < from || day > to) return false
      }
      const kw = search.value.trim().toLowerCase()
      if (kw && !`${r.order_no} ${r.sku} ${r.主MODEL} ${r.部门}`.toLowerCase().includes(kw)) return false
      return true
    }),
  )
  function resetFilters () {
    search.value = ''
    typeFilter.value = null
    modelFilter.value = null
    dateRange.value = []
  }

  /** 分页器按筛过的行数算页数（否则筛完还停在不存在的页上） */
  const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / itemsPerPage.value)))

  const headers = ref([
    { title: '审批单号', key: 'order_no', align: 'start' },
    { title: 'SKU', key: 'sku' },
    { title: '主MODEL', key: '主MODEL' },
    // 「部门」按需求整套去掉：列不显示、也不再有部门筛选下拉（仅在关键字搜索里还能命中它）
    { title: '当前审批人', key: 'approver' },
    { title: '状态', key: 'status', align: 'center' },
    { title: '创建时间', key: 'created' },
    { title: '审批时长', key: 'duration' },
    { title: '操作', key: 'actions', align: 'center', sortable: false },
  ] as const)

  /** 右侧抽屉里展开的那一单 */
  const selectedNode = ref<ApprovalRow | null>(null)
  const selectedOrder = computed(() => orders.value.find(o => o.id === selectedNode.value?.id) ?? null)
  /**
   * 抽屉里那一单产品的「总库存数量」/「总库存金额」→ 下发给办理弹窗。
   * 前者：选中**全部接收**时接收数量就是它（不可修改），也是接收/回收数量的上限；
   * 后者：回收金额的上界（必须小于，见 ApprovalNode 的 lessThan）。
   */
  /**
   * 接收数量的账：总库存数量 / 已接收 / 剩余（口径与流程引擎共用，见 types/approval 的 receivedQuantities）。
   * 总库存数量优先取**建单快照**（与条件取值同源），快照里没有才退回关联产品。
   */
  const selectedQtyLedger = computed(() =>
    receivedQuantities(selectedOrder.value?.chain?.decisions ?? [], flowContextOfOrder(selectedOrder.value)),
  )
  const selectedStockQty = computed(() =>
    String(selectedQtyLedger.value.total ?? toProductView(selectedOrder.value?.expand?.relation)['总库存数量'] ?? ''),
  )
  /** 本环节还能接多少件（剩余）；算不出来就留空，办理端退回按总库存数量 */
  const selectedRemainingQty = computed(() =>
    (selectedQtyLedger.value.remaining === undefined ? '' : selectedQtyLedger.value.remaining),
  )
  const selectedStockAmount = computed(() =>
    String(toProductView(selectedOrder.value?.expand?.relation)['总库存金额'] ?? ''),
  )
  /**
   * 本单所属团队（按快照里的「组别」反查团队表）：
   * 「选择接收组别」的候选限定在它之内（业务口径：不涉及其他团队）。
   */
  const selectedReceiverTeam = computed(() => receiverTeamOf(selectedOrder.value))
  const selectedChain = computed<ApprovalChainItem[][]>(() => {
    const order = selectedOrder.value
    return order ? runtimeOf(order).chain : []
  })
  const selectedStepIds = computed(() => {
    const order = selectedOrder.value
    return order ? runtimeOf(order).stepIds : []
  })
  const selectedStartTimes = computed(() =>
    selectedOrder.value ? stepStartTimesOf(selectedOrder.value, selectedChain.value) : [],
  )
  /** 各环节可选的审批结论（取模板里该环节后面分支绑定的 result） */
  const selectedResultOptions = computed(() => {
    const flow = selectedOrder.value?.chain?.flow
    return flow?.length ? collectStepResultOptions(flow) : {}
  })
  /** 各环节的**选项数组**：模板里在审批节点上配的 options，办理下拉框直接用它渲染 */
  const selectedOptionItems = computed(() => {
    const flow = selectedOrder.value?.chain?.flow
    return flow?.length ? collectStepOptionItems(flow) : {}
  })
  /** 当前待办环节的下标（-1 = 流程已走完）。只有这一环允许在抽屉里办理 */
  const selectedCurrentStep = computed(() =>
    selectedOrder.value ? runtimeOf(selectedOrder.value).currentStep : -1,
  )
  /** 流转**为什么**停下（办完 / 走到结束节点 / 命中终结结论 / 卡住）：时间线最后一条展示它 */
  const selectedFlowEnd = computed(() =>
    selectedOrder.value ? runtimeOf(selectedOrder.value).end : undefined,
  )
  /**
   * 时间线上的节点：同一审批人**连续**办理的相邻环节合成一条（见 utils/approvalRuntime）。
   * 与审批页 / 首页同一口径 —— 两处不一致时，同一条单在不同页面看到的节点数会不一样。
   */
  const selectedStepGroups = computed(() =>
    groupApproverSteps(selectedChain.value, selectedStepIds.value, selectedStartTimes.value),
  )

  /**
   * 弃置审批段起点（-1 = 这一单没进入弃置）。
   * 与审批页同一口径，判定集中在 utils/approvalRuntime 的 discardSegmentStart（别在本页另写一套）。
   */
  const selectedDiscardStart = computed(() => discardSegmentStart(selectedChain.value))

  /**
   * 这一组落在弃置段里吗 —— 落在就返回**段内序号**（0 起），否则 undefined。
   * 时间线据此把圆点从这一段起逐渐缩小、并整段包上独立背景（见 ApprovalNode 的 inDiscardSegment）。
   */
  function discardIndexOf (group: ApproverStepGroup): number | undefined {
    const start = selectedDiscardStart.value
    const i = group.indexes[0]
    return start >= 0 && i >= start ? i - start : undefined
  }

  /**
   * 弃置段一共几条节点（**合并后**的节点数，与 discardIndexOf 同一口径）。
   *
   * 交给 ApprovalNode 认出"哪条是这一段的最后一条"：整段背景只有首/尾两条留圆角、
   * 只有它们不往缝里撑，中间的直角首尾相接才拼成**一整块**背景（见其 discardSegmentSize）。
   */
  const discardNodeCount = computed(() => selectedStepGroups.value.filter(g => discardIndexOf(g) !== undefined).length)

  // 上/下一条按**筛过之后**的顺序走 —— 与表格里看到的一致（否则会跳到一个被筛掉的行上）
  const selectedIndex = computed(() =>
    selectedNode.value ? filteredRows.value.findIndex(r => r.id === selectedNode.value?.id) : -1,
  )
  const hasPrevStep = computed(() => selectedIndex.value > 0)
  const hasNextStep = computed(() =>
    selectedIndex.value >= 0 && selectedIndex.value < filteredRows.value.length - 1,
  )

  function selectStep (index: number) {
    const row = filteredRows.value[index]
    if (!row) return
    selectedNode.value = row
    open.value = true
    drawerSet.value = false
    const p = Math.floor(index / itemsPerPage.value) + 1
    if (p !== page.value) page.value = p
  }

  function backStep () {
    if (hasPrevStep.value) selectStep(selectedIndex.value - 1)
  }

  function nextStep () {
    if (hasNextStep.value) selectStep(selectedIndex.value + 1)
  }
  function handleRowClick (_event: Event, { item }: { item: ApprovalRow }) {
    if (!selectedNode.value?.id) drawerSet.value = false
    selectedNode.value = item
    open.value = true
  }
  function setClose () {
    selectedNode.value = null
    open.value = false
    drawerSet.value = true
  }
  function goApproval (row?: ApprovalRow | null) {
    const no = row?.order_no ?? selectedNode.value?.order_no
    router.push({ path: '/approvalPage', query: no ? { order_no: no } : {} })
  }

  const snackbar = ref<{ show: boolean, text: string, color: string }>({ show: false, text: '', color: 'success' })
  function showMsg (text: string, color: 'success' | 'error' | 'warning' = 'success') {
    snackbar.value = { show: true, text, color }
  }

  /**
   * 删掉一条单之后重新取数（本页的 pendingRows / 筛选选项都由 orders 派生，一处刷新即可）。
   *
   * 抽屉正开着这一条时一并关掉：指向"已删除记录"的抽屉会一直显示旧时间线，
   * 点办理还会写到不存在的单上。
   */
  async function onOrderDeleted (summary: DeleteOrderSummary) {
    if (selectedNode.value?.id === summary.id) {
      selectedNode.value = null
      // 关抽屉要动 open（setOpen 是 computed，写它会报"只读"）
      open.value = false
    }
    await getDatas()
    // deleted = false 表示它之前就已经不在了（服务端按幂等处理）——提示如实说
    showMsg(summary.deleted ? '审批单已删除' : '该审批单已经不在了，列表已刷新', summary.deleted ? 'success' : 'warning')
  }

  /** 删除失败（多为权限或网络）：把服务端给的原因原样弹出来 */
  function onDeleteFailed (message: string) {
    showMsg(message, 'error')
  }

  const { submitNode } = useNodeSubmit({
    order: selectedOrder,
    onMessage: showMsg,
    onUpdated: updated => {
      orders.value = orders.value.map(o => (o.id === updated.id ? { ...o, ...updated } : o))
      // 表头的「审批状态 / 当前审批人 / 耗时」读的是行快照，一并刷新
      const row = orders.value.find(o => o.id === updated.id)
      if (row) selectedNode.value = toRow(row)
    },
  })

  function onDrawerSubmit (payload: NodeSubmitPayload) {
    void submitNode(payload)
  }

  async function getDatas () {
    orders.value = await getApprovalOrder()
    console.log(orders.value)
  }

  onMounted(() => {
    getDatas()
  })
</script>

<style lang="scss" scoped>
.tabs-shadow {
  transition: box-shadow 0.2s ease;
  box-shadow: 0 0 0 rgba(15, 23, 42, 0);
}

.tabs-shadow.tabs-scrolled {
  box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.15);
}
</style>
