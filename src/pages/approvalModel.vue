<template>
  <v-container class="h-[calc(100vh-32px)] bg-app d-flex" fluid>
    <v-sheet class="model-sheet card-border p-4" rounded="15">
      <div class="d-flex align-center justify-space-between flex-wrap ga-2">
        <v-tabs v-model="topTab" class="top-tabs" density="compact" :hide-slider="true">
          <v-tab class="text-none" value="template">
            <v-icon class="mr-2" size="16">mdi-file-document-multiple-outline</v-icon>
            <span class="text-[13px]">审批模板</span>
            <span class="sheet-tab-count">{{ chians.length }}</span>
          </v-tab>

          <v-tab class="text-none" value="type">
            <v-icon class="mr-2" size="16">mdi-tag-multiple-outline</v-icon>
            <span class="text-[13px]">审批类型</span>
            <span class="sheet-tab-count">{{ typeRows.length }}</span>
          </v-tab>
        </v-tabs>

        <div class="d-flex align-center ga-2">
          <template v-if="topTab === 'template'">
            <!-- 导入 / 导出 JSON：用来在环境之间搬模板（文件格式见 utils/templateJson） -->
            <v-btn class="me-2 text-none" prepend-icon="mdi-import" variant="tonal" @click="openImport">
              导入 JSON
            </v-btn>
            <v-btn class="me-2 text-none" color="primary" prepend-icon="mdi-plus" variant="flat"
              @click="createStream">新模板</v-btn>
          </template>

          <!--
            审批类型的作用域：默认对所有模板生效，也可以只看/只改某一张模板上的覆盖
            （层级口径见 utils/approvalTypes：内置默认 → 全局 → 模板级）。
          -->
          <template v-else>
            <!-- 尺寸与字号走全局 .filter-select / .filter-menu（28px / 12px，与其它筛选下拉同一档） -->
            <v-select v-model="scopeKey" class="scope-select filter-select" density="compact" hide-details
              item-title="title" item-value="value" :items="scopeItems"
              :menu-props="{ contentClass: 'filter-menu' }" variant="outlined" />
            <v-chip class="me-2" color="primary" label size="small" :variant="typeCustom ? 'tonal' : 'text'">
              {{ typeCustom ? '已自定义' : '默认' }}
            </v-chip>
          </template>
        </div>
      </div>

      <v-divider class="mt-3" />

      <!--
        表格区**自己滚动**：整页是纵向 flex、这里是 flex:1 的那一段，
        剩下的位置留给底部页签，页签就能一直贴在窗口最下方（见 model-sheet 的说明）。
      -->
      <div class="model-sheet-scroll">
        <v-data-table v-if="topTab === 'template'" class="text-body-small model-table" density="compact" :headers="headers"
          hide-default-footer hover item-value="name" :items="rows" :loading="loading">
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

                <!-- 导出成 JSON：文件里只有名字 + 启停 + 三要素，拿去别的环境用「导入 JSON」还原 -->
                <v-icon-btn icon="mdi-export-variant" size="24" title="导出为 JSON" variant="plain"
                  @click="exportOne(item)">
                  <v-icon  size="16" />
                </v-icon-btn>
              </td>
            </tr>
          </template>
        </v-data-table>
        <v-data-table v-else class="text-body-small model-table" density="compact" :headers="typeHeaders"
          hide-default-footer hover item-value="code" :items="typeRows" :loading="typeLoading">
          <template #item="{ item }">
            <tr class="text-no-wrap">
              <td>
                <div class="d-flex align-center ga-2">
                  <span class="font-weight-medium">{{ item.name }}</span>
                  <code class="type-code">{{ item.code }}</code>
                  <v-icon v-if="item.overridden" color="primary" size="12" title="这一层已自定义">mdi-pencil-circle</v-icon>
                </div>
              </td>

              <td>
                <v-chip label size="x-small" variant="tonal">{{ item.category }}</v-chip>
              </td>

              <td>
                <strong :class="item.enabled ? 'text-success' : 'text-error'">{{ item.enabled ? '启用' : '停用' }}</strong>
              </td>

              <td style="min-width: 320px">
                <span class="text-[12px]">{{ item.summary }}</span>
              </td>

              <td style="min-width: 180px">
                <span class="text-[11px] text-medium-emphasis">{{ item.note || '—' }}</span>
              </td>

              <td class="text-start">
                <v-icon-btn icon="mdi-pencil" size="24" title="编辑这一类的填写项" variant="plain"
                  @click="goTypeEdit(item)">
                  <v-icon size="16" />
                </v-icon-btn>

                <!-- 只有当前作用域这一层真的覆盖过才有「恢复默认」：否则它本来就跟着上一层走 -->
                <v-icon-btn v-if="item.overridden" icon="mdi-restore" size="24" title="恢复默认（删掉这一层的覆盖）"
                  variant="plain" @click="resetType(item)">
                  <v-icon size="16" />
                </v-icon-btn>
              </td>
            </tr>
          </template>
        </v-data-table>
      </div>
      <div v-if="topTab === 'template'" class="sheet-tab-bar">
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

      <!-- 导入 JSON：选文件 → 当场解析出名字 / 环节数 → 确认后建一张新模板 -->
      <template v-else-if="currentPanel == 'import'">
        <v-card min-width="520">
          <v-card-title>
            <v-icon size="18">mdi-file-import-outline</v-icon>
            <span class="text-[14px] ml-1">导入审批模板（JSON）</span>
          </v-card-title>

          <v-card-text>
            <v-file-input v-model="importFile" accept=".json,application/json" density="compact" hide-details="auto"
              label="选择模板 JSON 文件" prepend-icon="" prepend-inner-icon="mdi-file-upload-outline"
              variant="outlined" @update:model-value="readImportFile" />

            <!-- 解析成功才给名称 / 摘要：解析失败时下面只有一条原因，不给"看起来能提交"的输入框 -->
            <template v-if="importPayload">
              <v-text-field v-model="importName" class="mt-3" density="compact" hide-details="auto" label="模板名称"
                :rules="[streamNameRule]" variant="outlined" />

              <div class="mt-2 d-flex align-center flex-wrap ga-2 text-[12px] text-medium-emphasis">
                <v-chip color="primary" label size="x-small" variant="tonal">
                  {{ importPayload.status ? '启用' : '未启用' }}
                </v-chip>
                <span>{{ importPayload.chain.chain.length }} 个审批环节</span>
                <span v-if="importPayload.chain.flow?.length">{{ importPayload.chain.flow.length }} 个流程节点</span>
                <span v-if="!importPayload.chain.flow?.length" class="text-warning">（没有流程结构，只有链路）</span>
              </div>

              <div class="mt-2 text-[11px] text-medium-emphasis">
                导入只会新建一张模板（不会覆盖同名的），id / 创建时间这些源记录信息不会带过来。
              </div>
            </template>

            <v-alert v-if="importError" class="mt-3" density="compact" type="error" variant="tonal">
              {{ importError }}
            </v-alert>
          </v-card-text>

          <template #actions>
            <v-btn class="ms-auto" color="error" size="small" text="取消" @click="dialog = false" />
            <v-btn color="primary" :disabled="!importPayload" :loading="importing" size="small" text="确认导入"
              variant="tonal" @click="importNode" />
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
import type { ApprovalTypeOverrideMap } from '@/utils/approvalTypes'
import type { ApprovalTypeScope } from '@/utils/approvalTypeStore'
import FlowMiniMap from '@/components/FlowMiniMap.vue'
import FlowPreview from '@/components/FlowPreview.vue'
import { addApproval, deleteApproval, findTemplatesUsing, getApproval, getApprovalOptions, updateApprovalModel } from '@/utils/collection'
// 「审批类型」页签：结论码清单与"选中后要填什么"的解析口径，与设置页共用同一份（见 utils/approvalTypes）
import { resolveTypeTemplates, typeCategoryOf, typeFieldsSummaryOf } from '@/utils/approvalTypes'
import { approvalTypeWriteHint, loadApprovalTypeOverrides, saveApprovalTypeOverride } from '@/utils/approvalTypeStore'
// 正本 / 副本的名规约（判定、去标记、生成）：只此一处，别在本页再拼字符串
import { copyNameOf, isTemplateCopy, primeNameOf } from '@/utils/templateCopy'
// 模板 JSON 的导出 / 导入：文件格式、解析规则、重名处理都在里面（本页只负责按钮与提示）
import {
  downloadTemplateJson,
  parseTemplateJson,
  type TemplatePayload,
  uniqueTemplateName,
} from '@/utils/templateJson'
import { formatDate } from '@/utils/utils'
const router = useRouter()
const chians = ref<ApprovalModal[]>([])

