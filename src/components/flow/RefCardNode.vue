<template>
  <div
    class="node-card ref-card"
    :class="{ selected: props.selected }"
    title="引用另一张模板的整段流程（内容在建单时搬进来）"
  >
    <Handle :position="Position.Top" type="target" />

    <div class="node-head">
      <span class="head-icon">
        <v-icon color="#0d9488" size="13">mdi-puzzle-outline</v-icon>
      </span>

      <input class="node-title" placeholder="如：仓储段" :value="title" @input="onTitle">

      <button v-if="!props.readonly" class="icon-btn del-btn" title="删除卡片" @click.stop="emit('remove')">
        <v-icon size="13">mdi-trash-can-outline</v-icon>
      </button>
    </div>

    <div class="node-body">
      <!-- 只读预览：没有候选列表（FlowPreview 拿不到模板列表），只显示存下来的源模板名 -->
      <div v-if="props.readonly" class="ref-row">
        <span class="role-tag role-ref">引用</span>
        <span class="ref-name">{{ sourceLabel }}</span>
      </div>

      <template v-else>
        <div class="ref-row">
          <span class="role-tag role-ref">模板</span>

          <select
            class="ref-select nodrag"
            title="要引用的模板：它的**整段流程**会在建单时搬到这里"
            :value="dataRef().refTemplateId ?? ''"
            @change="onPick"
          >
            <option value="">选择要引用的模板…</option>
            <option v-for="t in templateChoices" :key="t.id" :value="t.id">{{ t.name || '（未命名模板）' }}</option>
          </select>
        </div>

        <div v-if="missingSource" class="ref-warn">
          <v-icon size="12">mdi-alert-circle-outline</v-icon>
          <span>源模板已不存在，请重新选择</span>
        </div>

        <div v-else-if="dataRef().refTemplateId" class="ref-actions">
          <span class="ref-name">{{ sourceLabel }}</span>

          <button class="ref-link nodrag" title="在弹窗里看一眼源模板的流程（只读，不会改动任何东西）" @click.stop="emit('preview', String(dataRef().refTemplateId))">
            展开预览
          </button>

          <button class="ref-link nodrag" title="在新标签页打开源模板（当前未保存的改动不会丢）" @click.stop="emit('open', String(dataRef().refTemplateId))">
            打开源模板
          </button>
        </div>

        <!-- <div class="ref-hint">
          引用的是源模板的当前流程：源模板改了，之后新建的单用新版，已建的单不受影响。
          源模板里连到「结束」= 这一段走完：只接**一条**出线就是"走完继续往下"，
          接**两条以上**则按这一段最后办出来的结论分别走（点每条线在面板里选结论）。
        </div> -->

        <!-- 按结论分流的出线（≥2 条时才有）：点名"每条线绑了什么、往哪去" -->
        <div v-if="branches.length > 0" class="ref-exits">
          <span class="role-tag role-ref">分流</span>

          <button
            v-for="b in branches"
            :key="b.id"
            class="ref-exit"
            :title="`点这条线：在上方面板里看/改它绑的结论与条件（去向：${b.toEnd ? '结束' : '流程后面的环节'}）`"
            type="button"
            @click.stop="emit('branch-click', b.id)"
          >
            {{ b.label || '（未命名线）' }}
            <span class="ref-exit-to">{{ b.toEnd ? '→ 结束' : '→ 下一环' }}</span>
          </button>
        </div>
      </template>
    </div>

    <Handle :position="Position.Bottom" type="source" />
  </div>
</template>

