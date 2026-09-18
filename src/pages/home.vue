<template>
  <v-tabs v-model="tab" align-tabs="center" color="primary" fixed-tabs class="sticky top-8 z-10 tabs-shadow"
    style="background-color: rgb(var(--v-theme-surface))" :class="{ 'tabs-scrolled': scrolled }">
    <v-tab value="home" prepend-icon="mdi-home">当前审批单</v-tab>
    <v-tab value="history" prepend-icon="mdi-history">历史审批单</v-tab>
  </v-tabs>
  <v-tabs-window v-model="tab">
    <v-tabs-window-item value="home">
      <v-container class="py-2 px-4 h-[calc(100vh-80px)] bg-app" fluid>
        <v-sheet rounded="15" class="overflow-hidden mt-3 p-4">
          <div class="block-title">审批信息</div>
          <div class="p-2 d-flex items-center justify-between gap-4">
            <v-text-field v-model="search" density="compact" label="搜索" prepend-inner-icon="mdi-magnify"
              variant="solo-filled" flat hide-details single-line class="filter-input">
            </v-text-field>
            <v-select v-model="typeFilter" clearable label="类型选择" :items="['通过', '驳回']" variant="outlined" hide-details
              flat class="filter-select" single-line :menu-props="{ contentClass: 'filter-menu' }"></v-select>
            <v-select v-model="deptFilter" clearable label="部门选择" density="compact" :items="deptOptions"
              variant="outlined" hide-details flat class="filter-select" single-line
              :menu-props="{ contentClass: 'filter-menu' }"></v-select>
            <v-date-input v-model="dateRange" label="日期选择" prepend-icon="" max-width="368" multiple="range"
              density="compact" prepend-inner-icon="$calendar" variant="outlined" class="filter-select" single-line
              hide-details></v-date-input>
            <v-btn color="surface-variant" variant="flat" size="small" @click="resetHistoryFilters">
              <span>重置</span>
            </v-btn>
            <v-btn color="#0052D9" variant="flat" size="small">确认</v-btn>
          </div>
          <v-divider class="mt-3"></v-divider>
          <v-data-table v-model:page="page" :headers="headers" :items="pendingRows" hover class="text-[12px]"
            :items-per-page="itemsPerPage" density="compact" @click:row="handleRowClick" border striped="odd"
            fixed-header fixed-footer>
            <template v-slot:item.order_no="{ value }">
              <span class="font-bold">{{ value }}</span>
            </template>
            <template v-slot:bottom>
              <div class="text-center pt-2">
                <v-pagination v-model="page" :length="pageCount"></v-pagination>
              </div>
            </template>
            <!-- 状态：两个 tab 共用同一套映射（原来这里被复制了 5 份，vue 编译器报 Duplicate slot names） -->
            <template v-slot:item.status="{ value }">
              <v-chip :color="statusMeta(value).color" size="x-small" label>{{ statusMeta(value).text }}</v-chip>
            </template>
            <template v-slot:item.created="{ value }">
              {{ formatDate(value) }}
            </template>
            <template v-slot:item.actions="{ item }">
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
        <v-sheet rounded="8px" class="p-3 mt-3">
          <div class="block-title">历史审批单</div>
          <div class="p-2 d-flex items-center justify-between gap-4">
            <v-text-field v-model="search" density="compact" label="搜索" prepend-inner-icon="mdi-magnify"
              variant="solo-filled" flat hide-details single-line class="filter-input">
            </v-text-field>
            <v-select v-model="typeFilter" clearable label="类型选择" :items="['通过', '驳回']" variant="outlined" hide-details
              flat class="filter-select" single-line :menu-props="{ contentClass: 'filter-menu' }"></v-select>
            <v-select v-model="deptFilter" clearable label="部门选择" density="compact" :items="deptOptions"
              variant="outlined" hide-details flat class="filter-select" single-line
              :menu-props="{ contentClass: 'filter-menu' }"></v-select>
            <v-date-input v-model="dateRange" label="日期选择" prepend-icon="" max-width="368" multiple="range"
              density="compact" prepend-inner-icon="$calendar" variant="outlined" class="filter-select" single-line
              hide-details></v-date-input>
            <v-btn color="surface-variant" variant="flat" size="small" @click="resetHistoryFilters">
              <span>重置</span>
            </v-btn>
            <v-btn color="#0052D9" variant="flat" size="small">确认</v-btn>
          </div>
          <v-divider class="mt-3"></v-divider>
          <v-data-table v-model:page="page" :headers="headers" :items="historyList" hover :items-per-page="itemsPerPage"
            density="compact" class="text-[12px]" items-per-page-text="每页条数"
            :items-per-page-options="[20, 50, 100, 200]" border striped="odd" fixed-header fixed-footer>
            <template v-slot:bottom>
              <div class="text-center pt-2">
                <v-pagination v-model="page" :length="pageCount"></v-pagination>
              </div>
            </template>
            <!-- 与当前审批单 tab 用同一套状态映射（原来两个 tab 的驳回一个 warning 一个 error） -->
            <template v-slot:item.status="{ value }">
              <v-chip :color="statusMeta(value).color" size="small">{{ statusMeta(value).text }}</v-chip>
            </template>
          </v-data-table>
        </v-sheet>
      </v-container>
    </v-tabs-window-item>
  </v-tabs-window>
  <v-navigation-drawer v-model="setOpen" location="right" permanent width="950" temporary>
    <template #prepend>
      <div class="d-flex justify-space-between align-center px-2 py-1">
        <span class="text-[13px]">审批视图</span>
        <v-icon-btn color="#727272" size="40" variant="text" @click="setClose">
          <v-icon size="20">mdi-unfold-less-vertical</v-icon>
        </v-icon-btn>
      </div>
      <v-divider></v-divider>
    </template>
    <!-- 默认槽位在 .v-navigation-drawer__content 内自动滚动 -->
    <v-container>
      <v-sheet class="text-[13px] mb-2 d-flex items-center justify-between">
        <span>审批单号：{{ selectedNode?.order_no ?? '—' }}
          <!-- 没有上/下一条时置灰（v-icon-btn 的 disabled 会加 .v-icon-btn--disabled：
               opacity .26 + graytext + pointer-events: none） -->
          <v-icon-btn size="x-small" :disabled="!hasPrevStep" title="上一条" @click="backStep">
            <v-icon>mdi-menu-left</v-icon>
          </v-icon-btn>
          <v-icon-btn size="x-small" :disabled="!hasNextStep" title="下一条" @click="nextStep">
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
        <v-timeline density="compact" side="end" width="100%" truncate-line="both">
          <ApprovalNode v-for="(step, index) in selectedChain" :key="`${selectedOrder?.id}-${index}`" :data="step"
            :index="index" :length="selectedChain.length" :prev-time="selectedStartTimes[index]"
            :allowed-results="selectedResultOptions[selectedStepIds[index]]" :start-time="selectedOrder?.created"
            :can-handle="index === selectedCurrentStep" @submit="onDrawerSubmit" />
        </v-timeline>
      </div>
    </v-container>
  </v-navigation-drawer>
  <v-fab color="primary" extended prepend-icon="mdi-plus" app location="bottom right">
    <div class="text-none font-weight-regular">新建</div>
    <v-dialog activator="parent" max-width="500">
      <template v-slot:default="{ isActive }">
        <v-card rounded="lg">
          <v-card-title class="d-flex justify-space-between align-center">
            <div class=" text-medium-emphasis  text-[18px]">新建审批单</div>
            <v-btn icon="mdi-close" variant="text" @click="isActive.value = false" size="30">
              <v-icon size="20">mdi-close</v-icon>
            </v-btn>
          </v-card-title>
          <v-divider></v-divider>
          <v-card-text>
            <div>选择审批模板</div>
            <div class="mb-2">备注</div>
            <v-textarea :counter="200" class="mb-2" rows="2" variant="outlined" persistent-counter></v-textarea>
            <v-btn class="text-none font-weight-bold ms-n4" color="primary" text="Retry Premium Free" variant="text"
              @click="generateApprovalChain"></v-btn>
          </v-card-text>
          <v-divider class="mt-2"></v-divider>
          <v-card-actions class="my-2 d-flex justify-end">
            <v-btn class="text-none" rounded="xl" text="取消" @click="isActive.value = false"></v-btn>
            <v-btn class="text-none" color="primary" rounded="xl" text="新建" variant="flat" @click="goCreate"></v-btn>
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
import ApprovalNode from '@/components/ApprovalNode.vue'
import GoodsInfo from '@/components/GoodsInfo.vue'
import { generateApprovalChain, formatDate } from '@/utils/utils'
import { getApprovalOrder } from '@/utils/collection'
import { sendFeishuCard } from '@/api/api'
// PB 的 bi_rows 记录（含 data 快照）→ 界面用的中文 key 产品对象
import { toProductView } from '@/utils/biRowFields'
import { drawerSet } from '@/composables/useEditorFullscreen'
// 环节办理的落库逻辑与审批页共用同一份（原先这里只关弹窗+跳页，用户填的内容被丢弃）
import { useNodeSubmit } from '@/composables/useNodeSubmit'
import { flowContextOfOrder } from '@/utils/approvalFlow'
import {
  rebuildChain,
  buildBranchTerminalMap,
  collectStepResultOptions,
  mergeExtraMembers,
  APPROVAL_STATUS,
} from '@/types/approval'
import type { ApprovalChainItem, ApprovalOrder, NodeSubmitPayload } from '@/types/approval'
import { formatTimeDiff } from '@/utils/utils'

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
const STATUS_META: Record<number, { text: string; color: string }> = {
  [APPROVAL_STATUS.PENDING]: { text: '待审批', color: 'primary' },
  [APPROVAL_STATUS.APPROVED]: { text: '通过', color: 'success' },
  [APPROVAL_STATUS.REJECTED]: { text: '驳回', color: 'error' },
}
const statusMeta = (v: unknown) => STATUS_META[Number(v)] ?? STATUS_META[APPROVAL_STATUS.PENDING]

