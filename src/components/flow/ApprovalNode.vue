<template>
    <div class="node-card" :class="{ selected: props.selected, 'is-notify': isNotify, 'is-independent': isIndependent }">
        <Handle :position="Position.Top" type="target" />

        <div class="node-head">
            <span class="head-icon">
                <v-icon :color="isIndependent ? '#EA580C' : (isNotify ? '#0891b2' : '#2563eb')" size="13">
                    {{ isIndependent ? 'mdi-account-multiple-check-outline' : (isNotify ? 'mdi-bell-ring-outline' : 'mdi-account-check-outline') }}
                </v-icon>
            </span>

            <input
                v-model="props.data.title"
                class="node-title"
                :placeholder="isIndependent ? '如：供应商确认' : (isNotify ? '如：通知财务' : '环节名称')"
            >

            <button class="icon-btn del-btn" title="删除节点" @click.stop="emit('remove')">
                <v-icon size="13">mdi-trash-can-outline</v-icon>
            </button>
        </div>

        <!-- 审批结果分支列表：该审批有第二条出线后出现，点击某条分支联动配置面板 -->
        <div v-if="!isNotify && !isIndependent && branches && branches.length > 1" class="branch-list">
            <div v-for="(b, i) in branches" :key="b.id" class="branch-row">
                <button class="branch-item nodrag" :class="{ active: b.id === activeEdgeId }" title="点击配置此结果分支"
                    type="button" @click.stop="emit('branch-click', b.id)">
                    <span class="branch-dot" />
                    <span class="branch-name">{{ b.label || '未命名分支' }}</span>
                    <span v-if="b.toEnd" class="branch-end-tag" title="此分支直接连到结束节点：命中该分支时流程立即结束">→ 结束</span>
                    <v-icon v-if="b.id === activeEdgeId" class="branch-edit-ico" color="#2563eb"
                        size="11">mdi-pencil</v-icon>
                </button>

                <!--
                  上下移：顺序**就是数据**（编译按出线数组的先后铺 branches，
                  办理端的选项也按这个顺序摆），所以这里不做"只改显示"的假排序。
                  只在编辑器里给（FlowPreview 不传 movable），预览态不出现这些按钮。
                -->
                <div v-if="movable" class="branch-move nodrag">
                    <button class="move-btn" :disabled="i === 0" title="上移：办理端选项按这个顺序摆（主线永远是兜底，挪动不改变走哪条线）"
                        type="button" @click.stop="emit('branch-move', b.id, -1)">
                        <v-icon size="12">mdi-chevron-up</v-icon>
                    </button>

                    <button class="move-btn" :disabled="i === branches.length - 1" title="下移：办理端选项按这个顺序摆"
                        type="button" @click.stop="emit('branch-move', b.id, 1)">
                        <v-icon size="12">mdi-chevron-down</v-icon>
                    </button>
                </div>
            </div>
        </div>

        <div class="node-body">
            <!--
              用 template 包一层：轮询成员要多一行配置，但 .member-row 仍是 node-body 的
              直接子元素（间距、布局与改动前一致）。
            -->
            <!--
              独立审批的「子流程模式」：卡片里画过内部流程后，成员改在内部环节上配 ——
              卡片上只留一句进度提示 + 编辑入口，避免"两处配成员不知道哪处生效"。
            -->
            <template v-if="isIndependent && isSubFlow">
                <div class="member-row">
                    <v-icon color="#EA580C" size="12">mdi-file-tree-outline</v-icon>
                    <span class="member-name">内部子流程 · {{ subFlowCount }} 环</span>
                    <span class="role-tag role-approve">依次办理</span>
                </div>
                <div class="empty-hint">成员在内部流程里配置（点下方「编辑内部流程」）；卡片上的成员列表已停用</div>
            </template>

            <template v-for="(m, i) in (isIndependent && isSubFlow ? [] : props.data.members)" :key="i">
            <div class="member-row">
                <v-avatar class="member-avatar" size="20">
                    <v-img v-if="m.avatar" cover :src="m.avatar" />

                    <v-icon v-else color="#94a3b8" size="11">
                        {{ m.role ? 'mdi-account-star-outline' : 'mdi-account' }}
                    </v-icon>
                </v-avatar>

                <template v-if="m.role">
                    <span class="member-name">团队负责人</span>
                    <span class="role-tag role-approve">动态</span>

                    <input v-model="roleOf(m).deptFrom" class="member-dept nodrag" placeholder="字段 如 团队"
                        title="取数据行的哪个字段当团队/部门名（如「团队」）；留空则建单时会报错">
                </template>

                <template v-else>
                    <span class="member-name">{{ m.name }}</span>

                    <span class="role-tag" :class="m.type === 'manager' ? 'role-approve' : 'role-cc'">
                        {{ isIndependent ? '办理' : (isNotify ? '提醒' : (m.type === 'manager' ? '审批' : '抄送')) }}
                    </span>

                    <span v-if="m.department" class="member-dept" :title="m.department_path">
                        {{ m.department }}
                    </span>
                </template>

                <button class="icon-btn del-btn" title="移除成员" @click.stop="removeMember(i)">
                    <v-icon size="11">mdi-close</v-icon>
                </button>
            </div>
            </template>

            <div v-if="props.data.members.length === 0 && !(isIndependent && isSubFlow)" class="empty-hint" :title="isIndependent
                ? '独立审批至少要有一名办理人，否则保存时会拦住'
                : (isNotify
                    ? '飞书提醒至少要有一个提醒对象，否则这一环不会发出任何通知（保存时会拦住）'
                    : '这一环可以留空：由上一环节的办理人用「选择接收团队」当场指定接收方（候选来自团队表、限定在本单所属部门内）；建单时会校验走到这里时有没有人可办')">
                {{ isIndependent ? '还没有独立审批人（保存时会拦住）' : (isNotify ? '还没有提醒对象（保存时会拦住）' : '待指定（由上一环节「选择接收团队」指定接收方）') }}
            </div>

            <div class="d-flex ga-1 mb-2">
                <button v-if="!(isIndependent && isSubFlow)" class="add-btn" @click.stop="emit('addMember')">
                    <v-icon class="mr-1" size="11">mdi-plus</v-icon>{{ isIndependent ? '添加办理人' : (isNotify ? '添加提醒对象' : '添加成员') }}
                </button>

                <button v-if="!(isIndependent && isSubFlow)" class="add-btn" :title="isNotify
                    ? '不指定具体的人：建单时按数据行字段（如「组别」）取对应部门的负责人来提醒'
                    : '不指定具体的人：建单时按数据行字段（如「组别」）取对应部门的负责人'" @click.stop="emit('addRole')">
                    <v-icon class="mr-1" size="11">mdi-account-star-outline</v-icon>动态负责人
                </button>

                <!-- 独立审批专属：编辑内部子流程（与轮询卡片同一套编辑器，见 LoopCardDialog） -->
                <button v-if="isIndependent" class="add-btn" title="放几个审批环节进来，按顺序依次办理（上一环全员提交后解锁下一环）"
                    @click.stop="emit('edit')">
                    <v-icon class="mr-1" size="11">mdi-file-tree-outline</v-icon>编辑内部流程
                </button>
            </div>

            <!-- 独立审批专属：结论选项（默认 通过/驳回）。每人各选一个结论提交，全员办完才算这个独立审批完成 -->
            <template v-if="isIndependent">
                <div v-if="independentOptions.length > 0" class="ind-options">
                    <span v-for="(o, i) in independentOptions" :key="o" class="ind-option">
                        {{ optionLabelOf(o) }}
                        <button class="icon-btn" title="移除该结论选项" @click.stop="removeOption(i)">
                            <v-icon size="9">mdi-close</v-icon>
                        </button>
                    </span>
                </div>

                <!-- 默认提示 + 自定义输入 + 加结论按钮同一行（等高对齐，输入框占满剩余宽度） -->
                <div class="ind-option-row">
                    <span class="ind-options__default" title="不添加自定义结论时，办理人可提交：通过 / 驳回">默认：通过 / 驳回</span>
                    <input v-model="newOption" class="ind-option-input nodrag" placeholder="自定义结论，如：需复核"
                        @keydown.enter.prevent="addOption">
                    <button class="add-btn" title="加一个办理时的结论选项（内置默认：通过 / 驳回）" @click.stop="addOption">
                        <v-icon class="mr-1" size="11">mdi-plus</v-icon>加结论
                    </button>
                </div>
            </template>

            <!-- 飞书提醒专属：可选补充文案（自动生成的内容里已带环节名与单号）。
                 title 里写 {{部门}} 是安全的：属性值不做插值，会原样显示成提示文字。 -->
            <input
                v-if="isNotify"
                v-model="props.data.content"
                class="notify-content nodrag"
                placeholder="补充提醒文案（可选）"
                title="会拼在自动生成的提醒内容后面。可写 {{部门}}、{{SKU}} 这类占位符，发送时换成该行数据里的真实值"
            >
            <div v-if="isNotify" class="notify-tip">
                文案支持 <code>{{ fieldHint }}</code>，发送时换成该行数据的真实值
            </div>
        </div>

        <Handle :position="Position.Bottom" type="source" />
    </div>
