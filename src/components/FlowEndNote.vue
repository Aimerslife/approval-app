<template>
  <!--
    时间线**最后**那一条：流转为什么停下（见 types/approval 的 FlowEndInfo）。
    「若流转中止，在流转的最后添加该流转结束的依据信息」—— 链路突然就没了的时候，
    只看节点看不出是"办完了""走了某条线到结束"还是"卡住了"，这条把它说清楚。
    进行中的单（end 为空）什么都不渲染。
  -->
  <v-timeline-item v-if="end" class="mb-2" :dot-color="meta.color" size="small">
    <template #icon>
      <v-icon color="white" size="13">{{ meta.icon }}</v-icon>
    </template>

    <div class="d-flex align-center flex-wrap gap-2">
      <v-chip :color="meta.color" label size="x-small" variant="flat">
        <span class="text-[9px]">{{ meta.chip }}</span>
      </v-chip>

      <span class="text-[12px]">{{ end.reason }}</span>
    </div>

    <!--
      具体事实：最后是谁、办的什么结论、什么时候 —— 回答"**凭什么**说它结束了"。
      `reason` 说的是怎么停的（命中哪类结论 / 哪条线），这行补上可核对的事实。
    -->
    <div v-if="factsLine" class="mt-1 text-[11px]">
      <span class="text-medium-emphasis">依据：{{ factsLine }}</span>
    </div>

    <div v-if="end.detail" class="mt-1 text-[11px] text-medium-emphasis">
      {{ end.detail }}
    </div>
  </v-timeline-item>
</template>

<script lang="ts" setup>
  import type { FlowEndInfo } from '@/types/approval'
  import { formatDate } from '@/utils/utils'

  const props = defineProps<{
    /** 结束依据（runtimeOf / rebuildChain 的 end）；进行中的单传 undefined */
    end?: FlowEndInfo | null
  }>()

  /**
   * 依据的展示形态：**卡住**（异常，要人查模板）与正常结束分开配色 ——
   * 正常结束是既定结果（灰蓝 + 终点旗），卡住是要处理的异常（琥珀 + 警示）。
   */
  const meta = computed(() => (props.end?.kind === 'stuck'
    ? { chip: '流转中止', color: '#b45309', icon: 'mdi-alert-circle-outline' }
    : { chip: '流转结束', color: '#64748b', icon: 'mdi-flag-checkered' }))

  /** 「具体事实」一行：结论 · 谁办理 · 什么时候（有哪项显示哪项，都没有就不占行） */
  const factsLine = computed(() => {
    const f = props.end?.facts
    if (!f) {
      return ''
    }
    return [
      f.resultLabel ? `最后结论「${f.resultLabel}」` : '',
      f.byName ? `由 ${f.byName} 办理` : '',
      f.at ? formatDate(f.at) : '',
    ].filter(Boolean).join(' · ')
  })
</script>
