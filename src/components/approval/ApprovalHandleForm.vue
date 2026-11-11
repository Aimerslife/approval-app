<template>
  <div class="handle-form">
    <!-- 同一审批人连续多环：前面几环已经办过的，先列出来，免得以为重复了（子表单不重复列） -->
    <div v-if="doneActions.length > 0 && !chained" class="d-flex flex-column ga-3">
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

    <v-alert v-if="waitingNext && !chained" class="mb-3" density="compact" type="info" variant="tonal">
      已提交，正在进入下一环节（还是你办理）…
    </v-alert>

    <v-form v-if="radios == 'deal'" ref="handleForm" @submit.prevent="handleConfirm">

      <!--
        单子的总量**只在开头说一次**（总件数 / 已接收 / 总金额）：
        以前它散在「接收数量」右侧（（总 12869，已接收 110））和「回收」结论文案里各一份，
        同一个数在同一个弹窗里出现两三次，反而看不出哪个是整单的、哪个是本环的。
        本环还能接多少仍然标在数量框旁边（价值 …（剩余 12759 件）），两者分工明确。
      -->
      <!-- 整单总量只在最外层说一次：下一环节子表单里再列一遍纯属重复 -->
      <div v-if="!chained && (stockQtyText || stockAmountText)" class="approval-total mb-3 text-[11px] text-medium-emphasis">
        <span v-if="stockQtyText">总件数 <b>{{ stockQtyText }}</b> 件</span>
        <span v-if="receivedQtyText">已接收 <b>{{ receivedQtyText }}</b> 件</span>
        <span v-if="stockAmountText">总金额 <b>￥{{ stockAmountText }}</b></span>
      </div>

      <!--
        轮询卡片后面接的审批：把前面各团队接了多少列出来（只看合计看不出是谁接的，
        而"哪个组接了多少"往往才是这一环的判断依据）。
        没有轮询环（或都还没办）时 receipts 为空，这一行不显示。
      -->
      <RotationReceipts v-if="rotationReceipts.length > 0" class="mb-3" :items="rotationReceipts" />

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

      <div v-if="pickedGroups.length > 0" class="mt-2 d-flex align-center ga-3">
        <span class="field-label shrink-0">办理选项</span>

        <v-select v-model="pickedLeaf" class="filter-select flex-grow-1" density="compact" hide-details
          item-title="text" :items="optionMenuItems" max-width="200px" :menu-props="{ contentClass: 'filter-menu' }"
          placeholder="请选择" return-object single-line variant="outlined">
          <template #label>
            <span class="text-[11px]">选项</span>
          </template>
        </v-select>

        <v-select v-if="leafChildren.length > 0" v-model="pickedChild" class="filter-select" density="compact"
          hide-details :items="leafChildren" max-width="200px" :menu-props="{ contentClass: 'filter-menu' }"
          placeholder="请选择" single-line variant="outlined">
          <template #label>
            <span class="text-[11px]">二级选项</span>
          </template>
        </v-select>
      </div>
      <div class="remark-row">
        <OptionFormRenderer v-if="typeFields.length > 0" :key="`${activeStep?.index}-${selectedResult}`"
          v-model="typeValues" :context="typeContext" :fields="typeFields" :receiver-team="receiverTeam"
          :seed-baseline="receiverSeedBaseline" @pick="startPick" />
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

        <TeamPicker :mode="pickingField.pick === 'team' ? 'team' : 'group'"
          :team="pickingField.pick === 'team' ? '' : receiverTeam" @select="pickReceiver" />
      </div>
    </v-form>

    <!--
      同一人连续多环的「中间态」：选完结论立即把后续环节**全部铺出来**（可填），
      但都只是本地状态 —— 点「提交」时按顺序一起推进审批流（见 submitQueue）。

      · 不画「下一环节 / 同一审批人 / 提交后自动进入」这类标题：业务要求直接接着上面表单项往下排；
      · 多环靠 previewSteps 逐层推演（子表单选完结论，后面自动再铺一环），中间不需要再点提交；
      · **环与环之间不画分割线**（业务要求整块看着像一张表，别切成几段）：区分靠 mt-3 的留白，
        `chained` 那一层自己的标题区也不再额外加线；
      · 必须放在外层 v-form 之外：子表单自带 v-form，嵌套 form 标签不合法。
    -->
    <template v-if="!chained">
      <div v-for="(step, si) in previewSteps" :key="`${step.index}-${si}`" class="mt-3">
        <ApprovalHandleForm :ref="el => setChildRef(si, el)" chained :allowed-options="step.allowedOptions"
          :allowed-results="step.allowedResults" :data="step.data" :index="step.index"
          :option-context="step.optionContext" :receiver-team="receiverTeam" :remaining-qty="remainingQty"
          :stock-amount="stockAmount" :stock-qty="stockQty" :type-templates="typeTemplates"
          @option-change="draft => onChildDraft(si, draft)" />
      </div>
    </template>

    <!-- 备注 / 审批意见：连续多环**共用最下面这一份**（子表单不再各带一个） -->
    <div v-if="!chained" class="mt-2 d-flex align-center ga-3">
      <span class="field-label shrink-0 self-start">意见/备注<span v-if="opinionRequired" class="text-error">
          *</span></span>

      <v-textarea v-model="opinion" class="remark-input" :counter="300" density="compact" :error-messages="opinionError"
        :hint="opinionRequired ? '选择「外部环境」类原因时必填' : ''" :persistent-hint="opinionRequired" :required="opinionRequired"
        rows="2" variant="outlined" />
    </div>

    <!-- 附件：只保留回形针图标，点击文字同样能唤起选择框（只属于本次提交，子表单不带） -->
    <div v-if="!chained" class="remark-row d-flex align-center ga-1">
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

    <!-- 提交被拦下的原因（没选办理选项 / 结论在模板里没有后置环节）：贴在按钮上方，别只弹一下 snackbar -->
    <v-alert v-if="formError && !chained" class="mb-2" density="compact" type="warning" variant="tonal">
      {{ formError }}
    </v-alert>

    <div v-if="!chained" class="d-flex align-center ga-2">
      <v-spacer />
      <!-- 回退上一级：替代原来下拉里的「驳回」（见 handleRejectBack） -->
      <v-btn v-if="canRejectBack" :disabled="submitting || waitingNext" size="small" variant="tonal"
        @click="handleRejectBack" color="error">
        驳回
      </v-btn>

      <!-- 有中间态预览环时，点一次会把后续几环一起推进 —— 文案要说清楚（行为见 submitQueue） -->
      <v-btn color="primary" :disabled="waitingNext" :loading="submitting || waitingNext" size="small"
        :text="waitingNext ? '正在进入下一环节…' : '提交'"
        variant="tonal" @click="handleConfirm" />
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
  ApprovalOrder,
  NodeSubmitPayload,
} from '@/types/approval'
// 中间态：把"已选结论"假装成一条流水重算链路（纯函数：不写库、不发通知），见 utils/approvalPreview
import { type DraftDecisionInput, previewNextStepOf } from '@/utils/approvalPreview'
// 审批类型（选中结论后要填什么）：办理期**只读单据快照**，见 utils/approvalTypes 文件头的边界说明
import type { ApprovalTypeTemplate } from '@/utils/approvalTypes'
import {
  APPROVAL_RESULTS,
  filterOfferedOptions,
  PICK_MEMBERS_RESULT,
  PICK_TEAM_RESULT,
  receiptLedgerAfter,
  RECEIVE_QTY_RESULT,
} from '@/types/approval'
// 环节负责人口径（mainOf）与「连续同人环节」的类型都来自这里，别在组件里另写一套
import { type ApprovalNextStep, mainOf, type RotationReceipt } from '@/utils/approvalRuntime'
// REASON_OPTIONS：选项树的叶子就是「原因」本身，办理时按同一份候选补出 reason_* / 分类
import { isFieldVisible, REASON_OPTIONS, SECOND_REASON_OPTIONS, type TypeField, type TypeLimitSource, typeTemplateFromSnapshot } from '@/utils/approvalTypes'
// 「选择接收组别」的候选：团队表（utils/organazation）——不是整棵飞书通讯录，见组件说明
import TeamPicker from '../TeamPicker.vue'
// 「选择接收团队」的平铺清单也认同一张团队表：候选从这儿取，别在组件里另抄一份
import { teamRowsForReceiver } from '@/utils/organazation'
// 表单字段的**唯一渲染器**：审批类型页预览、沙盒、办理页三处共用同一份实现
import OptionFormRenderer from './OptionFormRenderer.vue'
// 前面轮询各团队的接收汇总（与审批详情 / 时间线共用同一份展示口径）
import RotationReceipts from './RotationReceipts.vue'

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
  /**
   * 前面「组间轮询」里各团队已办的接收信息（见 utils/approvalRuntime 的 rotationReceiptsOf）。
   *
   * 由调用方算好传入（表单拿不到整条链路）：HandleDock 传的是「已办轮询环」，
   * 没有轮询环时为空数组，界面上那一行不显示。
   */
  rotationReceipts?: RotationReceipt[]
  /**
   * 审批单本身：**中间态推演**要它（flow + decisions + context 才能算出"提交后会走到哪"）。
   *
   * 只在最外层需要（子表单不传）：为空时不渲染任何预览环，行为与改造前一致。
   */
  order?: ApprovalOrder | null
  /**
   * 各环节的办理选项 / 可结论（页面下发的两张表，按 stepId 索引）。
   *
   * 中间态要渲染**后续几个环节**各自的选项，按预览出来的 stepId 现查 —— 所以整张表要带下来。
   */
  optionItems?: Record<string, ApprovalNodeOption[]>
  resultOptions?: Record<string, string[]>
  /** 连锁模式：作为「后续环节」的子表单渲染（隐藏按钮区 / 意见 / 附件 / 已办回显 / 自己的预览环） */
  chained?: boolean
}

