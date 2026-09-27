<template>
  <v-tabs v-model="tab" align-tabs="center" class="sticky top-8 z-10 tabs-shadow" :class="{ 'tabs-scrolled': scrolled }"
    color="primary" fixed-tabs style="background-color: rgb(var(--v-theme-surface))">
    <v-tab prepend-icon="mdi-home" value="home">当前审批单</v-tab>
    <v-tab prepend-icon="mdi-history" value="history">历史审批单</v-tab>
  </v-tabs>

  <v-tabs-window v-model="tab">
    <v-tabs-window-item value="home">
      <v-container class="py-2 px-4 h-[calc(100vh-80px)] bg-app" fluid>
        <v-sheet class="overflow-hidden mt-3 p-4" rounded="15">
          <div class="block-title">审批信息</div>

          <ApprovalFilterBar :dirty="filtersDirty" :filters="filters" :options="filterOptionsMap"
            @apply="applyFilters" @patch="patchFilters" @reset="resetFilters" />

          <v-divider class="mt-3" />

          <v-data-table v-model:page="page" class="text-[12px]" border density="compact" fixed-header :headers="headers"
            fixed-footer hover :items="pendingList" :items-per-page="itemsPerPage" items-per-page-text="每页条数"
            striped="odd" @click:row="handleRowClick">
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
    </v-tabs-window-item>

    <v-tabs-window-item value="history">
      <v-container class="py-2 px-4 h-[calc(100vh-80px)] bg-app" fluid>
        <v-sheet class="p-3 mt-3" rounded="8px">
          <div class="block-title">历史审批单</div>

          <!-- 筛选条件：与 mine.vue 共用同一个组件（加条件只改 utils/approvalFilters 的定义表） -->
          <ApprovalFilterBar :dirty="filtersDirty" :filters="filters" :options="filterOptionsMap"
            @apply="applyFilters" @patch="patchFilters" @reset="resetFilters" />

          <v-divider class="mt-3" />

          <v-data-table v-model:page="page" class="text-[12px]" border density="compact" :headers="headers" fixed-header
            hover fixed-footer :items="historyList" :items-per-page="itemsPerPage"
            :items-per-page-options="[20, 50, 100, 200]" items-per-page-text="每页条数" striped="odd">
            <template #bottom>
              <div class="text-center pt-2">
                <v-pagination v-model="page" :length="pageCount" />
              </div>
            </template>
            <!-- 与当前审批单 tab 用同一套状态映射（原来两个 tab 的驳回一个 warning 一个 error） -->
            <template #item.status="{ value }">
              <v-chip :color="statusMeta(value).color" size="small">{{ statusMeta(value).text }}</v-chip>
            </template>
          </v-data-table>
        </v-sheet>
      </v-container>
    </v-tabs-window-item>
  </v-tabs-window>

  <v-navigation-drawer v-model="setOpen" location="right" permanent temporary width="950">
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

        <span>审批状态：<v-chip :color="statusMeta(selectedNode?.status).color" size="small">
            {{ statusMeta(selectedNode?.status).text }}
          </v-chip>
        </span>
      </v-sheet>

      <GoodsInfo :product="selectedOrder?.expand?.relation" />

      <div class="px-2 py-4 bg-[#EEF1F6] rounded bg-app">
        <v-timeline density="compact" side="end" truncate-line="both" width="100%">
          <ApprovalNode v-for="(step, index) in selectedChain" :key="`${selectedOrder?.id}-${index}`"
            :allowed-results="selectedResultOptions[selectedStepIds[index]]" :can-handle="index === selectedCurrentStep"
            :data="step" :index="index" :length="selectedChain.length" :prev-time="selectedStartTimes[index]"
            :start-time="selectedOrder?.created" @submit="onDrawerSubmit" />
        </v-timeline>
      </div>
    </v-container>
  </v-navigation-drawer>

  <v-fab app color="primary" extended location="bottom right" prepend-icon="mdi-plus">
    <div class="text-none font-weight-regular">新建</div>

    <v-dialog activator="parent" max-width="500">
      <template #default="{ isActive }">
        <v-card rounded="lg">
          <v-card-title class="d-flex justify-space-between align-center">
            <div class=" text-medium-emphasis  text-[18px]">新建审批单</div>

            <v-btn icon="mdi-close" size="30" variant="text" @click="isActive.value = false">
              <v-icon size="20">mdi-close</v-icon>
            </v-btn>
          </v-card-title>

          <v-divider />

          <v-card-text>
            <div>选择审批模板</div>
            <div class="mb-2">备注</div>

            <v-textarea class="mb-2" :counter="200" persistent-counter rows="2" variant="outlined" />

            <v-btn class="text-none font-weight-bold ms-n4" color="primary" text="Retry Premium Free" variant="text"
              @click="generateApprovalChain" />
          </v-card-text>

          <v-divider class="mt-2" />

          <v-card-actions class="my-2 d-flex justify-end">
            <v-btn class="text-none" rounded="xl" text="取消" @click="isActive.value = false" />

            <v-btn class="text-none" color="primary" rounded="xl" text="新建" variant="flat" @click="goCreate" />
          </v-card-actions>
        </v-card>
      </template>
    </v-dialog>
  </v-fab>
  <!-- 抽屉里提交办理后要有反馈（原先这个页面没有 snackbar，写库成功/失败都看不见） -->
  <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="3000" variant="tonal">
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
// 取数 / 组装行 / 筛选：与 mine.vue 共用（原先两页各写一份，加一列要改两处）
import { useApprovalTable } from '@/composables/useApprovalTable'
import { collectStepResultOptions } from '@/types/approval'
import { approvalStatusMeta } from '@/utils/approvalFilters'
import { APPROVAL_TABLE_HEADERS, toApprovalRow, type ApprovalRow } from '@/utils/approvalRows'
import { runtimeOf, stepStartTimesOf } from '@/utils/approvalRuntime'
import { formatDate, generateApprovalChain } from '@/utils/utils'

