<template>
  <v-dialog max-width="720" :model-value="open" scrollable @update:model-value="onToggle">
    <!-- @keydown.stop：免得在弹出框里打字触发画布那套快捷键（与 ProbeNode / LoopCardNode 的悬浮窗同一口径） -->
    <v-card rounded="lg" @keydown.stop>
      <v-card-title class="d-flex align-center ga-2 py-3 text-[15px]">
        <v-icon color="#2563eb" size="18">mdi-format-list-bulleted-type</v-icon>
        <span>办理选项配置</span>
        <span class="opt-dlg__summary">{{ summary }}</span>

        <v-spacer />

        <v-btn icon="mdi-close" size="small" title="关闭" variant="text" @click="emit('close')" />
      </v-card-title>

      <v-divider />

      <v-card-text class="pt-1 pb-1">
        <p class="opt-dlg__hint">
          配的是**本审批环节共用的一份**（存在审批节点上）：本环节各条结果分支点开看到的都是它，
          办理时该环节也只呈现这一棵树 —— 每个一级的「实际链路」决定走哪条线，不再先选"处理方式"。
          一级按「类别」分组展示；二级一行一项，也可以用逗号（，）在一个框里写多项，失焦后自动拆成多行。
        </p>

        <EdgeOptionTreeEditor
          :link-options="linkOptions"
          :model-value="modelValue"
          @update:model-value="emit('update:model-value', $event)"
        />
      </v-card-text>

      <v-divider />

      <v-card-actions>
        <v-spacer />
        <v-btn color="#0052D9" size="small" variant="flat" @click="emit('close')">完成</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import type { ApprovalOptionGroup } from '@/types/approval'
  import EdgeOptionTreeEditor from '@/components/flow/EdgeOptionTreeEditor.vue'

  /**
   * 「办理下拉选项」的**弹出框**外壳（主画布与卡片内部画布共用，别在两处各写一份）。
   *
   * 为什么从连线面板搬进弹出框：选项树是「类别 → 一级 → 二级」三层结构，
   * 铺在面板里会一路往下撑 —— 而配选项是"偶尔配一次"的事，不该常驻占着面板高度。
   * 面板上只留一个「配置选项」按钮当入口（见 createStream / LoopCardCanvas）。
   *
   * 数据流沿用编辑器那套：受控 —— 只读 `modelValue`，改动 emit 一份**新的**数组回去，
   * 由父组件决定写库/删字段。开关单独走 `:open` + `@close`，不跟数据抢 `model-value`。
   */
  const props = defineProps<{
    /** 开关（`:open` + `@close`，见上） */
    open: boolean
    /** 当前的选项树（不存在时父组件给空数组） */
    modelValue: ApprovalOptionGroup[]
    /** 「实际链路」候选：本节点各条出线（value = 结论码，label = 分支名/结论文案） */
    linkOptions: Array<{ value: string, label: string }>
  }>()

  const emit = defineEmits<{
    (e: 'close'): void
    (e: 'update:model-value', value: ApprovalOptionGroup[]): void
  }>()

  /**
   * 关之前先把焦点移开。
   *
   * 编辑器是"输入期间只动 DOM、`change`（失焦）时才 emit"的 —— 直接关会把"刚打完还没失焦"
   * 的那一下丢掉。`blur()` 会**同步**触发 `change`，所以这里先 blur 再关，那一下跑不掉。
   */
  function onToggle (value: boolean) {
    if (!value) {
      (document.activeElement as HTMLElement | null)?.blur()
      emit('close')
    }
  }

  /** 标题右侧的概览：不打开也知道配没配、配了多少 */
  const summary = computed(() => {
    const groups = props.modelValue ?? []
    if (groups.length === 0) {
      return '还没配 —— 不配就用分支名当选项'
    }
    const items = groups.reduce((n, g) => n + (g.items?.length ?? 0), 0)
    const children = groups.reduce(
      (n, g) => n + (g.items ?? []).reduce((m, it) => m + (it.children ?? []).filter(c => c.trim()).length, 0),
      0,
    )
    return `${groups.length} 个类别 / ${items} 个一级${children > 0 ? ` / ${children} 个二级` : ''}`
  })
</script>

<style scoped>
.opt-dlg__summary {
  color: #6b7280;
  font-size: 12px;
}

.opt-dlg__hint {
  margin-bottom: 10px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.6;
}
</style>
