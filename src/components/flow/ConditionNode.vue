<template>
    <div class="node-card condition-node" :class="{ selected: props.selected }">
        <Handle type="target" :position="Position.Top" />

        <div class="node-head">
            <span class="head-icon">
                <v-icon size="13" color="#d97706">mdi-source-branch</v-icon>
            </span>
            <span class="node-title-static">条件分支</span>
            <button class="icon-btn del-btn" title="删除节点" @click.stop="emit('remove')">
                <v-icon size="13">mdi-trash-can-outline</v-icon>
            </button>
        </div>

        <div class="node-body">
            <div v-if="branches.length" class="branch-list">
                <button v-for="b in branches" :key="b.id" type="button" class="branch-item nodrag"
                    :class="{ active: b.id === activeEdgeId }" title="点击配置此分支" @click.stop="emit('branch-click', b.id)">
                    <span class="branch-dot"></span>
                    <span class="branch-name">{{ b.label || '未命名分支' }}</span>
                    <span v-if="b.toEnd" class="branch-end-tag" title="此分支直接连到结束节点：命中该分支时流程立即结束">→ 结束</span>
                    <v-icon v-if="b.id === activeEdgeId" size="11" color="#d97706" class="branch-edit-ico">mdi-pencil</v-icon>
                </button>
            </div>
            <div class="empty-hint">
                {{ branches.length ? '点击分支名可配置名称与命中条件' : '从下方圆点拖出连线建立分支' }}
            </div>
        </div>

        <Handle type="source" :position="Position.Bottom" />
    </div>
</template>

<script lang="ts" setup>
import { Handle, Position } from '@vue-flow/core'

const props = defineProps<{
    /** 该节点所有出边（分支），id 用于点击后联动选中配置面板 */
    branches: { id: string; label: string; toEnd?: boolean }[]
    /** 当前被选中（配置面板正在编辑）的连线 id */
    activeEdgeId?: string | null
    selected?: boolean
}>()

const emit = defineEmits<{
    /** 点击某个分支名，请求父级选中该连线 */
    'branch-click': [edgeId: string]
    /** 删除此节点 */
    remove: []
}>()
</script>

<style scoped>
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
    border-color: var(--flow-edge-selected);
    box-shadow: 0 0 0 3px rgb(245 158 11 / 14%);
}

/* 琥珀色类型条 */
.node-card::before {
    content: '';
    display: block;
    height: 3px;
    background: #f59e0b;
}

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
    background: var(--flow-amber-soft);
    flex: none;
}

.node-title-static {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--flow-text);
}

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

.del-btn {
    opacity: 0;
    transition: opacity 0.15s ease;
}

.node-card:hover .del-btn {
    opacity: 1;
}

.node-body {
    padding: 2px 8px 8px;
}

/* 分支列表：圆点 + 分支名，比 chip 更轻 */
.branch-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
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
    background: var(--flow-amber-soft);
    outline: 1px solid var(--flow-edge-selected);
}

.branch-item.active .branch-name {
    color: var(--flow-amber-text);
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
    background: #f59e0b;
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

.empty-hint {
    font-size: 11px;
    color: var(--flow-text-muted);
    padding: 3px 2px;
}
</style>
