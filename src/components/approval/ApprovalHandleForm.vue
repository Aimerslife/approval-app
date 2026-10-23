<template>
  <div class="handle-form">
    <!-- 同一审批人连续多环：前面几环已经办过的，先列出来，免得以为重复了 -->
    <div v-if="doneActions.length > 0" class="d-flex flex-column ga-3">
      <div v-for="(d, di) in doneActions" :key="di" class="pa-3 rounded bg-[#F6F7F9]">
        <div class="d-flex align-center flex-wrap gap-2">
          <v-chip color="success" label size="x-small" variant="flat">已办</v-chip>
          <v-chip color="primary" label size="x-small" variant="tonal">{{ d.label }}</v-chip>
          <span v-if="d.path" class="text-[11px] text-medium-emphasis">{{ d.path }}</span>
        </div>

        <div v-if="d.opinion" class="mt-1 text-[11px] text-medium-emphasis">意见：{{ d.opinion }}</div>

        <div v-if="d.extras.length > 0" class="mt-1 d-flex flex-wrap align-center ga-2">
          <span v-for="it in d.extras" :key="it.key" class="text-[11px] text-medium-emphasis">
            {{ it.label }}：{{ it.value }}
          </span>
        </div>

        <div v-if="d.files.length > 0" class="mt-1 d-flex align-center flex-wrap text-[11px]">
          <span
            v-for="f in d.files"
            :key="f.id"
            class="d-inline-flex align-center cursor-pointer text-[#89898A] underline"
            @click="showPic(f.url)"
          >
            <v-icon size="11">mdi-paperclip</v-icon>
            <span class="mt-1">{{ f.name }}</span>
          </span>
        </div>
      </div>
    </div>

    <v-alert
      v-if="waitingNext"
      class="mb-3"
      density="compact"
      type="info"
      variant="tonal"
    >
      已提交，正在进入下一环节（还是你办理）…
    </v-alert>

    <v-form v-if="radios == 'deal'" ref="handleForm" @submit.prevent="handleConfirm">

      <!--
        单子的总量**只在开头说一次**（总件数 / 已接收 / 总金额）：
        以前它散在「接收数量」右侧（（总 12869，已接收 110））和「回收」结论文案里各一份，
        同一个数在同一个弹窗里出现两三次，反而看不出哪个是整单的、哪个是本环的。
        本环还能接多少仍然标在数量框旁边（价值 …（剩余 12759 件）），两者分工明确。
      -->
      <div v-if="stockQtyText || stockAmountText" class="approval-total mb-3 text-[11px] text-medium-emphasis">
        <span v-if="stockQtyText">总件数 <b>{{ stockQtyText }}</b> 件</span>
        <span v-if="receivedQtyText">已接收 <b>{{ receivedQtyText }}</b> 件</span>
        <span v-if="stockAmountText">总金额 <b>￥{{ stockAmountText }}</b></span>
      </div>

      <template v-if="!hasNodeLevelTree">
        <div class="d-flex align-center ga-3">
          <span class="field-label shrink-0">选择处理方式</span>

          <v-radio-group
            v-if="useOptionRadios"
            v-model="selectedOptionKey"
            class="flex-grow-1"
            hide-details
            inline
          >
            <v-radio v-for="opt in selectItems" :key="opt.key" :color="radioColorOf(opt.result)" :value="opt.key">
              <template #label>
                <span class="text-[13px]">{{ opt.text }}</span>
              </template>
            </v-radio>
          </v-radio-group>

          <v-select
            v-else
            v-model="selectedOptionKey"
            class="filter-select flex-grow-1"
            density="compact"
            hide-details
            item-title="text"
            item-value="key"
            :items="selectItems"
            :menu-props="{ contentClass: 'filter-menu' }"
            single-line
            style="max-width: 480px"
            variant="outlined"
          >
            <template #label>
              <span class="text-[11px]">选择处理方式</span>
            </template>
          </v-select>
        </div>
      </template>

      <div v-if="pickedGroups.length > 0" class="mt-2 d-flex align-center ga-3 mb-3">
        <span class="field-label shrink-0">办理选项</span>

        <v-select
          v-model="pickedLeaf"
          class="filter-select flex-grow-1"
          density="compact"
          hide-details
          item-title="text"
          :items="optionMenuItems"
          max-width="200px"
          :menu-props="{ contentClass: 'filter-menu' }"
          placeholder="请选择"
          return-object
          single-line
          variant="outlined"
        >
          <template #label>
            <span class="text-[11px]">选项</span>
          </template>
        </v-select>

        <v-select
          v-if="leafChildren.length > 0"
          v-model="pickedChild"
          class="filter-select"
          density="compact"
          hide-details
          :items="leafChildren"
          max-width="200px"
          :menu-props="{ contentClass: 'filter-menu' }"
          placeholder="请选择"
          single-line
          variant="outlined"
        >
          <template #label>
            <span class="text-[11px]">二级选项</span>
          </template>
        </v-select>
      </div>
      <div class="remark-row">
        <OptionFormRenderer
          v-if="typeFields.length > 0"
          :key="`${activeStep?.index}-${selectedResult}`"
          v-model="typeValues"
          :context="typeContext"
          :fields="typeFields"
          @pick="startPick"
        />
      </div>

      <!--
        「价值 ￥xx」不在这里画了：它属于「接收数量」那个框，已经挪到渲染器里紧跟数量框右侧
        （见 OptionFormRenderer 的 valueNoteOf）—— 挂在结论外面时，选个原因也会冒出来一句与结论无关的金额。

        「总件数 / 总金额」也搬走了：现在只在表单开头说一次（见上面的 approval-total）——
        回收类这里再写一遍，同一个数就会出现两次。
      -->

      <!-- 选接收方：渲染器只画"按钮 + 已选 chip"，面板由这里给（候选是团队表，不是整棵通讯录） -->
      <div v-if="pickingField" class="mb-2 remark-row">
        <v-divider class="my-2" />

        <TeamPicker
          :mode="pickingField.pick === 'team' ? 'team' : 'group'"
          :team="pickingField.pick === 'team' ? '' : receiverTeam"
          @select="pickReceiver"
        />
      </div>
    </v-form>

    <!-- 备注 / 审批意见：与上方「label + 控件」同一栅格（左边空出 label 列，右边撑满） -->
    <div class="mt-2  d-flex align-center ga-3">
      <span class="field-label shrink-0 self-start">意见/备注<span v-if="opinionRequired" class="text-error"> *</span></span>

      <v-textarea
        v-model="opinion"
        class="remark-input"
        :counter="300"
        density="compact"
        :error-messages="opinionError"
        :hint="opinionRequired ? '选择「外部环境」类原因时必填' : ''"
        :persistent-hint="opinionRequired"
        :required="opinionRequired"
        rows="2"
        variant="outlined"
      />
    </div>

    <!-- 附件：只保留回形针图标，点击文字同样能唤起选择框 -->
    <div class="remark-row d-flex align-center ga-1">
      <v-file-input
        ref="fileInputRef"
        v-model="attachment"
        class="attachment-input"
        density="compact"
        hide-input
      >
        <template #prepend>
          <v-icon color="#1055C9" size="15">mdi-paperclip</v-icon>
        </template>
      </v-file-input>

      <span
        v-if="attachment"
        class="text-[12px] text-medium-emphasis text-decoration-underline text-truncate"
        :title="attachment.name"
      >
        {{ attachment.name }}
      </span>

      <span v-else class="text-[12px] text-medium-emphasis cursor-pointer" @click="fileInputRef?.click()">上传附件</span>

      <v-btn
        v-if="attachment"
        density="compact"
        icon="mdi-close"
        variant="plain"
        @click="attachment = null"
      >
        <v-icon icon="mdi-close" size="15" />
      </v-btn>
    </div>

    <!-- 提交被拦下的原因（没选办理选项 / 结论在模板里没有后置环节）：贴在按钮上方，别只弹一下 snackbar -->
    <v-alert
      v-if="formError"
      class="mb-2"
      density="compact"
      type="warning"
      variant="tonal"
    >
      {{ formError }}
    </v-alert>

    <div class="d-flex align-center ga-2">
      <v-spacer />
      <v-btn size="small" variant="tonal" @click="emit('cancel')">取消</v-btn>

      <v-btn
        color="primary"
        :disabled="waitingNext"
        :loading="submitting || waitingNext"
        size="small"
        :text="waitingNext ? '正在进入下一环节…' : (hasNextAction ? '提交并继续下一个' : '提交')"
        variant="tonal"
        @click="handleConfirm"
      />
    </div>

    <v-overlay v-model="overlay" class="d-flex align-center justify-center" @click:outside="overlay = false">
      <img
        v-if="imgUrl"
        alt="附件预览"
        class="attachment-preview"
        :src="imgUrl"
        @click="overlay = false"
      >
    </v-overlay>
  </div>
