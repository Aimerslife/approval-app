<template>
  <!--
    「组间轮询」里各团队已接多少 —— 办理面板、审批详情、时间线共用这一份展示口径。

    没有轮询环（或都还没办）时 items 为空，整行不渲染（不留空白条）。
    数据由调用方用 `rotationReceiptsOf(chain)` 算好传入：它是纯函数，
    在谁那里算取决于谁手里有整条链路（表单只拿到当前环节的成员）。
  -->
  <div v-if="items.length > 0" class="rotation-receipts text-[11px] text-medium-emphasis">
    <span>{{ label }}</span>
    <span v-for="r in items" :key="r.group" :title="titleOf(r)">
      {{ r.group }} <b>{{ qtyTextOf(r) }}</b>
    </span>
  </div>
</template>

<script lang="ts" setup>
  import type { RotationReceipt } from '@/utils/approvalRuntime'

  const props = withDefaults(defineProps<{
    items: RotationReceipt[]
    /** 行首文案（办理时是"前面团队接收"，只读详情用"轮询接收情况"） */
    label?: string
  }>(), {
    label: '前面团队接收',
  })

  /**
   * 某一项的展示值：
   *   · 填了数量 → 「120 件」（这一组接了多少，是审批人真正要看的数）；
   *   · 没填数量（「不接收」这类结论）→ 结论文案 —— 不能显示成 0 件，那是"接了 0 件"，语义不同。
   */
  function qtyTextOf (r: RotationReceipt) {
    return r.qty !== undefined ? `${r.qty} 件` : r.resultLabel
  }

  /** 悬浮说明：谁、什么时候办的（时间线/详情里"为什么是这个数"要能追） */
  function titleOf (r: RotationReceipt) {
    const parts = [r.group, r.resultLabel]
    if (r.byName) {
      parts.push(r.byName)
    }
    if (r.at) {
      parts.push(r.at.replace('T', ' ').slice(0, 16))
    }
    return parts.join(' · ')
  }
</script>

<style scoped>
  /*
   * 一条浅色摘要行（与办理表单开头的「总件数 / 已接收」同款）：
   * 它不是输入项，用底色与周围内容区分；数值加粗一档，扫一眼就能读到。
   * 底色用 on-surface 的低透明度，跟着深浅色主题走，不写死灰。
   */
  .rotation-receipts {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 16px;
    padding: 6px 10px;
    border-radius: 8px;
    background: rgba(var(--v-theme-on-surface), 0.04);
  }

  .rotation-receipts b {
    font-size: 12px;
    font-weight: 600;
    color: rgba(var(--v-theme-on-surface), 0.87);
  }
</style>
