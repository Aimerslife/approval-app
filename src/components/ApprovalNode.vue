<template>
  <v-timeline-item class="mb-12" :dot-color="dotColor" :size="size">
    <template #icon>
      <span :style="{ fontSize: iconFontSize, color: iconColor }">{{ initials }}</span>
    </template>

    <div class=" d-flex align-center justify-space-between">
      <div class="d-flex align-center gap-2">
        <span v-if="deptName" class="text-[12px]">[{{ deptName }}]</span>

        <v-avatar size="30px">
          <v-img alt="Avatar" :src="manageDatas[0]?.avatar" />
          <!-- <v-icon :color="message.color" :icon="message.icon"></v-icon> -->
        </v-avatar>

        <span class="text-body-small" :class="{ 'text-medium-emphasis text-decoration-line-through': transferredTo }">
          {{ manageDatas[0]?.name }}</span>

        <v-chip v-if="transferredTo" color="secondary" label size="x-small" variant="tonal">
          已转办 → {{ transferredTo }}
        </v-chip>

        <v-chip v-if="transferIn" color="primary" label size="x-small" variant="flat">
          转办：{{ transferIn.delegated_from }} → {{ transferIn.name }}
        </v-chip>

        <template v-if="manager?.result">
          <v-chip class="ms-0" color="primary" label size="x-small">{{ manager.result_label }}</v-chip>
        </template>

        <template v-else-if="status">
          <v-chip class="ms-0" color="success" label size="x-small">通过</v-chip>
        </template>

        <template v-else-if="!canHandle">
          <!-- 还没轮到这个环节：不给办理入口（见 props.canHandle 的说明） -->
          <span class="text-[11px] text-medium-emphasis">未到该环节</span>
        </template>

        <template v-else>
          <v-dialog v-model="dialog" max-width="500">
            <template #activator="{ props: activatorProps }">
              <v-btn color="success" size="x-small" variant="tonal" v-bind="activatorProps"
                @click="dialogs = true">办理</v-btn>
            </template>

            <v-card>
              <v-card-title class="d-flex align-center ga-2 text-[15px] py-3">
                <v-icon color="primary" size="18">mdi-check-all</v-icon>
                <span>审批</span>
              </v-card-title>

              <v-divider />

              <v-card-text class="d-flex flex-column ga-4 pb-2">
                <!-- 办理：按环节类型（tab）渲染对应表单 -->
                <div v-if="radios == 'deal'">
                  <!--
                    「选择处理方式」这一层：**环节级选项树时整段不显示** ——
                    那种配法下整个环节只有一棵树，"走哪条线"由树里每个一级的「实际链路」决定
                    （见上面的 hasNodeLevelTree 与 types/approval 的 ApprovalNodeOption）。
                  -->
                  <template v-if="!hasNodeLevelTree">
                    <div class="field-label mb-2">选择处理方式</div>
                    <v-radio-group v-if="useOptionRadios" v-model="selectedOptionKey" hide-details inline>
                      <v-radio v-for="opt in selectItems" :key="opt.key" :color="radioColorOf(opt.result)"
                        :value="opt.key">
                        <template #label>
                          <span class="text-[13px]">{{ opt.text }}</span>
                        </template>
                      </v-radio>
                    </v-radio-group>

                    <!--
                      下拉形态。⚠️ item-value 用**选项键**（文案 + 结论码），不能用结论码：
                      同一条线可以配多个选项文本，它们**共用同一个结论码** ——
                      拿码当值时 v-select 分不清选中的是哪一个（会一直高亮/提交第一个）。
                    -->
                    <v-select v-else v-model="selectedOptionKey" class="filter-select" density="compact"
                      hide-details item-title="text" item-value="key" :items="selectItems"
                      :menu-props="{ contentClass: 'filter-menu' }" single-line style="max-width: 480px"
                      variant="outlined">
                      <template #label>
                        <span class="text-[11px]">选择处理方式</span>
                      </template>
                    </v-select>
                  </template>
                  <div v-if="pickedGroups.length > 0" class="mt-2">
                    <div class="field-label mb-2">办理选项</div>
                    <v-select v-model="pickedLeaf" class="filter-select" density="compact" hide-details
                      item-title="text" :items="optionMenuItems"
                      :menu-props="{ contentClass: 'filter-menu' }" placeholder="请选择" return-object single-line
                      variant="outlined">
                      <template #label>
                        <span class="text-[11px]">选项</span>
                      </template>
                    </v-select>

                    <v-select v-if="leafChildren.length > 0" v-model="pickedChild" class="filter-select mt-2"
                      density="compact" hide-details :items="leafChildren"
                      :menu-props="{ contentClass: 'filter-menu' }" placeholder="请选择" single-line
                      variant="outlined">
                      <template #label>
                        <span class="text-[11px]">二级选项</span>
                      </template>
                    </v-select>
                  </div>

                  <!-- 选中结论需要补充信息时才展开对应的表单 -->
                  <div v-if="needReceiveQty" class="d-flex align-center ga-2 mt-2">
                    <v-text-field v-model="qty" class="qty-input" density="compact" hide-details label="接收数量"
                      single-line suffix="件" variant="underlined" width="160px" />
                  </div>

                  <div v-else-if="needRecycle" class="d-flex align-center ga-4 mt-2">
                    <v-text-field v-model="recycleQty" class="qty-input" density="compact" hide-details label="回收数量"
                      single-line suffix="件" variant="underlined" width="160px" />

                    <v-text-field v-model="recycleAmount" class="qty-input" density="compact" hide-details label="回收金额"
                      single-line suffix="￥" variant="underlined" width="160px" />
                  </div>

                  <div v-else-if="needScrapConfirm" class="d-flex align-center ga-2 mt-2">
                    <v-btn append-icon="mdi-transfer-right" color="error" size="small" variant="tonal"
                      @click="setClean = true">确认报废清仓</v-btn>
                  </div>

                  <div v-else-if="needReason && pickedGroups.length === 0" class="mt-2">
                    <!--
                      一级「原因」：**按 approvalModal 分组展示**（见上面的 groupedReasons，
                      分组标题就是 belong）。
                      二级「二级原因」：**只有归属 = 开发类** 的那几条原因才会展开，
                      候选项就是整份 secondApprovalModal —— 按数据展示，不按一级去筛。
                    -->
                    <v-select v-model="reason" class="filter-select" density="compact" hide-details item-title="text"
                      :items="groupedReasons" max-width="200" :menu-props="{ contentClass: 'filter-menu' }"
                      return-object single-line variant="outlined" @update:model-value="handleResonChange">
                      <template #label>
                        <span class="text-[11px]">原因</span>
                      </template>
                    </v-select>

                    <!--
                      二级「二级原因」：**只有归属 = 开发类** 的那几条原因才会展开，
                      候选项就是整份 secondApprovalModal —— 按数据展示，不按一级去筛。
                    -->
                    <v-select v-if="reason.belong === '开发类'" v-model="secondReason" class="filter-select"
                      density="compact" hide-details item-title="text" :items="secondApprovalModal" max-width="180"
                      :menu-props="{ contentClass: 'filter-menu' }" return-object single-line variant="outlined"
                      @update:model-value="handleSecondResonChange">
                      <template #label>
                        <span class="text-[11px]">二级原因</span>
                      </template>
                    </v-select>

                    <template v-if="reason.belong === '外部环境'">
                      <div class="mt-2">
                        <v-textarea v-model="reasonRemark" class="remark-input" density="compact" hide-details label=""
                          max-width="300" placeholder="补充说明" rows="2" variant="outlined" />
                      </div>
                    </template>
                  </div>
                  <!-- 「选择接收团队」：当场指定接收方 → 该结论**终结流程**，后面接的环节不再有人办 -->
                  <div v-if="needPickMembers" class="mt-2">
                    <div class="d-flex align-center ga-2 flex-wrap">
                      <v-btn color="primary" :prepend-icon="picking ? 'mdi-chevron-up' : 'mdi-account-plus-outline'"
                        size="small" variant="tonal" @click="picking = !picking">选择接收团队
                      </v-btn>
                    </div>

                    <div v-if="JSON.stringify(pickedMembers) !== '{}'" class="d-flex flex-wrap ga-1 mt-2">
                      <v-chip closable size="small" @click:close="unpickMember">
                        {{ pickedMembers.name }}
                      </v-chip>
                    </div>

                    <v-expand-transition>
                      <div v-show="picking">
                        <v-divider class="my-2" />
                        <DepartmentNode @select="pickMember" />
                      </div>
                    </v-expand-transition>
                  </div>
                </div>
                <!-- 备注 / 审批意见 -->
                <div>
                  <div class="field-label mb-2">备注 / 审批意见</div>

                  <v-textarea v-model="opinion" class="remark-input" :counter="300" density="compact" persistent-counter
                    rows="3" variant="outlined" />
                </div>
              </v-card-text>
              <!-- 附件：只保留回形针图标，点击文字同样能唤起选择框 -->
              <div class="d-flex align-center ga-1 px-4 pb-3">
                <v-file-input ref="fileInputRef" v-model="attachment" class="attachment-input" density="compact"
                  hide-input>
                  <template #prepend>
                    <v-icon color="#1055C9" size="15">mdi-paperclip</v-icon>
                  </template>
                </v-file-input>

                <span v-if="attachment" class="text-[12px] text-medium-emphasis text-decoration-underline text-truncate"
                  :title="attachment.name">
                  {{ attachment.name }}
                </span>

                <span v-else class="text-[12px] text-medium-emphasis cursor-pointer"
                  @click="fileInputRef?.click()">上传附件</span>

                <v-btn v-if="attachment" density="compact" icon="mdi-close" variant="plain" @click="attachment = null">
                  <v-icon icon="mdi-close" size="15" />
                </v-btn>
              </div>

              <v-divider />

              <v-card-actions class="px-4 py-3">
                <v-spacer />
                <v-btn size="small" text="取消" variant="plain" @click="dialog = false" />

                <v-btn color="primary" :loading="submitting" size="small" text="提交" variant="tonal"
                  @click="handleConfirm" />
              </v-card-actions>
            </v-card>
          </v-dialog>
        </template>
      </div>

      <div class="ml-auto">
        <div v-if="manager?.handled_at" class="mt-1 text-[12px] text-medium-emphasis">
          {{ formatDate(manager?.handled_at) }}
        </div>

        <span v-if="durationText" class="text-[12px] ml-auto ml-1">
          {{ durationLabel }}：{{ durationText }}
        </span>
      </div>
    </div>
    <!-- 已办理：渲染该审批人的选项 / 信息 / 文件 -->
    <template v-if="manager?.result">
      <v-sheet v-if="manager.opinion" class="py-2 px-3 text-body-small mt-1 w-fit" color="#F6F7F9" rounded="10">
        <span class="text-medium-emphasis">意见：</span>{{ manager.opinion }}
      </v-sheet>

      <!--
        模板配的**分项**：按模板配置展示办理时选的「类别 / 一级 / 二级」路径
        （见 optionPath）。没配选项树的环节不会写 option_group，这一块就不出现，
        退回下面的通用明细（数量 / 金额 / 原因…）。
      -->
      <div v-if="optionPath" class="mt-2 d-flex align-center gap-2">
        <v-chip color="primary" label size="x-small" variant="tonal">
          <span class="text-[9px]">分项</span>
        </v-chip>

        <span class="text-[12px]">{{ optionPath }}</span>
      </div>

      <!--
        「选择接收团队」选中的人：按成员卡片的方式显示**人本身的信息**（头像 + 姓名 + 邮箱）。
        只显示一个名字字符串看不出是谁；渲染口径与下方「抄送」一致。
      -->
      <div v-if="pickedReceiver" class="mt-2 d-flex align-center gap-2">
        <v-chip class="mr-1" color="primary" label size="x-small" variant="flat">
          <span class="text-[9px]">接收团队</span>
        </v-chip>

        <v-avatar class="mr-1" size="22">
          <v-img v-if="pickedReceiver.avatar" cover :src="proxyAvatar(pickedReceiver.avatar)" />
          <v-icon v-else size="13">mdi-account</v-icon>
        </v-avatar>

        <span class="text-[10px] text-medium-emphasis">{{ pickedReceiver.name }}</span>
        <span v-if="pickedReceiver.email" class="text-[10px] text-high-emphasis">{{ pickedReceiver.email }}</span>
      </div>

      <!--
        其余办理明细（数量 / 金额 / 原因…）。
        之前 extraItems 只定义了没渲染 —— 现在渲染出来；接收团队已单独成块，这里不重复。
      -->
      <div v-if="extraItems.length > 0" class="mt-1 d-flex flex-wrap align-center ga-2">
        <span v-for="it in extraItems" :key="it.key" class="text-[11px] text-medium-emphasis">
          {{ it.label }}：{{ it.value }}
        </span>
      </div>

      <div v-if="manager.files?.length" class="mt-1 d-flex align-center flex-wrap text-[11px]">
        <div v-for="f in manager.files" :key="f.id"
          class="d-inline-flex align-center  cursor-pointer text-[#89898A] underline" :href="f.url" rel="noopener"
          @click="showPic(f.url)">
          <v-icon size="11">mdi-paperclip</v-icon>
          <span class="mt-1">{{ f.name }}</span>
        </div>
      </div>
    </template>

    <template v-if="nodeTargets?.length">
      <div class="mt-2 d-flex align-center gap-2">
        <v-chip class="mr-1" color="secondary" label size="x-small" variant="flat">
          <span class="text-[9px]">抄送</span>
        </v-chip>

        <div v-for="(t, i) in nodeTargets" :key="i" class="d-flex align-center">
          <v-avatar class="mr-1" size="22">
            <v-img v-if="t.avatar" cover :src="t.avatar" />
            <v-icon v-else size="13">mdi-account</v-icon>
          </v-avatar>

          <span class="text-[10px] text-medium-emphasis">{{ t.name }}</span>
        </div>
      </div>
    </template>
  </v-timeline-item>

  <v-overlay v-model="overlay" @click:outside="overlay = false">
    <div class="d-flex align-center justify-center" style="width: 100vw; height: 100vh">
      <v-img contain max-height="90vh" rounded="10" :src="imgUrl" :style="{ maxWidth: '90vw' }" :width="800" />
    </div>
  </v-overlay>
