<template>
  <!--
    审批详情视图：首页抽屉、我的审批单右栏共用同一个组件。

    结构固定为「头部（状态 + 上/下一条 + 操作） / 滚动内容（单据信息 + 时间线） / 底部办理栏」，
    靠内部 flex 撑开：内容区 flex:1 自己滚，办理栏永远贴底。外层只负责给宽高和描边
    （首页是 v-navigation-drawer，我的审批单是 v-sheet），这里不画外框。
  -->
  <div class="approval-detail-view d-flex flex-column">
    <div class="detail-head d-flex align-center ga-2 px-3 py-2">
      <span class="text-[14px] font-bold">审批详情</span>
      <v-chip v-if="statusMeta && order" :color="statusMeta.color" label size="x-small">
        {{ statusMeta.text }}
      </v-chip>
      <v-spacer />
      <v-btn v-if="order" size="small" variant="text" @click="goApproval">
        <span class="text-[12px]">打开审批页</span>
      </v-btn>
      <v-icon-btn v-if="closable" size="x-small" title="关闭" variant="text" @click="emit('close')">
        <v-icon size="18">mdi-close</v-icon>
      </v-icon-btn>
    </div>
    <v-divider />
    <!-- 没有选中单：我的审批单的卡片模式常驻右栏，没选中时留一块空态，避免整块消失导致布局跳动 -->
    <div v-if="!order" class="detail-empty d-flex flex-column align-center justify-center">
      <v-icon color="medium-emphasis" size="44">mdi-clipboard-text-clock-outline</v-icon>
      <span class="text-[13px] text-medium-emphasis mt-2">选择一张审批单，查看审批流程</span>
    </div>

    <template v-else>
      <div class="detail-body px-3 pb-2">
        <!--
          单据信息：每行「key 左 / value 右」两端对齐。
          上/下一条挪到**单号这一行**里（单号旁边），并带上 n/总数 —— 切换的是同一列表里的相邻单，
          放在单号旁边比挂在整个面板头部更贴近它作用的对象。
        -->
        <div class="info-list">
          <div class="info-row">
            <span class="info-key">审批单号:</span>

            <div class="d-flex align-center ga-1 min-w-0">
              <span class="info-value">{{ order.order_no ?? order.id }}</span>
              <v-icon-btn :disabled="!hasPrev" size="x-small" title="上一条" variant="text" @click="emit('prev')">
                <v-icon size="16">mdi-menu-left</v-icon>
              </v-icon-btn>
              <span v-if="positionText" class="info-index">{{ positionText }}</span>
              <v-icon-btn :disabled="!hasNext" size="x-small" title="下一条" variant="text" @click="emit('next')">
                <v-icon size="16">mdi-menu-right</v-icon>
              </v-icon-btn>
            </div>
          </div>

          <div class="info-row">
            <span class="info-key">当前审批人:</span>
            <span class="info-value">{{ approverName }}</span>
          </div>

          <div class="info-row">
            <span class="info-key">创建时间:</span>
            <span class="info-value">{{ formatDate(order.created) }}</span>
          </div>
        </div>

        <GoodsInfo :product="order.expand?.relation" />

        <div class="d-flex align-center ga-2 mt-1 mb-1">
          <span class="text-[13px] font-bold">审批流程</span>
          <v-chip label size="x-small" variant="tonal">{{ stepGroups.length }} 个环节</v-chip>
        </div>

        <div class="timeline-wrap rounded bg-app px-2 py-3">
          <v-timeline density="compact" side="end" truncate-line="both" width="100%">
            <!--
              时间线按**合并后的节点**渲染：同一审批人连续办理的相邻环节合成一条（见 groupApproverSteps），
              办理时把这一串动作连着办（办完自动接下一环）。
            -->
            <ApprovalNode v-for="(g, gi) in stepGroups" :key="`${order.id}-${g.stepIds[0] || gi}`"
              :allowed-options="optionItems[g.stepIds[0]]" :allowed-results="resultOptions[g.stepIds[0]]"
              :can-handle="g.indexes.includes(currentStep)" :data="g.steps[0]"
              :discard-segment-size="discardMarkOf(g, discardMarks)?.size" hide-handle
              :in-discard-segment="discardMarkOf(g, discardMarks)?.seq" :index="g.indexes[0]" :length="chain.length"
              :next-steps="nextStepsOf(g, optionItems, resultOptions)"
              :option-context="optionContextOf(order, chain, g.indexes[0])" :prev-time="g.startTimes[0]"
              :receiver-team="receiverTeam" :remaining-qty="remainingQty" :start-time="order.created"
              :stock-amount="stockAmount" :stock-qty="stockQty" :type-templates="order.chain?.types" />

            <!-- 时间线最后一条：流转为什么停下（与审批页同一口径） -->
            <FlowEndNote :end="flowEnd" />
          </v-timeline>
        </div>
      </div>

      <!-- 办理面板钉在底部：在滚动区之外，内容再长也始终可见 -->
      <div class="detail-dock">
        <HandleDock :chain="chain" :current-step="currentStep" :groups="stepGroups" mode="dialog"
          :option-items="optionItems" :order="order" :receiver-team="receiverTeam" :remaining-qty="remainingQty"
          :result-options="resultOptions" :stock-amount="stockAmount" :stock-qty="stockQty"
          @submit="payload => emit('submit', payload)">
          <!-- 抄送 / 转办：与审批页同一个组件、同一份落库逻辑（HandleDock 的 extra 槽） -->
          <template #extra>
            <SelectNode :disabled="readonly" @select="payload => emit('select', payload)" />
          </template>
        </HandleDock>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { UserBrief } from '@/api/api'
