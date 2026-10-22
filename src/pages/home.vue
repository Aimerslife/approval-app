<template>
  <v-tabs
    v-model="tab"
    align-tabs="center"
    class="sticky top-8 z-10 tabs-shadow"
    :class="{ 'tabs-scrolled': scrolled }"
    color="primary"
    fixed-tabs
    style="background-color: rgb(var(--v-theme-surface))"
  >
    <v-tab prepend-icon="mdi-home" value="home">当前审批单</v-tab>
    <v-tab prepend-icon="mdi-history" value="history">历史审批单</v-tab>
  </v-tabs>

  <v-tabs-window v-model="tab">
    <v-tabs-window-item value="home">
      <v-container class="h-[calc(100vh-80px)] bg-app" fluid>
        <v-sheet class="overflow-hidden mt-3 p-4 card-border" rounded="15">
          <div class="block-title">审批信息</div>
          <!-- 当前审批单：同一个 `approver` 字段在在办单里是「当前审批人」（表格已不摆这一列，筛选仍可按它挑单） -->
          <ApprovalFilterBar
            :dirty="filtersDirty"
            :filters="filters"
            :options="filterOptionsMap"
            :select-labels="{ approver: '当前审批人' }"
            @apply="applyFilters"
            @patch="patchFilters"
            @reset="resetFilters"
          />
          <v-divider class="mt-3" />
          <v-data-table
            v-model:page="page"
            border
            class="text-[12px]"
            density="compact"
            fixed-footer
            fixed-header
            :headers="pendingHeaders"
            hover
            :items="pendingList"
            :items-per-page="itemsPerPage"
            items-per-page-text="每页条数"
            striped="odd"
            @click:row="handleRowClick"
          >
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

          <ApprovalFilterBar
            :dirty="filtersDirty"
            :filters="filters"
            :options="filterOptionsMap"
            :select-labels="{ approver: '最后办理人' }"
            @apply="applyFilters"
            @patch="patchFilters"
            @reset="resetFilters"
          />

          <v-divider class="mt-3" />

          <v-data-table
            v-model:page="page"
            border
            class="text-[12px]"
            density="compact"
            fixed-footer
            fixed-header
            :headers="historyHeaders"
            hover
            :items="historyList"
            :items-per-page="itemsPerPage"
            :items-per-page-options="[20, 50, 100, 200]"
            items-per-page-text="每页条数"
            striped="odd"
            @click:row="handleRowClick"
          >
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

  <v-navigation-drawer
    v-model="setOpen"
    location="right"
    permanent
    temporary
    width="1200"
  >
    <!--
      抽屉内容 = 与「我的审批单」右栏**共用同一个组件**（头部 / 单据信息 / 时间线 / 办理栏）。
      原来这块是手写的一份，和 my 的右栏各写一套口径，改一处就漂。
      外层只负责给宽高与关闭行为，内部自己排「头部固定 + 内容滚 + 办理栏贴底」。
    -->
    <ApprovalDetailView
      :closable="true"
      :has-next="hasNextStep"
      :has-prev="hasPrevStep"
      :index="selectedIndex + 1"
      :order="selectedOrder"
      :total="visibleRows.length"
      @close="setClose"
      @next="nextStep"
      @prev="backStep"
      @select="handleSelect"
      @submit="onDrawerSubmit"
    />
  </v-navigation-drawer>
  <!-- 抽屉里提交办理后要有反馈（原先这个页面没有 snackbar，写库成功/失败都看不见） -->
  <v-snackbar
    v-model="snackbar.show"
    :color="snackbar.color"
    location="top"
    timeout="3000"
    variant="tonal"
  >
    {{ snackbar.text }}
  </v-snackbar>
</template>

