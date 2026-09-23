<template>
    <div class="node-card" :class="{ selected: props.selected, 'is-notify': isNotify }">
        <Handle :position="Position.Top" type="target" />

        <div class="node-head">
            <span class="head-icon">
                <v-icon :color="isNotify ? '#0891b2' : '#2563eb'" size="13">
                    {{ isNotify ? 'mdi-bell-ring-outline' : 'mdi-account-check-outline' }}
                </v-icon>
            </span>

            <input
                v-model="props.data.title"
                class="node-title"
                :placeholder="isNotify ? '如：通知财务' : '环节名称'"
            >

            <button class="icon-btn del-btn" title="删除节点" @click.stop="emit('remove')">
                <v-icon size="13">mdi-trash-can-outline</v-icon>
            </button>
        </div>

        <!-- 审批结果分支列表：该审批有第二条出线后出现，点击某条分支联动配置面板 -->
        <div v-if="!isNotify && branches && branches.length > 1" class="branch-list">
            <button v-for="b in branches" :key="b.id" class="branch-item nodrag"
                :class="{ active: b.id === activeEdgeId }" title="点击配置此结果分支" type="button"
                @click.stop="emit('branch-click', b.id)">
                <span class="branch-dot" />
                <span class="branch-name">{{ b.label || '未命名分支' }}</span>
                <span v-if="b.toEnd" class="branch-end-tag" title="此分支直接连到结束节点：命中该分支时流程立即结束">→ 结束</span>
                <v-icon v-if="b.id === activeEdgeId" class="branch-edit-ico" color="#2563eb"
                    size="11">mdi-pencil</v-icon>
            </button>
        </div>

        <div class="node-body">
            <!--
              用 template 包一层：轮询成员要多一行配置，但 .member-row 仍是 node-body 的
              直接子元素（间距、布局与改动前一致）。
            -->
            <template v-for="(m, i) in props.data.members" :key="i">
            <div class="member-row">
                <v-avatar class="member-avatar" size="20">
                    <v-img v-if="m.avatar" cover :src="m.avatar" />

                    <v-icon v-else color="#94a3b8" size="11">
                        {{ m.role ? 'mdi-account-star-outline' : 'mdi-account' }}
                    </v-icon>
                </v-avatar>

                <template v-if="m.role">
                    <span class="member-name">部门负责人</span>
                    <span class="role-tag role-approve">动态</span>

                    <input v-model="roleOf(m).deptFrom" class="member-dept nodrag" placeholder="部门字段 如 组别"
                        title="取数据行的哪个字段当部门名（如「组别」「团队」）；留空则建单时会报错">
                </template>

                <template v-else>
                    <span class="member-name">{{ m.name }}</span>

                    <span class="role-tag" :class="m.type === 'manager' ? 'role-approve' : 'role-cc'">
                        {{ isNotify ? '提醒' : (m.type === 'manager' ? '审批' : '抄送') }}
                    </span>

                    <span v-if="m.department" class="member-dept" :title="m.department_path">
                        {{ m.department }}
                    </span>
                </template>

                <button class="icon-btn del-btn" title="移除成员" @click.stop="removeMember(i)">
                    <v-icon size="11">mdi-close</v-icon>
                </button>
            </div>

            <!--
              按组轮询：模板里只声明规则（组名取哪列、按哪列排序），
              真正的展开发生在**建单时**（那时数据已冻结，才能算出有哪几个组、什么顺序）。
            -->
            <div v-if="m.rotation" class="rotation-row">
                <span class="role-tag role-rotate">轮询</span>

                <input
                    v-model="rotationOf(m).groupFrom"
                    class="rotation-input nodrag"
                    placeholder="组字段 如 组别"
                    title="组名取自数据行的哪一列：同一列里出现的每个组各办一环"
                >

                <input
                    :value="rotationOf(m).orderFrom ?? DEFAULT_ROTATION_ORDER"
                    class="rotation-input nodrag"
                    placeholder="按哪列排序"
                    title="按这一列从高到低依次流转（同一个组命中多行时求和）；默认取近一年月平均销量"
                    @input="setRotationOrder(m, $event)"
                >
            </div>
            </template>

            <div v-if="props.data.members.length === 0" class="empty-hint" :title="isNotify
                ? '飞书提醒至少要有一个提醒对象，否则这一环不会发出任何通知（保存时会拦住）'
                : '这一环可以留空：由上一环节的办理人用「选择接收人员」当场指定接收人；该结论会终结流程，后面接的环节不会生效'">
                {{ isNotify ? '还没有提醒对象（保存时会拦住）' : '待指定（由上一环节「选择接收人员」指定，流程即终结）' }}
            </div>

            <div class="d-flex ga-1">
                <button class="add-btn" @click.stop="emit('addMember')">
                    <v-icon class="mr-1" size="11">mdi-plus</v-icon>{{ isNotify ? '添加提醒对象' : '添加成员' }}
                </button>

                <button class="add-btn" :title="isNotify
                    ? '不指定具体的人：建单时按数据行字段（如「组别」）取对应部门的负责人来提醒'
                    : '不指定具体的人：建单时按数据行字段（如「组别」）取对应部门的负责人'" @click.stop="emit('addRole')">
                    <v-icon class="mr-1" size="11">mdi-account-star-outline</v-icon>动态负责人
                </button>

                <!-- 只给审批环节：提醒节点不参与办理，展开语义不明确 -->
                <button
                    v-if="!isNotify"
                    class="add-btn"
                    title="这一环由多个组的负责人依次各办一环：建单时按数据筛出符合条件的组、按销量从高到低排好，展开成 N 个环节，直到所有组都办完"
                    @click.stop="emit('addRotation')"
                >
                    <v-icon class="mr-1" size="11">mdi-autorenew</v-icon>按组轮询
                </button>
            </div>

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
import type { ApprovalChainItem, ApprovalNodeData, ApprovalRole, RotationSpec } from '@/types/approval'
import { Handle, Position } from '@vue-flow/core'