</template>

<script setup lang="ts">
  import type {
    ApprovalChainItem,
    ApprovalNodeOption,
    ApprovalOptionGroup,
    ApprovalOptionLeaf,
    NodeSubmitPayload,
  } from '@/types/approval'
  // 审批类型（选中结论后要填什么）：办理期**只读单据快照**，见 utils/approvalTypes 文件头的边界说明
  import type { ApprovalTypeTemplate, TypeField } from '@/utils/approvalTypes'
  import {
    APPROVAL_RESULTS,
    filterOfferedOptions,
    PICK_MEMBERS_RESULT,
    PICK_TEAM_RESULT,
    receiptLedgerAfter,
    RECEIVE_QTY_RESULT,
  } from '@/types/approval'
  // 环节负责人口径（mainOf）与「连续同人环节」的类型都来自这里，别在组件里另写一套
  import { type ApprovalNextStep, mainOf } from '@/utils/approvalRuntime'
  // REASON_OPTIONS：选项树的叶子就是「原因」本身，办理时按同一份候选补出 reason_* / 分类
  import { isFieldVisible, REASON_OPTIONS, SECOND_REASON_OPTIONS, typeTemplateFromSnapshot } from '@/utils/approvalTypes'
  // 「选择接收组别」的候选：团队表（utils/organazation）——不是整棵飞书通讯录，见组件说明
  import TeamPicker from '../TeamPicker.vue'
  // 表单字段的**唯一渲染器**：审批类型页预览、沙盒、办理页三处共用同一份实现
  import OptionFormRenderer from './OptionFormRenderer.vue'

  /**
   * 表单的输入**与原 ApprovalNode 的 props 一一对应**（同名同义）：
   * 两个调用方都按原来那套传参就行，不需要各自再翻译一遍。
   */
  interface ApprovalHandleFormProps {
    /** 本节点的成员（`data[0]` 那条 manager 就是这一环的办理人） */
    data?: ApprovalChainItem[]
    /** 本环节在 chain 中的下标 */
    index?: number
    /** 审批链总步数（只用于"连续多环"的序号提示） */
    length?: number
    allowedResults?: string[]
    allowedOptions?: ApprovalNodeOption[]
    nextSteps?: ApprovalNextStep[]
    /** 选项条件（offerWhen）的求值上下文：业务快照 + 上一环节结论 */
    optionContext?: Record<string, unknown>
    stockQty?: number | string
    /** 本环节**还能接多少件**（总库存 − 前面各环节已接收） */
    remainingQty?: number | string
    /** 本单关联产品的总库存金额（回收金额的上限） */
    stockAmount?: number | string
    /** 本单所属团队：「选择接收组别」的候选限定在它之内 */
    receiverTeam?: string
    /**
     * 单据快照里的审批类型（`结论码 → 选中后要填什么`，建单期解析好，见 pages/workStream 的 taskPayloadOf）。
     *
     * 办理期**只读这一份**、不回查 approval_types 表：否则今天改模板，历史单的填写项会跟着变。
     * 不传（老单）→ 每个结论回落内置默认，也就是改造前的行为。
     */
    typeTemplates?: Record<string, ApprovalTypeTemplate>
  }

  const props = withDefaults(defineProps<ApprovalHandleFormProps>(), {
    data: () => [],
    index: 0,
    length: 0,
    allowedResults: () => [],
    allowedOptions: () => [],
    nextSteps: () => [],
    optionContext: () => ({}),
    stockQty: '',
    remainingQty: '',
    stockAmount: '',
    receiverTeam: '',
  })

  const emit = defineEmits<{
    (e: 'submit', payload: NodeSubmitPayload): void
    /** 这一环彻底办完了（且后面没有同人的动作）—— 弹窗据此关闭；内联面板没人监听也无妨 */
    (e: 'finish'): void
    (e: 'cancel'): void
  }>()

  /* ==================== 表单状态 ==================== */

  const radios = ref('deal')
  const opinion = ref('')
  /** 提交中，避免重复点击 */
  const submitting = ref(false)
  const waitingNext = ref(false)
  /**
   * 提交被拦下的原因（显示在按钮上方）。
   *
   * 为什么要有它：没有结论就提交，流程会因为"这个结论没命中任何一条分支"而**停在原地**
   * —— 用户看到的就是"审批完了，但没进下一环节"。以前既没拦也不提示，
   * 只在控制台留一条 warn，现场只能靠猜。
   */
  const formError = ref('')
  /** 「意见/备注」这条的校验红字（与 formError 分开：要贴在输入框下面，不能只在按钮上方说） */
  const opinionError = ref('')
  const attachment = ref<File | null>(null)
  const fileInputRef = ref<{ click: () => void } | null>(null)

  /**
   * 审批类型表单的一份扁平值：键 = 字段 key（= 将来写进 `extra` 的键名），
   * 外加候选项带出的附加键（如 `reason_target` / `reason_belong`）。
   * 换结论 / 换环节都整份清空（见下面的 watch 与 resetFormState）。
   */
  const typeValues = ref<Record<string, unknown>>({})
  /** 正在选接收方的那个字段（非空 = 面板展开） */
  const pickingField = ref<TypeField | null>(null)

  /* ==================== 当前要办的是哪一环 ==================== */

  function isNotifyStepData (data?: ApprovalChainItem[]) {
    return !!data?.some(i => i.type === 'notify')
  }

  const actionSteps = computed(() => [
    { index: props.index, data: props.data, allowedOptions: props.allowedOptions, allowedResults: props.allowedResults },
    ...props.nextSteps,
  ])

  /**
   * 当前要办的那一环。
   *
   * ⚠️ 跳过「飞书提醒」环节：它没有办理人、也不会有 handled_at，
   *    不跳过的话 `mainOf(提醒环)` 兜底取到那条 notify 成员、永远"未办理"，
   *    于是表单会对着一个不需要办的环节显示出来。
   */
  const activeStep = computed(() => actionSteps.value.find(s => !isNotifyStepData(s.data) && !mainOf(s.data)?.handled_at))

  /** 当前动作在组内的序号（从 1 起）与动作总数：>1 时提示"办完自动接下一环" */
  const actionNo = computed(() => actionSteps.value.findIndex(s => s.index === activeStep.value?.index) + 1)
  const actionTotal = computed(() => actionSteps.value.length)

  /** 当前动作之后还有没有同人的动作 —— 有就先不关窗，落库后接着办（见 handleConfirm） */
  const hasNextAction = computed(() => {
    const i = actionSteps.value.findIndex(s => s.index === activeStep.value?.index)
    return i !== -1 && i < actionSteps.value.length - 1
  })

  /* ==================== 已办动作回显 ==================== */

  /** 一条办理流水里的选项明细（extra）→ { label, value } 列表 */
  function extraItemsOf (extra?: Record<string, unknown>) {
    if (!extra) return []
    return Object.entries(extra)
      // members（接收组别）不在明细里重复展示
      .filter(([key]) => key !== 'members')
      .filter(([key]) => !/_target$|^option_/.test(key))
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([key, v]) => ({
        key,
        label: EXTRA_LABELS[key] ?? key,
        // 「接收组别」这类值是成员对象（单选）或成员数组（多选）：拼名字展示，别渲染成 [object Object]
        value: v !== null && typeof v === 'object'
          ? (Array.isArray(v) ? v : [v])
            .map(x => memberLabel(x))
            .filter(Boolean)
            .join('、')
          : typeof v === 'boolean'
            ? (v ? '已确认' : '未确认')
            : String(v),
      }))
      .filter(item => item.value !== '')
  }

  const EXTRA_LABELS: Record<string, string> = {
    qty: '数量',
    amount: '金额',
    confirmed: '确认状态',
    reason: '原因',
    reason_belong: '分类',
    second_reason: '二级原因',
    remark: '补充说明',
    members: '接收方',
    received_qty: '已接收',
    remaining_qty: '剩余',
    stock_qty: '总件数',
    stock_amount: '总金额',
  }

  /**
   * 成员对象（接收方 / 办理人）的展示文案：名字 +（有负责人就带上）负责人。
   * 措辞按**粒度**走：团队级叫「负责人」，组级叫「组长」——
   * 同一件东西在办理表单、时间线、明细三处不该长得不一样。
   */
  function memberLabel (x: unknown): string {
    if (!x || typeof x !== 'object') {
      return String(x ?? '')
    }
    const name = String((x as { name?: unknown }).name ?? '')
    const leader = (x as { manager?: unknown }).manager
    if (!leader) {
      return name
    }
    return `${name}（负责人 ${String(leader)}）`
  }

  function optionPathOf (extra?: Record<string, unknown>) {
    const group = String(extra?.option_group ?? '').trim()
    if (!group) return ''
    return [group, extra?.option_text, extra?.option_child]
      .map(v => String(v ?? '').trim())
      .filter(Boolean)
      .join(' / ')
  }

  function actionResultOf (step: { data: ApprovalChainItem[] }) {
    const m = mainOf(step.data)
    if (!m?.result) return null
    return {
      label: String(m.result_label || m.result || ''),
      path: optionPathOf(m.extra),
      opinion: String(m.opinion ?? '').trim(),
      extras: extraItemsOf(m.extra),
      files: m.files ?? [],
    }
  }

  const doneActions = computed(() =>
    actionSteps.value.map(actionResultOf).filter((x): x is NonNullable<typeof x> => !!x),
  )

  /* ==================== 附件预览 ==================== */

  const overlay = ref(false)
  const imgUrl = ref('')
  function showPic (url: string) {
    overlay.value = true
    imgUrl.value = url
  }

  /* ==================== 处理方式（选项） ==================== */

  const optionItems = computed<ApprovalNodeOption[]>(() => {
    // 取**当前要办的那个动作**的选项（同一审批人连续多环时，动作会随着办理推进而前移）
    const step = activeStep.value
    const raw: ApprovalNodeOption[] = step?.allowedOptions?.length
      ? step.allowedOptions
      : (step?.allowedResults?.length ? step.allowedResults : ['pass', 'reject'])
        .map(v => ({ result: v, text: APPROVAL_RESULTS.find(r => r.value === v)?.label ?? v }))

    /*
     * 「选项条件」（offerWhen，模板里配在分支上）：按上下文过滤 —— 典型场景是同一个环节
     * 不同来路给不同选项（如"上一环节结论不是 not_receive 才给「同意接收」"）。
     * 只影响渲染、不参与选路；**全被过滤光时会退回原列表**（见 filterOfferedOptions），
     * 否则办理人会卡在"没有可选项"上。
     */
    const offered = filterOfferedOptions(raw, props.optionContext)

    /*
     * 「审批类型」里停用的结论**不摆给办理人**（口径见 utils/approvalTypes 的 enabled）。
     *
     * 为什么必须在这里做：模板把结论摆上来（optionItems 来自 flow 分支），而"这个结论还启不启用"
     * 是审批类型页配的 —— 两处不联动时，页面上会出现明明已经停用的选项，选中走完还是一条死线。
     * 与沙盒（pages/sandbox.vue 的 visibleOptions）**同一套口径**：
     *   · 选项树（nodeLevel）不过滤：它的叶子是模板里一条条配出来的，不归审批类型管；
     *   · 全被停用时退回原列表：宁可多摆一个，也不能让人无路可走。
     */
    if (offered.some(o => o.nodeLevel)) {
      return offered
    }
    const enabled = offered.filter(o => typeTemplateFromSnapshot(props.typeTemplates, o.result).enabled !== false)
    return enabled.length > 0 ? enabled : offered
  })

  /**
   * 一个选项的**唯一键**：文案 + 结论码。
   * 同一条线配了多个选项文本时它们**共用同一个结论码**，只有这个键能区分选的是哪一个。
   */
  function optionKeyOf (o: { result: string, text: string }): string {
    return `${o.text}|${o.result}`
  }

  /** 下拉候选项：在选项上补一个 key（供 v-select 的 item-value 用） */
  const selectItems = computed(() => optionItems.value.map(o => ({ ...o, key: optionKeyOf(o) })))

  const RADIO_MAX = 3

  /** 这次用 radio 还是下拉（两种形态绑定同一个 selectedOptionKey，提交逻辑完全一致） */
  const useOptionRadios = computed(() => selectItems.value.length <= RADIO_MAX)

  function radioColorOf (result: string): string {
    if (result === 'reject' || result === 'discard' || result === 'scrap') {
      return 'error'
    }
    return result === 'pass' || result === 'receive' || result === RECEIVE_QTY_RESULT ? 'success' : 'primary'
  }

  /** 当前选中的**键** —— v-model 绑它，才分得清同码的多个选项 */
  const selectedOptionKey = ref('')

  /** 当前选中的选项；文案与结论码都从它取，不再"按码猜文案" */
  const selectedOption = computed(() => selectItems.value.find(o => o.key === selectedOptionKey.value))

  /** 选中的一级选项（二级候选项由它带出来）—— 声明在这里是因为下面的 selectedResult 要读它的链路 */
  const pickedLeaf = ref<ApprovalOptionLeaf | null>(null)

  const selectedResult = computed(() => {
    const opt = selectedOption.value
    if (opt?.nodeLevel) {
      return pickedLeaf.value?.link || ''
    }
    return opt?.result ?? ''
  })

  const hasNodeLevelTree = computed(() => optionItems.value.length === 1 && !!optionItems.value[0]?.nodeLevel)

  /** 某个结论码在**本环节**的显示文案（优先模板给它的名字；同码多选项时只能取第一个，仅作兜底） */
  function labelOf (result: string): string {
    return optionItems.value.find(o => o.result === result)?.text
      ?? APPROVAL_RESULTS.find(r => r.value === result)?.label
      ?? result
  }

  function customLabelOf (result: string): string {
    const t = String(selectedOption.value?.text ?? '').trim()
    const def = APPROVAL_RESULTS.find(r => r.value === result)?.label ?? ''
    return t && t !== def ? t : ''
  }

  /** 选项异步到达、或换到下一个动作后，同步一个合法默认值，避免空选提交 */
  watch(
    [() => activeStep.value?.index, () => activeStep.value?.allowedOptions],
    () => {
      const opts = selectItems.value
      if (!opts.some(o => o.key === selectedOptionKey.value)) {
        selectedOptionKey.value = opts[0]?.key ?? ''
      }
    },
    { immediate: true },
  )

  /** 换到下一环（连续多环）：表单整体回到初始值，上一环填的内容不能留在下一环上 */
  watch(
    () => activeStep.value?.index,
    (now, before) => {
      if (now === before) return
      resetFormState()
      // 这一环已经没得办了（别人办完 / 单据办结）：通知外壳可以收起来了
      if (now === undefined) {
        emit('finish')
      }
    },
  )

  /* ==================== 补充信息（数量 / 金额 / 原因） ==================== */

  /** 办理表单（审批类型字段的宿主）—— 提交前用它 validate()；渲染器里的输入会挂到同一棵 form 上 */
  type HandleForm = {
    validate: () => Promise<{ valid: boolean, errors: string[] }>
    resetValidation: () => void
  }
  const handleForm = ref<HandleForm | null>(null)

  /** 产品总库存数量（页面下发）；没配到就是空串 —— 那种情况下退回手填，不把人卡住 */
  const stockQtyText = computed(() => {
    const v = props.stockQty
    return v === null || v === undefined || v === '' ? '' : String(v)
  })

  /**
   * 本环节的**接收上限**：优先「剩余接收数量」（= 总库存数量 − 前面各环节已接收）；
   * 页面没下发（老单 / 没关联产品）时退回「总库存数量」，再没有就留空退回手填。
   *
   * 为什么必须按剩余算：一批货被上游**部分接收**后，剩下的才轮到本环节 ——
   * 上限与「全部接收」的取值都以它为准，否则后面的组会按**原始总量**再收一遍，账就重复了。
   */
  const receiveCapText = computed(() => {
    const v = props.remainingQty
    return v === null || v === undefined || v === '' ? stockQtyText.value : String(v)
  })
  /** 上限取的是「剩余」还是「总库存」：提示语与校验文案要写对 */
  const usingRemaining = computed(() => receiveCapText.value !== '' && receiveCapText.value !== stockQtyText.value)
  /** 前面各环节已接收多少（= 总 − 剩余）：两个数都取到时才显示，供办理人核对 */
  const receivedQtyText = computed(() => {
    const total = Number(stockQtyText.value)
    const left = Number(receiveCapText.value)
    return usingRemaining.value && Number.isFinite(total) && Number.isFinite(left) ? String(total - left) : ''
  })

  /** 产品总库存**金额**（页面下发）：回收金额的上限，口径与总库存数量同一套 */
  const stockAmountText = computed(() => {
    const v = props.stockAmount
    return v === null || v === undefined || v === '' ? '' : String(v)
  })

  /**
   * 「剩余数量值多少钱」已经由渲染器贴在数量框右侧（见 OptionFormRenderer 的 valueNoteOf），
   * 这里不再留一份：挂在结论外面时它跟"选了哪个结论"无关，选个原因也会冒出一句金额。
   */

  /* ==================== 审批类型（选中结论后要填什么） ==================== */

  /**
   * 当前结论生效的类型模板 —— **只读单据快照**，不回查 approval_types。
   * 老单 / 没配过 → 内置默认（= 改造前的行为，见 utils/approvalTypes 的 DEFAULT_TYPE_TEMPLATES）。
   */
  const typeTemplate = computed(() => typeTemplateFromSnapshot(props.typeTemplates, selectedResult.value))

  /**
   * 选项树选中的叶子 → 它对应的「原因」候选（叶子文案与 REASON_OPTIONS 一一对应）。
   *
   * 只在**这个结论本来就要填原因**（模板里有 reason 字段，典型是 other_reason）时才有值：
   * 那种情况下叶子本身就是答案，办理页不该再问第二遍，记录里也不该缺这一项。
   */
  const leafReasonOption = computed(() => {
    const leaf = pickedLeaf.value
    if (!leaf || !typeTemplate.value.fields.some(f => f.key === 'reason')) {
      return undefined
    }
    return REASON_OPTIONS.find(o => o.value === leaf.text)
  })

  /**
   * 这一环要填的字段（数量 / 金额 / 原因 / 选接收方…，全部由模板给）。
   *
   * 选项树已经问过的东西**不再问第二遍**（同一个问题出现两个控件，现场最容易当成"选项错了"）：
   *   · 叶子本身就是原因 → 去掉「原因」下拉（值由叶子镜像，见 collectResult）；
   *   · 叶子带二级、且那一串就是「二级原因」候选 → 去掉「二级原因」下拉
   *     （值由「二级选项」镜像，见下面的 seedSecondReason）。否则会出现两个"二级…"下拉。
   */
  const typeFields = computed(() => {
    const dropReason = !!leafReasonOption.value
    const dropSecondReason = childIsSecondReason.value
    return typeTemplate.value.fields.filter(f =>
      !(dropReason && f.key === 'reason') && !(dropSecondReason && f.key === 'second_reason'),
    )
  })

  /** 渲染器要的上限 / 旁注数值（口径与改造前的 receiveCapText / stockQtyText 一致） */
  const typeContext = computed(() => ({
    stockQty: stockQtyText.value,
    remainingQty: receiveCapText.value,
    receivedQty: receivedQtyText.value,
    stockAmount: stockAmountText.value,
  }))

  /**
   * 本次选中的原因属于哪个分类（候选的 data 带出来的 `reason_belong`）。
   *
   * 两个来路都会写进表单值：
   *   · 模板里直接有「原因」下拉 → 渲染器选中时写入（见 OptionFormRenderer.setValue）；
   *   · 选项树的叶子本身就是原因 → 上面的 leafReasonOption 镜像进来。
   */
  const reasonBelong = computed(() => {
    const direct = String(typeValues.value.reason_belong ?? '').trim()
    if (direct) {
      return direct
    }
    /*
     * 兜底：叶子本身就是原因、但这个结论的模板没有「原因」字段（如 link=cat_env 的模板），
     * 表单值里就没有 reason_belong —— 按叶子文案回查一次，别让"必填"在这类模板上失效。
     */
    const leaf = pickedLeaf.value
    return leaf ? String(REASON_OPTIONS.find(o => o.value === leaf.text)?.data?.reason_belong ?? '') : ''
  })

  /**
   * 「外部环境」类：**意见/备注必填**。
   *
   * 这一类的原因（政策与法规变化 / 自然灾害…）说不清具体影响，业务上要求必须写清楚说明；
   * 而类型模板里**不再给它单独的「补充说明」框**（见 utils/approvalTypes 的说明），
   * 说明统一写在下方共用的「意见/备注」里 —— 所以这里把那一栏设成必填。
   *
   * 两种落法都算：选了**外部环境类的某个原因**（reason_belong），
   * 或模板把「外部环境类」直接做成结论（码表里的 `cat_env`）。
   */
  const opinionRequired = computed(() =>
    reasonBelong.value === '外部环境' || selectedResult.value === 'cat_env',
  )

  /** 意见/备注必填时的提示语（watcher 里要按它清 formError，抽出来避免两处文案漂） */
  const OPINION_REQUIRED_HINT = '选择「外部环境」类原因时，意见/备注必填'

  /**
   * 换结论就把整份表单清空：上一个结论的值不能带进下一个
   * （同一个 `qty` 在接收类里是"收多少"、在回收类里是"回收多少"，语义不同）。
   */
  watch(() => typeTemplate.value.code, () => {
    typeValues.value = {}
    pickingField.value = null
  })

  /**
   * 叶子就是原因：把它带出的分类（reason_belong / reason_target）先写进表单值，
   * 模板里「二级原因 / 补充说明」的 showWhen 才有依据（它们判的就是 reason_belong）。
   *
   * 必须写在上面那条"换结论清空表单"**之后**：换叶子时模板码也会变，先清空再写种子值。
   */
  watch(leafReasonOption, opt => {
    const next: Record<string, unknown> = { ...typeValues.value }
    delete next.reason
    delete next.reason_target
    delete next.reason_belong
    if (opt) {
      next.reason = opt.value
      Object.assign(next, opt.data ?? {})
    }
    typeValues.value = next
  })

  /** 点「选接收方」：面板由这里托管（渲染器只负责按钮与已选 chip） */
  function startPick (field: TypeField) {
    pickingField.value = field
  }

  /**
   * 选中一个接收方（来自 TeamPicker，两种粒度共用这一段）。
   *
   * 存的是**名字**（`name`）+ **负责人**（`manager`）：
   *   · 组别模式（「选择接收组别」）—— 组别名 + 该组组长；
   *   · 团队模式（「选择接收团队」）—— 团队名 + 团队负责人（`parentManager`）。
   * `type: 'manager'` 沿用旧口径（接收方占"办理人"那一格），时间线据此单独渲染一个节点。
   */
  function pickReceiver (t: { name: string, manager?: string }) {
    const field = pickingField.value
    if (!field) {
      return
    }
    const member = {
      name: t.name,
      ...(t.manager ? { manager: t.manager } : {}),
      type: 'manager',
      pick: field.pick === 'team' ? 'team' : 'group',
    }
    // 渲染器里选人控件按**数组**放（同一个控件单选 / 多选都能用）；写库时取第一个（见 collectResult）
    typeValues.value = { ...typeValues.value, [field.key]: [member] }
    pickingField.value = null
  }

  /**
   * 「回收」类结论：额外把"这批货总共多少"摆出来当旁注。
   * 只是提示，不参与校验（上限由模板字段的 `limit` 管）。
   */
  const needRecycle = computed(
    () => selectedResult.value === 'recycle' || selectedResult.value === 'supplier_recycle',
  )

  /** 表单值的文本形态（undefined / null 一律空串：别把 "undefined 件" 写进标签） */
  function textOf (value: unknown): string {
    return value === undefined || value === null ? '' : String(value)
  }

  /**
   * 接收类结论的账：把「已接收 / 剩余」一并写进结论的 extra。
   *
   * 条件求值**不依赖它**（引擎自己按流水算），写进来是为了记录**可追溯、可统计**。
   * 算不出来（老单 / 没关联产品）就什么都不写 —— 宁可空着，也别在记录里留半截假数字。
   */
  function withReceiveLedger (extra: Record<string, unknown>, thisQty: unknown): Record<string, unknown> {
    const ledger = receiptLedgerAfter(stockQtyText.value, receiveCapText.value, thisQty)
    if (ledger) {
      extra.received_qty = String(ledger.received)
      extra.remaining_qty = String(ledger.remaining)
    }
    return extra
  }

  /**
   * 回收类结论的账：把**这批货本身**（总件数 / 总金额）也写进结论 extra。
   * 只写**展示用的副本**，不动 `qty` / `amount` 这两个业务字段的语义。
   */
  function withRecycleLedger (extra: Record<string, unknown>): Record<string, unknown> {
    if (stockQtyText.value !== '') {
      extra.stock_qty = stockQtyText.value
    }
    if (stockAmountText.value !== '') {
      extra.stock_amount = stockAmountText.value
    }
    return extra
  }

  /**
   * 回收类结论的**显示标签**：把本次填的件数 / 金额写进标签，
   * 与「部分接收 100 件」同一个口径 —— 时间线的结论胶囊、表格的「审批结论」列都直接读标签。
   * 值从 `extra` 取（键名仍是 qty / amount，与改造前一致）。
   */
  function recycleLabel (base: string, extra: Record<string, unknown>): string {
    const qty = textOf(extra.qty).trim()
    const amount = textOf(extra.amount).trim()
    const parts = [qty ? `${qty} 件` : '', amount ? `￥${amount}` : ''].filter(Boolean)
    return parts.length > 0 ? `${base} ${parts.join(' / ')}` : base
  }

  /*
   * 「原因 / 二级原因 / 补充说明」的候选与联动已收回 utils/approvalTypes
   * （REASON_OPTIONS / SECOND_REASON_OPTIONS + other_reason 模板的 showWhen）——
   * 组件这一份**故意不再保留**：两份并存时只改一处，现象是"页面上选不到新加的原因"。
   *
   * 「接收数量」的预填同理交给渲染器（字段的 prefillFromLimit / readonlyWhenFull），
   * 组件只负责给它**重新挂载**的时机（模板里 OptionFormRenderer 的 :key 带环节下标）。
   */

  /* ==================== 模板配的「选项树」（类别 → 一级 → 二级） ==================== */

  const pickedGroups = computed<ApprovalOptionGroup[]>(() => selectedOption.value?.groups ?? [])

  /** 「驳回」的结论码：必须与保存期注入的驳回分支条件（`{ field:'result', op:'eq', value:'reject' }`）一致 */
  const REJECT_RESULT = 'reject'

  const optionMenuItems = computed(() => {
    const list: Array<ApprovalOptionLeaf | { type: 'subheader', text: string }> = []
    for (const g of pickedGroups.value) {
      list.push({ type: 'subheader', text: g.title || '未分类' }, ...g.items)
    }
    const hasRejectLeaf = pickedGroups.value.some(g => (g.items ?? []).some(i => i.link === REJECT_RESULT))
    if (selectedOption.value?.nodeLevel && selectedOption.value?.canReject && !hasRejectLeaf) {
      list.push({ type: 'subheader', text: '其它' }, { text: '驳回', link: REJECT_RESULT })
    }
    return list
  })

  /** 二级候选项：**只有选中了带二级的一级选项才有值** */
  const leafChildren = computed(() => pickedLeaf.value?.children ?? [])

  /** 选中的二级文案（一级没有二级时为空，不提交它） */
  const pickedChild = ref('')

  /**
   * 选项树的「二级选项」是不是**就是「二级原因」那一套**（开发类的原因要再细分到部门）。
   *
   * 判断按候选文案比对（忽略空白）：模板里两处都配了时，界面上会并排出两个"二级…"下拉 ——
   * 现场反馈的"选了开发原因，出现两个二级原因的选项"就是这个。
   * 只有对得上才敢合并：万一某张模板的二级是别的分类，就仍由类型模板那个字段来问。
   *
   * 另外要求当前结论的模板**确实有** second_reason 字段：否则没必要镜像。
   */
  const childIsSecondReason = computed(() => {
    if (!typeTemplate.value.fields.some(f => f.key === 'second_reason')) {
      return false
    }
    const kids = leafChildren.value
    if (kids.length === 0) {
      return false
    }
    const known = new Set(SECOND_REASON_OPTIONS.map(o => String(o.value).trim()))
    return kids.some(k => known.has(String(k).trim()))
  })

  /**
   * 处理方式一变（或它带的树变了）就**清空**一级 / 二级，避免留下上一棵树里的选择。
   *
   * ⚠️ 这里以前是"默认选树里的第一个叶子（连二级也取第一个）"—— 那等于替办理人做了决定：
   *    选项树动辄十几二十个叶子，下拉合着的时候根本看不出已经选了一个，点「提交」就把
   *    一个**没人选过**的结论写进流水、并按它走分支。现场反馈的"审批选项错了"就是这个。
   *    现在一律留空，由办理人自己选（提交前有必选校验，见 handleConfirm）。
   *
   * ⚠️ 这两条 watch 必须写在 pickedGroups / pickedChild **声明之后**：
   * `const` 是不提升的，放到前面会在模块初始化时就抛"used before declaration"。
   */
  watch(
    [selectedOption, pickedGroups],
    () => {
      pickedLeaf.value = null
      pickedChild.value = ''
    },
    { immediate: true, deep: true },
  )

  /** 选中带二级的一级选项时，二级仍预填第一个（它只是对已选叶子的细分，且一级文案已经显示出来了） */
  watch(pickedLeaf, leaf => {
    pickedChild.value = leaf?.children?.[0] ?? ''
  })

  /** 上一轮是不是把「二级选项」镜像成了 typeValues.second_reason（换叶子时要撤掉，别留残余） */
  let seededSecondReason = false

  /**
   * 把「二级选项」镜像成 `second_reason` / `second_reason_target`。
   *
   * 为什么要镜像而不是各存各的：分支条件里配的键是 `second_reason`（见 utils/conditionFields），
   * 记录明细里展示的也是它；只存 `option_child` 的话，选路与明细都会缺这一项。
   * 镜像之后界面只留一个二级下拉（另一个被 typeFields 滤掉），两边数据仍然一致。
   */
  watch([pickedChild, childIsSecondReason], () => {
    if (!childIsSecondReason.value) {
      if (!seededSecondReason) {
        return
      }
      // 换成不带二级的原因 / 换结论：把上次镜像的值撤掉
      const next = { ...typeValues.value }
      delete next.second_reason
      delete next.second_reason_target
      typeValues.value = next
      seededSecondReason = false
      return
    }

    const hit = SECOND_REASON_OPTIONS.find(o => String(o.value).trim() === String(pickedChild.value).trim())
    const next = { ...typeValues.value }
    delete next.second_reason
    delete next.second_reason_target
    if (hit) {
      next.second_reason = hit.value
      Object.assign(next, hit.data ?? {})
      seededSecondReason = true
    }
    typeValues.value = next
  }, { immediate: true })

  /** 选项一改就把上一次的拦截提示收掉（那是针对上一次选择的） */
  watch([selectedOptionKey, pickedLeaf, pickedChild], () => {
    formError.value = ''
  })

  /**
   * 「意见/备注」补上之后立刻收掉红字；换成非外部环境的原因也一并收掉 ——
   * 改完了还红着，用户会以为校验没生效。
   */
  watch([opinion, opinionRequired], () => {
    if (!opinionError.value) {
      return
    }
    if (opinion.value.trim() !== '' || !opinionRequired.value) {
      opinionError.value = ''
      if (formError.value === OPINION_REQUIRED_HINT) {
        formError.value = ''
      }
    }
  })

  /* ==================== 表单重置 ==================== */

  function resetFormState () {
    /*
     * 结论回到**这一环的第一个选项**（与挂载时同一口径）。
     * 不能写空串：空串会让 selectedOption 变 undefined，选项树整块从界面上消失
     * （pickedGroups 取的就是选中项的 groups），下一环要等 props 变化才恢复。
     */
    selectedOptionKey.value = selectItems.value[0]?.key ?? ''
    pickedLeaf.value = null
    pickedChild.value = ''
    // 审批类型表单整份清空：下一环要填的字段可能完全不同（渲染器会按新结论重新预填）
    typeValues.value = {}
    pickingField.value = null
    opinion.value = ''
    attachment.value = null
    formError.value = ''
    opinionError.value = ''
    // 下一环的数据到了（或已经没得办）：解除"等待中"，按钮恢复可用
    waitingNext.value = false
    // 表单校验状态一并清掉：连续多环时上一环的红字不能留在下一环的输入框上
    handleForm.value?.resetValidation()
  }

  /* ==================== 组装结论 & 提交 ==================== */

  /** 渲染器的选人控件按数组放；库里 `members` 一直是**单个对象**（时间线据此单独渲染接收方节点） */
  function firstReceiver (value: unknown): unknown {
    return Array.isArray(value) ? value[0] : value
  }

  /**
   * 组装本环节的结论。
   *
   * 字段部分**完全由审批类型模板决定**（快照里那一份）：
   *   ① 固定值（如报废清仓的 confirmed）→ ② 当前**可见**的字段值（被 showWhen 隐藏的不带出去）
   *   → ③ 内置副作用（接收台账 / 接收方文案）。
   * 结论文案仍按码拼（`部分接收 100 件` 这类带值的标签是全站共用的展示口径，别在这里改口径）。
   */
  function collectResult (): { result: string, result_label: string, extra: Record<string, unknown> } {
    const extra: Record<string, unknown> = {}
    const type = typeTemplate.value

    // 选项树（类别 → 一级 → 二级）与类型模板正交：它管"摆哪些选项、选中走哪条线"
    if (pickedLeaf.value) {
      const leaf = pickedLeaf.value
      const child = pickedChild.value

      Object.assign(extra, type.fixedValues ?? {})

      // 类别按「文案 + 链路」回查（不按对象身份比 —— 经过响应式包装 / 下拉穿透后身份不保证相同）
      extra.option_group = pickedGroups.value
        .find(g => g.items.some(i => i.text === leaf.text && i.link === leaf.link))
        ?.title ?? ''
      extra.option_text = leaf.text
      extra.option_link = leaf.link
      if (child) {
        extra.option_child = child
      }

      /*
       * 叶子本身就是「原因」（叶子文案与 REASON_OPTIONS 一一对应）：
       * 把它连同分类一起记下来，二级原因 / 补充说明才有依据（它们判的就是 reason_belong）。
       */
      const reason = leafReasonOption.value
      if (reason) {
        extra.reason = reason.value
        Object.assign(extra, reason.data ?? {})
      }

      /*
       * 类型模板里其余字段（数量 / 金额 / 接收方 / 二级原因 / 补充说明…）照常收集。
       * 以前这里直接 return，等于把办理人填的这些值**整块丢掉** —— 表单上填了、记录里没有，
       * 时间线上看起来就像"选了个假的选项"。
       */
      for (const field of type.fields) {
        if (field.key === 'reason' && reason) {
          continue
        }
        if (!isFieldVisible(field, typeValues.value)) {
          continue
        }
        const value = typeValues.value[field.key]
        if (value === undefined || value === null || String(value).trim() === '') {
          continue
        }
        extra[field.key] = field.key === 'members' ? firstReceiver(value) : value
      }
      if ((type.effects ?? []).includes('receive_ledger')) {
        withReceiveLedger(extra, extra.qty)
      }
      if (needRecycle.value) {
        withRecycleLedger(extra)
      }

      return {
        result: leaf.link,
        result_label: child ? `${leaf.text}·${child}` : leaf.text,
        extra,
      }
    }

    const result = selectedResult.value

    Object.assign(extra, type.fixedValues ?? {})

    for (const field of type.fields) {
      if (!isFieldVisible(field, typeValues.value)) {
        continue
      }
      const value = typeValues.value[field.key]
      if (value === undefined || value === null || String(value).trim() === '') {
        continue
      }
      extra[field.key] = field.key === 'members' ? firstReceiver(value) : value
    }

    const effects = type.effects ?? []
    if (effects.includes('receive_ledger')) {
      withReceiveLedger(extra, extra.qty)
    }
    // 「这批货总共多少」是回收类的展示副本（不是模板能力，也别往模板里塞）
    if (needRecycle.value) {
      withRecycleLedger(extra)
    }

    return { result, result_label: resultLabelOf(result, extra), extra }
  }

  /**
   * 结论文案：带值的标签（部分接收 100 件 / 回收 100 件 / ￥200 / 接收团队：X（负责人 Y））在这里拼。
   * 值是空的就不拼（`部分接收 0 件` 是改造前就有的兜底，保持不变）。
   */
  function resultLabelOf (result: string, extra: Record<string, unknown>): string {
    const custom = customLabelOf(result)
    switch (result) {
      case 'receive': {
        return custom || '全部接收'
      }
      case 'part_receive': {
        return `部分接收 ${textOf(extra.qty) || 0} 件`
      }
      case RECEIVE_QTY_RESULT: {
        return `接收 ${textOf(extra.qty) || 0} 件`
      }
      case 'recycle':
      case 'supplier_recycle': {
        return recycleLabel(result === 'recycle' ? '回收' : '供应商回收', extra)
      }
      case 'scrap': {
        // 选中即确认：结论本身就是"确认清仓"这个动作（固定值见模板的 fixedValues）
        return custom || '报废清仓'
      }
      case 'rework': {
        // 模板在「审批结论」右侧配了选项文本时以它为准（同一条线的多个选项文案不同、码相同）
        return custom || '建议返工'
      }
      case 'discard': {
        return custom || '建议弃置'
      }
      case 'other_reason': {
        return textOf(extra.reason) || labelOf(result)
      }
      case PICK_MEMBERS_RESULT:
      case PICK_TEAM_RESULT: {
        const m = (extra.members ?? {}) as { name?: string, manager?: string, pick?: string }
        const isTeam = m.pick === 'team'
        const title = isTeam ? '选择接收团队' : '选择接收组别'
        // 结论文案带上「名字 + 负责人」：时间线上一眼能看出这一环把货交给了谁、找谁
        return m.name
          ? `${title}：${m.name}${m.manager ? `（${isTeam ? '负责人' : '组长'} ${m.manager}）` : ''}`
          : title
      }
      case 'pending': {
        return '待定'
      }
      case 'lack_demand': {
        return '市场需求不足'
      }
      case 'reject': {
        return '驳回'
      }
      default: {
        const finalResult = result || 'pass'
        return custom || labelOf(finalResult)
      }
    }
  }

  async function handleConfirm () {
    // 正在提交 / 上一环刚提交、同人的下一环还没传回来：都不该再发一次
    if (submitting.value || waitingNext.value) return
    const step = activeStep.value
    if (!step) return

    /*
     * 选项树必须由办理人自己选一个叶子。
     * 以前默认预选第一个，这里就"永远有值"；现在不预选了，不选就提交会带上空结论
     * （result 为空 → 流程里没有分支命中 → 停在原地），所以先拦下来说清楚。
     */
    formError.value = ''
    opinionError.value = ''
    if (hasNodeLevelTree.value && !pickedLeaf.value) {
      formError.value = '请选择「办理选项」后再提交'
      return
    }

    if (handleForm.value) {
      const { valid } = await handleForm.value.validate()
      if (!valid) return
    }

    /*
     * 「外部环境」类必须写意见/备注（见 opinionRequired 的说明）。
     * 放在渲染器校验**之后**：先解决字段本身的问题，再补这段说明，两处红字不会一起炸。
     */
    if (opinionRequired.value && opinion.value.trim() === '') {
      opinionError.value = OPINION_REQUIRED_HINT
      formError.value = OPINION_REQUIRED_HINT
      return
    }
    const { result, result_label, extra } = collectResult()
    // 兜底的同一件事：没有有效结论就别发请求（空结论会让单据卡在本环节）
    if (!result) {
      formError.value = '请选择「办理选项」后再提交'
      return
    }
    submitting.value = true
    emit('submit', {
      // 提交的是**当前动作**那一环（同一审批人连续多环时，可能是本人这组的第 2、3 环）
      index: step.index,
      result,
      result_label,
      extra,
      opinion: opinion.value.trim(),
      files: attachment.value ? [attachment.value] : [],
      done: (ok: boolean, info?: { sameApproverNext?: boolean }) => {
        submitting.value = false
        if (!ok) return

        if (hasNextAction.value || info?.sameApproverNext) {
          waitingNext.value = true
          return
        }
        // 这一组的动作全办完了：弹窗外壳据此关闭（内联面板没有监听者，等于什么都不做）
        emit('finish')
      },
    })
  }

  /**
   * 给外壳用：弹窗关闭时把"等待下一环"清掉 ——
   * 否则下次打开还是禁用状态（提交成功后马上关窗是最常见的操作）。
   */
  defineExpose({ reset: resetFormState })
