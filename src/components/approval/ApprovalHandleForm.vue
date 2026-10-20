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
          <span v-for="f in d.files" :key="f.id"
            class="d-inline-flex align-center cursor-pointer text-[#89898A] underline" @click="showPic(f.url)">
            <v-icon size="11">mdi-paperclip</v-icon>
            <span class="mt-1">{{ f.name }}</span>
          </span>
        </div>
      </div>
    </div>

    <v-alert v-if="waitingNext" density="compact" type="info" variant="tonal" class="mb-3">
      已提交，正在进入下一环节（还是你办理）…
    </v-alert>
    <v-form v-if="radios == 'deal'" ref="handleForm" @submit.prevent="handleConfirm">

      <template v-if="!hasNodeLevelTree">
        <div class="d-flex align-center ga-3">
          <span class="field-label shrink-0">选择处理方式</span>
          <v-radio-group v-if="useOptionRadios" v-model="selectedOptionKey" class="flex-grow-1" hide-details inline>
            <v-radio v-for="opt in selectItems" :key="opt.key" :color="radioColorOf(opt.result)" :value="opt.key">
              <template #label>
                <span class="text-[13px]">{{ opt.text }}</span>
              </template>
            </v-radio>
          </v-radio-group>

          <v-select v-else v-model="selectedOptionKey" class="filter-select flex-grow-1" density="compact" hide-details
            item-title="text" item-value="key" :items="selectItems" :menu-props="{ contentClass: 'filter-menu' }"
            single-line style="max-width: 480px" variant="outlined">
            <template #label>
              <span class="text-[11px]">选择处理方式</span>
            </template>
          </v-select>
        </div>
      </template>

      <div v-if="pickedGroups.length > 0" class="mt-2 d-flex align-center ga-3 mb-3">
        <span class="field-label shrink-0">办理选项</span>
        <v-select v-model="pickedLeaf" class="filter-select flex-grow-1" density="compact" hide-details
          max-width="200px" item-title="text" :items="optionMenuItems" :menu-props="{ contentClass: 'filter-menu' }"
          placeholder="请选择" return-object single-line variant="outlined">
          <template #label>
            <span class="text-[11px]">选项</span>
          </template>
        </v-select>
        <v-select v-if="leafChildren.length > 0" v-model="pickedChild" class="filter-select" density="compact"
          max-width="200px" hide-details :items="leafChildren" :menu-props="{ contentClass: 'filter-menu' }"
          placeholder="请选择" single-line variant="outlined">
          <template #label>
            <span class="text-[11px]">二级选项</span>
          </template>
        </v-select>
      </div>

      <div v-if="needReceiveQty" class="d-flex align-center ga-3">
        <!-- label 外置：与上面「选择处理方式 / 办理选项」的 label 同列，输入框起点因此对得上 -->
        <div class="field-label shrink-0">接收数量<span class="font-normal">（数量0视为弃置）</span></div>
        <v-text-field v-model="qty" class="qty-input" density="compact" max-width="300px"
          :readonly="receiveAll && hasReceiveCap" :rules="receiveQtyRules" single-line suffix="件" variant="underlined"
          width="160px" />
        <span v-if="receiveAll && hasReceiveCap" class="text-[11px] text-medium-emphasis">
          =<template v-if="receivedQtyText">（总 {{ stockQtyText }}，已接收 {{ receivedQtyText }}）</template>
        </span>

        <!-- 部分接收：把"还剩多少"摆在旁边，省得去翻上一环记录 -->
        <span v-else-if="usingRemaining" class="text-[11px] text-medium-emphasis">
          剩余 {{ receiveCapText }} 件（总 {{ stockQtyText }}，已接收 {{ receivedQtyText }}）
        </span>

        <span v-if="receiveValueText" class="text-[11px] text-medium-emphasis"
          :title="`价值 = 总库存金额 ÷ 总库存数量 × 剩余数量 = ${stockAmountText} ÷ ${stockQtyText} × ${receiveCapText}`">
          价值 ￥{{ receiveValueText }}
        </span>
      </div>

      <div v-else-if="needRecycle" class="d-flex align-center flex-wrap ga-4 mt-2">
        <span class="text-[11px] text-medium-emphasis">
          总件数 {{ stockQtyText || '—' }} 件<template v-if="stockAmountText">，总金额 ￥{{ stockAmountText
          }}</template>
        </span>

        <v-text-field v-model="recycleQty" class="qty-input" density="compact" label="回收数量" :rules="recycleQtyRules"
          single-line suffix="件" variant="underlined" width="160px" />

        <v-text-field v-model="recycleAmount" class="qty-input" density="compact" label="回收金额"
          :rules="recycleAmountRules" single-line suffix="￥" variant="underlined" width="160px" />
      </div>

      <div v-else-if="needReason && pickedGroups.length === 0" class="mt-2">
        <div class="d-flex align-center ga-3 flex-wrap">
          <v-select v-model="reason" class="filter-select" density="compact" hide-details item-title="text"
            :items="groupedReasons" :menu-props="{ contentClass: 'filter-menu' }" return-object single-line
            variant="outlined" width="200" @update:model-value="handleResonChange">
            <template #label>
              <span class="text-[11px]">原因</span>
            </template>
          </v-select>
          <v-select v-if="reason.belong === '开发类'" v-model="secondReason" class="filter-select" density="compact"
            hide-details item-title="text" :items="secondApprovalModal" :menu-props="{ contentClass: 'filter-menu' }"
            return-object single-line variant="outlined" width="180" @update:model-value="handleSecondResonChange">
            <template #label>
              <span class="text-[11px]">二级原因</span>
            </template>
          </v-select>
        </div>

        <v-textarea v-if="reason.belong === '外部环境'" v-model="reasonRemark" class="remark-input mt-2" density="compact"
          hide-details label="" max-width="300" placeholder="补充说明" rows="2" variant="outlined" />
      </div>
      <div v-if="needPick" class="mb-2 remark-row">
        <div class="d-flex align-center ga-2 flex-wrap">
          <v-btn color="primary" :prepend-icon="picking ? 'mdi-chevron-up' : 'mdi-account-plus-outline'" size="small"
            variant="tonal" @click="picking = !picking">
            {{ needPickTeam ? '选择接收部门' : '选择接收团队' }}
          </v-btn>
        </div>
        <div v-if="JSON.stringify(pickedMembers) !== '{}'" class="d-flex align-center ga-1 mt-2">
          <v-chip closable size="small" @click:close="unpickMember">
            {{ pickedMembers.name }}
            <!-- 选中信息 = 名字 + 负责人（团队级叫负责人、组级叫组长，都是落地联系的人） -->
            <span v-if="pickedMembers.manager" class="ml-1 text-[11px] opacity-70 mt-0.5">
              {{ pickedMembers.manager }}
            </span>
          </v-chip>
        </div>
        <v-expand-transition>
          <div v-show="picking">
            <v-divider class="my-2" />
            <TeamPicker :mode="needPickTeam ? 'team' : 'group'" :team="needPickTeam ? '' : receiverTeam"
              @select="pickMember" />
          </div>
        </v-expand-transition>
      </div>
    </v-form>

    <!-- 备注 / 审批意见：与上方「label + 控件」同一栅格（左边空出 label 列，右边撑满） -->
    <div class="mt-1 d-flex align-center ga-3">
      <span class="field-label shrink-0 self-start">意见/备注</span>
      <v-textarea v-model="opinion" class="remark-input" :counter="300" density="compact" rows="2"
        variant="outlined" />
    </div>

    <!-- 附件：只保留回形针图标，点击文字同样能唤起选择框 -->
    <div class="remark-row d-flex align-center ga-1">
      <v-file-input ref="fileInputRef" v-model="attachment" class="attachment-input" density="compact" hide-input>
        <template #prepend>
          <v-icon color="#1055C9" size="15">mdi-paperclip</v-icon>
        </template>
      </v-file-input>
      <span v-if="attachment" class="text-[12px] text-medium-emphasis text-decoration-underline text-truncate"
        :title="attachment.name">
        {{ attachment.name }}
      </span>
      <span v-else class="text-[12px] text-medium-emphasis cursor-pointer" @click="fileInputRef?.click()">上传附件</span>
      <v-btn v-if="attachment" density="compact" icon="mdi-close" variant="plain" @click="attachment = null">
        <v-icon icon="mdi-close" size="15" />
      </v-btn>
    </div>

    <div class="d-flex align-center ga-2">
      <v-spacer />
      <v-btn size="small" variant="tonal" @click="emit('cancel')">取消</v-btn>
      <v-btn color="primary" :disabled="waitingNext" :loading="submitting || waitingNext" size="small"
        :text="waitingNext ? '正在进入下一环节…' : (hasNextAction ? '提交并继续下一个' : '提交')" variant="tonal"
        @click="handleConfirm" />
    </div>
    <v-overlay v-model="overlay" class="d-flex align-center justify-center" @click:outside="overlay = false">
      <img v-if="imgUrl" alt="附件预览" class="attachment-preview" :src="imgUrl" @click="overlay = false">
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
  ReceiverTeam,
} from '@/types/approval'
import {
  APPROVAL_RESULTS,
  filterOfferedOptions,
  PICK_MEMBERS_RESULT,
  PICK_TEAM_RESULT,
  RECEIVE_QTY_RESULT,
  receiptLedgerAfter,
} from '@/types/approval'
// shareValueText：按「总金额 ÷ 总数量 × 数量」折算货值（见 utils/number）
import { shareValueText } from '@/utils/utils'
// 环节负责人口径（mainOf）与「连续同人环节」的类型都来自这里，别在组件里另写一套
import { mainOf, type ApprovalNextStep } from '@/utils/approvalRuntime'
// 「选择接收组别」的候选：团队表（utils/organazation）——不是整棵飞书通讯录，见组件说明
import TeamPicker from '../TeamPicker.vue'

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
const qty = ref('')
/** 回收数量 / 回收金额（选「回收」类结论时填写） */
const recycleQty = ref('')
const recycleAmount = ref('')
const opinion = ref('')
/** 「外部环境」分类下的补充说明 */
const reasonRemark = ref('')
/** 提交中，避免重复点击 */
const submitting = ref(false)
const waitingNext = ref(false)
const attachment = ref<File | null>(null)
const fileInputRef = ref<{ click: () => void } | null>(null)

