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

              <!-- 删除审批单：按钮里自带权限判断（只有超级管理员看得见）与确认框 -->
              <DeleteOrderButton :row="item" @deleted="onOrderDeleted" @error="onDeleteFailed" />
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
            :items-per-page-options="[20, 50, 100, 200]" items-per-page-text="每页条数" striped="odd"
            @click:row="handleRowClick">
            <template #bottom>
              <div class="text-center pt-2">
                <v-pagination v-model="page" :length="pageCount" />
              </div>
            </template>
            <!-- 与当前审批单 tab 用同一套状态映射（原来两个 tab 的驳回一个 warning 一个 error） -->
            <template #item.status="{ value }">
              <v-chip :color="statusMeta(value).color" size="small">{{ statusMeta(value).text }}</v-chip>
            </template>
            <template #item.actions="{ item }">
              <DeleteOrderButton :row="item" @deleted="onOrderDeleted" @error="onDeleteFailed" />
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
          <!--
            时间线按**合并后的节点**渲染：同一审批人连续办理的相邻环节合成一条（见 selectedStepGroups），
            弹窗里把这一串动作连着办（办完自动接下一环）。
          -->
          <ApprovalNode v-for="(g, gi) in selectedStepGroups" :key="`${selectedOrder?.id}-${g.stepIds[0] || gi}`"
            :allowed-options="selectedOptionItems[g.stepIds[0]]"
            :allowed-results="selectedResultOptions[g.stepIds[0]]"
            :can-handle="g.indexes.includes(selectedCurrentStep)"
            :data="g.steps[0]" :discard-segment-size="discardNodeCount" :index="g.indexes[0]"
            :in-discard-segment="discardIndexOf(g)"
            :length="selectedChain.length"
            :next-steps="nextStepsOf(g, selectedOptionItems, selectedResultOptions)"
            :option-context="optionContextOf(selectedOrder, selectedChain, g.indexes[0])"
            :prev-time="g.startTimes[0]" :receiver-team="selectedReceiverTeam" :start-time="selectedOrder?.created"
            :stock-amount="selectedStockAmount" :remaining-qty="selectedRemainingQty" :stock-qty="selectedStockQty"
            @submit="onDrawerSubmit" />

          <!-- 时间线最后一条：流转为什么停下（与审批页同一口径） -->
          <FlowEndNote :end="selectedFlowEnd" />
        </v-timeline>
      </div>
    </v-container>
  </v-navigation-drawer>
  <!-- 抽屉里提交办理后要有反馈（原先这个页面没有 snackbar，写库成功/失败都看不见） -->
  <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="3000" variant="tonal">
    {{ snackbar.text }}
  </v-snackbar>
</template>

<script setup lang="ts">
import type { ApprovalChainItem, NodeSubmitPayload } from '@/types/approval'
import { sendFeishuCard, type DeleteOrderSummary } from '@/api/api'
import ApprovalFilterBar from '@/components/ApprovalFilterBar.vue'
import ApprovalNode from '@/components/ApprovalNode.vue'
// 操作栏的「删除审批单」：按钮内置权限判断与确认框（两个页面共用同一个组件）
import DeleteOrderButton from '@/components/DeleteOrderButton.vue'
// 时间线最后一条：流转为什么停下（见 types/approval 的 FlowEndInfo）
import FlowEndNote from '@/components/FlowEndNote.vue'
import GoodsInfo from '@/components/GoodsInfo.vue'
import { drawerSet } from '@/composables/useEditorFullscreen'
// 环节办理的落库逻辑与审批页共用同一份（原先这里只关弹窗+跳页，用户填的内容被丢弃）
import { useNodeSubmit } from '@/composables/useNodeSubmit'
// 取数 / 组装行 / 筛选：与 mine.vue 共用（原先两页各写一份，加一列要改两处）
import { useApprovalTable } from '@/composables/useApprovalTable'
import { collectStepOptionItems, collectStepResultOptions, receivedQuantities } from '@/types/approval'
// 条件求值上下文（建单快照优先）：算剩余接收数量要用它，与流程引擎同源
import { flowContextOfOrder, optionContextOf, receiverTeamOf } from '@/utils/approvalFlow'
import { approvalStatusMeta } from '@/utils/approvalFilters'
import { APPROVAL_TABLE_HEADERS, toApprovalRow, type ApprovalRow } from '@/utils/approvalRows'
// 重算链路 / 每步起始时间 / 「连续同人环节」合并 / 弃置段起点：与审批页（approvalPage）共用同一份口径
import {
  discardSegmentStart,
  groupApproverSteps,
  nextStepsOf,
  runtimeOf,
  stepStartTimesOf,
  type ApproverStepGroup,
} from '@/utils/approvalRuntime'
// 产品的「总库存数量」等字段：PB 记录 → 界面用的中文 key 对象（唯一入口）
import { toProductView } from '@/utils/biRowFields'
import { formatDate } from '@/utils/utils'

