<template>
  <v-container class="page-bg pt-10" fluid>
    <!-- 页头：作用域（默认 / 某张审批模板）+ 是否已自定义 -->
    <div class="d-flex align-start justify-space-between flex-wrap ga-3 mb-4 px-1">
      <div>
        <BackNode title="审批类型" />
        <div class="text-[12px] text-medium-emphasis mt-1">
          每种审批结论"**选中之后要填什么**"在这里配：控件（下拉 / 单选 / 数量 / 文本…）、字段、必填与校验。
        </div>

        <div class="text-[11px] text-medium-emphasis mt-1">
          默认对**所有**审批模板生效；也可以只覆盖某一张模板。没配的项自动沿用上一层（内置默认 → 全局 → 模板）。
        </div>
      </div>

      <div class="d-flex align-center ga-2">
        <v-select v-model="scopeKey" class="scope-select filter-input" density="compact" hide-details item-title="title"
          item-value="value" :items="scopeItems" variant="outlined">
          <template #item="{ item, props }">
            <v-list-item v-bind="props">
              <template #title>
                <span class="scope-option">{{ item.title }}</span>
              </template>
            </v-list-item>
          </template>
        </v-select>

        <v-chip :color="custom ? 'primary' : undefined" label size="small" variant="tonal">
          {{ custom ? '已自定义' : '默认' }}
        </v-chip>
      </div>
    </div>

    <v-row dense>
      <v-col cols="4">
        <v-sheet rounded="15" class="card-border pt-2 px-4 pb-4">
          <div class="d-flex align-center ga-2 px-4 py-3">
            <v-avatar color="primary" size="30" variant="tonal">
              <v-icon size="16">mdi-tag-multiple-outline</v-icon>
            </v-avatar>
            <div class="flex-grow-1">
              <div class="text-[13px] font-weight-medium">审批结论</div>
              <div class="text-[11px] text-medium-emphasis">共 {{ typeRows.length }} 个（沿用现有结论码）</div>
            </div>
          </div>
          <v-divider />
          <div class="type-list px-2 py-2">
            <template v-for="group in groupedTypes" :key="group.title">
              <div class="type-group-title">{{ group.title }}</div>
              <button v-for="row in group.items" :key="row.code" class="type-item"
                :class="{ 'type-item-active': row.code === selectedCode }" type="button" @click="selectCode(row.code)">
                <span class="type-item-name">
                  {{ row.name }}
                  <v-icon v-if="row.overridden" color="primary" size="11" title="这一层已自定义">mdi-pencil-circle</v-icon>
                  <v-icon v-if="row.disabled" color="warning" size="11" title="已停用">mdi-eye-off-outline</v-icon>
                </span>
                <span class="type-item-meta">{{ row.summary }}</span>
              </button>
            </template>
          </div>
        </v-sheet>
      </v-col>
      <v-col cols="8">
        <v-sheet rounded="15" class="card-border pt-2 px-4 pb-4">
          <div class="d-flex align-center ga-3 px-4 py-3 flex-wrap">
            <v-avatar color="primary" size="30" variant="tonal">
              <v-icon size="16">mdi-tune-variant</v-icon>
            </v-avatar>
            <div class="flex-grow-1">
              <div class="text-[13px] font-weight-medium">
                {{ selectedTemplate?.name || '—' }}
                <span class="text-[11px] text-medium-emphasis ml-1">{{ selectedCode }}</span>
              </div>

              <div class="text-[11px] text-medium-emphasis">
                {{ scopeKey === 'global' ? '全局默认' : `仅对「${scopeTitle}」生效` }}
              </div>
            </div>

            <v-switch v-model="curEnabled" color="primary" density="compact" hide-details
              :label="curEnabled ? '启用' : '停用'" @update:model-value="markDirty" />
          </div>
          <v-divider />
          <div class="px-4 py-4">
            <!-- 办理提示 -->
            <div class="field-title mb-2">办理提示</div>
            <v-text-field v-model="curNote" density="compact" hide-details placeholder="给办理人的一句话（可留空）"
              variant="outlined" @update:model-value="markDirty" />

            <!-- 内置行为（只读：副作用在代码里，不开放编排） -->
            <template v-if="builtinEffects.length > 0 || builtinFixed">
              <div class="field-title mt-4 mb-2">内置行为（只读）</div>

              <div class="d-flex flex-wrap ga-2">
                <v-chip v-for="e in builtinEffects" :key="e.value" color="info" label size="small" :title="e.hint"
                  variant="tonal">{{ e.title }}</v-chip>

                <v-chip v-if="builtinFixed" color="warning" label size="small" variant="tonal">
                  选中即写入：{{ builtinFixed }}
                </v-chip>
              </div>
            </template>

            <!-- 字段编排 -->
            <div class="d-flex align-center mt-4 mb-2">
              <div class="field-title">字段（选中这个结论后要填的东西）</div>
              <v-spacer />
              <v-btn class="text-none" color="primary" prepend-icon="mdi-plus" size="small" variant="tonal"
                @click="addField">加字段</v-btn>
            </div>
            <div v-if="curFields.length === 0" class="type-empty">
              这个结论不额外要东西（只填备注 / 附件，它们对所有结论都有）
            </div>
            <v-expansion-panels v-else class="field-panels" variant="accordion" rounded="5">
              <v-expansion-panel v-for="(field, i) in curFields" :key="field.key + i">
                <v-expansion-panel-title>
                  <div class="d-flex align-center ga-2 flex-wrap">
                    <span class="text-[13px] font-weight-medium">{{ field.label || '(未命名)' }}</span>
                    <code class="field-key">{{ field.key }}</code>
                    <span class="text-[11px] text-medium-emphasis">{{ fieldSummaryOf(field) }}</span>
                  </div>
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <v-row dense>
                    <v-col cols="12" md="6">
                      <div class="field-title mb-1">键名（写进 extra 的键）</div>
                      <v-text-field v-model="field.key" density="compact" hide-details variant="outlined"
                        @update:model-value="markDirty" />
                    </v-col>
                    <v-col cols="12" md="6">
                      <div class="field-title mb-1">界面文案</div>

                      <v-text-field v-model="field.label" density="compact" hide-details variant="outlined"
                        @update:model-value="markDirty" />
                    </v-col>

                    <v-col cols="12" md="6">
                      <div class="field-title mb-1">控件</div>

                      <v-select v-model="field.control" density="compact" hide-details item-title="title"
                        item-value="value" :items="controlItems" :menu-props="{ contentClass: 'filter-menu' }"
                        variant="outlined" @update:model-value="markDirty" />

                      <div class="text-[11px] text-medium-emphasis mt-1">{{ controlHintOf(field.control) }}</div>
                    </v-col>

                    <v-col v-if="field.control === 'number' || field.control === 'text'" cols="12" md="3">
                      <div class="field-title mb-1">后缀</div>

                      <v-text-field v-model="field.unit" density="compact" hide-details placeholder="件 / ￥"
                        variant="outlined" @update:model-value="markDirty" />
                    </v-col>

                    <v-col v-if="field.control === 'textarea'" cols="12" md="3">
                      <div class="field-title mb-1">行数</div>

                      <v-text-field v-model.number="field.rows" density="compact" hide-details type="number"
                        variant="outlined" @update:model-value="markDirty" />
                    </v-col>

                    <v-col cols="12" md="3">
                      <div class="field-title mb-1">必填</div>

                      <v-switch v-model="field.required" color="primary" density="compact" hide-details
                        @update:model-value="markDirty" />
                    </v-col>

                    <v-col cols="12" md="6">
                      <div class="field-title mb-1">占位提示</div>

                      <v-text-field v-model="field.placeholder" density="compact" hide-details variant="outlined"
                        @update:model-value="markDirty" />
                    </v-col>

                    <v-col cols="12" md="6">
                      <div class="field-title mb-1">字段说明（显示在控件下方）</div>

                      <v-text-field v-model="field.hint" density="compact" hide-details variant="outlined"
                        @update:model-value="markDirty" />
                    </v-col>

                    <!-- 数字规则 -->
                    <template v-if="field.control === 'number'">
                      <v-col cols="12" md="3">
                        <div class="field-title mb-1">只允许正整数</div>

                        <v-switch v-model="field.integer" color="primary" density="compact" hide-details
                          @update:model-value="markDirty" />
                      </v-col>

                      <v-col cols="12" md="3">
                        <div class="field-title mb-1">最多小数位</div>

                        <v-text-field v-model.number="field.decimals" density="compact" hide-details placeholder="2"
                          type="number" variant="outlined" @update:model-value="markDirty" />
                      </v-col>

                      <v-col cols="12" md="6">
                        <div class="field-title mb-1">必须小于</div>

                        <v-select v-model="field.limit" clearable density="compact" hide-details item-title="title"
                          item-value="value" :items="limitItems" :menu-props="{ contentClass: 'filter-menu' }"
                          placeholder="不限制" variant="outlined" @update:model-value="markDirty" />
                      </v-col>

                      <v-col cols="12" md="6">
                        <div class="field-title mb-1">按上限预填（空值时）</div>

                        <v-switch v-model="field.prefillFromLimit" color="primary" density="compact" hide-details
                          @update:model-value="markDirty" />
                      </v-col>

                      <v-col cols="12" md="6">
                        <div class="field-title mb-1">取到上限后只读</div>

                        <v-switch v-model="field.readonlyWhenFull" color="primary" density="compact" hide-details
                          @update:model-value="markDirty" />
                      </v-col>
                    </template>

                    <!-- 选接收方 -->
                    <v-col v-if="field.control === 'team'" cols="12" md="6">
                      <div class="field-title mb-1">选到哪一级</div>

                      <v-select v-model="field.pick" density="compact" hide-details item-title="title"
                        item-value="value" :items="pickItems" :menu-props="{ contentClass: 'filter-menu' }"
                        variant="outlined" @update:model-value="markDirty" />
                    </v-col>

                    <!-- 联动显隐 -->
                    <v-col cols="12" md="6">
                      <div class="field-title mb-1">联动：当这个键</div>

                      <v-text-field density="compact" hide-details :model-value="field.showWhen?.key ?? ''"
                        placeholder="如 reason_belong" variant="outlined"
                        @update:model-value="v => setShowKey(field, String(v))" />
                    </v-col>

                    <v-col cols="12" md="6">
                      <div class="field-title mb-1">取值是（逗号分隔；键与取值都填才生效）</div>

                      <v-text-field density="compact" hide-details :model-value="(field.showWhen?.in ?? []).join(',')"
                        placeholder="如 开发类" variant="outlined" @update:model-value="v => setShowIn(field, v)" />
                    </v-col>

                    <!-- 选项候选 -->
                    <v-col v-if="usesOptions(field)" cols="12">
                      <div class="d-flex align-center mb-1">
                        <div class="field-title">选项</div>
                        <v-spacer />

                        <v-btn class="text-none" prepend-icon="mdi-plus" size="x-small" variant="text"
                          @click="addOption(field)">加选项</v-btn>
                      </div>

                      <div v-for="(opt, k) in field.options ?? []" :key="k" class="option-row">
                        <v-text-field v-model="opt.value" density="compact" hide-details label="值" variant="outlined"
                          @update:model-value="markDirty" />

                        <v-text-field v-model="opt.label" density="compact" hide-details label="显示文案" variant="outlined"
                          @update:model-value="markDirty" />

                        <v-text-field v-model="opt.group" density="compact" hide-details label="分组" variant="outlined"
                          @update:model-value="markDirty" />

                        <v-text-field density="compact" hide-details label="附带写入(JSON)"
                          :model-value="optionDataText(opt)"
                          :rules="[v => optionDataOk(String(v)) || 'JSON 不合法（留空表示不写）']" variant="outlined"
                          @update:model-value="v => setOptionData(opt, String(v))" />

                        <v-icon-btn color="error" icon="mdi-delete-outline" size="small" variant="text"
                          @click="removeOption(field, k)" />
                      </div>

                      <div class="text-[11px] text-medium-emphasis mt-1">
                        「附带写入」用于一项带出多个键（如原因要一起记 reason_target / reason_belong），
                        写成 <code>{"reason_target":"xxx"}</code>
                      </div>
                    </v-col>
                  </v-row>

                  <div class="d-flex align-center ga-2 mt-2">
                    <v-btn class="text-none" prepend-icon="mdi-arrow-up" size="x-small" variant="text"
                      @click="moveField(i, -1)">上移</v-btn>

                    <v-btn class="text-none" prepend-icon="mdi-arrow-down" size="x-small" variant="text"
                      @click="moveField(i, 1)">下移</v-btn>

                    <v-spacer />

                    <v-btn class="text-none" color="error" prepend-icon="mdi-delete-outline" size="x-small"
                      variant="text" @click="removeField(i)">删掉这个字段</v-btn>
                  </div>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>

            <!-- 预览 -->
            <div class="d-flex align-center mt-5 mb-2">
              <div class="field-title">预览</div>
              <v-spacer />

              <v-btn class="text-none" prepend-icon="mdi-restore" size="x-small" variant="text"
                @click="resetPreview">重置预览</v-btn>
            </div>

            <v-sheet class="preview-box pa-4" rounded="lg">
              <OptionFormRenderer v-model="previewValues" :context="previewContext" :fields="curFields"
                @pick="onPick" />
            </v-sheet>

            <v-row class="mt-3" dense>
              <v-col v-for="item in contextItems" :key="item.key" cols="6" md="3">
                <div class="field-title mb-1">{{ item.title }}</div>

                <v-text-field v-model="previewContext[item.key]" density="compact" hide-details variant="outlined" />
              </v-col>
            </v-row>

            <div class="text-[11px] text-medium-emphasis mt-2">
              上面的数字只是**预览用的假数据**（真实办理时取自当前单据的库存/已接收数量）。
            </div>
          </div>

          <v-divider />

          <div class="d-flex align-center flex-wrap ga-2 px-4 py-3">
            <span class="text-[11px] text-medium-emphasis">
              「恢复默认」= 删掉{{ scopeKey === 'global' ? '全局' : '这张模板' }}上对「{{ selectedTemplate?.name }}」的覆盖
            </span>

            <v-spacer />

            <v-btn class="text-none" :loading="resettingCode" variant="text" @click="resetSelectedCode">
              恢复默认
            </v-btn>
          </div>
        </v-sheet>
      </v-col>
    </v-row>

    <!-- 底部动作条 -->
    <v-sheet class="d-flex align-center flex-wrap ga-3 mt-4 card-border p-4" rounded="15">
      <div class="text-[11px] text-medium-emphasis">
        {{ dirtyCount > 0 ? `有 ${dirtyCount} 个结论改动还没保存` : '没有未保存的改动' }}
      </div>

      <v-spacer />

      <v-btn class="text-none" variant="text" @click="confirmReset = true">整层恢复默认</v-btn>

      <v-btn color="primary" :disabled="loading || dirtyCount === 0" :loading="saving" variant="flat"
        @click="save">保存</v-btn>
    </v-sheet>

    <!-- 整层恢复默认 -->
    <v-dialog v-model="confirmReset" max-width="440">
      <v-card>
        <v-card-title class="text-[15px]">整层恢复默认？</v-card-title>

        <v-card-text class="text-[13px]">
          会删掉{{ scopeKey === 'global' ? '**全局**' : `「${scopeTitle}」上` }}的全部审批类型覆盖，
          之后按内置默认（= 现在的办理表单）走。这一步不能撤销。
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmReset = false">取消</v-btn>
          <v-btn color="error" :loading="resetting" variant="flat" @click="runReset">确认恢复</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="hint.show" :color="hint.color" location="top" timeout="3000" variant="tonal">
      {{ hint.text }}
    </v-snackbar>
  </v-container>
