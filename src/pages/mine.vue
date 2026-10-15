<template>
  <v-container class="py-2 px-4 min-h-[100vh] bg-app d-flex flex-column" fluid>
    <!-- 上：当前待办（我名下的在办单） -->
    <v-sheet class="mine-block overflow-hidden mt-3 p-4 d-flex flex-column border border-[#E8E8E8]" rounded="15">
      <div class="block-title">当前审批</div>

      <!-- 容器最大宽度放宽到 720：多了一个「进度」下拉，600px 下三个控件会被压得很窄 -->
      <div class="p-2 d-flex items-center justify-between gap-4 max-w-[720px]">
        <v-text-field v-model="search" density="compact" flat class="filter-input" hide-details label="搜索"
          prepend-inner-icon="mdi-magnify" single-line variant="solo-filled" />
        <v-select v-model="modelFilter" class="filter-select" clearable density="compact" flat hide-details
          :items="modelOptions" label="主MODEL" :menu-props="{ contentClass: 'filter-menu' }" single-line
          variant="outlined" />
        <!-- 进度：正常 / 超时 / 滞留。候选是固定三档（见 progressOptions），不是从当前数据里派生的 -->
        <v-select v-model="progressFilter" class="filter-select" clearable density="compact" flat hide-details
          :items="progressOptions" label="进度" :menu-props="{ contentClass: 'filter-menu' }" single-line
          variant="outlined" />
        <v-btn color="#0052D9" size="small" variant="flat">确认</v-btn>
      </div>

      <v-divider class="mt-3" />

      <v-data-table v-model:page="page" class="text-[12px] mine-table" border density="compact" fixed-header
        :headers="headers" fixed-footer hover :items="filteredRows" :items-per-page="itemsPerPage" striped="odd"
        @click:row="handleRowClick">
        <template #item.order_no="{ value }">
          <span class="font-bold">{{ value }}</span>
        </template>

        <!-- 页脚只留一条紧凑分页：默认那套（大按钮 + 上下留白）要吃掉一整行表体 -->
        <template #bottom>
          <div class="d-flex justify-center">
            <v-pagination v-model="page" :length="pageCount" size="small" :total-visible="7" />
          </div>
        </template>
        <!-- 状态：文案与颜色由行里带出来（未审批 / 审批中 / 待定 / 通过 / 驳回，见 utils/approvalFilters） -->
        <template #item.status="{ item }">
          <v-chip :color="item.statusColor" label size="x-small">{{ item.statusText }}</v-chip>
        </template>
        <!-- 进度：按"这一环等了几个**工作日小时**"判 正常 / 超时 / 滞留（见 utils/approvalProgress） -->
        <template #item.process="{ item }">
          <v-chip :color="item.processColor" label size="x-small" :title="item.processDetail">{{ item.processText }}</v-chip>
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

    <!-- 下：历史审批（我经手过的已办结单） -->
    <v-sheet class="mine-block overflow-hidden mt-3 p-4 d-flex flex-column border border-[#E8E8E8]" rounded="15">
      <div class="d-flex align-center justify-space-between">
        <div class="block-title">历史审批</div>
        <span class="text-[12px] text-medium-emphasis">
          我经手过的单（含仍在流转的）· 共 {{ historyRows.length }} 张
        </span>
      </div>

      <ApprovalFilterBar :dirty="historyDirty" :filters="historyFilters" :options="historyOptions"
        :select-keys="['statusText', 'approver', '主MODEL']" :select-labels="{ approver: '最后办理人' }"
        @apply="applyHistoryFilters" @patch="patchHistoryFilters" @reset="resetHistoryFilters" />

      <v-divider class="mt-3" />

      <v-data-table v-model:page="historyPage" class="text-[12px] mine-table" border density="compact" fixed-footer
        fixed-header :headers="historyHeaders" hover :items="historyFilteredRows" :items-per-page="historyPerPage"
        striped="odd" @click:row="handleRowClick">
        <template #item.order_no="{ value }">
          <span class="font-bold">{{ value }}</span>
        </template>

        <template #item.status="{ item }">
          <v-chip :color="item.statusColor" label size="x-small">{{ item.statusText }}</v-chip>
        </template>

        <!-- 最后的审批结论（只有本表有这一列）：悬浮看办理人 / 意见 / 时间 -->
        <template #item.conclusion="{ item }">
          <span :title="item.conclusionDetail">{{ item.conclusion }}</span>
        </template>

        <template #item.created="{ value }">
          {{ formatDate(value) }}
        </template>

        <template #item.actions="{ item }">
          <v-btn color="primary" variant="text" @click.stop="goApproval(item)">
            <span class="text-[13px]">查看</span>
          </v-btn>

          <!-- 删除审批单：按钮里自带权限判断（只有超级管理员看得见）与确认框 -->
          <DeleteOrderButton :row="item" @deleted="onOrderDeleted" @error="onDeleteFailed" />
        </template>

        <!-- 页脚只留一条紧凑分页（与上面那张表同一口径） -->
        <template #bottom>
          <div class="d-flex justify-center">
            <v-pagination v-model="historyPage" :length="historyPageCount" size="small" :total-visible="7" />
          </div>
        </template>
      </v-data-table>
    </v-sheet>
  </v-container>

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

        <span>审批状态：<v-chip :color="selectedNode?.statusColor" size="x-small">
            {{ selectedNode?.statusText ?? '—' }}
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
          <ApprovalNode v-for="(g, gi) in selectedStepGroups" :key="`${selectedOrder?.id}-${g.stepIds[0] || gi}`"
            :allowed-options="selectedOptionItems[g.stepIds[0]]" :allowed-results="selectedResultOptions[g.stepIds[0]]"
            :can-handle="g.indexes.includes(selectedCurrentStep)" :data="g.steps[0]" :index="g.indexes[0]"
            :in-discard-segment="discardMarkOf(g, selectedDiscardMarks)?.seq"
            :discard-segment-size="discardMarkOf(g, selectedDiscardMarks)?.size" :length="selectedChain.length"
            :next-steps="nextStepsOf(g, selectedOptionItems, selectedResultOptions)"
            :option-context="optionContextOf(selectedOrder, selectedChain, g.indexes[0])" :prev-time="g.startTimes[0]"
            :receiver-team="selectedReceiverTeam" :start-time="selectedOrder?.created"
            :remaining-qty="selectedRemainingQty" :stock-amount="selectedStockAmount" :stock-qty="selectedStockQty"
            @submit="onDrawerSubmit" />

          <!-- 时间线最后一条：流转为什么停下（与审批页同一口径） -->
          <FlowEndNote :end="selectedFlowEnd" />
        </v-timeline>
      </div>
    </v-container>
  </v-navigation-drawer>

  <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="3000" variant="tonal">
    {{ snackbar.text }}
  </v-snackbar>
