<template>
  <!--
      卡片设计与审批节点 / 条件分支同款：.node-card + .node-head（图标 + 可编辑标题 + 删除）
      + .node-body + 同一批类名与配色变量（见 ApprovalNode.vue）。
      差别只有两处：头部是一条紫色类型色条，body 里是**轮询条件**而不是成员。

      双击卡片 = 打开内部流程（与点「编辑内部流程」同一个入口）。
    -->
  <div
    class="node-card loop-card"
    :class="{ selected: props.selected }"
    title="双击打开内部流程（每个组各走一遍）"
    @dblclick.stop="emit('edit')"
  >
    <Handle :position="Position.Top" type="target" />

    <div class="node-head">
      <span class="head-icon">
        <v-icon color="#7c3aed" size="13">mdi-autorenew</v-icon>
      </span>

      <input class="node-title" placeholder="如：各组自审" :value="title" @input="onTitle">

      <button class="icon-btn del-btn" title="删除卡片" @click.stop="emit('remove')">
        <v-icon size="13">mdi-trash-can-outline</v-icon>
      </button>
    </div>

    <div class="node-body">
      <!-- 轮询：组名取自哪一列、按哪一列排序（模板里只声明规则，展开在建单时） -->
      <div class="rotation-row">
        <span class="role-tag role-rotate">轮询</span>

        <input
          class="rotation-input nodrag"
          placeholder="组字段 如 组别"
          title="组名取自数据行的哪一列：同一列里出现的每个组各走一遍"
          :value="rotationOf.groupFrom"
          @input="onGroupFrom"
        >

        <input
          class="rotation-input nodrag"
          placeholder="按哪列排序"
          title="按这一列从高到低依次流转（同一个组命中多行时按「汇总」处理）；默认取近一年月平均销量"
          :value="rotationOf.orderFrom ?? ''"
          @input="onOrderFrom"
        >
      </div>

      <!-- 条件：决定**哪些组**进入轮询（求值在建单时，见 utils/rotationData） -->
      <div class="rotation-row rotation-row--filter">
        <span class="role-tag role-rotate">条件</span>

        <label
          class="rotation-check-label nodrag"
          title="只看与当前单**同团队**的组别（团队→组别 的归属见 src/utils/organazation.ts 的 parent/group）"
        >
          <input :checked="rotationOf.sameTeam === true" class="rotation-check" type="checkbox" @change="onSameTeam">

          <span>同团队</span>
        </label>

        <button
          class="rotation-filter nodrag"
          :class="{ 'is-empty': !rotationOf.rowFilter }"
          :title="ROW_FILTER_HINT"
          type="button"
          @click.stop="openFilter"
        >{{ rotationOf.rowFilter || '点击填写行条件' }}</button>
      </div>

      <div class="rotation-row">
        <span class="role-tag role-rotate">策略</span>

        <select
          class="rotation-select nodrag"
          title="排序方向：默认从高到低，即销量高的组先办"
          :value="rotationOf.order ?? ''"
          @change="onEnum('order', $event)"
        >
          <option value="">高→低</option>
          <option value="asc">低→高</option>
        </select>

        <select
          class="rotation-select nodrag"
          title="同一个组命中多行时怎么汇总：默认求和；「取最大」适合只看单条峰值的口径"
          :value="rotationOf.aggregate ?? ''"
          @change="onEnum('aggregate', $event)"
        >
          <option value="">求和</option>
          <option value="max">取最大</option>
        </select>

        <input
          class="rotation-input rotation-input--tiny nodrag"
          inputmode="numeric"
          placeholder="20"
          title="最多展开几环（安全阀，默认 20）。超了会判这一条建单失败，不会静默截断"
          :value="rotationOf.limit ?? ''"
          @input="onLimit"
        >

        <select
          class="rotation-select rotation-select--wide nodrag"
          title="一个组都没命中时：默认跳过这一整张卡片；选「无组失败」则该条建单直接报错"
          :value="rotationOf.whenEmpty ?? ''"
          @change="onEnum('whenEmpty', $event)"
        >
          <option value="">无组跳过</option>
          <option value="fail">无组失败</option>
        </select>
      </div>

      <div v-if="!rotationOf.rowFilter" class="rotation-row">
        <span class="role-tag role-rotate">范围</span>

        <input
          class="rotation-input nodrag"
          placeholder="统计范围列 默认 SKU"
          title="按哪一列圈定「相关的行」（默认 SKU：同一个 SKU 的各组各一行）。配了行条件后不看它"
          :value="rotationOf.scopeFrom ?? ''"
          @input="onScope"
        >
      </div>

      <div class="empty-hint">
        {{ innerCount === 0
          ? '内部还没有环节：点下面的「编辑内部流程」画一段（每个组各走一遍）'
          : `内部 ${innerCount} 个环节，每个组各走一遍` }}
      </div>

      <button class="add-btn" @click.stop="emit('edit')">
        <v-icon class="mr-1" size="11">mdi-pencil-outline</v-icon>编辑内部流程
      </button>
    </div>

    <!--
          行条件的编辑悬浮窗（一次即可，所以放一张、用"正在编辑"开关控制）。
          与旧轮询面板同一套交互与文案；@keydown.stop 免得打字触发画布的快捷键。
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
          <v-btn color="#0052D9" variant="flat" @click="confirmFilter">确认</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <Handle :position="Position.Bottom" type="source" />
  </div>
