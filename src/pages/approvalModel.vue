<template>
  <v-container class="h-[calc(100vh-32px)] bg-app d-flex" fluid>
    <v-sheet class="model-sheet card-border p-4" rounded="15">
      <!--
        顶部页签：本页的两块内容 ——「审批模板」（流程模板的清单一览）与「审批类型」
        （每种审批结论要填什么）。两块都是"列表 → 详情"的套路：
          审批模板 → /createStream；审批类型 → /approvalTypeSetting。

        ⚠️ 变量名用 `topTab`：底部「正本 / 副本」的 `tab` 是**另一个维度**（同一块数据的不同分区），
        两者互不相干，别混成一个。
      -->
      <div class="d-flex align-center justify-space-between">
        <v-tabs v-model="topTab" class="top-tabs" density="compact" :hide-slider="true">
          <v-tab value="template">
            <v-icon class="mr-1" size="15">mdi-file-document-multiple-outline</v-icon>
            <span class="text-[13px]">审批模板</span>
          </v-tab>

          <v-tab value="type">
            <v-icon class="mr-1" size="15">mdi-tag-multiple-outline</v-icon>
            <span class="text-[13px]">审批类型</span>
          </v-tab>
        </v-tabs>

        <!-- 「新模板」只对模板页签有意义；审批类型那边有自己的保存条 -->
        <v-btn v-if="topTab === 'template'" class="me-2 text-none" color="primary" prepend-icon="mdi-plus" variant="flat"
          @click="createStream">新模板</v-btn>
      </div>

      <v-divider class="mt-3" />

      <!--
        表格区**自己滚动**：整页是纵向 flex、这里是 flex:1 的那一段，
        剩下的位置留给底部页签，页签就能一直贴在窗口最下方（见 model-sheet 的说明）。
      -->
      <div v-if="topTab === 'template'" class="model-sheet-scroll">
        <v-data-table class="text-body-small model-table" density="compact" :headers="headers" hide-default-footer hover
          item-value="name" :items="rows" :loading="loading">
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

      <!--
        「审批类型」页签：与「审批模板」一样**先给列表**，点「编辑」再去 /approvalTypeSetting 那个
        详情编辑器（作用域 + 结论码跟着地址走，返回时仍在同一层、同一个页签）。

        作用域选择器留在滚动区**外面**（同「审批模板」的"表格滚、页签钉住"）：切作用域是筛条件，
        滚表格时它不该被滚走。
      -->
      <template v-else>
        <div class="d-flex align-center flex-wrap ga-2 mb-2 mt-4">
          <v-select v-model="typeScopeKey" class="type-scope-select filter-input" density="compact" hide-details item-title="title"
            item-value="value" :items="typeScopeItems" variant="outlined">
            <template #item="{ item, props }">
              <v-list-item v-bind="props">
                <template #title>
                  <span class="text-[12px]">{{ item.title }}</span>
                </template>
              </v-list-item>
            </template>
          </v-select>

          <v-chip :color="typeCustom ? 'primary' : undefined" label size="small" variant="tonal">
            {{ typeCustom ? '已自定义' : '默认' }}
          </v-chip>

          <v-spacer />

          <span class="text-[12px] text-medium-emphasis">
            点「编辑」配置这个结论要填的字段（控件、必填与校验）
          </span>
        </div>

        <div class="model-sheet-scroll">
          <v-data-table class="text-body-small model-table" density="compact" :headers="typeHeaders"
            hide-default-footer hover item-value="code" :items="typeRows" :loading="typeLoading">
            <template #item.name="{ item }">
              <div class="d-flex align-center ga-2">
                <span>{{ item.name }}</span>
                <!-- 结论码也露出来：选项树叶子的 link 就是它，排查"这个选项填什么"时只认码 -->
                <code class="type-code">{{ item.code }}</code>
              </div>
            </template>

            <template #item.category="{ item }">
              <span class="text-medium-emphasis">{{ item.category }}</span>
            </template>

            <template #item.summary="{ item }">
              <span class="text-medium-emphasis">{{ item.summary }}</span>
            </template>

            <template #item.overridden="{ item }">
              <v-chip v-if="item.overridden" color="primary" size="x-small" variant="tonal">已自定义</v-chip>
              <span v-else class="text-medium-emphasis">默认</span>
            </template>

            <template #item.enabled="{ item }">
              <strong :class="item.enabled ? 'text-success' : 'text-error'">{{ item.enabled ? '启用' : '停用'
                }}</strong>
            </template>

            <template #item.action="{ item }">
              <v-btn class="text-none" color="primary" size="x-small" variant="tonal"
                @click="goEditType(item.code)">编辑</v-btn>
            </template>
          </v-data-table>
        </div>
      </template>
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
import type { ApprovalTypeOverrideMap } from '@/utils/approvalTypes'
import type { ApprovalTypeScope } from '@/utils/approvalTypeStore'
import FlowMiniMap from '@/components/FlowMiniMap.vue'
import FlowPreview from '@/components/FlowPreview.vue'
import { resolveTypeTemplates, typeCategoryOf, typeFieldsSummaryOf } from '@/utils/approvalTypes'
import { loadApprovalTypeOverrides } from '@/utils/approvalTypeStore'
import {
  addApproval,
  deleteApproval,
  findTemplatesUsing,
  getApproval,
  updateApprovalModel,
} from '@/utils/collection'
// 正本 / 副本的名规约（判定、去标记、生成）：只此一处，别在本页再拼字符串
import { copyNameOf, isTemplateCopy, primeNameOf } from '@/utils/templateCopy'
import { formatDate } from '@/utils/utils'
const route = useRoute()
const router = useRouter()
const chians = ref<ApprovalModal[]>([])