/**
 * 顶层页签：审批模板 / 审批类型。
 *
 * 为什么不拆两个页面：「审批类型」的作用域就是模板（默认全局 / 只覆盖某一张），
 * 拆开之后每次都要在两个页面之间带着 id 跳来跳去；收在同一张卡片里，
 * 切页签不会丢数据，也不用等页面重挂载。
 */
const topTab = ref<'template' | 'type'>('template')

/**
 * 模板取数中（挂到表格的 `:loading` 上）。
 *
 * 名字用 `loading` 而不是 `templateLoading`：本页只有这一张表，不用像 roleSetting
 * （一个页面三张表）那样按实体区分。⚠️ 用 `loading` 当名字要留意别和**行内**的
 * 提交态混用 —— 行内动作（复制 / 删除 / 移入正本）各自有自己的 flag，见下。
 */
const loading = ref(false)

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

/* ==================== 审批类型（第二页签） ==================== */

/**
 * 一行「审批类型」。列与审批模板那张表同一个形态：名称 / 状态 / 内容 / 操作。
 *
 * ⚠️ 这里**不存**字段本身：结论码清单与"没配就沿用上一层"的解析口径都在
 * utils/approvalTypes 里（内置默认 → 全局 → 模板），本页只负责按作用域铺成表格。
 */
