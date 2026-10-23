<template>
  <v-container class="d-flex ga-3 bg-app h-[calc(100vh-32px)] p-0" fluid>
    <!-- ==================== 左：分类 ==================== -->
    <v-sheet class="mine-rail d-flex flex-column card-border pa-2 pt-4">
      <div class="d-flex align-center justify-space-between px-1 pb-1">
        <span class="text-[13px] font-bold">审批中心</span>
        <v-icon-btn size="x-small" title="刷新列表" variant="text" @click="getDatas">
          <v-icon size="16">mdi-refresh</v-icon>
        </v-icon-btn>
      </div>
      <!-- 搜索只作用于卡片列表；表格（所有审批单）用它自己的筛选条（见 ApprovalFilterBar） -->
      <v-text-field v-if="tab !== 'history'" v-model="keyword" class="filter-input my-3 max-h-[30px]" density="compact"
        flat hide-details label="搜索" prepend-inner-icon="mdi-magnify" single-line variant="solo-filled" />
      <v-list class="py-0" density="compact" nav>
        <v-list-item v-for="item in tabItems" :key="item.value" :active="tab === item.value" class="mine-tab"
          color="primary" rounded="lg" @click="switchTab(item.value)">
          <template #prepend>
            <v-icon size="17">{{ item.icon }}</v-icon>
          </template>
          <v-list-item-title class="text-[12.5px]">{{ item.text }}</v-list-item-title>
          <template #append>
            <span class="rail-count">{{ item.count }}</span>
          </template>
        </v-list-item>
      </v-list>
    </v-sheet>
    <!-- ==================== 中 + 右 ==================== -->
    <div class="mine-main d-flex ga-3 min-w-0">
      <!-- 所有审批单：保留原来的表格（内部键沿用 history） -->
      <v-sheet v-if="tab === 'history'" class="mine-table-col d-flex flex-column card-border overflow-hidden pt-2 px-2">
        <div class="d-flex align-center justify-space-between px-3 pt-2">
          <span class="text-[14px] font-bold">所有审批单</span>
          <span class="text-[12px] text-medium-emphasis">
            全部审批单（含仍在流转的）· 共 {{ tabCounts.history }} 张
          </span>
        </div>
        <ApprovalFilterBar :dirty="historyDirty" :filters="historyFilters" :options="historyOptions"
          :select-keys="['statusText', 'approver', '主MODEL']" :select-labels="{ approver: '最后办理人' }"
          @apply="applyHistoryFilters" @patch="patchHistoryFilters" @reset="resetHistoryFilters" />
        <v-divider />
        <v-data-table v-model:page="historyPage" border class="text-[12px] mine-table" density="compact" fixed-footer
          fixed-header :headers="historyHeaders" hover :items="historyFilteredRows" :items-per-page="historyPerPage"
          :loading="tabLoading" striped="odd" @click:row="handleRowClick">
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
          <!-- 页脚只留一条紧凑分页 -->
          <template #bottom>
            <div class="d-flex justify-center">
              <v-pagination v-model="historyPage" :length="historyPageCount" size="small" :total-visible="7" />
            </div>
          </template>
        </v-data-table>
      </v-sheet>
      <!-- 待办 / 已审批 / 抄送我的 / 我发起的：卡片列表 -->
      <v-sheet v-else class="mine-card-col d-flex flex-column  overflow-hidden bg-transparent py-2">
        <div class="d-flex align-center justify-space-between px-3 pt-2">
          <span class="text-[13px]">{{ activeTabText }}</span>
          <div>
            <span class="text-[12px] text-medium-emphasis mr-2">共 {{ cardRows.length }} 张</span>
            <v-icon-btn :title="sortTitle" class="sort-btn" size="small" variant="text" @click="toggleSort">
              <v-icon size="18">
                {{ sortOrder === 'desc' ? 'mdi-sort-ascending' : 'mdi-sort-descending' }}
              </v-icon>
            </v-icon-btn>
          </div>
        </div>
        <!-- 取数中：一条细进度条（卡片区没有表格那种遮罩，空了会像"没有单"） -->
        <v-progress-linear v-if="tabLoading" class="mt-1" color="primary" height="2" indeterminate />
        <div class="order-list overflow-y-auto pa-2">
          <v-card v-for="row in cardRows" :key="row.id" class="order-card" variant="flat"
            :class="{ 'order-card--active': row.id === selectedNode?.id }" rounded="lg" @click="selectRow(row)">
            <v-card-title class="order-card__head d-flex align-start justify-space-between">
              <span class="order-card__title">{{ row.order_no }}</span>
              <v-chip class="order-card__status" :color="row.statusColor" label size="x-small">
                {{ row.statusText }}
              </v-chip>
            </v-card-title>
            <v-card-text class="order-card__body">
              <div class="d-flex align-center ga-2">
                <v-avatar :color="row.statusColor" size="20" variant="tonal">
                  <v-img v-if="avatarOf(row)" alt="" cover :src="avatarOf(row)" @error="onAvatarError(row)" />
                  <span v-else class="text-[10px] font-bold">{{ initialOf(row.approver) }}</span>
                </v-avatar>
                <span class="text-[12px]">{{ row.approver }}</span>
                <span class="text-[11px] text-medium-emphasis ellipsis">{{ row.ownerDept }}</span>
              </div>
              <div class="mt-1.5 text-[12px] d-flex flex-column ga-0.5">
                <span class="ellipsis">SKU：{{ row.sku }}</span>
                <span class="ellipsis">主MODEL：{{ row.主MODEL }}</span>
              </div>
            </v-card-text>
            <v-card-actions class="d-flex justify-space-between text-[11px]">
              <v-chip :color="row.processColor" label size="x-small" variant="text">
                {{ tab === 'pending' ? `已等待 ${row.duration}` : `历时 ${row.duration}` }}
              </v-chip>
              <span class="text-medium-emphasis">{{ formatDate(row.created) }}</span>
            </v-card-actions>
          </v-card>

          <div v-if="!tabLoading && cardRows.length === 0" class="empty-hint d-flex flex-column align-center justify-center">
            <v-icon color="medium-emphasis" size="36">mdi-inbox-outline</v-icon>
            <span class="text-[12px] text-medium-emphasis mt-2">{{ emptyText }}</span>
          </div>
        </div>
      </v-sheet>
      <!-- ==================== 右：审批流程面板 ==================== -->
      <v-sheet v-if="showDetail" class="mine-detail min-w-0" :class="{ 'mine-detail--fixed': tab === 'history' }"
        rounded="15">
        <ApprovalDetailView :closable="tab === 'history'" :has-next="hasNextStep" :has-prev="hasPrevStep"
          :index="selectedIndex + 1" :order="selectedOrder" :readonly="tab === 'history'" :total="activeRows.length"
          @close="closeDetail" @next="nextStep" @prev="backStep" @select="handleSelect" @submit="onDrawerSubmit" />
      </v-sheet>
    </div>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="3000" variant="tonal">
      {{ snackbar.text }}
    </v-snackbar>
  </v-container>
