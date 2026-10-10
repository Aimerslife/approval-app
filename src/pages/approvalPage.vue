<template>
  <v-container class="pt-0 pl-0" fluid>
    <v-sheet class="sticky top-8 z-10 mt-0 px-5 py-3 d-flex justify-between" :class="{ 'tabs-scrolled': scrolled }"
      :style="{ width: barWidth + 'px', left: barLeft + 'px' }">
      <div class="d-flex align-center gap-2">
        <span class="text-[13px]">审批单号：<strong>{{ orderDatas?.order_no }}</strong>
          <v-icon-btn icon="mdi-content-copy" size="x-small" @click="copyOrderNo(orderDatas?.order_no)" /></span>
      </div>

      <div class="text-[13px] d-flex align-center gap-2">
        <span>当前审批人：{{ currentApprover?.name }}</span>

        <v-btn class="mb-0.5" color="success" size="x-small" variant="tonal" @click="sendMessage"><span
            class="text-[10px]">催办</span></v-btn>
      </div>

      <div class="text-[13px] d-flex align-center gap-1">
        <span>已耗时：<span class="text-[11px]  text-[#8B8B8B]">{{ formatTimeDiff(orderDatas?.created) }}</span></span>
        <div class="d-flex align-center">
          <v-btn :disabled="!prevOrder" size="x-small" :title="`上一个审批单 —— ${queueScope}`" variant="text" icon
            @click="gotoOrder(prevOrder)">
            <v-icon size="25">mdi-menu-left</v-icon>
          </v-btn>
          <span v-if="queueCountText" class="text-[11px] text-medium-emphasis pt-0.5" :title="queueScope">
            {{ queueCountText }}
          </span>
          <v-btn :disabled="!nextOrder" size="x-small" :title="`下一个审批单 —— ${queueScope}`" variant="text" icon
            @click="gotoOrder(nextOrder)">
            <v-icon size="25">mdi-menu-right</v-icon>
          </v-btn>
        </div>
      </div>
    </v-sheet>

    <v-row gap="0">
      <v-col ref="leftColRef" class="relative" cols="4">
        <v-container>
          <v-timeline density="compact" side="end" truncate-line="both" width="100%">
            <!--
              时间线按**合并后的节点**渲染：同一审批人连续办理的相邻环节合成一条（见 stepGroups），
              弹窗里把这一串动作连着办（办完自动接下一环）。
            -->
            <ApprovalNode v-for="(g, gi) in stepGroups" :key="g.stepIds[0] || gi"
              :allowed-options="stepOptionItems[g.stepIds[0]]"
              :allowed-results="stepResultOptions[g.stepIds[0]]" :data="g.steps[0]" :discard-segment-size="discardNodeCount"
              :in-discard-segment="discardIndexOf(g)" :index="g.indexes[0]"
              :length="runtime.chain.length" :next-steps="nextStepsOf(g, stepOptionItems, stepResultOptions)"
              :option-context="optionContextOf(orderDatas, runtime.chain, g.indexes[0])"
              :prev-time="g.startTimes[0]" :receiver-team="receiverTeam" :start-time="orderDatas?.created"
              :remaining-qty="remainingQty" :stock-amount="stockAmount" :stock-qty="stockQty"
              @submit="onNodeSubmit" />

            <!--
              「选择接收组别 / 选择接收团队」的接收方单独成一个节点：
              它命中终结类结论（CLOSE_FLOW_RESULTS），**不是** chain 里的审批人 ——
              所以链路里没有它，只能在时间线上补一个节点才看得见。
            -->
            <v-timeline-item v-if="receiver" class="mb-6" dot-color="#1055C9" size="small">
              <template #icon>
                <v-icon color="white" size="14">mdi-inbox-arrow-down</v-icon>
              </template>

              <div class="d-flex align-center gap-2">
                <v-chip color="primary" label size="x-small" variant="flat">
                  <span class="text-[9px]">{{ receiver.pick === 'team' ? '接收团队' : '接收组别' }}</span>
                </v-chip>

                <v-avatar class="mr-1" size="22">
                  <v-img v-if="receiver.avatar" cover :src="proxyAvatar(receiver.avatar)" />
                  <v-icon v-else size="13">mdi-account</v-icon>
                </v-avatar>

                <span class="text-[12px]">{{ receiver.name }}</span>
                <!--
                  接收方 = 名字 + 负责人（团队表选的；团队级叫负责人、组级叫组长）：
                  负责人才是落地联系的人，比所属团队有用；
                  历史单（那时选的是人）退回显示所属团队 / 邮箱。
                -->
                <span v-if="receiver.manager" class="text-[11px] text-medium-emphasis">
                  {{ receiver.pick === 'team' ? '负责人' : '组长' }} {{ receiver.manager }}
                </span>
                <span v-else-if="receiver.department" class="text-[11px] text-medium-emphasis">
                  {{ receiver.department }}
                </span>
                <span v-else-if="receiver.email" class="text-[11px] text-medium-emphasis">{{ receiver.email }}</span>
              </div>

              <div class="mt-1 text-[11px] text-medium-emphasis">流程到此结束：后面接的环节不再有人办理</div>
            </v-timeline-item>

            <!-- 时间线最后一条：流转**为什么**停下（办完 / 走到结束节点 / 命中终结结论 / 卡住） -->
            <FlowEndNote :end="runtime.end" />
          </v-timeline>
        </v-container>

        <v-sheet class="fixed bottom-0 z-10 mt-0 px-5 py-3 d-flex justify-end gap-3 tabs-scrolled"
          :style="{ width: barWidth + 'px', left: barLeft + 'px' }">
          <SelectNode @select="handleSelect" />
        </v-sheet>
      </v-col>

      <v-col cols="8">
        <v-sheet class="pl-3 mt--8">
          <ProductInfoCard :headers="headers" :product="product" @send-img="handleImg" />
        </v-sheet>
      </v-col>
    </v-row>

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" location="top" timeout="3000" variant="tonal">
      {{ snackbar.text }}
    </v-snackbar>

    <v-overlay v-model="overlay" @click="overlay = false">
      <div class="d-flex align-center justify-center" style="width: 100vw; height: 100vh">
        <v-img contain max-height="70vh" :src="imgUrl" :style="{ maxWidth: '70vw' }" width="400" rounded="xl"/>
      </div>
    </v-overlay>
  </v-container>