</template>

<script lang="ts" setup>
import type { ApprovalChainItem, ApprovalNodeData, ApprovalRole } from '@/types/approval'
import { APPROVAL_RESULTS } from '@/types/approval'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps<{
    data: ApprovalNodeData
    selected?: boolean
    /** 该节点所有出线（结果分支列表）；>1 条时卡片展示，点击联动选中配置面板 */
    branches?: { id: string, label: string, toEnd?: boolean }[]
    /** 当前被选中（配置面板正在编辑）的连线 id */
    activeEdgeId?: string | null
    /**
     * 卡片形态：'approval' 审批环节（默认）/ 'notify' 飞书提醒 / 'independent' 独立审批。
     *
     * 三种节点**交互几乎完全相同**（环节名 + 成员 + 动态负责人 + 增删），
     * 差别只在配色、图标、文案，以及提醒/独立审批没有"审批结果分支"，
     * 独立审批多一个「结论选项」编辑区。
     * 所以复用同一个组件、用一个 kind 区分，而不是复制一份卡片出来 ——
     * 复制出来的那份以后每改一处交互都得同步，迟早漂。
     */
    kind?: 'approval' | 'notify' | 'independent'
    /**
     * 分支列表是否给「上移 / 下移」。
     *
     * 只读预览（FlowPreview）不传 —— 那里没有可写的数据，按钮点了也没意义；
     * 编辑器（createStream / LoopCardCanvas）传 true，并把 `branch-move` 接到
     * "重排出线数组"上（顺序即数据，见事件说明）。
     */
    movable?: boolean
}>()