</template>

<script setup lang="ts">
// 按档取数：判据在服务端（见 utils/… 与 server/mineOrders.ts），这里只负责调度与渲染
import { type DeleteOrderSummary, fetchMineOrders } from '@/api/api'
import type { ApprovalOrder, NodeSubmitPayload } from '@/types/approval'
// 右侧「审批详情」：与首页抽屉共用同一个组件（信息 + 流程时间线 + 办理入口）
import ApprovalDetailView from '@/components/approval/ApprovalDetailView.vue'
// 筛选条（搜索 / 下拉 / 日期 / 确认 / 重置）：与首页两张表共用同一个组件
import ApprovalFilterBar from '@/components/ApprovalFilterBar.vue'
// 操作栏的「删除审批单」：按钮内置权限判断与确认框（与 home.vue 共用同一个组件）
import DeleteOrderButton from '@/components/DeleteOrderButton.vue'
import { useApprovalSelect } from '@/composables/useApprovalSelect'
// 环节办理的落库逻辑与审批页共用同一份（原先这里只关弹窗+跳页，用户填的内容被丢弃）
import { useNodeSubmit } from '@/composables/useNodeSubmit'
// 头像目录：单据快照里不存成员头像，展示时按 open_id / email 现查（见该 store 的文件头）
import { useAvatarDirectory } from '@/stores/avatarDirectory'
// 头像地址的逐级降级（代理 → 原地址 → 首字）：与时间线同一份实现
import { useAvatarSrc } from '@/composables/useAvatarSrc'
// 登录者（审批链成员的形状）：三档"我的单"都拿它跟链上成员比（见 orderPendingOn / orderCcTo）
import { useUserStore } from '@/stores/user'
import { APPROVAL_STATUS } from '@/types/approval'
/*
 * 展示状态（未审批 / 审批中 / 待定 / 通过 / 驳回）与首页表格共用同一份派生口径；
 * 筛选（选项推导 / 应用条件 / 等价比较）也共用同一份 —— 表格板块的筛选条走的就是这些。
 */
import {
  applyApprovalFilters,
  applyFilterPatch,
  APPROVAL_STAGE_META,
  type ApprovalStage,
  approvalStageOf,
  createApprovalFilters,
  filterOptions,
  type FilterPatch,
  filtersEqual,
  isoDay,
  resetApprovalFilters,
  SELECT_FILTERS,
  type SelectFilterKey,
  toCellText,
} from '@/utils/approvalFilters'
// 条件求值上下文（建单快照优先）：业务字段取快照值，与流程引擎同源
import { flowContextOfOrder } from '@/utils/approvalFlow'
/*
 * 「进度」列（正常 / 超时 / 滞留）：判据是"这一环等了几个工作日小时"。
 * 纯函数模块 —— 阈值的来源（提醒设置里的超时阈值）由本页读出来后传进去，见下方 pushRules。
 */
