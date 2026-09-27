<template>
  <div class="flow-mini-map">
    <!-- 1) 主线（默认/主线）成员链：紧凑横向 -->
    <div v-if="hasFlow && mainTrack.length > 0" class="fmm-main">
      <template v-for="(s, i) in shownMainTrack" :key="s.id + '-' + i">
        <span v-if="i > 0" class="fmm-arrow">→</span>

        <div class="fmm-step" :title="(s.name || s.id) + ' · ' + (s.members.length + '人')">
          <div v-if="s.name" class="fmm-step-name">{{ truncate(s.name, 10) }}</div>

          <div class="fmm-members">
            <v-avatar v-for="(m, mi) in s.members.slice(0, 3)" :key="mi" class="fmm-avatar" size="20">
              <v-img v-if="m.avatar" cover :src="m.avatar" />
              <v-icon v-else size="14">mdi-account</v-icon>
            </v-avatar>

            <span v-if="s.members.length > 3" class="fmm-more">+{{ s.members.length - 3 }}</span>
            <span v-else-if="s.members.length === 0" class="fmm-empty">—</span>
          </div>
        </div>
      </template>

      <span v-if="mainTrack.length > maxMain" class="fmm-more-steps">…+{{ mainTrack.length - maxMain }} 环节</span>
    </div>

    <!-- 2) 无 flow 时退化到线性 chain（兼容老模板） -->
    <div v-if="!hasFlow && linearChain.length > 0" class="fmm-main fmm-linear">
      <template v-for="(members, i) in shownLinear" :key="i">
        <span v-if="i > 0" class="fmm-arrow">→</span>

        <div class="fmm-step">
          <div class="fmm-members">
            <v-avatar v-for="(m, mi) in members.slice(0, 3)" :key="mi" class="fmm-avatar" size="20">
              <v-img v-if="m.avatar" cover :src="m.avatar" />
              <v-icon v-else size="14">mdi-account</v-icon>
            </v-avatar>

            <span v-if="members.length > 3" class="fmm-more">+{{ members.length - 3 }}</span>
          </div>
        </div>
      </template>

      <span v-if="linearChain.length > maxMain" class="fmm-more-steps">…+{{ linearChain.length - maxMain }} 环节</span>
    </div>

    <!-- 完全空数据 -->
    <div v-if="!hasFlow && linearChain.length === 0" class="fmm-empty-block">（空流程）</div>
  </div>
</template>

<script lang="ts" setup>
  import type { ApprovalChain, ApprovalChainItem, ApprovalFlow, ApprovalFlowStep } from '@/types/approval'
  /**
   * 紧凑版流程概览：用于审批模板列表的单元格，只展示主分支（默认/主线）
   * 走向的成员链。flow 缺失时退化到线性 chain（兼容老模板）。
   */
  import { computed } from 'vue'

  const props = withDefaults(
    defineProps<{
      flow?: ApprovalFlow | null
      chain?: ApprovalChain | null
      /** 主线最多展示的环节数（超出显示「…+N 环节」） */
      maxMain?: number
    }>(),
    { flow: null, chain: null, maxMain: 8 },
  )

  function truncate (s: string, n: number) {
    return s.length > n ? s.slice(0, n) + '…' : s
  }

  const hasFlow = computed(() => !!props.flow && props.flow.length > 0)

  // ===== 主线（默认/无条件）成员链：保留 name + members =====
  const mainTrack = computed(() => {
    const out: { id: string, name?: string, members: ApprovalChainItem[] }[] = []
    if (!props.flow) return out
    function walkStep (s: ApprovalFlowStep) {
      if (s.type === 'branch' && s.branches?.length) {
        const def = s.branches.find(b => !b.conditions?.length && !b.condition) ?? s.branches[0]
        if (def) walkBranch(def)
        return
      }
      if (s.name || (s.members && s.members.length > 0)) {
        out.push({ id: s.id, name: s.name, members: s.members || [] })
      }
      for (const sub of s.steps || []) walkStep(sub)
    }
    function walkBranch (b: { members?: ApprovalChainItem[], name?: string, id: string, steps: ApprovalFlowStep[] }) {
      if (b.members?.length) out.push({ id: b.id + ':b', name: b.name, members: b.members })
      for (const s of b.steps) walkStep(s)
    }
    for (const n of props.flow) {
      if (n.type === 'approval') {
        out.push({ id: n.id, name: undefined, members: n.nodes })
        continue
      }
      // 飞书提醒环：主线里也要出现 —— 它是流程的一环，只是不办理（members 即提醒对象）
      if (n.type === 'notify') {
        out.push({ id: n.id, name: n.name, members: n.members })
        continue
      }
      const def = n.branches.find(b => !b.conditions?.length && !b.condition) ?? n.branches[0]
      if (def) walkBranch(def)
    }
    return out
  })
  const shownMainTrack = computed(() => mainTrack.value.slice(0, props.maxMain))

  const linearChain = computed(() => (props.chain || []).filter(s => s.length))
  const shownLinear = computed(() => linearChain.value.slice(0, props.maxMain))
</script>

<style lang="scss" scoped>
.flow-mini-map {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
}

/* —— 主线：横向滚动，不换行以控高 —— */
.fmm-main {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 1px 0;
}
.fmm-linear {
    opacity: 0.92;
}
.fmm-step {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 3px 6px;
    /* 品牌蓝的深浅由主题给（rgb(var(--v-theme-primary)) 是 R G B 三元组，可直接带透明度） */
    border: 1px solid rgb(var(--v-theme-primary) / 25%);
    border-radius: 6px;
    background: rgb(var(--v-theme-primary) / 4%);
    flex-shrink: 0;
}
.fmm-step-name {
    font-size: 11px;
    color: rgb(var(--v-theme-primary));
    line-height: 1.1;
    margin-bottom: 2px;
    max-width: 90px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.fmm-members {
    display: inline-flex;
    align-items: center;
    gap: 2px;
}
.fmm-avatar {
    /* 头像外圈要跟"头像后面那层背景"一致，用主题的 surface 才不会在深色下露白边 */
    border: 1px solid rgb(var(--v-theme-surface));
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.04);
}
.fmm-more {
    font-size: 11px;
    color: var(--flow-text-sub);
    margin-left: 2px;
}
.fmm-empty {
    font-size: 11px;
    color: var(--flow-text-muted);
}
.fmm-more-steps {
    font-size: 11px;
    color: var(--flow-text-sub);
    margin-left: 2px;
    white-space: nowrap;
}
.fmm-arrow {
    color: var(--flow-text-muted);
    font-size: 12px;
    flex-shrink: 0;
}

.fmm-empty-block {
    font-size: 12px;
    color: var(--flow-text-muted);
}
</style>