</template>

<script lang="ts" setup>
import type { UserBrief } from '@/api/api'
import type {
  ApprovalChainItem,
  ApprovalOrder,
  NodeSubmitPayload,
} from '@/types/approval'
// 以 headers（产品字段）为 key 生成一条产品信息用于展示，接入真实数据后替换
import useClipboard from 'vue-clipboard3'
import { proxyAvatar, sendFeishuCard } from '@/api/api'
import ApprovalNode from '@/components/ApprovalNode.vue'
// 时间线最后一条：流转为什么停下（见 types/approval 的 FlowEndInfo）
import FlowEndNote from '@/components/FlowEndNote.vue'
import ProductInfoCard from '@/components/ProductInfoCard.vue'
import SelectNode from '@/components/streamNodes/SelectNode.vue'
// 环节办理的落库逻辑（首页抽屉共用同一份，见 composables/useNodeSubmit.ts）
import { useNodeSubmit } from '@/composables/useNodeSubmit'
import {
  APPROVAL_STATUS,
  buildBranchTerminalMap,
  collectStepOptionItems,
  collectStepResultOptions,
  mergeExtraMembers,
  rebuildChain,
  receivedQuantities,
  receiverOf,
} from '@/types/approval'
import { flowContextOfOrder, optionContextOf, receiverTeamOf } from '@/utils/approvalFlow'
// 运行期视图（重算链路 / 环节负责人 / 连续同人环节合并 / 弃置段起点）：与首页表格同一口径
import {
  discardSegmentStart,
  groupApproverSteps,
  mainOf,
  nextStepsOf,
  runtimeOf,
  type ApproverStepGroup,
} from '@/utils/approvalRuntime'
// 产品的「总库存数量」等字段：PB 记录 → 界面用的中文 key 对象（唯一入口，别自己读 record.data）
import { toProductView } from '@/utils/biRowFields'
import { getApprovalOrder, getApprovalOrderByNo, updateApprovalOrder } from '@/utils/collection'
import { generateMockData, PRODUCT_HEADERS } from '@/utils/mockProduct'
import { formatTimeDiff } from '@/utils/utils'