</template>

<script lang="ts" setup>
import type { ApprovalChainItem, ApprovalNodeOption, ApprovalOptionGroup, ApprovalOptionLeaf, NodeSubmitPayload } from '@/types/approval'
import dayjs from 'dayjs'
// proxyAvatar：飞书头像要经服务端代理才能在浏览器里正常显示（接收团队那块要用头像）
import { proxyAvatar, type UserBrief } from '@/api/api'
import { APPROVAL_RESULTS, PICK_MEMBERS_RESULT } from '@/types/approval'
import { buildColorScale, pickColorStep } from '@/utils/color'

import { ensurePinyin, pinyinInitials } from '@/utils/pinyin'
import { formatDate, formatTimeDiff } from '@/utils/utils'
import DepartmentNode from './DepartmentNode.vue'

const overlay = ref(false)

interface ApprovalNodeProps {
  startTime?: string
  department?: string
  status?: number
  data?: ApprovalChainItem[]
  /** 审批链总步骤数，用于计算节点尺寸与动态色阶 */
  length?: number
  /** 当前环节在 chain 中的下标 */
  index?: number
  /** 上一环节的办理时间（首环节传订单创建时间）。
   *  本环节耗时 = 该时间 → 本环节办理时间；未办理时 → 现在（即「已等待」）。 */
  prevTime?: string
  /** 本环节可选的审批结论（如 ['pass','reject','pending']）。
   *  取自 flow 中该环节后面分支组所绑定的 result 条件，由父组件按 stepId 下发。
   *  不传时回退为默认的「通过 / 驳回」。 */
  allowedResults?: string[]
  /**
   * 本环节的**选项数组**（模板驱动，办理下拉框直接用它渲染）：
   * 由该环节的「审批结果分支配置」推导 —— `text` = 那条线的分支名、`result` = 它绑的结论码
   * （见 types/approval 的 collectStepOptionItems）；
   * **环节级选项树**时只有一项且带 `nodeLevel`（那种配法下没有"处理方式"这一层）。
   * 与 allowedResults 同时传时**以本字段为准** —— 它才带得上画布上给线起的名字。
   */
  allowedOptions?: ApprovalNodeOption[]
  /** 是否允许在本环节办理，默认 true（审批页不传，行为不变）。
   *  首页抽屉会把整条链都渲染出来，未到达的环节不该给办理入口 ——
   *  否则结论会被记到那个 stepId 上，但链路并不推进，看起来像「提交了没反应」。 */
  canHandle?: boolean
}
const props = withDefaults(defineProps<ApprovalNodeProps>(), {
  startTime: '',
  department: '',
  status: 0,
  data: () => [],
  length: 0,
  index: 0,
  prevTime: '',
  allowedResults: () => [],
  allowedOptions: () => [],
  canHandle: true,
})
// 选择项

