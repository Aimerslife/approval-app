<template>
  <v-container class="py-2 px-4 h-[calc(100vh-32px)] bg-app" fluid>
    <v-sheet class="overflow-hidden mt-3 p-4" rounded="15">
      <div class="block-title">我的审批</div>

      <!-- 筛选条件：与 home.vue 共用同一个组件（加条件只改 utils/approvalFilters 的定义表） -->
      <ApprovalFilterBar
        :dirty="filtersDirty"
        :filters="filters"
        :options="filterOptionsMap"
        @apply="applyFilters"
        @patch="patchFilters"
        @reset="resetFilters"
      />

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
        :items="pendingList"
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

      <div class="px-2 py-4 bg-[#EEF1F6] rounded bg-app">
        <v-timeline density="compact" side="end" truncate-line="both" width="100%">
          <ApprovalNode
            v-for="(step, index) in selectedChain"
            :key="`${selectedOrder?.id}-${index}`"
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
  import type { ApprovalChainItem, NodeSubmitPayload } from '@/types/approval'
  import { sendFeishuCard } from '@/api/api'
  import ApprovalFilterBar from '@/components/ApprovalFilterBar.vue'
  import ApprovalNode from '@/components/ApprovalNode.vue'
  import GoodsInfo from '@/components/GoodsInfo.vue'
  import { drawerSet } from '@/composables/useEditorFullscreen'
  // 环节办理的落库逻辑与审批页共用同一份（原先这里只关弹窗+跳页，用户填的内容被丢弃）
  import { useNodeSubmit } from '@/composables/useNodeSubmit'
  // 取数 / 组装行 / 筛选：与 home.vue 共用（原先两页各写一份，加一列要改两处）
  import { useApprovalTable } from '@/composables/useApprovalTable'
  import { collectStepResultOptions } from '@/types/approval'
  import { approvalStatusMeta } from '@/utils/approvalFilters'
  import { APPROVAL_TABLE_HEADERS, toApprovalRow, type ApprovalRow } from '@/utils/approvalRows'
  import { runtimeOf,stepStartTimesOf } from '@/utils/approvalRuntime'
  import { formatDate, generateApprovalChain } from '@/utils/utils'

  // 两个 tab 就是同一批数据的两个切面：当前 = 未结束，历史 = 已结束
  const tab = ref<'home' | 'history'>('home')
  const open = shallowRef(false)
  const router = useRouter()
  const setOpen = computed(() => open.value && tab.value === 'home')
  const page = ref(1)
  const itemsPerPage = ref(17)

  /** 状态 → 文案 + 颜色（与「状态」筛选项共用同一份定义） */
  const statusMeta = approvalStatusMeta

  /** 表格列：与 home.vue 共用一份定义（加一列只改 utils/approvalRows） */
  const headers = APPROVAL_TABLE_HEADERS

  /*
   * 取数 / 组装行 / 筛选：与 home.vue 共用同一份实现（见 composables/useApprovalTable）。
   *
   * ⚠️ 本页原来是坏的：筛选条件只作用在一个**没有被任何表格渲染**的 historyList 上
   * （本页只有"待审批"一张表），「状态」下拉错绑到部门变量、选项取的是部门，
   * 而表格 :items 绑的是未过滤的数组 —— 筛选条点了完全没反应。
   * 现在这一张表直接渲染筛过的 pendingList。
   */
  const {
    orders,
    filters,
    filtersDirty,
    applyFilters,
    resetFilters,
    patchFilters,
    filterOptionsMap,
    pendingList,
    load,
    applyUpdated,
  } = useApprovalTable()

  const pageCount = computed(() => Math.max(1, Math.ceil(pendingList.value.length / itemsPerPage.value)))

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
  /** 当前待办环节的下标（-1 = 流程已走完）。只有这一环允许在抽屉里办理 */
  const selectedCurrentStep = computed(() =>
    selectedOrder.value ? runtimeOf(selectedOrder.value).currentStep : -1,
  )

  const selectedIndex = computed(() =>
    selectedNode.value ? pendingList.value.findIndex(r => r.id === selectedNode.value?.id) : -1,
  )
  const hasPrevStep = computed(() => selectedIndex.value > 0)
  const hasNextStep = computed(() =>
    selectedIndex.value >= 0 && selectedIndex.value < pendingList.value.length - 1,
  )

  function selectStep (index: number) {
    const row = pendingList.value[index]
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
      // 合并回列表（时间线由列表里那条派生，见 useApprovalTable.applyUpdated）
      applyUpdated(updated)
      // 表头的「审批状态 / 当前审批人 / 耗时」读的是行快照，一并刷新
      const row = orders.value.find(o => o.id === updated.id)
      if (row) selectedNode.value = toApprovalRow(row)
    },
  })

  function onDrawerSubmit (payload: NodeSubmitPayload) {
    void submitNode(payload)
  }

  onMounted(() => {
    // 一次全量拉取、本地分页与筛选（与 v-data-table 的客户端模式配套），见 useApprovalTable.load
    void load()
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