import {
  APPROVAL_PROGRESS_META,
  type ApprovalProgress,
  approvalProgressDetail,
  approvalProgressOf,
} from '@/utils/approvalProgress'
import {
  lastHandledOf,
  mainOf,
  runtimeOf,
  stepStartTimesOf,
} from '@/utils/approvalRuntime'
// PB 的 bi_rows 记录（含 data 快照）→ 界面用的中文 key 产品对象
import { toProductView } from '@/utils/biRowFields'
// 推送规则（只为了拿「超时阈值」）：与提醒设置、超时跑批同源，读不到就用默认规则
import { DEFAULT_PUSH_RULES, type PushRules } from '@/utils/pushRules'
import { loadPushRules } from '@/utils/pushRulesStore'
import { formatDate, formatTimeDiff } from '@/utils/utils'
// 工作日小时（周末不计）：与服务端超时跑批**共用同一份**实现
import { workingHoursBetween } from '@/utils/workingHours'

const router = useRouter()
const userStore = useUserStore()
/*
 * 登录者的 open_id / email / name 不在这里比对了 —— 四档归类都在服务端算
 * （server/mineOrders.ts 用同一个 useUserStore.member 口径的成员对象）。
 * 页面只用到 isLoggedIn 决定要不要发请求、以及空态文案。
 */

/*
 * 左栏的五个分类。值即状态，模板里据此决定中栏渲染卡片还是表格。
 * 「所有审批单」保持原来的表格形态（筛选条 / 分页 / 删除都在，内部键沿用 history），
 * 其余四档用卡片列表 —— 「已审批」与「待办」同一套形态（点卡片右栏看流程）。
 */
type MineTab = 'pending' | 'approved' | 'cc' | 'created' | 'history'
const tab = ref<MineTab>('pending')

interface ApprovalRow {
  id: string
  order_no: string
  status: number
  /** 展示状态**取值** 0..6（未审批/审批中/待定/通过/驳回/已接收/异常，见 utils/approvalFilters） */
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
   * 本页不显示这一列，但**必须有**：表格板块的筛选走的是共享实现
   * （utils/approvalFilters 的 applyApprovalFilters），而它要求行满足 FilterableRow ——
   * 少了这个字段，整行只能在类型上退化，模板里连 item.statusColor 都取不到。
   */
  平台: string
  /**
   * 「进度」列：这一单在**当前环节**已经压了多久 → 正常 / 超时 / 滞留
   * （判据与阈值见 utils/approvalProgress）。
   */
  processStage: ApprovalProgress
  processText: string
  processColor: string
  /** 进度单元格的悬浮说明（等了多久、对着哪个阈值、会不会发提醒） */
  processDetail: string
  /** 卡片标题：产品名称 → 主MODEL → 单号（卡片上最醒目的那一行） */
  title: string
  /** 卡片上那个人（当前审批人 / 最后办理人）的部门 */
  ownerDept: string
  /**
   * 卡片头像要用的「人」：只留认人用的 open_id / email（老单的成员自带 avatar，一并带上）。
   * 新单快照里**不存头像**（见 types/approval 的 slimFlowMembers），展示时用这两个键去头像目录现查
   * （stores/avatarDirectory 的 avatarOf）—— 与时间线里的成员头像同一口径。
   */
  owner: { open_id?: string, email?: string, avatar?: string } | null
}

/** 与审批页同一套口径：有 flow 就按 flow + decisions 重算，旧单（只有 chain、没有 flow）原样沿用 */
function toRow(order: ApprovalOrder): ApprovalRow {
  const p = toProductView(order.expand?.relation)
  const rt = runtimeOf(order)
  // 业务字段取**建单时的快照**（与首页表格、条件求值同一口径；旧单没有快照就是 '—'）
  const ctx = flowContextOfOrder(order)

  const owner = rt.currentStep >= 0 ? mainOf(rt.chain[rt.currentStep]) : lastHandledOf(rt.chain)
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
   * 计时起点用 stepStartTimesOf（与表格「审批时长」、时间线里每步耗时同一套口径）。
   */
  const starts = stepStartTimesOf(order, rt.chain)
  const startedAt = rt.currentStep >= 0 ? starts[rt.currentStep] : ''
  const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN
  const waitingHours = Number.isFinite(startedMs)
    ? workingHoursBetween(new Date(startedMs), new Date())
    : 0
  const processStage = approvalProgressOf(waitingHours, pushRules.value.overdueHours)
  const processMeta = APPROVAL_PROGRESS_META[processStage]
  const productName = String(p['产品名称'] ?? '').trim()
  const model = String(p['主MODEL'] ?? '—')
  return {
    id: order.id,
    order_no: order.order_no ?? order.id,
    status: Number(order.status ?? APPROVAL_STATUS.PENDING),
    statusStage,
    statusText: stageMeta.text,
    statusColor: stageMeta.color,
    sku: String(p.SKU ?? p['库存SKU'] ?? '—'),
    主MODEL: model,
    部门: String(p['部门'] ?? '—'),
    approver: owner?.name ?? '—',
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
    // 卡片标题：业务上有产品名就用它，其次型号，都没有才退到单号（不至于出现一张没有标题的卡）
    title: productName || (model === '—' ? (order.order_no ?? order.id) : model),
    ownerDept: owner?.department || String(p['部门'] ?? '') || '—',
    owner: owner ? { open_id: owner.open_id, email: owner.email, avatar: owner.avatar } : null,
  }
}

