<template>
  <div class="flow-mini-map">
    <!-- 1) 主线（默认/主线）成员链：紧凑横向 -->
    <div v-if="hasFlow && mainTrack.length > 0" class="fmm-main">
      <template v-for="(s, i) in shownMainTrack" :key="s.id + '-' + i">
        <span v-if="i > 0" class="fmm-arrow">→</span>

        <div class="fmm-step" :title="(s.name || s.fallback || s.id) + ' · ' + (s.members.length + '人')">
          <!--
            名字**必须有兜底**：审批节点没起名是常态（画布上直接用默认卡片），
            而这里的 `v-if="s.name"` 会让整列只剩头像。
            实测反馈「轮询后模板流程列一片空白」——她那张模板的审批环节全都没名字，
            加上分支又都带条件（走 branches[0]），主线上一个文字都没有。
          -->
          <div class="fmm-step-name">{{ truncate(s.name || s.fallback || '审批', 10) }}</div>

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
  /**
   * 概览要走哪些分支：
   *
   *  - **默认只走主线**（无条件那条，退到 branches[0]）—— 与 flowToChain 同一口径，
   *    列表里看到的就是"这张模板大致的顺序"；
   *  - 但**主线太短时**（≤2 环节，典型是"审批 → 条件分支"就没了下文，比如轮询模板：
   *    顶层审批之后全在条件分支里）按主线看就是一片空白/一个「审批」，等于没渲染。
   *    这时改成**遍历所有分支**收集环节轮廓（按 id 去重、限 maxMain 个）。
   */
  /** 主线环节数不超过它时改走"遍历所有分支"的兜底（2 = 只有审批 + 一两个环节，看不清轮廓） */
  const ALL_BRANCHES_WHEN_SHORT = 2

  const mainTrack = computed(() => {
    const collect = (allBranches: boolean) => {
      const out: { id: string, name?: string, fallback?: string, members: ApprovalChainItem[] }[] = []
      if (!props.flow) return out
      const seen = new Set<string>()
      const push = (item: { id: string, name?: string, fallback?: string, members: ApprovalChainItem[] }) => {
        if (seen.has(item.id)) return
        seen.add(item.id)
        out.push(item)
      }
      function walkStep (s: ApprovalFlowStep) {
        /*
         * 只有「分支组」不是环节，其余类型都要作为一步出现；
         * 但**带 branches 的不止分支组** —— 「数据查询」也有两条出边（存在 / 不存在），
         * 轮询卡片常常正挂在它的分支下面。早先只对 type==='branch' 递归 branches，
         * 那些卡片就永远轮不到（实测：轮询模板的概览停在「数据查询2」，后面全看不见）。
         */
        const isGroup = s.type === 'branch'
        if (!isGroup) {
          push({
            id: s.id,
            name: s.name,
            fallback: s.type === 'notify' ? '提醒' : '审批',
            members: s.members || [],
          })
        }
        if (s.branches?.length) {
          const def = s.branches.find(b => !b.conditions?.length && !b.condition) ?? s.branches[0]
          const list = allBranches ? s.branches : (def ? [def] : [])
          for (const b of list) walkBranch(b)
        }
        for (const sub of s.steps || []) walkStep(sub)
      }
      function walkBranch (b: { members?: ApprovalChainItem[], name?: string, id: string, steps: ApprovalFlowStep[] }) {
        if (b.members?.length) push({ id: b.id + ':b', name: b.name, fallback: '分支', members: b.members })
        for (const s of b.steps) walkStep(s)
      }
      for (const n of props.flow) {
        if (n.type === 'approval') {
          /*
           * 审批节点**带上它自己的名字**（原来写死 undefined，无名环节就只剩一个头像）。
           * 轮询卡片内部的环节、用户没起名的环节都靠 fallback 兜底显示「审批」。
           */
          push({ id: n.id, name: n.name, fallback: '审批', members: n.nodes })
          continue
        }
        // 飞书提醒环：主线里也要出现 —— 它是流程的一环，只是不办理（members 即提醒对象）
        if (n.type === 'notify') {
          push({ id: n.id, name: n.name, fallback: '提醒', members: n.members })
          continue
        }
        // 「组间轮询」卡片：展开它内部的子流程（与 flowToChain 同一口径）；
        // 卡片自己的名字也占一项，列表里才看得出"这里有一张轮询卡片"
        if (n.type === 'loop') {
          push({ id: n.id, name: n.name, fallback: '轮询', members: [] })
          for (const s of n.steps) walkStep(s)
          continue
        }
        /*
         * 「引用模板」：被引用的那段流程**不在本图里**（内容只有一份，在源模板里），
         * 所以这条小地图上看不到它的环节 —— 与轮询卡片"按组展开前"同一个态度。
         * 建单后的单据快照里它已经被展开成普通环节，那时看单据的流程图是完整的。
         */
        if (n.type === 'ref') {
          continue
        }
        const def = n.branches.find(b => !b.conditions?.length && !b.condition) ?? n.branches[0]
        const list = allBranches ? n.branches : (def ? [def] : [])
        for (const b of list) walkBranch(b)
      }
      return out
    }
    // 先按主线收集；太少（或一条都没有）再走"遍历所有分支"的兜底
    const main = collect(false)
    return main.length > ALL_BRANCHES_WHEN_SHORT ? main : collect(true)
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
