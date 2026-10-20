<template>
  <v-tabs v-model="tab" align-tabs="center" class="sticky top-8 z-10 tabs-shadow" :class="{ 'tabs-scrolled': scrolled }"
    color="primary" fixed-tabs style="background-color: rgb(var(--v-theme-surface))">
    <v-tab prepend-icon="mdi-home" value="home">当前审批单</v-tab>
    <v-tab prepend-icon="mdi-history" value="history">历史审批单</v-tab>
  </v-tabs>

  <v-tabs-window v-model="tab">
    <v-tabs-window-item value="home">
      <v-container class="h-[calc(100vh-80px)] bg-app" fluid>
        <v-sheet class="overflow-hidden mt-3 p-4 card-border" rounded="15">
          <div class="block-title">审批信息</div>

          <!-- 当前审批单：同一个 `approver` 字段在在办单里是「当前审批人」（表格已不摆这一列，筛选仍可按它挑单） -->
          <ApprovalFilterBar :dirty="filtersDirty" :filters="filters" :options="filterOptionsMap"
            :select-labels="{ approver: '当前审批人' }" @apply="applyFilters" @patch="patchFilters"
            @reset="resetFilters" />

          <v-divider class="mt-3" />

          <v-data-table v-model:page="page" class="text-[12px]" border density="compact" fixed-header :headers="pendingHeaders"
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
            <template #item.status="{ item }">
              <v-chip :color="item.statusColor" label size="x-small">{{ item.statusText }}</v-chip>
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
      <v-container class="h-[calc(100vh-80px)] bg-app" fluid>
        <v-sheet class="p-3 mt-3 card-border" rounded="15">
          <div class="block-title">历史审批单</div>
          <ApprovalFilterBar :dirty="filtersDirty" :filters="filters" :options="filterOptionsMap"
            :select-labels="{ approver: '最后办理人' }" @apply="applyFilters" @patch="patchFilters"
            @reset="resetFilters" />

          <v-divider class="mt-3" />

          <v-data-table v-model:page="page" class="text-[12px]" border density="compact" :headers="historyHeaders"
            fixed-header hover fixed-footer :items="historyList" :items-per-page="itemsPerPage"
            :items-per-page-options="[20, 50, 100, 200]" items-per-page-text="每页条数" striped="odd"
            @click:row="handleRowClick">
            <template #bottom>
              <div class="text-center pt-2">
                <v-pagination v-model="page" :length="pageCount" />
              </div>
            </template>
            <!-- 与当前审批单 tab 用同一套状态映射（原来两个 tab 的驳回一个 warning 一个 error） -->
            <template #item.status="{ item }">
              <v-chip :color="item.statusColor" size="small">{{ item.statusText }}</v-chip>
            </template>
            <template #item.created="{ value }">
              {{ formatDate(value) }}
            </template>
            <!-- 最后的审批结论：只有走完流程的单有内容；悬浮看办理人 / 意见 / 时间 -->
            <template #item.conclusion="{ item }">
              <span :title="item.conclusionDetail">{{ item.conclusion }}</span>
            </template>
            <template #item.actions="{ item }">
              <DeleteOrderButton :row="item" @deleted="onOrderDeleted" @error="onDeleteFailed" />
            </template>
          </v-data-table>
        </v-sheet>
      </v-container>
    </v-tabs-window-item>
  </v-tabs-window>

  <v-navigation-drawer v-model="setOpen" location="right" permanent temporary width="1200">
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
        <span>审批状态：<v-chip :color="selectedNode?.statusColor" size="small">
            {{ selectedNode?.statusText ?? '—' }}
          </v-chip>
        </span>
      </v-sheet>

      <GoodsInfo :product="selectedOrder?.expand?.relation" />

      <div class="px-2 py-4 bg-[#EEF1F6] rounded bg-app">
        <v-timeline density="compact" side="end" truncate-line="both" width="100%">
          <ApprovalNode v-for="(g, gi) in selectedStepGroups" :key="`${selectedOrder?.id}-${g.stepIds[0] || gi}`" hide-handle
            :allowed-options="selectedOptionItems[g.stepIds[0]]"
            :allowed-results="selectedResultOptions[g.stepIds[0]]"
            :can-handle="g.indexes.includes(selectedCurrentStep)"
            :data="g.steps[0]" :discard-segment-size="discardMarkOf(g, selectedDiscardMarks)?.size" :index="g.indexes[0]"
            :in-discard-segment="discardMarkOf(g, selectedDiscardMarks)?.seq"
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

    <!--
      办理面板：放在抽屉的 **append 区** —— 它在内容滚动区之外，天然钉在抽屉最底部，
      内容再长也始终可见（sticky 只会在内容末尾"跟着走"，内容短时反而悬在半空）。
      入口只有它 —— 时间线节点内的「办理」已用 hide-handle 关掉；面板本体与审批页同一个组件。
    -->
    <template #append>
      <div class="drawer-dock">
        <HandleDock mode="dialog" :groups="selectedStepGroups" :chain="selectedChain" :current-step="selectedCurrentStep"
          :option-items="selectedOptionItems" :result-options="selectedResultOptions" :order="selectedOrder"
          :receiver-team="selectedReceiverTeam" :remaining-qty="selectedRemainingQty"
          :stock-amount="selectedStockAmount" :stock-qty="selectedStockQty" @submit="onDrawerSubmit">
          <!-- 抄送 / 转办：与审批页同一个组件、同一份落库逻辑（components/approval/HandleDock 的 extra 槽） -->
          <template #extra>
            <SelectNode @select="handleSelect" />
          </template>
        </HandleDock>
      </div>
    </template>
  </v-navigation-drawer>
  <!-- 抽屉里提交办理后要有反馈（原先这个页面没有 snackbar，写库成功/失败都看不见） -->
  <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="3000" variant="tonal">
    {{ snackbar.text }}
  </v-snackbar>