</template>

<script lang="ts" setup>
import type { ApprovalTypeOverrideMap, ApprovalTypeTemplate, TypeControl, TypeField, TypeFieldOption } from '@/utils/approvalTypes'
import type { ApprovalTypeScope } from '@/utils/approvalTypeStore'
import OptionFormRenderer from '@/components/approval/OptionFormRenderer.vue'
import { useUserStore } from '@/stores/user'
import BackNode from '@/components/BackNode.vue'
import {
  DEFAULT_TYPE_TEMPLATES,
  fieldSummaryOf,
  normalizeTypeFields,
  resolveTypeTemplate,
  resolveTypeTemplates,
  TYPE_CONTROL_OPTIONS,
  TYPE_EFFECTS,
  TYPE_LIMIT_OPTIONS,
  typeCategoryOf,
  typeFieldsSummaryOf,
} from '@/utils/approvalTypes'
import {
  approvalTypeWriteHint,
  loadApprovalTypeOverrides,
  resetApprovalTypeScope,
  saveApprovalTypeOverride,
} from '@/utils/approvalTypeStore'
import { getApprovalOptions } from '@/utils/collection'
import { canAccess } from '@/utils/permissions'

/**
 * 「审批类型」设置页（见 utils/approvalTypes 的文件头）。
 *
 * 结构：左边 22 个结论码（按用途分组）→ 右边编排该结论的字段 + 实时预览。
 * 作用域是"默认（全局）"或"某一张审批模板"：模板级能覆盖全局，全局能覆盖内置默认。
 *
 * ⚠️ 本期只做**配置与预览**：办理页仍走原实现（components/ApprovalNode.vue 的 v-if 那一套），
 * 等切换那一步做完这份配置才真正生效（切换时必须逐条比对渲染结果与写入的 extra 字段）。
 */