const { toClipboard } = useClipboard()

async function copyOrderNo(order_no: string | undefined) {
  try {
    if (order_no) {
      await toClipboard(order_no)
      snackbar.value.text = '订单号已复制'
      snackbar.value.show = true
    }
  } catch (error) {
    console.error('复制失败:', error)
  }
}
// 显式标注类型：PB 返回的是 RecordModel，ref({}) 会被推成 Ref<{}>，
// 下面 product.value = data2?.items[0] 就会报 TS2322（RecordModel 不能赋给 {}）
const product = ref<Record<string, unknown>>({})
/**
 * 接收数量的账：总库存数量 / 已接收 / 剩余（= 一批货先被部分接收后，还剩多少给后面的组）。
 *
 * 与流程引擎**共用同一份口径**（types/approval 的 receivedQuantities）：
 * 页面上的上限与流程的分流依据（条件「剩余接收数量 > 0」）必须一致，
 * 否则会出现"页面能填、流程却按另一个数分流"。总库存数量优先取**建单快照**
 * （与条件取值同源），快照里没有才退回关联产品。
 */
const qtyLedger = computed(() =>
  receivedQuantities(orderDatas.value?.chain?.decisions ?? [], flowContextOfOrder(orderDatas.value)),
)
/**
 * 本单产品的「总库存数量」/「总库存金额」→ 下发给办理弹窗。
 * 前者：选中**全部接收**时接收数量就是它（不可修改），也是接收/回收数量的上限；
 * 后者：回收金额的上界（必须小于，见 ApprovalNode 的 lessThan）。
 */
const stockQty = computed(() =>
  String(qtyLedger.value.total ?? toProductView(product.value)['总库存数量'] ?? ''),
)
/** 本环节还能接多少件（剩余）；算不出来就留空，办理端退回按总库存数量 */
const remainingQty = computed(() => (qtyLedger.value.remaining === undefined ? '' : qtyLedger.value.remaining))
const stockAmount = computed(() => String(toProductView(product.value)['总库存金额'] ?? ''))
/**
 * 本单所属团队（按快照里的「组别」反查团队表）：
 * 「选择接收组别」的候选要限定在它之内（业务口径：不涉及其他团队）。
 */
const receiverTeam = computed(() => receiverTeamOf(orderDatas.value))
const headers = ref(PRODUCT_HEADERS)
const scrolled = ref(false)
// 从 URL 读取审批单号（飞书卡片链接带参数回跳 / 首页「前往审批」跳转）。
// 没有参数时留空 → getDatas 退回到「列表第一条」，不再用一个写死的假单号。
const route = useRoute()
const router = useRouter()
const orderNo = ref((route.query.order_no as string) ?? '')

function onScroll() {
  // 向上滚动（scrollTop > 0）时显示阴影
  scrolled.value = (window.scrollY || document.documentElement.scrollTop) > 4
}

interface NodeTarget {
  action: 'cc' | 'transfer'
  user: UserBrief
}
const nodeTargets = ref<NodeTarget[]>([])
function onNodeSelect(payload: NodeTarget) {
  nodeTargets.value.push(payload)
}

function sendMessage() {
  const base = import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin
  const link = `${base}/approvalPage?order_no=${encodeURIComponent(orderNo.value)}&from=feishu`
  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '审批催办通知' },
      template: 'blue',
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: `**当前审批人：张**\n审批单号：${orderNo.value}\n已耗时：15分钟\n[👉 点击去处理](${link})`,
        },
      },
    ],
  }
  sendFeishuCard({
    receive_id: 'ou_6b6abc721d2c7421703b78dc4db51b4d',
    msg_type: 'interactive',
    content: JSON.stringify(card),
  })
}
// 底部固定条同步左侧 v-col 的宽度与左偏移（fixed 脱离文档流，无法用百分比继承父容器宽度）
const leftColRef = ref<{ $el: HTMLElement } | null>(null)
const barWidth = ref(0)
const barLeft = ref(0)
let resizeObserver: ResizeObserver | null = null