/*
 * ==================== 按档懒加载 ====================
 *
 * 进页面只取「待办」，切到哪一档才取哪一档（每档第一次进才请求，之后用缓存）。
 *
 * 为什么不再"一次拉全量再本地筛"：四档的判据都要按 flow + decisions 重算链路，
 * 意味着每次进页面都要把**所有**审批单（每条带完整流程快照）拉进浏览器再跑一遍。
 * 现在判据挪到服务端（server/mineOrders.ts，复用同一套纯函数），浏览器每次只拿当前这一档。
 *
 * 左栏角标要显示五档条数，所以服务端每次把五档数量一起返回（它反正要全部算一遍）。
 */
const TAB_KEYS: MineTab[] = ['pending', 'approved', 'cc', 'created', 'history']

/** 每档的整单（服务端返回的原始单据） */
const tabOrders = reactive<Record<MineTab, ApprovalOrder[]>>({
  pending: [],
  approved: [],
  cc: [],
  created: [],
  history: [],
})

/** 每档的条数（服务端算的，与列表同源；不要用 tabOrders[x].length 代替 —— 没加载过的档是 0） */
const tabCounts = reactive<Record<MineTab, number>>({
  pending: 0,
  approved: 0,
  cc: 0,
  created: 0,
  history: 0,
})

/**
 * 这一档**取过没有**。
 * 必须单独记：空数组既可能是"还没请求"，也可能是"请求过、确实没有单" ——
 * 只用 length 判断会让空档每次切回来都重新请求一次。
 */
const tabLoaded = reactive<Record<MineTab, boolean>>({
  pending: false,
  approved: false,
  cc: false,
  created: false,
  history: false,
})

/** 当前档正在取数（表格 / 卡片列表的加载态） */
const tabLoading = ref(false)

/**
 * 取一档数据。
 *
 * @param force true = 无视缓存重新取（刷新按钮、办完单、删单之后用）
 *
 * 未登录直接跳过（服务端会 401）：登录态由 watch 兜住，登录后会自动补一次。
 */
async function loadTab(target: MineTab, force = false) {
  if (!userStore.isLoggedIn) {
    return
  }
  if (!force && tabLoaded[target]) {
    return
  }
  tabLoading.value = true
  try {
    const res = await fetchMineOrders(target)
    tabOrders[target] = res.rows
    Object.assign(tabCounts, res.counts)
    tabLoaded[target] = true
  } catch (error) {
    // 失败必须说出来：静默的话卡片区就是一片空白，看着像"我没有待办"
    console.error('[mine] 读取失败:', error)
    showMsg(error instanceof Error ? error.message : '读取失败，请稍后重试', 'error')
  } finally {
    tabLoading.value = false
  }
}

/**
 * 「超时阈值」的来源：与「提醒设置」的推送规则**同源** —— 那边把阈值改成 24，
 * 进度列的"超时"跟着提前（滞留那档是白板写死的 5 个工作日，不随它变）。
 * 它是 ref，规则到位后各行会自己重算（toRow 读的就是它）。
 */
const pushRules = ref<PushRules>({ ...DEFAULT_PUSH_RULES })

/** 拉一次推送规则（只为进度列的超时阈值；loadPushRules 读失败会回落默认规则，不会抛） */
async function loadProgressRules() {
  pushRules.value = (await loadPushRules()).rules
}

/* ==================== 各档的行（由已加载的单据派生） ==================== */

/**
 * 每档的行。
 *
 * 放 computed 而不是取回数据时就转好：toRow 依赖 `pushRules`（超时阈值），
 * 阈值一改（提醒设置里调过）进度列的"超时"要立刻跟着变，缓存成数组就变不了。
 * 各档的行数本来就小（只有当前页用到的那些单），重算一次可以忽略。
 */
const rowsByTab = computed<Record<MineTab, ApprovalRow[]>>(() => ({
  pending: tabOrders.pending.map(o => toRow(o)),
  approved: tabOrders.approved.map(o => toRow(o)),
  cc: tabOrders.cc.map(o => toRow(o)),
  created: tabOrders.created.map(o => toRow(o)),
  history: tabOrders.history.map(o => toRow(o)),
}))

/**
 * 所有审批单：**全部单**，不按"我经手过"过滤（那是「已审批」的口径）。
 * 命名沿用 history（这一档就是原来那张表，筛选条 / 分页 / 删除都在）。
 */
const historyRows = computed(() => rowsByTab.value.history)

