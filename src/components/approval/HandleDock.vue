<template>
  <div class="handle-dock">
    <v-expansion-panels v-model="panel" flat multiple rounded="0">
      <v-expansion-panel value="handle">
        <!-- readonly + hide-actions：整条标题不响应点击、原生箭头也不画，只留右侧的「办理」按钮 -->
        <v-expansion-panel-title class="px-5 py-2" hide-actions readonly>
          <div class="d-flex align-center ga-2 w-100">
            <v-chip
              v-if="actionTotal > 1"
              color="primary"
              label
              size="x-small"
              variant="tonal"
            >
              第 {{ actionNo }} / {{ actionTotal }} 个动作
            </v-chip>

            <span v-if="!pendingGroup" class="text-[12px] text-medium-emphasis">暂无待办</span>
            <v-spacer v-if="mode === 'panel'" />
            <!-- 各页自己的附加入口：抄送 / 转办（SelectNode） -->
            <slot name="extra" />
            <!-- 驳回（回退上级）：唯一的驳回入口，与办理并排一键直达；点击先弹确认（见 handleRejectBack） -->
            <v-btn
              v-if="canRejectBack"
              color="error"
              :disabled="rejecting"
              prepend-icon="mdi-arrow-u-left-top"
              size="small"
              variant="tonal"
              @click.stop="handleRejectBack"
            >
              驳回
            </v-btn>
            <!-- 原生展开箭头的位置（已用 hide-actions 关掉）：换成明确的「办理」 -->
            <v-btn
              color="success"
              :disabled="!pendingGroup"
              prepend-icon="mdi-coffee-maker-outline"
              size="small"
              variant="tonal"
              @click.stop="toggle"
            >
              <span class="mb-0.5">办理</span>
            </v-btn>
          </div>
        </v-expansion-panel-title>

        <!-- panel 模式（审批页）：内容直接在底部条下面展开 -->
        <v-expansion-panel-text v-if="mode === 'panel'" eager>
          <div v-if="pendingGroup">
            <v-divider />

            <div class="mt-1 d-flex align-center ga-2">
              <v-icon color="primary" size="18">mdi-check-all</v-icon>
              <span class="text-[13px] font-weight-bold ml-1">审批</span>

              <v-switch
                v-model="autoOpen"
                class="ml-2"
                color="primary"
                density="compact"
                hide-details
                size="small"
              >
                <template #label>
                  <span class="text-[12px]">{{ autoOpen ? '默认展开' : '默认收起' }}</span>
                </template>
              </v-switch>
            </div>

            <ApprovalHandleForm
              ref="handleFormRef"
              v-bind="formProps"
              @cancel="close"
              @finish="close"
              @submit="payload => emit('submit', payload)"
            />
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <!-- dialog 模式（首页 / 我的抽屉）：底部按钮弹窗，与原来节点内的弹窗同一个形态 -->
    <v-dialog v-if="mode === 'dialog'" v-model="dialog" max-width="550">
      <v-card v-if="pendingGroup">
        <v-card-title class="d-flex align-center ga-2 text-[15px] py-3">
          <v-icon color="primary" size="18">mdi-check-all</v-icon>
          <span>审批</span>

          <v-chip
            v-if="actionTotal > 1"
            color="primary"
            label
            size="x-small"
            variant="tonal"
          >
            第 {{ actionNo }} / {{ actionTotal }} 个动作
          </v-chip>
        </v-card-title>

        <v-divider />

        <div class="px-4 py-3">
          <ApprovalHandleForm
            ref="handleFormRef"
            v-bind="formProps"
            @cancel="close"
            @finish="close"
            @submit="payload => emit('submit', payload)"
          />
        </div>
      </v-card>
    </v-dialog>

    <!-- 驳回二次确认：标题条一键直达没有输入位，动的是流转方向，先拦一道防误触 -->
    <v-dialog v-model="rejectConfirm" max-width="430">
      <v-card prepend-icon="mdi-arrow-u-left-top" title="确认驳回？">
        <v-card-text class="text-[13px]">
          将以「回退上级」结论驳回<span v-if="rejectStepName">「{{ rejectStepName }}」</span>这一环，
          流程会退回上一个环节或直接终结（按模板配置）。
          <div class="mt-2 text-medium-emphasis">
            驳回不携带审批意见，如需留痕请用「办理」进表单操作。该操作<strong>立即生效</strong>。
          </div>
        </v-card-text>

        <v-card-actions class="px-4 pb-4">
          <v-spacer />
          <v-btn :disabled="rejecting" variant="text" @click="rejectConfirm = false">取消</v-btn>

          <v-btn
            color="error"
            :disabled="!pendingGroup"
            :loading="rejecting"
            variant="flat"
            @click="confirmRejectBack"
          >
            确认驳回
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script lang="ts" setup>
  import type { ApprovalChainItem, ApprovalNodeOption, ApprovalOrder, NodeSubmitPayload } from '@/types/approval'
  // 审批页「自动展开办理面板」的持久化设置（模块级单例）
  import { useApprovalDockSetting } from '@/composables/useApprovalDockSetting'
  // 组织目录（按 open_id 补全成员的 department）：固定接收环节的分组名靠它（见下面 rotationReceipts）
  import { useAvatarDirectory } from '@/stores/avatarDirectory'
  // 办理选项条件（offerWhen）的求值上下文：三处办理入口必须同一口径
  import { optionContextOf } from '@/utils/approvalFlow'
  // 组内第 2..N 环 → 表单的 next-steps；口径与 ApprovalNode 完全一致
  import { type ApproverStepGroup, nextStepsOf, rotationReceiptsOf } from '@/utils/approvalRuntime'
  import ApprovalHandleForm from './ApprovalHandleForm.vue'

  /**
   * 办理入口（底部条 / 抽屉底部共用）。
   *
   * 三处入口（审批页、首页抽屉、我的审批单抽屉）**只有呈现方式不同**：
   *   · `mode="panel"`：标题条下面直接展开表单（审批页，expansion-panel）；
   *   · `mode="dialog"`：底部按钮弹窗（首页 / 我的抽屉，沿用原来的弹窗形态）。
   * 状态机完全一样：同人连续多环时组标识不变、落库后自动接下一环；
   * 组被办完 / 单据办结 / 换单时自动收起。页面只负责把它摆到该在的位置。
   */
  interface HandleDockProps {
    /** 呈现方式，默认 panel */
    mode?: 'panel' | 'dialog'
    /** 时间线节点分组（与 ApprovalNode 的 v-for 同一份，见 groupApproverSteps） */
    groups?: ApproverStepGroup[]
    /** 重算后的链路（runtimeOf().chain）：optionContext 与表单都要用 */
    chain?: ApprovalChainItem[][]
    /** 当前待办在 chain 中的下标（-1 = 已办结 / 数据未到） */
    currentStep?: number
    /** 各环节的办理选项 / 可选结论（collectStepOptionItems / collectStepResultOptions 的结果） */
    optionItems?: Record<string, ApprovalNodeOption[]>
    resultOptions?: Record<string, string[]>
    /** 审批单本身：optionContextOf 要它（流程快照里的字段参与选项条件求值） */
    order?: ApprovalOrder | null
    receiverTeam?: string
    remainingQty?: number | string
    stockAmount?: number | string
    stockQty?: number | string
  }

  const props = withDefaults(defineProps<HandleDockProps>(), {
    mode: 'panel',
    groups: () => [],
    chain: () => [],
    currentStep: -1,
    optionItems: () => ({}),
    resultOptions: () => ({}),
    order: null,
    receiverTeam: '',
    remainingQty: '',
    stockAmount: '',
    stockQty: '',
  })

  const emit = defineEmits<{
    (e: 'submit', payload: NodeSubmitPayload): void
  }>()

  /**
   * 持久化设置：进入审批页时下方办理面板是否自动展开（内容区那个 switch）。
   * 值是**模块级单例**（见 composables/useApprovalDockSetting.ts），读写都在那里，
   * 组件这里只消费 —— 避免多实例各读一次存储读出不同结果。
   */
  const { autoOpen } = useApprovalDockSetting()

  /**
   * panel 模式的开合：`['handle']` = 展开，`[]` = 折叠。
   * 用**数组**而不是 string / null —— Vuetify 的 expansion-panels 内部模型就是数组，
   * 传 null 时它按"无选中项"处理，某些时序下会把初始展开吞掉。
   */
  const panel = ref<string[]>(props.mode === 'panel' && autoOpen.value ? ['handle'] : [])

  /** dialog 模式的开关 */
  const dialog = ref(false)
  /** 展开时那一组的标识（组内第一环的 stepId）：用来判断"还是不是这一组" */
  const openedGroupKey = ref('')
  /** 表单实例：收起时 reset()，清掉子组件自己的"等待下一环"与红字校验 */
  const handleFormRef = ref<{ reset: () => void } | null>(null)

  /** 当前是否处于"已打开"状态（两种呈现方式合并成一个判断） */
  const opened = computed(() => (props.mode === 'dialog' ? dialog.value : Boolean(panel.value?.length)))

  function toggle () {
    if (props.mode === 'dialog') {
      dialog.value = true
      return
    }
    panel.value = ['handle']
  }

  /** 收起：取消 / 整组办完 / 组变了 / 换单都走这里 */
  function close () {
    panel.value = []
    dialog.value = false
  }

  /**
   * 当前待办落在**哪一组**：同人连续环节在时间线上合并成一条，办理也按整组办。
   * `currentStep` 是 chain 下标；已办结 / 数据未到时为 -1，取不到组 —— 按钮据此置灰。
   */
  const pendingGroup = computed(() => {
    const idx = props.currentStep
    if (idx < 0) return undefined
    return props.groups.find(g => g.indexes.includes(idx))
  })

  /** 「第 x / y 个动作」：组内已经办到第几环（与节点上的 chip 同一口径） */
  const actionNo = computed(() => (pendingGroup.value ? pendingGroup.value.indexes.indexOf(props.currentStep) + 1 : 0))
  const actionTotal = computed(() => pendingGroup.value?.indexes.length ?? 0)

  /** 组内第一环的选项表（与节点上收到的 allowed-options / allowed-results 同一取法） */
  const allowedOptions = computed(() => {
    const id = pendingGroup.value?.stepIds[0]
    return id ? props.optionItems[id] ?? [] : []
  })
  const allowedResults = computed(() => {
    const id = pendingGroup.value?.stepIds[0]
    return id ? props.resultOptions[id] ?? [] : []
  })

  /* ==================== 驳回（回退上级）：标题条上一键直达 ==================== */

  /**
   * 「驳回」的结论码：与表单（ApprovalHandleForm.REJECT_RESULT）和保存期注入的
   * 驳回分支条件（result eq reject）同一口径。
   */
  const REJECT_RESULT = 'reject'

  /** 当前待办环的 stepId（组内第 2..N 环也要对准——驳回针对的永远是**当前**这一环） */
  const activeStepId = computed(() => {
    const g = pendingGroup.value
    if (!g) return ''
    const pos = g.indexes.indexOf(props.currentStep)
    return pos === -1 ? '' : g.stepIds[pos] ?? ''
  })

  /**
   * 当前待办环有没有「回退上一级」出口 —— 标题条「驳回」按钮据此显示。
   * 判据：模板给这一环配了 reject 分支（保存期把它绑成 loopBackTo 回退），
   * 或环节级选项树标了 canReject（那条分支不在树里，见 ApprovalNodeOption.canReject）。
   * 看的是**未过滤**的环节选项：reject 已从办理下拉里摘掉，但出口本身还在。
   */
  const canRejectBack = computed(() => {
    const id = activeStepId.value
    return id ? (props.optionItems[id] ?? []).some(o => o.result === REJECT_RESULT || (o.nodeLevel && o.canReject)) : false
  })

  /** 驳回提交中：防连点（页面无论成败都会回调 done，见 handleRejectBack） */
  const rejecting = ref(false)

  /** 驳回确认弹窗：点「驳回」先拦一道，确认后才真正提交 */
  const rejectConfirm = ref(false)

  /** 确认弹窗里点名的那一环（链路项名称），取不到就只说"这一环" */
  const rejectStepName = computed(() => {
    const g = pendingGroup.value
    if (!g) return ''
    const pos = g.indexes.indexOf(props.currentStep)
    return g.steps[pos]?.[0]?.name ?? g.steps[0]?.[0]?.name ?? ''
  })

  /**
   * 一键回退上级（第一步）：只打开确认弹窗，不做任何提交。
   * 驳回动的是流转方向（退回上一环或终结流程），防误触必须先确认。
   */
  function handleRejectBack () {
    if (rejecting.value) return
    rejectConfirm.value = true
  }

  /**
   * 确认驳回（第二步）：关弹窗，以「驳回」结论提交**当前待办环** —— 模板里那条分支
   * 要么回退到上一个别人办的环节（loopBackTo），要么直接终结流程。
   * 意见 / 附件留空：确认弹窗没有输入位，需要留痕的意见写进时间线评论或后续环节补充。
   */
  function confirmRejectBack () {
    const g = pendingGroup.value
    if (!g || rejecting.value) return
    rejectConfirm.value = false
    rejecting.value = true
    emit('submit', {
      index: props.currentStep,
      result: REJECT_RESULT,
      result_label: '回退上级',
      extra: {},
      opinion: '',
      files: [],
      done: () => {
        rejecting.value = false
      },
    })
  }
  /** 组内后续环节：同一个人连着办时，表单据此"提交并继续下一个" */
  const nextSteps = computed(() => (pendingGroup.value
    ? nextStepsOf(pendingGroup.value, props.optionItems, props.resultOptions)
    : []))

  const optionContext = computed(() => (pendingGroup.value
    ? optionContextOf(props.order, props.chain, pendingGroup.value.indexes[0])
    : {}))

  /**
   * 前面「组间轮询」里各团队接收了多少 —— 交给表单在开头展示。
   *
   * 为什么在抽屉这一层算：`chain` 只有这里有（表单组件只拿到当前环节的成员），
   * 而三处办理入口都收敛到本组件，算一次三处同口径。
   * 没有轮询环时返回空数组，表单那一行自然不显示。
   *
   * 部门补全必须带：成员瘦身后 department 不在快照里（见 types/approval 的 slimFlowMembers），
   * 而**模板把第一棒接收配成固定环节**时（该组负责人办、结论是接收类），那一环没有
   * `role.dept` —— 组名只能按 open_id 从组织目录现查（实测：美1组先接 50 件、
   * 之后轮询美2/美3 组，不带补全时面板只列后两组，美1组那行整个丢失）。
   */
  const memberDir = useAvatarDirectory()
  void memberDir.ensure()
  const rotationReceipts = computed(() =>
    rotationReceiptsOf(props.chain, m => memberDir.detailOf(m).department))

  /** 两种呈现方式传给表单的是同一组属性，避免两处写两遍后悄悄漂掉 */
  const formProps = computed(() => ({
    allowedOptions: allowedOptions.value,
    allowedResults: allowedResults.value,
    data: pendingGroup.value?.steps[0] ?? [],
    index: pendingGroup.value?.indexes[0] ?? -1,
    length: props.chain.length,
    nextSteps: nextSteps.value,
    optionContext: optionContext.value,
    receiverTeam: props.receiverTeam,
    remainingQty: props.remainingQty,
    stockAmount: props.stockAmount,
    stockQty: props.stockQty,
    // 审批类型：从单据快照里取（建单期冻结，办理期只读）。老单没有 → 表单回落内置默认
    typeTemplates: props.order?.chain?.types,
    // 轮询卡片后面接的审批：开头列出前面各团队接了多少（见 rotationReceiptsOf）
    rotationReceipts: rotationReceipts.value,
    /*
     * 中间态（同一人连续多环、选完结论立即把后续环节铺出来）由**表单自己**推演：
     * 它拿到整张单 + 两张选项表，就能按 rebuildChain 模拟出后续每一环（见 utils/approvalPreview）。
     * 外壳只负责把数据交下去 —— 时间线与办理面板的 currentStep 始终是真实的，不会被预览污染。
     */
    order: props.order,
    optionItems: props.optionItems,
    resultOptions: props.resultOptions,
    showCancel: true,
  }))

  /**
   * 设置只决定**下次进入**时的初始形态：改开关不动当前面板（展开着就继续展开），
   * 下次进入由 `panel` 的初始值按 `autoOpen` 计算。持久化在 useApprovalDockSetting 里。
   */

  /**
   * 打开 / 收起的两件事：
   *   · 打开时记下"是哪一组"，后续用它判断这一组有没有被办完（见下面的 watch）；
   *   · 收起时清状态 —— 子组件在"提交成功、等下一环"时会把按钮置为禁用，
   *     不 reset 的话下次打开还是禁用态（它只通过 defineExpose 暴露了 reset）。
   */
  watch(opened, open => {
    if (open) {
      openedGroupKey.value = pendingGroup.value?.stepIds[0] ?? ''
      return
    }
    handleFormRef.value?.reset()
  }, { immediate: true })

  /**
   * 组变了就收起。
   *
   * 「同人连续多环」在时间线上是**同一组**（groupApproverSteps 按审批人合并），所以提交后
   * 下一环仍是本人时组标识不变 —— 面板留着继续办；一旦当前待办落到别的组，
   * 说明这一组已经办完、单子流转给别人了，再留着就会把**别人的环节**显示在面板里。
   * 单据办结（currentStep = -1，取不到组）同理。
   */
  watch(pendingGroup, g => {
    if (!opened.value) {
      return
    }
    if (!g) {
      // 单据还在、只是取不到待办组（已办结）才收；`order` 为空多半是数据刷新中途，先别动
      if (props.order?.id) {
        close()
      }
      return
    }
    // 面板是「自动展开」设置打开的，组数据可能比 setup 晚到：先补记标识，别当成"组变了"
    if (!openedGroupKey.value) {
      openedGroupKey.value = g.stepIds[0] ?? ''
      return
    }
    if (g.stepIds[0] !== openedGroupKey.value) {
      close()
    }
  })

  /**
   * 换了一张单（表格换行 / 上一个 / 下一个）就收起：面板绑的是**那张单**的当前待办。
   *
   * 只在"原来有单、且换成了另一张"时收 —— 审批页的数据是异步到的，`order` 会经历
   * `null → 'xxx'`，那第一次拿到 id 不算换单，否则「进入时自动展开」刚展开就会被这里收回去。
   */
  watch(() => props.order?.id, (id, prev) => {
    if (prev && id !== prev) {
      close()
    }
  })
</script>

<style scoped lang="scss">
/*
 * 面板本体：折叠时只有一条标题行，展开后**限高 + 内部滚动** ——
 * 否则表单会把固定条 / 抽屉底部顶得很高，把上面那段时间线整片盖住。
 * 圆角抹平：它贴在视口或抽屉的底边，有圆角两侧会露出底色。
 */
.handle-dock {

  :deep(.v-expansion-panels),
  :deep(.v-expansion-panel) {
    border-radius: 0;
  }

  /*
   * 标题行压扁：模板上的 py-0 只能清掉上下 padding，
   * Vuetify 给 .v-expansion-panel-title 还写死了 min-height: 48px ——
   * 这一行只有一条小按钮（~28px），剩下 20px 全变成上下空白。压掉后行高由内容决定。
   */
  :deep(.v-expansion-panel-title) {
    min-height: 0;
  }

  :deep(.v-expansion-panel-text__wrapper) {
    max-height: 60vh;
    overflow-y: auto;
    padding: 0 16px 12px;
  }
}
</style>