const qty = ref('')
/** 回收数量 / 回收金额（tab=2 选「回收」时填写） */
const recycleQty = ref('')
const recycleAmount = ref('')
const radios = ref('deal')

const opinion = ref('')
/** tab=4「外部环境」分类下的补充说明 */
const reasonRemark = ref('')
/** 提交中，避免重复点击 */
const submitting = ref(false)
const size = computed(() => {
  // length 为 0 时 20 / 0 = Infinity，会导致后续计算全部变成 NaN
  if (props.length === 0) return 40
  return 35 + Math.round(20 / props.length * props.index)
})

const iconFontSize = computed(() => `${Math.max(12, Math.round(size.value / 3))}px`)

const colorScale = computed(() => buildColorScale(props.length))
const currentStep = computed(() => pickColorStep(colorScale.value, props.index))
const dotColor = computed(() => currentStep.value.bg)
const iconColor = computed(() => currentStep.value.fg)

const manageDatas = computed(() => props.data.filter(item => item.type == 'manager'))

/**
 * 头像上的字母（'张三' → 'zs'）。
 *
 * 词典是**动态**加载的（见 utils/pinyin.ts：入口 7.2MB，不进关键路径），所以分两步：
 * 先同步取一个（未就绪时退回首字，界面不会空着），加载完成后再刷新成拼音。
 * 与 utils/pinyin.ts 头部的用法说明一致。
 */
