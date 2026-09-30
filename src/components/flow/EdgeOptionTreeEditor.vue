<template>
  <div class="opt-tree">
    <div v-for="(g, gi) in modelValue" :key="gi" class="opt-group">
      <div class="opt-row">
        <span class="opt-badge">类别</span>

        <input class="opt-input opt-title" placeholder="如：外部环境" :value="g.title" @change="setTitle(gi, $event)">

        <button class="opt-del" title="删除这个类别" @click="removeGroup(gi)">
          <v-icon size="11">mdi-close</v-icon>
        </button>
      </div>

      <div v-for="(it, ii) in g.items" :key="ii" class="opt-leaf">
        <div class="opt-row">
          <span class="opt-badge opt-badge--sub">一级</span>

          <input class="opt-input" placeholder="如：政策与法规变化" :value="it.text" @change="setText(gi, ii, $event)">

          <span class="opt-label" title="实际走本节点的哪条出线 —— 与上面的类别归类无关">实际链路</span>

          <select class="opt-input opt-link" :value="it.link" @change="setLink(gi, ii, $event)">
            <option disabled value="">请选择</option>

            <option v-for="o in linkOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>

          <!--
            二级**默认一行都不显示**：点它才 push 一行出来（没人用的二级不必白占一行）。
            想加几个就点几次 —— 每次加一个二级选项，可单独删。
          -->
          <button class="opt-add opt-add--child" title="给这个一级选项加一个二级选项（只做细分展示，实际链路跟随上面的一级）" @click="addChild(gi, ii)">
            <v-icon size="11">mdi-plus</v-icon>
            <span>增加二级</span>
          </button>
          <button class="opt-del" title="删除这个一级选项" @click="removeItem(gi, ii)">
            <v-icon size="11">mdi-close</v-icon>
          </button>
        </div>
        <div v-for="(c, ci) in it.children ?? []" :key="ci" class="opt-row opt-row--children">
          <span class="opt-label">二级</span>
          <input class="opt-input opt-children" placeholder="如：研发；也可写「开发，研发」一次拆成两项" :value="c"
            @change="setChild(gi, ii, ci, $event)">
          <button class="opt-del" title="删除这个二级选项" @click="removeChild(gi, ii, ci)">
            <v-icon size="11">mdi-close</v-icon>
          </button>
        </div>
      </div>
      <button class="opt-add" @click="addItem(gi)">
        <v-icon size="11">mdi-plus</v-icon>
        <span>一级选项</span>
      </button>
    </div>
    <button class="opt-add opt-add--group" @click="addGroup">
      <v-icon size="11">mdi-plus</v-icon>
      <span>新增类别</span>
    </button>
  </div>
</template>

<script lang="ts" setup>
import type { ApprovalOptionGroup } from '@/types/approval'

/**
 * 办理选项树的编辑器（**主画布与卡片内部画布共用**，别在两处各写一份）。
 *
 * 三级结构（见 types/approval 的 ApprovalOptionGroup）：
 *   类别（标题，如「外部环境」）→ 一级选项（**自带"实际链路"**）→ 二级选项（只细分展示）。
 * 二级**默认不展开**：点一级行里的「增加二级」才加一行，点几次就有几个（可逐个删）；
 * 二级文案**支持分隔符**（`,` `，` `、` 换行）—— 一个框里写「开发，研发」会在失焦/回车时拆成两行。
 *
 * 「实际链路」= 本节点**哪条出线**（结论码）：它才是提交时真正用的结果码，
 * 所以**显示归类与实际走哪条线是解耦的**（类别只是给人看的分类）。
 *
 * 数据流：受控组件 —— 只读 `modelValue`，改动时 emit 一份**新的**数组回去，
 * 由父组件决定写库/删字段（项目里其它面板字段也是这个口径：空值就删字段）。
 */
const props = defineProps<{
  /** 当前的选项树（不存在时父组件给空数组） */
  modelValue: ApprovalOptionGroup[]
  /** 「实际链路」候选：本节点各条出线（value = 结论码，label = 分支名/结论文案） */
  linkOptions: Array<{ value: string, label: string }>
}>()

const emit = defineEmits<{
  // 事件名用 kebab-case（vue/custom-event-name-casing）；父组件按 :model-value + @update:model-value 接
  (e: 'update:model-value', value: ApprovalOptionGroup[]): void
}>()

/**
 * 深拷贝一份选项树（**只用纯数据**）。
 *
 * ⚠️ 这里**不能用 `structuredClone`**：父组件把 emit 回去的树写进响应式对象后，
 * 下次传进来的 `modelValue` 就是 **Proxy**，`structuredClone` 会直接抛
 * `DataCloneError: #<Object> could not be cloned.` —— 表现就是**第一次能加，
 * 之后新增类别 / 新增一级选项 / 改文案全部静默失效**（这就是"无法继续增加一级选项"的原因）。
 * `toRaw` 也只脱得掉最外层，里层照样是 Proxy（同一坑见 LoopCardDialog 的 cloneGraph）。
 * 选项树本身就是 JSON 数据（字符串 + 数组），所以走 JSON 深拷贝。
 */
function cloneGroups(list: ApprovalOptionGroup[]): ApprovalOptionGroup[] {
  // eslint-disable-next-line unicorn/prefer-structured-clone -- 见上：Proxy 会让 structuredClone 抛 DataCloneError
  return JSON.parse(JSON.stringify(list)) as ApprovalOptionGroup[]
}