<script setup lang="ts">
  import type { DeleteOrderSummary } from '@/api/api'
  import type { ApprovalChainItem, NodeSubmitPayload } from '@/types/approval'
  // 与「我的审批单」右栏**共用同一个组件**：头部 / 单据信息 / 时间线 / 办理栏都在里面
  import ApprovalDetailView from '@/components/approval/ApprovalDetailView.vue'
  import ApprovalFilterBar from '@/components/ApprovalFilterBar.vue'
  // 操作栏的「删除审批单」：按钮内置权限判断与确认框（两个页面共用同一个组件）
  import DeleteOrderButton from '@/components/DeleteOrderButton.vue'
  // 抄送 / 转办的落库逻辑，与审批页共用同一份
  import { useApprovalSelect } from '@/composables/useApprovalSelect'
  // 取数 / 组装行 / 筛选：与 mine.vue 共用（原先两页各写一份，加一列要改两处）
  import { useApprovalTable } from '@/composables/useApprovalTable'
  import { drawerSet } from '@/composables/useEditorFullscreen'
  // 环节办理的落库逻辑与审批页共用同一份（原先这里只关弹窗+跳页，用户填的内容被丢弃）
  import { useNodeSubmit } from '@/composables/useNodeSubmit'
  import { APPROVAL_TABLE_HEADERS, type ApprovalRow, toApprovalRow } from '@/utils/approvalRows'
  // 重算链路：只为了把 chain / stepIds / currentStep 交给 useApprovalSelect（详情视图内部自己算展示）
  import { runtimeOf } from '@/utils/approvalRuntime'
  import { formatDate } from '@/utils/utils'

  // 两个 tab 就是同一批数据的两个切面：当前 = 未结束，历史 = 已结束
  const tab = ref<'home' | 'history'>('home')
  const scrolled = ref(false)
  function onScroll () {
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
   * 详情视图要用的三样东西 —— **只为「抄送 / 转办」的落库**准备：
   * useApprovalSelect 需要知道挂到哪一环、当前经办人是谁。
   * 展示用的链路 / 节点合并 / 弃置段标注 / 接收数量等全部收在 ApprovalDetailView 内部，
   * 本页不再重复算一份（以前两处各算一次，口径一改就漂）。
   */
  const selectedChain = computed<ApprovalChainItem[][]>(() => {
    const order = selectedOrder.value
    return order ? runtimeOf(order).chain : []
  })
  const selectedStepIds = computed(() => {
    const order = selectedOrder.value
    return order ? runtimeOf(order).stepIds : []
  })
  /** 当前待办环节的下标（-1 = 流程已走完） */
  const selectedCurrentStep = computed(() =>
    selectedOrder.value ? runtimeOf(selectedOrder.value).currentStep : -1,
  )

  const selectedIndex = computed(() =>
    selectedNode.value ? visibleRows.value.findIndex(r => r.id === selectedNode.value?.id) : -1,
  )
  const hasPrevStep = computed(() => selectedIndex.value > 0)
  const hasNextStep = computed(() =>
    selectedIndex.value >= 0 && selectedIndex.value < visibleRows.value.length - 1,
  )

  /** 选中第 index 条；顺带把表格翻到它所在的页，否则选中行可能落在别的页上看不到 */
  function selectStep (index: number) {
    const row = visibleRows.value[index]
    if (!row) return
    selectedNode.value = row
    open.value = true
    // 与 handleRowClick 一致：收起主侧边栏，给右侧抽屉让位
    drawerSet.value = false
    const p = Math.floor(index / itemsPerPage.value) + 1
    if (p !== page.value) page.value = p
  }

  function backStep () {
    if (hasPrevStep.value) selectStep(selectedIndex.value - 1)
  }

  function nextStep () {
    if (hasNextStep.value) selectStep(selectedIndex.value + 1)
  }
  function handleRowClick (_event: Event, { item }: { item: ApprovalRow }) {
    if (!selectedNode.value?.id) drawerSet.value = false
    selectedNode.value = item
    open.value = true
  }
  function setClose () {
    selectedNode.value = null
    open.value = false
    drawerSet.value = true
  }
  function goApproval (row?: ApprovalRow | null) {
    console.log(row)
    const no = row?.order_no ?? selectedNode.value?.order_no
    router.push({ path: '/approvalPage', query: no ? { order_no: no } : {} })
  }

  /** 抽屉里的提示（与审批页同一套 snackbar 形状） */
  const snackbar = ref<{ show: boolean, text: string, color: string }>({ show: false, text: '', color: 'success' })
  function showMsg (text: string, color: 'success' | 'error' | 'warning' = 'success') {
    snackbar.value = { show: true, text, color }
  }

  /**
   * 删掉一条单之后：重新**全量**取数 —— 列表、筛选下拉的选项、两个 tab 都由 orders 派生，
   * 少刷一处就会出现"单子没了、筛选里还留着它的部门"这种残留。
   *
   * 抽屉正开着这一条时一并关掉：留着一个指向"已删除记录"的抽屉最迷惑人
   * （时间线还在、点办理会写到不存在的单上）。
   */
  async function onOrderDeleted (summary: DeleteOrderSummary) {
    if (selectedNode.value?.id === summary.id) {
      selectedNode.value = null
      open.value = false
    }
    await load()
    // deleted = false 表示它之前就已经不在了（服务端按幂等处理）——提示如实说，别谎报"删除成功"
    showMsg(summary.deleted ? '审批单已删除' : '该审批单已经不在了，列表已刷新', summary.deleted ? 'success' : 'warning')
  }

  /** 删除失败（多为权限或网络）：把服务端给的原因原样弹出来 */
  function onDeleteFailed (message: string) {
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

  function onDrawerSubmit (payload: NodeSubmitPayload) {
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
 * 抽屉内容区：交给 ApprovalDetailView 自己排版（头部固定 / 内容滚 / 办理栏贴底），
 * 所以这里只让它吃满高度，并且**关掉抽屉自身的滚动** —— 否则会出现两条滚动条，
 * 且办理栏会跟着内容一起被滚走（不再是"钉在底部"）。
 */
:deep(.v-navigation-drawer__content) {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
</style>
