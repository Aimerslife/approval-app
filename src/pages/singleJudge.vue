<template>
  <v-container class="bg-app h-[calc(100vh-32px)]" fluid>
    <v-sheet class="overflow-hidden mt-3 p-4 card-border" rounded="15">
      <!-- 标题行：与 home / mine 同款（block-title + 右侧计数与刷新） -->
      <div class="d-flex align-center justify-space-between">
        <div class="block-title">独立审批</div>

        <div class="d-flex align-center">
          <span class="text-[12px] text-medium-emphasis mr-2">共 {{ filteredRows.length }} 条</span>

          <v-icon-btn size="x-small" title="刷新列表" variant="text" @click="load">
            <v-icon size="16">mdi-refresh</v-icon>
          </v-icon-btn>
        </div>
      </div>

      <div class="text-[12px] text-medium-emphasis mt-1">
        分配给你的独立审批任务在这里逐条办理。提交结论后直接回写到对应的主审批单（办理流水追加进主单的
        decisions），主流程的走向与状态不受影响。管理员以上权限可以看到所有独立审批环。
      </div>

      <!-- 状态筛选：默认只看待办；「已审批」= 全部行，管理员以上在这一档看到所有人的环 -->
      <v-tabs v-model="filter" class="mt-2" color="primary" density="compact">
        <v-tab value="todo">待我办理</v-tab>
        <v-tab value="all">已审批</v-tab>
      </v-tabs>

      <v-divider />

      <v-data-table
        v-model:page="page"
        border
        class="text-[12px]"
        density="compact"
        fixed-footer
        fixed-header
        :headers="headers"
        hover
        :items="filteredRows"
        :items-per-page="perPage"
        :loading="loading"
        no-data-text="当前筛选下没有独立审批任务"
        :page-count="pageCount"
        striped="odd"
      >
        <!-- 单号列：单号 + 建单时间 -->
        <template #item.orderNo="{ item }">
          <div class="font-bold">{{ item.orderNo }}</div>
          <div class="text-[11px] text-medium-emphasis">{{ item.createdText }}</div>
        </template>

        <!-- 独立审批列：卡片名；子流程模式附当前环名 -->
        <template #item.title="{ item }">
          <div>{{ item.title }}</div>
          <div v-if="item.stepLabel" class="text-[11px] text-medium-emphasis">{{ item.stepLabel }}</div>
        </template>

        <!-- 上一审批人结论：只摆前面的人留下的结论，不展开链路 -->
        <template #item.prevConclusion="{ item }">
          <span v-if="item.prevConclusion">{{ item.prevConclusion }}</span>
          <span v-else class="text-[11px] text-medium-emphasis">{{ item.prevEmptyText }}</span>
        </template>

        <template #item.progress="{ item }">
          <span class="text-medium-emphasis">已提交 {{ item.progress }}</span>
        </template>

        <!-- 状态：chip（管理员看所有环时同样成立）+ 我提交过的结论小字 -->
        <template #item.statusChip="{ item }">
          <v-chip :color="item.statusColor" label size="x-small">
            {{ item.statusText }}
          </v-chip>

          <div v-if="item.myResultText" class="text-[11px] text-medium-emphasis mt-1">{{ item.myResultText }}</div>
        </template>

        <template #item.action="{ item }">
          <v-btn v-if="item.canHandle" color="primary" variant="text" @click="openDialog(item)">
            <span class="text-[13px]">填写结论</span>
          </v-btn>

          <span v-else class="text-[11px] text-medium-emphasis">—</span>
        </template>

        <!-- 页脚只留一条紧凑分页（与 mine 表格同款） -->
        <template #bottom>
          <div class="d-flex justify-center">
            <v-pagination v-model="page" :length="pageCount" size="small" :total-visible="7" />
          </div>
        </template>
      </v-data-table>
    </v-sheet>

    <!-- 办理弹窗：上一审批人结论回顾 + 结论 + 意见（形态与 DeleteOrderButton 同款） -->
    <v-dialog v-model="dialog" max-width="440">
      <v-card v-if="activeRow">
        <v-card-title class="text-[15px]">
          {{ activeRow.stepLabel || activeRow.title }}
        </v-card-title>

        <v-card-text class="text-[13px]">
          <!-- 上一审批人结论回顾（与表格同一份文案） -->
          <template v-if="activeRow.prevConclusion">
            <div class="text-[12px] text-medium-emphasis mb-1">上一审批人的结论</div>
            <div class="mb-3">{{ activeRow.prevConclusion }}</div>
          </template>

          <div class="mb-1">审批结论</div>

          <v-radio-group v-model="form.result" density="compact" hide-details>
            <v-radio
              v-for="opt in activeRow.options"
              :key="opt"
              :label="optionLabel(opt)"
              :value="opt"
            />
          </v-radio-group>

          <v-textarea
            v-model="form.opinion"
            auto-grow
            class="mt-2"
            density="comfortable"
            label="办理意见（选填）"
            rows="2"
            variant="outlined"
          />
        </v-card-text>

        <v-card-actions class="px-4 pb-3">
          <v-spacer />
          <v-btn :disabled="submitting" variant="text" @click="dialog = false">取消</v-btn>

          <v-btn
            color="primary"
            :disabled="!form.result"
            :loading="submitting"
            variant="flat"
            @click="submit"
          >
            提交结论
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="tip.show" :color="tip.color" location="top" timeout="3000">
      {{ tip.text }}
    </v-snackbar>
  </v-container>