const route = useRoute()
const userStore = useUserStore()

/**
 * 从「审批模型」页的「审批类型」列表点「编辑」进来时，地址上带着定位：
 *   · `scope` = `global` 或某张模板的 id（要改哪一层的覆盖）；
 *   · `code`  = 要编辑的结论码。
 * 直接打开 / 刷新这一页时两者都可能没有，那就按原来的默认走
 * （全局层 + 下面 buildDraft 里"第一条真的要让办的人填东西"的结论）。
 */
const initialScopeKey = (typeof route.query.scope === 'string' && route.query.scope) || 'global'
const initialCode = typeof route.query.code === 'string' ? route.query.code : ''

/** 页面权限与路由守卫用同一份口径（'/'approvalTypeSetting' 在 utils/permissions 里登记为管理员及以上） */
const canEdit = computed(() => canAccess(userStore.appRole, '/approvalTypeSetting'))

const loading = ref(false)
const saving = ref(false)
const resetting = ref(false)
const resettingCode = ref(false)
const confirmReset = ref(false)
const hint = ref<{ show: boolean, text: string, color: 'success' | 'error' | 'warning' }>({
  show: false,
  text: '',
  color: 'success',
})

function showHint(text: string, color: 'success' | 'error' | 'warning' = 'warning') {
  hint.value = { show: true, text, color }
}