const initials = ref('')
watch(
  () => manageDatas.value[0]?.name,
  name => {
    initials.value = pinyinInitials(name)
    void ensurePinyin().then(() => {
      initials.value = pinyinInitials(name)
    })
  },
  { immediate: true },
)
/** 该步骤的审批人（办理信息记录在其上） */
const manager = computed<ApprovalChainItem | undefined>(() => manageDatas.value[0])

/** 本环节的办理时间；未办理时为 undefined */
const handledAt = computed(() => manager.value?.handled_at)

/** 耗时文案：已办理算到办理时刻（耗时），未办理算到当下（已等待） */
const durationLabel = computed(() => (handledAt.value ? '耗时' : '已等待'))

const durationText = computed(() => {
  const from = props.index === 0 ? props.startTime : props.prevTime
  if (!from || !dayjs(from).isValid()) return ''
  return formatTimeDiff(from, handledAt.value)
})

const deptName = computed(
  () =>
    manageDatas.value[0]?.department
    ?? props.data.find(item => item?.department)?.department
    ?? props.department
    ?? '',
)

/** extra 字段 → 展示文案 */
const EXTRA_LABELS: Record<string, string> = {
  qty: '数量',
  amount: '金额',
  confirmed: '确认状态',
  reason: '原因',
  reason_belong: '分类',
  second_reason: '二级原因',
  remark: '补充说明',
  members: '接收人员',
}
/**
 * extra 中**不在这里渲染**的字段：
 *   · `_target` 结尾 —— 仅供内部联动/路由的标识，对用户无意义；
 *   · `option_*` —— 模板选项树的分项（类别 / 一级 / 二级 / 链路码），由下面的
 *     `optionPath` 单独成块展示（链路码是内部路由用的码，不给人看）。
 */
