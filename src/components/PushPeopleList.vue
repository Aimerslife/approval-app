<template>
  <!--
    「提醒设置」里推送人员 / 白名单共用的一份人员清单：头像 + 姓名 + 部门/邮箱 + 移除。
    抽成组件的原因：两处的视觉与交互**必须一致**（同一份数据长两张脸，用户会以为哪个是另一个东西），
    而头像缺失（手工加的、老数据）时的兜底口径也只该写一遍。
  -->
  <div v-if="people.length === 0" class="empty-box px-3 py-3 text-[12px] text-medium-emphasis">
    {{ empty }}
  </div>

  <div v-else class="people-box">
    <div
      v-for="p in people"
      :key="personKeyOf(p)"
      class="people-row d-flex align-center ga-3 px-3 py-2"
    >
      <v-avatar color="primary" size="28" variant="tonal">
        <v-img v-if="p.avatar" :alt="p.name" :src="p.avatar" />
        <span v-else class="text-[12px] font-weight-semibold">{{ p.name.slice(0, 1) }}</span>
      </v-avatar>

      <div class="d-flex flex-column">
        <span class="text-[13px] font-semibold">{{ p.name }}</span>
        <span class="text-[11px] text-medium-emphasis">
          {{ p.department_path || p.department || '—' }}
          <template v-if="p.email"> · {{ p.email }}</template>
        </span>
      </div>

      <v-spacer />

      <v-icon-btn icon="mdi-close" size="small" title="移除" variant="text" @click="emit('remove', p)" />
    </div>
  </div>
</template>

<script lang="ts" setup>
  import { personKeyOf, type PushPerson } from '@/utils/pushRules'

  withDefaults(defineProps<{
    people: PushPerson[]
    /** 列表为空时显示的一句话（两种清单的"空"含义不同，所以由调用方给） */
    empty?: string
  }>(), {
    empty: '暂无人员',
  })

  const emit = defineEmits<{ (e: 'remove', person: PushPerson): void }>()
</script>

<style scoped>
/* 虚线空态：一眼看出"这里可以加人"，而不是以为没渲染出来 */
.empty-box {
    border: 1px dashed rgba(28, 40, 72, 0.2);
    border-radius: 10px;
}

.v-theme--dark .empty-box {
    border-color: rgba(255, 255, 255, 0.16);
}

.people-box {
    border: 1px solid rgba(127, 140, 170, 0.24);
    border-radius: 10px;
}

.v-theme--dark .people-box {
    border-color: rgba(255, 255, 255, 0.12);
}

/* 一行一条：用分隔线而不是每条一个边框，列表看起来才是一份清单而不是一堆卡片 */
.people-row + .people-row {
    border-top: 1px solid rgba(127, 140, 170, 0.16);
}

.v-theme--dark .people-row + .people-row {
    border-top-color: rgba(255, 255, 255, 0.08);
}
</style>
