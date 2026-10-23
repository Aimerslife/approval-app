<template>
  <v-container class="pt-0 px-0" fluid>
    <v-sheet
      class="sticky top-8 z-10 mt-0 px-5 py-3 d-flex justify-between"
      :class="{ 'tabs-scrolled': scrolled }"
      :style="{ width: barWidth + 'px', left: barLeft + 'px' }"
    >
      <div class="d-flex align-center gap-2">
        <span class="text-[13px]">审批单号：<strong>{{ orderDatas?.order_no }}</strong>
          <v-icon-btn icon="mdi-content-copy" size="x-small" @click="copyOrderNo(orderDatas?.order_no)" /></span>
      </div>

      <div class="text-[13px] d-flex align-center gap-2">
        <!-- 办结后没有"当前审批人"了：显示最后经手的人（见 currentApprover 的说明），也不再提供催办 -->
        <span v-if="orderPending">当前审批人：{{ currentApprover?.name }}</span>

        <span v-else class="text-medium-emphasis">
          已办结{{ lastHandler?.name ? `（最后由 ${lastHandler.name} 办理）` : '' }}
        </span>

        <v-btn
          v-if="orderPending"
          class="mb-0.5"
          color="success"
          size="x-small"
          variant="tonal"
          @click="sendMessage"
        ><span class="text-[10px]">催办</span></v-btn>
      </div>

      <div class="text-[13px] d-flex align-center gap-1">
        <span>已耗时：<span class="text-[11px]  text-[#8B8B8B]">{{ formatTimeDiff(orderDatas?.created) }}</span></span>
        <!-- 该审批人只有这一张在办单时不显示（两个箭头必然是灰的），见 showQueueNav -->
        <div v-if="showQueueNav" class="d-flex align-center">
          <v-btn
            :disabled="!prevOrder"
            icon
            size="x-small"
            :title="`上一个审批单 —— ${queueScope}`"
            variant="text"
            @click="gotoOrder(prevOrder)"
          >
            <v-icon size="25">mdi-menu-left</v-icon>
          </v-btn>

          <span v-if="queueCountText" class="text-[11px] text-medium-emphasis pt-0.5" :title="queueScope">
            {{ queueCountText }}
          </span>

          <v-btn
            :disabled="!nextOrder"
            icon
            size="x-small"
            :title="`下一个审批单 —— ${queueScope}`"
            variant="text"
            @click="gotoOrder(nextOrder)"
          >
            <v-icon size="25">mdi-menu-right</v-icon>
          </v-btn>
        </div>
      </div>
    </v-sheet>

    <v-row gap="0">
      <v-col ref="leftColRef" class="relative" cols="4">
        <!-- 底部留白跟固定办理面板的实测高度走（展开时面板变高，留白同步增加） -->
        <v-container class="pb-10" :style="{ paddingBottom: timelinePaddingBottom }">
          <v-timeline density="compact" side="end" truncate-line="both" width="100%">
            <ApprovalNode
              v-for="(g, gi) in stepGroups"
              :key="g.stepIds[0] || gi"
              :allowed-options="stepOptionItems[g.stepIds[0]]"
              :allowed-results="stepResultOptions[g.stepIds[0]]"
              :data="g.steps[0]"
              :discard-segment-size="discardMarkOf(g, discardMarks)?.size"
              hide-handle
              :in-discard-segment="discardMarkOf(g, discardMarks)?.seq"
              :index="g.indexes[0]"
              :length="runtime.chain.length"
              :next-steps="nextStepsOf(g, stepOptionItems, stepResultOptions)"
              :option-context="optionContextOf(orderDatas, runtime.chain, g.indexes[0])"
              :prev-time="g.startTimes[0]"
              :receiver-team="receiverTeam"
              :remaining-qty="remainingQty"
              :start-time="orderDatas?.created"
              :stock-amount="stockAmount"
              :stock-qty="stockQty"
              :type-templates="orderDatas?.chain?.types"
              @submit="onNodeSubmit"
            />

            <v-timeline-item v-if="receiver" class="mb-6" dot-color="#1055C9" size="small">
              <template #icon>
                <v-icon color="white" size="14">mdi-inbox-arrow-down</v-icon>
              </template>

              <div class="d-flex align-center gap-2">
                <v-chip color="primary" label size="x-small" variant="flat">
                  <span class="text-[9px]">{{ receiver.pick === 'team' ? '接收部门' : '接收团队' }}</span>
                </v-chip>

                <v-avatar class="mr-1" size="22">
                  <v-img v-if="receiver.avatar" cover :src="proxyAvatar(receiver.avatar)" />
                  <v-icon v-else size="13">mdi-account</v-icon>
                </v-avatar>

                <span class="text-[12px]">{{ receiver.name }}</span>

                <span v-if="receiver.manager" class="text-[11px] text-medium-emphasis">
                  {{ receiver.pick === 'team' ? '部门负责人' : '团队负责人' }} {{ receiver.manager }}
                </span>

                <span v-else-if="receiver.department" class="text-[11px] text-medium-emphasis">
                  {{ receiver.department }}
                </span>

                <span v-else-if="receiver.email" class="text-[11px] text-medium-emphasis">{{ receiver.email }}</span>
              </div>

              <div class="mt-1 text-[11px] text-medium-emphasis">流程到此结束：后面接的环节不再有人办理</div>
            </v-timeline-item>

            <FlowEndNote :end="runtime.end" />
          </v-timeline>
        </v-container>

        <v-sheet
          ref="dockRef"
          class="fixed bottom-0 z-10 tabs-scrolled handle-panel"
          :style="{ width: barWidth + 'px', left: barLeft + 'px' }"
        >
          <HandleDock
            :chain="runtime.chain"
            :current-step="runtime.currentStep"
            :groups="stepGroups"
            :option-items="stepOptionItems"
            :order="orderDatas"
            :receiver-team="receiverTeam"
            :remaining-qty="remainingQty"
            :result-options="stepResultOptions"
            :stock-amount="stockAmount"
            :stock-qty="stockQty"
            @submit="onNodeSubmit"
          >
            <!-- 抄送 / 转办：审批页单独有这一入口（抽屉里没有） -->
            <template #extra>
              <SelectNode @select="handleSelect" />
            </template>
          </HandleDock>
        </v-sheet>
      </v-col>

      <v-col cols="8">
        <v-sheet class="pl-3 mt--11">
          <ProductInfoCard :headers="headers" :product="product" @send-img="handleImg" />
        </v-sheet>
      </v-col>
    </v-row>

    <v-snackbar
      v-model="snackbar.show"
      :color="snackbar.color"
      location="top"
      timeout="3000"
      variant="tonal"
    >
      {{ snackbar.text }}
    </v-snackbar>

    <v-overlay v-model="overlay" @click="overlay = false">
      <div class="d-flex align-center justify-center" style="width: 100vw; height: 100vh">
        <v-img
          contain
          max-height="70vh"
          rounded="xl"
          :src="imgUrl"
          :style="{ maxWidth: '70vw' }"
          width="400"
        />
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
  // 底部办理面板：三处办理入口共用同一份实现（内含 ApprovalHandleForm）
  import HandleDock from '@/components/approval/HandleDock.vue'
  import ApprovalNode from '@/components/ApprovalNode.vue'
  // 时间线最后一条：流转为什么停下（见 types/approval 的 FlowEndInfo）
  import FlowEndNote from '@/components/FlowEndNote.vue'
  import ProductInfoCard from '@/components/ProductInfoCard.vue'
  import SelectNode from '@/components/streamNodes/SelectNode.vue'
  // 环节办理的落库逻辑（首页抽屉共用同一份，见 composables/useNodeSubmit.ts）
  import { useNodeSubmit } from '@/composables/useNodeSubmit'
  // 登录用户：右上角「上一个 / 下一个」按他锚定队列（见 queueAnchor，需求口径是"自己名下的单"）
  import { useUserStore } from '@/stores/user'
  import {
    APPROVAL_STATUS,
    collectStepOptionItems,
    collectStepResultOptions,
    receivedQuantities,
    receiverOf,
  } from '@/types/approval'
  import { flowContextOfOrder, optionContextOf, receiverTeamOf } from '@/utils/approvalFlow'
  // 运行期视图（重算链路 / 环节负责人 / 连续同人环节合并 / 弃置段起点）：与首页表格同一口径
  import {
    discardMarkOf,
    discardMarksOf,
    groupApproverSteps,
    lastHandledOf,
    mainOf,
    nextStepsOf,
    queueCursorOf,
    runtimeOf,
    stepStartTimesOf,
  } from '@/utils/approvalRuntime'
  // 产品的「总库存数量」等字段：PB 记录 → 界面用的中文 key 对象（唯一入口，别自己读 record.data）
  import { toProductView } from '@/utils/biRowFields'
  import { getApprovalOrder, getApprovalOrderByNo, updateApprovalOrder } from '@/utils/collection'
  import { generateMockData, PRODUCT_HEADERS } from '@/utils/mockProduct'
  // 权限判定表：管理员及以上不受"我名下"限制（见 canManageAllOrders / utils/permissions）
  import { canAct } from '@/utils/permissions'
  import { formatTimeDiff } from '@/utils/utils'
  // 工作日小时（周末不计）：与表格「进度」列、服务端催办跑批共用同一份实现
  import { workingHoursBetween } from '@/utils/workingHours'

  const { toClipboard } = useClipboard()

  async function copyOrderNo (order_no: string | undefined) {
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

  const qtyLedger = computed(() =>
    receivedQuantities(orderDatas.value?.chain?.decisions ?? [], flowContextOfOrder(orderDatas.value)),
  )

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

  function onScroll () {
    // 向上滚动（scrollTop > 0）时显示阴影
    scrolled.value = (window.scrollY || document.documentElement.scrollTop) > 4
  }

  interface NodeTarget {
    action: 'cc' | 'transfer'
    user: UserBrief
  }
  const nodeTargets = ref<NodeTarget[]>([])
  function onNodeSelect (payload: NodeTarget) {
    nodeTargets.value.push(payload)
  }

  /**
   * 「催办」：给**当前待办环节的审批人**发一条提醒卡片（点卡片上的链接直达本页）。
   *
   * ⚠️ 原来这里是测试代码：收件人写死成某个人的 open_id、内容也写死
   * （"当前审批人：张 / 已耗时：15分钟"）—— 部署到云上，点这个按钮就会把**假内容**
   * 发给那一个人。现在按真实数据发：
   *   · 收件人 = 当前待办环节的办理人（**优先 open_id**，退邮箱）；两者都没有就当场提示，
   *     不再"看起来发了、其实谁也没收到"；
   *   · 内容 = 单号 + 当前审批人 + 本环节已等待的**工作日小时** + 直达链接。
   */
  async function sendMessage () {
    const order = orderDatas.value
    const who = currentApprover.value
    const receiveId = who?.open_id || who?.email || ''
    if (!receiveId) {
      showMsg('当前环节没有可发送的对象（缺 open_id 与邮箱），无法催办', 'warning')
      return
    }
    const base = import.meta.env.VITE_PUBLIC_BASE_URL || window.location.origin
    const link = `${base}/approvalPage?order_no=${encodeURIComponent(orderNo.value)}&from=feishu`
    /*
     * 已等待时长：与表格「进度」列、服务端催办跑批**同一套口径** —— 工作日小时（周末不计）。
     * 这里只报数字、不给"超时 / 滞留"的结论：那两档要读「提醒设置」里配的阈值，
     * 而本页拿不到那份规则，写死一个数就会和表格对不上。
     */
    const startedAt = order
      ? (stepStartTimesOf(order, runtime.value.chain)[runtime.value.currentStep] ?? '')
      : ''
    const hours = startedAt ? workingHoursBetween(new Date(startedAt), new Date()) : 0
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
            content: `**审批单号：**${orderNo.value}\n**当前审批人：**${who?.name ?? '—'}\n`
              + `**本环节已等待：**${hours.toFixed(1)} 个工作日小时\n[👉 点击去处理](${link})`,
          },
        },
      ],
    }
    try {
      await sendFeishuCard({
        receive_id: receiveId,
        // 有 open_id 就用它（换人/改名都不影响）；没有才退回邮箱
        receive_id_type: who?.open_id ? 'open_id' : 'email',
        msg_type: 'interactive',
        content: JSON.stringify(card),
      })
      showMsg(`已催办：${who?.name ?? receiveId}`, 'success')
    } catch (error) {
      console.error('[催办] 发送失败:', error)
      showMsg('催办消息发送失败，请稍后重试', 'error')
    }
  }
  // 底部固定条同步左侧 v-col 的宽度与左偏移（fixed 脱离文档流，无法用百分比继承父容器宽度）
  const leftColRef = ref<{ $el: HTMLElement } | null>(null)
  const barWidth = ref(0)
  const barLeft = ref(0)
  let resizeObserver: ResizeObserver | null = null

  /**
   * 底部固定办理条（`.handle-panel`）的实测高度。
   *
   * 为什么不用固定值：这条是 `fixed bottom-0` 贴在视口底边的，折叠时只有一条标题行，
   * 点「办理」展开后高度最高 60vh（内容区内部滚动，见 HandleDock 的样式），
   * 而且进入页面时可能因为「默认展开」设置一上来就是展开态 —— 写死 px 要么盖住时间线末尾，
   * 要么收起后留一大块空白。所以量实高，padding 跟着它走。
   */
  const dockRef = ref<{ $el: HTMLElement } | null>(null)
  const dockHeight = ref(0)
  let dockObserver: ResizeObserver | null = null

  /** 时间线容器的底部留白 = 面板高度 + 24（留一点视觉间隙）；量不到时退回原来的 40px */
  const timelinePaddingBottom = computed(() => (dockHeight.value > 0
    ? `${Math.round(dockHeight.value) + 24}px`
    : '40px'))

  function syncBottomBar () {
    const el = leftColRef.value?.$el as HTMLElement | undefined
    if (!el) return
    const rect = el.getBoundingClientRect()
    barWidth.value = rect.width + 23
    barLeft.value = rect.left
  }
  const orderDatas = ref<ApprovalOrder | null>(null)

  /**
   * 运行期视图：**与首页 / 我的、以及提交侧共用同一份实现**（utils/approvalRuntime 的 runtimeOf）。
   *
   * 这里原先自己抄了一份（含"旧单没有 flow"的兜底分支）—— 三处一旦漂，同一张单在不同页面
   * 就会显示不同的当前环节、不同的结束依据。改成共用之后，旧单的结束依据也一并有了
   * （见 runtimeOf 的 legacyFlowEndOf）。
   */
  const runtime = computed(() => (orderDatas.value
    ? runtimeOf(orderDatas.value)
    : { chain: [], stepIds: [], currentStep: -1, done: false, outcome: 'pending' as const, end: undefined }))

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

  /** 单据是否还在流转：决定「当前审批人」那一栏显示谁，也决定队列按谁锚定（见 queueAnchor） */
  const orderPending = computed(() => Number(orderDatas.value?.status ?? APPROVAL_STATUS.PENDING) === APPROVAL_STATUS.PENDING)

  /** 最后一条已办是谁办的（办结单用它回答"这张单最后谁经手"）—— 与表格「审批结论」列同一口径 */
  const lastHandler = computed(() => lastHandledOf(runtime.value.chain))

  /**
   * 当前待办环节的负责人。**办结之后没有"当前审批人"可言** —— 返回 undefined。
   *
   * 为什么不能再退到"链尾那一环的负责人"：单据可能**中途就收了**（走到结束节点 / 命中终结类结论），
   * 链尾往后还挂着**从没办过**的环节 —— 报出去的人名是错的（实测一张办结单被显示成下一环那位）。
   */
  const currentApprover = computed<ApprovalChainItem | undefined>(() => {
    if (!orderPending.value) return undefined
    const chain = runtime.value.chain
    if (chain.length === 0) return undefined
    const idx = runtime.value.currentStep >= 0 ? runtime.value.currentStep : chain.length - 1
    const step = chain[idx]
    return step?.find(i => i.type === 'manager') ?? step?.[0]
  })

  /* ===== 「上一个 / 下一个审批单」===== */

  /** 两个审批人是不是同一个人：邮箱优先（快照里最稳的标识），缺邮箱时退回姓名 */
  function sameApprover (a?: ApprovalChainItem, b?: ApprovalChainItem) {
    if (!a || !b) return false
    const ae = String(a.email ?? '').trim().toLowerCase()
    const be = String(b.email ?? '').trim().toLowerCase()
    return ae && be ? ae === be : (!!a.name && a.name === b.name)
  }

  /**
   * 某张单"该谁办"：在办取**当前待办环节**的负责人；已办结取**最后一条已办**的人。
   *
   * 队列拿它跟锚点比，所以"办结单归谁"这一步的口径必须与 queueAnchor 一致（见那里）。
   */
  function approverOfOrder (order: ApprovalOrder) {
    const rt = runtimeOf(order)
    if (rt.chain.length === 0) return undefined
    if (rt.currentStep < 0) {
      return lastHandledOf(rt.chain)
    }
    return mainOf(rt.chain[rt.currentStep])
  }

  /**
   * 跳转队列：右上角「上一个 / 下一个」翻的就是它。
   *
   * 范围分两档（见 loadApproverQueue）：
   *   · 一般员工 → **自己名下**的在办单（锚点见 queueAnchor）；
   *   · 管理员及以上 → **全部**在办单（见 canManageAllOrders：管理员对所有审批单有权限）。
   * 顺序沿用列表口径（getApprovalOrder 的 `-created`），所以左右跳与首页表格的上下行一致。
   */
  const approverQueue = ref<ApprovalOrder[]>([])

  const userStore = useUserStore()

  /**
   * 能不能不受"我名下"限制地翻单：**管理员及以上**（超级管理员 / 管理员），
   * 走权限判定表（utils/permissions 的 approval:manageAll），不在页面里写角色比较。
   */
  const canManageAllOrders = computed(() => canAct(userStore.appRole, 'approval:manageAll'))

  /**
   * 「上一个 / 下一个」的锚点 = **登录人自己**（"自己名下的审批单"，需求口径）。
   *
   * ## 为什么不是"这张单的当前审批人"（旧口径，三个死结都实测过）
   *
   *   · **单据办结后就没有"当前审批人"了**：旧代码退到"链尾那一环的负责人"，而链尾往后
   *     还挂着**从没办过**的环节（单据在中途就收了：走到结束节点 / 命中终结类结论）——
   *     于是队列算成别人的、甚至空的，箭头直接消失。这就是"办结了没法接着跳下一张"。
   *   · **单据流转给下一位时**，队列会跳到**接手人**名下，对刚办完的人没有意义。
   *   · 只有"这一环正好压在我手上"时才成立，而办完那一刻恰恰不成立。
   *
   * 换成登录人之后，这些死结一次性消失：不管单据办结、还是流转给了别人，
   * 队列始终是"我名下还在办的"，`queueCursorOf` 再按建单时间给当前单插个站位 →
   * 「下一个」就是**我接着要办的那一张**。
   *
   * 认人只看 name / email / open_id（与 sameApprover 同一口径）。
   * 登录信息拿不到时（未登录 / 测试环境）退回"当前审批人 → 最后一条已办的人"，与旧版一致。
   */
  const queueAnchor = computed<ApprovalChainItem | undefined>(() =>
    // 登录者形状统一由 store 给（userStore.member，口径与链上认人一致）
    userStore.member ?? currentApprover.value ?? lastHandler.value)

  /** 队列里当前这张单的位置；-1 = 不在队列里（刚办完、已交接给别人，或本身就是别人的单） */
  const queueIndex = computed(() => {
    const no = orderDatas.value?.order_no
    if (!no) return -1
    return approverQueue.value.findIndex(o => (o.order_no ?? o.id) === no)
  })

  /**
   * 左右箭头指向哪两张单。
   *
   * 口径集中在 utils/approvalRuntime 的 `queueCursorOf`（它同时处理"当前单不在队列里"这种情形 ——
   * 刚办完一张就是这样，见该函数的说明），本页只负责把队列与当前单递进去。
   */
  const queueCursor = computed(() => queueCursorOf(approverQueue.value, orderDatas.value))

  const prevOrder = computed(() => queueCursor.value.prev)
  const nextOrder = computed(() => queueCursor.value.next)

  /** 队列概览（按钮 title 用）：让人知道翻的是哪一批单 —— 管理员是全部，员工是自己名下 */
  const queueScope = computed(() => {
    const count = approverQueue.value.length
    if (canManageAllOrders.value) {
      return `全部在办审批单（${count} 张）`
    }
    const who = queueAnchor.value?.name ?? ''
    return `${who ? `${who} 的` : ''}在办审批单（${count} 张）`
  })

  /** 中间那个「3 / 8」计数：只有一张、或这张单不在队列里（刚办完）时不显示 */
  const queueCountText = computed(() => (
    queueIndex.value >= 0 && approverQueue.value.length > 1
      ? `${queueIndex.value + 1} / ${approverQueue.value.length}`
      : ''
  ))

  /**
   * 是否显示「上一个 / 下一个」这排按钮：**有可跳的目标才显示**。
   *
   * 原先写的是"队列里有多张" —— 那个口径在"刚办完一张、手上只剩一张"时会误判成
   * "只有这一张、没必要显示"，把唯一还能跳过去的那张也藏掉了；
   * 而这恰好就是"办完想接着办下一张"的时刻。改成看左右箭头有没有落点。
   */
  const showQueueNav = computed(() => Boolean(prevOrder.value || nextOrder.value))

  /**
   * 读队列。**每换一张单都要重算** —— 换了单，锚定的审批人可能就变了。
   * 失败只打日志：它只是"顺手换个单"的便利，不该影响本单展示。
   */
  async function loadApproverQueue () {
    try {
      const all = await getApprovalOrder()
      const pending = all.filter(o => Number(o.status ?? APPROVAL_STATUS.PENDING) === APPROVAL_STATUS.PENDING)
      /*
       * 管理员及以上：**不受"我名下"限制**，在所有在办单里翻（见 utils/permissions 的 approval:manageAll）。
       * 一般员工：只在自己名下的在办单里翻（锚点见 queueAnchor）。
       */
      if (canManageAllOrders.value) {
        approverQueue.value = pending
        return
      }
      const anchor = queueAnchor.value
      if (!anchor) {
        approverQueue.value = []
        return
      }
      approverQueue.value = pending.filter(o => sameApprover(approverOfOrder(o), anchor))
    } catch (error) {
      console.error('[approvalPage] 读取审批人队列失败:', error)
      approverQueue.value = []
    }
  }

  /*
   * 锚点或档位变了就重算队列：登录态是**异步**恢复的（userStore.init 晚于首帧），
   * 首屏那次 loadApproverQueue 可能还是"未登录"的兜底口径，登录信息到位后必须再算一遍 ——
   * 否则"自己名下的单 / 全部在办单"要等到手动刷新才出来。
   */
  watch([queueAnchor, canManageAllOrders], () => {
    void loadApproverQueue()
  })

  /** 跳过去：只改 URL 的 order_no，取数交给下面的 route watch（与飞书回跳同一条路径） */
  function gotoOrder (order?: ApprovalOrder) {
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
   * 弃置审批段的标注（与 chain 下标一一对应，不在段里的位置是 undefined）。
   *
   * 口径集中在 utils/approvalRuntime 的 discardMarksOf —— 它按**节点**认（不是"起点往后全算"），
   * 所以从段内「回退上一级」重新走过的那些环节不会被误标成弃置。
   */
  const discardMarks = computed(() => discardMarksOf({
    chain: runtime.value.chain,
    stepIds: runtime.value.stepIds,
    flow: orderDatas.value?.chain?.flow,
  }))
  /** 保存结果提示 */
  const snackbar = ref<{ show: boolean, text: string, color: string }>({ show: false, text: '', color: 'success' })
  function showMsg (text: string, color: 'success' | 'error' | 'warning' = 'success') {
    snackbar.value = { show: true, text, color }
  }

  async function getDatas () {
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
  function handleImg (img: string) {
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
  async function handleSelect (payload: { action: 'cc' | 'transfer', user: UserBrief }) {
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
      ...(u.open_id ? { open_id: u.open_id } : {}),
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
    /*
     * 去重：**优先按 open_id 认人** —— 同名不同人按姓名比会误判成"已经在环节里"，
     * 于是加不进人（以前存进 chain 的成员没有 open_id，只能按姓名比，这次补上了）。
     * 老单里存过的成员没有 open_id，退回按姓名比。
     */
    if (existed.some(m => (m.open_id && member.open_id
      ? m.open_id === member.open_id
      : m.name === member.name))) {
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

  async function onNodeSubmit (payload: NodeSubmitPayload) {
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
    /*
     * 底部办理面板的高度变化（点「办理」展开 / 收起、换单后内容变高）→ 更新留白。
     * 用 getBoundingClientRect 而不是 contentRect：面板的内边距也算在占位里。
     */
    const dock = dockRef.value?.$el
    if (dock) {
      dockObserver = new ResizeObserver(() => {
        dockHeight.value = dock.getBoundingClientRect().height
      })
      dockObserver.observe(dock)
      dockHeight.value = dock.getBoundingClientRect().height
    }
    getDatas()
  })

  onUnmounted(() => {
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('resize', syncBottomBar)
    resizeObserver?.disconnect()
    resizeObserver = null
    dockObserver?.disconnect()
    dockObserver = null
  })
</script>

<style scoped lang="scss">
.tabs-scrolled {
  box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.15);
}

/* 面板本体的样式（圆角 / 限高 / 内部滚动）在 HandleDock 里，这里只管固定定位与阴影 */

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