const EXTRA_HIDDEN_KEYS = /_target$|^option_/

/**
 * 模板配的**分项路径**：办理时在选项树里选的「类别 / 一级 / 二级」
 * （见 collectResult 写进 extra 的 option_group / option_text / option_child）。
 *
 * 只有模板的选项树才写 `option_group`，所以拿它当"这是分项"的判据 ——
 * 「驳回」这类流程自带的出口不在树里，不显示成路径（结果 chip 已经说明它是驳回）。
 */
const optionPath = computed(() => {
  const extra = manager.value?.extra
  const group = String(extra?.option_group ?? '').trim()
  if (!group) return ''
  return [group, extra?.option_text, extra?.option_child]
    .map(v => String(v ?? '').trim())
    .filter(Boolean)
    .join(' / ')
})

/**
 * 「选择接收团队」选中的人（原始成员对象）。
 * 单独取出来是为了能显示**人本身的信息**（头像 / 邮箱），而不是只剩一个名字字符串；
 * 兼容两种形状：单选是成员对象、多选是成员数组（取第一个）。
 */
const pickedReceiver = computed<ApprovalChainItem | undefined>(() => {
  const raw = manager.value?.extra?.members
  const one = Array.isArray(raw) ? raw[0] : raw
  return one && typeof one === 'object' ? (one as ApprovalChainItem) : undefined
})

/** 办理信息中的选项明细（extra），过滤空值与内部标识字段后生成 { label, value } 列表 */
const extraItems = computed(() => {
  const extra = manager.value?.extra
  if (!extra) return []
  return Object.entries(extra)
    // members（接收团队）已在上方单独成块渲染，这里不重复
    .filter(([key]) => key !== 'members')
    .filter(([key]) => !EXTRA_HIDDEN_KEYS.test(key))
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([key, v]) => ({
      key,
      label: EXTRA_LABELS[key] ?? key,
      // 「接收人员」这类值是成员对象（单选）或成员数组（多选）：拼名字展示，别渲染成 [object Object]
      value: v !== null && typeof v === 'object'
        ? (Array.isArray(v) ? v : [v])
          .map(x => (x && typeof x === 'object' ? String((x as { name?: unknown }).name ?? '') : String(x)))
          .filter(Boolean)
          .join('、')
        : typeof v === 'boolean'
          ? (v ? '已确认' : '未确认')
          : String(v),
    }))
    .filter(item => item.value !== '')
})

const dialog = ref(false)
const setClean = ref(false)
const attachment = ref<File | null>(null)
const fileInputRef = ref<{ click: () => void } | null>(null)
const dialogs = ref(false)
const selectedValue = ref('')

const reason = ref<ReasonItem>({ text: '市场需求分析不足/运营策略不当', target: 'operation-analysis', belong: '运营' })
const secondReason = ref<{ text: string, target: string }>({ text: '运营/销售', target: 'sale' })
/** 「选择接收团队」选中的接收方：只记进本环节的办理记录；该结论会**终结流程**（见 CLOSE_FLOW_RESULTS） */
const pickedMembers = ref<ApprovalChainItem>({})
/** 选人面板是否展开 */
const picking = ref(false)