</template>

<script setup lang="ts">
import type { ApprovalChainItem, ApprovalOrder, NodeSubmitPayload } from '@/types/approval'
import { type DeleteOrderSummary } from '@/api/api'
// 筛选条（搜索 / 下拉 / 日期 / 确认 / 重置）：与首页两张表共用同一个组件，控件定义在 utils/approvalFilters
import ApprovalFilterBar from '@/components/ApprovalFilterBar.vue'
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
/*
 * 展示状态（未审批 / 审批中 / 待定 / 通过 / 驳回）与首页表格共用同一份派生口径；
 * 筛选（选项推导 / 应用条件 / 等价比较）也共用同一份 —— 历史板块的筛选条走的就是这些（见下方 historyFilters）。
 */
import {
  applyApprovalFilters,
  applyFilterPatch,
  APPROVAL_STAGE_META,
  approvalStageOf,
  createApprovalFilters,
  filterOptions,
  filtersEqual,
  resetApprovalFilters,
  type ApprovalStage,
  SELECT_FILTERS,
  toCellText,
  type FilterPatch,
  type SelectFilterKey,
} from '@/utils/approvalFilters'
// 条件求值上下文（建单快照优先）：算剩余接收数量、取「平台」快照都要用它，与流程引擎同源
import { flowContextOfOrder, optionContextOf, receiverTeamOf } from '@/utils/approvalFlow'
/*
 * 「进度」列（正常 / 超时 / 滞留）：判据是"这一环等了几个工作日小时"。
 * 纯函数模块 —— 阈值的来源（提醒设置里的超时阈值）由本页读出来后传进去，见下方 pushRules。
 */
