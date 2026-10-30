<template>
  <div class="handle-dock">
    <!--
      multiple：非 multiple 时 Vuetify 会把 v-model 写回成**单个值**（关掉最后一个面板时是
      undefined），与这里的数组模型对不上；multiple 下模型始终是数组，`['handle']` / `[]` 稳定。
    -->
    <v-expansion-panels v-model="panel" flat multiple rounded="0">
      <v-expansion-panel value="handle">
        <!-- readonly + hide-actions：整条标题不响应点击、原生箭头也不画，只留右侧的「办理」按钮 -->
        <v-expansion-panel-title class="px-5 py-3" hide-actions readonly>
          <div class="d-flex align-center ga-2 w-100">
            <!-- 同一审批人连续多环：标出"这是第几个动作"，避免以为只办一次就完了 -->
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

            <!--
              panel 模式（审批页）把操作推到最右侧；dialog 模式（首页 / 我的抽屉）
              不加这个弹簧 —— 抄送 / 转办 / 办理都跟在标题后面，靠左侧排。
            -->
            <v-spacer v-if="mode === 'panel'" />
            <!-- 各页自己的附加入口：抄送 / 转办（SelectNode） -->
            <slot name="extra" />
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

              <!--
                持久化设置：进入审批页时下方办理面板是否自动展开（"一直展示"）。
                关掉只是进入时保持收起 —— 点底部「办理」仍可临时打开办理。
              -->
              <v-switch
                v-model="autoOpen"
                class="ml-2"
                color="primary"
                density="compact"
                hide-details
                size="small"
              >
                <template #label>
                  <span class="text-[12px]">{{ autoOpen?'默认展开':'默认收起' }}</span>
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
    <v-dialog v-if="mode === 'dialog'" v-model="dialog" max-width="500">
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
  </div>
</template>

<script lang="ts" setup>
  import type { ApprovalChainItem, ApprovalNodeOption, ApprovalOrder, NodeSubmitPayload } from '@/types/approval'
  // 审批页「自动展开办理面板」的持久化设置（模块级单例）
  import { useApprovalDockSetting } from '@/composables/useApprovalDockSetting'
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
   */
  const rotationReceipts = computed(() => rotationReceiptsOf(props.chain))

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

  :deep(.v-expansion-panel-text__wrapper) {
    max-height: 60vh;
    overflow-y: auto;
    padding: 0 16px 12px;
  }
}
</style>
