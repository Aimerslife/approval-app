<template>
    <div class="node-card" :class="{ selected: props.selected }">
        <Handle type="target" :position="Position.Top" />

        <div class="node-head">
            <span class="head-icon">
                <v-icon size="13" color="#2563eb">mdi-account-check-outline</v-icon>
            </span>
            <input v-model="props.data.title" class="node-title" placeholder="环节名称" />
            <button class="icon-btn del-btn" title="删除节点" @click.stop="emit('remove')">
                <v-icon size="13">mdi-trash-can-outline</v-icon>
            </button>
        </div>

        <!-- 审批结果分支列表：该审批有第二条出线后出现，点击某条分支联动配置面板 -->
        <div v-if="branches && branches.length > 1" class="branch-list">
            <button v-for="b in branches" :key="b.id" type="button" class="branch-item nodrag"
                :class="{ active: b.id === activeEdgeId }" title="点击配置此结果分支" @click.stop="emit('branch-click', b.id)">
                <span class="branch-dot"></span>
                <span class="branch-name">{{ b.label || '未命名分支' }}</span>
                <span v-if="b.toEnd" class="branch-end-tag" title="此分支直接连到结束节点：命中该分支时流程立即结束">→ 结束</span>
                <v-icon v-if="b.id === activeEdgeId" size="11" color="#2563eb" class="branch-edit-ico">mdi-pencil</v-icon>
            </button>
        </div>

        <div class="node-body">
            <div v-for="(m, i) in props.data.members" :key="i" class="member-row">
                <v-avatar size="20" class="member-avatar">
                    <v-img v-if="m.avatar" :src="m.avatar" cover />
                    <v-icon v-else size="11" color="#94a3b8">
                        {{ m.role ? 'mdi-account-star-outline' : 'mdi-account' }}
                    </v-icon>
                </v-avatar>
                <template v-if="m.role">
                    <span class="member-name">部门负责人</span>
                    <span class="role-tag role-approve">动态</span>
                    <input v-model="roleOf(m).deptFrom" class="member-dept nodrag" placeholder="部门字段 如 组别"
                        title="取数据行的哪个字段当部门名（如「组别」「团队」）；留空则建单时会报错" />
                </template>
                <template v-else>
                    <span class="member-name">{{ m.name }}</span>
                    <span class="role-tag" :class="m.type === 'manager' ? 'role-approve' : 'role-cc'">
                        {{ m.type === 'manager' ? '审批' : '抄送' }}
                    </span>
                    <span v-if="m.department" class="member-dept" :title="m.department_path">
                        {{ m.department }}
                    </span>
                </template>
                <button class="icon-btn del-btn" title="移除成员" @click.stop="removeMember(i)">
                    <v-icon size="11">mdi-close</v-icon>
                </button>
            </div>

            <div v-if="!props.data.members.length" class="empty-hint"
                title="这一环可以留空：由上一环节的办理人用「选择接收人员」当场指定">
                待指定（可由上一环节「选择接收人员」填充）
            </div>

            <div class="d-flex ga-1">
                <button class="add-btn" @click.stop="emit('addMember')">
                    <v-icon size="11" class="mr-1">mdi-plus</v-icon>添加成员
                </button>
                <button class="add-btn" @click.stop="emit('addRole')"
                    title="不指定具体的人：建单时按数据行字段（如「组别」）取对应部门的负责人">
                    <v-icon size="11" class="mr-1">mdi-account-star-outline</v-icon>动态负责人
                </button>
            </div>
        </div>

        <Handle type="source" :position="Position.Bottom" />
    </div>
</template>

<script lang="ts" setup>
import { Handle, Position } from '@vue-flow/core'
import type { ApprovalChainItem, ApprovalNodeData, ApprovalRole } from '@/types/approval'

const props = defineProps<{
    data: ApprovalNodeData
    selected?: boolean
    /** 该节点所有出线（结果分支列表）；>1 条时卡片展示，点击联动选中配置面板 */
    branches?: { id: string; label: string; toEnd?: boolean }[]
    /** 当前被选中（配置面板正在编辑）的连线 id */
    activeEdgeId?: string | null
}>()

const emit = defineEmits<{
    /** 请求把当前选中的员工加入此节点 */
    addMember: []
    /** 请求加一个**动态审批人**（部门负责人，建单时解析，见 utils/approvalRoles） */
    addRole: []
    /** 删除此节点 */
    remove: []
    /** 点击某条结果分支名，请求父级选中该连线 */
    'branch-click': [edgeId: string]
}>()

const EMPTY_ROLE: ApprovalRole = { kind: 'dept_leader', deptFrom: '' }
function roleOf(m: ApprovalChainItem): ApprovalRole {
    return m.role ?? EMPTY_ROLE
}

function removeMember(i: number) {
    props.data.members.splice(i, 1)
}
</script>

<style scoped>
/* ===== 卡片基础 ===== */
.node-card {
    width: 236px;
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
    font-size: 13px;
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
    width: 84px;
    padding: 1px 4px;
    border: 1px dashed var(--flow-border-strong);
    border-radius: 4px;
    background: transparent;
    color: var(--flow-text-sub);
    font-size: 10px;
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
    font-size: 12px;
    color: var(--flow-text);
    max-width: 72px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.role-tag {
    flex: none;
    font-size: 10px;
    line-height: 14px;
    padding: 0 4px;
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

.member-dept {
    flex: 1;
    min-width: 0;
    font-size: 10px;
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