interface ApprovalTypeRow {
  /** 结论码（= APPROVAL_RESULTS 的 value，也是选项树叶子的 link） */
  code: string
  name: string
  /** 用途分组（常规 / 接收 / 弃置…，见 utils/approvalTypes 的 typeCategoryOf） */
  category: string
  enabled: boolean
  /** 当前作用域**这一层**有没有覆盖：有才给「恢复默认」 */
  overridden: boolean
  /** 办理提示（给办理人的一句话，可为空） */
  note: string
  /** 选中这个结论后要填的东西（字段文案串，见 typeFieldsSummaryOf） */
  summary: string
}

/** 模板列表：作用域下拉的候选（模板级覆盖就挂在 app_chain 的记录 id 上） */
const templates = ref<{ id: string, name: string }[]>([])
/** 作用域：'global' = 所有模板生效；否则是某张模板的 id */
const scopeKey = ref('global')
const typeLoading = ref(false)
/** 全局层的覆盖：解析任何一层都要垫在最底下 */
const globalTypeOverrides = ref<ApprovalTypeOverrideMap>({})
/** 当前作用域的覆盖（「已自定义」标记与「恢复默认」都看它） */
const scopeTypeOverrides = ref<ApprovalTypeOverrideMap>({})
/** 当前作用域这一层是否有任何覆盖 */
const typeCustom = ref(false)
/** 类型数据读过了没有：切到页签时才读，打开页面不必多发两个请求 */
const typeLoaded = ref(false)
/**
 * 模板清单的版本号：每次重读单据列表 +1（见 getDatas）。
 *
 * 「审批类型」页签据此判断手上的作用域下拉是不是过期了 —— 在模板页签里
 * 新建 / 复制 / 删除 / 移入正本之后切过去，下拉里必须能看到最新的那张模板。
 */