/** 与审批页同一套口径：有 flow 就按 flow + decisions 重算，旧单（只有 chain、没有 flow）原样沿用 */
function runtimeOf(order: ApprovalOrder) {
  const snapshot = order.chain
  const flow = snapshot?.flow
  if (!flow?.length) {
    const legacy = snapshot?.chain ?? []
    return { chain: legacy, stepIds: legacy.map((_, i) => `legacy-${i}`), currentStep: -1, done: false }
  }
  // 业务上下文参与条件选路，取法与审批页/提交侧一致（见 flowContextOfOrder）
  const r = rebuildChain(flow, snapshot?.decisions ?? [], buildBranchTerminalMap(snapshot?.graph), flowContextOfOrder(order))
  // 合并运行期追加的抄送/转办（转办会把被接替者标成「已转办」，实现见 mergeExtraMembers）
  mergeExtraMembers(r.chain, r.stepIds, snapshot?.extraMembers)
  return { ...r, done: r.done }
}

/** 环节的负责人：优先 manager（办理信息记在它上面，与 ApprovalNode 口径一致） */
function mainOf(step?: ApprovalChainItem[]) {
  return step?.find(i => i.type === 'manager') ?? step?.[0]
}

/** 各环节起始时间：首环节 = 建单时间，其余 = 上一环节的办理时间（与审批页 stepStartTimes 一致） */
const stepStartTimesOf = (order: ApprovalOrder, chain: ApprovalChainItem[][]) => {
  let prev: string | undefined = order.created
  return chain.map(step => {
    const from = prev ?? ''
    const m = mainOf(step)
    if (m?.handled_at) prev = m.handled_at // 已办理才推进基线
    return from
  })
}