/** 左栏的五个分类（文案 / 图标 / 计数）—— 计数来自服务端，没加载过的档也有值 */
const tabItems = computed(() => [
  { value: 'pending' as const, text: '待办', icon: 'mdi-inbox-arrow-down-outline', count: tabCounts.pending },
  { value: 'approved' as const, text: '已审批', icon: 'mdi-clipboard-check-outline', count: tabCounts.approved },
  { value: 'cc' as const, text: '抄送我的', icon: 'mdi-email-outline', count: tabCounts.cc },
  { value: 'created' as const, text: '我发起的', icon: 'mdi-send-outline', count: tabCounts.created },
  { value: 'history' as const, text: '所有审批单', icon: 'mdi-clipboard-list-outline', count: tabCounts.history },
])

const activeTabText = computed(() => tabItems.value.find(t => t.value === tab.value)?.text ?? '')

const emptyText = computed(() => {
  if (!userStore.isLoggedIn) {
    return '登录后可以看到你名下的审批单'
  }
  if (tab.value === 'approved') {
    return '还没有你审批过的单（办过的单会出现在这里）'
  }
  if (tab.value === 'cc') {
    return '还没有抄送给你的审批单'
  }
  if (tab.value === 'created') {
    return '还没有你发起的审批单（发起后才会出现在这里）'
  }
  return '当前没有待办，先歇一会儿'
})

/* ==================== 卡片列表的搜索 / 时间筛选 / 排序 ==================== */

const keyword = ref('')

type SortOrder = 'desc' | 'asc'

/** 排序方向：图标按钮切换（desc = 最新优先，asc = 最早优先） */
const sortOrder = ref<SortOrder>('desc')

/** 排序按钮的悬浮说明：写清楚"现在是哪种、点了会变成哪种" */
const sortTitle = computed(() =>
  sortOrder.value === 'desc'
    ? '当前：最新优先，点击改为最早优先'
    : '当前：最早优先，点击改为最新优先',
)

function toggleSort() {
  sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
}

/**
 * 建单日期筛选（v-date-input 的 range 模型：Date 或 'YYYY-MM-DD…' 都可能给）。
 * 与历史表格那边的日期筛选（utils/approvalFilters 的 applyApprovalFilters）**同一口径**：
 * 取 created 的**前 10 位**（日期）比字典序 —— 解析成 Date 再比会被时区把"当天"算到前一天；
 * 只选了一个端点时视为"那一天"。
 */
const dateRange = ref<(Date | string)[]>([])

const dayRange = computed(() => {
  const first = dateRange.value[0]
  const last = dateRange.value.at(-1)
  const from = first ? isoDay(first) : ''
  const to = last ? isoDay(last) : from
  return { from, to }
})

/** 当前 tab 对应的完整行集（还未叠搜索 / 时间条件） */
const baseRows = computed(() => {
  // 表格（history）不走这里；其余四档就是服务端刚返回的那一档
  return rowsByTab.value[tab.value]
})

/**
 * 中栏卡片列表：按当前 tab 取行 → 叠搜索 / 时间条件 → 按创建时间排序。
 * 排序在筛选之后做（先筛后排，`n/m` 与上/下一条才和眼前看到的顺序一致）。
 */
const cardRows = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  const { from, to } = dayRange.value

  const list = baseRows.value.filter(r => {
    // created 前 10 位就是日期，直接与区间端点比字典序（见 dayRange 的说明）
    const day = String(r.created).slice(0, 10)
    if (from && day < from) {
      return false
    }
    if (to && day > to) {
      return false
    }
    if (!kw) {
      return true
    }
    return `${r.order_no} ${r.title} ${r.sku} ${r.主MODEL} ${r.部门} ${r.approver}`.toLowerCase().includes(kw)
  })

  // ISO 时间串按字典序即时间序；复制一份再排，别就地改 baseRows 的数组
  return [...list].sort((a, b) => (sortOrder.value === 'asc'
    ? String(a.created).localeCompare(String(b.created))
    : String(b.created).localeCompare(String(a.created))))
})

/** 当前在看的列表（上/下一条、自动选中都按它算）：卡片模式是卡片行，表格模式是表格行 */
const activeRows = computed(() =>
  tab.value === 'history' ? historyFilteredRows.value : cardRows.value,
)

/* ==================== 选中 / 上一条 / 下一条 ==================== */

/** 选中的那一行（右栏显示的就是它的流程） */
const selectedNode = ref<ApprovalRow | null>(null)

/**
 * 选中行对应的原始单据（时间线要用它重算链路）。
 * 只在**当前档**里找：同一张单可能同时出现在别的档（如「抄送我的」与「所有审批单」），
 * 但右栏显示的必须是眼前这一档的那张。
 */
const selectedOrder = computed(() => {
  const id = selectedNode.value?.id
  if (!id) {
    return null
  }
  return tabOrders[tab.value].find(o => o.id === id) ?? null
})

/** 表格模式（所有审批单）必须有选中才显示右栏；卡片模式常驻（没有选中时显示空态） */
const showDetail = computed(() => tab.value !== 'history' || !!selectedNode.value)