const templatesVersion = ref(0)
/** 上次读类型时用的是哪一版模板清单 */
let typesTemplatesVersion = -1

const scopeItems = computed(() => [
  { value: 'global', title: '默认（所有审批模板）' },
  ...templates.value.map(t => ({ value: t.id, title: t.name || '(未命名模板)' })),
])

const typeScope = computed<ApprovalTypeScope>(() => (scopeKey.value === 'global'
  ? { kind: 'global' }
  : { kind: 'template', templateId: scopeKey.value }))

/** 解析顺序：全局层永远在前，模板层叠在它上面（见 utils/approvalTypes 的文件头） */
const typeLayers = computed(() => (typeScope.value.kind === 'global'
  ? [globalTypeOverrides.value]
  : [globalTypeOverrides.value, scopeTypeOverrides.value]))

const typeRows = computed<ApprovalTypeRow[]>(() => resolveTypeTemplates(typeLayers.value).map(t => ({
  code: t.code,
  name: t.name,
  category: typeCategoryOf(t.code),
  enabled: t.enabled !== false,
  overridden: scopeTypeOverrides.value[t.code] !== undefined,
  note: String(t.note ?? ''),
  summary: typeFieldsSummaryOf(t.fields),
})))

const typeHeaders = [
  { title: '名称', key: 'name' },
  { title: '分组', key: 'category' },
  { title: '状态', key: 'enabled' },
  { title: '需要填写', key: 'summary' },
  { title: '办理提示', key: 'note' },
  { title: '操作', key: 'action', align: 'start' },
] as const

/**
 * 读当前作用域的审批类型。
 *
 * 全局层与作用域层是**两次读**（全局 = 'global'，模板 = 该模板 id），
 * 作用域本来就是全局时只读一次 —— 别为了少写一个分支去读两遍同一层。
 */
async function loadTypes() {
  typeLoading.value = true
  try {
    // 每次都重读模板清单：在「审批模板」页签里增删过之后，作用域下拉必须跟着变
    // （全量只有几十条，切页签 / 切作用域各读一次没有负担）
    templates.value = await getApprovalOptions()
    /*
     * 作用域指向一张**已经被删掉**的模板：落回全局（否则下拉显示空白、
     * 改出来的覆盖落在谁都不看的一层上）。改完 `scopeKey` 会触发 watch 再读一次。
     */
    if (scopeKey.value !== 'global' && !templates.value.some(t => t.id === scopeKey.value)) {
      scopeKey.value = 'global'
      return
    }
    const globalRow = await loadApprovalTypeOverrides({ kind: 'global' })
    globalTypeOverrides.value = globalRow.overrides
    if (typeScope.value.kind === 'global') {
      scopeTypeOverrides.value = globalRow.overrides
      typeCustom.value = globalRow.custom
    } else {
      const row = await loadApprovalTypeOverrides(typeScope.value)
      scopeTypeOverrides.value = row.overrides
      typeCustom.value = row.custom
    }
    typeLoaded.value = true
    typesTemplatesVersion = templatesVersion.value
  } catch (error) {
    console.error('[approvalModel] 读取审批类型失败:', error)
    notify('审批类型读取失败，请稍后重试', 'error')
  } finally {
    typeLoading.value = false
  }
}

/**
 * 编辑某一类结论：跳「审批类型」设置页，并把**当前作用域 + 结论码**带过去，
 * 落地就直接停在这一条上（见 approvalTypeSetting 里对 query 的读取）。
 *
 * 为什么不把字段编排也搬进本页：那是"一条结论一套表单 + 实时预览"的深编辑，
 * 表格里塞不下；而且它本来就只需要服务一条结论，放在独立页面里更好用。
 */
function goTypeEdit(row: ApprovalTypeRow) {
  router.push({
    path: '/approvalTypeSetting',
    query: {
      code: row.code,
      ...(scopeKey.value === 'global' ? {} : { scope: scopeKey.value }),
    },
  })
}