function syncBottomBar() {
  const el = leftColRef.value?.$el as HTMLElement | undefined
  if (!el) return
  const rect = el.getBoundingClientRect()
  barWidth.value = rect.width + 23
  barLeft.value = rect.left
}
const orderDatas = ref<ApprovalOrder | null>(null)

const terminalMap = computed(() => buildBranchTerminalMap(orderDatas.value?.chain?.graph))

const runtime = computed(() => {
  const snapshot = orderDatas.value?.chain
  const flow = snapshot?.flow
  // 旧数据（只有 chain 没有 flow）：原样沿用，保持兼容
  if (!flow?.length) {
    const legacy = snapshot?.chain ?? []
    return {
      chain: legacy,
      stepIds: legacy.map((_, i) => `legacy-${i}`),
      currentStep: -1,
      done: false,
      outcome: 'pending' as const,
      // 旧单没有 flow，无从判断"为什么停" —— 显式给 undefined，与 rebuildChain 的返回形状一致
      end: undefined,
    }
  }
  // 业务上下文（关联数据的快照）参与条件选路；与提交侧取法必须一致（见 flowContextOfOrder）
  const rebuilt = rebuildChain(flow, snapshot?.decisions ?? [], terminalMap.value, flowContextOfOrder(orderDatas.value))
  // 合并运行时追加的抄送/转办成员（转办会把被接替者标成「已转办」，口径见该函数注释）
  mergeExtraMembers(rebuilt.chain, rebuilt.stepIds, snapshot?.extraMembers)
  return rebuilt
})

const stepResultOptions = computed(() => {
  const flow = orderDatas.value?.chain?.flow
  return flow?.length ? collectStepResultOptions(flow) : {}
})

/** 各环节的**选项数组**：模板里在审批节点上配的 options，办理下拉框直接用它渲染 */
const stepOptionItems = computed(() => {
  const flow = orderDatas.value?.chain?.flow
  return flow?.length ? collectStepOptionItems(flow) : {}
})

/**
 * 「选择接收组别 / 选择接收团队」的接收方：在时间线上单独渲染成一个节点。
 * 它命中终结类结论、不在 chain 里，所以只能从办理流水里取（见 receiverOf）；
 * 粒度（组别 / 团队）由 receiverOf 依据结论码补在 `pick` 上。
 */
const receiver = computed(() => receiverOf(orderDatas.value))

const currentApprover = computed<ApprovalChainItem | undefined>(() => {
  const chain = runtime.value.chain
  if (chain.length === 0) return undefined
  const idx = runtime.value.currentStep >= 0 ? runtime.value.currentStep : chain.length - 1
  const step = chain[idx]
  return step?.find(i => i.type === 'manager') ?? step?.[0]
})

/* ===== 「上一个 / 下一个审批单」===== */

/** 两个审批人是不是同一个人：邮箱优先（快照里最稳的标识），缺邮箱时退回姓名 */
function sameApprover(a?: ApprovalChainItem, b?: ApprovalChainItem) {
  if (!a || !b) return false
  const ae = String(a.email ?? '').trim().toLowerCase()
  const be = String(b.email ?? '').trim().toLowerCase()
  return ae && be ? ae === be : (!!a.name && a.name === b.name)
}

/** 某张单**当前待办**环节的负责人（已办结则取最后一环）—— 与表格「当前审批人」同口径（mainOf） */
function approverOfOrder(order: ApprovalOrder) {
  const rt = runtimeOf(order)
  if (rt.chain.length === 0) return undefined
  const idx = rt.currentStep >= 0 ? rt.currentStep : rt.chain.length - 1
  return mainOf(rt.chain[idx])
}

/**
 * 跳转队列：**这张单当前审批人**的其它在办单。
 *
 * 为什么锚在"当前审批人"而不是"登录人"：这排按钮就摆在「当前审批人：X」那一栏里，
 * 跳的自然是 X 的待办（正常场景下 X 就是登录人本人；管理员代看时也不会跳到自己那边去）。
 * 顺序沿用列表口径（getApprovalOrder 的 `-created`），所以左右跳与首页表格的上下行一致。
 */