// ===== 作用域 =====

/** 审批模板列表（全量；`getApprovalOptions` 就是"取全部模板精简列表"那个函数） */
const templates = ref<{ id: string, name: string }[]>([])
const scopeKey = ref(initialScopeKey)

const scopeItems = computed(() => [
  { value: 'global', title: '默认（所有审批模板）' },
  ...templates.value.map(t => ({ value: t.id, title: t.name || '(未命名模板)' })),
])

const scope = computed<ApprovalTypeScope>(() => (scopeKey.value === 'global'
  ? { kind: 'global' }
  : { kind: 'template', templateId: scopeKey.value }))

const scopeTitle = computed(() => scopeItems.value.find(i => i.value === scopeKey.value)?.title ?? '')

// ===== 数据 =====

/** 全局层的覆盖（模板层的解析要带上它） */
const globalOverrides = ref<ApprovalTypeOverrideMap>({})
/** 当前层的覆盖（用于「已覆盖」标记与"恢复默认"） */
const overrides = ref<ApprovalTypeOverrideMap>({})
const custom = ref(false)
/** 编辑中的覆盖：每个结论码一份（初值 = 解析后的"最终模板"，改哪条就标记哪条脏） */
const draft = ref<ApprovalTypeOverrideMap>({})
const dirty = ref<Record<string, boolean>>({})