const reason = ref<ReasonItem>({ text: '市场需求分析不足/运营策略不当', target: 'operation-analysis', belong: '运营' })
const secondReason = ref<{ text: string, target: string }>({ text: '运营/销售', target: 'sale' })
/** 一级 / 二级「原因」的初始值：换动作时也要回到这里（见 resetFormState） */
const INIT_REASON: ReasonItem = { text: '市场需求分析不足/运营策略不当', target: 'operation-analysis', belong: '运营' }
const INIT_SECOND_REASON = { text: '运营/销售', target: 'sale' }
/**
 * 「选择接收组别」选中的接收**组别**（组别名 + 组长）：只记进本环节的办理记录；
 * 该结论会**终结流程**（见 CLOSE_FLOW_RESULTS）。
 * `department` 只为兼容此前存过"所属团队"的记录，新选的一律带 `manager`。
 */
const pickedMembers = ref<ReceiverTeam & { department?: string }>({})
/** 选人面板是否展开 */
const picking = ref(false)

/* ==================== 当前要办的是哪一环 ==================== */

function isNotifyStepData(data?: ApprovalChainItem[]) {
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
  return i >= 0 && i < actionSteps.value.length - 1
})

/* ==================== 已办动作回显 ==================== */

/** 一条办理流水里的选项明细（extra）→ { label, value } 列表 */
function extraItemsOf(extra?: Record<string, unknown>) {
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
function memberLabel(x: unknown): string {
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

function optionPathOf(extra?: Record<string, unknown>) {
  const group = String(extra?.option_group ?? '').trim()
  if (!group) return ''
  return [group, extra?.option_text, extra?.option_child]
    .map(v => String(v ?? '').trim())
    .filter(Boolean)
    .join(' / ')
}

function actionResultOf(step: { data: ApprovalChainItem[] }) {
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
function showPic(url: string) {
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
  return filterOfferedOptions(raw, props.optionContext)
})

/**
 * 一个选项的**唯一键**：文案 + 结论码。
 * 同一条线配了多个选项文本时它们**共用同一个结论码**，只有这个键能区分选的是哪一个。
 */
function optionKeyOf(o: { result: string, text: string }): string {
  return `${o.text}|${o.result}`
}

/** 下拉候选项：在选项上补一个 key（供 v-select 的 item-value 用） */
const selectItems = computed(() => optionItems.value.map(o => ({ ...o, key: optionKeyOf(o) })))

const RADIO_MAX = 3

/** 这次用 radio 还是下拉（两种形态绑定同一个 selectedOptionKey，提交逻辑完全一致） */
const useOptionRadios = computed(() => selectItems.value.length <= RADIO_MAX)

function radioColorOf(result: string): string {
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
function labelOf(result: string): string {
  return optionItems.value.find(o => o.result === result)?.text
    ?? APPROVAL_RESULTS.find(r => r.value === result)?.label
    ?? result
}

function customLabelOf(result: string): string {
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

/** 选中结论后需要补充的信息表单（数量 / 金额 / 原因等） */
const needReceiveQty = computed(
  () => selectedResult.value === 'receive'
    || selectedResult.value === 'part_receive'
    || selectedResult.value === RECEIVE_QTY_RESULT,
)

const rules = {
  /** 必填：空串 / 只有空格都算没填（`'0'` 算填了，数量 0 是合法输入） */
  required: (value: unknown) => (String(value ?? '').trim() === '' ? '请填写' : true),
  /** 正整数：只允许数字，不接受小数与千分位逗号 */
  isInteger: (value: unknown) => {
    const raw = String(value ?? '').trim()
    if (raw === '') {
      return true
    }
    return /^\d+$/.test(raw) ? true : '只能填正整数（不支持小数或千分位逗号）'
  },
  /** 金额：整数或最多两位小数（金额带角分是常态，所以与数量分开一条规则） */
  amount: (value: unknown) => {
    const raw = String(value ?? '').trim()
    if (raw === '') {
      return true
    }
    return /^\d+(?:\.\d{1,2})?$/.test(raw) ? true : '只能填金额，最多两位小数'
  },
}

/** 办理表单（数量 / 金额那几个输入框的宿主）—— 提交前用它 validate() */
type HandleForm = {
  validate: () => Promise<{ valid: boolean, errors: string[] }>
  resetValidation: () => void
}
const handleForm = ref<HandleForm | null>(null)

/** 「全部接收」= 结论码 `receive`（见 collectResult 里那个分支），此时数量不由人填 */
const receiveAll = computed(() => selectedResult.value === 'receive')

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
const receiveCapName = computed(() => (usingRemaining.value ? '剩余接收数量' : '总库存数量'))
/** 是否真的取到了上限：没有它「全部接收」的数量框就不能锁死（否则只读 + 必填 = 卡死） */
const hasReceiveCap = computed(() => receiveCapText.value !== '')
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

/** 「剩余数量」对应的价值 ≈ 单价 × 剩余 = 总库存金额 ÷ 总库存数量 × 剩余数量 */
const receiveValueText = computed(() =>
  shareValueText(stockAmountText.value, stockQtyText.value, receiveCapText.value),
)

/**
 * 必须**小于** limit 的规则工厂（**接收**的数量用）。
 * 用"小于"而不是"不超过"：接收的数都是**部分**量 —— 要接全部就该选「全部接收」
 * （那条口径下数量由系统填 = 剩余 / 总库存数量），所以等于上限本身不成立。
 */
function lessThan(limit: string, name: string, unit: string, hint = '') {
  return (value: unknown) => {
    const raw = String(value ?? '').trim()
    const cap = Number(limit)
    // 没填交给 required；上限取不到 / 认不出、填的不是数字，都放行（不凭空拒绝，也不叠第二条错误）
    if (raw === '' || limit === '' || !Number.isFinite(cap)) {
      return true
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      return true
    }
    return n < cap ? true : `必须小于${name}（${limit} ${unit}）${hint}`
  }
}

/**
 * 必须**不超过** limit 的规则工厂（**回收**的数量与金额用）。
 *
 * 与 lessThan 的唯一区别就是"能不能等于上限"，而这个区别是业务定的：
 *   · 接收用"小于"—— 接收是"部分接收"的语义，要接全部得走「全部接收」；
 *   · 回收用"不超过"—— 整批回收（件数与金额都等于总库存）是完全正常的结果。
 */
function atMost(limit: string, name: string, unit: string) {
  return (value: unknown) => {
    const raw = String(value ?? '').trim()
    const cap = Number(limit)
    if (raw === '' || limit === '' || !Number.isFinite(cap)) {
      return true
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) {
      return true
    }
    return n <= cap ? true : `不能大于${name}（${limit} ${unit}）`
  }
}

const receiveQtyRules = computed(() => {
  // 全部接收：数量由系统锁成剩余，只校验非空
  if (receiveAll.value && hasReceiveCap.value) {
    return [rules.required]
  }
  /*
   * 「接收」：能接多少填多少 —— **不大于**剩余即可（等于剩余就是正好接完）。
   * 与「部分接收」的"必须小于"分开：那是"部分"的语义，等于就该走全部接收。
   */
  if (selectedResult.value === RECEIVE_QTY_RESULT) {
    return [rules.required, rules.isInteger, atMost(receiveCapText.value, receiveCapName.value, '件')]
  }
  return [rules.required, rules.isInteger, lessThan(receiveCapText.value, receiveCapName.value, '件', '；要接全部请选「全部接收」')]
})

/** 回收数量：正整数，**不超过**总库存数量（可以等于 —— 整批回收是正常结果） */
const recycleQtyRules = computed(() => [
  rules.required,
  rules.isInteger,
  atMost(stockQtyText.value, '总库存数量', '件'),
])

/** 回收金额：金额格式，**不超过**总库存金额（可以等于） */
const recycleAmountRules = computed(() => [
  rules.required,
  rules.amount,
  atMost(stockAmountText.value, '总库存金额', '元'),
])

/** 提交时真正用的数量：接收上限优先（界面只读展示的也是它），拿不到才用用户填的 */
const receiveAllQty = computed(() => receiveCapText.value || qty.value)

/**
 * 接收类结论的账：把「已接收 / 剩余」一并写进结论的 extra。
 *
 * 条件求值**不依赖它**（引擎自己按流水算），写进来是为了记录**可追溯、可统计**。
 * 算不出来（老单 / 没关联产品）就什么都不写 —— 宁可空着，也别在记录里留半截假数字。
 */
function withReceiveLedger(extra: Record<string, unknown>, thisQty: unknown): Record<string, unknown> {
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
function withRecycleLedger(extra: Record<string, unknown>): Record<string, unknown> {
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
 */
function recycleLabel(base: string): string {
  const parts = [
    String(recycleQty.value ?? '').trim() ? `${String(recycleQty.value).trim()} 件` : '',
    String(recycleAmount.value ?? '').trim() ? `￥${String(recycleAmount.value).trim()}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? `${base} ${parts.join(' / ')}` : base
}

/**
 * 「接收数量」的初值 = 本环节**还能接多少**（剩余；页面没下发时退回总库存数量）。
 * 只填空框：除「全部接收」（那个数由系统定死、框也是只读的）之外，不覆盖办理人改过的数。
 *
 * ⚠️ 依赖里带上 needReceiveQty：结论与选项是异步/按顺序到位的，
 * 只盯 index 与上限有可能在「还没选中接收类结论」时算一次就再也不触发了。
 */
watch(
  [needReceiveQty, receiveAll, receiveCapText, () => activeStep.value?.index],
  () => {
    if (!needReceiveQty.value) {
      return
    }
    if (receiveAll.value || qty.value === '') {
      qty.value = receiveCapText.value
    }
  },
  { immediate: true },
)

/**
 * 「回收」类结论：需要填**回收数量 + 回收金额**。
 * 「供应商回收」与它同一套填写（只是结论码不同，便于分开统计）。
 */
const needRecycle = computed(
  () => selectedResult.value === 'recycle' || selectedResult.value === 'supplier_recycle',
)
// 「报废清仓」不需要额外的表单：选中即确认（confirmed 在 collectResult 里写死 true）
const needReason = computed(() => selectedResult.value === 'other_reason')
/** 「选择接收组别」：需要当场选组别 */
const needPickMembers = computed(() => selectedResult.value === PICK_MEMBERS_RESULT)
/** 「选择接收团队」：需要当场选团队，负责人取团队表的 parentManager */
const needPickTeam = computed(() => selectedResult.value === PICK_TEAM_RESULT)
/** 两条"当场指定接收方"的结论，界面共用一块（选择器按 needPickTeam 切模式） */
const needPick = computed(() => needPickMembers.value || needPickTeam.value)

/* ==================== 原因下拉 ==================== */

interface ReasonItem {
  text: string
  target: string
  belong?: string
  sendDepartment?: string[]
}

const approvalModal: ReasonItem[] = [{ text: '市场需求分析不足/运营策略不当', target: 'operation-analysis', belong: '运营' },
{ text: '运营-其他因素', target: 'operation-other', belong: '运营' },
{ text: '销量预测偏差', target: 'inventory-sales', belong: '库存管理', sendDepartment: ['运营', 'PMC'] },
{ text: '库存尾数弃置', target: 'inventory-tail', belong: '库存管理' },
{ text: '库存保管不善', target: 'inventory-storage', belong: '库存管理', sendDepartment: ['工厂'] },
{ text: '产品侵权-外观专利侵权（产品员自查）', target: 'infringement-self', belong: '产品侵权', sendDepartment: ['开发', '合规管理'] },
{ text: '产品侵权-外观专利侵权（产品合规中心承接）', target: 'infringement-center', belong: '产品侵权', sendDepartment: ['开发', '合规管理'] },
{ text: '产品侵权-发明专利侵权', target: 'infringement-invention', belong: '产品侵权', sendDepartment: ['开发', '研发', '合规管理'] },
{ text: '产品侵权-常规技术/常规外观竞对恶意专利抢注', target: 'infringement-technology', belong: '产品侵权', sendDepartment: ['合规管理'] },
{ text: '产品侵权-专利公示时间晚于检索时间', target: 'infringement-late', belong: '产品侵权', sendDepartment: ['开发', '合规管理'] },
{ text: '产品侵权-其他', target: 'infringement-other', belong: '产品侵权', sendDepartment: ['开发', '合规管理'] },
{ text: '产品侵权-版权', target: 'infringement-copyright', belong: '产品侵权', sendDepartment: ['设计部'] },
{ text: '产品质量问题', target: 'development-quality', belong: '开发类', sendDepartment: ['开发', '研发', '合规管理', '采购部', '工厂'] },
{ text: '包装及设计问题', target: 'development-design', belong: '开发类', sendDepartment: ['开发', '合规管理', '采购部', '工厂'] },
{ text: '开发/研发-其他因素', target: 'development-other', belong: '开发类', sendDepartment: ['开发', '研发'] },
{ text: '供应链-起订量限制', target: 'supply-order', belong: '供应链', sendDepartment: ['运营', '开发', '采购部', '工厂'] },
{ text: '供应链-采购因素', target: 'supply-purchase', belong: '供应链', sendDepartment: ['采购部'] },
{ text: '供应链-物流因素', target: 'supply-logistics', belong: '供应链', sendDepartment: ['物流部'] },
{ text: '政策与法规变化', target: 'outside-policy', belong: '外部环境' },
{ text: '自然灾害与突发事件导致产品不可售', target: 'outside-natural', belong: '外部环境' },
{ text: '平台限制/政策调整等', target: 'outside-platform', belong: '外部环境' },
{ text: '历史遗留库存', target: 'outside-history', belong: '外部环境' },
{ text: '其他客观因素', target: 'outside-other', belong: '外部环境' },
]
const secondApprovalModal = [
  { text: '运营/销售', target: 'sale' },
  { text: '开发', target: 'develop' },
  { text: '研发', target: 'search' },
  { text: '合规管理', target: 'compliance' },
  { text: '设计部', target: 'design' },
  { text: 'PMC', target: 'pmc' },
  { text: '采购部  ', target: 'purchase' },
  { text: '物流部', target: 'logistics' },
  { text: '工厂', target: 'factory' },
]
// 按 belong 分类生成带分组标题的下拉数据
const groupedReasons = computed(() => {
  const groups = new Map<string, ReasonItem[]>()
  for (const item of approvalModal) {
    const key = item.belong || '其他'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }
  const list: (ReasonItem | { type: 'subheader', text: string })[] = []
  for (const [belong, items] of groups) {
    list.push({ type: 'subheader', text: belong }, ...items)
  }
  return list
})
function handleResonChange(val: ReasonItem | null) {
  reason.value = val ?? { text: '市场需求分析不足/运营策略不当', target: 'operation-analysis', belong: '运营' }
}
function handleSecondResonChange(val: { text: string, target: string } | null) {
  secondReason.value = val ?? { text: '运营/销售', target: 'sale' }
}

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
 * 处理方式一变（或它带的树变了）就重置一级 / 二级，避免留下上一棵树里的选择。
 *
 * ⚠️ 这两条 watch 必须写在 pickedGroups / pickedChild **声明之后**：
 * `const` 是不提升的，放到前面会在模块初始化时就抛"used before declaration"。
 */
watch(
  [selectedOption, pickedGroups],
  () => {
    const first = pickedGroups.value[0]?.items[0] ?? null
    pickedLeaf.value = first
    pickedChild.value = first?.children?.[0] ?? ''
  },
  { immediate: true, deep: true },
)

watch(pickedLeaf, leaf => {
  pickedChild.value = leaf?.children?.[0] ?? ''
})

/* ==================== 接收方 / 表单重置 ==================== */

/**
 * 选中一个接收方（来自 TeamPicker，两种模式共用这一段）。
 *
 * 存的是**名字**（`name`）+ **负责人**（`manager`）：
 *   · 组别模式（「选择接收组别」）—— 组别名 + 该组组长；
 *   · 团队模式（「选择接收团队」）—— 团队名 + 团队负责人（`parentManager`）。
 */
function pickMember(t: { name: string, manager?: string }) {
  pickedMembers.value = {
    name: t.name,
    ...(t.manager ? { manager: t.manager } : {}),
    // 放在办理记录里的 type 沿用旧口径（接收方占"办理人"那一格），时间线据此单独渲染一个节点
    type: 'manager',
    pick: needPickTeam.value ? 'team' : 'group',
  }
}

function unpickMember() {
  pickedMembers.value = {}
}

function resetFormState() {
  selectedOptionKey.value = ''
  pickedLeaf.value = null
  pickedChild.value = ''
  qty.value = ''
  recycleQty.value = ''
  recycleAmount.value = ''
  reason.value = { ...INIT_REASON }
  secondReason.value = { ...INIT_SECOND_REASON }
  reasonRemark.value = ''
  pickedMembers.value = {}
  picking.value = false
  opinion.value = ''
  attachment.value = null
  // 下一环的数据到了（或已经没得办）：解除"等待中"，按钮恢复可用
  waitingNext.value = false
  // 表单校验状态一并清掉：连续多环时上一环的红字不能留在下一环的输入框上
  handleForm.value?.resetValidation()
}

/* ==================== 组装结论 & 提交 ==================== */

function collectResult(): { result: string, result_label: string, extra: Record<string, unknown> } {
  const extra: Record<string, unknown> = {}

  if (pickedLeaf.value) {
    const leaf = pickedLeaf.value
    const child = pickedChild.value
    // 类别按「文案 + 链路」回查（不按对象身份比 —— 经过响应式包装 / 下拉穿透后身份不保证相同）
    extra.option_group = pickedGroups.value
      .find(g => g.items.some(i => i.text === leaf.text && i.link === leaf.link))?.title ?? ''
    extra.option_text = leaf.text
    extra.option_link = leaf.link
    if (child) {
      extra.option_child = child
    }
    return {
      result: leaf.link,
      result_label: child ? `${leaf.text}·${child}` : leaf.text,
      extra,
    }
  }

  const result = selectedResult.value

  switch (result) {
    case 'receive': { // 全部接收：数量 = 本环节还能接多少（剩余，拿不到才退回总库存）；界面只读，这里再兜一道
      extra.qty = receiveAllQty.value
      return { result, result_label: '全部接收', extra: withReceiveLedger(extra, receiveAllQty.value) }
    }
    case 'part_receive': { // 部分接收
      extra.qty = qty.value
      return { result, result_label: `部分接收 ${qty.value || 0} 件`, extra: withReceiveLedger(extra, qty.value) }
    }
    case RECEIVE_QTY_RESULT: { // 接收：填多少接多少（不大于剩余），同样记这笔接收台账
      extra.qty = qty.value
      return { result, result_label: `接收 ${qty.value || 0} 件`, extra: withReceiveLedger(extra, qty.value) }
    }
    case 'recycle': { // 回收：数量 + 金额（另记一笔"这批货总共多少"，见 withRecycleLedger）
      extra.qty = recycleQty.value
      extra.amount = recycleAmount.value
      return { result, result_label: recycleLabel('回收'), extra: withRecycleLedger(extra) }
    }
    case 'supplier_recycle': { // 供应商回收：与「回收」同一套填写，只是结论码不同（分开统计）
      extra.qty = recycleQty.value
      extra.amount = recycleAmount.value
      return { result, result_label: recycleLabel('供应商回收'), extra: withRecycleLedger(extra) }
    }
    case 'scrap': {
      /*
       * 报废清仓：**选中即确认** —— 结论本身就是"确认清仓"这个动作，没有第二个语义。
       * （以前还有第二个按钮要点，漏点就静默存成 false，流程里按它写条件的线永远不命中。）
       */
      extra.confirmed = true
      return { result, result_label: '报废清仓', extra }
    }
    case 'rework': {
      // 模板在「审批结论」右侧配了选项文本时以它为准（同一条线的多个选项文案不同、码相同）
      return { result, result_label: customLabelOf(result) || '建议返工', extra }
    }
    case 'discard': {
      return { result, result_label: customLabelOf(result) || '建议弃置', extra }
    }
    case 'other_reason': {
      extra.reason = reason.value.text
      extra.reason_target = reason.value.target
      extra.reason_belong = reason.value.belong
      if (reason.value.belong === '开发类') {
        extra.second_reason = secondReason.value.text
        extra.second_reason_target = secondReason.value.target
      }
      if (reason.value.belong === '外部环境') extra.remark = reasonRemark.value
      return { result, result_label: reason.value.text, extra }
    }
    case PICK_MEMBERS_RESULT: // 选择接收组别：在这里收集接收方（组别 + 组长）
    case PICK_TEAM_RESULT: { // 选择接收团队：同上，粒度是「团队 + 团队负责人」；提交后流程即终结
      extra.members = pickedMembers.value
      const names = pickedMembers.value.name
      const leader = pickedMembers.value.manager
      const isTeam = pickedMembers.value.pick === 'team'
      const title = isTeam ? '选择接收团队' : '选择接收组别'
      // 结论文案带上「名字 + 负责人」：时间线上一眼能看出这一环把货交给了谁、找谁
      return {
        result,
        result_label: names
          ? `${title}：${names}${leader ? `（${isTeam ? '负责人' : '组长'} ${leader}）` : ''}`
          : title,
        extra,
      }
    }
    case 'pending': {
      return { result, result_label: '待定', extra }
    }
    case 'lack_demand': {
      return { result, result_label: '市场需求不足', extra }
    }
    case 'reject': {
      return { result, result_label: '驳回', extra }
    }
    default: {
      const finalResult = result || 'pass'
      return { result: finalResult, result_label: customLabelOf(finalResult) || labelOf(finalResult), extra }
    }
  }
}

async function handleConfirm() {
  // 正在提交 / 上一环刚提交、同人的下一环还没传回来：都不该再发一次
  if (submitting.value || waitingNext.value) return
  const step = activeStep.value
  if (!step) return
  if (handleForm.value) {
    const { valid } = await handleForm.value.validate()
    if (!valid) return
  }
  submitting.value = true
  const { result, result_label, extra } = collectResult()
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