/** 「下一环节」的渲染参数：由 HandleDock 的 previewStep 组装（stepId / 选项都已查好） */
interface PreviewStepProps {
  /** 该环节在 chain 中的下标（提交时原样回传） */
  index: number
  /** 该环节的 stepId（HandleDock 据此查选项表，这里只做传递） */
  stepId: string
  /** 该环节的成员（`data[0]` 那条 manager 就是办理人） */
  data: ApprovalChainItem[]
  /** 该环节的办理选项（与 allowedOptions 同构） */
  allowedOptions?: ApprovalNodeOption[]
  /** 该环节可选的审批结论 */
  allowedResults?: string[]
  /** 该环节的选项条件上下文（`result` = 上一环节刚选的结论） */
  optionContext?: Record<string, unknown>
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
  rotationReceipts: () => [],
  order: null,
  optionItems: () => ({}),
  resultOptions: () => ({}),
  chained: false,
})

const emit = defineEmits<{
  (e: 'submit', payload: NodeSubmitPayload): void
  /** 这一环彻底办完了（且后面没有同人的动作）—— 弹窗据此关闭；内联面板没人监听也无妨 */
  (e: 'finish'): void
  (e: 'cancel'): void
  /**
   * 当前选中的结论变化（含"还没选"→ null）。
   *
   * 外壳拿它去算「如果现在提交会走到哪」——只有下一环还是同一人时，
   * 才会把 previewStep 传回来渲染（见 utils/approvalPreview）。
   * ⚠️ 这里只报结论码，不带 extra：预览阶段不收集字段值，也不做任何校验。
   */
  (e: 'option-change', draft: { index: number, result: string, result_label: string } | null): void
}>()

/* ==================== 表单状态 ==================== */

/**
 * 「驳回」的结论码：必须与保存期注入的驳回分支条件
 * （`{ field: 'result', op: 'eq', value: 'reject' }`）一致。
 *
 * 声明放在最前：下面的 computed（optionItems / canRejectBack）在 **setup 期间**
 * 就会被 immediate watch 触发求值，声明在后会撞 TDZ（Cannot access before initialization）。
 */
const REJECT_RESULT = 'reject'

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
  return i !== -1 && i < actionSteps.value.length - 1
})

/* ==================== 中间态：后续环节的推演与渲染 ==================== */

/**
 * 后续环节的推演（同一审批人连续多环）。
 *
 * 做法：把「当前选中的结论 + 各子表单已选的结论」当成一串流水喂给 rebuildChain
 * （见 utils/approvalPreview：纯函数，不写库、不发通知），算出"如果现在提交会依次走到哪"。
 * 只要下一环还是同一个人，就把它铺成一个可填写的子表单；子表单选完结论后，
 * 同一个循环继续往后推 —— 三环、四环都能一路铺出来，中间不需要再点提交。
 */
const childDrafts = ref<Array<{ index: number, result: string, result_label: string } | null>>([])
const childRefs = ref<Array<{ validate: () => Promise<string>, collect: () => SubmitBody } | undefined>>([])

/** 当前环自己的草稿（还没选结论时为空 → 不推演） */
const selfDraft = computed<DraftDecisionInput | null>(() => {
  const step = activeStep.value
  const result = selectedResult.value
  return step && result ? { index: step.index, result, result_label: labelOf(result) } : null
})

/** 要渲染的后续环节列表（逐层推演；上限 12 环，防止模板成环时死循环） */
const previewSteps = computed<PreviewStepProps[]>(() => {
  const order = props.order
  // 子表单只渲染自己那一环：预览链由最外层统一铺开（见模板里的 v-for）
  if (props.chained || !order || !selfDraft.value) {
    return []
  }
  const out: PreviewStepProps[] = []
  const drafts: DraftDecisionInput[] = [selfDraft.value]
  for (let depth = 0; depth < 12; depth++) {
    const next = previewNextStepOf(order, drafts)
    if (!next) {
      break
    }
    out.push({
      index: next.index,
      stepId: next.stepId,
      data: next.data,
      allowedOptions: props.optionItems[next.stepId] ?? [],
      allowedResults: props.resultOptions[next.stepId] ?? [],
      optionContext: next.optionContext,
    })
    // 这一层还没选结论：铺到这里为止（用户选完才会继续往后推）
    const child = childDrafts.value[depth]
    if (!child || child.index !== next.index || !child.result) {
      break
    }
    drafts.push({ index: child.index, result: child.result, result_label: child.result_label })
  }
  return out
})

/** 子表单实例登记（v-for 的模板 ref）：提交时的校验与取值都要用它 */
function setChildRef (depth: number, el: unknown) {
  childRefs.value[depth] = (el ?? undefined) as { validate: () => Promise<string>, collect: () => SubmitBody } | undefined
}