</template>

<script setup lang="ts">
import type { ApprovalChainItem, NodeSubmitPayload } from '@/types/approval'
import { type DeleteOrderSummary } from '@/api/api'
import ApprovalFilterBar from '@/components/ApprovalFilterBar.vue'
import ApprovalNode from '@/components/ApprovalNode.vue'
// 抽屉底部的办理面板：三处办理入口共用（内含 ApprovalHandleForm）
import HandleDock from '@/components/approval/HandleDock.vue'
// 抄送 / 转办：选人组件与落库逻辑，与审批页共用同一份
import SelectNode from '@/components/streamNodes/SelectNode.vue'
import { useApprovalSelect } from '@/composables/useApprovalSelect'
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
import { APPROVAL_TABLE_HEADERS, toApprovalRow, type ApprovalRow } from '@/utils/approvalRows'
// 重算链路 / 每步起始时间 / 「连续同人环节」合并 / 弃置段起点：与审批页（approvalPage）共用同一份口径
import {
  discardMarkOf,
  discardMarksOf,
  groupApproverSteps,
  nextStepsOf,
  runtimeOf,
  stepStartTimesOf,
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

/**
 * 表格列：与 mine.vue 共用一份定义（加一列只改 utils/approvalRows）。
 *
 * 「审批结论」只对**走完流程**的单有内容（见 toApprovalRow），所以在**当前审批单**那张表里
 * 不摆它 —— 摆着会是一整列 '—'；历史那张表用完整列。
 */
const headers = APPROVAL_TABLE_HEADERS
/**
 * 当前审批单那张表的列：在完整列定义上**去掉两列** ——
 *   · 「审批结论」：单没办结，整列都是 '—'；
 *   · 「当前审批人」：当前单走的就是"压在我手上的那一环"，列出来每行都是同一个名字，没有信息量。
 * 历史表用完整列（其中「当前审批人」在那边改叫「最后办理人」，见 historyHeaders）。
 */
const pendingHeaders = APPROVAL_TABLE_HEADERS.filter(h => h.key !== 'conclusion' && h.key !== 'approver')

/**
 * 历史审批单那张表的列：用完整列定义，只把「当前审批人」改叫**最后办理人** ——
 * 已办结的单没有"当前审批人"，那一列显示的是最后办理的人（见 toApprovalRow）。
 * 筛选条上的同一个字段也按这个叫法显示（见模板里的 select-labels）。
 */
const historyHeaders = computed(() =>
  APPROVAL_TABLE_HEADERS.map(h => (h.key === 'approver' ? { ...h, title: '最后办理人' } : h)),
)

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
 * 弃置审批段的标注（与 chain 下标一一对应）。
 * 与审批页 / 我的审批同一口径，判定集中在 utils/approvalRuntime 的 discardMarksOf（别在本页另写一套）——
 * 它按**节点**认、不是"起点往后全算"，所以「回退上一级」重新走过的环节不会被误标成弃置。
 */
const selectedDiscardMarks = computed(() => discardMarksOf({
  chain: selectedChain.value,
  stepIds: selectedStepIds.value,
  flow: selectedOrder.value?.chain?.flow,
}))

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

/**
 * 抄送 / 转办：落库逻辑在 composables/useApprovalSelect.ts（与审批页同一份）。
 * 回填口径与提交一致 —— 必须更新**列表里那条**，抽屉的时间线才会跟着变。
 */
const { handleSelect } = useApprovalSelect({
  order: selectedOrder,
  chain: selectedChain,
  stepIds: selectedStepIds,
  currentStep: selectedCurrentStep,
  onMessage: showMsg,
  onUpdated: updated => {
    applyUpdated(updated)
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

/*
 * 抽屉底部的办理面板：挂在 v-navigation-drawer 的 #append 区（滚动之外，天然贴底）。
 * 底色必须不透明 —— 内容从它上面滚过去时，否则文字会透出来糊成一片。
 */
.drawer-dock {
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

/*
 * Vuetify 的 drawer 内容区是 `flex: 0 1 auto`（不拉伸），append 区 `flex: none`——
 * 内容不足一屏时面板会紧贴内容而不是抽屉底部。让内容区吃掉剩余空间，面板才会被压到底。
 */
:deep(.v-navigation-drawer__content) {
  flex: 1 1 auto;
  min-height: 0;
}
</style>