import {
  APPROVAL_PROGRESS_LIST,
  APPROVAL_PROGRESS_META,
  approvalProgressDetail,
  type ApprovalProgress,
  approvalProgressOf,
} from '@/utils/approvalProgress'
import {
  discardMarkOf,
  discardMarksOf,
  groupApproverSteps,
  lastHandledOf,
  mainOf,
  nextStepsOf,
  orderHandledBy,
  orderPendingOn,
  runtimeOf,
  stepStartTimesOf,
} from '@/utils/approvalRuntime'
// 登录者（审批链成员的形状）：两档"自己名下"都拿它跟链上成员比（见 orderPendingOn / orderHandledBy）
import { useUserStore } from '@/stores/user'
// PB 的 bi_rows 记录（含 data 快照）→ 界面用的中文 key 产品对象
import { toProductView } from '@/utils/biRowFields'
import { getApprovalOrder } from '@/utils/collection'
// 推送规则（只为了拿「超时阈值」）：与提醒设置、超时跑批同源，读不到就用默认规则
import { DEFAULT_PUSH_RULES, type PushRules } from '@/utils/pushRules'
import { loadPushRules } from '@/utils/pushRulesStore'
import { formatDate, formatTimeDiff, generateApprovalChain } from '@/utils/utils'
// 工作日小时（周末不计）：与服务端超时跑批**共用同一份**实现，表格与提醒不会各算一套
import { workingHoursBetween } from '@/utils/workingHours'

const userStore = useUserStore()
/** 登录者（审批链成员形状）；未登录是 undefined —— 那种情况下"我的单"一律为空 */
const me = computed(() => userStore.member)

const open = shallowRef(false)
const router = useRouter()
/**
 * 抽屉开关。原先还叠了一个早已废弃的 tab 状态（'home' | 'history'，界面上没有 tab 了），
 * 一并去掉：那个条件写死为 true，留着只会让人以为还有什么模式要切。
 */
const setOpen = computed(() => open.value)
const page = ref(1)
const itemsPerPage = ref(17)

interface ApprovalRow {
  id: string
  order_no: string
  status: number
  /** 展示状态**取值** 0..6（未审批/审批中/待定/通过/驳回/已接收/异常，见 utils/approvalFilters 的 APPROVAL_STAGE） */
  statusStage: ApprovalStage
  /** 展示状态：文案 + 颜色（同上，取值的文字表达） */
  statusText: string
  statusColor: string
  /** 以下三项来自关联产品；没关联数据（或调用方未登录）时是 '—' */
  sku: string
  主MODEL: string
  部门: string
  /** 当前待办环节的审批人；流程已走完则显示最后一个环节的审批人 */
  approver: string
  duration: string
  created: string
  /** 最后的审批结论（**只对走完流程的单**有意义，否则 '—'） */
  conclusion: string
  /** 结论的补充说明（办理人 · 结论 · 意见 · 时间），给单元格做悬浮提示 */
  conclusionDetail: string
  /**
   * 建单快照里的「平台」。
   *
   * 本页不显示这一列，但**必须有**：本页历史板块的筛选走的是共享实现
   * （utils/approvalFilters 的 applyApprovalFilters），而它要求行满足 FilterableRow ——
   * 少了这个字段，整行只能在类型上退化，模板里连 item.statusColor 都取不到。
   */
  平台: string
  /**
   * 「进度」列：这一单在**当前环节**已经压了多久 → 正常 / 超时 / 滞留
   * （判据与阈值见 utils/approvalProgress：超时 = 提醒设置里的阈值，滞留 = 5 个工作日）。
   * 只有「当前审批」那张表摆这一列 —— 已办结的单没有"压在我手上多久"可言。
   */
  processStage: ApprovalProgress
  processText: string
  processColor: string
  /** 进度单元格的悬浮说明（等了多久、对着哪个阈值、会不会发提醒） */
  processDetail: string
  }