/** 恢复默认 = 删掉**当前层**对这一条结论的覆盖（回到上一层，不是删数据） */
async function resetType(row: ApprovalTypeRow) {
  try {
    await saveApprovalTypeOverride(typeScope.value, row.code, null)
    await loadTypes()
    notify(`「${row.name}」已恢复默认`, 'success')
  } catch (error) {
    console.error('[approvalModel] 恢复审批类型默认失败:', error)
    notify(approvalTypeWriteHint(error), 'error')
  }
}

watch(topTab, value => {
  if (value !== 'type') {
    return
  }
  // 第一次进类型页签才读；之后来回切不重复请求 —— 但模板清单变过（见 templatesVersion）就得重读
  if (!typeLoaded.value || typesTemplatesVersion !== templatesVersion.value) {
    void loadTypes()
  }
})

watch(scopeKey, () => {
  if (topTab.value === 'type') {
    void loadTypes()
  }
})

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
  loading.value = true
  try {
    const res = await getApproval()
    chians.value = res
    // 清单换了版本：「审批类型」页签的作用域下拉与「已自定义」判定都要跟着重算（见 templatesVersion）
    templatesVersion.value++
    console.log(res)
  } finally {
    loading.value = false
  }
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

/* ==================== JSON 导出 / 导入 ==================== */

/**
 * 导入弹窗里选中的文件 / 解析结果（null = 还没选或解析失败）。
 * 类型带上数组：v-file-input 没开 `multiple` 时 Vuetify 仍可能给数组（版本差异），两边都认。
 */
const importFile = ref<File | File[] | null>(null)
const importPayload = ref<TemplatePayload | null>(null)
/** 导入后的模板名：预填文件里的名字，撞名时自动接「（导入）」（见 uniqueTemplateName） */
const importName = ref('')
const importError = ref('')
const importing = ref(false)

/** 导出这一行为 JSON 文件（文件名 = 模板名，非法字符会被替换，见 templateFileName） */
function exportOne(item: ApprovalModal) {
  try {
    const json = downloadTemplateJson(item)
    const flow = json.chain.flow?.length ?? 0
    notify(`「${json.name}」已导出（${json.chain.chain.length} 个环节${flow ? ` / ${flow} 个流程节点` : ''}）`, 'success')
  } catch (error) {
    console.error('[approvalModel] 导出模板失败:', error)
    notify('导出失败，请稍后重试', 'error')
  }
}

/** 打开导入弹窗：每次都清空上一次选的文件与解析结果，别让人误提交上次那份 */
function openImport() {
  importFile.value = null
  importPayload.value = null
  importName.value = ''
  importError.value = ''
  currentPanel.value = 'import'
  dialog.value = true
}

/**
 * 选了文件就**当场解析**：能立刻告诉用户"这个文件能不能用、里面有几环"，
 * 而不是等到点「确认导入」才失败。解析失败只显示原因，确认按钮保持禁用。
 */
async function readImportFile(value: File | File[] | null) {
  const file = Array.isArray(value) ? value[0] : value
  importPayload.value = null
  importName.value = ''
  importError.value = ''
  if (!file) {
    return
  }
  try {
    const payload = parseTemplateJson(await file.text())
    importPayload.value = payload
    // 撞名就自动加后缀：模板是**按名字**查的，重名会让"取到哪一张"变得不确定
    importName.value = uniqueTemplateName(payload.name, chians.value.map(t => t.name))
  } catch (error) {
    importError.value = error instanceof Error ? error.message : '文件解析失败'
  }
}

/**
 * 确认导入 = 建一张**新模板**（不覆盖同名的那张）。
 *
 * 落库走 addApproval（与「复制」同一条路）：它内部已 catch，失败时**返回 error 对象**
 * 而不是抛出 —— 所以这里必须按返回值判成败，不能只靠 try/catch。
 */
