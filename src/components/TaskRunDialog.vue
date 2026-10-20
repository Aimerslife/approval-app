<template>
  <!--
    「最近任务执行状态」：最近几轮「开启任务」批量的执行结果 + 逐条原因
    （哪几行跳过了、为什么失败：已有进行中的单 / 这一行没有团队 / 模板找不到 / 流程展开失败…）。

    只提供弹窗，不带触发按钮 —— 触发点是 workStream.vue 筛选栏右侧那个 mdi-bug 图标，
    调用方式：taskRunDialog.value?.open()。

    数据来自 utils/taskRunLog（浏览器内存）：**刷新页面即清空**，普通路由切换不丢。
  -->
  <v-dialog v-model="visible" max-width="760">
    <v-card>
      <v-card-title class="d-flex align-center ga-2 text-[15px]">
        最近任务执行状态

        <v-spacer />

        <v-btn v-if="runs.length > 0" size="small" variant="text" @click="clear">清空记录</v-btn>
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-0" style="max-height: 65vh">
        <div v-if="runs.length === 0" class="pa-6 text-center text-[13px] text-medium-emphasis">
          本次会话还没有开启过任务。<br>
          点上面的「开启任务」批量建单之后，这里会逐轮记下结果与原因（每行一条）。
        </div>

        <v-expansion-panels v-else flat multiple variant="accordion">
          <v-expansion-panel v-for="run in runs" :key="run.at">
            <v-expansion-panel-title>
              <div class="d-flex align-center flex-wrap ga-2 text-[12px]">
                <span class="text-medium-emphasis">{{ formatDate(run.at) }}</span>

                <v-chip v-if="run.created" color="success" size="x-small" variant="tonal">成功 {{ run.created }}</v-chip>

                <v-chip v-if="run.skipped" color="warning" size="x-small" variant="tonal">跳过 {{ run.skipped }}</v-chip>

                <v-chip v-if="run.failed" color="error" size="x-small" variant="tonal">失败 {{ run.failed }}</v-chip>

                <v-chip v-if="run.locked" color="secondary" size="x-small" variant="tonal">已有单 {{ run.locked }}</v-chip>

                <span class="text-medium-emphasis">勾选 {{ run.picked }} 条 · 耗时 {{ elapsedOf(run) }}</span>

                <span v-if="run.aborted" class="text-warning">未执行：{{ run.aborted }}</span>

                <span v-if="run.fatal" class="text-error">中途失败：{{ run.fatal }}</span>
              </div>
            </v-expansion-panel-title>

            <v-expansion-panel-text>
              <div v-if="run.items.length === 0" class="text-[12px] text-medium-emphasis">
                这一轮没有明细（一条都没走到建单）。
              </div>

              <template v-else>
                <div v-for="(item, i) in run.items" :key="`${item.label}-${i}`" class="d-flex ga-2 py-1 text-[12px]">
                  <v-icon :color="kindColor(item.kind)" icon="mdi-circle" size="8" />

                  <span class="font-weight-medium">{{ item.label }}</span>

                  <span class="text-medium-emphasis">{{ item.detail || '' }}</span>
                </div>

                <div v-if="run.total > run.items.length" class="pt-1 text-[11px] text-medium-emphasis">
                  只列了前 {{ limits.items }} 条（这一轮共 {{ run.total }} 条）
                </div>
              </template>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 pb-3">
        <span class="text-[11px] text-medium-emphasis">
          只记本次会话最近 {{ limits.runs }} 轮（刷新页面即清空）
        </span>

        <v-spacer />

        <v-btn variant="text" @click="visible = false">关闭</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" setup>
  import { ref } from 'vue'
  import { clearTaskRuns, readTaskRuns, type TaskRunEntry, type TaskRunItemKind } from '@/utils/taskRunLog'
  import { formatDate } from '@/utils/utils'

  const visible = ref(false)
  /** 打开时读一份快照：期间可能又开了几批任务，不能只在挂载时读一次 */
  const runs = ref<TaskRunEntry[]>([])
  const limits = ref({ runs: 20, items: 200 })

  function openDialog () {
    const snapshot = readTaskRuns()
    runs.value = snapshot.items
    limits.value = snapshot.limits
    visible.value = true
  }

  function clear () {
    clearTaskRuns()
    runs.value = []
  }

  /** 耗时：不到 1 秒按毫秒显示 —— "这批只建 1 条却花了 8 秒"要能一眼看出来 */
  function elapsedOf (run: TaskRunEntry): string {
    return run.ms < 1000 ? `${run.ms}ms` : `${(run.ms / 1000).toFixed(1)}s`
  }

  function kindColor (kind: TaskRunItemKind): string {
    if (kind === 'created') {
      return 'success'
    }
    return kind === 'failed' ? 'error' : 'warning'
  }

  defineExpose({ open: openDialog })
</script>