/** 选一位接收人（可多点几位，去重后累积） */
function pickMember(u: UserBrief) {
  pickedMembers.value = {
    name: u.name,
    ...(u.email ? { email: u.email } : {}),
    ...(u.avatar ? { avatar: u.avatar } : {}),
    type: 'manager',
  }
}

function unpickMember() {
  pickedMembers.value = {}
}
/**
 * 本环节的**选项数组**：直接来自模板 —— 见 types/approval 的 collectStepOptionItems
 * （节点下面每条「审批结果分支」= 一个选项：文案取分支名、值取它绑的结论码；
 *  配了**环节级选项树**时只有一项、且带 `nodeLevel`）。
 *
 * 前端只渲染、不造词：只有老调用方仅传 `allowedResults`（纯结论码）时，
 * 才退回用 APPROVAL_RESULTS 的目录文案兜底。
 */
const optionItems = computed<ApprovalNodeOption[]>(() => {
  if (props.allowedOptions?.length) {
    return props.allowedOptions
  }
  const codes = props.allowedResults?.length ? props.allowedResults : ['pass', 'reject']
  return codes.map(v => ({ result: v, text: APPROVAL_RESULTS.find(r => r.value === v)?.label ?? v }))
})

/**
 * 一个选项的**唯一键**：文案 + 结论码。
 * 同一条线配了多个选项文本时它们**共用同一个结论码**，只有这个键能区分选的是哪一个。
 */
function optionKeyOf(o: { result: string, text: string }): string {
  return `${o.text}|${o.result}`
}

/** 下拉候选项：在选项上补一个 key（供 v-select 的 item-value 用，见模板里的说明） */
const selectItems = computed(() => optionItems.value.map(o => ({ ...o, key: optionKeyOf(o) })))

/**
 * radio 一次最多摆几个：**选项少就用 radio（原来的形态）**，多了才收进下拉。
 *
 * 为什么要有这条线：radio 是 inline 排布，选项一多就换行、把弹窗顶得很长；
 * 而"通过 / 驳回 / 其他原因"这种最常见的形态（≤3）用 radio 一眼看全、还少点一次。
 * 改这个数字前先想清楚：模板里一条线可以配多个选项文本，选项数很容易超过 3。
 */
const RADIO_MAX = 3

/** 这次用 radio 还是下拉（两种形态绑定同一个 selectedOptionKey，提交逻辑完全一致） */
const useOptionRadios = computed(() => selectItems.value.length <= RADIO_MAX)

/**
 * 选项在 radio 上的颜色：**沿用改造前的口径**（驳回 / 弃置 / 报废 红，通过 / 接收 绿，其余主题蓝）。
 * 按**结论码**取色，不按文案 —— 同一条线的多个选项文案不同、码相同，颜色本就该一致。
 */
function radioColorOf (result: string): string {
  if (result === 'reject' || result === 'discard' || result === 'scrap') {
    return 'error'
  }
  return result === 'pass' || result === 'receive' ? 'success' : 'primary'
}

/** 当前选中的**键** —— v-model 绑它，才分得清同码的多个选项 */
const selectedOptionKey = ref('')

/** 当前选中的选项；文案与结论码都从它取，不再"按码猜文案" */
const selectedOption = computed(() => selectItems.value.find(o => o.key === selectedOptionKey.value))

/** 选中的一级选项（二级候选项由它带出来）—— 声明在这里是因为下面的 selectedResult 要读它的链路 */
const pickedLeaf = ref<ApprovalOptionLeaf | null>(null)

/**
 * 当前选中的**结论码**（决定走向）—— 其余按码判断的表单条件都读它。
 *
 * 环节级选项树（nodeLevel）时"处理方式"这一层不存在：真正提交的结论是**所选一级的实际链路**
 * （见 collectResult），所以表单也按它展开（如链路是「回收」才要填数量/金额）。
 * 线级选项树 / 老口径保持原样：读本选项绑的结论码。
 */
const selectedResult = computed(() => {
  const opt = selectedOption.value
  if (opt?.nodeLevel) {
    return pickedLeaf.value?.link || ''
  }
  return opt?.result ?? ''
})

/**
 * 本环节配的是**环节级选项树**（整个环节共用一棵树，见 types/approval 的 ApprovalNodeOption）：
 * 此时不显示「选择处理方式」——"走哪条线"由树里每个一级的「实际链路」决定，没有第二层可选。
 */
const hasNodeLevelTree = computed(() => optionItems.value.length === 1 && !!optionItems.value[0]?.nodeLevel)

