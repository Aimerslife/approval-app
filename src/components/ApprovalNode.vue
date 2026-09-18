<template>
    <v-timeline-item class="mb-12" :dot-color="dotColor" :size="size">
        <template v-slot:icon>
            <span :style="{ fontSize: iconFontSize, color: iconColor }">{{
                getPinyinInitials(manageDatas[0]?.name) }}</span>
        </template>
        <div class=" d-flex align-center justify-space-between">
            <div class="d-flex align-center gap-2">
                <span v-if="deptName" class="text-[12px]">[{{ deptName }}]</span>
                <v-avatar size="30px">
                    <v-img alt="Avatar" :src="manageDatas[0]?.avatar"></v-img>
                    <!-- <v-icon :color="message.color" :icon="message.icon"></v-icon> -->
                </v-avatar>
                <span class="text-body-small" :class="{ 'text-medium-emphasis text-decoration-line-through': transferredTo }">
                    {{ manageDatas[0]?.name }}</span>
                <v-chip v-if="transferredTo" size="x-small" color="secondary" variant="tonal" label>
                    已转办 → {{ transferredTo }}
                </v-chip>
                <v-chip v-if="transferIn" size="x-small" color="primary" variant="flat" label>
                    转办：{{ transferIn.delegated_from }} → {{ transferIn.name }}
                </v-chip>
                <template v-if="manager?.result">
                    <v-chip class="ms-0" color="primary" size="x-small" label>{{ manager.result_label }}</v-chip>
                </template>
                <template v-else-if="status">
                    <v-chip class="ms-0" color="success" size="x-small" label>通过</v-chip>
                </template>
                <template v-else-if="!canHandle">
                    <!-- 还没轮到这个环节：不给办理入口（见 props.canHandle 的说明） -->
                    <span class="text-[11px] text-medium-emphasis">未到该环节</span>
                </template>
                <template v-else>
                    <v-dialog v-model="dialog" max-width="500">
                        <template v-slot:activator="{ props: activatorProps }">
                            <v-btn variant="tonal" color="success" size="x-small" v-bind="activatorProps"
                                @click="dialogs = true">办理</v-btn>
                        </template>
                        <v-card>
                            <v-card-title class="d-flex align-center ga-2 text-[15px] py-3">
                                <v-icon size="18" color="primary">mdi-check-all</v-icon>
                                <span>审批</span>
                            </v-card-title>
                            <v-divider />
                            <v-card-text class="d-flex flex-column ga-4 pb-2">
                                <!-- 办理：按环节类型（tab）渲染对应表单 -->
                                <div v-if="radios=='deal'">
                                    <div class="field-label mb-2">选择处理方式</div>
                                    <!-- 结论选项：来自模板中该环节后面分支组绑定的 result 条件 -->
                                    <v-radio-group v-model="selectedResult" inline hide-details>
                                        <v-radio v-for="opt in resultOptions" :key="opt.value" :value="opt.value"
                                            :color="opt.color">
                                            <template v-slot:label>
                                                <span class="text-[13px]">{{ opt.label }}</span>
                                            </template>
                                        </v-radio>
                                    </v-radio-group>

                                    <!-- 选中结论需要补充信息时才展开对应的表单 -->
                                    <div v-if="needReceiveQty" class="d-flex align-center ga-2 mt-2">
                                        <v-text-field label="接收数量" density="compact" width="160px" hide-details
                                            single-line class="qty-input" variant="underlined" v-model="qty"
                                            suffix="件"></v-text-field>
                                    </div>
                                    <div v-else-if="needRecycle" class="d-flex align-center ga-4 mt-2">
                                        <v-text-field label="回收数量" density="compact" width="160px" hide-details
                                            single-line class="qty-input" variant="underlined" v-model="recycleQty"
                                            suffix="件"></v-text-field>
                                        <v-text-field label="回收金额" density="compact" width="160px" hide-details
                                            single-line class="qty-input" variant="underlined"
                                            v-model="recycleAmount" suffix="￥"></v-text-field>
                                    </div>
                                    <div v-else-if="needScrapConfirm" class="d-flex align-center ga-2 mt-2">
                                        <v-btn size="small" variant="tonal" color="error"
                                            append-icon="mdi-transfer-right" @click="setClean = true">确认报废清仓</v-btn>
                                    </div>
                                    <div v-else-if="needReason" class="mt-2">
                                        <v-select density="compact" max-width="200" :items="groupedReasons"
                                            item-title="text" v-model="reason" variant="outlined" class="filter-select"
                                            single-line hide-details return-object
                                            @update:model-value="handleResonChange"
                                            :menu-props="{ contentClass: 'filter-menu' }">
                                            <template #label>
                                                <span class="text-[11px]">原因</span>
                                            </template>
                                        </v-select>
                                        <v-select v-if="reason.belong === '开发类'" density="compact" max-width="180"
                                            :items="secondApprovalModal" item-title="text" variant="outlined"
                                            class="filter-select" single-line hide-details v-model="secondReason"
                                            return-object @update:model-value="handleSecondResonChange"
                                            :menu-props="{ contentClass: 'filter-menu' }">
                                            <template #label>
                                                <span class="text-[11px]">二级原因</span>
                                            </template>
                                        </v-select>
                                        <template v-if="reason.belong === '外部环境'">
                                            <div class="mt-2">
                                                <v-textarea label="" rows="2" hide-details variant="outlined"
                                                    density="compact" max-width="300" v-model="reasonRemark"
                                                    class="remark-input" placeholder="补充说明" />
                                            </div>
                                        </template>
                                    </div>
                                    <!-- 「选择接收人员」：当场指定人 → 提交时填充到**下一环节**（见 useNodeSubmit） -->
                                    <div v-if="needPickMembers" class="mt-2">
                                        <div class="d-flex align-center ga-2 flex-wrap">
                                            <v-btn size="small" variant="tonal" color="primary"
                                                :prepend-icon="picking ? 'mdi-chevron-up' : 'mdi-account-plus-outline'"
                                                @click="picking = !picking">
                                                {{ pickedMembers.length ? `已选 ${pickedMembers.length} 人` : '选择接收人员' }}
                                            </v-btn>
                                            <span class="text-[11px] text-medium-emphasis">
                                                选中的人会成为下一环节的审批人
                                            </span>
                                        </div>
                                        <div v-if="pickedMembers.length" class="d-flex flex-wrap ga-1 mt-2">
                                            <v-chip v-for="(m, i) in pickedMembers" :key="i" size="small" closable
                                                @click:close="unpickMember(i)">
                                                {{ m.name }}
                                            </v-chip>
                                        </div>
                                        <v-expand-transition>
                                            <div v-show="picking">
                                                <v-divider class="my-2"></v-divider>
                                                <DepartmentNode @select="pickMember" />
                                            </div>
                                        </v-expand-transition>
                                    </div>
                                </div>
                                <!-- 备注 / 审批意见 -->
                                <div>
                                    <div class="field-label mb-2">备注 / 审批意见</div>
                                    <v-textarea :counter="300" rows="3" variant="outlined" persistent-counter
                                        density="compact" v-model="opinion" class="remark-input"></v-textarea>
                                </div>
                            </v-card-text>
                            <!-- 附件：只保留回形针图标，点击文字同样能唤起选择框 -->
                            <div class="d-flex align-center ga-1 px-4 pb-3">
                                <v-file-input ref="fileInputRef" v-model="attachment" hide-input density="compact"
                                    class="attachment-input">
                                    <template v-slot:prepend>
                                        <v-icon size="15" color="#1055C9">mdi-paperclip</v-icon>
                                    </template>
                                </v-file-input>
                                <span v-if="attachment"
                                    class="text-[12px] text-medium-emphasis text-decoration-underline text-truncate"
                                    :title="attachment.name">
                                    {{ attachment.name }}
                                </span>
                                <span v-else class="text-[12px] text-medium-emphasis cursor-pointer"
                                    @click="fileInputRef?.click()">上传附件</span>
                                <v-btn v-if="attachment" variant="plain" density="compact" icon="mdi-close"
                                    @click="attachment = null">
                                    <v-icon size="15" icon="mdi-close"></v-icon>
                                </v-btn>
                            </div>
                            <v-divider></v-divider>
                            <v-card-actions class="px-4 py-3">
                                <v-spacer></v-spacer>
                                <v-btn text="取消" variant="plain" @click="dialog = false" size="small"></v-btn>
                                <v-btn color="primary" text="提交" variant="tonal" @click="handleConfirm"
                                    :loading="submitting" size="small"></v-btn>
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
            <div v-if="manager.files?.length" class="mt-1 d-flex align-center flex-wrap text-[11px]">
                <div v-for="f in manager.files" :key="f.id" :href="f.url" rel="noopener"
                    class="d-inline-flex align-center  cursor-pointer text-[#89898A] underline" @click="showPic(f.url)">
                    <v-icon size="11">mdi-paperclip</v-icon>
                    <span class="mt-1">{{ f.name }}</span>
                </div>
            </div>
        </template>
        <template v-if="nodeTargets?.length">
            <div class="mt-2 d-flex align-center gap-2">
                <v-chip size="x-small" color="secondary" variant="flat" class="mr-1" label>
                    <span class="text-[9px]">抄送</span>
                </v-chip>
                <div v-for="(t, i) in nodeTargets" :key="i" class="d-flex align-center">
                    <v-avatar size="22" class="mr-1">
                        <v-img v-if="t.avatar" :src="t.avatar" cover />
                        <v-icon v-else size="13">mdi-account</v-icon>
                    </v-avatar>
                    <span class="text-[10px] text-medium-emphasis">{{ t.name }}</span>
                </div>
            </div>
        </template>
    </v-timeline-item>
    <v-overlay v-model="overlay" @click:outside="overlay = false">
        <div class="d-flex align-center justify-center" style="width: 100vw; height: 100vh">
            <v-img :src="imgUrl" :width="800" max-height="90vh" :style="{ maxWidth: '90vw' }" rounded="10" contain>
            </v-img>
        </div>
    </v-overlay>