import type { ApprovalChainItem, ApprovalOrder, NodeSubmitPayload } from '@/types/approval'
import { useRouter } from 'vue-router'
// 办理面板：与审批页共用（内含 ApprovalHandleForm）
import HandleDock from '@/components/approval/HandleDock.vue'
import ApprovalNode from '@/components/ApprovalNode.vue'
// 时间线最后一条：流转为什么停下（见 types/approval 的 FlowEndInfo）
import FlowEndNote from '@/components/FlowEndNote.vue'
import GoodsInfo from '@/components/GoodsInfo.vue'
// 抄送 / 转办：选人组件，与审批页共用同一份
import SelectNode from '@/components/streamNodes/SelectNode.vue'
import {
  APPROVAL_STATUS,
  collectStepOptionItems,
  collectStepResultOptions,
  receivedQuantities,
} from '@/types/approval'
import { APPROVAL_STAGE_META, approvalStageOf } from '@/utils/approvalFilters'
// 条件求值上下文（建单快照优先）：算剩余接收数量、取「平台」快照都要用它，与流程引擎同源
import { flowContextOfOrder, optionContextOf, receiverTeamOf } from '@/utils/approvalFlow'
import {
  discardMarkOf,
  discardMarksOf,
  groupApproverSteps,
  lastHandledOf,
  mainOf,
  nextStepsOf,
  runtimeOf,
  stepStartTimesOf,
} from '@/utils/approvalRuntime'
// PB 的 bi_rows 记录（含 data 快照）→ 界面用的中文 key 产品对象
import { toProductView } from '@/utils/biRowFields'
import { formatDate } from '@/utils/utils'

/**
 * 审批详情（首页抽屉 / 我的审批单右栏共用）。
 *
 * 以前两处各写一份：首页在 v-navigation-drawer 里、我的审批单在右栏 v-sheet 里，
 * 时间线和办理选项的计算几乎逐行重复 —— 改一处口径（比如合并节点、弃置段标注、
 * 接收数量的账）另一处就漂。现在计算**全部收在这里**，两边只给：
 *   · `order`（选中的单）；
 *   · 上下条是否可用（各自的列表行序不同，由调用方算）；
 *   · `closable` / `readonly`（是否显示关闭、是否禁用抄送与转办）。
 * 办理、抄送、转办的落库仍由调用方通过事件接（各自的 useNodeSubmit / useApprovalSelect 实例）。
 */
interface DetailViewProps {
  /** 选中的审批单；null = 没选中（显示空态） */
  order?: ApprovalOrder | null
  /** 当前列表里有没有上/下一条（由调用方按它自己的行序算） */
  hasPrev?: boolean
  hasNext?: boolean
  /**
   * 这一单在列表里的位置（1 起）与列表总数 → 单号旁边显示「1/12」。
   * 位置由调用方算：首页按筛选后的表格行、我的审批单按当前板块的行，与上/下一条同一套行序。
   * 传 0 / 不传就不显示这个计数（比如列表还没加载出来）。
   */
  index?: number
  total?: number
  /** 显示右上角关闭按钮（首页抽屉、我的审批单历史板块点行打开时用） */
  closable?: boolean
  /**
   * 只读：把「抄送 / 转办」一起置灰。
   *
   * 历史审批单（已办结 / 已不在我这一环）只做查看，不能再往流程里塞抄送人或转办。
   * 办理按钮不用这里管：HandleDock 内部本来就按「当前环节是不是我」自己判断可用性。
   */
  readonly?: boolean
}

const props = withDefaults(defineProps<DetailViewProps>(), {
  order: null,
  hasPrev: false,
  hasNext: false,
  index: 0,
  total: 0,
  closable: false,
  readonly: false,
})

const emit = defineEmits<{
  submit: [payload: NodeSubmitPayload]
  select: [payload: { action: 'cc' | 'transfer', user: UserBrief }]
  close: []
  prev: []
  next: []
}>()

const router = useRouter()

/** 运行期视图（链路 / 当前环节 / 结束依据）：与页面表格、审批页同一份实现 */
const runtime = computed(() => (props.order ? runtimeOf(props.order) : null))
const chain = computed<ApprovalChainItem[][]>(() => runtime.value?.chain ?? [])
const stepIds = computed(() => runtime.value?.stepIds ?? [])
const currentStep = computed(() => runtime.value?.currentStep ?? -1)
const flowEnd = computed(() => runtime.value?.end)