function toRow(order: ApprovalOrder): ApprovalRow {
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

/* ==================== 历史 tab 的筛选 ==================== */
const search = ref('')
/** 历史里不可能有「待审批」，所以类型只有这两个 */
const typeFilter = ref<string | null>(null)
const deptFilter = ref<string | null>(null)
/** 日期范围：审批单没有业务日期，只能按**建单时间**（created）筛 */
const dateRange = ref<(Date | string)[]>([])
/** 部门选项取自数据本身，不写死 */
const deptOptions = computed(() =>
  [...new Set(historyRows.value.map(r => r.部门))].filter(v => v && v !== '—'),
)
/** Date 或 'YYYY-MM-DD...' 都能取出日期部分（v-date-input 的模型类型两种都可能给） */
const isoDay = (v: Date | string) =>
  typeof v === 'string' ? v.slice(0, 10) : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`

const historyList = computed(() =>
  historyRows.value.filter(r => {
    if (typeFilter.value && statusMeta(r.status).text !== typeFilter.value) return false
    if (deptFilter.value && r.部门 !== deptFilter.value) return false
    if (dateRange.value.length) {
      // created 是 '2026-09-17 02:05:41.542Z'，前 10 位就是日期，可直接按字典序比
      const day = r.created.slice(0, 10)
      const from = isoDay(dateRange.value[0])
      const to = isoDay(dateRange.value[dateRange.value.length - 1])
      if (!day || day < from || day > to) return false
    }
    const kw = search.value.trim().toLowerCase()
    if (kw && !`${r.order_no} ${r.sku} ${r.主MODEL} ${r.部门}`.toLowerCase().includes(kw)) return false
    return true
  }),
)
function resetHistoryFilters() {
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
/** 当前待办环节的下标（-1 = 流程已走完）。只有这一环允许在抽屉里办理 */
const selectedCurrentStep = computed(() =>
  selectedOrder.value ? runtimeOf(selectedOrder.value).currentStep : -1,
)

function goCreate() {
  sendFeishuCard({
    receive_id: 'ou_6b6abc721d2c7421703b78dc4db51b4d',
    receive_id_type: 'open_id',
    msg_type: 'interactive',
    content: "{\"type\":\"template\",\"data\":{\"template_id\":\"AAqWQlOTUraDJ\",\"template_version_name\":\"1.0.0\"}}"
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
const handleRowClick = (_event: Event, { item }: { item: ApprovalRow }) => {
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
const snackbar = ref<{ show: boolean; text: string; color: string }>({ show: false, text: '', color: 'success' })
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
  onUpdated: (updated) => {
    // 抽屉的时间线由 selectedOrder 派生、而它来自 orders ——
    // 所以必须更新**列表里那条**；只改 selectedNode 的话时间线不会动。
    orders.value = orders.value.map(o => (o.id === updated.id ? { ...o, ...updated } : o))
    // 表头的「审批状态 / 当前审批人 / 耗时」读的是行快照，一并刷新
    const row = orders.value.find(o => o.id === updated.id)
    if (row) selectedNode.value = toRow(row)
  },
})

function onDrawerSubmit(payload: NodeSubmitPayload) {
  void submitNode(payload)
}

async function getDatas() {
  orders.value = await getApprovalOrder()
  console.log(orders.value)
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  getDatas()
})
onUnmounted(() => window.removeEventListener('scroll', onScroll))
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