const selectedCode = ref(initialCode || DEFAULT_TYPE_TEMPLATES[0]?.code || '')

const typeRows = computed(() => DEFAULT_TYPE_TEMPLATES.map(t => {
  const d = draft.value[t.code]
  return {
    code: t.code,
    name: t.name,
    disabled: d?.enabled === false,
    overridden: overrides.value[t.code] !== undefined,
    // 摘要口径与列表页共用同一处（见 utils/approvalTypes 的 typeFieldsSummaryOf）
    summary: typeFieldsSummaryOf(d?.fields),
    category: typeCategoryOf(t.code),
  }
}))

const groupedTypes = computed(() => {
  const map = new Map<string, typeof typeRows.value>()
  for (const row of typeRows.value) {
    map.set(row.category, [...(map.get(row.category) ?? []), row])
  }
  return [...map.entries()].map(([title, items]) => ({ title, items }))
})

/** 解析某一层时要用的层级（全局层永远在前面） */
const layers = computed(() => (scope.value.kind === 'global'
  ? [globalOverrides.value]
  : [globalOverrides.value, overrides.value]))

/** 选中结论的最终模板（含内置默认，用于显示名字与内置行为） */
const selectedTemplate = computed<ApprovalTypeTemplate>(() => resolveTypeTemplate(selectedCode.value, layers.value))