const selectedIndex = computed(() =>
  selectedNode.value ? activeRows.value.findIndex(r => r.id === selectedNode.value?.id) : -1,
)
const hasPrevStep = computed(() => selectedIndex.value > 0)
const hasNextStep = computed(() =>
  selectedIndex.value >= 0 && selectedIndex.value < activeRows.value.length - 1,
)

function switchTab(value: MineTab) {
  tab.value = value
  // 第一次进这一档才请求；已经取过的直接复用缓存
  void loadTab(value)
}

function selectRow(row: ApprovalRow) {
  selectedNode.value = row
}

function closeDetail() {
  selectedNode.value = null
}

function backStep() {
  if (hasPrevStep.value) {
    selectedNode.value = activeRows.value[selectedIndex.value - 1] ?? null
  }
}

function nextStep() {
  if (hasNextStep.value) {
    selectedNode.value = activeRows.value[selectedIndex.value + 1] ?? null
  }
}

/** 表格（所有审批单）点行：打开右栏（表格仍然在左边） */
function handleRowClick(_event: Event, { item }: { item: ApprovalRow }) {
  selectedNode.value = item
}

function goApproval(row?: ApprovalRow | null) {
  const no = row?.order_no ?? selectedNode.value?.order_no
  router.push({ path: '/approvalPage', query: no ? { order_no: no } : {} })
}

/** 姓名首字：卡片头像没有图时用它（中文取第一个字，英文取首字母） */
function initialOf(name?: string) {
  const n = String(name ?? '').trim()
  return n ? n.slice(0, 1).toUpperCase() : '?'
}

/*
 * 卡片上的头像：按 open_id / email 到**头像目录**里现查（快照里不存头像，见 stores/avatarDirectory）。
 * 地址本身与时间线里的成员头像走同一套规则（utils/avatar + useAvatarSrc）：
 *   代理优先 → 原始签名地址兜底 → 都失败才退回首字。
 */
const avatarDir = useAvatarDirectory()
const avatarSrc = useAvatarSrc()
/** 这一行的原始头像地址（老单自带 avatar 直显；新单按 open_id / email 现查） */
function avatarRawOf(row: ApprovalRow) {
  return row.owner?.avatar || avatarDir.avatarOf(row.owner)
}
function avatarOf(row: ApprovalRow) {
  return avatarSrc.srcOf(avatarRawOf(row))
}
function onAvatarError(row: ApprovalRow) {
  avatarSrc.onError(avatarRawOf(row))
}

/* ==================== 所有审批单（表格 + 筛选） ==================== */

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

/** 所有审批单板块展示的行 = 全部单 ∩ 生效条件 */
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

/*
 * 当前表的列：**不摆「审批结论」**（单还没办结，整列都是 '—'）也**不摆「当前审批人」**
 * （这一页的当前单本就都压在我手上，那一列每行都是同一个名字）。
 * 表格（所有审批单）才摆它们（见 historyHeaders）。
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

/**
 * 表格板块的表头：由当前表的列**派生**（列顺序只写一处），比它多两列 ——
 *   · 「最后办理人」（插在「主MODEL」之后）；
 *   · 「审批结论」（插在「状态」之后）。
 */
const historyHeaders = computed(() => {
  // 「进度」讲的是"这一环压在我手上多久" —— 已办结的单没有这一说，先剔掉再补历史表自己的两列
  const list = headers.value.filter(h => h.key !== 'process').map(h => ({ ...h }))
  const atModel = list.findIndex(h => h.key === '主MODEL')
  const withApprover = atModel === -1
    ? [{ title: '最后办理人', key: 'approver' }, ...list]
    : [...list.slice(0, atModel + 1), { title: '最后办理人', key: 'approver' }, ...list.slice(atModel + 1)]
  const atStatus = withApprover.findIndex(h => h.key === 'status')
  return atStatus === -1
    ? [...withApprover, { title: '审批结论', key: 'conclusion' }]
    : [
      ...withApprover.slice(0, atStatus + 1),
      { title: '审批结论', key: 'conclusion' },
      ...withApprover.slice(atStatus + 1),
    ]
})

/**
 * 卡片模式下自动选中第一张 —— 进页面（或切 tab）时右栏就有内容，不用先点一下。
 *
 * 数据刷新后也走这里：选中行还在就换成**新的行对象**（否则右栏读的仍是旧快照），
 * 不在了（被筛掉 / 被删）才退回第一张。
 */
watch(activeRows, list => {
  if (tab.value === 'history') {
    return
  }
  const current = selectedNode.value
  const next = current ? list.find(r => r.id === current.id) : undefined
  if (next) {
    if (next !== current) {
      selectedNode.value = next
    }
    return
  }
  selectedNode.value = list[0] ?? null
}, { immediate: true })

/** 切 tab：所有审批单默认不选中（保持全宽表格）；其它四档选中第一张 */
watch(tab, value => {
  if (value === 'history') {
    selectedNode.value = null
    return
  }
  selectedNode.value = activeRows.value[0] ?? null
})

/* ==================== 提交 / 抄送转办 / 删除 ==================== */