/** 复制一份再改、再 emit（不直接改 prop，父组件那边才好决定"空就删字段"） */
function patch(fn: (draft: ApprovalOptionGroup[]) => void) {
  const draft = cloneGroups(props.modelValue ?? [])
  fn(draft)
  emit('update:model-value', draft)
}

function inputValue(e: Event): string {
  return (e.target as HTMLInputElement | HTMLSelectElement).value
}

function addGroup() {
  patch(list => list.push({ title: '', items: [{ text: '', link: '' }] }))
}

function removeGroup(gi: number) {
  patch(list => list.splice(gi, 1))
}

function setTitle(gi: number, e: Event) {
  patch(list => {
    const g = list[gi]
    if (g) {
      g.title = inputValue(e)
    }
  })
}

/**
 * 新增一级选项。
 * `items` 兜个底：老数据/手写数据里可能没有这个数组，直接 `.push` 会抛错 → 按钮点了没反应。
 */
function addItem(gi: number) {
  patch(list => {
    const g = list[gi]
    if (g) {
      (g.items ??= []).push({ text: '', link: '' })
    }
  })
}

function removeItem(gi: number, ii: number) {
  patch(list => {
    const g = list[gi]
    if (g) {
      g.items?.splice(ii, 1)
    }
  })
}

function setText(gi: number, ii: number, e: Event) {
  patch(list => {
    const it = list[gi]?.items[ii]
    if (it) {
      it.text = inputValue(e)
    }
  })
}

function setLink(gi: number, ii: number, e: Event) {
  patch(list => {
    const it = list[gi]?.items[ii]
    if (it) {
      it.link = inputValue(e)
    }
  })
}

/*
 * 二级选项：**默认一行都不显示**，点一次「增加二级」才 push 一行（数组里就是一个字符串）。
 * 行还在、文案还空着也没关系 —— 保存/编译时 normalizeOptionGroups 会把空串丢掉
 * （见 types/approval 的 normalizeOptionTexts），所以编辑期留空串是安全的。
 *
 * 二级文案**支持分隔符**（`,` `，` `、` 与换行）：一个框里写「开发，研发」会当场拆成两行，
 * 每行一项、各自可改可删 —— 这样"一行一项"和"一框多项"两种输入习惯都成立。
 */

function addChild(gi: number, ii: number) {
  patch(list => {
    const it = list[gi]?.items[ii]
    if (it) {
      (it.children ??= []).push('')
    }
  })
}

function setChild(gi: number, ii: number, ci: number, e: Event) {
  const parts = inputValue(e).split(/[,，、\n]/).map(s => s.trim())
  // 末尾那个分隔符 = "还要接着写"：补一个空行（像标签输入框）；中间的空段直接丢掉
  const more = parts.at(-1) === ''
  const items = parts.filter(Boolean)
  patch(list => {
    const it = list[gi]?.items[ii]
    if (it?.children) {
      // 用 splice 原地替换这一行：写了几项就变成几行（一项都没有时留下一行空的继续写）
      it.children.splice(ci, 1, ...(more ? [...items, ''] : items))
    }
  })
}

/** 删掉这一行；删空了就把 children 整个去掉（"没配"与"配了空的"只留一种表示） */
function removeChild(gi: number, ii: number, ci: number) {
  patch(list => {
    const it = list[gi]?.items[ii]
    if (!it?.children) {
      return
    }
    it.children.splice(ci, 1)
    if (it.children.length === 0) {
      delete it.children
    }
  })
}
</script>

<style scoped>
.opt-tree {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  margin-top: 6px;
}

.opt-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  background: #f8fafc;
}

.opt-leaf {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding-left: 10px;
  border-left: 2px solid #e2e8f0;
}

.opt-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.opt-row--children {
  padding-left: 2px;
}

.opt-badge {
  flex: none;
  padding: 0 5px;
  border-radius: 4px;
  background: #dbeafe;
  color: #1d4ed8;
  font-size: 10px;
  line-height: 16px;
}

.opt-badge--sub {
  background: #f1f5f9;
  color: #475569;
}

.opt-label {
  flex: none;
  color: #6b7280;
  font-size: 11px;
  white-space: nowrap;
}

.opt-input {
  height: 24px;
  padding: 0 6px;
  border: 1px solid #d1d5db;
  border-radius: 5px;
  font-size: 11px;
  color: #111827;
  background: #fff;
}

.opt-title {
  flex: 0 1 160px;
  font-weight: 600;
}

.opt-link {
  flex: 0 1 200px;
}

.opt-children {
  flex: 1 1 260px;
}

.opt-add {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  align-self: flex-start;
  /* padding: 2px 8px; */
  border: 1px dashed #cbd5e1;
  border-radius: 999px;
  color: #475569;
  font-size: 10px;
  background: #fff;
  cursor: pointer;
}

.opt-add:hover {
  border-color: #94a3b8;
  color: #1d4ed8;
}

.opt-add--group {
  border-style: solid;
}

/* 一级行里的「增加二级」：比独立成行的 .opt-add 更小一号，好跟输入框/下拉挤在同一行 */
.opt-add--child {
  align-self: center;
  padding: 0 6px;
  font-size: 10px;
  line-height: 20px;
}

.opt-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  color: #94a3b8;
  background: transparent;
  cursor: pointer;
}

.opt-del:hover {
  color: #dc2626;
  background: #fee2e2;
}
</style>