/** 是不是「飞书提醒」节点 */
const isNotify = computed(() => props.kind === 'notify')

/** 是不是「独立审批」节点（主流程旁路发起、不阻塞主线，见 types/approval 的 ApprovalFlowIndependentNode） */
const isIndependent = computed(() => props.kind === 'independent')

/*
 * ===== 独立审批的「子流程模式」判定 =====
 * 卡片 data.graph 里放了实际节点（除开始/结束）= 进入子流程模式：
 * 成员改在内部环节上配，卡片上的成员列表停用（见模板里的同款说明）。
 */
const isSubFlow = computed(() =>
    Array.isArray(props.data.graph?.nodes)
    && props.data.graph!.nodes.some(n => n?.type !== 'start' && n?.type !== 'end'))
/** 内部审批环节数（提示用） */
const subFlowCount = computed(() =>
    (props.data.graph?.nodes ?? []).filter(n => n?.type === 'approval').length)

/*
 * ===== 独立审批的「结论选项」编辑 =====
 * 存在 data.options（结论码数组）；没配 = 运行期按内置默认「通过 / 驳回」渲染
 * （见 types/approval 的 INDEPENDENT_DEFAULT_OPTIONS）。卡片里显示默认提示，
 * 一旦加过自定义选项就以它为准（想回到默认就把选项删光）。
 */
const independentOptions = computed<string[]>(() =>
    Array.isArray(props.data.options) ? props.data.options.filter(v => String(v ?? '').trim()) : [])
