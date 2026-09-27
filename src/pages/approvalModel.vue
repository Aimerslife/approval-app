<template>
  <v-container class="h-[calc(100vh-32px)] bg-app" fluid>
    <v-sheet class=" border-dashed border-accent p-5" rounded>
      <div class="d-flex align-center justify-space-between">
        <div class="block-title">审批模板</div>

        <v-btn
          class="me-2 text-none"
          color="primary"
          prepend-icon="mdi-plus"
          variant="flat"
          @click="createStream"
        >新模板</v-btn>
      </div>

      <v-divider class="mt-3" />

      <v-data-table
        class="text-body-small model-table"
        density="compact"
        :headers="headers"
        hide-default-footer
        hover
        item-value="name"
        :items="chians"
      >
        <template #item="{ item }">
          <tr class="text-no-wrap">
            <td>{{ item.name }}</td>

            <td>
              <strong :class="item.status == 0 ? 'text-error' : 'text-success'">{{ item.status == 0 ?'未启用' : '启用' }}</strong>
            </td>

            <td style="min-width: 360px">
              <!-- 表格里展示紧凑版流程概览（主线成员 + 分支组/条件/嵌套/loopBackTo）；点「查看」再看完整流程图 -->
              <div class="d-flex align-center" style="gap: 6px">
                <v-icon-btn
                  icon="mdi-chart-sankey-variant"
                  size="24"
                  title="查看流程图"
                  variant="plain"
                  @click="openPreview(item)"
                >
                  <v-icon color="#1055C9" size="16" />
                </v-icon-btn>

                <FlowMiniMap
                  :chain="item.chain.chain"
                  :flow="item.chain.flow"
                  style="flex: 1; min-width: 0"
                />
              </div>
            </td>

            <td>
              <span class="text-grey">{{ formatDate(item.created) }}</span>
            </td>

            <td class="text-start">
              <v-icon-btn icon="mdi-pencil" size="24" variant="plain" @click="goEdit(item.id)">
                <v-icon size="16" />
              </v-icon-btn>

              <v-icon-btn
                icon="mdi-delete-outline"
                size="24"
                variant="plain"
                @click="removeParten(item.id)"
              >
                <v-icon size="16" />
              </v-icon-btn>

              <v-icon-btn icon="mdi-content-copy" size="24" variant="plain" @click="copyParten(item.id)">
                <v-icon size="15" />
              </v-icon-btn>
            </td>
          </tr>
        </template>
      </v-data-table>
    </v-sheet>

    <v-dialog v-model="dialog" width="auto">
      <template v-if="currentPanel == 'delete'">
        <v-card min-width="400">
          <v-card-title>
            <v-icon size="20">mdi-delete-outline</v-icon>
            <span class="text-[14px] ml-1">删除审批模板</span>
          </v-card-title>

          <v-card-text>
            <span class="text-[13px]">删除后将无法恢复，请确认是否删除？</span>
          </v-card-text>

          <template #actions>
            <v-btn
              class="ms-auto"
              color="error"
              size="small"
              text="取消"
              @click="dialog = false"
            />

            <v-btn
              color="primary"
              size="small"
              text="确认"
              variant="tonal"
              @click="removeNode"
            />
          </template>
        </v-card>
      </template>

      <template v-else>
        <v-card min-width="400">
          <v-card-title class="d-flex align-center justify-space-between">
            <div>
              <v-icon size="18">mdi-content-copy</v-icon>
              <span class="text-[14px] ml-1">复制审批模板</span>
            </div>

            <v-switch
              v-model="status"
              color="#1867C0"
              false-icon="mdi-close"
              hide-details
              true-icon="mdi-check"
            >
              <template #label>
                <span class="text-[12px]">{{ status ? '开启' : '关闭' }}</span>
              </template>
            </v-switch>
          </v-card-title>

          <v-card-text>
            <v-text-field
              v-model="streamName"
              clearable
              label="例如：报销审批"
              persistent-hint
              hint="审批流名称不能为空"
              :rules="[streamNameRule]"
              variant="outlined"
            />
          </v-card-text>

          <template #actions>
            <v-btn
              class="ms-auto"
              color="error"
              size="small"
              text="取消"
              @click="dialog = false"
            />

            <v-btn
              color="primary"
              size="small"
              text="确认"
              variant="tonal"
              @click="copyNode"
            />
          </template>
        </v-card>
      </template>
    </v-dialog>
    <!-- 流程图预览：只读，可缩放平移查看条件分支 -->
    <v-dialog v-model="previewOpen" width="1200">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon color="#1055C9" size="18">mdi-chart-sankey-variant</v-icon>
          <span class="text-[14px] ml-1">流程预览 · {{ previewItem?.name }}</span>
          <v-spacer />

          <v-icon-btn icon="mdi-close" size="24" variant="plain" @click="previewOpen = false">
            <v-icon size="16" />
          </v-icon-btn>
        </v-card-title>

        <v-card-text>
          <FlowPreview
            v-if="previewOpen"
            :chain="previewItem?.chain?.chain"
            controls
            :flow="previewItem?.chain?.flow"
            :graph="previewItem?.chain?.graph"
            height="70vh"
          />
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-snackbar
      v-model="snackbar"
      :color="color"
      location="top"
      :prepend-icon="`${color === 'success' ? 'mdi-check' : 'mdi-alert-circle-outline'}`"
      timeout="1500"
      variant="outlined"
    >
      {{ text }}
    </v-snackbar>
  </v-container>