/** 某个结论码在**本环节**的显示文案（优先模板给它的名字；同码多选项时只能取第一个，仅作兜底） */
function labelOf(result: string): string {
  return optionItems.value.find(o => o.result === result)?.text
    ?? APPROVAL_RESULTS.find(r => r.value === result)?.label
    ?? result
}

/**
 * 模板给这个结论**自定义的名字**：选了具体选项、且它的文案与目录默认文案不同时返回它，
 * 否则返回空 —— 说明这文案是自动生成的，调用方该用自己的兜底文案（如「部分接收 5 件」）。
 */
function customLabelOf(result: string): string {
  const t = String(selectedOption.value?.text ?? '').trim()
  const def = APPROVAL_RESULTS.find(r => r.value === result)?.label ?? ''
  return t && t !== def ? t : ''
}

/** 选项异步到达后同步一个合法默认值，避免空选提交 */
watch(
  [() => props.allowedOptions, () => props.allowedResults],
  () => {
    const opts = selectItems.value
    if (!opts.some(o => o.key === selectedOptionKey.value)) {
      selectedOptionKey.value = opts[0]?.key ?? ''
    }
  },
  { immediate: true, deep: true },
)

/** 选中结论后需要补充的信息表单（数量 / 金额 / 原因等） */
const needReceiveQty = computed(
  () => selectedResult.value === 'receive' || selectedResult.value === 'part_receive',
)
const needRecycle = computed(() => selectedResult.value === 'recycle')
const needScrapConfirm = computed(() => selectedResult.value === 'scrap')
const needReason = computed(() => selectedResult.value === 'other_reason')
/** 「选择接收人员」：需要当场选人（见 PICK_MEMBERS_RESULT） */
const needPickMembers = computed(() => selectedResult.value === PICK_MEMBERS_RESULT)

const nodeTargets = computed(() => props.data.filter(item => item.type != 'manager'))

const transferIn = computed(() => props.data.find(m => m.delegated_from))
const transferredTo = computed(() => manageDatas.value[0]?.transferred_to)

const imgUrl = ref('')
function showPic(url: string) {
  overlay.value = true
  imgUrl.value = url
}
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
// { text: '产品侵权-外观专利侵权（产品合规中心承接）', target: 'inventory' ,belong:'产品侵权'},
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
// 按 belong 分类生成带分组标题的下拉数据（type: 'subheader' 由 Vuetify 渲染为分组标题，标题取自 item-title 字段 text）
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

/* ===== 模板配的「选项树」（类别 → 一级 → 二级，见 types/approval 的 ApprovalOptionGroup）===== */

/**
 * 当前这个"处理方式"选项所带的**选项树**（模板在连线面板里配的，见 collectStepOptionItems）。
 * 配了它就以它为准：办理时按「类别 → 一级 → 二级」分类展示，
 * 而且**提交时用的是所选一级选项的「实际链路」** —— 它可能与本选项绑的结论**不是同一条线**
 * （这正是"显示归类与实际走哪条线解耦"）。
 */
const pickedGroups = computed<ApprovalOptionGroup[]>(() => selectedOption.value?.groups ?? [])

/** 「驳回」的结论码：必须与保存期注入的驳回分支条件（`{ field:'result', op:'eq', value:'reject' }`）一致 */
const REJECT_RESULT = 'reject'

/**
 * 一级选项的菜单数据：类别当**分组标题**（沿用此前 grouping 那套写法，标题取 item-title 字段 text）。
 *
 * 末尾补的「驳回」：环节级选项树下可选项全部来自模板那棵树，而流程自带的
 * 「驳回 → 回退上一环」出口**不在树里**（它是保存期 `ensureRejectLoopBack` 注入的分支）——
 * 老口径下它是一条普通分支、本来就出现在下拉里，换成环节级树后就被丢掉了（办理人无路可驳回）。
 * 所以按 `canReject` 在**最后补一个「驳回」**；模板自己配了指向 reject 的一级时不重复补。
 */
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

/** 二级候选项：**只有选中了带二级的一级选项才有值** —— 这就是"选中一级才展示二级"
 *  （`pickedLeaf` 的声明在上面，因为 selectedResult 要读它的「实际链路」） */
const leafChildren = computed(() => pickedLeaf.value?.children ?? [])

/** 选中的二级文案（一级没有二级时为空，不提交它） */
const pickedChild = ref('')

/** 处理方式一变（或它带的树变了）就重置一级 / 二级，避免留下上一棵树里的选择 */
watch(
  [selectedOption, pickedGroups],
  () => {
    const first = pickedGroups.value[0]?.items[0] ?? null
    pickedLeaf.value = first
    pickedChild.value = first?.children?.[0] ?? ''
  },
  { immediate: true, deep: true },
)