/**
 * 模板取数中（挂到表格的 `:loading` 上）。
 *
 * 名字用 `loading` 而不是 `templateLoading`：本页只有这一张表，不用像 roleSetting
 * （一个页面三张表）那样按实体区分。⚠️ 用 `loading` 当名字要留意别和**行内**的
 * 提交态混用 —— 行内动作（复制 / 删除 / 移入正本）各自有自己的 flag，见下。
 */
const loading = ref(false)

/**
 * 顶部页签：审批模板 / 审批类型。
 *
 * 与下面的 `tab`（正本 / 副本）是两个维度：`topTab` 换的是**整块功能**，
 * `tab` 换的是同一块模板数据的分区，所以两个都要有、不能合并。
 *
 * 初值取自地址（`?tab=type`）：点「编辑」去审批类型详情页再返回时，靠它落回同一个页签
 * （返回走的是 `$router.back()`，回到的就是切页签时写下的那条地址）。
 */
const topTab = ref<'template' | 'type'>(route.query.tab === 'type' ? 'type' : 'template')

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

// ===== 「审批类型」页签（列表） =====

/*
 * 与「审批模板」同一个套路 —— **这里只列，改去详情页**（/approvalTypeSetting，见 goEditType）。
 * 列表要说清两件事：
 *   · 最终生效的形态（三级回落解析出来的字段，见 utils/approvalTypes 的文件头）；
 *   · 当前这一层有没有覆盖 —— 决定了详情页里"恢复默认"有没有东西可删。
 */

/** 作用域：`global` = 默认（所有审批模板），否则是某张审批模板的 id */
const typeScopeKey = ref('global')
/** 全局层的覆盖（模板层解析要带上它） */
const typeGlobalOverrides = ref<ApprovalTypeOverrideMap>({})
/** 当前作用域的覆盖 */
const typeOverrides = ref<ApprovalTypeOverrideMap>({})
/** 当前作用域有没有任何覆盖 */
const typeCustom = ref(false)
const typeLoading = ref(false)
/**
 * 取过一次就不再重复取：同一次停留里来回切页签不必重复打三个接口
 * （从详情页返回时本页会重建，那时自然会重新取，不该省 —— 刚在详情页改过）。
 */
const typeLoaded = ref(false)

const typeScope = computed<ApprovalTypeScope>(() => (typeScopeKey.value === 'global'
  ? { kind: 'global' }
  : { kind: 'template', templateId: typeScopeKey.value }))

/**
 * 作用域下拉："某张模板"那一段**直接用模板页签已经取回来的那份数据**（`chians`）。
 *
 * 这里曾经踩过一个坑：原先另调了一次 `getApprovalOptions()`，它和 `getDatas()` 里的
 * `getApproval()` 是**同一个请求**（同集合、同 `sort`），而 PocketBase SDK 默认开着自动取消、
 * 默认键不含查询串 —— 后发的那条会把先发的 abort 掉。本页带 `?tab=type` 挂载时
 * （从审批类型详情页返回就是这么进来的）两个请求恰好并发，`getApproval()` 被顶掉后
 * 走进它的 catch 兜成空数组，表现就是**「审批模板」页签整个空白**。
 * 根因已按 `utils/pbRequestKeys` 的口径修掉（两条各有各的键），
 * 但这里仍然复用 `chians`：更省一次请求，且下拉与表格必然同源、不会出现"下拉里有、表格里没有"。
 * ⚠️ 所以**别**为了"独立性"把 `getApprovalOptions()` 加回来。
 */
const typeScopeItems = computed(() => [
  { value: 'global', title: '默认（所有审批模板）' },
  ...chians.value.map(t => ({ value: t.id, title: String(t.name ?? '') || '(未命名模板)' })),
])