const newOption = ref('')
/** 结论码 → 人话标签（内置码如 pass → 通过；自定义码原样显示） */
function optionLabelOf (code: string) {
    return APPROVAL_RESULTS.find(r => r.value === code)?.label ?? code
}
function addOption () {
    const v = newOption.value.trim()
    if (!v) return
    if (!props.data.options) props.data.options = []
    if (props.data.options.some(o => o === v)) {
        newOption.value = ''
        return
    }
    props.data.options.push(v)
    newOption.value = ''
}
function removeOption (i: number) {
    props.data.options?.splice(i, 1)
}

/**
 * 文案插值语法的展示串。
 *
 * ⚠️ 不能在模板里直接写 `{{字段名}}`：那是**插值**，Vue 会把它当表达式求值（报错或渲染成空）。
 * 属性里写是字面量，但正文里不行，所以用一个常量再插出去。
 */
const fieldHint = '{{字段名}}'

const emit = defineEmits<{
    /** 请求把当前选中的员工加入此节点 */
    'addMember': []
    /** 请求加一个**动态审批人**（部门负责人，建单时解析，见 utils/approvalRoles） */
    'addRole': []
    /** 独立审批：请求打开「编辑内部流程」对话框（父级按节点 id 找到卡片数据，见 createStream） */
    'edit': []
    /** 删除此节点 */
    'remove': []
    /** 点击某条结果分支名，请求父级选中该连线 */
    'branch-click': [edgeId: string]
    /**
     * 请求把某条结果分支上移 / 下移一位（delta = -1 / +1）。
     *
     * 父级要**真的改数据顺序**：编译按出线数组的先后生成 `branches`，
     * 办理端的选项（collectStepOptionItems）也按这个顺序摆 —— 所以挪数组就是挪一切，
     * 不需要另存一份"显示顺序"。
     */
    'branch-move': [edgeId: string, delta: number]
}>()

const EMPTY_ROLE: ApprovalRole = { kind: 'dept_leader', deptFrom: '' }
function roleOf(m: ApprovalChainItem): ApprovalRole {
    return m.role ?? EMPTY_ROLE
}

/*
 * 这里原来有一整套「按组轮询」的编辑辅助（rotationOf / setRotation* / 行条件悬浮窗 / ROW_FILTER_HINT）。
 * 2026-09 起组间流转搬到了画布上的「组间轮询」卡片（见 components/flow/LoopCardDialog.vue 的轮询表单），
 * 所以整块删除；旧数据里的 `member.rotation` 仍由 utils/approvalRotation 照原样展开。
 */

function removeMember(i: number) {
    props.data.members.splice(i, 1)
}
</script>

<style scoped>
/* ===== 卡片基础 ===== */
.node-card {
    /*
     * 300px（原 236px）：成员行要一行放下「头像 + 部门负责人 + 动态 + 字段输入框 + 删除」，
     * 轮询行还要放「轮询 + 两个输入框」。236px 时输入框只剩几十像素，占位符都被裁掉。
     * 配套把成员区的字号下调一档（见下面 .member-* / .role-tag），宽了但不显臃肿。
     */
    width: 300px;
    background: var(--flow-surface);
    border: 1px solid var(--flow-border);
    border-radius: 10px;
    box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
    overflow: hidden;
    transition:
        box-shadow 0.18s ease,
        transform 0.18s ease,
        border-color 0.18s ease;
}

/* hover 只加强阴影，不做 translate 位移：
   节点位移会带着连接点一起动，鼠标相对连接点偏移后容易抖动、拉不出连线 */
.node-card:hover {
    box-shadow: 0 6px 16px rgb(15 23 42 / 8%);
}

.node-card.selected {
    border-color: var(--flow-blue-border);
    box-shadow: 0 0 0 3px rgb(37 99 235 / 12%);
}

/* 顶部类型色条 */
.node-card::before {
    content: '';
    display: block;
    height: 3px;
    background: #3b82f6;
}

/* 飞书提醒节点：类型条换成青蓝，和审批节点在画布上一眼可分 */
.node-card.is-notify::before {
    background: #0891b2;
}

/* 独立审批节点：类型条换成橙色，一眼区分"旁路环节" */
.node-card.is-independent::before {
    background: #EA580C;
}

/* 独立审批整卡用橙色虚线框包住：实线 = 主线必经环节，虚线 = 旁路发起、不阻塞主线 */
.node-card.is-independent {
    border: 1px dashed rgb(234 88 12 / 60%);
}