</template>

<script lang="ts" setup>
  import type { ApprovalModal } from '@/types/approval'
  import FlowMiniMap from '@/components/FlowMiniMap.vue'
  import FlowPreview from '@/components/FlowPreview.vue'
  import { addApproval, deleteApproval, getApproval } from '@/utils/collection'
  import { formatDate } from '@/utils/utils'
  const router = useRouter()
  const chians = ref<ApprovalModal[]>([])
  function createStream () {
    router.push({
      path: '/createStream',
    })
  }
  const status = ref(false)
  const streamName = ref<string>('')
  const streamNameRule = (v: string) => !!v || '审批流名称不能为空'
  const dialog = ref(false)
  const snackbar = ref(false)
  const color = ref('success')
  const text = ref('')
  const currentId = ref('')
  /** 统一提示：避免每处都手写 text / color / snackbar 三连，也保证失败走 error 样式 */
  function notify (message: string, type: 'success' | 'error' = 'success') {
    text.value = message
    color.value = type
    snackbar.value = true
  }
  const headers = [
    { title: '名称', key: 'name' },
    { title: '状态', key: 'status' },
    { title: '流程', key: 'chain' },
    { title: '创建时间', key: 'created' },
    { title: '操作', key: 'action', align: 'start' },
  ] as const

  // ===== 流程预览 =====
  const previewOpen = ref(false)
  const previewItem = ref<ApprovalModal | null>(null)
  const currentPanel = ref('delete')
  function openPreview (item: ApprovalModal) {
    previewItem.value = item
    previewOpen.value = true
  }

  function goEdit (id: string) {
    router.push({
      path: '/createStream',
      query: {
        id,
      },
    })
  }

  async function copyNode () {
    // 校验不能复用 streamNameRule：它返回 true | string，
    // 非空时是 true、为空时是提示字符串（两者都 truthy），取反后恒为 false
    if (!streamName.value.trim()) {
      notify('审批流名称不能为空', 'error')
      return
    }
    const currentNode = chians.value.find(item => item.id === currentId.value)
    if (!currentNode?.chain) {
      notify('未找到源模板，请刷新后重试', 'error')
      return
    }
    try {
      // 只取模板三要素，不整条拷贝：避免把 id / created 等源记录元数据带进新记录
      await addApproval(streamName.value.trim(), Number(status.value), {
        chain: currentNode.chain.chain,
        flow: currentNode.chain.flow,
        graph: currentNode.chain.graph,
      })
      notify('复制成功', 'success')
      dialog.value = false
      await getDatas()
    } catch (error) {
      console.error('[approvalModel] 复制模板失败:', error)
      notify('复制失败，请稍后重试', 'error')
    }
  }

  async function getDatas () {
    const res = await getApproval()
    chians.value = res
    console.log(res)
  }
  function removeParten (id: string) {
    dialog.value = true
    currentId.value = id
    currentPanel.value = 'delete'
  }
  async function copyParten (id: string) {
    const source = chians.value.find(item => item.id === id)
    // 每次打开都重置弹窗字段，否则会残留上一次的名称 / 开关状态
    streamName.value = source ? `${source.name} - 副本` : ''
    status.value = source?.status === 1
    currentId.value = id
    currentPanel.value = 'copy'
    dialog.value = true
  }
  async function removeNode () {
    const { code, message } = await deleteApproval(currentId.value)
    if (code === 0) {
      await getDatas()
    }
    // 失败时也要走 error 样式：原先无论成败都用 success 绿色对勾，会误导操作者
    notify(message, code === 0 ? 'success' : 'error')
    dialog.value = false
  }
  onMounted(() => {
    getDatas()
  })
</script>

<style scoped>
.model-table :deep(td),
.model-table :deep(th) {
    height: 56px;
}
</style>