const approverQueue = ref<ApprovalOrder[]>([])

/** 队列里当前这张单的位置；-1 = 不在队列里（已办结，或这张单的审批人换了人） */
const queueIndex = computed(() => {
  const no = orderDatas.value?.order_no
  if (!no) return -1
  return approverQueue.value.findIndex(o => (o.order_no ?? o.id) === no)
})

const prevOrder = computed(() => (queueIndex.value > 0 ? approverQueue.value[queueIndex.value - 1] : undefined))
const nextOrder = computed(() => {
  const i = queueIndex.value
  return i >= 0 && i < approverQueue.value.length - 1 ? approverQueue.value[i + 1] : undefined
})

/** 队列概览（按钮 title 用）：让人知道在谁的队列里 */
const queueScope = computed(() => {
  const who = currentApprover.value?.name ?? ''
  return `${who ? `${who} 的` : ''}在办审批单（${approverQueue.value.length} 张）`
})

/** 中间那个「3 / 8」计数：只有一张单、或这张单不在队列里（已办结）时不显示 */
const queueCountText = computed(() => (
  queueIndex.value >= 0 && approverQueue.value.length > 1
    ? `${queueIndex.value + 1} / ${approverQueue.value.length}`
    : ''
))

/**
 * 读队列。**每换一张单都要重算** —— 换了单，锚定的审批人可能就变了。
 * 失败只打日志：它只是"顺手换个单"的便利，不该影响本单展示。
 */
async function loadApproverQueue() {
  try {
    const all = await getApprovalOrder()
    const anchor = currentApprover.value
    if (!anchor) {
      approverQueue.value = []
      return
    }
    approverQueue.value = all.filter(o =>
      Number(o.status ?? APPROVAL_STATUS.PENDING) === APPROVAL_STATUS.PENDING
      && sameApprover(approverOfOrder(o), anchor),
    )
  } catch (error) {
    console.error('[approvalPage] 读取审批人队列失败:', error)
    approverQueue.value = []
  }
}

/** 跳过去：只改 URL 的 order_no，取数交给下面的 route watch（与飞书回跳同一条路径） */
function gotoOrder(order?: ApprovalOrder) {
  if (!order) return
  void router.replace({ query: { ...route.query, order_no: order.order_no ?? order.id } })
}

/**
 * 各环节的起始时间：首环节取订单创建时间，其余取「上一环节的办理时间」。
 * 传给 ApprovalNode 后即可算出与上级的时间差：已办理 → 耗时，未办理 → 已等待。
 */
const stepStartTimes = computed(() => {
  let prev: string | undefined = orderDatas.value?.created
  return runtime.value.chain.map(step => {
    const from = prev ?? ''
    // 与 ApprovalNode 取 manager 的口径保持一致
    const m = step.find(i => i.type === 'manager') ?? step[0]
    if (m?.handled_at) prev = m.handled_at // 已办理才推进基线
    return from
  })
})

/**
 * 时间线上的节点：把「同一审批人**连续**办理」的相邻环节合成一条（见 utils/approvalRuntime）。
 *
 * 为什么要合：A 办完流转到下一环，而下一环的审批人又是 A —— 不合并时时间线上会出现同一个人的
 * 两条节点（看着像重复），还得连点两次「办理」。合并后一条节点、弹窗里把这一串动作连着办。
 */
const stepGroups = computed(() => groupApproverSteps(runtime.value.chain, runtime.value.stepIds, stepStartTimes.value))

/**
 * 时间线上「弃置审批段」的起点下标（-1 = 这一单没进入弃置）。
 *
 * 口径集中在 utils/approvalRuntime 的 discardSegmentStart 里：
 * **第 4 个环节起 + 出现财务审批**（改口径只改那里的两个常量/函数）。
 */
const discardStart = computed(() => discardSegmentStart(runtime.value.chain))

