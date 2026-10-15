<template>
  <v-container class="h-[calc(100vh-32px)] bg-app d-flex" fluid>
    <v-sheet class="model-sheet border border-[#E8E8E8] p-4" rounded="15">
      <div class="d-flex align-center justify-space-between">
        <div class="block-title">审批模板</div>

        <div class="d-flex align-center ga-2">
          <v-btn class="text-none border border-dashed" prepend-icon="mdi-tag-multiple-outline" variant="flat"
            @click="goApprovalTypes">审批类型</v-btn>

          <v-btn class="me-2 text-none" color="primary" prepend-icon="mdi-plus" variant="flat"
            @click="createStream">新模板</v-btn>
        </div>
      </div>

      <v-divider class="mt-3" />

      <!--
        表格区**自己滚动**：整页是纵向 flex、这里是 flex:1 的那一段，
        剩下的位置留给底部页签，页签就能一直贴在窗口最下方（见 model-sheet 的说明）。
      -->
      <div class="model-sheet-scroll">
        <v-data-table class="text-body-small model-table" density="compact" :headers="headers" hide-default-footer hover
          item-value="name" :items="rows">
          <!-- 各页签的空态分开说：副本页签空 = 还没复制过，正本页签空才是真没建过模板 -->
          <template #no-data>
            <div class="py-6 text-center text-medium-emphasis">
              {{ tab === 'copy' ? '还没有副本：在正本里点「复制」会生成一张带「- 副本」后缀的草稿' : '还没有审批模板，点右上角「新模板」开始' }}
            </div>
          </template>

          <template #item="{ item }">
            <tr class="text-no-wrap">
              <td>{{ item.name }}</td>

              <td>
                <strong :class="item.status == 0 ? 'text-error' : 'text-success'">{{ item.status == 0 ? '未启用' : '启用'
                  }}</strong>
              </td>

              <td style="min-width: 360px">
                <!-- 表格里展示紧凑版流程概览（主线成员 + 分支组/条件/嵌套/loopBackTo）；点「查看」再看完整流程图 -->
                <div class="d-flex align-center" style="gap: 6px">
                  <v-icon-btn icon="mdi-chart-sankey-variant" size="24" title="查看流程图" variant="plain"
                    @click="openPreview(item)">
                    <v-icon color="#1055C9" size="16" />
                  </v-icon-btn>

                  <FlowMiniMap :chain="item.chain.chain" :flow="item.chain.flow" style="flex: 1; min-width: 0" />
                </div>
              </td>

              <td>
                <span class="text-grey">{{ formatDate(item.created) }}</span>
              </td>

              <td class="text-start">
                <v-icon-btn icon="mdi-pencil" size="24" variant="plain" @click="goEdit(item.id)">
                  <v-icon size="16" />
                </v-icon-btn>

                <v-icon-btn icon="mdi-delete-outline" size="24" variant="plain" @click="removeParten(item.id)">
                  <v-icon size="16" />
                </v-icon-btn>

                <v-icon-btn icon="mdi-content-copy" size="24" title="复制成副本" variant="plain"
                  @click="copyParten(item.id)">
                  <v-icon size="15" />
                </v-icon-btn>

                <!-- 副本专属：改名去掉「- 副本」后缀，就移进正本（见 promoteParten） -->
                <v-icon-btn v-if="isTemplateCopy(item.name)" icon="mdi-arrow-up-bold-box-outline" size="24"
                  title="改名并移入正本" variant="plain" @click="promoteParten(item)">
                  <v-icon color="#1867C0" size="16" />
                </v-icon-btn>
              </td>
            </tr>
          </template>
        </v-data-table>
      </div>
      <div class="sheet-tab-bar">
        <div v-if="tab === 'copy' && rows.length" class="mb-1 text-[12px] text-medium-emphasis">
          副本是改到一半的草稿：建单不会用到它们（建单按「组别 + 模板」精确查名字）。
          改好名字、点行尾 ↑ 移入正本即可。
        </div>

        <v-tabs v-model="tab" class="sheet-tabs" density="compact" :hide-slider="true">
          <v-tab v-for="t in sheetTabs" :key="t.value" :value="t.value">
            <v-icon class="mr-1" size="14">{{ t.icon }}</v-icon>
            <span class="text-[12px]">{{ t.title }}</span>
            <span class="sheet-tab-count">{{ t.count }}</span>
          </v-tab>
        </v-tabs>
      </div>
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
            <v-btn class="ms-auto" color="error" size="small" text="取消" @click="dialog = false" />
            <v-btn color="primary" size="small" text="确认" variant="tonal" @click="removeNode" />
          </template>
        </v-card>
      </template>

      <template v-else-if="currentPanel == 'promote'">
        <v-card min-width="420">
          <v-card-title>
            <v-icon size="18">mdi-arrow-up-bold-box-outline</v-icon>
            <span class="text-[14px] ml-1">移入正本</span>
          </v-card-title>
          <v-card-text>
            <v-text-field v-model="streamName" clearable hint="名字里不能再带「- 副本」；改好确认，这张就出现在正本里"
              label="正本名称" persistent-hint :rules="[streamNameRule]" variant="outlined" />
          </v-card-text>
          <template #actions>
            <v-btn class="ms-auto" color="error" size="small" text="取消" @click="dialog = false" />
            <v-btn color="primary" size="small" text="移入正本" variant="tonal" @click="promoteNode" />
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

            <v-switch v-model="status" color="#1867C0" false-icon="mdi-close" hide-details true-icon="mdi-check">
              <template #label>
                <span class="text-[12px]">{{ status ? '开启' : '关闭' }}</span>
              </template>
            </v-switch>
          </v-card-title>

          <v-card-text>
            <v-text-field v-model="streamName" clearable hint="审批流名称不能为空" label="例如：报销审批" persistent-hint
              :rules="[streamNameRule]" variant="outlined" />
          </v-card-text>

          <template #actions>
            <v-btn class="ms-auto" color="error" size="small" text="取消" @click="dialog = false" />

            <v-btn color="primary" size="small" text="确认" variant="tonal" @click="copyNode" />
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
          <FlowPreview v-if="previewOpen" :chain="previewItem?.chain?.chain" controls :flow="previewItem?.chain?.flow"
            :graph="previewItem?.chain?.graph" height="70vh" />
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="color" location="top"
      :prepend-icon="`${color === 'success' ? 'mdi-check' : 'mdi-alert-circle-outline'}`" timeout="1500"
      variant="outlined">
      {{ text }}
    </v-snackbar>
  </v-container>
