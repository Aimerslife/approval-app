<template>
  <div class="team-picker">
    <v-sheet class="team-picker__list pa-1 rounded" style="max-height: 280px; overflow-y: auto;">
      <!-- 选团队（「选择接收团队」）：一行一个团队，副标题是团队负责人 -->
      <template v-if="mode === 'team'">
        <v-list-item
          v-for="t in teams"
          :key="t.name"
          class="mb-1"
          density="compact"
          rounded="lg"
          @click="pickTeam(t)"
        >
          <v-list-item-title class="text-[13px]">{{ t.name }}</v-list-item-title>

          <v-list-item-subtitle class="text-[12px]">
            团队负责人 {{ t.manager || '（未维护）' }} · {{ t.groups.length }} 个组
          </v-list-item-subtitle>
        </v-list-item>

        <div v-if="teams.length === 0" class="text-grey text-[12px] pa-4 text-center">
          团队表里没有匹配的团队
        </div>
      </template>

      <!-- 选组别（默认，「选择接收组别」）：按团队分组列组别 -->
      <template v-else>
        <template v-for="t in groups" :key="t.name">
          <!-- 限定在某个团队内时不再显示团队标题：那一栏只剩组别（业务要求"只展示组别"） -->
          <div v-if="!team" class="team-picker__parent">{{ t.name }}</div>

          <v-list-item
            v-for="g in t.groups"
            :key="g.group"
            class="mb-1"
            density="compact"
            rounded="lg"
            @click="pick(g)"
          >
            <v-list-item-title class="text-[13px]">{{ g.group }}</v-list-item-title>
            <v-list-item-subtitle class="text-[12px]">负责人 {{ g.manager || '—' }}</v-list-item-subtitle>
          </v-list-item>
        </template>

        <div v-if="groups.length === 0" class="text-grey text-[12px] pa-4 text-center">
          团队表里没有匹配的组别
        </div>
      </template>
    </v-sheet>

    <div class="team-picker__note">
      <template v-if="mode === 'team'">
        候选来自团队表（负责人取表中维护的 parentManager）
      </template>

      <template v-else-if="team">仅显示「{{ team }}」团队下的组别</template>

      <template v-else>候选来自团队表（共 {{ TEAM_GROUP_COUNT }} 个组别）</template>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import { computed, ref } from 'vue'
  // 候选口径的唯一来源：团队表 + 分组 / 按团队取组别 / 团队与团队负责人 / 搜索（纯函数，见那里的说明）
  import {
    groupsOfTeam,
    type ParentTeamRow,
    parentTeams,
    TEAM_GROUP_COUNT,
    type TeamGroupRow,
    teamGroups,
  } from '@/utils/organazation'

  const props = defineProps<{
    /**
     * 本单所属的**团队**（如 B2C）。给了就只列该团队的组别（业务口径：接收组别限于团队内）；
     * 没给（没识别出来）退回"全部团队按团队分组"，宁可多列也别让人没法办。
     * 只对 `mode="group"` 有意义 —— 选团队时本来就是在所有团队里挑。
     */
    team?: string
    /**
     * 选哪一层（两种结论各用一种）：
     *   · `group`（默认）—— 「选择接收组别」：候选是组别，`manager` 记该组组长；
     *   · `team`           —— 「选择接收团队」：候选是团队，`manager` 记团队负责人（`parentManager`）。
     */
    mode?: 'group' | 'team'
  }>()

  /**
   * 选中的接收组别：`name` = 组别名，`manager` = 该组**组长**（团队表里维护的那一列）。
   *
   * 为什么带组长而不是所属团队：接收方是"哪个组 + 找谁"，组长才是落地联系的人；
   * 团队（B2C/市场部）是上一层的分类，候选本来就是按它筛出来的，选中后再显示一遍没有信息量。
   * （`<script setup>` 里不能 export 类型，所以直接内联）
   */
  const emit = defineEmits<{ select: [{ name: string, manager?: string }] }>()

  const keyword = ref('')

  /** 选团队时的候选：团队 + 团队负责人 + 该团队下的组（搜索口径见 utils/organazation.parentTeams） */
  const teams = computed<ParentTeamRow[]>(() => parentTeams(keyword.value))

  /** 限定团队时：该团队的组别（按关键字过滤）；否则：全部团队分组 */
  const groups = computed(() => {
    const kw = keyword.value.trim().toLowerCase()
    const hit = (g: TeamGroupRow) =>
      !kw || g.group.toLowerCase().includes(kw) || g.manager.toLowerCase().includes(kw)

    if (props.team) {
      return [{ name: props.team, groups: groupsOfTeam(props.team).filter(g => hit(g)) }]
    }
    return teamGroups(keyword.value)
  })

  /** 选中某个组别：组别名 + 该组组长（团队表里没填组长时只给组名） */
  function pick (g: TeamGroupRow) {
    emit('select', { name: g.group, ...(g.manager ? { manager: g.manager } : {}) })
  }

  /** 选中某个团队：团队名 + 团队负责人（团队表里没维护负责人时只给团队名） */
  function pickTeam (t: ParentTeamRow) {
    emit('select', { name: t.name, ...(t.manager ? { manager: t.manager } : {}) })
  }
</script>

<style lang="scss" scoped>
.team-picker__parent {
  padding: 4px 8px 2px;
  font-size: 11px;
  color: var(--flow-text-muted, #8a8a8a);
}

.team-picker__note {
  padding: 4px 2px 0;
  font-size: 11px;
  color: var(--flow-text-muted, #8a8a8a);
}
</style>
