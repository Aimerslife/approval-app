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

            <!--
              行条件 + 只看同团队：这两项决定**哪些组别**进入轮询
              （上一行的两个输入决定的是"组名取哪列、按什么排序"）。
              求值在 utils/rotationData.ts，发生在**建单时**；卡片上只是配置入口。
            -->
            <div v-if="m.rotation" class="rotation-row rotation-row--filter">
                <span class="role-tag role-rotate">条件</span>

                <label
                    class="rotation-check-label nodrag"
                    title="只看与当前单**同团队**的组别（团队→组别 的归属见 src/utils/organazation.ts 的 parent/group）"
                >
                    <input
                        class="rotation-check"
                        type="checkbox"
                        :checked="rotationOf(m).sameTeam === true"
                        @change="setRotationSameTeam(m, $event)"
                    >
                    <span>同团队</span>
                </label>

                <!--
                  行条件只**只读展示**，点击开悬浮窗去填 —— 与「数据查询」卡片同一套交互。
                  卡片只有 300px，而这条条件常常比卡片还长（主MODEL + 呆滞 + 同团队），
                  就地编辑时看不见全貌。
                -->
                <button
                    class="rotation-filter nodrag"
                    :class="{ 'is-empty': !rotationOf(m).rowFilter }"
                    type="button"
                    :title="ROW_FILTER_HINT"
                    @click.stop="openRotationFilter(m)"
                >{{ rotationOf(m).rowFilter || '点击填写行条件' }}</button>
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

        <!--
          行条件的编辑悬浮窗（一次即可，所以放在 v-for 外面，用「正在编辑哪个成员」定位）。
          @keydown.stop：编辑器在 window 层监听 Ctrl+Z 等快捷键，不挡会在打字时触发撤销。
        -->
        <v-dialog v-model="editingFilter" max-width="560">
            <v-card @keydown.stop>
                <v-card-title class="text-[15px]">编辑轮询的行条件</v-card-title>

                <v-card-text>
                    <p class="text-[12px] text-medium-emphasis mb-2" style="white-space: pre-line">{{ ROW_FILTER_HINT }}</p>

                    <v-textarea
                        v-model="draftRowFilter"
                        auto-grow
                        density="compact"
                        hide-details
                        placeholder="行条件，如 主MODEL = {:主MODEL}"
                        rows="4"
                        variant="outlined"
                    />
                </v-card-text>

                <v-card-actions>
                    <v-spacer />
                    <v-btn variant="text" @click="editingFilter = false">取消</v-btn>
                    <v-btn color="#0052D9" variant="flat" @click="confirmRotationFilter">确认</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>

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

/**
 * 行条件的说明。卡片很窄，说明只能放 title —— 这条规则不写清楚基本没人会填。
 */
const ROW_FILTER_HINT = [
    '先按它筛数据行，再按「组字段」分组：一行都没命中的组不会进入轮询。',
    '写数据行的列名；{:字段名} 取当前审批单的值，例如',
    '  主MODEL = {:主MODEL} && 是否属于呆滞库存 = "否" && 销售状态 ~ "在售"',
    '读作"与本单同主MODEL、非呆滞、在售"。配合左边的「同团队」，',
    '就是"同团队里存在这款货的其他组别"。留空则回到默认口径（同一个 SKU 的所有行）。',
].join('\n')

/** 正在编辑行条件的那个成员（null = 悬浮窗关着） */
const editingMember = ref<ApprovalChainItem | null>(null)
/** 悬浮窗里的草稿：确认前不落到成员上（取消 = 什么都不改） */
const draftRowFilter = ref('')

/** 开关用「有没有在编辑的成员」表示，避免两个状态各说各话地不同步 */
const editingFilter = computed({
    get: () => editingMember.value !== null,
    set: (v: boolean) => {
        if (!v) editingMember.value = null
    },
})

function openRotationFilter(m: ApprovalChainItem) {
    draftRowFilter.value = m.rotation?.rowFilter ?? ''
    editingMember.value = m
}

function confirmRotationFilter() {
    const m = editingMember.value
    if (m?.rotation) {
        // 清空时写回 undefined：空串会让"没配"与"配了个空条件"两种状态混在一起
        const v = draftRowFilter.value.trim()
        m.rotation.rowFilter = v ? v : undefined
    }
    editingMember.value = null
}

/** 只看同团队：勾选写 true，取消写 undefined（保持与"没配"同一种表示） */
function setRotationSameTeam(m: ApprovalChainItem, e: Event) {
    if (!m.rotation) return
    m.rotation.sameTeam = (e.target as HTMLInputElement).checked ? true : undefined
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

/* 条件那块可能是好几行：这一行改顶对齐，否则「条件」标签与复选框会吊在两行中间 */
.rotation-row--filter {
    align-items: flex-start;
}

.rotation-row--filter .role-tag,
.rotation-row--filter .rotation-check-label {
    margin-top: 2px;
}

/*
 * 行条件：只读展示 + 点击进悬浮窗编辑（filter 串比"组字段"长得多，用等宽字更易读）。
 * 虚线框是"这里可以点"的暗示；`overflow-wrap: anywhere` 不能省 ——
 * filter 里会有很长的连续片段，只靠 break-word 会撑破卡片。
 */
.rotation-filter {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 9px;
    line-height: 1.5;
    color: var(--flow-input-text);
    text-align: left;
    border: 1px dashed var(--flow-input-border);
    border-radius: 5px;
    background: var(--flow-input-bg);
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    cursor: pointer;
}

.rotation-filter:hover {
    border-style: solid;
    border-color: rgb(var(--v-theme-primary));
}

.rotation-filter.is-empty {
    color: var(--flow-text-muted);
}

.rotation-check-label {
    display: flex;
    flex: none;
    align-items: center;
    gap: 2px;
    font-size: 9.5px;
    color: var(--flow-text-sub);
    white-space: nowrap;
    cursor: pointer;
}

.rotation-check {
    width: 11px;
    height: 11px;
    margin: 0;
    /* 勾选色跟着主题（不用写死的品牌蓝，深色下也协调） */
    accent-color: rgb(var(--v-theme-primary));
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
