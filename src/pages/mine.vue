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
          v-model="deptFilter"
          clearable
          density="compact"
          flat
          class="filter-select"
          hide-details
          :items="deptOptions"
          label="部门选择"
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

        <v-select
          v-model="deptFilter"
          clearable
          density="compact"
          flat
          class="filter-select"
          hide-details
          :items="deptOptions"
          label="状态"
          :menu-props="{ contentClass: 'filter-menu' }"
          single-line
          variant="outlined"
        />

        <v-btn color="surface-variant" size="small" variant="flat" @click="resetHistoryFilters">
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
        :items="pendingRows"
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
          <ApprovalNode
            v-for="(step, index) in selectedChain"
            :key="`${selectedOrder?.id}-${index}`"
            :allowed-options="selectedOptionItems[selectedStepIds[index]]"
            :allowed-results="selectedResultOptions[selectedStepIds[index]]"
            :can-handle="index === selectedCurrentStep"
            :data="step"
            :index="index"
            :length="selectedChain.length"
            :prev-time="selectedStartTimes[index]"
            :start-time="selectedOrder?.created"
            @submit="onDrawerSubmit"
          />
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
  import { sendFeishuCard } from '@/api/api'
  import ApprovalNode from '@/components/ApprovalNode.vue'
  import GoodsInfo from '@/components/GoodsInfo.vue'
  import { drawerSet } from '@/composables/useEditorFullscreen'
  // 环节办理的落库逻辑与审批页共用同一份（原先这里只关弹窗+跳页，用户填的内容被丢弃）
  import { useNodeSubmit } from '@/composables/useNodeSubmit'
  import {
    APPROVAL_STATUS,
    buildBranchTerminalMap,
    collectStepOptionItems,
    collectStepResultOptions,
    mergeExtraMembers,
    rebuildChain,
  } from '@/types/approval'
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
  function runtimeOf (order: ApprovalOrder) {
    const snapshot = order.chain
    const flow = snapshot?.flow
    if (!flow?.length) {
      const legacy = snapshot?.chain ?? []
      return { chain: legacy, stepIds: legacy.map((_, i) => `legacy-${i}`), currentStep: -1, done: false }
    }
    const r = rebuildChain(flow, snapshot?.decisions ?? [], buildBranchTerminalMap(snapshot?.graph))
    // 合并运行期追加的抄送/转办（转办会把被接替者标成「已转办」，实现见 mergeExtraMembers）
    mergeExtraMembers(r.chain, r.stepIds, snapshot?.extraMembers)
    return { ...r, done: r.done }
  }

  /** 环节的负责人：优先 manager（办理信息记在它上面，与 ApprovalNode 口径一致） */
  function mainOf (step?: ApprovalChainItem[]) {
    return step?.find(i => i.type === 'manager') ?? step?.[0]
  }

  /** 各环节起始时间：首环节 = 建单时间，其余 = 上一环节的办理时间（与审批页 stepStartTimes 一致） */
  function stepStartTimesOf (order: ApprovalOrder, chain: ApprovalChainItem[][]) {
    let prev: string | undefined = order.created
    return chain.map(step => {
      const from = prev ?? ''
      const m = mainOf(step)
      if (m?.handled_at) prev = m.handled_at // 已办理才推进基线
      return from
    })
  }

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
  const historyRows = computed(() => rows.value.filter(r => r.status !== APPROVAL_STATUS.PENDING))

  const search = ref('')

  const typeFilter = ref<string | null>(null)
  const deptFilter = ref<string | null>(null)

  const dateRange = ref<(Date | string)[]>([])
  const deptOptions = computed(() =>
    [...new Set(historyRows.value.map(r => r.部门))].filter(v => v && v !== '—'),
  )

  function isoDay (v: Date | string) {
    return typeof v === 'string' ? v.slice(0, 10) : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }

  const historyList = computed(() =>
    historyRows.value.filter(r => {
      if (typeFilter.value && statusMeta(r.status).text !== typeFilter.value) return false
      if (deptFilter.value && r.部门 !== deptFilter.value) return false
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
  function resetHistoryFilters () {
    search.value = ''
    typeFilter.value = null
    deptFilter.value = null
    dateRange.value = []
  }

  /** 当前 tab 实际渲染的行；分页器要按它算页数（两个 tab 的数据不同） */
  const visibleRows = computed(() => (tab.value === 'history' ? historyList.value : pendingRows.value))
  const pageCount = computed(() => Math.max(1, Math.ceil(visibleRows.value.length / itemsPerPage.value)))

  const headers = ref([
    { title: '审批单号', key: 'order_no', align: 'start' },
    { title: 'SKU', key: 'sku' },
    { title: '主MODEL', key: '主MODEL' },
    { title: '部门', key: '部门' },
    { title: '当前审批人', key: 'approver' },
    { title: '状态', key: 'status', align: 'center' },
    { title: '创建时间', key: 'created' },
    { title: '审批时长', key: 'duration' },
    { title: '操作', key: 'actions', align: 'center', sortable: false },
  ] as const)

  /** 右侧抽屉里展开的那一单 */
  const selectedNode = ref<ApprovalRow | null>(null)
  const selectedOrder = computed(() => orders.value.find(o => o.id === selectedNode.value?.id) ?? null)
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

  const selectedIndex = computed(() =>
    selectedNode.value ? visibleRows.value.findIndex(r => r.id === selectedNode.value?.id) : -1,
  )
  const hasPrevStep = computed(() => selectedIndex.value > 0)
  const hasNextStep = computed(() =>
    selectedIndex.value >= 0 && selectedIndex.value < visibleRows.value.length - 1,
  )

  function selectStep (index: number) {
    const row = visibleRows.value[index]
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
.filter-input {
  :deep(.v-field) {
    --v-field-padding-top: 2px;
    --v-field-padding-bottom: 1px;
    --v-input-control-height: 25px;
    font-size: 12px;
  }

  :deep(.v-field__input) {
    min-height: 25px;
    padding-top: 1px;
    padding-bottom: 1px;
  }

  :deep(.v-label) {
    font-size: 12px;
  }

  :deep(.v-field__append-inner) {
    align-self: center;
    padding-top: 0;
  }

  :deep(.v-field__prepend-inner) {
    margin-top: 0;
    padding-top: 1px;

    .v-icon {
      font-size: 14px;
    }
  }

  :deep(.v-input__details) {
    padding-top: 0;
    min-height: 0;
  }
}

.tabs-shadow {
  transition: box-shadow 0.2s ease;
  box-shadow: 0 0 0 rgba(15, 23, 42, 0);
}

.tabs-shadow.tabs-scrolled {
  box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.15);
}
</style>