const snackbar = ref<{ show: boolean, text: string, color: string }>({ show: false, text: '', color: 'success' })
function showMsg(text: string, color: 'success' | 'error' | 'warning' = 'success') {
  snackbar.value = { show: true, text, color }
}

/**
 * 提交 / 抄送后的回填。
 *
 * 两件事都要做：
 *   ① 已加载的每一档里，把这条单换成新快照（右栏时间线读的是它）；
 *   ② **重取当前档**：办完之后它的归属可能变了（待办 → 已审批），
 *      只改本地数组的话，它会赖在「待办」里直到手动刷新，左栏角标也是旧的。
 */
function onOrderUpdated(updated: ApprovalOrder) {
  for (const key of TAB_KEYS) {
    const i = tabOrders[key].findIndex(o => o.id === updated.id)
    if (i >= 0) {
      tabOrders[key][i] = { ...tabOrders[key][i], ...updated }
    }
  }
  void loadTab(tab.value, true)
}

const { submitNode } = useNodeSubmit({
  order: selectedOrder,
  onMessage: showMsg,
  onUpdated: onOrderUpdated,
})

/**
 * 抄送 / 转办：落库逻辑在 composables/useApprovalSelect.ts（与审批页同一份）。
 * 回填口径与提交一致 —— 必须更新**列表里那条**，右栏的时间线才会跟着变。
 */
const { handleSelect } = useApprovalSelect({
  order: selectedOrder,
  chain: computed(() => (selectedOrder.value ? runtimeOf(selectedOrder.value).chain : [])),
  stepIds: computed(() => (selectedOrder.value ? runtimeOf(selectedOrder.value).stepIds : [])),
  currentStep: computed(() => (selectedOrder.value ? runtimeOf(selectedOrder.value).currentStep : -1)),
  onMessage: showMsg,
  onUpdated: onOrderUpdated,
})

function onDrawerSubmit(payload: NodeSubmitPayload) {
  void submitNode(payload)
}

async function onOrderDeleted(summary: DeleteOrderSummary) {
  if (selectedNode.value?.id === summary.id) {
    selectedNode.value = null
  }
  await getDatas()
  // deleted = false 表示它之前就已经不在了（服务端按幂等处理）——提示如实说
  showMsg(summary.deleted ? '审批单已删除' : '该审批单已经不在了，列表已刷新', summary.deleted ? 'success' : 'warning')
}

/** 删除失败（多为权限或网络）：把服务端给的原因原样弹出来 */
function onDeleteFailed(message: string) {
  showMsg(message, 'error')
}

/** 刷新当前档（右上角的刷新按钮；各档缓存在切 tab 时自然复用） */
async function getDatas() {
  await loadTab(tab.value, true)
}

/*
 * 登录态到位后再补一次：首屏挂载时 userStore 可能还没 init 完（isLoggedIn 为 false），
 * loadTab 会直接跳过 —— 不兜这一下，页面就停在"空列表"上，除非手动点刷新。
 */
watch(() => userStore.isLoggedIn, ok => {
  if (ok && !tabLoaded[tab.value]) {
    void loadTab(tab.value)
  }
})

onMounted(() => {
  // 进页面只取「待办」，其余四档等切过去再取
  void loadTab(tab.value)
  // 进度列的「超时阈值」来自提醒设置：拉一次（失败回落默认规则，不影响列表）
  void loadProgressRules()
  // 卡片头像：拉一次通讯录缓存（幂等；失败只告警，头像退回首字，不影响列表）
  void avatarDir.ensure()
})
</script>

<style lang="scss" scoped>
/* 整页高度锁死：三栏各自滚动，页面本身不滚（与首页 h-[calc(100vh-80px)] 同一口径） */
.mine-rail {
  flex: 0 0 300px;
  min-width: 0;
  overflow-y: auto;
}

.mine-main {
  flex: 1 1 auto;
  min-width: 0;
}

/* 卡片模式：中栏定宽，右栏吃掉剩下空间 */
.mine-card-col {
  flex: 0 0 380px;
  min-width: 0;
}

/* 表格模式（所有审批单）：表格吃掉剩下空间；右栏出现时单独定宽，不去挤表格的可读宽度 */
.mine-table-col {
  flex: 1 1 auto;
  min-width: 0;
}

/*
 * 卡片模式（待办 / 已审批 / 抄送 / 我发起的）的右栏：吃掉中栏之外剩下的全部宽度。
 *
 * min-width 较宽（480px）：时间线一行里要并排放姓名 + 结论 + 意见 + 时间，
 * 再窄就会折成两三行（见 ApprovalDetailView 的 .detail-body）。它只是**下限**，
 * 窗口宽时右栏还会继续变宽，不会停在这里。
 */
.mine-detail {
  flex: 1 1 0;
  min-width: 480px;
  /* 圆角裁切 + 内容滚动交给内部（见 ApprovalDetailView 的 .detail-body） */
  overflow: hidden;
}

