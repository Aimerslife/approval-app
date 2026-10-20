<template>
  <div class="team-picker">
    <v-sheet class="team-picker__list pa-1 rounded" style="max-height: 280px; overflow-y: auto;">
      <!-- 选部门（`mode="team"`，「选择接收部门」）：一行一个部门，副标题是部门负责人（parentManager） -->
      <template v-if="mode === 'team'">
        <v-list-item
          v-for="t in teams"
          :key="t.name"
          class="mb-1"
          density="compact"
          rounded="lg"
          @click="pickDept(t)"
        >
          <v-list-item-title class="text-[13px]">{{ t.name }}</v-list-item-title>

          <v-list-item-subtitle class="text-[12px]">
            部门负责人 {{ t.manager || '（未维护）' }} · {{ t.groups.length }} 个团队
          </v-list-item-subtitle>
        </v-list-item>

        <div v-if="teams.length === 0" class="text-grey text-[12px] pa-4 text-center">
          团队表里没有匹配的部门
        </div>
      </template>

      <!-- 选团队（默认）：按部门分组列团队（团队表里 group = 团队、parent = 部门） -->
      <template v-else>
        <template v-for="t in groups" :key="t.name">
          <!-- 限定在某个部门内时不再显示部门标题：那一栏只剩团队 -->
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
          团队表里没有匹配的团队
        </div>
      </template>
    </v-sheet>

    <div class="team-picker__note">
      <template v-if="mode === 'team'">
        候选来自团队表（部门 = parent，负责人取 parentManager）
      </template>

      <template v-else-if="team">仅显示「{{ team }}」部门下的团队</template>

      <template v-else>候选来自团队表（共 {{ TEAM_GROUP_COUNT }} 个团队）</template>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import { computed, ref } from 'vue'
  // 候选口径的唯一来源：团队表 + 按部门分组列团队 / 按部门取团队 / 部门与部门负责人 / 搜索（纯函数，见那里的说明）
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
     * 本单所属的**部门**（如 B2C，由数据行的团队名反查 `parent` 得到，见 utils/approvalFlow.receiverTeamOf）。
     * 给了就只列该部门下的团队（业务口径：接收团队限于本部门内）；
     * 没给（没识别出来）退回"全部部门分组"，宁可多列也别让人没法办。
     * 只对 `mode="group"` 有意义 —— `mode="team"` 本来就是在所有团队里挑。
     */
    team?: string
    /**
     * 选哪一层（两种结论各用一种）：
     *   · `group`（默认）—— 「选择接收团队」：候选是**团队**（`groupManage.group`，如 多站点组 / 美1组），
     *     按 `parent`（部门）分组展示，`manager` 记该团队负责人；
     *   · `team`           —— 「选择接收部门」：候选是**部门**（`groupManage.parent`，如 B2C / 市场部），
     *     一行一个，`manager` 记部门负责人（`parentManager`）。
     *
     * 口径：团队 = `groupManage.group`，部门 = `groupManage.parent`（见 utils/approvalRoles 的说明）。
     * ⚠️ `mode` 的值是历史命名（`team` 现在选的是部门），不能改 —— 模板里存的是这两个字符串。
     */
    mode?: 'group' | 'team'
  }>()

  /**
   * 选中的接收方：`name` = 团队名（`group`）或部门名（`parent`），`manager` = 对应的负责人。
   *
   * 为什么带负责人：接收方是"交给谁 + 找谁"，负责人才是落地联系的人。
   * （`<script setup>` 里不能 export 类型，所以直接内联）
   */
  const emit = defineEmits<{ select: [{ name: string, manager?: string }] }>()

  const keyword = ref('')

  /**
   * 选部门（`mode="team"`）的候选：团队表里按 `parent` 去重后的部门 + 部门负责人，
   * 搜索也能按下属团队名命中（口径见 utils/organazation.parentTeams）。
   */
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

  /** 选中一个团队：团队名 + 该团队负责人（没填负责人时只给团队名） */
  function pick (t: TeamGroupRow) {
    emit('select', { name: t.group, ...(t.manager ? { manager: t.manager } : {}) })
  }

  /** 选中一个部门：部门名 + 部门负责人（`parentManager` 没维护时只给部门名） */
  function pickDept (t: ParentTeamRow) {
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