</template>

<script lang="ts" setup>
  import type { LoopNodeData, RotationSpec } from '@/types/approval'
  import { Handle, Position } from '@vue-flow/core'

  /**
   * 画布上的「组间轮询」卡片 —— **轮询条件就在卡片上直接配**（与旧轮询面板同一套控件），
   * 内部那段子流程点「编辑内部流程」/双击卡片进对话框画（见 LoopCardDialog）。
   *
   * 卡片外观与审批节点 / 条件分支同款（同一批类名与设计变量），只把"成员区"换成了"轮询条件区"。
   */
  const props = defineProps<{
    /** 卡片数据（轮询配置 + 内部画布快照，见 types/approval 的 LoopNodeData） */
    data: LoopNodeData
    selected?: boolean
  }>()

  const emit = defineEmits<{
    /** 打开"内部流程"编辑对话框 */
    edit: []
    /** 删除整张卡片 */
    remove: []
  }>()

  /**
   * 取卡片数据的引用。
   *
   * 绕一层的原因与项目里 roleOf / rotationOf 同一套：**直接**改 prop 会被
   * `vue/no-mutating-props` 拦下，而"父子共享同一引用、就地改"是本项目的既定写法。
   */
  function dataRef (): LoopNodeData {
    return props.data
  }

  const title = computed(() => props.data?.title ?? '')
  const innerCount = computed(
    () => (props.data?.graph?.nodes ?? []).filter((n: any) => n.type !== 'start' && n.type !== 'end').length,
  )

  /** 同 roleOf：模板里的 v-if 不保证窄化判别联合，取不到时给个空壳（那种情况本来也不渲染） */
  const EMPTY_ROTATION: RotationSpec = { groupFrom: '' }
  function rotationRef (): RotationSpec {
    return props.data?.rotation ?? EMPTY_ROTATION
  }
  const rotationOf = computed(() => rotationRef())

  function onTitle (e: Event) {
    dataRef().title = (e.target as HTMLInputElement).value
  }

  function onGroupFrom (e: Event) {
    rotationRef().groupFrom = (e.target as HTMLInputElement).value
  }

  /** 文本类可选项：空串写回 undefined（让"没配"与"配了个空值"是同一种表示） */
  function onOrderFrom (e: Event) {
    const v = (e.target as HTMLInputElement).value.trim()
    rotationRef().orderFrom = v || undefined
  }

  function onScope (e: Event) {
    const v = (e.target as HTMLInputElement).value.trim()
    rotationRef().scopeFrom = v || undefined
  }

  /** 只看同团队：勾选写 true，取消写 undefined（与"没配"同一种表示） */
  function onSameTeam (e: Event) {
    if ((e.target as HTMLInputElement).checked) {
      rotationRef().sameTeam = true
    } else {
      delete rotationRef().sameTeam
    }
  }

  /**
   * 上限：只接受正整数；空 = 回落默认（20）。
   * 非法输入**不写库**（写进 NaN 会让建单时的上限判断静默失效），也不清掉原值，让用户自己改回来。
   */
  function onLimit (e: Event) {
    const raw = (e.target as HTMLInputElement).value.trim()
    if (raw === '') {
      delete rotationRef().limit
      return
    }
    const n = Number(raw)
    if (Number.isInteger(n) && n > 0) {
      rotationRef().limit = n
    }
  }

  /**
   * 枚举类策略项的写回（排序方向 / 汇总方式 / 空组处理）。
   *
   * 空值 = **删掉字段**，回落代码默认（utils/approvalRotation 的 ROTATION_DEFAULTS）——
   * 不写"和默认值一样"的字面量：那样以后改默认值时，旧卡片会被写死的值锁住。
   */
  function onEnum (key: 'order' | 'aggregate' | 'whenEmpty', e: Event) {
    const v = (e.target as HTMLSelectElement).value
    if (v === '') {
      delete rotationRef()[key]
      return
    }
    rotationRef()[key] = v as never
  }

  /**
   * 行条件的说明。卡片很窄，说明只能放 title —— 这条规则不写清楚基本没人会填。
   */
  const ROW_FILTER_HINT = [
    '先按它筛数据行，再按「组字段」分组：一行都没命中的组不会进入轮询。',
    '写数据行的列名；{:字段名} 取当前审批单的值（列名与占位符都用中文列名），例如',
    /*
     * ⚠️ 呆滞值必须是 "1" 而不是 "否"：这一列在建库时被归一化成
     *    0 = 呆滞 / 1 = 未呆滞（见 utils/productFields.ts 的 BI_VALUE_MAP），
     *    照旧示例写 "否" 会永远 0 命中。
     */
    '  主MODEL = {:主MODEL} && 是否属于呆滞库存 = "1" && 销售状态 ~ "在售"',
    '读作"与本单同主MODEL、非呆滞、在售"。配合左边的「同团队」，',
    '就是"同团队里存在这款货的其他组别"。留空则回到默认口径（同一个 SKU 的所有行）。',
  ].join('\n')

  /** 悬浮窗里的草稿：确认前不落到卡片上（取消 = 什么都不改） */
  const draftRowFilter = ref('')
  const editingFilter = ref(false)

  function openFilter () {
    draftRowFilter.value = rotationRef().rowFilter ?? ''
    editingFilter.value = true
  }

  function confirmFilter () {
    // 清空时写回 undefined：空串会让"没配"与"配了个空条件"两种状态混在一起
    const v = draftRowFilter.value.trim()
    rotationRef().rowFilter = v || undefined
    editingFilter.value = false
  }