</template>

<script lang="ts" setup>
  import { computed, onMounted, reactive, ref } from 'vue'
  import { useIndependentSubmit } from '@/composables/useNodeSubmit'
  import { useUserStore } from '@/stores/user'
  import {
    APPROVAL_RESULTS,
    type ApprovalChainItem,
    type ApprovalOrder,
    branchTerminalMapOf,
    INDEPENDENT_DEFAULT_OPTIONS,
    rebuildChain,
    sameApprover,
    type SubApprovalState,
    subApprovalStateOf,
  } from '@/types/approval'
  // 订单业务上下文：子链分支要承接主链前面卡片的结论，必须与展示/提交侧完全一致
  import { flowContextOfOrder } from '@/utils/approvalFlow'
  import { getApprovalOrder } from '@/utils/collection'
  // 动作权限：管理员以上（approval:manageAll）看所有独立审批环
  import { canAct } from '@/utils/permissions'
  // 日期格式化：与 mine / home 表格同一份实现，别各写各的
  import { formatDate } from '@/utils/utils'

  /**
   * 「独立审批」专属办理页（表格视图，/singleJudge）。
   *
   * 为什么单独一页：主审批页（/approvalPage、首页抽屉）的时间线按**链路**摆环，
   * 独立审批混在里面既不好找、也看不清"只需要我看上一审批人结论"的轻量语义。
   * 这一页把独立审批从链路里抽出来：
   *   · 一行 = 「我参与的」一个独立审批环（简单模式一个环 / 子流程模式当前到我的一环）；
   *   · 只显示**上一审批人的结论**（子流程取前一环全员结论；单环节取同环其他成员已提交的），
   *     不渲染整条链路；
   *   · 提交走 `useIndependentSubmit`：结论回写主审批单的 decisions（主单 status 不动）。
   *
   * 数据零存储（与独立审批整体同一设计）：所有状态由
   * `subApprovalStateOf(flow, decisions, reachedIds, context)` 现算 ——
   * flow / decisions 全在主单快照里，这里只读不写（写只发生在提交那一刻）。
   */

  /** 表格行：一个"我参与且已发起"的独立审批环 */
  interface JudgeRow {
    /** 行 key：单号 + 环 stepId（跨单唯一） */
    key: string
    orderId: string
    orderNo: string
    createdText: string
    /** 独立审批名（画布卡片标题） */
    title: string
    /** 子流程模式的环名（简单模式为空） */
    stepLabel: string
    /** decisions.stepId —— 提交时的 nodeId */
    stepId: string
    /** 结论选项（空配置兜底 通过/驳回） */
    options: string[]
    /** 上一审批人结论文案（子流程=前一环全员；单环节=同环其他成员已提交的） */
    prevConclusion: string
    /** 没有前人结论时的占位文案 */
    prevEmptyText: string
    /** 进度文案（已提交人数） */
    progress: string
    statusText: string
    statusColor: string
    /** 我提交过的结论（小字，空 = 还没提交） */
    myResultText: string
    /** 出「填写结论」按钮 */
    canHandle: boolean
  }

  const userStore = useUserStore()
  const loading = ref(false)
  const rows = ref<JudgeRow[]>([])
  /** 单号 → 整单（提交时喂给 useIndependentSubmit 的 order ref） */
  const ordersById = new Map<string, ApprovalOrder>()

  /** 状态筛选（与 home 的 v-tabs 同款交互）：默认只看待办；「已审批」= 全部行 */
  const filter = ref<'todo' | 'all'>('todo')
  const filteredRows = computed(() => {
    const list = rows.value
    if (filter.value === 'todo') return list.filter(r => r.canHandle)
    return list
  })

  /**
   * 管理员以上权限（superAdmin / approval，走既有动作 'approval:manageAll'）：
   * 展示**所有**独立审批环，不按「分配给我」过滤；普通成员维持原口径。
   */
  const canSeeAll = computed(() => canAct(userStore.appRole, 'approval:manageAll'))

  // 客户端分页（与 mine 表格同款：一次全量拉取、前端分页）
  const page = ref(1)
  const perPage = 10
  const pageCount = computed(() => Math.max(1, Math.ceil(filteredRows.value.length / perPage)))

  const headers = [
    { title: '单号', key: 'orderNo', sortable: false },
    { title: '独立审批', key: 'title', sortable: false },
    { title: '上一审批人结论', key: 'prevConclusion', sortable: false },
    { title: '进度', key: 'progress', sortable: false, align: 'center' as const },
    { title: '状态', key: 'statusChip', sortable: false },
    { title: '操作', key: 'action', sortable: false, align: 'center' as const },
  ]

  /** 结论码 → 文案（自定义码原样显示，与时间线同一口径） */
  function optionLabel (code: string): string {
    return APPROVAL_RESULTS.find(r => r.value === code)?.label ?? code
  }

  /** 一条已提交结论的展示文案：「张三：通过（同意）」 */
  function conclusionText (h: { name?: string, result?: string, resultLabel?: string, opinion?: string }): string {
    const label = h.resultLabel || (h.result ? optionLabel(h.result) : '')
    const head = `${h.name ?? '—'}：${label || '—'}`
    return h.opinion?.trim() ? `${head}（${h.opinion.trim()}）` : head
  }

  /** 我在这个环里对应的成员位（open_id 优先，与全站认人同一口径） */
  function myMemberOf (members: ApprovalChainItem[]): ApprovalChainItem | undefined {
    const me = userStore.member
    return members.find(m => m?.type === 'manager' && sameApprover(m, me))
  }
  /**
   * 把一张单派生成「我的独立审批」行（写入 next）。
   *
   * 为什么单独一个函数：load 的循环要**逐单容错** —— 一张单的数据脏（坏快照 /
   * 未展开结构 / 拍平后一环不剩的容器等）只跳过它自己，不能把整页炸成「加载失败」。
   */
  function deriveOrderRows (order: ApprovalOrder, next: JudgeRow[]): void {
    const me = userStore.member
    const meName = String(me?.name ?? '').trim()
    const snapshot = order.chain
    const flow = snapshot?.flow
    // 旧单（无 flow 流水结构）没有独立审批语义，跳过
    if (!order?.id || !flow?.length || !snapshot) return
    if (!me) return
    ordersById.set(order.id, order)

    const decisions = snapshot.decisions ?? []
    const context = flowContextOfOrder(order)
    /*
     * reachedIds：主链已到达的环节集合（独立审批"发起"就是主线推进到它的那一刻）。
     * 与时间线组件同一份算法（rebuildChain）；简单模式环靠它判发起，
     * 子流程模式的游标重放（flattenIndependentChain）自带到达判定，这里只兜容器级。
     */
    const reachedIds = new Set(
      rebuildChain(flow, decisions, branchTerminalMapOf(snapshot), context).stepIds,
    )
    const states = subApprovalStateOf(flow, decisions, reachedIds, context)

    for (const state of states) {
      // 主链还没推进到这个独立审批：成员不该看到它（"发起"前没有办理一说）
      if (!state.reached) continue

      /** 组装一行（子流程传 step，简单模式 step 缺省） */
      const buildRow = (step?: NonNullable<SubApprovalState['steps']>[number]) => {
        const members = step?.members ?? state.members
        const mine = myMemberOf(members)
        // 管理员以上：所有环都摆出来；普通成员只摆「分配给我」的（多人环里别人同样在他们的页里看到）
        if (!mine && !canSeeAll.value) return

        const handled = step?.handled ?? state.handled
        const myEntry = meName ? handled.find(h => h.name === meName && h.result) : undefined
        const doneCount = step?.doneCount ?? state.doneCount
        const total = members.length
        const stepDone = step?.done ?? state.done

        /*
         * 上一审批人结论：
         *   · 子流程模式 = 前一环**全员**的结论（会签口径，unlocked 就是按它判的）；
         *   · 单环节模式 = 同环其他成员**已提交**的结论（各办各的，没有前后顺序）。
         * 需求口径：只显示前人的结论，不展开整条链路。
         */
        let prevConclusion = ''
        let prevEmptyText = ''
        if (step) {
          const idx = state.steps?.findIndex(st => st.id === step.id) ?? -1
          const prev = idx > 0 ? state.steps?.[idx - 1] : undefined
          const prevHandled = prev?.handled.filter(h => h.result) ?? []
          prevConclusion = prevHandled.map(h => conclusionText(h)).join('；')
          prevEmptyText = idx === 0 ? '这是第一环，还没有前人结论' : '上一环还没有人提交'
        } else {
          const others = handled.filter(h => h.result && h.name !== meName)
          prevConclusion = others.map(h => conclusionText(h)).join('；')
          prevEmptyText = '其他成员还没有人提交'
        }

        const myDone = !!myEntry
        // 只有环内成员能办（管理员看得到但不下场代批）：结论落库认的是环里的成员位
        const canHandle = !!mine && !myDone && !stepDone
        /*
         * 状态色沿用全站口径（utils/approvalFilters 的 APPROVAL_STAGE_META）：
         * 待办=warning（待定同款）、等待=secondary（未审批同款）、
         * 我已提交=success（通过同款）、整环完成=teal（已接收同款）。
         */
        let statusText = mine ? '待我办理' : '待成员提交'
        let statusColor = mine ? 'warning' : 'info'
        if (myDone) {
          statusText = '我已提交'
          statusColor = 'success'
        } else if (stepDone) {
          statusText = '已完成'
          statusColor = 'teal'
        } else if (step && !step.unlocked) {
          statusText = '等待上一环提交'
          statusColor = 'secondary'
        }

        const myLabel = myEntry ? conclusionText(myEntry).replace(`${meName}：`, '') : ''

        next.push({
          key: `${order.id}::${step?.id ?? state.nodeId}`,
          orderId: order.id,
          orderNo: order.order_no ?? '',
          createdText: formatDate(order.created),
          title: state.name,
          stepLabel: step ? `${state.name} · ${step.name}` : '',
          stepId: step?.id ?? state.nodeId,
          options: (step?.options ?? state.options)?.length
            ? (step?.options ?? state.options)
            : [...INDEPENDENT_DEFAULT_OPTIONS],
          prevConclusion,
          prevEmptyText,
          progress: `${doneCount}/${total}`,
          statusText,
          statusColor,
          myResultText: myLabel,
          canHandle,
        })
      }

      if (state.steps?.length) {
        // 子流程模式：每一环单独一行（普通成员的「可办」只落在自己的那环，管理员全部可见）
        for (const step of state.steps) {
          buildRow(step)
        }
      } else {
        buildRow()
      }
    }
  }

  /**
   * 拉全部审批单 → 派生「我的独立审批」行。
   *
   * 为什么全量拉再前端筛：与首页/我的审批单同一口径（集合里是审批单全量），
   * 单量级小（前端分页），后端没有"按成员+环节"的组合查询，派生逻辑必须在前端跑
   * （subApprovalStateOf 是纯函数，天然在展示侧算）。
   */
  async function load () {
    loading.value = true
    try {
      const orders = await getApprovalOrder()
      ordersById.clear()
      const next: JudgeRow[] = []

      for (const order of orders) {
        // 每单独立容错：一张单的数据脏只跳过它自己，不炸整页（外层 catch 只兜真正的意外）
        try {
          deriveOrderRows(order, next)
        } catch (error) {
          console.error(`[singleJudge] 单 ${order.order_no ?? order.id} 派生失败，已跳过:`, error)
        }
      }

      /*
       * 待办的排前面，其余保持 PB 返回序（getApprovalOrder 已按 -created 排好，新的在前，
       * 与原先的 createdText 降序比较器语义一致）。
       * 不用 Array#sort：项目 TS lib 未到 ES2023（无 toSorted）、unicorn/no-array-sort
       * 又禁原地排序 —— 按 utils/warehouse.ts 同款思路「先归档再取回」，比较器自然消失。
       */
      rows.value = [...next.filter(r => r.canHandle), ...next.filter(r => !r.canHandle)]
    } catch (error) {
      console.error('[singleJudge] 加载独立审批失败:', error)
      tip.text = '加载失败，请稍后重试'
      tip.color = 'error'
      tip.show = true
    } finally {
      loading.value = false
    }
  }

  /* ---------------- 办理弹窗 ---------------- */

  const dialog = ref(false)
  const activeRow = ref<JudgeRow | null>(null)
  /** 提交用的审批单 ref：openDialog 时指向该行的整单 */
  const activeOrder = ref<ApprovalOrder | null>(null)
  const form = reactive({ result: '', opinion: '' })

  const tip = reactive({ show: false, text: '', color: 'success' })
  function showToast (text: string, color: string) {
    tip.text = text
    tip.color = color
    tip.show = true
  }

  const { submitIndependent, submitting } = useIndependentSubmit({
    order: activeOrder,
    onUpdated: () => {
      void load()
    },
    onMessage: (text, color) => showToast(text, color),
  })

  function openDialog (row: JudgeRow) {
    activeRow.value = row
    activeOrder.value = ordersById.get(row.orderId) ?? null
    form.result = row.options[0] ?? ''
    form.opinion = ''
    dialog.value = true
  }

  async function submit () {
    const row = activeRow.value
    if (!row || !form.result) return
    await submitIndependent({
      // nodeId = decisions.stepId（简单模式是节点 id、子流程是组合 id，派生时已对齐）
      nodeId: row.stepId,
      result: form.result,
      resultLabel: optionLabel(form.result),
      opinion: form.opinion,
      done: ok => {
        if (ok) {
          dialog.value = false
          // 回到默认"待我办理"筛选，刚办完的行自然消失
          filter.value = 'todo'
          page.value = 1
        }
      },
    })
  }

  onMounted(() => {
    void load()
  })
</script>
