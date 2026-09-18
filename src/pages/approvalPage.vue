<template>
  <v-container class="pt-0 pl-0" fluid>
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
        <span>当前审批人：{{ currentApprover?.name }}</span>

        <v-btn
          class="mb-0.5"
          color="success"
          size="x-small"
          variant="tonal"
          @click="sendMessage"
        ><span
          class="text-[10px]"
        >催办</span></v-btn>
      </div>

      <div class="text-[13px] text-[#8B8B8B]">已耗时：<span class="text-[11px]">{{ formatTimeDiff(orderDatas?.created) }}</span></div>
    </v-sheet>

    <v-row gap="0">
      <v-col ref="leftColRef" class="relative" cols="4">
        <v-container>
          <v-timeline density="compact" side="end" truncate-line="both" width="100%">
            <ApprovalNode
              v-for="(item, index) in runtime.chain"
              :key="index"
              :allowed-results="stepResultOptions[runtime.stepIds[index]]"
              :data="item"
              :index="index"
              :length="runtime.chain.length"
              :prev-time="stepStartTimes[index]"
              :start-time="orderDatas?.created"
              @submit="onNodeSubmit"
            />
          </v-timeline>
        </v-container>

        <v-sheet
          class="fixed bottom-0 z-10 mt-0 px-5 py-3 d-flex justify-end gap-3 tabs-scrolled"
          :style="{ width: barWidth + 'px', left: barLeft + 'px' }"
        >
          <SelectNode @select="handleSelect" />
        </v-sheet>
      </v-col>

      <v-col cols="8">
        <v-sheet class="pl-3 mt--8">
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
  import { sendFeishuCard } from '@/api/api'
  import ApprovalNode from '@/components/ApprovalNode.vue'
  import ProductInfoCard from '@/components/ProductInfoCard.vue'
  import SelectNode from '@/components/streamNodes/SelectNode.vue'
  // 环节办理的落库逻辑（首页抽屉共用同一份，见 composables/useNodeSubmit.ts）
  import { useNodeSubmit } from '@/composables/useNodeSubmit'
  import {
    APPROVAL_STATUS,
    buildBranchTerminalMap,
    collectStepResultOptions,
    mergeExtraMembers,
    rebuildChain,
  } from '@/types/approval'
  import { flowContextOfOrder } from '@/utils/approvalFlow'
  import { getApprovalOrder, getApprovalOrderByNo, updateApprovalOrder } from '@/utils/collection'
  import { generateMockData, PRODUCT_HEADERS } from '@/utils/mockProduct'
  import { formatTimeDiff } from '@/utils/utils'

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
  const headers = ref(PRODUCT_HEADERS)
  const scrolled = ref(false)
  // 从 URL 读取审批单号（飞书卡片链接带参数回跳 / 首页「前往审批」跳转）。
  // 没有参数时留空 → getDatas 退回到「列表第一条」，不再用一个写死的假单号。
  const route = useRoute()
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

  function sendMessage () {
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

  function syncBottomBar () {
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

  const currentApprover = computed<ApprovalChainItem | undefined>(() => {
    const chain = runtime.value.chain
    if (chain.length === 0) return undefined
    const idx = runtime.value.currentStep >= 0 ? runtime.value.currentStep : chain.length - 1
    const step = chain[idx]
    return step?.find(i => i.type === 'manager') ?? step?.[0]
  })

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
  }
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

  async function onNodeSubmit (payload: NodeSubmitPayload) {
    await submitNode(payload)
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
