<template>
  <!--
    订单号旁的「来源情况」标识：审批单最初的业务办理是不是在同一个团队（部门）内。
    scope 为 null（识别不出团队信息）/ 无查看权 → 整个不渲染，调用方不用再写条件。
  -->
  <v-chip
    v-if="visible && scope"
    class="flow-scope-chip"
    :color="scope === 'internal' ? 'teal' : 'orange'"
    :title="tip"
    label
    size="x-small"
    variant="tonal"
  >
    {{ scope === 'internal' ? '内部流转' : '外部流转' }}
  </v-chip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
// 可见范围（口径收紧 2026-11-16）：只有团队表（角色设置 → 人员配置，data/people.json）
// 里登记过的人 —— 即业务相关人员 —— 才能看到；其他人员（含不在表里的管理员）一律不显示
import { isMaintainedMember } from '@/utils/organazation'
import { useUserStore } from '@/stores/user'
import type { FlowScope } from '@/utils/approvalRuntime'

const props = defineProps<{ scope?: FlowScope | null }>()

const userStore = useUserStore()
const visible = computed(() => isMaintainedMember(userStore.user?.name))

const tip = computed(() =>
  props.scope === 'internal'
    ? '内部流转：整条办理流程都在同一部门内进行'
    : '外部流转：办理流程中出现过跨部门流转',
)
</script>

<style scoped>
/* 跟在单号后面的小标识：不被 flex 拉伸/挤压，字号贴表格正文 */
.flow-scope-chip {
  flex: none;
  font-size: 10px;
}
</style>