/**
 * 一级选项一变，二级必须**跟着重置**：
 * 换到"没有二级"的一级时要把它**清空**，否则会把上一级的二级（如「研发」）带进提交结果
 * （实测踩过：选「政策与法规变化」却提交成「政策与法规变化·研发」）。
 */
watch(pickedLeaf, leaf => {
  pickedChild.value = leaf?.children?.[0] ?? ''
})

const emit = defineEmits<{
  (e: 'submit', payload: NodeSubmitPayload): void
}>()

function collectResult(): { result: string, result_label: string, extra: Record<string, unknown> } {
  const extra: Record<string, unknown> = {}

  /*
   * 模板配了**选项树**时，结果码由所选一级选项的「实际链路」决定 ——
   * 它可能与本"处理方式"绑的结论**不是同一条线**（"显示归类与实际走哪条线解耦"），
   * 所以这条路径**整段返回**，不再走下面那套写死的表单逻辑。
   *
   * 提交内容：链路码 + 文案（一级 / 一级·二级），外加显示的类别路径，便于时间线回溯。
   */
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
    case 'receive': { // 全部接收
      extra.qty = qty.value
      return { result, result_label: '全部接收', extra }
    }
    case 'part_receive': { // 部分接收
      extra.qty = qty.value
      return { result, result_label: `部分接收 ${qty.value || 0} 件`, extra }
    }
    case 'recycle': { // 回收：数量 + 金额
      extra.qty = recycleQty.value
      extra.amount = recycleAmount.value
      return { result, result_label: '回收', extra }
    }
    case 'scrap': { // 报废清仓：确认标记
      extra.confirmed = setClean.value
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
    case PICK_MEMBERS_RESULT: { // 选择接收团队：在这里收集接收方；提交后流程即终结（见 CLOSE_FLOW_RESULTS）
      extra.members = pickedMembers.value
      const names = pickedMembers.value.name
      // 结论文案带上名字：时间线上一眼能看出这一环指定了谁
      return { result, result_label: names ? `选择接收团队：${names}` : '选择接收团队', extra }
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
      /*
       * pass 及其余未单独处理的结果：文案**优先取"当前选中的那个选项"的文字** ——
       * 同一条线可以配多个选项（码相同、文案不同），此时按码反查只会拿到第一个，
       * 选谁都被显示成第一个（见 customLabelOf 与模板里 item-value 的说明）。
       */
      const finalResult = result || 'pass'
      return { result: finalResult, result_label: customLabelOf(finalResult) || labelOf(finalResult), extra }
    }
  }
}

/**
 * 点击「确定」：收集表单 → 交给父组件上传附件并写库。
 * 弹窗是否关闭由父组件落库结果决定（payload.done）。
 */
function handleConfirm() {
  if (submitting.value) return
  submitting.value = true
  const { result, result_label, extra } = collectResult()
  emit('submit', {
    index: props.index,
    result,
    result_label,
    extra,
    opinion: opinion.value.trim(),
    files: attachment.value ? [attachment.value] : [],
    done: (ok: boolean) => {
      submitting.value = false
      if (ok) dialog.value = false
    },
  })
}
</script>
<style scoped lang="scss">
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

// 弹窗内的分节标题（处理方式 / 办理 / 备注）：统一小号弱化文字，
// 纵向间距交给外层 .ga-4 控制，避免各处手写 mb-2 / ml-3 造成节奏不一致
.field-label {
  font-size: 12px;
  line-height: 1.5;
  // 这里【不要】写 margin-bottom：scoped 编译成 .field-label[data-v-xxx]，
  // 特异性 (0,2,0) 高于 UnoCSS 的 .mb-*(0,1,0)，会把工具类间距全部吃掉。
  // 间距一律由模板上的 mb-* 控制，方便各处按需调整。
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
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

// 回收数量输入框：缩小字号、高度
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

  // 后缀（$ / PST）默认 opacity: 0，仅激活时显示；这里强制始终可见
  // :deep(.v-text-field__suffix) {
  //     opacity: 1;
  // }
}

// radio 内嵌输入框：与左侧单选按钮垂直居中对齐
.radio-with-input {
  :deep(.v-label) {
    display: flex;
    // align-items: center;
    // align-self: stretch;
    // height: auto;
  }

  // 输入控件与按钮行高中线对齐，去除多余的上下边距
  :deep(.v-input) {
    margin-top: 0;
    margin-bottom: 0;
  }

  :deep(.v-field) {
    --v-input-control-height: 26px;
    --v-field-padding-top: 0;
    --v-field-padding-bottom: 0;
  }

  :deep(.v-field__input) {
    min-height: 26px;
    padding-top: 0;
    padding-bottom: 0;
    line-height: 26px;
  }
}
</style>