const startTimes = computed(() =>
  props.order ? stepStartTimesOf(props.order, chain.value) : [],
)

/** 同一审批人连续办理的相邻环节合并成一条节点（与审批页 / 首页同一口径） */
const stepGroups = computed(() =>
  groupApproverSteps(chain.value, stepIds.value, startTimes.value),
)

/** 弃置审批段的标注（与 chain 下标一一对应，口径集中在 utils/approvalRuntime） */
const discardMarks = computed(() =>
  discardMarksOf({
    chain: chain.value,
    stepIds: stepIds.value,
    flow: props.order?.chain?.flow,
  }),
)

/** 各环节可选的审批结论 / 办理选项（取模板里该环节配置的那份） */
const resultOptions = computed(() => {
  const flow = props.order?.chain?.flow
  return flow?.length ? collectStepResultOptions(flow) : {}
})
const optionItems = computed(() => {
  const flow = props.order?.chain?.flow
  return flow?.length ? collectStepOptionItems(flow) : {}
})

/** 接收数量的账：总库存数量 / 已接收 / 剩余（与流程引擎共用，见 receivedQuantities） */
const qtyLedger = computed(() =>
  receivedQuantities(props.order?.chain?.decisions ?? [], flowContextOfOrder(props.order)),
)
const stockQty = computed(() =>
  String(qtyLedger.value.total ?? toProductView(props.order?.expand?.relation)['总库存数量'] ?? ''),
)
const remainingQty = computed(() =>
  (qtyLedger.value.remaining === undefined ? '' : qtyLedger.value.remaining),
)
const stockAmount = computed(() =>
  String(toProductView(props.order?.expand?.relation)['总库存金额'] ?? ''),
)
/** 本单所属团队（按快照里的「组别」反查团队表）：接收组别候选限定在它之内 */
const receiverTeam = computed(() => receiverTeamOf(props.order))

/** 头部的状态 chip：与表格 / 时间线同一套展示口径（含「卡住」那一档） */
const statusMeta = computed(() => {
  const order = props.order
  if (!order) {
    return null
  }
  const stage = approvalStageOf(
    order.status ?? APPROVAL_STATUS.PENDING,
    order.chain?.decisions,
    runtime.value?.end?.kind,
  )
  return APPROVAL_STAGE_META[stage]
})

/** 当前待办环节的负责人；已办结取最后一条已办的人（与表格「当前审批人」同口径） */
const approverName = computed(() => {
  const rt = runtime.value
  if (!rt) {
    return '—'
  }
  const name = (rt.currentStep >= 0 ? mainOf(rt.chain[rt.currentStep]) : lastHandledOf(rt.chain))?.name
  return name || '—'
})

/** 单号旁边的「1/12」：位置和总数都有效才显示（index 从 0 起算的调用方请先 +1） */
const positionText = computed(() => {
  if (props.total <= 0 || props.index <= 0) {
    return ''
  }
  return `${props.index}/${props.total}`
})

/** 「打开审批页」：带单号跳转，审批页按 order_no 定位（见 pages/approvalPage） */
function goApproval() {
  const no = props.order?.order_no ?? props.order?.id
  router.push({ path: '/approvalPage', query: no ? { order_no: no } : {} })
}
</script>

<style lang="scss" scoped>
/*
   * 撑满外层给的宽高（首页是抽屉内容区、我的审批单是右栏 v-sheet），
   * 内部三段靠 flex 排：头部固定、内容区自己滚、办理栏贴底。
   */
.approval-detail-view {
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}

.detail-head {
  flex: 0 0 auto;
}

/*
   * 关键：内容区吃掉「面板高度 − 头部 − 办理栏」剩下的部分，办理栏才能被挤到底部。
   * 只写 overflow-y: auto 是不够的 —— 不设 flex 时高度只有内容那么高。
   */
.detail-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.detail-empty {
  flex: 1 1 auto;
  min-height: 200px;
}

/*
   * 办理面板：在滚动区之外，天然贴底。
   * 底色必须不透明 —— 内容从它上面滚过去时否则文字会透出来糊成一片。
   */
.detail-dock {
  flex: 0 0 auto;
  background: rgb(var(--v-theme-surface));
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

/* 单据信息：一行一条，key 左 / value 右（两端对齐） */
.info-list {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0 4px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
}

.info-key {
  flex: 0 0 auto;
  font-size: 12px;
  // color: rgba(var(--v-theme-on-surface), 0.55);
}

.info-value {
  min-width: 0;
  font-size: 13px;
  // font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 「1/12」：等宽数字，翻页时宽度不跳 */
.info-index {
  flex: 0 0 auto;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  font-variant-numeric: tabular-nums;
}

.timeline-wrap {
  /* 时间线本身有左右留白，这里只补一点上下，避免右栏显得太空 */
  padding-inline: 4px;
}
</style>