/* 独立审批的结论选项 chips（默认 通过/驳回；加了自定义码就按配置显示） */
.ind-options {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    align-items: center;
}

.ind-option {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px 4px 1px 6px;
    border: 1px solid #E5E1D8;
    border-radius: 4px;
    background: #FAF7EF;
    font-size: 9px;
    color: #92400E;
}

.ind-option .icon-btn {
    width: 12px;
    height: 12px;
}

.ind-options__default {
    font-size: 9px;
    color: #B8B2A3;
    white-space: nowrap;
}

/* 默认提示 + 自定义输入 + 加结论：同一行、垂直居中、等高 */
.ind-option-row {
    display: flex;
    align-items: center;
    gap: 4px;
}

/* 行内的加结论按钮：.add-btn 默认是"整行 + 上边距"的成员区样式，这里收成同行小按钮 */
.ind-option-row .add-btn {
    width: auto;
    flex: none;
    margin-top: 0;
    padding: 2px 8px;
    white-space: nowrap;
}

.ind-option-input {
    flex: 1;
    min-width: 0;
    height: 20px;
    padding: 0 6px;
    border: 1px solid #E5E1D8;
    border-radius: 4px;
    font-size: 10px;
    color: #55534B;
    background: #fff;
}

.ind-option-input:focus {
    outline: none;
    border-color: #EA580C;
}

/* 飞书提醒：可选的补充文案输入（整行宽，虚线弱化，与成员输入框同一套视觉语言） */
.notify-content {
    display: block;
    width: 100%;
    margin-top: 5px;
    padding: 3px 5px;
    font-size: 11px;
    color: var(--flow-text-sub);
    background: transparent;
    border: 1px dashed var(--flow-border-strong);
    border-radius: 5px;
    outline: none;
}

.notify-content:focus {
    border-color: var(--flow-blue-border);
    color: var(--flow-text);
}

/* 插值语法提示：不写出来没人知道可以引用数据行字段 */
.notify-tip {
    margin-top: 4px;
    font-size: 10px;
    line-height: 14px;
    color: var(--flow-text-muted);
}

.notify-tip code {
    padding: 0 3px;
    border-radius: 3px;
    background: var(--flow-surface-sunken);
    font-size: 10px;
}

/* ===== 头部 ===== */
.node-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 8px 4px;
}

.head-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 5px;
    background: var(--flow-blue-soft);
    flex: none;
}

.node-title {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--flow-text);
    line-height: 20px;
    padding: 1px 5px;
    border: 1px solid transparent;
    border-radius: 5px;
    outline: none;
    background: transparent;
    transition: all 0.15s ease;
}

.node-title:hover {
    background: var(--flow-surface-hover);
}

.node-title:focus {
    background: var(--flow-surface);
    border-color: var(--flow-blue-border);
    box-shadow: 0 0 0 2px rgb(37 99 235 / 8%);
}

.node-title::placeholder {
    color: var(--flow-text-muted);
    font-weight: 400;
}

/* ===== 操作按钮 ===== */
.icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex: none;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--flow-icon);
    cursor: pointer;
    transition: all 0.15s ease;
}

.icon-btn:hover {
    background: var(--flow-danger-bg);
    color: var(--flow-danger-text);
}

/* 未 hover 时隐藏，减少视觉噪音 */
.del-btn {
    opacity: 0;
    transition: opacity 0.15s ease;
}

.node-card:hover .del-btn,
.member-row:hover .del-btn {
    opacity: 1;
}

/* 动态审批人：卡片上直接填"部门取自哪个字段"（如 组别） */
input.member-dept {
    /*
     * 给一个**真正的下限**：.member-dept 的 `flex: 1`（basis 0）会让它从 0 开始被拉伸，
     * 卡片窄的时候就被挤到几十像素、连占位符都显示不全（写 width 在这里是无效的，
     * flex 布局下主尺寸由 flex-basis 决定）。min-width 才是那个下限。
     */
    min-width: 100px;
    padding: 1px 4px;
    border: 1px dashed var(--flow-border-strong);
    border-radius: 4px;
    background: transparent;
    color: var(--flow-text-sub);
    font-size: 9.5px;
    outline: none;
}

input.member-dept:focus {
    border-color: var(--flow-blue-border);
    color: var(--flow-text);
}