</template>

<script lang="ts" setup>
import type { ApprovalModal } from '@/types/approval'
import FlowMiniMap from '@/components/FlowMiniMap.vue'
import FlowPreview from '@/components/FlowPreview.vue'
import { addApproval, deleteApproval, findTemplatesUsing, getApproval, updateApprovalModel } from '@/utils/collection'
// 正本 / 副本的名规约（判定、去标记、生成）：只此一处，别在本页再拼字符串
import { copyNameOf, isTemplateCopy, primeNameOf } from '@/utils/templateCopy'
import { formatDate } from '@/utils/utils'
const router = useRouter()
const chians = ref<ApprovalModal[]>([])

/**
 * 底部页签：正本 / 副本（Excel 的 sheet 那种形态）。
 *
 * 分区口径只有一条 —— 名字里带「- 副本」就是副本（见 utils/templateCopy），
 * 所以"移入正本"就是**改个名字**，不涉及换表 / 复制数据。
 */
const tab = ref<'main' | 'copy'>('main')
/** 正本：名字里没有副本标记的 */
const mainChians = computed(() => chians.value.filter(t => !isTemplateCopy(t.name)))
/** 副本：复制出来的那一批草稿 */
const copyChians = computed(() => chians.value.filter(t => isTemplateCopy(t.name)))
/** 当前页签要显示的数据 */
const rows = computed(() => (tab.value === 'copy' ? copyChians.value : mainChians.value))
/** 页签本身（带条数，省得两边来回切着数） */
const sheetTabs = computed(() => [
  { value: 'main' as const, title: '正本', icon: 'mdi-file-check-outline', count: mainChians.value.length },
  { value: 'copy' as const, title: '副本', icon: 'mdi-content-copy', count: copyChians.value.length },
])