async function importNode() {
  const payload = importPayload.value
  if (!payload) {
    notify('请先选择一个模板 JSON 文件', 'error')
    return
  }
  const name = importName.value.trim()
  if (!name) {
    notify('模板名称不能为空', 'error')
    return
  }
  importing.value = true
  try {
    const res = await addApproval(name, payload.status, { ...payload.chain })
    if (res instanceof Error) {
      notify('导入失败，请稍后重试', 'error')
      return
    }
    notify(`已导入「${name}」，可在表格里继续编辑`, 'success')
    dialog.value = false
    // 名字里带「- 副本」的会落在副本页签（与复制同一套规约），否则在正本
    tab.value = isTemplateCopy(name) ? 'copy' : 'main'
    await getDatas()
  } catch (error) {
    console.error('[approvalModel] 导入模板失败:', error)
    notify('导入失败，请稍后重试', 'error')
  } finally {
    importing.value = false
  }
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
 * 顶层页签（审批模板 / 审批类型）：**包裹式按钮**（按设计稿的形态）。
 *
 *   · 整组不套外壳：底就是卡片本身，只在两个页签之间留 6px 间距；
 *   · 选中的那个自己是一块**淡蓝圆角按钮**（主色 10% 填充 + 主色文字与图标）；
 *   · 未选中是透明底、常规灰字，hover 才浮出一点点底色。
 *
 * 与底部 正本/副本（Excel 表格式页签）刻意区分开：
 * 上面这组切的是"整块视图"，不是同一张表里的两页数据。
 *
 * `width: fit-content` 必须写：v-tabs 默认 flex 拉伸，不收紧的话这组按钮会被拉满整行。
 */
.top-tabs {
  flex: 0 0 auto;
  width: fit-content;
  padding: 0;
}

.top-tabs :deep(.v-slide-group__content) {
  gap: 6px;
}

.top-tabs :deep(.v-tab) {
  min-width: 0;
  height: 34px;
  padding: 0 16px;
  border-radius: 10px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  transition: background-color 0.18s, color 0.18s;
}

/* 图标跟着文字走：未选中灰、选中蓝，不用逐个传 color */
.top-tabs :deep(.v-tab .v-icon) {
  color: inherit;
}

.top-tabs :deep(.v-tab:hover) {
  background: rgba(var(--v-theme-on-surface), 0.05);
}

/* 选中的那一个：淡蓝圆角块（也压住 hover，免得鼠标划过时被冲淡） */
.top-tabs :deep(.v-tab--selected),
.top-tabs :deep(.v-tab--selected:hover) {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
  background: rgba(var(--v-theme-primary), 0.1);
}

/* 暗色档：同一个 10% 主色在深底上太淡，提到 22% 才有"被选中"的分量 */
.v-theme--dark .top-tabs :deep(.v-tab--selected),
.v-theme--dark .top-tabs :deep(.v-tab--selected:hover) {
  background: rgba(var(--v-theme-primary), 0.22);
}

/* 不用 Vuetify 的下划线滑块：选中态由上面那块填充表达 */
.top-tabs :deep(.v-tabs-slider) {
  display: none;
}

/* 选中项里的条数徽标跟着主色走（未选中仍是主题灰） */
.top-tabs :deep(.v-tab--selected) .sheet-tab-count {
  background: rgba(var(--v-theme-primary), 0.14);
}

/*
 * 审批类型的作用域下拉：只定宽。
 * 高度与字号不在这里写 —— 交给全局 .filter-select（28px / 12px，与页面里其它筛选下拉同一档），
 * 展开的选项列表交给 .filter-menu（见 styles/main.scss），别在本页再抄一套数字。
 * 190px 刚好放得下最长那项「默认（所有审批模板）」，再窄就会被省略号吃掉。
 */
.scope-select {
  width: 190px;
}

/* 结论码：与「审批类型」设置页的 .field-key 同一套配色，读的人一眼知道是同一东西 */
.type-code {
  padding: 0 4px;
  font-size: 11px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  border-radius: 4px;
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