const curFields = computed<TypeField[]>(() => draft.value[selectedCode.value]?.fields ?? [])

const curNote = computed({
  get: () => draft.value[selectedCode.value]?.note ?? '',
  set: (v: string) => {
    const cur = draft.value[selectedCode.value]
    if (cur) {
      cur.note = v
    }
  },
})

const curEnabled = computed({
  get: () => draft.value[selectedCode.value]?.enabled !== false,
  set: (v: boolean) => {
    const cur = draft.value[selectedCode.value]
    if (cur) {
      cur.enabled = v
    }
  },
})

const builtinEffects = computed(() => (selectedTemplate.value.effects ?? [])
  .map(v => TYPE_EFFECTS.find(e => e.value === v) ?? { value: v, title: v, hint: '' }))

const builtinFixed = computed(() => {
  const fixed = selectedTemplate.value.fixedValues
  if (!fixed) return ''
  return Object.entries(fixed).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('，')
})

const dirtyCount = computed(() => Object.keys(dirty.value).length)

function markDirty() {
  if (!canEdit.value || !selectedCode.value) return
  dirty.value = { ...dirty.value, [selectedCode.value]: true }
}

// ===== 读 / 写 =====

/** 用"解析后的最终模板"铺一份编辑草稿（编辑看到的起点就是办理时真正生效的那份） */
function buildDraft() {
  const next: ApprovalTypeOverrideMap = {}
  for (const t of resolveTypeTemplates(layers.value)) {
    next[t.code] = {
      // 深拷一份再编：编辑草稿不能反过来改到"解析结果"（它每次都由 buildDraft 重新算）
      fields: structuredClone(t.fields ?? []),
      note: t.note ?? '',
      enabled: t.enabled !== false,
    }
  }
  draft.value = next
  dirty.value = {}
  // 首次进来落在"第一个真的要让办的人填东西"的结论上，比停在「通过」更有信息量
  // （`fields` 在覆盖类型里是可选的，用 `?.length ?? 0` 取，别直接 `.length`）
  //
  // ⚠️ 从列表点「编辑」进来的（地址上带了 `code`）**不能**被这一步顶掉：
  // 那一条就是用户要改的，哪怕它眼下"不需要额外填写"，也得停在它上面。
  if (!initialCode && (next[selectedCode.value]?.fields?.length ?? 0) === 0) {
    const withFields = DEFAULT_TYPE_TEMPLATES.find(t => (next[t.code]?.fields?.length ?? 0) > 0)
    if (withFields) {
      selectedCode.value = withFields.code
    }
  }
  resetPreview()
}

async function reload() {
  loading.value = true
  try {
    templates.value = await getApprovalOptions()
    /*
     * 地址上带来的那张模板可能已经被删了（在列表页点「编辑」时它还在）：
     * 落回全局层，别停在一个下拉里选不出来的 scope 上。
     *
     * 这里直接改 scopeKey 会触发 watch(scopeKey) 再跑一轮 —— 而那一轮里 scopeKey 已经是
     * 'global'、不会再改，所以最多多跑一轮就收敛，不会来回打转。
     * （改完 scope 这个 computed 已经同步更新，下面读的就是全局层的覆盖，口径不会串。）
     */
    if (scopeKey.value !== 'global' && !templates.value.some(t => t.id === scopeKey.value)) {
      scopeKey.value = 'global'
    }
    globalOverrides.value = (await loadApprovalTypeOverrides({ kind: 'global' })).overrides
    const row = await loadApprovalTypeOverrides(scope.value)
    overrides.value = row.overrides
    custom.value = row.custom
    buildDraft()
  } finally {
    loading.value = false
  }
}

