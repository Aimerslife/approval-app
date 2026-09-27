<template>
  <div class="node-card probe-node" :class="{ selected: props.selected }">
    <Handle :position="Position.Top" type="target" />

    <div class="node-head">
      <span class="head-icon">
        <v-icon color="#0284c7" size="13">mdi-database-search-outline</v-icon>
      </span>

      <span class="node-title-static">{{ props.title || '数据查询' }}</span>

      <button class="icon-btn del-btn" title="删除节点" @click.stop="emit('remove')">
        <v-icon size="13">mdi-trash-can-outline</v-icon>
      </button>
    </div>

    <div class="node-body">
      <div class="probe-row">
        <span class="probe-tag">集合</span>

        <input
          v-model="probe.collection"
          class="probe-input nodrag"
          list="probe-collections"
          placeholder="如 approval_chain"
          title="要查的 PocketBase 集合（只能选白名单里的那几个）"
        >
      </div>

      <div class="probe-row probe-row--stack">
        <span class="probe-tag">条件</span>

        <!--
          卡片上只**只读展示**（换行铺开，不横向滚动）；点击开悬浮窗去填 ——
          卡片只有 268px，长条件串就地编辑时看不见全貌，写着写着自己都不知道前边是啥。
        -->
        <button
          class="probe-filter nodrag"
          :class="{ 'is-empty': !probe.filter }"
          type="button"
          :title="FILTER_HINT"
          @click.stop="openFilterEditor"
        >{{ probe.filter || '点击填写查询条件' }}</button>
      </div>

      <!-- 分支只在画布上读，不在卡片上改条件：这个节点的走向由**建单期**的查询结果决定 -->
      <div class="branch-list" v-if="branches.length > 0">
        <span
          v-for="b in branches"
          :key="b.id"
          class="branch-item"
          :class="{ bad: b.label !== PROBE_EXISTS_BRANCH && b.label !== PROBE_EMPTY_BRANCH }"
          :title="b.label === PROBE_EXISTS_BRANCH || b.label === PROBE_EMPTY_BRANCH
            ? '这条分支的名字是对的'
            : '名字必须是「存在」或「不存在」，否则保存会被拦下'"
        >
          <span class="branch-dot" />
          <span class="branch-name">{{ b.label || '未命名' }}</span>
          <span v-if="b.toEnd" class="branch-end-tag">→ 结束</span>
        </span>
      </div>

      <div class="probe-hint">
        <template v-if="branches.length < 2">
          从下方圆点拖出两条线，命名必须是「{{ PROBE_EXISTS_BRANCH }}」和「{{ PROBE_EMPTY_BRANCH }}」
        </template>
        <template v-else>
          建单时查一次：命中记录走「{{ PROBE_EXISTS_BRANCH }}」，否则走「{{ PROBE_EMPTY_BRANCH }}」
        </template>
      </div>
    </div>

    <!--
      编辑条件的悬浮窗。放在这个组件里而不是编辑器页面：
      只有这个卡片需要它，`v-model=false` 时内容不渲染，不会给画布添负担。
      @keydown.stop：挡掉往 window 冒泡的按键 —— 编辑器在那个层级监听 Delete 删节点，
      不然在悬浮窗里打字会把选中的节点删掉。
    -->
    <v-dialog v-model="editing" max-width="560">
      <v-card @keydown.stop>
        <v-card-title class="text-[15px]">编辑查询条件</v-card-title>

        <v-card-text>
          <p class="text-[12px] text-medium-emphasis mb-2" style="white-space: pre-line">{{ FILTER_HINT }}</p>

          <v-textarea
            v-model="draftFilter"
            auto-grow
            density="compact"
            hide-details
            placeholder="如 sku = {:SKU} && status = 0"
            rows="4"
            variant="outlined"
          />
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="editing = false">取消</v-btn>
          <v-btn color="#0052D9" variant="flat" @click="confirmFilter">确认</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- 集合候选：datalist 放哪都行，不必挤到页面级模板里 -->
    <datalist id="probe-collections">
      <option v-for="c in PROBE_COLLECTIONS" :key="c" :value="c" />
    </datalist>

    <Handle :position="Position.Bottom" type="source" />
  </div>
</template>