/** 与审批页同一套口径：有 flow 就按 flow + decisions 重算，旧单（只有 chain、没有 flow）原样沿用 */
function toRow(order: ApprovalOrder): ApprovalRow {
  const p = toProductView(order.expand?.relation)
  const rt = runtimeOf(order)
  // 业务字段取**建单时的快照**（与首页表格、条件求值同一口径；旧单没有快照就是 '—'）
  const ctx = flowContextOfOrder(order)

  const approverName = (rt.currentStep >= 0 ? mainOf(rt.chain[rt.currentStep]) : lastHandledOf(rt.chain))?.name
  // 办结时间 = 最后一个有办理时间的环节；还没办结就算到当下
  let finishedAt: string | undefined
  for (const step of rt.chain) {
    const m = mainOf(step)
    if (m?.handled_at) finishedAt = m.handled_at
  }
  /*
   * 展示状态与「审批结论」的口径与首页表格**完全一致**（见 utils/approvalRows 的 toApprovalRow）：
   * 那两处各写一份就会漂 —— 表现是同一个单在两个页面显示不同的状态 / 不同的结论。
   */
  const statusStage = approvalStageOf(order.status, order.chain?.decisions, rt.end?.kind)
  const stageMeta = APPROVAL_STAGE_META[statusStage]
  const finished = Number(order.status ?? APPROVAL_STATUS.PENDING) !== APPROVAL_STATUS.PENDING
  const last = finished ? lastHandledOf(rt.chain) : undefined
  const conclusion = last ? (last.result_label || last.result || '—') : '—'
  const conclusionDetail = last
    ? [
      last.name || '',
      conclusion,
      last.opinion ? `意见：${last.opinion}` : '',
      last.handled_at ? formatDate(last.handled_at) : '',
    ].filter(Boolean).join(' · ')
    : ''
  /*
   * 「进度」：这一单在**我这一环**已经等了几个**工作日小时**（周末不计）→ 正常 / 超时 / 滞留。
   *
   * 计时起点用 stepStartTimesOf（与表格「审批时长」、抽屉里每步耗时同一套口径）：
   * 在办取**当前待办环节**的起始时间；已办结的单没有"当前环节"（这一列也不显示），按 0 算。
   * 阈值取「提醒设置」里的 overdueHours —— 表格与飞书提醒必须同一个口径，
   * 否则会出现"表格显示超时、提醒却还没发"这种没法解释的情况。
   */
  const starts = stepStartTimesOf(order, rt.chain)
  const startedAt = rt.currentStep >= 0 ? starts[rt.currentStep] : ''
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN
  const waitingHours = Number.isFinite(startedMs)
    ? workingHoursBetween(new Date(startedMs), new Date())
    : 0
  const processStage = approvalProgressOf(waitingHours, pushRules.value.overdueHours)
  const processMeta = APPROVAL_PROGRESS_META[processStage]
  return {
    id: order.id,
    order_no: order.order_no ?? order.id,
    status: Number(order.status ?? APPROVAL_STATUS.PENDING),
    statusStage,
    statusText: stageMeta.text,
    statusColor: stageMeta.color,
    sku: String(p.SKU ?? p['库存SKU'] ?? '—'),
    主MODEL: String(p['主MODEL'] ?? '—'),
    部门: String(p['部门'] ?? '—'),
    approver: approverName ?? '—',
    duration: formatTimeDiff(order.created, finishedAt ?? null),
    created: order.created ?? '',
    conclusion,
    conclusionDetail,
    // 本页不显示这一列，但筛选要求行满足 FilterableRow（见接口里的说明）
    平台: toCellText(ctx['平台']),
    processStage,
    processText: processMeta.text,
    processColor: processMeta.color,
    processDetail: approvalProgressDetail(processStage, waitingHours, pushRules.value.overdueHours),
  }
}

/** 全部审批单（approval_chain），已按创建时间倒序 —— 见 getApprovalOrder */
const orders = ref<ApprovalOrder[]>([])

/**
 * 「超时阈值」的来源：与「提醒设置」的推送规则**同源** —— 那边把阈值改成 24，
 * 进度列的"超时"跟着提前（滞留那档是白板写死的 5 个工作日，不随它变）。
 * 读不到（表还没建 / 没配过）就用默认规则，与超时跑批的兜底完全一致。
 *
 * 为什么放在这里而不是 toRow 里现读：toRow 是同步的，而读规则是异步 —— 见 loadProgressRules。
 * 它是 ref，规则到位后 pendingRows / historyRows 会自己重算（toRow 读的就是它）。
 */
const pushRules = ref<PushRules>({ ...DEFAULT_PUSH_RULES })

/** 拉一次推送规则（只为进度列的超时阈值；loadPushRules 读失败会回落默认规则，不会抛） */
async function loadProgressRules () {
  pushRules.value = (await loadPushRules()).rules
}

const pendingRows = computed(() => orders.value.filter(o => orderPendingOn(o, me.value)).map(toRow))
const historyRows = computed(() =>
  orders.value
    // 排除"此刻又压回我手上"的那些（驳回回退会把单子送回我这一环，那种算待办）
    .filter(o => !orderPendingOn(o, me.value))
    .filter(o => orderHandledBy(o, me.value))
    .map(toRow),
)

const search = ref('')

const typeFilter = ref<string | null>(null)
const modelFilter = ref<string | null>(null)
/** 「进度」筛选：正常 / 超时 / 滞留（与表格里那一列同源，见 toRow 的 processText） */
const progressFilter = ref<string | null>(null)