function createStream() {
  router.push({
    path: '/createStream',
  })
}
/** 去「审批类型」设置页：维护"每种审批结论要填什么"（见 utils/approvalTypes 的文件头） */
function goApprovalTypes() {
  router.push({
    path: '/approvalTypeSetting',
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
function notify(message: string, type: 'success' | 'error' = 'success') {
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
function openPreview(item: ApprovalModal) {
  previewItem.value = item
  previewOpen.value = true
}

function goEdit(id: string) {
  router.push({
    path: '/createStream',
    query: {
      id,
    },
  })
}

async function copyNode() {
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
    notify('复制成功，已放进「副本」页签', 'success')
    dialog.value = false
    // 切到副本页签：新复制的那张在那里，看得到结果（否则会以为"点了没反应"）
    tab.value = 'copy'
    await getDatas()
  } catch (error) {
    console.error('[approvalModel] 复制模板失败:', error)
    notify('复制失败，请稍后重试', 'error')
  }
}

async function getDatas() {
  const res = await getApproval()
  chians.value = res
  console.log(res)
}
/**
 * 打开"删除确认"前，先查**有没有别的模板引用了它**（见 utils/templateRef 的 collectTemplateRefs）。
 *
 * 为什么拦在这里而不是"删完再说"：模板之间是按 id 引用的，删掉被引用的那张，
 * 引用它的模板会在**下一次建单时**才失败 —— 那时问题已经从"改配置"变成"单据建不出来"，
 * 而且报错的地方离原因很远（建单页只会说"引用的模板已不存在"）。
 * 所以删除前直接拦下，并点名"谁在引用"。
 */
async function removeParten(id: string) {
  const users = await findTemplatesUsing(id)
  if (users.length > 0) {
    const names = users.slice(0, 3).map(u => `「${u.name || '未命名模板'}」`).join('、')
    notify(
      `不能删除：${names}${users.length > 3 ? ` 等 ${users.length} 个模板` : ''}引用了这张模板，请先在那些模板里去掉引用`,
      'error',
    )
    return
  }
  dialog.value = true
  currentId.value = id
  currentPanel.value = 'delete'
}
async function copyParten(id: string) {
  const source = chians.value.find(item => item.id === id)
  // 每次打开都重置弹窗字段，否则会残留上一次的名称 / 开关状态。
  // 名字走 copyNameOf：对副本再复制不会叠成「- 副本 - 副本」（见 utils/templateCopy）
  streamName.value = copyNameOf(source?.name)
  status.value = source?.status === 1
  currentId.value = id
  currentPanel.value = 'copy'
  dialog.value = true
}

/**
 * 打开「移入正本」：名称预填**去掉副本后缀**的正本名，用户还能再改（需求就是"改名 + 转移"）。
 */
function promoteParten(item: ApprovalModal) {
  streamName.value = primeNameOf(item.name)
  status.value = item.status === 1
  currentId.value = item.id
  currentPanel.value = 'promote'
  dialog.value = true
}

/**
 * 移入正本 = **改掉名字里的「- 副本」标记**（不是换表、也不是复制数据）。
 *
 * 两道拦截，都是"不说清楚就会被当成点了没反应"的情况：
 *   ① 名称里还带标记 → 移过去照样是副本，当场点明；
 *   ② 与正本重名 → 建单是按 `<组别>模板` **按名字**取模板的（见 pages/workStream 的
 *      taskTemplateNameOf），重名之后"这一行取到哪张"就不确定了，所以直接拦下。
 */
async function promoteNode() {
  const name = streamName.value.trim()
  if (!name) {
    notify('名称不能为空', 'error')
    return
  }
  if (isTemplateCopy(name)) {
    notify('名称里还带着「- 副本」，去掉后才能移入正本', 'error')
    return
  }
  if (chians.value.some(t => t.id !== currentId.value && String(t.name ?? '').trim() === name)) {
    notify(`正本里已经有叫「${name}」的模板了，请换个名字`, 'error')
    return
  }
  const res = await updateApprovalModel(currentId.value, { name })
  if (!res) {
    notify('移入失败，请稍后重试', 'error')
    return
  }
  notify(`「${name}」已移入正本`, 'success')
  dialog.value = false
  await getDatas()
}
async function removeNode() {
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

/*
 * 整页纵向 flex：卡片撑满窗口高度，表格区占掉其中的可伸缩部分，
 * 剩下的位置留给底部页签 —— 页签因此**始终贴在窗口最下方**，
 * 表格数据再多也只是表格自己滚，不会把页签顶出屏幕。
 *
 * `min-height: 0` 两处都不能省：flex 子项默认 min-height:auto（按内容撑），
 * 少了它里面的滚动区会连整个页面一起顶高、`overflow-y` 就不生效了。
 */
.model-sheet {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.model-sheet-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* 底部固定条：表格与页签之间那道横线也由它拉开（不再靠 v-tabs 的外边距） */
.sheet-tab-bar {
  flex: 0 0 auto;
  margin-top: 10px;
  /*
   * 兜底：整页高度是按「窗口 − 顶部系统栏」算的，万一有几像素零头让页面能滚，
   * 这一条仍然贴住视口下沿，不会被推出去（有背景才盖得住从下面滚上来的行）。
   */
  position: sticky;
  bottom: 0;
  z-index: 1;
  background: rgb(var(--v-theme-surface));
}

/*
 * 底部页签（正本 / 副本）—— 照 Excel 的 sheet 分页来：
 * 页签挂在数据**下面**、上圆角贴着一条横线，选中的那张底色提亮 + 一道主色下沿，
 * 看上去就是"这一叠数据属于这张标签"。取色全走主题变量，深浅两种模式都跟着走。
 */
.sheet-tabs {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding-top: 6px;
}

.sheet-tabs :deep(.v-slide-group__content) {
  gap: 4px;
  align-items: flex-end;
}

.sheet-tabs :deep(.v-tab) {
  min-width: 0;
  height: 32px;
  padding: 0 14px;
  /* border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); */
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  /* background: rgba(var(--v-theme-surface-variant), 0.35); */
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-weight: 500;
  text-transform: none;
}

.sheet-tabs :deep(.v-tab--selected) {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
  box-shadow: inset 0 -2px 0 0 rgb(var(--v-theme-primary));
}

/* 不用 Vuetify 的下划线滑块：选中态由上面那条下沿表达 */
.sheet-tabs :deep(.v-tabs-slider) {
  display: none;
}

/** 页签上的条数徽标 */
.sheet-tab-count {
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  font-size: 11px;
  line-height: 16px;
}
</style>