</script>

<style scoped>
/* ===== 卡片基础：与 ApprovalNode.vue 同款（只换类型色条）===== */
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

/* 顶部类型色条：紫 = 组间轮询（审批蓝 / 条件橙 / 提醒青） */
.node-card.loop-card::before {
  content: '';
  display: block;
  height: 3px;
  background: #7c3aed;
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
  background: #f3e8ff;
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

/* ===== 轮询条件区（沿用旧轮询面板那套控件与尺寸）===== */
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

/* 「按组轮询」标记：与审批/抄送的配色区分开，一眼看出这一环会展开成 N 环 */
.role-rotate {
  background: var(--flow-amber-soft);
  color: var(--flow-amber-text);
}

/* 配置行：贴在标题下面（卡片很窄，两个输入框各占一半） */
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
  background: var(--flow-input-bg);
  border: 1px solid var(--flow-input-border);
  border-radius: 5px;
  outline: none;
}

.rotation-input::placeholder {
  color: var(--flow-text-muted);
}

/* 上限那种固定宽度的小数字框：.rotation-input 是 flex:1，这里要收窄 */
.rotation-input--tiny {
  flex: none;
  width: 34px;
  text-align: center;
}

/* 策略类下拉：与 .rotation-input 同款外观，宽度按内容给 */
.rotation-select {
  flex: none;
  width: 62px;
  height: 20px;
  padding: 0 2px;
  font-size: 10px;
  color: var(--flow-text-sub);
  background: transparent;
  border: 1px dashed var(--flow-border-strong);
  border-radius: 4px;
  outline: none;
  cursor: pointer;
}

.rotation-select:hover,
.rotation-select:focus {
  color: var(--flow-text);
  border-color: var(--flow-blue-border);
}

/*
 * 无组处理那个下拉：「无组跳过」「无组失败」是四个字，62px 会把字截掉
 * （下拉箭头还要占十几个像素）→ 单独放宽。卡片 300px，策略这一行放得下。
 */
.rotation-select--wide {
  width: 78px;
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
  background: var(--flow-input-bg);
  border: 1px dashed var(--flow-input-border);
  border-radius: 5px;
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
  align-items: center;
  flex: none;
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

/* ===== 内部流程提示 + 编辑按钮（与审批节点的 empty-hint / add-btn 同款）===== */
.empty-hint {
  padding: 3px 2px;
  font-size: 11px;
  color: var(--flow-text-muted);
}

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
  background: var(--flow-surface-hover);
  border-color: var(--flow-blue-border);
}
</style>