const dateRange = ref<(Date | string)[]>([])

const modelOptions = computed(() =>
  [...new Set(pendingRows.value.map(r => r.主MODEL))].filter(v => v && v !== '—'),
)

/**
 * 「进度」的候选项：**固定三档**，不从当前数据里派生。
 *
 * 与旁边的主MODEL 刻意不同 —— 型号是开放集合（没出现过的型号选不到也合理），
 * 而进度是三档枚举：哪怕此刻一张滞留的单都没有，「滞留」也该出现在下拉里，
 * 否则用户会以为这个功能不存在，而不是"现在没有这种单"。
 * 文案与顺序取自 APPROVAL_PROGRESS_LIST / _META（表格里的 chip 用的就是它们），别在本页重抄。
 */
const progressOptions = APPROVAL_PROGRESS_LIST.map(v => APPROVAL_PROGRESS_META[v].text)

function isoDay(v: Date | string) {
  return typeof v === 'string' ? v.slice(0, 10) : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
}

const filteredRows = computed(() =>
  pendingRows.value.filter(r => {
    // 与表格里显示的状态同源（见 toRow）：按**展示文案**比，避免"表格显示待定、筛选按通过"这种错位
    if (typeFilter.value && r.statusText !== typeFilter.value) return false
    if (modelFilter.value && r.主MODEL !== modelFilter.value) return false
    // 与「进度」列显示的是同一个值（processText 来自 APPROVAL_PROGRESS_META），按文案比
    if (progressFilter.value && r.processText !== progressFilter.value) return false
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
function resetFilters() {
  search.value = ''
  typeFilter.value = null
  modelFilter.value = null
  progressFilter.value = null
  dateRange.value = []
}

/** 分页器按筛过的行数算页数（否则筛完还停在不存在的页上） */
const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / itemsPerPage.value)))

/*
 * 当前表的列：**不摆「审批结论」**（单还没办结，整列都是 '—'）也**不摆「当前审批人」**
 * （这一页的当前单本就都压在我手上，那一列每行都是同一个名字）。
 * 历史表才摆它们（见 historyHeaders）。
 */
const headers = ref([
  { title: '审批单号', key: 'order_no', align: 'start' },
  { title: 'SKU', key: 'sku' },
  { title: '主MODEL', key: '主MODEL' },
  // 「部门」按需求整套去掉：列不显示、也不再有部门筛选下拉（仅在关键字搜索里还能命中它）
  { title: '状态', key: 'status', align: 'center' },
  { title: '进度', key: 'process', align: 'center' },
  { title: '创建时间', key: 'created' },
  { title: '审批时长', key: 'duration' },
  { title: '操作', key: 'actions', align: 'center', sortable: false },
] as const)

/* ==================== 历史审批（下方板块） ==================== */

const historyPage = ref(1)
const historyPerPage = ref(8)

const historyFilters = reactive(createApprovalFilters())
const historyApplied = reactive(createApprovalFilters())

/** 有条件改了还没确认（界面据此提示"点了才生效"） */
const historyDirty = computed(() => !filtersEqual(historyFilters, historyApplied))

const historyOptions = computed(() => {
  const map = {} as Record<SelectFilterKey, string[]>
  for (const def of SELECT_FILTERS) {
    map[def.key] = filterOptions(historyRows.value, def.key)
  }
  return map
})

/** 历史板块展示的行 = 我经手过的单 ∩ 生效条件 */
const historyFilteredRows = computed(() => applyApprovalFilters(historyRows.value, historyApplied))

/** 控件改动只进草稿，等「确认」（与 useApprovalTable 对下拉的处理刻意不同，见模板说明） */
function patchHistoryFilters(patch: FilterPatch) {
  applyFilterPatch(historyFilters, patch)
}

/** 「确认」：把草稿提交为生效条件，并回到第 1 页（否则会停在筛完不存在的页上） */
function applyHistoryFilters() {
  applyFilterPatch(historyApplied, historyFilters)
  historyPage.value = 1
}

/** 「重置」：草稿与生效**一起**清空，点完立刻看到表格恢复（不用再按确认） */
function resetHistoryFilters() {
  resetApprovalFilters(historyFilters)
  resetApprovalFilters(historyApplied)
  historyPage.value = 1
}
const historyPageCount = computed(() =>
  Math.max(1, Math.ceil(historyFilteredRows.value.length / historyPerPage.value)),
)