</template>

<script lang="ts" setup>
import type { UserBrief } from '@/api/api'
import DepartmentNode from './DepartmentNode.vue'
import dayjs from 'dayjs'
import { formatDate, getPinyinInitials, formatTimeDiff } from '@/utils/utils'
import { buildColorScale, pickColorStep } from '@/utils/color'
import { APPROVAL_RESULTS, PICK_MEMBERS_RESULT } from '@/types/approval'
import type { ApprovalChainItem, NodeSubmitPayload } from '@/types/approval'

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
    canHandle: true,
})
// 选择项
const setReceive = ref('')
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
    if (!props.length) return 40
    return 35 + Math.round(20 / props.length * props.index)
})

const iconFontSize = computed(() => `${Math.max(12, Math.round(size.value / 3))}px`)

const colorScale = computed(() => buildColorScale(props.length))
const currentStep = computed(() => pickColorStep(colorScale.value, props.index))
const dotColor = computed(() => currentStep.value.bg)
const iconColor = computed(() => currentStep.value.fg)
const setReason = ref('')
const manageDatas = computed(() => props.data.filter(item => item.type == "manager"))
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
        manageDatas.value[0]?.department ??
        props.data.find(item => item?.department)?.department ??
        props.department ??
        ''
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
/** extra 中仅供内部联动/路由的标识字段（对用户无意义），不展示 */
const EXTRA_HIDDEN_KEYS = /_target$/