<script lang="ts" setup>
  import type { RefNodeData } from '@/types/approval'
  import { Handle, Position } from '@vue-flow/core'

  /**
   * 画布上的「引用模板」卡片。
   *
   * 为什么不做成"把源模板的流程画进这张卡片"（像轮询卡片的内部小画布那样）：
   * 那会退化成**一次性复制** —— 源模板以后改了，这张卡片拿到的是旧内容。
   * "复用而不是复制"的关键就是：卡片里只存**一个引用**。
   *
   * 代价（对使用者可见）：卡片上看不到被引用模板里有什么，只能点「打开源模板」去看。
   * 这是刻意的取舍 —— 看得到内容与跟得上源模板，二者只能选一个。
   */
  const props = defineProps<{
    /** 卡片数据（源模板 id + 名字，见 types/approval 的 RefNodeData） */
    data: RefNodeData
    selected?: boolean
    /**
     * 可选的源模板候选（`{ id, name }`）。**可选**：
     * · 编辑器传（`createStream` 的 refTemplateChoices，已排除当前正在编辑的这张，避免自引用）；
     * · 只读预览（FlowPreview）不传 —— 那种情况下不渲染下拉，只显示存下来的名字。
     */
    templates?: { id: string, name: string }[]
    /** 只读展示（FlowPreview 用）：不渲染下拉、删除按钮与「打开源模板」 */
    readonly?: boolean
    /**
     * 出线列表（`{ id, label, toEnd }`）。**可选**：
     * · 编辑器传（`createStream` 的 `outBranches`）——**只有 ≥2 条出线**（按结论分流）时才有内容；
     * · 只读预览也传（`FlowPreview` 的 `getBranches`），这样预览里也看得到分流去向。
     */
    branches?: { id: string, label: string, toEnd: boolean }[]
  }>()

  const emit = defineEmits<{
    /** 删除整张卡片 */
    'remove': []
    /** 在弹窗里只读预览源模板的流程（参数是源模板 id） */
    'preview': [templateId: string]
    /** 在新标签页打开源模板（参数是源模板 id） */
    'open': [templateId: string]
    /** 点了某条分流线：请父级选中它（参数是连线 id） */
    'branch-click': [edgeId: string]
  }>()

  /** 取卡片数据的引用（同 roleOf / dataRef 那套：直接改 prop 会被 lint 拦下，父子共享同一引用） */
  function dataRef (): RefNodeData {
    return props.data
  }

  const title = computed(() => props.data?.title ?? '')
  const templateChoices = computed(() => props.templates ?? [])
  /** 分流线（≥2 条出线时才有；单出线是"穿过去"，卡片上不显示这一块） */
  const branches = computed(() => props.branches ?? [])

  /** 选中的源模板**不在**候选里 = 已被删除（候选来自库里的全量模板列表） */
  const missingSource = computed(() => {
    const id = String(props.data?.refTemplateId ?? '')
    return !!id && !!props.templates && !props.templates.some(t => t.id === id)
  })

  /**
   * 卡片上显示的源模板名：优先取候选里的**最新**名字（源模板改过名就该显示新名），
   * 取不到才回落卡片上存的那份（源模板被删时至少还看得出原本引的是谁）。
   */
  const sourceLabel = computed(() => {
    const id = String(props.data?.refTemplateId ?? '')
    const hit = templateChoices.value.find(t => t.id === id)
    return hit?.name || String(props.data?.refTemplateName ?? '').trim() || '（未选择）'
  })

  function onTitle (e: Event) {
    dataRef().title = (e.target as HTMLInputElement).value
  }

  /**
   * 选中源模板：同时把**名字冗余存一份**。
   *
   * 为什么要存名字：源模板被删之后，"引的是谁"这件事只能从卡片上看出来 ——
   * 那时下拉里已经没有它了，光留一个 id 等于什么都没说。
   * （解析流程时只认 id，名字纯展示，见 types/approval 的 RefNodeData。）
   */
  function onPick (e: Event) {
    const id = (e.target as HTMLSelectElement).value
    const d = dataRef()
    d.refTemplateId = id
    const hit = templateChoices.value.find(t => t.id === id)
    if (hit) {
      d.refTemplateName = hit.name
      // 作者没自己改过名字时，跟着源模板名走 —— 否则卡片会一直叫「引用模板1」
      const auto = !String(d.title ?? '').trim() || /^引用模板\d*$/.test(String(d.title).trim())
      if (auto) {
        d.title = hit.name
      }
    } else {
      delete d.refTemplateName
    }
  }