/**
 * 历史板块的表头：由当前表的列**派生**（列顺序只写一处），比它多两列 ——
 *   · 「最后办理人」（插在「主MODEL」之后）：已办结的单没有"当前审批人"，那一列显示的是最后办理的人（见 toRow）；
 *   · 「审批结论」（插在「状态」之后）：当前表不摆它（整列都是 '—'），而历史表里它正是最先要看的一列
 *     （单元格悬浮还能看办理人 / 意见 / 时间）。
 *
 * 为什么用「先切一段 + 插一列 + 再接上」而不是 splice：`headers` 是 `as const` 的字面量数组，
 * 往一个元素类型很窄的数组里 splice 一个新对象会类型不匹配；写成新的数组字面量则元素类型自然成并集。
 * 找不到锚点列时（有人改了列名）插到最前面，不会整列消失。
 */
const historyHeaders = computed(() => {
  // 「进度」讲的是"这一环压在我手上多久" —— 已办结的单没有这一说，先剔掉再补历史表自己的两列
  const list = headers.value.filter(h => h.key !== 'process').map(h => ({ ...h }))
  const atModel = list.findIndex(h => h.key === '主MODEL')
  const withApprover = atModel < 0
    ? [{ title: '最后办理人', key: 'approver' }, ...list]
    : [...list.slice(0, atModel + 1), { title: '最后办理人', key: 'approver' }, ...list.slice(atModel + 1)]
  const atStatus = withApprover.findIndex(h => h.key === 'status')
  return atStatus < 0
    ? [...withApprover, { title: '审批结论', key: 'conclusion' }]
    : [
      ...withApprover.slice(0, atStatus + 1),
      { title: '审批结论', key: 'conclusion' },
      ...withApprover.slice(atStatus + 1),
    ]
})

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
 * 弃置审批段的标注（与 chain 下标一一对应）。
 * 与审批页同一口径，判定集中在 utils/approvalRuntime 的 discardMarksOf（别在本页另写一套）——
 * 它按**节点**认、不是"起点往后全算"，所以「回退上一级」重新走过的环节不会被误标成弃置。
 */
const selectedDiscardMarks = computed(() => discardMarksOf({
  chain: selectedChain.value,
  stepIds: selectedStepIds.value,
  flow: selectedOrder.value?.chain?.flow,
}))

// 上/下一条按**筛过之后**的顺序走 —— 与表格里看到的一致（否则会跳到一个被筛掉的行上）
const selectedIndex = computed(() =>
  selectedNode.value ? filteredRows.value.findIndex(r => r.id === selectedNode.value?.id) : -1,
)
const hasPrevStep = computed(() => selectedIndex.value > 0)
const hasNextStep = computed(() =>
  selectedIndex.value >= 0 && selectedIndex.value < filteredRows.value.length - 1,
)

function selectStep(index: number) {
  const row = filteredRows.value[index]
  if (!row) return
  selectedNode.value = row
  open.value = true
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

const snackbar = ref<{ show: boolean, text: string, color: string }>({ show: false, text: '', color: 'success' })
function showMsg(text: string, color: 'success' | 'error' | 'warning' = 'success') {
  snackbar.value = { show: true, text, color }
}

async function onOrderDeleted(summary: DeleteOrderSummary) {
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
function onDeleteFailed(message: string) {
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

function onDrawerSubmit(payload: NodeSubmitPayload) {
  void submitNode(payload)
}

async function getDatas() {
  orders.value = await getApprovalOrder()
  console.log(orders.value)
}

onMounted(() => {
  getDatas()
  // 进度列的「超时阈值」来自提醒设置：拉一次（失败回落默认规则，不影响列表）
  void loadProgressRules()
})
</script>

<style lang="scss" scoped>
.mine-block {
  flex: 1 1 auto;
  /* 最小高度：内容少也不会缩成一条（约 8 行 + 表头） */
  min-height: 340px;
  /* 最大高度：超过就交给整页滚动（想再高/再矮，改这两个值即可） */
  max-height: 62vh;
}

.mine-table {
  flex: 1 1 auto;
  min-height: 0;
}

/*
 * 表格页脚（就是那条分页）压扁：默认上下留白不小，
 * 而这块总共也就半屏高，页脚每高 20px 就等于少一条表体。
 */
.mine-table :deep(.v-data-table-footer) {
  padding-block: 2px;
}

.tabs-shadow {
  transition: box-shadow 0.2s ease;
  box-shadow: 0 0 0 rgba(15, 23, 42, 0);
}

.tabs-shadow.tabs-scrolled {
  box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.15);
}
</style>