/* ===== 审批结果分支列表（多条出线时出现）===== */
.branch-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 2px 8px 6px;
    border-top: 1px solid var(--flow-border);
}

/* 一行分支 = 分支按钮（占满剩余宽度）+ 上下移按钮 */
.branch-row {
    display: flex;
    align-items: center;
    gap: 2px;
}

.branch-item {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    width: 100%;
    padding: 3px 6px;
    border: none;
    border-radius: 6px;
    background: transparent;
    font: inherit;
    text-align: left;
    color: inherit;
    cursor: pointer;
    transition: background 0.15s ease;
}

.branch-item:hover {
    background: var(--flow-surface-hover);
}

.branch-item.active {
    background: var(--flow-blue-soft);
    outline: 1px solid var(--flow-blue-border);
}

.branch-item.active .branch-name {
    color: #2563eb;
    font-weight: 600;
}

.branch-edit-ico {
    margin-left: auto;
    flex: none;
}

/*
 * 上下移按钮：竖排两个箭头，平时压得很淡（分支名才是主体），hover 卡片时才明显；
 * 到头的那个置灰不可点（不隐藏 —— 隐藏会让按钮位置左右跳）。
 */
.branch-move {
    display: flex;
    flex-direction: column;
    flex: none;
    gap: 1px;
}

.move-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 10px;
    padding: 0;
    border: none;
    border-radius: 3px;
    background: transparent;
    color: var(--flow-text-muted);
    opacity: 0.55;
    cursor: pointer;
    transition: all 0.15s ease;
}

.node-card:hover .move-btn,
.move-btn:hover:not(:disabled) {
    opacity: 1;
}

.move-btn:hover:not(:disabled) {
    background: var(--flow-blue-soft);
    color: #2563eb;
}

.move-btn:disabled {
    opacity: 0.18;
    cursor: default;
}

.branch-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #2563eb;
    flex: none;
}

.branch-name {
    flex: 1;
    min-width: 0;
    font-size: 11px;
    color: var(--flow-text-sub);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

/* 直达结束节点标记：该分支命中即流程结束 */
.branch-end-tag {
    flex: none;
    font-size: 10px;
    line-height: 15px;
    padding: 0 5px;
    border-radius: 4px;
    background: var(--flow-surface-sunken);
    border: 1px solid var(--flow-border-strong);
    color: var(--flow-text-muted);
    white-space: nowrap;
}

/* ===== 成员区 ===== */
.node-body {
    padding: 2px 8px 8px;
}

.member-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 2px;
    border-radius: 5px;
    transition: background 0.15s ease;
}

.member-row:hover {
    background: var(--flow-surface-sunken);
}

.member-avatar {
    flex: none;
    border: 1px solid var(--flow-border);
}

.member-name {
    font-size: 11px;
    color: var(--flow-text);
    max-width: 76px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.role-tag {
    flex: none;
    font-size: 9px;
    line-height: 13px;
    padding: 0 3px;
    border-radius: 3px;
}

.role-approve {
    background: var(--flow-role-approve-bg);
    color: var(--flow-role-approve-text);
}

.role-cc {
    background: var(--flow-role-cc-bg);
    color: var(--flow-role-cc-text);
}

/*
 * 「按组轮询」那套样式（.role-rotate / .rotation-* / .rotation-check*）已随编辑入口一起删除：
 * 组间流转搬到画布上的「组间轮询」卡片之后，审批节点里不再有轮询配置行。
 * 卡片那边的样式在 components/flow/LoopCard*.vue。
 */

.member-dept {
    flex: 1;
    min-width: 0;
    font-size: 9.5px;
    color: var(--flow-text-sub);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.empty-hint {
    font-size: 11px;
    color: var(--flow-text-muted);
    padding: 3px 2px;
}

/* ===== 添加按钮 ===== */
.add-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    margin-top: 5px;
    padding: 4px 0;
    font-size: 11px;
    color: var(--flow-text-sub);
    background: transparent;
    border: 1px dashed var(--flow-border-strong);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
}

.add-btn:hover {
    color: var(--flow-handle-active);
    border-color: var(--flow-blue-border);
    background: var(--flow-surface-hover);
}
</style>