/** 某个子表单换了结论：记下来重算后面能铺几环（它之后的草稿一并作废） */
function onChildDraft (depth: number, draft: { index: number, result: string, result_label: string } | null) {
  const next = childDrafts.value.slice(0, depth)
  if (draft?.result) {
    next[depth] = draft
  }
  childDrafts.value = next
}

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
  const usable = enabled.length > 0 ? enabled : offered
  /*
   * 「驳回」不再作为办理下拉里的选项：回退交回按钮区的「回退上级」（见 handleRejectBack）。
   * 但**过滤光了要退回原样** —— 有些老模板只配了驳回一条出线，去掉就彻底无路可走了。
   */
  const withoutReject = usable.filter(o => o.result !== REJECT_RESULT)
  return withoutReject.length > 0 ? withoutReject : usable
})

/**
 * 本环节有没有「回退上一级」出口 —— 按钮「回退上级」据此显示 / 隐藏。
 *
 * 判据：模板给这一环配了 reject 分支（保存期会把它绑成 loopBackTo 回退），
 * 或环节级选项树标了 canReject（那条分支不在树里，见 ApprovalNodeOption.canReject）。
 * 看的是**未过滤**的选项：reject 已从下拉里摘掉，但出口本身还在。
 */
const canRejectBack = computed(() => {
  const step = activeStep.value
  const raw = step?.allowedOptions?.length ? step.allowedOptions : []
  return raw.some(o => o.result === REJECT_RESULT || (o.nodeLevel && o.canReject))
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

/**
 * radio 能摆下的上限：超过它就退回下拉。
 *
 * 为什么是 6 而不是 3：以前 3 个以上一律变下拉，于是「组间轮询」这种四结论环节
 * （全部接收 / 不接收 / 部分接收 / 回退上一级）在办理页只露出一个下拉框 ——
 * 四个方向全被折进"点开才看得见"的菜单里，办理人根本不知道这一环还能选什么。
 * radio 横排（inline 自带 flex-wrap）摆 4~6 个中文结论完全放得下，就全摆出来。
 */
const RADIO_MAX = 6

/** 这次用 radio 还是下拉（两种形态绑定同一个 selectedOptionKey，提交逻辑完全一致） */
const useOptionRadios = computed(() => selectItems.value.length <= RADIO_MAX)

function radioColorOf(result: string): string {
  if (result === 'reject' || result === 'discard' || result === 'scrap' || result === 'dispose') {
    return 'error'
  }
  // 推进类结论（通过 / 接收 / 进入审批）用成功色：这一环是"继续往下走"，不是处置或异常
  return result === 'pass' || result === 'receive' || result === RECEIVE_QTY_RESULT || result === 'enter_approval'
    ? 'success'
    : 'primary'
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

/**
 * 结论一变就把「当前这一环 + 选中的结论」报给外壳。
 *
 * 外壳据此模拟重算链路（utils/approvalPreview，纯函数、不落库）判断下一环是不是
 * 还是同一个人；是的话会把 previewStep 传回来 —— 下一环节会在面板里**立即渲染**，
 * 而真正的数据推进仍然只发生在点「提交」时（见 handleConfirm）。
 */
watch(
  [() => activeStep.value?.index, () => selectedResult.value],
  () => {
    const step = activeStep.value
    const result = selectedResult.value
    if (!step || !result) {
      emit('option-change', null)
      return
    }
    emit('option-change', { index: step.index, result, result_label: labelOf(result) })
  },
  { immediate: true },
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
  const v = String(Number(props.stockAmount).toFixed(2))
  return v === null || v === undefined || v === '' ? '' : v
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
 * 已经预填过「接收团队数量」的 `结论码:字段键`。
 *
 * 「选择接收团队」的清单是全团队平铺的，打开表单时要按历史把各团队的数量带出来（见 seedReceiverTeams）。
 * 用这个集合保证**只带一次**：用户把某个团队的数字删掉就是"这次不分给他"，
 * 依赖（模板 / 轮询汇总）再变也不能把它填回来。换环节 / 换结论时会清空（见 resetFormState）。
 */
const seededReceiverKeys = new Set<string>()

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
  // 换结论 → 接收团队的清单要按新结论重新带一次历史数量
  seededReceiverKeys.clear()
  receiverSeedBaseline.value = {}
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
function startPick(field: TypeField) {
  pickingField.value = field
}

/**
 * 本次表单里给各团队填过的数量（`团队名 → 数量`）。
 *
 * 用途只有一个：**删除某个团队再选回来时，数量还能带出上次填的值**。
 * 不参与提交、不落库 —— 提交时数量跟着成员对象走（`extra.members[].qty`）。
 */
const qtyMemory = ref<Record<string, string>>({})

/**
 * 预填进「选择接收团队」清单的**历史接收量**基准（团队名 → 数量）。
 *
 * 这些量是前面环节已经接收掉的，「剩余接收数量」（本环节上限）里已经扣过一次；
 * 清单末尾的剩余与超限校验只统计**超出基准的部分**（本次新分），否则等于把前面的
 * 接收算两遍（实测：总库存 550、前面已接 200、上限 350；预填 50/100/50 合计 200，
 * 旧算法剩余显示 150 —— 用户报"剩余多减了一次前面的接收数量"）。
 *
 * 维护时机：
 *   · seedReceiverTeams / pickReceiver 里带出历史量时记入；
 *   · 选回的团队带的是**本次**填过的数（qtyMemory 优先）→ 从基准里删（那是新分）；
 *   · 换结论 / 重置表单时清空（见 seededReceiverKeys 的清理点）。
 */
const receiverSeedBaseline = ref<Record<string, number>>({})

/**
 * 这个团队「之前填的数量」——「选择接收团队」清单里数量框的默认值。
 *
 * 两个来源，按可信度排序：
 *   ① 本次表单里刚填过的（含填完又把这个团队删掉的，见 qtyMemory）；
 *   ② 前面环节里**这个团队自己**填过的接收数量（rotationReceipts）——
 *      办理人大概率会沿用之前的分配，直接带出来省得逐个回忆。
 *
 * 都没有就返回空串：宁可空着让人填，也别拿别的团队的数量冒充
 *（一批货分给几个队，数量本来就不该一样）。
 *
 * ⚠️ 预填量会记入 receiverSeedBaseline：剩余显示与超限校验（渲染器 freshQtyTotalOf /
 *    receiverQtyError）只统计**超出基准的部分**（本次新分），沿用之前的分配原样提交
 *    不会被拦 —— 否则等于把前面的接收又扣一遍（用户报过"剩余多减了一次"）。
 */
function defaultQtyOf (team: string): string {
  const remembered = String(qtyMemory.value[team] ?? '').trim()
  if (remembered) {
    return remembered
  }
  // 同一团队可能办过好几轮（驳回后重走）：以**最后一次**为准，别把第一轮的数字当默认值
  for (let i = props.rotationReceipts.length - 1; i >= 0; i--) {
    const r = props.rotationReceipts[i]
    if (r.group === team && r.qty !== undefined && r.qty !== null) {
      return String(r.qty)
    }
  }
  return ''
}

/**
 * 选中一个接收方（来自 TeamPicker，两种粒度共用这一段）。
 *
 * 存的是**名字**（`name`）+ **负责人**（`manager`）：
 *   · 组别模式（「选择接收组别」）—— 组别名 + 该组组长；
 *   · 团队模式（「选择接收团队」）—— 团队名 + 团队负责人（`parentManager`）。
 * `type: 'manager'` 沿用旧口径（接收方占"办理人"那一格），时间线据此单独渲染一个节点。
 *
 * **两种粒度行为不同**：
 *   · 「选择接收团队」可以选多个（一批货分给几个团队），每追加一个就带出该团队之前填过的
 *     接收数量做默认值（见 defaultQtyOf）；同一团队不重复追加；
 *   · 「选择接收部门」是一对一交接，选中即替换掉原来那个（保持改造前行为）。
 */
function pickReceiver(t: { name: string, manager?: string }) {
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
  // 「选部门」保持单选语义：选中就把原来那个换掉
  if (field.pick === 'team') {
    typeValues.value = { ...typeValues.value, [field.key]: [member] }
    pickingField.value = null
    return
  }

  // 渲染器里选人控件按**数组**放（单选 / 多选同一个控件）；写库时单团队仍落单对象（见 collectResult）
  const picked = Array.isArray(typeValues.value[field.key])
    ? (typeValues.value[field.key] as Array<Record<string, unknown>>)
    : []
  // 同一个团队已经在列表里：不重复追加（否则会出两条同名、两份数量，台账会算两遍）
  if (picked.some(m => String(m.name ?? '') === member.name)) {
    pickingField.value = null
    return
  }
  const qty = defaultQtyOf(t.name)
  if (String(qtyMemory.value[t.name] ?? '').trim()) {
    // 带出的是**本次**填过的数（qtyMemory 优先）→ 属于新分，从预填基准里除名
    const { [t.name]: _drop, ...rest } = receiverSeedBaseline.value
    receiverSeedBaseline.value = rest
  } else if (qty) {
    // 带出的是历史接收量 → 记入基准（沿用原样不算新分）
    receiverSeedBaseline.value = { ...receiverSeedBaseline.value, [t.name]: Number(qty) || 0 }
  }
  typeValues.value = {
    ...typeValues.value,
    [field.key]: [...picked, qty ? { ...member, qty } : member],
  }
  pickingField.value = null
}

/**
 * 记住各团队填过的数量（只在本表单内有效，见 qtyMemory）。
 * 深度监听 typeValues 而不是在渲染器里回调：数量框的写入路径只有一条（setPickedQty → update:model-value），
 * 从值上收口就不用再给渲染器加事件。
 */
watch(typeValues, value => {
  const fields = typeTemplate.value?.fields ?? []
  let next: Record<string, string> | null = null
  for (const field of fields) {
    if (field.control !== 'team' || field.pick === 'team') continue
    const list = Array.isArray(value[field.key]) ? (value[field.key] as Array<Record<string, unknown>>) : []
    for (const m of list) {
      const name = String(m.name ?? '').trim()
      const qty = String(m.qty ?? '').trim()
      if (name && qty && qtyMemory.value[name] !== qty) {
        next = { ...(next ?? qtyMemory.value), [name]: qty }
      }
    }
  }
  if (next) {
    qtyMemory.value = next
  }
}, { deep: true })

/**
 * 「选择接收团队」现在是**全团队平铺清单**（见 OptionFormRenderer），所以打开表单时要把
 * 「这个团队之前填过的数量」直接带进它那一格（口径见 defaultQtyOf：本表单记忆 → 前面环节回填）。
 *
 * 只带一次（靠 seededReceiverKeys 记）：删掉某个团队的数字就是"这次不分给他"，不能被重跑顶回来。
 */
function seedReceiverTeams() {
  const template = typeTemplate.value
  const seed: Record<string, unknown> = {}
  for (const field of template.fields) {
    if (field.control !== 'team' || field.pick === 'team') continue
    const seedKey = `${template.code}:${field.key}`
    if (seededReceiverKeys.has(seedKey)) continue
    const cur = typeValues.value[field.key]
    if (Array.isArray(cur) && cur.length > 0) continue
    seededReceiverKeys.add(seedKey)

    // 只带**有默认数量**的团队：没有历史数量的团队照样列在清单里，等办理人自己填
    const picked = teamRowsForReceiver(props.receiverTeam)
      .map(row => ({ row, qty: defaultQtyOf(row.group) }))
      .filter(x => x.qty !== '')
      .map(({ row, qty }) => ({
        name: row.group,
        ...(row.manager ? { manager: row.manager } : {}),
        type: 'manager',
        pick: 'group',
        qty,
      }))
    if (picked.length > 0) {
      // 预填的都是历史接收量 → 记入基准：剩余/超限只统计超出它的部分（见 receiverSeedBaseline）
      for (const p of picked) {
        receiverSeedBaseline.value = { ...receiverSeedBaseline.value, [p.name]: Number(p.qty) || 0 }
      }
      seed[field.key] = picked
    }
  }
  if (Object.keys(seed).length > 0) {
    typeValues.value = { ...typeValues.value, ...seed }
  }
}

watch(
  // 换结论 / 轮询汇总回来 / 换到下一环，都可能带来新的"历史数量"，各触发一次（靠 seededReceiverKeys 去重）
  [() => typeTemplate.value.code, () => activeStep.value?.index, () => props.rotationReceipts],
  () => seedReceiverTeams(),
  { immediate: true },
)

/**
 * 回收类结论（结论码 → 结论文案的基名）：三种回收**同一办理形态**
 * （都要填回收数量 + 回收金额，见 utils/approvalTypes 的 BUILTIN），
 * 但业务上要分别统计去向，所以各占一个码。
 *
 * 新增一种回收去向时**只改这张表**：needRecycle（数量/金额字段、库存旁注）
 * 与结论文案（resultLabelOf）都从这里取，别在两处各写一遍。
 */
const RECYCLE_RESULTS: Readonly<Record<string, string>> = {
  recycle: '回收',
  supplier_recycle: '供应商回收',
  platform_recycle: '平台回收',
  apply_platform_recycle: '申请平台回收',
}

/**
 * 「回收」类结论：额外把"这批货总共多少"摆出来当旁注。
 * 只是提示，不参与校验（上限由模板字段的 `limit` 管）。
 */
const needRecycle = computed(
  () => RECYCLE_RESULTS[selectedResult.value] !== undefined,
)

/** 表单值的文本形态（undefined / null 一律空串：别把 "undefined 件" 写进标签） */
function textOf(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

/**
 * 数字的**展示**文本：小数最多两位。
 *
 * 为什么需要：件数 / 金额是浮点累加出来的（团队清单各组合计、`0.1 + 0.2`），
 * 不裁的话结论标签会写成「部分接收 0.30000000000000004 件」，一路带进时间线、
 * 表格的「结论 / 审批结论」列和归档表 —— 归档时这串尾巴就是脏数据。
 *
 * 只用于拼**文案**：`extra.qty` 等落库值仍是原值（台账与分支条件按它算），别拿这个函数去改记录。
 * 不用千分位：它出现在句子里（「部分接收 1,234.5 件」读着别扭）。
 */
function numText(value: unknown): string {
  const text = textOf(value).trim()
  if (text === '') {
    return ''
  }
  const n = Number(text.replace(/,/g, ''))
  if (!Number.isFinite(n)) {
    return text
  }
  return String(Number(n.toFixed(2)))
}

/**
 * 多团队交接：把各团队填的接收数量**合计**写进 `qty`。
 *
 * 为什么要合计：接收台账、分支条件、时间线都按 `extra.qty` 看"这一环接了多少件"；
 * 只把数量挂在 `members[].qty` 上的话，每个消费方都得自己加总，口径容易走偏。
 *
 * 为什么合计**压过**模板里的 `qty`：`qty` 只该是团队清单的合计，而「接收」类结论的
 * 数量框是按上限**自动预填 + 只读**的（预填的正是整段剩余 —— 也就是"全部接收"的量）。
 * 以前只在 `qty` 空着时才用合计兜底，于是团队负责人改完各团队数量，记录里仍是
 * 那整段剩余：改了半天等于没改，接收台账还多记了没人接的货。
 * 有明细就以明细为准，别让一个自动预填值压过人手填的清单。
 */
function withReceiverQty (extra: Record<string, unknown>) {
  if (extra.members === undefined) {
    return
  }
  const total = totalQtyOf(extra.members)
  if (total > 0) {
    extra.qty = String(total)
  }
}

/**
 * 负责人分配（pick_members）的**净分配量**快照：毛合计 − 预填基准。
 *
 * `extra.qty` 是**毛**合计（含清单里预填的"该团队此前已收"占位量，见 defaultQtyOf），
 * 而剩余扣减只该算**这次新分出去**的部分 —— 预填的那部分在前面环节的台账里已经扣过。
 * 引擎按流水重算剩余时就读这个字段（见 types/approval 的 receivedQuantities），
 * 不写的话旧单兜底口径会接管（多数单据等价，但先分配后接收的模板上会偏差）。
 *
 * 顺手把**扣完之后的剩余**也写进 extra（remaining_qty）：时间线上分配环节直接
 * 「已分配 X · 剩余 Y」，不用翻到弃置段才知道还剩多少。引擎不依赖它（自己重算）。
 */
function withAssignedQty (extra: Record<string, unknown>) {
  if (extra.members === undefined) {
    return
  }
  const list = Array.isArray(extra.members) ? extra.members : [extra.members]
  const net = list.reduce((sum: number, m) => {
    const n = Number(String((m as { qty?: unknown } | null)?.qty ?? '').trim()) || 0
    const base = receiverSeedBaseline.value[String((m as { name?: unknown } | null)?.name ?? '')] || 0
    return sum + Math.max(0, n - base)
  }, 0)
  extra.assigned_qty = String(net)
  const cap = Number(String(receiveCapText.value).replace(/,/g, ''))
  if (Number.isFinite(cap)) {
    extra.remaining_qty = String(Math.max(0, cap - net))
  }
}

/**
 * 「全部接收」被改成了部分接收：团队合计**没接完**剩余。
 *
 * 「全部接收」的语义是把剩余接完（数量由系统按剩余带出）。团队负责人这一环允许改
 * 各团队数量，合计没到剩余就只是部分接收 —— 码仍走 `receive`（分支条件、台账口径不动），
 * 但标签得说实话，见 `resultLabelOf`。
 *
 * 没有团队清单、或取不到剩余上限时不判：宁可不降级，也别瞎猜。
 */
function receiverShortOfCap (extra: Record<string, unknown>): boolean {
  if (extra.members === undefined || receiveCapText.value === '') {
    return false
  }
  const cap = Number(String(receiveCapText.value).replace(/,/g, ''))
  if (!Number.isFinite(cap)) {
    return false
  }
  const total = totalQtyOf(extra.members)
  return total > 0 && total < cap
}

/*
 * 「团队清单的合计 → 数量框」的 watch 搬到了 `childIsSecondReason` 声明之后
 * （它是 immediate 的，放这里会在 setup 时先碰 typeFields → TDZ，面板弹不出来）。
 */

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
 * 值从 `extra` 取（键名仍是 qty / amount，与改造前一致）。
 */
function recycleLabel(base: string, extra: Record<string, unknown>): string {
  const qty = numText(extra.qty)
  const amount = numText(extra.amount)
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

/* 「驳回」的结论码声明在表单状态区（REJECT_RESULT）：computed 会在 setup 期间被求值，别放这儿 */

/**
 * 办理选项（选项树的扁平清单）。
 *
 * 「驳回」不再出现在这里：
 *   · 树里配了 link=reject 的叶子一并滤掉；
 *   · 以前给环节级树补的那条「其它 / 驳回」也不再补（见 canRejectBack —— 回退改由按钮承担）。
 * 全被滤光时退回原清单：宁可多摆一个，也不能让办理人无路可走。
 */
const optionMenuItems = computed(() => {
  const groups = pickedGroups.value
  const withoutReject = groups.map(g => ({ title: g.title || '未分类', items: (g.items ?? []).filter(i => i.link !== REJECT_RESULT) }))
  // 树里只配了驳回：退回原清单，不能让办理人连一个选项都没有
  const allFiltered = withoutReject.every(g => g.items.length === 0) && groups.some(g => (g.items ?? []).length > 0)
  const source = allFiltered
    ? groups.map(g => ({ title: g.title || '未分类', items: g.items ?? [] }))
    : withoutReject

  const list: Array<ApprovalOptionLeaf | { type: 'subheader', text: string }> = []
  for (const g of source) {
    list.push({ type: 'subheader', text: g.title }, ...g.items)
  }
  return list
})

/** 下拉清单里的第一个**叶子**（跳过类别标题），用作默认值；没有叶子时返回 null */
function firstLeafOf (items: Array<ApprovalOptionLeaf | { type: 'subheader', text: string }>): ApprovalOptionLeaf | null {
  const hit = items.find(i => (i as { type?: string }).type !== 'subheader')
  return (hit as ApprovalOptionLeaf | undefined) ?? null
}

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
 * 团队清单的合计 → 「数量」框（只同步**按上限预填**的那种数量框）。
 *
 * 只读框里挂着整段剩余、记录的却是各团队合计，两处数字对不上，人只会怀疑系统疯了。
 * 所以清单里一有数量就把它写成数量框的值 —— 看到的就是要记的。
 *
 * 只管 `prefillFromLimit` 的框（「全部接收」）：部分接收那种是人手填的数量，不归这里管。
 * 合计为 0（还没分配）时不动它，留着上限预填值，别把框擦成空白。
 *
 * ⚠️ 必须写在 `childIsSecondReason` 声明**之后**：`immediate: true` 会在 setup 阶段
 * 读 `typeFields`（→ childIsSecondReason），放前面就是 TDZ —— 表单渲染直接崩，
 * 界面上「办理」面板弹不出来。搬回来之前先想清楚这条链。
 */
watch(
  [() => totalQtyOf(typeValues.value.members), () => typeTemplate.value.code],
  ([sum]) => {
    const qtyField = typeFields.value.find(f => f.key === 'qty')
    if (sum <= 0 || !qtyField?.prefillFromLimit) {
      return
    }
    if (String(typeValues.value.qty ?? '').trim() === String(sum)) {
      return
    }
    typeValues.value = { ...typeValues.value, qty: String(sum) }
  },
  { immediate: true },
)

/**
 * 选中「选择接收部门」时**直接展开部门面板**，不用再点一次同名按钮。
 *
 * 这条处理方式是一对一交接（`control='team'` 且 `pick='team'`，口径同 OptionFormRenderer 的
 * qtyEditableOf），候选面板本来就该随结论一起出现：原来要"点单选项 → 再点按钮"两步，
 * 而按钮与单选项同名，现场点完单选以为没反应（截图反馈：选完「选择接收部门」还要再点一次）。
 *
 * 只在**该字段刚出现**（换结论 / 换环节）时补开一次：面板已经展开、或用户自己关掉后
 * 不会因为表单其它变化又被弹回来；已经选过部门（chips 非空）也不弹。
 *
 * ⚠️ 必须写在 `childIsSecondReason` 声明**之后**（与上面那条 watch 同一个 TDZ 坑）：
 * `immediate: true` 会在 setup 阶段读 `typeFields`（→ childIsSecondReason），放前面就是
 * "Cannot access 'childIsSecondReason' before initialization" —— 表单 setup 直接崩，
 * 界面上点「办理」毫无反应。实测踩过（放在 startPick 旁边，正好在 600 多行）。
 */
watch(
  () => typeFields.value.map(f => `${f.key}:${f.control}:${f.pick ?? ''}`).join('|'),
  () => {
    if (pickingField.value) {
      return
    }
    const pick = typeFields.value.find(f => f.control === 'team' && f.pick === 'team')
    if (!pick) {
      return
    }
    const chosen = typeValues.value[pick.key]
    if (Array.isArray(chosen) && chosen.length > 0) {
      return
    }
    pickingField.value = pick
  },
  { immediate: true },
)

/**
 * 处理方式一变（或它带的树变了）就**校正**一级 / 二级 —— 但只在"当前选择已经失效"时校正。
 *
 * 口径（现行需求）：**默认选中树里的第一个叶子**，二级跟着取它的第一项 ——
 * 下拉一出现就已经是个合法结论，办理人不动它也能直接提交。
 * 所以下拉必须把选中文案显示出来（别用 placeholder 盖住已选值），
 * 否则就会出现"看着是空的、其实已经选了一个"的老问题（见 handleConfirm 的必选兜底）。
 *
 * ⚠️ 这里的判断是**必须的**：`selectedOption` 是 computed，`selectItems` 一旦重算就会返回
 * 新对象 —— 无条件 `pickedLeaf = 第一个叶子` 会把办理人**刚选的**叶子打回第一个，
 * 现象就是"办理选项选不中 / 选了又跳回去"（同人连续多环时预览环重算也会触发它）。
 */
watch(
  [selectedOption, pickedGroups],
  () => {
    const leaves = optionMenuItems.value
    const current = pickedLeaf.value
    // 选中的叶子在这棵树里还找得到（按文案 + 链路比，不按对象身份）就不动它
    const stillValid = !!current && leaves.some(i => (i as { type?: string }).type !== 'subheader'
      && (i as ApprovalOptionLeaf).text === current.text
      && (i as ApprovalOptionLeaf).link === current.link)
    if (stillValid) {
      return
    }
    pickedLeaf.value = firstLeafOf(leaves)
    pickedChild.value = pickedLeaf.value?.children?.[0] ?? ''
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

function resetFormState() {
  /*
   * 结论回到**这一环的第一个选项**（与挂载时同一口径）。
   * 不能写空串：空串会让 selectedOption 变 undefined，选项树整块从界面上消失
   * （pickedGroups 取的就是选中项的 groups），下一环要等 props 变化才恢复。
   */
  selectedOptionKey.value = selectItems.value[0]?.key ?? ''
  // 一级 / 二级与挂载时同一口径：树里的第一个叶子 + 它的第一项二级
  pickedLeaf.value = firstLeafOf(optionMenuItems.value)
  pickedChild.value = pickedLeaf.value?.children?.[0] ?? ''
  // 审批类型表单整份清空：下一环要填的字段可能完全不同（渲染器会按新结论重新预填）
  typeValues.value = {}
  // 换环节了，上个环节各团队填过的数量不能再当默认值（那不是"这个团队这次接多少"）
  qtyMemory.value = {}
  // 预填标记一起清：新环节的接收团队清单要按它自己的历史重新带数量
  seededReceiverKeys.clear()
  receiverSeedBaseline.value = {}
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

/**
 * 选人控件在表单里按数组放，落库时：
 *   · 只选了**一个** → 仍是单个对象（沿用改造前的口径：时间线与老单据都按单对象读）；
 *   · 选了**多个** → 数组，每个成员自带 `qty`（这批货分给了哪几个团队、各接多少）。
 * ⚠️ 别一律写数组：时间线按单对象渲染接收方节点，一律数组会让老展示读到 `undefined.name`。
 *
 * 另外把**数量为空 / 0 的团队剔掉**：「选择接收团队」现在是把全部团队摊成清单，
 * 数量 > 0 才代表"这个团队接货"（渲染器的约定，见 OptionFormRenderer 的 setTeamQty）。
 * 过滤放在提交口上做，清单与落库就只有一份口径，不会出现"列了 8 个团队、结果 8 个都记成接收方"。
 */
function membersForStore (value: unknown): unknown {
  if (!Array.isArray(value)) return value
  const list = value.filter(m => {
    if (!m || typeof m !== 'object') return false
    // 选部门（pick='team'）的成员本来就没有 qty，原样保留
    if (!Object.prototype.hasOwnProperty.call(m, 'qty')) return true
    return Number(String((m as { qty?: unknown }).qty ?? '').trim()) > 0
  })
  return list.length <= 1 ? (list[0] ?? value) : list
}

/** 接收方合计件数（单对象 / 数组都认；读不到按 0） */
function totalQtyOf (members: unknown): number {
  const list = Array.isArray(members) ? members : [members]
  return list.reduce<number>((sum, m) => {
    const n = Number(String((m as { qty?: unknown } | null)?.qty ?? '').trim())
    return sum + (Number.isFinite(n) ? n : 0)
  }, 0)
}

/**
 * 接收团队的数量校验（返回提示文案，空串 = 通过）。
 *
 * 两条：
 *   ① 「选择接收团队」的清单摊着全部团队，提交时**至少要有一个团队填了数量** ——
 *      一个都没填就提交，等于"这环把货交给谁"完全没记录，后面查台账也查不到；
 *   ② 各团队数量**合计不能超过本环节还能接的数量** —— 摊开填的时候单看每一行都不越界，
 *      加起来却可能超过剩余（剩余 300，三个团队填 100 + 200 + 200），
 *      一旦放过，接收台账会把多出来的件数记成"已接收"，后面所有环节的剩余都跟着错。
 *
 * 选部门（成员没有 qty 字段）不受这两条约束 —— 它是一对一交接，不需要数量。
 */
function receiverQtyError (extra: Record<string, unknown>): string {
  const raw = extra.members
  if (raw === undefined) return ''
  const list = Array.isArray(raw) ? raw : [raw]
  const hasQty = list.some(m => !!m && typeof m === 'object' && Object.prototype.hasOwnProperty.call(m, 'qty'))
  const valid = list.filter(m => Number(String((m as { qty?: unknown } | null)?.qty ?? '').trim()) > 0)
  if (valid.length === 0) {
    // 选部门（成员压根没有 qty 字段）不适用这条：一对一交接不需要数量
    if (!hasQty && list.length > 0) {
      return ''
    }
    return '请至少给一个团队填写接收数量'
  }

  // 上限口径与数量框一致：剩余优先，没有剩余（老单 / 没关联产品）退回总库存
  const cap = Number(String(receiveCapText.value).replace(/,/g, ''))
  if (receiveCapText.value === '' || !Number.isFinite(cap)) {
    return ''
  }
  /*
   * 校验口径与清单末尾的剩余显示一致（OptionFormRenderer 的 freshQtyTotalOf）：
   * 预填的历史接收量（receiverSeedBaseline）是前面环节已经接收掉的，上限里扣过一次，
   * 这里按**净变化**（当前值 − 基准，可正可负）统计 —— 基准内挪动（A 行少分、B 行补上，
   * 总量不变）是正常调整，逐行取正会把挪动误判成新分拦下来。
   */
  const total = totalQtyOf(raw)
  const fresh = list.reduce((sum, m) => {
    if (!m || typeof m !== 'object') return sum
    const n = Number(String((m as { qty?: unknown }).qty ?? '').trim()) || 0
    const base = receiverSeedBaseline.value[String((m as { name?: unknown }).name ?? '')] ?? 0
    return sum + (n - base)
  }, 0)
  if (fresh > cap) {
    const name = usingRemaining.value ? '剩余接收数量' : '总库存数量'
    return `本次新分合计 ${fresh} 件，超过${name}（${cap} 件），请调整后再提交`
  }
  /*
   * 「部分接收」的语义是"这次接不完"（与数量框的限值同口径：等于上限要走「全部接收」）。
   * 合计正好把剩余接完时，数量框上那个小于上限的规则管不到它 —— 得在这里补一道，
   * 否则记录会写成「部分接收 <剩余> 件」，跟「全部接收」自相矛盾。
   */
  if (total >= cap && typeTemplate.value.code === 'part_receive') {
    const name = usingRemaining.value ? '剩余接收数量' : '总库存数量'
    return `部分接收的合计要小于${name}（${cap} 件），正好接完请选「全部接收」`
  }
  return ''
}

/**
 * 组装本环节的结论。
 *
 * 字段部分**完全由审批类型模板决定**（快照里那一份）：
 *   ① 固定值（如报废清仓的 confirmed）→ ② 当前**可见**的字段值（被 showWhen 隐藏的不带出去）
 *   → ③ 内置副作用（接收台账 / 接收方文案）。
 * 结论文案仍按码拼（`部分接收 100 件` 这类带值的标签是全站共用的展示口径，别在这里改口径）。
 */
function collectResult(): { result: string, result_label: string, extra: Record<string, unknown> } {
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
      const value = typedFieldValueOf(field)
      if (value === undefined) {
        continue
      }
      extra[field.key] = field.key === 'members' ? membersForStore(value) : value
    }
    withReceiverQty(extra)
    if (leaf.link === PICK_MEMBERS_RESULT) {
      withAssignedQty(extra)
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
    const value = typedFieldValueOf(field)
    if (value === undefined) {
      continue
    }
    extra[field.key] = field.key === 'members' ? membersForStore(value) : value
  }
  withReceiverQty(extra)
  if (result === PICK_MEMBERS_RESULT) {
    withAssignedQty(extra)
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
 * 类型字段的上限值（数值）：`receive_cap` = 剩余（没传时退总库存，与 receiveCapText 同源）、
 * `stock_qty` = 总库存、`stock_amount` = 总金额。取不到（老单没关联产品）返回 undefined。
 *
 * 给 collectResult 的锁死字段兜底用 —— 与渲染器的 limitValueOf 是同一套口径，别写岔。
 */
function fieldCapOf (field: { limit?: TypeLimitSource }): number | undefined {
  const text = field.limit === 'stock_qty'
    ? stockQtyText.value
    : field.limit === 'stock_amount'
      ? stockAmountText.value
      : receiveCapText.value
  const n = Number(String(text).replace(/,/g, ''))
  return Number.isFinite(n) ? n : undefined
}

/**
 * 类型字段提交时的取值：**表单值优先**；锁死字段按上限兜底。
 *
 * ⚠️ 锁死字段（`readonlyWhenFull` / `prefillFromLimit` 的数量框，「全部接收」就是这一类，
 * 语义"数量定死为剩余"）的表单值可能被**换结论的竞态**冲掉：渲染器随结论 `:key` 重建时
 * immediate 预填 emit 先于父级"换结论清空"的 watch 执行，写进去的值又被 `{}` 盖掉；
 * 之后 `limitSignature` 不再变化，预填不会重跑。而显示层有兜底（渲染器 displayValueOf
 * 永远显示上限）、v-form 校验用的也是显示值 —— 于是**框里看着有数、提交却没落**。
 * 后果（实测一张单）：「全部接收」的 extra.qty 缺失 → 接收台账不累计这一环 →
 * 已接收/剩余虚高，下一环的「前面团队接收」与清单预填也拿不到它。
 * 这里按上限补上，与显示层同一口径。
 */
function typedFieldValueOf (field: TypeField): unknown {
  const raw = typeValues.value[field.key]
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
    // **原样返回**：members 是数组，一旦 String() 化，membersForStore 会原样透传字符串，
    // 提交链路就报「请选择接收团队」（实测踩过）—— 兜底逻辑只该作用于锁死的数量框。
    return raw
  }
  if (field.control === 'number' && (field.readonlyWhenFull === true || field.prefillFromLimit === true)) {
    const cap = fieldCapOf(field)
    if (cap !== undefined) {
      return String(cap)
    }
  }
  return undefined
}

/**
 * 结论文案：带值的标签（部分接收 100 件 / 回收 100 件 / ￥200 / 接收团队：X（负责人 Y））在这里拼。
 * 值是空的就不拼（`部分接收 0 件` 是改造前就有的兜底，保持不变）。
 */
function resultLabelOf(result: string, extra: Record<string, unknown>): string {
  const custom = customLabelOf(result)
  switch (result) {
    case 'receive': {
      /*
       * 团队负责人可以改各团队数量：合计没接完剩余时，标签不能还写「全部接收」——
       * 记录里明明是「全部接收」却只记了几百件，看单据的人只会以为账错了。
       * 码保持 receive（分支条件照旧走），只把标签降级成「部分接收 X 件」。
       * 模板自己配了结论文案（custom）时以它为准，不擅自改人写的字。
       */
      if (!custom && receiverShortOfCap(extra)) {
        return `部分接收 ${numText(extra.qty) || 0} 件`
      }
      return custom || '全部接收'
    }
    case 'part_receive': {
      return `部分接收 ${numText(extra.qty) || 0} 件`
    }
    case RECEIVE_QTY_RESULT: {
      return `接收 ${numText(extra.qty) || 0} 件`
    }
    case 'recycle':
    case 'supplier_recycle':
    case 'platform_recycle':
    case 'apply_platform_recycle': {
      // 基名从 RECYCLE_RESULTS 取（与码表文案一致，case 已保证能命中）
      return recycleLabel(RECYCLE_RESULTS[result], extra)
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
    case 'dispose': {
      // 弃置：当场拍板的处置（fixedValues 带 confirmed，见 utils/approvalTypes 的 BUILTIN）
      return custom || '弃置'
    }
    case 'other_reason': {
      return textOf(extra.reason) || labelOf(result)
    }
    case PICK_MEMBERS_RESULT:
    case PICK_TEAM_RESULT: {
      type Receiver = { name?: string, manager?: string, pick?: string, qty?: unknown }
      const raw = extra.members
      const list = (Array.isArray(raw) ? raw : (raw ? [raw] : []))
        .filter((m): m is Receiver => !!m && typeof m === 'object')
      const isDept = list[0]?.pick === 'team'
      const title = isDept ? '选择接收部门' : '选择接收团队'
      /*
       * 结论文案带上「名字 + 负责人 + 接收数量」：时间线上一眼能看出这一环把货交给了谁、找谁、各接多少。
       * 多团队时按「、」串起来（`选择接收团队：美1组（负责人 A）30 件、欧洲组（负责人 B）20 件`）。
       */
      const parts = list.map(m => {
        const qty = numText(m.qty)
        return `${m.name ?? ''}${m.manager ? `（${isDept ? '部门负责人' : '团队负责人'} ${m.manager}）` : ''}${qty ? ` ${qty} 件` : ''}`
      }).filter(text => text.trim() !== '')
      return parts.length > 0 ? `${title}：${parts.join('、')}` : title
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

/** 一个环节的提交体（不含 done 回调）：连锁提交时按顺序排队用 */
interface SubmitBody {
  index: number
  result: string
  result_label: string
  extra: Record<string, unknown>
  opinion: string
  files: File[]
}

/**
 * 本环节的校验（返回错误文案，空串 = 通过）。
 *
 * 抽出来是因为它有两个调用方：本组自己的「提交」（handleConfirm），
 * 以及连锁提交时父级对**下一环节子表单**的校验（defineExpose 的 validate）。
 */
async function validateSelf (): Promise<string> {
  /*
   * 选项树兜底：正常情况下已有默认第一项（见上面处理那条 watch），这里留一道是给
   * "树里一个可选叶子都没有"（全被驳回过滤掉 / 模板没配）的情况 ——
   * 那时代码还是会提交空结论（result 为空 → 流程里没有分支命中 → 停在原地），先拦下来说清楚。
   */
  if (hasNodeLevelTree.value && !pickedLeaf.value) {
    return '请选择「办理选项」后再提交'
  }

  if (handleForm.value) {
    const { valid } = await handleForm.value.validate()
    // 字段自己的红字已经显示，这里只回一个非空标记，别再叠一句文案
    if (!valid) return ' '
  }

  /*
   * 「外部环境」类必须写意见/备注（见 opinionRequired 的说明）。
   * 放在渲染器校验**之后**：先解决字段本身的问题，再补这段说明，两处红字不会一起炸。
   */
  // 子表单（后续环）不校验意见：整份连锁提交共用最下面那一条（见 handleConfirm）
  if (!props.chained && opinionRequired.value && opinion.value.trim() === '') {
    opinionError.value = OPINION_REQUIRED_HINT
    return OPINION_REQUIRED_HINT
  }

  const { result, extra } = collectResult()
  // 兜底的同一件事：没有有效结论就别发请求（空结论会让单据卡在本环节）
  if (!result) {
    return '请选择「办理选项」后再提交'
  }

  /*
   * 接收团队的数量：清单里摊着全部团队，但不能一个都不填就提交 ——
   * 那样"这环把货交给谁、各接多少"完全没记录，后面查台账也查不到（见 receiverQtyError）。
   */
  return receiverQtyError(extra)
}

/** 收集本环节的提交体（不含 done）：连锁提交时按顺序排队用 */
function collectBody (): SubmitBody {
  const { result, result_label, extra } = collectResult()
  return {
    index: activeStep.value?.index ?? -1,
    result,
    result_label,
    extra,
    opinion: opinion.value.trim(),
    files: attachment.value ? [attachment.value] : [],
  }
}

/**
 * 顺序提交：本环 → 中间态渲染出来的下一环（同一人连续环节）。
 *
 * 为什么可以一次点提交推进多环：每一环的 stepId 都由提交侧按**最新 decisions**
 * 现算（见 composables/useNodeSubmit），上一环写库后下一环的 index 依然有效；
 * 中途失败就停在那儿（第一环已落库、下一环仍是待办），重新打开接着办即可。
 */
function submitQueue (queue: SubmitBody[]) {
  const body = queue.shift()
  if (!body) {
    submitting.value = false
    emit('finish')
    return
  }
  emit('submit', {
    ...body,
    done: (ok: boolean, info?: { sameApproverNext?: boolean }) => {
      if (!ok) {
        submitting.value = false
        return
      }
      // 队列里还有（中间态渲染出来的下一环）：继续推进，先不解除"提交中"
      if (queue.length > 0) {
        /*
         * 必须让出这一轮再发下一次：done 是**同步**回调，此刻 useNodeSubmit 还在
         * 它自己的 try 里（submitting 尚未复位，见 useNodeSubmit 的 finally）——
         * 直接递归 emit 会被它的"正在提交"判据拦下（payload.done(false)），
         * 表现为"第一环落库、第二环静默没提交"。微任务排在 finally 之后，正好。
         */
        queueMicrotask(() => submitQueue(queue))
        return
      }
      submitting.value = false
      if (hasNextAction.value || info?.sameApproverNext) {
        waitingNext.value = true
        return
      }
      // 这一组的动作全办完了：弹窗外壳据此关闭（内联面板没有监听者，等于什么都不做）
      emit('finish')
    },
  })
}

async function handleConfirm() {
  // 正在提交 / 上一环刚提交、同人的下一环还没传回来：都不该再发一次
  if (submitting.value || waitingNext.value) return
  const step = activeStep.value
  if (!step) return

  formError.value = ''
  opinionError.value = ''
  const error = await validateSelf()
  if (error) {
    if (error.trim()) {
      formError.value = error
    }
    return
  }

  /*
   * 逐环校验 + 取值：本环 → 中间态铺出来的后续几环（同一人连续环节，可能三环以上）。
   * 全部通过才发第一次请求；任何一环不过都停在原地，审批流数据一点都不会动。
   */
  const queue: SubmitBody[] = [collectBody()]
  for (let i = 0; i < previewSteps.value.length; i++) {
    const child = childRefs.value[i]
    if (!child) {
      continue
    }
    const childError = await child.validate()
    if (childError) {
      formError.value = childError.trim()
        ? `第 ${i + 2} 个动作：${childError}`
        : `第 ${i + 2} 个动作还有必填项没填完`
      return
    }
    queue.push(child.collect())
  }

  /*
   * 意见 / 附件只有最下面那一份（连续多环共用）：
   *   · 意见写进每一环的流水 —— 一次办理只留一条说明，与现场习惯一致；
   *   · 附件只挂第一环（附件按环节 index 上传成独立文件记录，逐环重传会多出好几份）。
   */
  const sharedOpinion = opinion.value.trim()
  queue.forEach((body, i) => {
    body.opinion = sharedOpinion
    if (i > 0) {
      body.files = []
    }
  })

  submitting.value = true
  submitQueue(queue)
}

/**
 * 回退上级：等价于以「驳回」结论提交本环 —— 模板里那条分支要么回退到上一个别人办的环节
 * （loopBackTo），要么直接终结流程。
 *
 * 以前它是办理下拉里的一个选项，现在挪到提交旁边（业务要求，见模板按钮区）；
 * 因此这里不校验下拉与类型字段，意见写了下就带上。
 */
function handleRejectBack () {
  if (submitting.value || waitingNext.value) return
  const step = activeStep.value
  if (!step) {
    return
  }
  formError.value = ''
  opinionError.value = ''
  submitting.value = true
  submitQueue([{
    index: step.index,
    result: REJECT_RESULT,
    result_label: '回退上级',
    extra: {},
    opinion: opinion.value.trim(),
    files: attachment.value ? [attachment.value] : [],
  }])
}

/**
 * 给外壳用：
 *   · reset —— 弹窗关闭时把"等待下一环"清掉（否则下次打开还是禁用状态）；
 *   · validate / collect —— 连锁提交时父级（同一组件的外层实例）据此逐环校验与排队。
 */
defineExpose({
  reset: resetFormState,
  validate: validateSelf,
  collect: collectBody,
})
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