/**
 * 这一组落在弃置段里吗 —— 落在就返回**段内序号**（0 起），否则 undefined。
 *
 * 传段内序号而不是 chain 下标：圆点"从进入这一段起逐渐缩小"，
 * 缩小幅度只与段内第几环有关（见 ApprovalNode 的 inDiscardSegment）。
 */
function discardIndexOf (group: ApproverStepGroup): number | undefined {
  const start = discardStart.value
  const i = group.indexes[0]
  return start >= 0 && i >= start ? i - start : undefined
}

/**
 * 弃置段一共几条节点（**合并后**的节点数，与 discardIndexOf 同一口径）。
 *
 * 交给 ApprovalNode 认出"哪条是这一段的最后一条"：整段背景只有首/尾两条留圆角、
 * 只有它们不往缝里撑，中间的直角首尾相接才拼成**一整块**背景（见其 discardSegmentSize）。
 */
const discardNodeCount = computed(() => stepGroups.value.filter(g => discardIndexOf(g) !== undefined).length)
/** 保存结果提示 */
const snackbar = ref<{ show: boolean, text: string, color: string }>({ show: false, text: '', color: 'success' })
function showMsg(text: string, color: 'success' | 'error' | 'warning' = 'success') {
  snackbar.value = { show: true, text, color }
}

async function getDatas() {
  // 优先按 URL 上的单号取：首页「前往审批」、飞书卡片回跳、催办链接都靠它。
  // 之前无论 URL 带什么都只取列表第一条，所以点哪一行看到的都是同一张单。
  const wanted = orderNo.value.trim()
  const one = wanted ? await getApprovalOrderByNo(wanted) : undefined
  const order = one ?? (await getApprovalOrder())[0] ?? null
  orderDatas.value = order
  // 产品取**这张单关联的那条数据**（expand.relation），不再是 bi_rows 的第一条（原来是 getProduct()，
  // 拿到的是全库第一行，跟这张单没关系）。
  // ProductInfoCard 内部会走 toProductView，PB 记录（含 data 快照）可以直接传。
  // 前提是查询里带了 expand: 'relation'，否则这里恒为空对象。
  product.value = order?.expand?.relation ?? {}
  // 单号回填成实际打开的那一张：催办链接 / 复制单号用的是这个值
  if (order?.order_no) orderNo.value = order.order_no
  // 队列跟着这张单走：审批人变了，能跳的单也跟着变（见 loadApproverQueue）
  void loadApproverQueue()
}

/**
 * URL 上的单号变了就换单：点「上一个 / 下一个」走的就是这条路径
 * （gotoOrder 只改 query），浏览器前进 / 后退也跟着生效。
 */
watch(
  () => route.query.order_no,
  v => {
    const no = String(v ?? '').trim()
    if (!no || no === orderNo.value) return
    orderNo.value = no
    void getDatas()
  },
)
const imgUrl = ref('')
const overlay = ref(false)
function handleImg(img: string) {
  overlay.value = true
  imgUrl.value = img
}
/**
 * 处理 SelectNode 选人：**抄送**追加到「当前待办环节」，**转办**则由选中的人接替该环节的办理。
 *
 * 两者都写进 extraMembers 而不是直接改 chain —— chain 每次由 flow + decisions 重算，
 * 直接改会在下次重算时丢失；也不能写进 flow，那是模板会影响后续所有审批单。
 *
 * 区别只在成员类型与标记（见 mergeExtraMembers）：
 *   · 抄送 → type 'cc'（ApprovalNode 里 nodeTargets 渲染 type != 'manager' 的成员）；
 *   · 转办 → type 'manager' + delegated_from（接替办理）。
 */