const props = defineProps<{
    data: ApprovalNodeData
    selected?: boolean
    /** 该节点所有出线（结果分支列表）；>1 条时卡片展示，点击联动选中配置面板 */
    branches?: { id: string, label: string, toEnd?: boolean }[]
    /** 当前被选中（配置面板正在编辑）的连线 id */
    activeEdgeId?: string | null
    /**
     * 卡片形态：'approval' 审批环节（默认）/ 'notify' 飞书提醒。
     *
     * 两种节点**交互几乎完全相同**（环节名 + 成员 + 动态负责人 + 增删），
     * 差别只在配色、图标、文案，以及提醒节点没有"审批结果分支"。
     * 所以复用同一个组件、用一个 kind 区分，而不是复制一份卡片出来 ——
     * 复制出来的那份以后每改一处交互都得同步，迟早漂。
     */
    kind?: 'approval' | 'notify'
}>()

/** 是不是「飞书提醒」节点 */
const isNotify = computed(() => props.kind === 'notify')

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
    /** 请求加一个「按组轮询」成员：这一环会展开成 N 环，各组负责人依次各办一环 */
    'addRotation': []
    /** 删除此节点 */
    'remove': []
    /** 点击某条结果分支名，请求父级选中该连线 */
    'branch-click': [edgeId: string]
}>()

const EMPTY_ROLE: ApprovalRole = { kind: 'dept_leader', deptFrom: '' }
function roleOf(m: ApprovalChainItem): ApprovalRole {
    return m.role ?? EMPTY_ROLE
}

/** 轮询的缺省排序列（建单取数用；卡片上只是占位显示，不填就按它） */
const DEFAULT_ROTATION_ORDER = 'SKU近一年月平均销量'

const EMPTY_ROTATION: RotationSpec = { groupFrom: '' }
/** 同 roleOf：模板里的 v-if 不保证窄化判别联合，取不到时给个空壳（那个分支本来也不渲染） */
function rotationOf(m: ApprovalChainItem): RotationSpec {
    return m.rotation ?? EMPTY_ROTATION
}

/**
 * 排序依据用 `:value` + `@input`，不用 v-model：
 * `rotationOf(m).orderFrom` 是**函数调用**的结果，而 v-model 要求可赋值的成员表达式 ——
 * 编译期会直接拒绝这个写法（且不报错，只是静默不生效）。
 */
function setRotationOrder(m: ApprovalChainItem, e: Event) {
    if (!m.rotation) return
    m.rotation.orderFrom = (e.target as HTMLInputElement).value
}

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

.branch-item {
    display: flex;
    align-items: center;
    gap: 6px;
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

/* 「按组轮询」标记：与审批/抄送的配色区分开，一眼看出这一环会展开成 N 环 */
.role-rotate {
    background: var(--flow-amber-soft);
    color: var(--flow-amber-text);
}

/* 轮询配置行：贴在成员行下面（卡片很窄，两个输入框各占一半） */
.rotation-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 2px 0 1px;
}

.rotation-input {
    flex: 1;
    min-width: 0;
    height: 20px;
    padding: 0 6px;
    font-size: 9.5px;
    color: var(--flow-input-text);
    border: 1px solid var(--flow-input-border);
    border-radius: 5px;
    background: var(--flow-input-bg);
    outline: none;
}

.rotation-input::placeholder {
    color: var(--flow-text-muted);
}

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