// 两个 tab 就是同一批数据的两个切面：当前 = 未结束，历史 = 已结束
const tab = ref<'home' | 'history'>('home')
const scrolled = ref(false)
function onScroll() {
  // 向上滚动（scrollTop > 0）时显示阴影
  scrolled.value = (window.scrollY || document.documentElement.scrollTop) > 4
}
const open = shallowRef(false)
const router = useRouter()
/*
 * 抽屉的显隐。
 *
 * 原来这里还 `&& tab.value === 'home'` —— 于是**历史审批单里点行也不会打开抽屉**，
 * 看不到它走过哪几环、为什么停。两个 tab 共用同一个抽屉，且抽屉内容对已办结的单
 * 天然是只读的（见模板里 `can-handle` 的说明），所以不再按 tab 区分。
 * ⚠️ 折叠式侧边栏（drawerSet）由 handleRowClick / setClose 管，不在这里做。
 */
const setOpen = computed(() => open.value)
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
/**
 * 接收数量的账：总库存数量 / 已接收 / 剩余（口径与流程引擎共用，见 types/approval 的 receivedQuantities）。
 * 总库存数量优先取**建单快照**（与条件取值同源），快照里没有才退回关联产品。
 */
const selectedQtyLedger = computed(() =>
  receivedQuantities(selectedOrder.value?.chain?.decisions ?? [], flowContextOfOrder(selectedOrder.value)),
)
/**
 * 抽屉里那一单产品的「总库存数量」/「总库存金额」→ 下发给办理弹窗。
 * 前者：选中**全部接收**时接收数量就是它（不可修改），也是接收/回收数量的上限；
 * 后者：回收金额的上界（必须小于，见 ApprovalNode 的 lessThan）。
 */
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
 * 与审批页同一口径 —— 两处不一致时，同一条单在两个页面看到的节点数会不一样。
 */
const selectedStepGroups = computed(() =>
  groupApproverSteps(selectedChain.value, selectedStepIds.value, selectedStartTimes.value),
)

/**
 * 弃置审批段起点（-1 = 这一单没进入弃置）。
 * 与审批页 / 我的审批同一口径，判定集中在 utils/approvalRuntime 的 discardSegmentStart（别在本页另写一套）。
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
 * 删掉一条单之后：重新**全量**取数 —— 列表、筛选下拉的选项、两个 tab 都由 orders 派生，
 * 少刷一处就会出现"单子没了、筛选里还留着它的部门"这种残留。
 *
 * 抽屉正开着这一条时一并关掉：留着一个指向"已删除记录"的抽屉最迷惑人
 * （时间线还在、点办理会写到不存在的单上）。
 */
async function onOrderDeleted(summary: DeleteOrderSummary) {
  if (selectedNode.value?.id === summary.id) {
    selectedNode.value = null
    open.value = false
  }
  await load()
  // deleted = false 表示它之前就已经不在了（服务端按幂等处理）——提示如实说，别谎报"删除成功"
  showMsg(summary.deleted ? '审批单已删除' : '该审批单已经不在了，列表已刷新', summary.deleted ? 'success' : 'warning')
}

/** 删除失败（多为权限或网络）：把服务端给的原因原样弹出来 */
function onDeleteFailed(message: string) {
  showMsg(message, 'error')
}

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