async function handleSelect(payload: { action: 'cc' | 'transfer', user: UserBrief }) {
  const order = orderDatas.value
  const snapshot = order?.chain
  if (!order?.id || !snapshot) {
    showMsg('审批单数据未加载，请稍后重试', 'warning')
    return
  }
  const isTransfer = payload.action === 'transfer'

  // 挂到当前待办环节；流程已走完时挂到最后一步
  const chain = runtime.value.chain
  const idx = runtime.value.currentStep >= 0 ? runtime.value.currentStep : chain.length - 1
  const stepId = runtime.value.stepIds[idx]
  if (!stepId) {
    showMsg('没有可添加抄送人的环节', 'warning')
    return
  }

  const u = payload.user
  // 转办的「从谁转来」= 当前经办人：同一环节可能已被转过几次，
  // 追加的 manager 排在后面，所以取链上**最后一位** manager 才是现在的经办人。
  const managers = (chain[idx] ?? []).filter(m => m.type === 'manager')
  const fromName = managers.at(-1)?.name ?? ''
  const member: ApprovalChainItem = {
    name: u.name,
    avatar: u.avatar,
    email: u.email,
    type: isTransfer ? 'manager' : 'cc',
    ...(isTransfer
      ? { delegated_from: fromName || '（未指定）', delegated_at: new Date().toISOString() }
      : {}),
  }

  const extraMembers = { ...snapshot.extraMembers }
  const existed = extraMembers[stepId] ?? []
  // 去重：UserBrief 有 open_id，但存进 chain 后没有该字段，按 name 比对
  if (existed.some(m => m.name === member.name)) {
    showMsg(isTransfer ? '该审批人已在当前环节' : '该抄送人已在列表中', 'warning')
    return
  }
  extraMembers[stepId] = [...existed, member]

  try {
    const updated = await updateApprovalOrder(order.id, {
      chain: { ...snapshot, extraMembers },
    })
    orderDatas.value = { ...order, ...updated }
    showMsg(isTransfer ? `已转办给 ${u.name}` : `已添加抄送人：${u.name}`, 'success')
  } catch (error) {
    console.error(isTransfer ? '转办失败:' : '添加抄送人失败:', error)
    showMsg(isTransfer ? '转办失败，请稍后重试' : '添加失败，请稍后重试', 'error')
  }
}

/**
 * 环节办理：实现已抽到 composables/useNodeSubmit.ts ——
 * 首页抽屉（home.vue）也点同一个「提交」，两边必须用同一份逻辑，
 * 否则结论结构 / 终态判定 / 必填校验会各自漂。
 * 这里只负责把落库后的最新记录同步回本地 orderDatas。
 */
const { submitNode } = useNodeSubmit({
  order: orderDatas,
  onUpdated: updated => {
    orderDatas.value = { ...orderDatas.value, ...updated }
  },
  onMessage: showMsg,
})

async function onNodeSubmit(payload: NodeSubmitPayload) {
  const updated = await submitNode(payload)
  /*
   * 落库成功后，再按单号向服务端读一次这张单。
   *
   * 为什么值得多这一次请求：时间线上的环节是「flow + decisions **现算**」出来的，
   * 提交后本地这份单据必须**确实**带上刚写进去的那条流水，新环节才会出现 ——
   * 否则现象就是「点了通过，时间线没多出节点，刷新页面才看到」。
   * onUpdated 已经把更新响应合回来了，但那依赖"响应里带着完整 chain"这个前提；
   * 这里直接以**服务端记录**为准，把这类"看起来没生效"的问题一次性消掉
   * （审批单量很小，多一次读的成本可以忽略）。
   */
  if (updated) {
    await getDatas()
  }
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', syncBottomBar)
  syncBottomBar()
  // v-col 尺寸变化（断点切换、抽屉展开等）时重新同步
  const el = leftColRef.value?.$el as HTMLElement | undefined
  if (el) {
    resizeObserver = new ResizeObserver(syncBottomBar)
    resizeObserver.observe(el)
  }
  getDatas()
})

onUnmounted(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', syncBottomBar)
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<style scoped lang="scss">
.tabs-scrolled {
  box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.15);
}

:deep(.v-timeline--vertical.v-timeline--side-end) {
  grid-template-columns: 0 min-content 1fr;
}

:deep(.v-timeline-item__body) {
  justify-self: stretch;
  width: 100%;
}

// 拖拽悬停时的目标高亮
::deep(.v-timeline-item__body.drop-target) {
  background: rgba(var(--v-theme-primary), 0.06);
  border-radius: 8px;
  outline: 1px dashed rgb(var(--v-theme-primary));
  outline-offset: 4px;
}
</style>