// 两个 tab 就是同一批数据的两个切面：当前 = 未结束，历史 = 已结束
const tab = ref<'home' | 'history'>('home')
const scrolled = ref(false)
function onScroll() {
  // 向上滚动（scrollTop > 0）时显示阴影
  scrolled.value = (window.scrollY || document.documentElement.scrollTop) > 4
}
const open = shallowRef(false)
const router = useRouter()
const setOpen = computed(() => open.value && tab.value === 'home')
const page = ref(1)
const itemsPerPage = ref(15)

/** 状态 → 文案 + 颜色（与「状态」筛选项共用同一份定义） */
const statusMeta = approvalStatusMeta

/** 表格列：与 mine.vue 共用一份定义（加一列只改 utils/approvalRows） */
const headers = APPROVAL_TABLE_HEADERS

/*
 * 取数 / 组装行 / 筛选：与 mine.vue 共用同一份实现（见 composables/useApprovalTable）。
 * 两个 tab 是同一批数据的两个切面（当前 = 未结束，历史 = 已结束），两套都过同一组筛选条件。
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
  historyList,
  load,
  applyUpdated,
} = useApprovalTable()

/**
 * 当前 tab 实际渲染的行 = **筛过之后**的行。
 * 分页器按它算页数；抽屉的上/下一条也按它在筛选结果里翻 —— 与表格所见一致。
 */
const visibleRows = computed(() => (tab.value === 'history' ? historyList.value : pendingList.value))
const pageCount = computed(() => Math.max(1, Math.ceil(visibleRows.value.length / itemsPerPage.value)))

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

function goCreate() {
  sendFeishuCard({
    receive_id: 'ou_6b6abc721d2c7421703b78dc4db51b4d',
    receive_id_type: 'open_id',
    msg_type: 'interactive',
    content: '{"type":"template","data":{"template_id":"AAqWQlOTUraDJ","template_version_name":"1.0.0"}}',
  })
}
const selectedIndex = computed(() =>
  selectedNode.value ? visibleRows.value.findIndex(r => r.id === selectedNode.value?.id) : -1,
)
const hasPrevStep = computed(() => selectedIndex.value > 0)
const hasNextStep = computed(() =>
  selectedIndex.value >= 0 && selectedIndex.value < visibleRows.value.length - 1,
)

/** 选中第 index 条；顺带把表格翻到它所在的页，否则选中行可能落在别的页上看不到 */
function selectStep(index: number) {
  const row = visibleRows.value[index]
  if (!row) return
  selectedNode.value = row
  open.value = true
  // 与 handleRowClick 一致：收起主侧边栏，给右侧抽屉让位
  drawerSet.value = false
  const p = Math.floor(index / itemsPerPage.value) + 1
  if (p !== page.value) page.value = p
}

function backStep() {
  if (hasPrevStep.value) selectStep(selectedIndex.value - 1)
}

function nextStep() {
  if (hasNextStep.value) selectStep(selectedIndex.value + 1)
}
function handleRowClick(_event: Event, { item }: { item: ApprovalRow }) {
  if (!selectedNode.value?.id) drawerSet.value = false
  selectedNode.value = item
  open.value = true
}
function setClose() {
  selectedNode.value = null
  open.value = false
  drawerSet.value = true
}
function goApproval(row?: ApprovalRow | null) {
  const no = row?.order_no ?? selectedNode.value?.order_no
  router.push({ path: '/approvalPage', query: no ? { order_no: no } : {} })
}

/** 抽屉里的提示（与审批页同一套 snackbar 形状） */
const snackbar = ref<{ show: boolean, text: string, color: string }>({ show: false, text: '', color: 'success' })
function showMsg(text: string, color: 'success' | 'error' | 'warning' = 'success') {
  snackbar.value = { show: true, text, color }
}

/**
 * 抽屉里的「提交」= **就地办理**，落库逻辑与审批页共用 useNodeSubmit（一份实现，不会漂）。
 *
 * 原先这里是「关掉弹窗 + router.push 跳去审批页」：用户填的结论 / 意见 / 附件
 * 一个都没写库，却被当成提交成功 —— 所以改成就地保存。
 * 若仍想在提交后跳到审批页，在 onUpdated 里调 goApproval() 即可。
 */
const { submitNode } = useNodeSubmit({
  order: selectedOrder,
  onMessage: showMsg,
  onUpdated: updated => {
    // 抽屉的时间线由 selectedOrder 派生、而它来自 orders ——
    // 必须更新**列表里那条**（applyUpdated 就是干这件事）；只改 selectedNode 的话时间线不会动。
    applyUpdated(updated)
    // 表头的「审批状态 / 当前审批人 / 耗时」读的是行快照，一并刷新
    const row = orders.value.find(o => o.id === updated.id)
    if (row) selectedNode.value = toApprovalRow(row)
  },
})

function onDrawerSubmit(payload: NodeSubmitPayload) {
  void submitNode(payload)
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  // 一次全量拉取、本地分页与筛选（与 v-data-table 的客户端模式配套），见 useApprovalTable.load
  void load()
})
onUnmounted(() => window.removeEventListener('scroll', onScroll))
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