async function save() {
  const codes = Object.keys(dirty.value).filter(code => draft.value[code])
  if (codes.length === 0) {
    showHint('没有需要保存的改动')
    return
  }
  saving.value = true
  try {
    for (const code of codes) {
      const d = draft.value[code]!
      await saveApprovalTypeOverride(scope.value, code, {
        fields: normalizeTypeFields(d.fields),
        note: d.note ?? '',
        enabled: d.enabled !== false,
      })
    }
    await reload()
    showHint(`已保存 ${codes.length} 个审批类型`, 'success')
  } catch (error) {
    console.error('[approvalTypeSetting] 保存审批类型失败:', error)
    showHint(approvalTypeWriteHint(error), 'error')
  } finally {
    saving.value = false
  }
}

/** 「恢复默认」= 删掉**当前层**对这一条结论的覆盖（回到上一层） */
async function resetSelectedCode() {
  resettingCode.value = true
  try {
    await saveApprovalTypeOverride(scope.value, selectedCode.value, null)
    await reload()
    showHint(`「${selectedTemplate.value.name}」已恢复默认`, 'success')
  } catch (error) {
    console.error('[approvalTypeSetting] 恢复默认失败:', error)
    showHint(approvalTypeWriteHint(error), 'error')
  } finally {
    resettingCode.value = false
  }
}

async function runReset() {
  resetting.value = true
  try {
    await resetApprovalTypeScope(scope.value)
    await reload()
    confirmReset.value = false
    showHint('已整层恢复默认', 'success')
  } catch (error) {
    console.error('[approvalTypeSetting] 整层恢复默认失败:', error)
    showHint(approvalTypeWriteHint(error), 'error')
  } finally {
    resetting.value = false
  }
}

// ===== 字段编排 =====

const controlItems = TYPE_CONTROL_OPTIONS.map(o => ({ value: o.value, title: o.title }))
const limitItems = TYPE_LIMIT_OPTIONS.map(o => ({ value: o.value, title: o.title }))
const pickItems = [
  { value: 'group', title: '组别（记组长）' },
  { value: 'team', title: '团队（记负责人）' },
]

function controlHintOf(control: TypeControl): string {
  return TYPE_CONTROL_OPTIONS.find(o => o.value === control)?.hint ?? ''
}

/** 只有选项类 / 自动类控件才有"选项候选" */
function usesOptions(field: TypeField): boolean {
  return (['select', 'radio', 'auto'] as TypeControl[]).includes(field.control)
}

function selectCode(code: string) {
  selectedCode.value = code
  resetPreview()
}

function addField() {
  const fields = draft.value[selectedCode.value]?.fields
  if (!fields) return
  fields.push({ key: `field_${fields.length + 1}`, label: '新字段', control: 'text' })
  markDirty()
}

function removeField(index: number) {
  const fields = draft.value[selectedCode.value]?.fields
  if (!fields) return
  fields.splice(index, 1)
  markDirty()
}

function moveField(index: number, delta: number) {
  const fields = draft.value[selectedCode.value]?.fields
  if (!fields) return
  const to = index + delta
  if (to < 0 || to >= fields.length) return
  const [item] = fields.splice(index, 1)
  fields.splice(to, 0, item!)
  markDirty()
}

function addOption(field: TypeField) {
  if (!field.options) {
    field.options = []
  }
  field.options.push({ value: '', label: '' })
  markDirty()
}

function removeOption(field: TypeField, index: number) {
  field.options?.splice(index, 1)
  markDirty()
}

/** 联动取值（逗号/顿号分隔，与项目里其它多值输入同一口径） */
function setShowIn(field: TypeField, raw: string) {
  const list = String(raw ?? '').split(/[,，、]/).map(s => s.trim()).filter(Boolean)
  if (list.length === 0) {
    delete field.showWhen
  } else {
    field.showWhen = { key: field.showWhen?.key ?? '', in: list }
  }
  markDirty()
}

/**
 * 联动的"当这个键"。
 *
 * ⚠️ 键与取值**必须都填**才算一条联动（收敛时也是这么判的）：只填了键的话这个字段在预览里
 * 会一直不显示 —— 那正是它该有的行为（条件永远不成立），页面上紧挨着就是"取值是"那一格。
 */