<script lang="ts" setup>
  import { Handle, Position } from '@vue-flow/core'
  import type { ProbeSpec } from '@/types/approval'
  import { PROBE_EMPTY_BRANCH, PROBE_EXISTS_BRANCH } from '@/types/approval'
  import { PROBE_COLLECTIONS } from '@/utils/approvalProbe'

  const props = defineProps<{
    /** 环节名（时间线上显示） */
    title?: string
    /** 直接改这个对象（父级持有同一引用）：与 ApprovalNode 的 roleOf/rotationOf 同一套写法 */
    probe: ProbeSpec
    /** 该节点所有出边；名字必须是「存在」/「不存在」 */
    branches: { id: string, label: string, toEnd?: boolean }[]
    selected?: boolean
  }>()

  const emit = defineEmits<{
    /** 删除此节点 */
    remove: []
  }>()

  /** 悬浮窗里的草稿：确认前不落到节点上（取消 = 什么都不改） */
  const editing = ref(false)
  const draftFilter = ref('')

  /**
   * 经 computed 拿这个对象再改它的字段 —— 与 ApprovalNode 的 roleOf/rotationOf 同一套写法。
   * 直接写 `props.probe.filter = …` 会被 eslint 的 vue/no-mutating-props 拦下，
   * 而这里改的确实是父级持有的那个对象（父子同一引用），不是替换 prop。
   */
  const probe = computed(() => props.probe)

  function openFilterEditor () {
    draftFilter.value = props.probe.filter ?? ''
    editing.value = true
  }

  function confirmFilter () {
    probe.value.filter = draftFilter.value.trim()
    editing.value = false
  }

  const FILTER_HINT = [
    'PB filter，可留空（留空 = 该集合里有记录就算命中）。',
    '{:字段名} 取**当前审批单**的值，例如：',
    '  sku = {:SKU} && status = 0',
    '注意列名要用 PocketBase 的列名（中文列名不会被翻译，与轮转行条件不同）。',
  ].join('\n')
</script>

<style scoped>
.probe-node {
  width: 268px;
  background: var(--flow-surface);
  border: 1px solid var(--flow-border);
  border-radius: 10px;
  box-shadow: 0 1px 2px rgb(15 23 42 / 4%);
  overflow: hidden;
}

.probe-node.selected {
  border-color: #0ea5e9;
  box-shadow: 0 0 0 2px rgb(14 165 233 / 18%);
}

.node-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--flow-border);
  background: var(--flow-surface-2, var(--flow-surface));
}

.head-icon {
  display: flex;
  flex: none;
}

.node-title-static {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--flow-text);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.icon-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--flow-text-muted);
  cursor: pointer;
}

.icon-btn:hover {
  color: var(--flow-red-text, #dc2626);
  background: var(--flow-red-soft, rgb(220 38 38 / 10%));
}

.node-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px 8px;
}

.probe-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.probe-tag {
  flex: none;
  padding: 0 4px;
  font-size: 9px;
  line-height: 14px;
  border-radius: 3px;
  background: var(--flow-role-cc-bg, rgb(14 165 233 / 12%));
  color: var(--flow-role-cc-text, #0369a1);
}

.probe-input {
  flex: 1;
  min-width: 0;
  height: 20px;
  padding: 0 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 9px;
  color: var(--flow-input-text);
  border: 1px solid var(--flow-input-border);
  border-radius: 5px;
  background: var(--flow-input-bg);
  outline: none;
}

.probe-input::placeholder {
  color: var(--flow-text-muted);
}

/*
 * 条件：只读展示 + 点击进悬浮窗编辑。
 * 虚线框是"这里可以点"的暗示；`overflow-wrap: anywhere` 不能省 ——
 * filter 里会有很长的连续片段（列名、值、括号连成一串），只靠 break-word 会撑破卡片。
 */
.probe-filter {
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

.probe-filter:hover {
  border-style: solid;
  border-color: rgb(var(--v-theme-primary));
}

.probe-filter.is-empty {
  color: var(--flow-text-muted);
}

/* 多行那一行：标签与文本框**顶对齐**，否则「条件」两个字会吊在两行中间 */
.probe-row--stack {
  align-items: flex-start;
}

.probe-row--stack .probe-tag {
  margin-top: 3px;
}

.branch-list {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin-top: 2px;
}

.branch-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  font-size: 9.5px;
  border-radius: 4px;
  background: var(--flow-surface-2, rgb(15 23 42 / 4%));
  color: var(--flow-text-sub);
}

.branch-item.bad {
  background: var(--flow-amber-soft);
  color: var(--flow-amber-text);
}

.branch-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentcolor;
  opacity: 0.6;
}

.branch-end-tag {
  font-size: 9px;
  opacity: 0.75;
}

.probe-hint {
  font-size: 9.5px;
  line-height: 1.45;
  color: var(--flow-text-muted);
}
</style>