</script>

<style scoped>
/* ===== 卡片基础：与 LoopCardNode.vue 同款（只换类型色条与 body 内容）===== */
.node-card {
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

/* hover 只加强阴影，不做 translate 位移（位移会带着连接点动，容易抖动拉不出线） */
.node-card:hover {
  box-shadow: 0 6px 16px rgb(15 23 42 / 8%);
}

.node-card.selected {
  border-color: var(--flow-blue-border);
  box-shadow: 0 0 0 3px rgb(37 99 235 / 12%);
}

/* 顶部类型色条：青绿 = 引用模板（审批蓝 / 条件橙 / 提醒青 / 轮询紫） */
.node-card.ref-card::before {
  content: '';
  display: block;
  height: 3px;
  background: #0d9488;
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
  flex: none;
  border-radius: 5px;
  background: #ccfbf1;
}

.node-title {
  flex: 1;
  min-width: 0;
  padding: 1px 5px;
  font-size: 12px;
  font-weight: 600;
  line-height: 20px;
  color: var(--flow-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 5px;
  outline: none;
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
  font-weight: 400;
  color: var(--flow-text-muted);
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
  color: var(--flow-icon);
  background: transparent;
  border: none;
  border-radius: 5px;
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

.node-card:hover .del-btn {
  opacity: 1;
}

/* ===== 引用配置区 ===== */
.node-body {
  padding: 2px 8px 8px;
}

.role-tag {
  flex: none;
  padding: 0 3px;
  font-size: 9px;
  line-height: 13px;
  border-radius: 3px;
}

.role-ref {
  background: #ccfbf1;
  color: #0f766e;
}

.ref-row {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 2px 0 1px;
}

/* 下拉占满整行：模板名（4-8 字）比"组字段"长得多，收窄会把名字截掉 */
.ref-select {
  flex: 1;
  min-width: 0;
  height: 22px;
  padding: 0 4px;
  font-size: 10px;
  color: var(--flow-input-text);
  background: var(--flow-input-bg);
  border: 1px solid var(--flow-input-border);
  border-radius: 5px;
  outline: none;
  cursor: pointer;
}

.ref-select:hover,
.ref-select:focus {
  border-color: var(--flow-blue-border);
}

.ref-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin: 3px 0 1px;
}

.ref-name {
  min-width: 0;
  overflow: hidden;
  font-size: 10px;
  color: var(--flow-text-sub);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ref-link {
  flex: none;
  padding: 0 4px;
  font-size: 10px;
  color: var(--flow-handle-active);
  background: transparent;
  border: 1px dashed var(--flow-border-strong);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ref-link:hover {
  background: var(--flow-surface-hover);
  border-color: var(--flow-blue-border);
}

.ref-warn {
  display: flex;
  align-items: center;
  gap: 3px;
  margin: 3px 0 1px;
  font-size: 10px;
  color: var(--flow-danger-text);
}

.ref-hint {
  margin-top: 4px;
  font-size: 10px;
  line-height: 1.5;
  color: var(--flow-text-muted);
}

/* ===== 分流线（≥2 条出线）：每条线一行，显示绑的名字与去向 ===== */
.ref-exits {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 4px;
}

.ref-exit {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 2px 6px;
  font-size: 10px;
  color: var(--flow-input-text);
  text-align: left;
  background: var(--flow-input-bg);
  border: 1px solid var(--flow-input-border);
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ref-exit:hover {
  color: var(--flow-handle-active);
  border-color: var(--flow-blue-border);
}

/* 去向：结束 / 下一环 —— 让人一眼看出这条线接的是"整单结束"还是"继续往下" */
.ref-exit-to {
  flex: none;
  color: var(--flow-text-muted);
}
</style>