function setShowKey(field: TypeField, raw: string) {
  const key = String(raw ?? '').trim()
  if (!key) {
    delete field.showWhen
    markDirty()
    return
  }
  field.showWhen = { key, in: field.showWhen?.in ?? [] }
  markDirty()
}

/** 选项的"附带写入"：JSON 文本 ↔ data（写坏了不落库，只在输入框上提示） */
function optionDataText(option: TypeFieldOption): string {
  return option.data && Object.keys(option.data).length > 0 ? JSON.stringify(option.data) : ''
}

function optionDataOk(raw: string): boolean {
  const text = raw.trim()
  if (!text) return true
  try {
    const parsed = JSON.parse(text)
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
  } catch {
    return false
  }
}

function setOptionData(option: TypeFieldOption, raw: string) {
  const text = String(raw ?? '').trim()
  if (!text) {
    delete option.data
    markDirty()
    return
  }
  if (!optionDataOk(text)) {
    return
  }
  const parsed = JSON.parse(text) as Record<string, unknown>
  option.data = parsed
  markDirty()
}

// ===== 预览 =====

/** 预览用的假数据：够让"剩余/上限/联动"看得见（真实值来自单据） */
const previewContext = ref<Record<string, string>>({
  stockQty: '1000',
  remainingQty: '600',
  receivedQty: '400',
  stockAmount: '12000',
})
const previewValues = ref<Record<string, unknown>>({})

const contextItems = [
  { key: 'stockQty', title: '总库存数量' },
  { key: 'remainingQty', title: '剩余接收数量' },
  { key: 'receivedQty', title: '已接收数量' },
  { key: 'stockAmount', title: '总库存金额' },
] as const

function resetPreview() {
  previewValues.value = {}
}

function onPick() {
  showHint('预览里不会真的打开选人面板；办理时会按团队表筛选出组别 / 团队', 'warning')
}

// ===== 生命周期 =====

watch(scopeKey, () => {
  void reload()
})

onMounted(() => {
  void reload()
})
</script>

<style scoped>
.field-title {
  font-size: 12px;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.scope-select {
  width: 260px;
}

/*
 * 页内控件（v-text-field / v-select / v-textarea）里的字号统一 12px —— 与这一页其它小字一致。
 *
 * 为什么必须写 `:deep()`：字号不在组件根元素上，而在 Vuetify 内部的
 * `.v-field__input`（输入框里的字，下拉显示已选项用的也是它）/ `.v-label`（浮动标签）/
 * `.v-field__suffix`（后缀）上，它们不带本组件的 scope 属性。
 * 只管字号，不动内边距/高度 —— 输入框里的文字位置由 variant 决定（见 OptionFormRenderer）。
 */
.page-bg :deep(.v-field__input),
.page-bg :deep(.v-field__suffix),
.page-bg :deep(.v-label) {
  font-size: 12px;
}

/*
 * 作用域下拉的**下拉项**字号（见模板里的 item 插槽）。
 * 想调大小只改这一处：外面套着的 .v-list-item-title 自带 0.875rem，所以字号必须落在
 * 插槽里这个 span 上（写在外层 v-select 上会被它盖掉）。
 */
.scope-option {
  font-size: 12px;
}

/* ===== 左：结论码列表 ===== */
.type-list {
  max-height: 620px;
  overflow-y: auto;
}

.type-group-title {
  padding: 6px 10px 2px;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.type-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 6px 10px;
  text-align: left;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.type-item:hover {
  background: rgba(var(--v-theme-primary), 0.06);
}

.type-item-active {
  background: rgba(var(--v-theme-primary), 0.12);
}

.type-item-name {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--flow-text, rgb(var(--v-theme-on-surface)));
}

.type-item-meta {
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

/* ===== 右：字段编排 ===== */
.field-panels {
  margin-top: 2px;
}

.field-key {
  padding: 0 4px;
  font-size: 11px;
  color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.08);
  border-radius: 4px;
}

.option-row {
  display: grid;
  grid-template-columns: 1fr 1fr 90px 1fr 32px;
  gap: 6px;
  align-items: center;
  margin-bottom: 4px;
}

.type-empty {
  padding: 8px 2px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.preview-box {
  background: rgba(var(--v-theme-primary), 0.04);
  border: 1px dashed rgba(var(--v-theme-primary), 0.24);
}
</style>