/*
 * 表格板块点开的详情：表格与右栏要分宽度，所以这里给一档**固定基准**（不是吃剩余空间）。
 *
 * 数值的取法：clamp 的下限 520px 是"不折行"的底线，上限 760px 是"再宽时间线也不会更好读"；
 * 中间按 42% 随窗口平滑过渡 —— 宽屏（≥1810）拿到 760px，窄屏（≤1240）保底 520px，
 * 既让详情看得清，也不会把左边的表格压得只剩几列。
 */
.mine-detail--fixed {
  flex: 0 0 clamp(520px, 42%, 760px);
}

/* 窄一点的窗口（笔记本外接小屏）把中间那一栏收一点，别把右栏挤没 */
@media (max-width: 1500px) {
  .mine-card-col {
    flex-basis: 340px;
  }
}

.mine-tab {
  min-height: 34px;
}

.rail-count {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}

/*
 * 卡片列表：吃掉「中栏高度 − 页头」剩下的部分自己滚。
 * flex 必须写在 CSS 里 —— 模板上的 flex-1-1-auto 不是有效的 UnoCSS 类名（只认 flex-1 / flex-auto），
 * 之前等于没设，列表不滚，超出部分直接被外层的 overflow-hidden 裁掉。
 */
.order-list {
  flex: 1 1 auto;
  min-height: 0;
}

/*
 * 圆角交给 v-card 的 rounded="lg"；内边距统一放在卡片上，
 * 标题 / 正文 / 页脚三块都清零（v-card-title 默认 .5rem 1rem、v-card-text 默认 1rem），
 * 这样三段的左右边界一定对齐 —— 靠工具类覆盖会跟 UnoCSS 的优先级打架。
 */
.order-card {
  /*
   * 常驻 1px 透明描边：hover 时只换颜色，卡片不会因为"凭空多出一条边框"而抖动；
   * 底色交给 v-card（variant="flat"），这里不重复设 background。
   */
  border: 1px solid transparent;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.order-card+.order-card {
  margin-top: 8px;
}

/*
 * hover 的蓝色边缘：1px 描边 + 一圈同色外发光。
 * 只改 border-color 在浅底上太细，看不出"边缘蓝"；外发光把轮廓加粗到 2px 的观感，
 * 又不会像真加粗边框那样挤压内容。颜色取主题主色，深色模式下自动跟着变。
 */
.order-card:hover {
  border-color: rgb(var(--v-theme-primary), 0.05);
  box-shadow: 0 0 0 1px rgb(var(--v-theme-primary), 0.5), 0 2px 10px rgba(var(--v-theme-primary), 0.18);
}

/*
 * 选中态：左侧一条主色 + 同色描边，与右栏"正在看哪一张"对上。
 * 同时写上 :hover 版本 —— 否则选中卡片被 hover 时的规则覆盖，蓝边会闪回默认色。
 */
.order-card--active,
.order-card--active:hover {
  border-color: rgb(var(--v-theme-primary), 0.8);
  box-shadow: inset 3px 0 0 rgb(var(--v-theme-primary), 0.8), 0 0 0 1px rgb(var(--v-theme-primary), 0.8);
}

/*
 * v-card-title 默认是 white-space: nowrap + text-overflow: ellipsis（只能单行，且会被裁掉），
 * 而这里要「标题最多两行、右侧状态始终正常显示」，三条缺一不可：
 *   ① 容器复位 white-space / overflow —— 否则 nowrap 被标题继承，永远只有一行；
 *   ② 标题 flex: 1 + min-width: 0 —— flex 子项默认 min-width:auto，不归零就压不窄，line-clamp 不生效；
 *   ③ 状态 flex: 0 0 auto —— 不参与压缩，标题换行时仍贴住右上角。
 */
.order-card__head {
  /* 复位 v-card-title 自带的标题字号 / 行高 / 内边距：这里只当布局容器用 */
  font-size: inherit;
  font-weight: inherit;
  line-height: inherit;
  letter-spacing: inherit;
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
}

/* v-card-text 默认 padding: 1rem —— 清掉，卡片自己的内边距已经够了 */
.order-card__body {
  /* 默认 0.875rem 字号会被下面各行的 text-[12px] 覆盖，这里只保证不额外缩进 */
  font-size: inherit;
  padding-bottom: 0;
}

.order-card__title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 15px;
  font-weight: 500;
  line-height: 1.35;
  /* 两行以内：标题过长时截断，卡片高度才整齐 */
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  /* 长型号 / 无空格英文也能断行，否则截不出第二行 */
  overflow-wrap: anywhere;
}

.order-card__status {
  flex: 0 0 auto;
  /* 标题两行时状态仍与第一行对齐 */
  margin-top: 1px;
}

.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty-hint {
  height: 100%;
  min-height: 180px;
}

/* 日历区间选择器吃掉整行，排序按钮固定宽 */
.date-filter {
  flex: 1 1 auto;
  min-width: 0;
}

.sort-btn {
  flex: 0 0 auto;
}

.mine-table {
  flex: 1 1 auto;
  min-height: 0;
}

.mine-table :deep(.v-data-table-footer) {
  padding-block: 2px;
}
</style>
