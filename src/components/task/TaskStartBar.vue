<template>
  <!--
    「已选 N 条 / 开启任务 / 执行记录」这一组按钮。

    逻辑全在 composables/useTaskStarter 里，这里只负责排版与弹窗 ——
    数据页（pages/workStream）与数据管理页（pages/setDatas）用的是同一个组件，
    所以两处的按钮文案、进度、记录弹窗不可能长得不一样。
  -->
  <div class="task-start-bar d-flex align-center ga-2">
    <span v-if="selectedCount > 0" class="text-[12px] text-medium-emphasis">已选 {{ selectedCount }} 条</span>

    <v-btn
      color="#0052D9"
      :loading="starting"
      prepend-icon="mdi-flash"
      size="small"
      variant="flat"
      @click="starter.startTasks()"
    >
      <span class="mb-1">{{ starting ? batchText : '开启任务' }}</span>
    </v-btn>

    <v-icon-btn icon="mdi-bug" size="30" title="任务执行记录" @click="openRuns()" />

    <v-dialog v-model="runsOpen" max-width="760" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center ga-3 text-[15px]">
          <span>任务执行记录</span>
          <v-chip label size="x-small" variant="tonal">本机最近 {{ runs.length }} 次</v-chip>
          <v-spacer />
          <v-btn :disabled="runs.length === 0" size="small" variant="text" @click="starter.clearRuns()">清空</v-btn>
          <v-btn color="#0052D9" size="small" variant="flat" @click="runsOpen = false">关闭</v-btn>
        </v-card-title>

        <v-divider />

        <v-card-text class="pa-0">
          <div v-if="runs.length === 0" class="text-[13px] text-medium-emphasis text-center py-8">
            还没有执行记录。勾选数据后点「开启任务」，每一行的结果都会记在这里<br>
            （只存本机，最多保留最近 {{ starter.MAX_RUNS }} 次）
          </div>
          <!-- 直接平铺：记录是给人"扫一眼失败原因"的，藏在折叠里反而要多点一次 -->
          <template v-else>
            <div v-for="run in runs" :key="run.id" class="run-block">
              <div class="d-flex align-center ga-2 flex-wrap px-4 py-2">
                <span class="text-[13px] font-weight-medium">{{ starter.runTimeText(run.at) }}</span>
                <v-chip color="success" label size="x-small" variant="tonal">成功 {{ run.created }}</v-chip>

                <v-chip
                  v-if="run.skipped"
                  color="warning"
                  label
                  size="x-small"
                  variant="tonal"
                >跳过
                  {{ run.skipped }}</v-chip>

                <v-chip
                  v-if="run.failed"
                  color="error"
                  label
                  size="x-small"
                  variant="tonal"
                >失败
                  {{ run.failed }}</v-chip>

                <v-chip
                  v-if="run.locked"
                  color="info"
                  label
                  size="x-small"
                  variant="tonal"
                >已有单
                  {{ run.locked }}</v-chip>

                <span class="text-[12px] text-medium-emphasis">处理 {{ run.total }} 条</span>
              </div>

              <div class="px-4 pb-2">
                <div v-for="(r, i) in run.results" :key="i" class="d-flex align-start ga-2 py-1 text-[12px]">
                  <v-chip
                    class="flex-shrink-0"
                    :color="starter.runKindColor(r.kind)"
                    label
                    size="x-small"
                    variant="flat"
                  >
                    {{ starter.RUN_KIND_LABEL[r.kind] }}
                  </v-chip>

                  <span class="font-weight-medium flex-shrink-0">{{ r.label }}</span>
                  <span class="text-medium-emphasis">{{ r.detail || '—' }}</span>
                </div>

                <div v-if="run.results.length === 0" class="text-[12px] text-medium-emphasis py-1">
                  没有进入处理的行（选中的都已有单）
                </div>

                <div v-if="run.dropped" class="text-[12px] text-medium-emphasis pt-1">
                  另有 {{ run.dropped }} 行明细未记录（单次最多保存 {{ starter.MAX_RUN_RESULTS }} 行）
                </div>
              </div>
            </div>
          </template>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
  import type { TaskStarter } from '@/composables/useTaskStarter'

  const props = defineProps<{
    /** useTaskStarter 的返回值（页面各自建实例，各用各的勾选与记录） */
    starter: TaskStarter
  }>()

  /*
   * 模板只对**顶层** ref 自动解包，而 starter 里的 ref 是嵌套在普通对象上的 ——
   * 直接写 `starter.starting` 拿到的是 ref 对象本身（永远是 truthy），必须用 computed 转一层。
   */
  const selectedCount = computed(() => props.starter.selectedIds.value.length)
  const starting = computed(() => props.starter.starting.value)
  const batchText = computed(() => props.starter.batchText.value)
  const runs = computed(() => props.starter.runs.value)

  // 弹窗开合是纯界面状态，留在组件里（composable 只负责读记录）
  const runsOpen = ref(false)

  function openRuns () {
    props.starter.openRuns()
    runsOpen.value = true
  }
</script>

<style scoped lang="scss">
/* —— 任务执行记录（平铺，靠分隔线分组）—— */
.run-block+.run-block {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
</style>