</script>

<style scoped lang="scss">
// 「label + 控件」这套栅格的两段尺寸：抽成变量，备注行要按同一套数值缩进，免得两处各改一份
$label-col: 88px;
$label-gap: 12px;

/*
 * 表单开头的整单总量（总件数 / 已接收 / 总金额）：
 * 一条浅色摘要行 —— 它不是输入项，用底色与下面的表单项区分；数值加粗一档，扫一眼就能读到。
 * 底色用 on-surface 的低透明度（跟着深浅色主题走），不写死灰色。
 */
.approval-total {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 16px;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.04);

  b {
    font-size: 12px;
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.87);
  }
}

.field-label {
  font-size: 12px;
  line-height: 1.5;
  /*
   * 固定 label 列宽：各行 label 字数不同（"选择处理方式" 6 字 / "办理选项" 4 字），
   * 不定宽的话右侧控件起点会一行一个位置 —— 定宽后所有输入框左边缘对齐。
   */
  min-width: $label-col;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

/*
 * 备注 / 审批意见没有独立 label（标题就是它自己），但要与上面的控件**同一起止线**：
 * 左边空出 label 列 + 行内间距，右边由 v-textarea 撑满容器。
 */
.remark-row {
  padding-left: calc(#{$label-col} + #{$label-gap});
}

// 补充说明输入框：改「内部」字体必须用 :deep() 穿透 scoped 边界，
// 否则选择器编译成 .remark-input[data-v-xxx] textarea，匹配不到 Vuetify 内部的 textarea。
.remark-input {

  // 输入文字
  :deep(textarea) {
    font-size: 13px;
    line-height: 1.6;
  }

  // placeholder 是原生伪元素，要挂在 textarea 上而不是外层容器
  :deep(textarea::placeholder) {
    font-size: 12px;
    color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  }
}

// 附件选择：只露出 prepend 的回形针图标，隐藏输入框本体
.attachment-input {
  flex: 0 0 auto;
  max-width: 20px;

  :deep(.v-input__control) {
    display: none;
  }
}

// 数量 / 金额输入框：缩小字号、高度
.qty-input {
  :deep(.v-field) {
    --v-field-padding-top: 1px;
    --v-field-padding-bottom: 1px;
    --v-input-control-height: 30px;
    font-size: 12px;
  }

  :deep(.v-field__input) {
    min-height: 30px;
    padding-top: 1px;
    padding-bottom: 1px;
  }

  :deep(.v-label) {
    font-size: 12px;
  }
}

.attachment-preview {
  max-width: 90vw;
  max-height: 90vh;
  border-radius: 10px;
  cursor: zoom-out;
}
</style>