/** 办理信息中的选项明细（extra），过滤空值与内部标识字段后生成 { label, value } 列表 */
const extraItems = computed(() => {
    const extra = manager.value?.extra
    if (!extra) return []
    return Object.entries(extra)
        .filter(([key]) => !EXTRA_HIDDEN_KEYS.test(key))
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([key, v]) => ({
            key,
            label: EXTRA_LABELS[key] ?? key,
            // 「接收人员」这类值是对象数组：拼名字展示，别渲染成 [object Object]
            value: Array.isArray(v)
                ? v
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

const reason = ref({ text: '市场需求分析不足/运营策略不当', target: 'operation-analysis', belong: '运营' })
const secondReason = ref({ text: '运营/销售', target: 'sale' })
/** 「选择接收人员」选中的人：提交时由 useNodeSubmit 填充到**下一环节** */
const pickedMembers = ref<ApprovalChainItem[]>([])
/** 选人面板是否展开 */
const picking = ref(false)

/** 选一位接收人（可多点几位，去重后累积） */
function pickMember(u: UserBrief) {
    const key = u.email || u.name
    if (pickedMembers.value.some(m => (m.email || m.name) === key)) return
    pickedMembers.value = [...pickedMembers.value, {
        name: u.name,
        ...(u.email ? { email: u.email } : {}),
        ...(u.avatar ? { avatar: u.avatar } : {}),
        type: 'manager',
    }]
}

function unpickMember(i: number) {
    pickedMembers.value = pickedMembers.value.filter((_, idx) => idx !== i)
}
/**
 * 本环节可选的审批结论：取自模板中该环节后面分支组绑定的 result 条件（allowedResults），
 * 取代原先「按环节下标 tab 决定表单类型」的硬编码做法 —— 表单跟着模板配置走。
 */
interface ResultOption {
    value: string
    label: string
    color: string
}
const resultOptions = computed<ResultOption[]>(() => {
    // 未配置时回退为默认的通过 / 驳回
    const allowed = props.allowedResults?.length ? props.allowedResults : ['pass', 'reject']
    return allowed.map(v => ({
        value: v,
        label: APPROVAL_RESULTS.find(r => r.value === v)?.label ?? v,
        // 驳回 / 弃置 / 报废用红色，通过 / 接收用绿色，其余用主题蓝
        color:
            v === 'reject' || v === 'discard' || v === 'scrap'
                ? 'error'
                : v === 'pass' || v === 'receive'
                    ? 'success'
                    : 'primary',
    }))
})

/** 当前选中的结论。allowedResults 异步到达后同步一个合法默认值，避免空选提交 */
const selectedResult = ref('')
watch(
    () => props.allowedResults,
    list => {
        const opts = resultOptions.value
        if (!opts.some(o => o.value === selectedResult.value)) {
            selectedResult.value = opts[0]?.value ?? ''
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

const nodeTargets = computed(() => props.data.filter(item => item.type != "manager"))

/**
 * 转办（运行期通过「转办」按钮追加的成员，见 mergeExtraMembers）：
 *  · transferIn —— 接替办理的人（type 仍是 manager，所以不会出现在 nodeTargets 里，
 *    光靠原有渲染是**看不见**的，必须单独标出来）；
 *  · transferredTo —— 被接替的那位，由 mergeExtraMembers 打上的展示标记。
 */
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
{ text: '平台限制、政策调整等', target: 'outside-platform', belong: '外部环境' },
{ text: '历史遗留库存', target: 'outside-history', belong: '外部环境' },
{ text: '其他客观因素', target: 'outside-other', belong: '外部环境' }
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
    { text: '工厂', target: 'factory' }
]
// 按 belong 分类生成带分组标题的下拉数据（type: 'subheader' 由 Vuetify 渲染为分组标题，标题取自 item-title 字段 text）
const groupedReasons = computed(() => {
    const groups = new Map<string, ReasonItem[]>()
    for (const item of approvalModal) {
        const key = item.belong || '其他'
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(item)
    }
    const list: (ReasonItem | { type: 'subheader'; text: string })[] = []
    for (const [belong, items] of groups) {
        list.push({ type: 'subheader', text: belong })
        list.push(...items)
    }
    return list
})
function handleResonChange(val: { text: string, target: string, belong: string } | null) {
    reason.value = val ?? { text: '市场需求分析不足/运营策略不当', target: 'operation-analysis', belong: '运营' }
}
function handleChange(val: string | null) {
    selectedValue.value = val ?? ''
}
function handleSecondResonChange(val: { text: string, target: string } | null) {
    secondReason.value = val ?? { text: '运营/销售', target: 'sale' }
}

const emit = defineEmits<{
    (e: 'submit', payload: NodeSubmitPayload): void
}>()

function collectResult(): { result: string; result_label: string; extra: Record<string, unknown> } {
    const extra: Record<string, unknown> = {}
    const result = selectedResult.value

    switch (result) {
        case 'receive': // 全部接收
            extra.qty = qty.value
            return { result, result_label: '全部接收', extra }
        case 'part_receive': // 部分接收
            extra.qty = qty.value
            return { result, result_label: `部分接收 ${qty.value || 0} 件`, extra }
        case 'recycle': // 回收：数量 + 金额
            extra.qty = recycleQty.value
            extra.amount = recycleAmount.value
            return { result, result_label: '回收', extra }
        case 'scrap': // 报废清仓：确认标记
            extra.confirmed = setClean.value
            return { result, result_label: '报废清仓', extra }
        case 'rework':
            return { result, result_label: '建议返工', extra }
        case 'discard':
            return { result, result_label: '建议弃置', extra }
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
        case PICK_MEMBERS_RESULT: { // 选择接收人员：人选在这里收集，由 useNodeSubmit 填充到下一环节
            extra.members = pickedMembers.value.map(m => ({ name: m.name, email: m.email, avatar: m.avatar }))
            const names = pickedMembers.value.map(m => m.name).join('、')
            // 结论文案带上名字：时间线上一眼能看出这一环指定了谁
            return { result, result_label: names ? `选择接收人员：${names}` : '选择接收人员', extra }
        }
        case 'pending':
            return { result, result_label: '待定', extra }
        case 'lack_demand':
            return { result, result_label: '市场需求不足', extra }
        case 'reject':
            return { result, result_label: '驳回', extra }
        default: {
            // pass 及其余未单独处理的结果：文案统一取自 APPROVAL_RESULTS
            const finalResult = result || 'pass'
            const label = APPROVAL_RESULTS.find(r => r.value === finalResult)?.label ?? '通过'
            return { result: finalResult, result_label: label, extra }
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