/** 解析某一层要带的层级（全局层永远在前面），口径与详情页一致 */
const typeLayers = computed(() => (typeScope.value.kind === 'global'
  ? [typeGlobalOverrides.value]
  : [typeGlobalOverrides.value, typeOverrides.value]))

const typeRows = computed(() => resolveTypeTemplates(typeLayers.value).map(t => ({
  code: t.code,
  name: t.name,
  category: typeCategoryOf(t.code),
  // 摘要口径与详情页左列表共用同一处（见 utils/approvalTypes 的 typeFieldsSummaryOf）
  summary: typeFieldsSummaryOf(t.fields),
  enabled: t.enabled !== false,
  overridden: typeOverrides.value[t.code] !== undefined,
})))

const typeHeaders = [
  { title: '审批类型', key: 'name' },
  { title: '分组', key: 'category' },
  { title: '要填什么', key: 'summary' },
  { title: '当前层', key: 'overridden' },
  { title: '状态', key: 'enabled' },
  { title: '操作', key: 'action', align: 'start' },
] as const

/**
 * 取数序号：**只认最后一次发起的那轮**。
 *
 * 为什么要它：切作用域切得快时会有两轮同时在跑。SDK 会把同键的旧请求取消（见 pocketbase.ts），
 * 被取消的那轮读到的覆盖是空的，而它**未必先返回** —— 一旦它后返回，就会把新一轮的结果盖成
 * "全部默认"，而且下拉显示的作用域与列表里的覆盖还不是同一层，看着莫名其妙。
 * 序号一挡，过期那轮直接不写状态。
 */
let typeLoadSeq = 0

async function loadTypeData() {
  const seq = ++typeLoadSeq
  typeLoading.value = true
  try {
    const global = (await loadApprovalTypeOverrides({ kind: 'global' })).overrides
    const row = await loadApprovalTypeOverrides(typeScope.value)
    if (seq !== typeLoadSeq) {
      return
    }
    typeGlobalOverrides.value = global
    typeOverrides.value = row.overrides
    typeCustom.value = row.custom
    typeLoaded.value = true
  } finally {
    if (seq === typeLoadSeq) {
      typeLoading.value = false
    }
  }
}

/**
 * 去「审批类型」详情页改这一条。
 *
 * 作用域与结论码都放地址上：详情页据此定位到**同一层、同一条**（见 approvalTypeSetting 的
 * initialScopeKey / initialCode），返回时也才回到"刚才那个作用域"的列表。
 */
function goEditType(code: string) {
  router.push({
    path: '/approvalTypeSetting',
    query: { scope: typeScopeKey.value, code },
  })
}

watch(typeScopeKey, () => {
  void loadTypeData()
})

/**
 * 顶部页签 → 地址（`?tab=type`），并在首次切过来时取数。
 *
 * 为什么页签要写进地址：详情页的返回是 `$router.back()`，只有地址里记着页签，
 * 回来时才知道该停在「审批类型」而不是默认的「审批模板」。
 * 只搬字符串型参数：`route.query` 里可能有数组 / null，直接透传与 LocationQueryRaw 的类型对不上。
 */
watch(topTab, value => {
  const query: Record<string, string> = {}
  for (const [key, item] of Object.entries(route.query)) {
    if (typeof item === 'string') {
      query[key] = item
    }
  }
  if (value === 'type') {
    query.tab = 'type'
    if (!typeLoaded.value) {
      void loadTypeData()
    }
  } else {
    delete query.tab
  }
  router.replace({ query })
})

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
onMounted(() => {
  getDatas()
  /*
   * 带 `?tab=type` 打开、或从「审批类型」详情页返回时，页签**没有发生变化**，
   * 上面那个 watch(topTab) 不会触发，所以首次的取数要在这里补上。
   */
  if (topTab.value === 'type') {
    void loadTypeData()
  }
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

/* 「审批类型」页签里的作用域下拉：定宽，别被 flex 拉满把右边的提示挤走 */
.type-scope-select {
  max-width: 260px;
}

/** 结论码（审批类型列表里跟在名字后面的那一小块） */
.type-code {
  padding: 0 4px;
  font-size: 11px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  border-radius: 4px;
}

/*
 * 顶部页签（审批模板 / 审批类型）—— 这是**页面级**的分区，和底部 `.sheet-tabs`
 * （Excel sheet 那种"贴在数据上的书签"）不是一回事，所以样式不复用：这里是常规胶囊页签。
 */
.top-tabs :deep(.v-slide-group__content) {
  gap: 6px;
}

.top-tabs :deep(.v-tab) {
  min-width: 0;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-weight: 500;
  text-transform: none;
}

.top-tabs :deep(.v-tab--selected) {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
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
