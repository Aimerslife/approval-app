<template>
  <v-container class="page-bg py-4" fluid>
    <!-- 页头 -->
    <div class="d-flex flex-wrap align-center ga-3 mb-2 px-1">
      <div class="block-title">流程沙盒</div>
      <v-chip color="warning" size="small" variant="tonal">只读 · 不落库 · 不发飞书 · 不占编号</v-chip>
      <v-spacer />

      <v-btn
        :loading="templatesLoading || rowsLoading"
        prepend-icon="mdi-refresh"
        size="small"
        variant="text"
        @click="reload"
      >
        重新读取
      </v-btn>
    </div>

    <div class="text-[12px] text-[#8B8B8B] mb-3 px-1">
      选一张模板 + 一行 BI 数据，就能把**建单期那条编译管线**再跑一遍（引用模板 → 数据查询 → 组间轮询 → 动态审批人），
      然后在这份内存快照上一步步推进：走向、待办人、分流条件、提醒对象与真实单据同源，但什么都不写库。
    </div>

    <v-row density="compact">
      <!-- ============ 左：模板 + 业务数据 ============ -->
      <v-col cols="12" lg="3" md="4">
        <v-sheet class="card-border pa-3 mb-3" rounded="10">
          <div class="panel-title">① 选审批模板</div>

          <v-select
            v-model="templateId"
            density="compact"
            hide-details
            item-title="name"
            item-value="id"
            :items="templates"
            :loading="templatesLoading"
            :menu-props="{ contentClass: 'filter-menu' }"
            placeholder="选择一张模板"
            variant="outlined"
            @update:model-value="onTemplate"
          />

          <div v-if="template" class="text-[11px] muted mt-2">
            状态：{{ template.status === 1 ? '启用' : '未启用' }} · 更新于 {{ fmtTime(template.updated) }}
          </div>

          <div v-if="template" class="text-[11px] muted mt-1">
            审批类型：{{ typesLoading ? '读取中…' : (typeCustom ? '已自定义（模板级覆盖）' : '默认') }}
          </div>

          <div v-else class="text-[11px] muted mt-2">模板列表读的是 app_chain（只读）。</div>
        </v-sheet>

        <v-sheet class="card-border pa-3" rounded="10">
          <div class="panel-title">② 选一行业务数据</div>

          <v-text-field
            v-model="rowKeyword"
            class="mb-2"
            density="compact"
            hide-details
            placeholder="SKU / 产品名称 / 团队"
            prepend-inner-icon="mdi-magnify"
            variant="outlined"
            @keyup.enter="searchRows"
          />

          <div v-if="rowsLoading" class="py-6 d-flex justify-center">
            <v-progress-circular indeterminate size="22" />
          </div>

          <v-list v-else class="row-list" density="compact" nav>
            <v-list-item
              v-for="row in rows"
              :key="rowKey(row)"
              :active="rowKey(row) === rowId"
              class="row-item"
              @click="onPickRow(row)"
            >
              <v-list-item-title class="text-[12px]">{{ rowTitle(row) }}</v-list-item-title>
              <v-list-item-subtitle class="text-[11px]">{{ rowSubtitle(row) }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>

          <div v-if="!rowsLoading && rows.length === 0" class="text-[12px] muted py-4 text-center">
            没有查到数据行
          </div>

          <div class="d-flex align-center justify-space-between mt-2">
            <v-btn :disabled="rowPage <= 1" size="x-small" variant="text" @click="goPage(rowPage - 1)">上一页</v-btn>
            <span class="text-[11px] muted">{{ rowPage }} / {{ pageCount }} 页 · 共 {{ rowTotal }} 行</span>

            <v-btn
              :disabled="rowPage >= pageCount"
              size="x-small"
              variant="text"
              @click="goPage(rowPage + 1)"
            >下一页</v-btn>
          </div>
        </v-sheet>
      </v-col>

      <!-- ============ 中：链路 + 当前环节 ============ -->
      <v-col cols="12" lg="6" md="8">
        <v-alert
          v-if="issues.length > 0"
          class="mb-3"
          density="compact"
          type="warning"
          variant="tonal"
        >
          <div class="font-bold mb-1">这份模板跑不通（沙盒的价值就在这儿：把原因摊开）</div>

          <ul class="pl-4">
            <li v-for="(msg, i) in issues" :key="i" class="text-[12px]">{{ msg }}</li>
          </ul>
        </v-alert>

        <v-alert
          v-if="runtimeError"
          class="mb-3"
          density="compact"
          type="error"
          variant="tonal"
        >
          链路重算抛错：{{ runtimeError }}
        </v-alert>

        <v-sheet v-if="flow" class="card-border pa-3" rounded="10">
          <div class="d-flex flex-wrap align-center ga-2 mb-2">
            <span class="panel-title mb-0">链路</span>
            <v-chip size="x-small" variant="tonal">{{ runtime?.stepIds.length ?? 0 }} 环</v-chip>
            <v-chip v-if="runtime?.done" color="success" size="x-small" variant="tonal">已结束</v-chip>
            <v-chip v-else color="primary" size="x-small" variant="tonal">进行中</v-chip>

            <v-spacer />

            <v-btn :disabled="decisions.length === 0" size="x-small" variant="text" @click="undo">撤回上一步</v-btn>
            <v-btn :disabled="decisions.length === 0" size="x-small" variant="text" @click="resetRun">从头再来</v-btn>
          </div>

          <!-- 业务上下文：分支条件就是拿它求值的，摊出来才能解释"为什么走这条" -->
          <div v-if="contextChips.length > 0" class="d-flex flex-wrap ga-1 mb-3">
            <v-chip v-for="[key, value] in contextChips" :key="key" size="x-small" variant="tonal">
              {{ key }}：{{ String(value) }}
            </v-chip>
          </div>

          <div class="steps">
            <div v-for="(step, i) in runtime?.chain ?? []" :key="i" class="step" :class="stepClass(i)">
              <div class="step-index">{{ i + 1 }}</div>

              <div class="min-w-0">
                <div class="d-flex flex-wrap align-center ga-2">
                  <span class="text-[13px] font-bold">{{ stepLabel(step, i) }}</span>

                  <v-chip
                    v-if="i === runtime?.currentStep && !runtime?.done"
                    color="primary"
                    size="x-small"
                    variant="flat"
                  >待办</v-chip>

                  <v-chip v-else-if="stepResultText(step)" size="x-small" variant="tonal">{{ stepResultText(step)
                  }}</v-chip>
                </div>

                <div class="text-[11px] muted mt-1">{{ memberNames(step) }}</div>

                <div v-if="stepOpinion(step)" class="text-[12px] mt-1">备注：{{ stepOpinion(step) }}</div>

                <div v-if="stepHandledAt(step)" class="text-[11px] muted mt-1">{{ fmtTime(stepHandledAt(step)) }}</div>
              </div>
            </div>
          </div>

          <div v-if="runtime?.end" class="end-note mt-3">
            <div class="text-[12px] font-bold">流程停下：{{ END_KIND_LABEL[runtime.end.kind] }}</div>
            <div class="text-[12px] mt-1">{{ runtime.end.reason }}</div>
            <div v-if="runtime.end.detail" class="text-[11px] muted mt-1">{{ runtime.end.detail }}</div>
          </div>
        </v-sheet>

        <v-sheet v-if="currentStepId && !runtime?.done" class="card-border pa-3 mt-3" rounded="10">
          <div class="panel-title">
            当前环节：{{ currentStepLabel }}
            <span v-if="building" class="text-[11px] muted">（构建中…）</span>
          </div>

          <div class="d-flex flex-wrap ga-1 mb-3">
            <v-chip v-for="(m, i) in currentMembers" :key="i" size="x-small" variant="outlined">
              {{ memberLabel(m) }}
            </v-chip>
          </div>

          <div class="text-[12px] muted mb-2">
            选一个结论推进（选项由模板里这一环的出线决定；只改内存，不写库）
          </div>

          <div class="d-flex flex-wrap ga-2 mb-3">
            <v-btn
              v-for="opt in visibleOptions"
              :key="`${opt.result}-${opt.text}`"
              :color="picked?.result === opt.result ? 'primary' : undefined"
              size="small"
              :variant="picked?.result === opt.result ? 'flat' : 'outlined'"
              @click="picked = opt"
            >
              {{ opt.text }}
            </v-btn>
          </div>

          <!-- 审批类型：选中这个结论后要填什么（数量 / 金额 / 原因 / 接收方…）由模板配置决定 -->
          <div v-if="pickedType" class="mb-3">
            <div v-if="pickedType.note" class="text-[11px] muted mb-1">{{ pickedType.note }}</div>

            <OptionFormRenderer
              v-if="pickedFields.length > 0"
              v-model="extraForm"
              :context="typeContext"
              :fields="pickedFields"
              @pick="onPickTeam"
            />

            <div v-else class="text-[12px] muted">这个结论不需要额外填写（只填备注）。</div>

            <!-- 字段是怎么配的：键名 / 控件 / 必填 / 上限 / 联动 —— 上面渲染器就是按这一行行画出来的 -->
            <div v-if="pickedFields.length > 0" class="field-detail mt-2">
              <div v-for="f in pickedFields" :key="f.key" class="text-[11px] muted">
                {{ f.label || f.key }}<span class="muted">（{{ f.key }}）</span> ·
                {{ controlText(f.control) }}{{ f.required ? ' · 必填' : '' }}{{ f.limit ? ` · 上限 ${limitText(f.limit)}` : '' }}{{ f.limit ? (f.limitInclusive === true ? '（可等于）' : '（须小于）') : '' }}{{ f.showWhen ? ` · 联动 ${f.showWhen.key}=${f.showWhen.in.join('/')}` : '' }}
              </div>
            </div>
          </div>

          <v-text-field
            v-model="opinion"
            density="compact"
            hide-details
            placeholder="备注（可选）"
            variant="outlined"
          />

          <div class="d-flex align-center ga-3 mt-3">
            <v-btn color="#0052D9" :disabled="!picked" variant="flat" @click="doSubmit">
              模拟提交
            </v-btn>

            <span v-if="toast" class="text-[12px] muted">{{ toast }}</span>
          </div>
        </v-sheet>

        <!-- ============ 审批类型：本单生效的那份配置（只读） ============ -->
        <v-sheet v-if="template" class="card-border pa-3 mt-3" rounded="10">
          <div class="d-flex flex-wrap align-center ga-2 mb-1">
            <span class="panel-title mb-0">审批类型（本单生效）</span>

            <v-chip size="x-small" variant="tonal">
              {{ typesLoading ? '读取中…' : (typeCustom ? '模板级覆盖已生效' : '全部用内置默认') }}
            </v-chip>

            <v-chip size="x-small" variant="tonal">有内容 {{ activeTypeTemplates.length }} / 22</v-chip>
          </div>

          <div class="text-[11px] muted mb-2">
            建单期解析后**随单据快照冻结**（内置默认 → 全局覆盖 → 模板级覆盖），办理页只读这份。
            这里只读展示；要改去「审批类型」页。
          </div>

          <div v-if="activeTypeTemplates.length === 0" class="text-[12px] muted">
            22 个结论全部用内置默认 = 改造前的硬编码行为：接收类出数量、回收类出数量+金额、
            其他原因出原因/二级原因/补充说明、报废清仓只写确认标记。
          </div>

          <div v-else class="type-list">
            <div
              v-for="t in activeTypeTemplates"
              :key="t.code"
              class="type-row"
              :class="{ 'type-row--picked': t.code === picked?.result }"
            >
              <div class="d-flex flex-wrap align-center ga-2">
                <span class="text-[12px] font-bold">{{ t.name }}</span>
                <span class="text-[10px] muted">{{ t.code }}</span>
                <v-chip v-if="t.enabled === false" color="error" size="x-small" variant="tonal">停用</v-chip>
              </div>

              <div class="text-[12px]">填：{{ typeFieldsSummaryOf(t.fields) }}</div>

              <div v-if="t.fixedValues" class="text-[11px] muted">固定值：{{ fixedValuesText(t.fixedValues) }}</div>
              <div v-if="t.effects?.length" class="text-[11px] muted">副作用：{{ effectsText(t.effects) }}</div>
              <div v-if="t.note" class="text-[11px] muted">提示：{{ t.note }}</div>
            </div>
          </div>
        </v-sheet>

        <v-sheet v-if="!flow && issues.length === 0" class="card-border pa-6 text-center" rounded="10">
          <div class="text-[13px]">先在上面选一张模板（再挑一行数据，分支条件才有上下文）。</div>
        </v-sheet>
      </v-col>

      <!-- ============ 右：上一步说明 + 通知预演 + 流水 ============ -->
      <v-col cols="12" lg="3">
        <v-sheet v-if="lastMemo" class="card-border pa-3 mb-3" rounded="10">
          <div class="panel-title">上一次推进</div>

          <div class="text-[13px]">
            {{ lastMemo.stepName }} → <strong>{{ lastMemo.resultLabel }}</strong>
          </div>

          <div v-if="lastMemo.arrived.length > 0" class="mt-2">
            <div class="text-[11px] muted mb-1">新到达</div>

            <div class="d-flex flex-wrap ga-1">
              <v-chip
                v-for="(name, i) in lastMemo.arrived"
                :key="i"
                color="primary"
                size="x-small"
                variant="tonal"
              >
                {{ name }}
              </v-chip>
            </div>
          </div>

          <v-divider class="my-3" />

          <div class="text-[11px] muted mb-1">提醒预演（只算不发）</div>

          <div v-if="lastMemo.notify.items.length === 0" class="text-[12px]">这一轮没有需要提醒的环节。</div>

          <div v-for="(item, i) in lastMemo.notify.items" :key="i" class="notify-item">
            <div class="d-flex align-center ga-1">
              <v-chip :color="item.kind === 'notify' ? 'info' : 'primary'" size="x-small" variant="flat">
                {{ item.kind === 'notify' ? '提醒' : '待审' }}
              </v-chip>

              <span class="text-[12px] font-bold">{{ item.title }}</span>
            </div>

            <div class="text-[11px] mt-1">
              收件人：{{ targetNames(item) }}
            </div>

            <div v-if="item.skip" class="text-[11px] text-[#B45309] mt-1">不发：{{ item.skip }}</div>
            <div v-else class="text-[11px] muted mt-1">{{ item.text }}</div>
          </div>
        </v-sheet>

        <v-sheet class="card-border pa-3" rounded="10">
          <div class="panel-title mb-1">办理流水（{{ decisions.length }} 条）</div>

          <div v-if="decisions.length === 0" class="text-[12px] muted">还没有推进过。</div>

          <div v-for="(d, i) in decisions" :key="i" class="decision-item">
            <span class="text-[11px] muted">{{ i + 1 }}.</span>
            <span class="text-[12px]">{{ decisionLabel(d.stepId) }}</span>
            <span class="text-[12px]">→ {{ d.result_label || d.result }}</span>
          </div>
        </v-sheet>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts" setup>
  import type { ApprovalChainItem, ApprovalFlowStep, ApprovalNodeOption, FlowEndInfo } from '@/types/approval'
  import OptionFormRenderer from '@/components/approval/OptionFormRenderer.vue'
  import { SANDBOX_ROW_PAGE_SIZE } from '@/composables/useSandbox'
  import { filterOfferedOptions, mainOf, RECEIVED_QTY_FIELD, REMAINING_QTY_FIELD, STOCK_QTY_FIELD } from '@/types/approval'
  import { optionContextOf } from '@/utils/approvalFlow'
  import {
    isFieldVisible,
    TYPE_CONTROL_OPTIONS,
    TYPE_EFFECTS,
    TYPE_LIMIT_OPTIONS,
    typeFieldsSummaryOf,
  } from '@/utils/approvalTypes'

  const {
    templates,
    templatesLoading,
    templateId,
    template,
    loadTemplates,
    selectTemplate,
    typesLoading,
    typeCustom,
    typeTemplateOf,
    typeTemplates,
    rows,
    rowsLoading,
    rowTotal,
    rowPage,
    rowKeyword,
    rowId,
    loadRows,
    pickRow,
    flow,
    context,
    contextChips,
    decisions,
    issues,
    building,
    runtime,
    runtimeError,
    currentStepId,
    currentMembers,
    currentOptions,
    lastMemo,
    submit,
    undo,
    resetRun,
  } = useSandbox()

  /** 收尾提示（模拟提交的返回文案） */
  const toast = ref('')
  /** 当前选中的结论选项 */
  const picked = ref<ApprovalNodeOption>()
  /**
   * 该结论"选中后要填什么"的表单值（键 = 将来写进 `extra` 的键名，见 utils/approvalTypes）。
   * 换结论会整份重铺（见下面的 watch）。
   */
  const extraForm = ref<Record<string, unknown>>({})
  const opinion = ref('')

  /** 流程停下的四类原因（文案在 types/approval 的 FlowEndInfo 里） */
  const END_KIND_LABEL: Record<FlowEndInfo['kind'], string> = {
    closed: '命中终结类结论',
    exit: '分支直达结束节点',
    finished: '全部环节已办完',
    stuck: '卡住了（模板缺分支 / 疑似成环）',
  }

  /* ==================== 列表 ==================== */

  const pageCount = computed(() => Math.max(1, Math.ceil(rowTotal.value / SANDBOX_ROW_PAGE_SIZE)))

  function searchRows () {
    void loadRows(1)
  }

  function goPage (page: number) {
    if (page < 1 || page > pageCount.value) {
      return
    }
    void loadRows(page)
  }

  function onTemplate (id: unknown) {
    // v-select 清空时给 null：保留旧选择没有意义，这里只是不触发重建
    if (typeof id === 'string' && id) {
      void selectTemplate(id)
    }
  }

  function onPickRow (row: Record<string, unknown>) {
    void pickRow(row)
  }

  /** 重新读模板与数据；已选模板则按当前上下文再构建一次 */
  async function reload () {
    await Promise.all([loadTemplates(), loadRows(1)])
    if (templateId.value) {
      await selectTemplate(templateId.value)
    }
  }

  onMounted(() => {
    void reload()
  })

  /* ==================== 数据行展示 ==================== */

  function rowKey (row: Record<string, unknown>) {
    return String(row.id ?? row.SKU ?? '')
  }

  /** 主标题优先 SKU（BI 行的唯一标识就是这个），没有才退回产品名称 */
  function rowTitle (row: Record<string, unknown>) {
    return String(row.SKU ?? row['产品名称'] ?? row.id ?? '（无标题行）')
  }

  function rowSubtitle (row: Record<string, unknown>) {
    const parts = [row['产品名称'], row['团队'], row['部门']]
      .filter(v => v !== undefined && v !== null && String(v).trim() !== '')
      .map(String)
    return parts.length > 0 ? parts.join(' · ') : String(row.id ?? '')
  }

  /* ==================== 链路展示 ==================== */

  /**
   * stepId → 环节名。
   *
   * 顶层审批节点（ApprovalFlowApprovalNode）**不带**环节名，所以它们只能靠成员名兜底；
   * 提醒 / 查询 / 轮询 / 引用这几类节点自带 `name`，分支组也自带 `name` —— 有名字的全部收进来。
   */
  const stepNames = computed<Record<string, string>>(() => {
    const map: Record<string, string> = {}
    const walkSteps = (steps?: ApprovalFlowStep[]) => {
      for (const step of steps ?? []) {
        if (step.name) {
          map[step.id] = step.name
        }
        walkSteps(step.steps)
        for (const b of step.branches ?? []) {
          walkSteps(b.steps)
        }
      }
    }

    for (const node of flow.value ?? []) {
      switch (node.type) {
        case 'branch': {
          for (const b of node.branches) {
            map[b.id] = b.name
            walkSteps(b.steps)
          }

          break
        }
        case 'notify': {
          map[node.id] = node.name

          break
        }
        case 'probe': {
          if (node.name) {
            map[node.id] = node.name
          }
          for (const b of node.branches) {
            walkSteps(b.steps)
          }

          break
        }
        case 'loop': {
          if (node.name) {
            map[node.id] = node.name
          }
          walkSteps(node.steps)

          break
        }
        case 'ref': {
          if (node.name) {
            map[node.id] = node.name
          }
          for (const b of node.branches ?? []) {
            walkSteps(b.steps)
          }

          break
        }
      // No default
      }
    }
    return map
  })

  /** 回填到成员上的结论（同一环可能多人会签，取第一个有结论的） */
  function decidedOf (step: ApprovalChainItem[]) {
    return step.find(m => m.result) ?? mainOf(step)
  }

  function memberNames (step: ApprovalChainItem[]) {
    const names = step
      .filter(m => m.type !== 'cc')
      .map(m => m.name ?? m.email ?? '')
      .filter(Boolean)
    const all = names.length > 0 ? names : step.map(m => m.name ?? m.email ?? '').filter(Boolean)
    return all.length > 0 ? all.join('、') : '（无人）'
  }

  function memberLabel (m: ApprovalChainItem) {
    const name = m.name ?? m.email ?? '未命名'
    return m.type === 'cc' ? `${name}（抄送）` : name
  }

  function stepLabel (step: ApprovalChainItem[], index: number) {
    const id = runtime.value?.stepIds[index] ?? ''
    return stepNames.value[id] || memberNames(step) || id || '（未知环节）'
  }

  function stepResultText (step: ApprovalChainItem[]) {
    const d = decidedOf(step)
    return d?.result_label || d?.result || ''
  }

  function stepOpinion (step: ApprovalChainItem[]) {
    return decidedOf(step)?.opinion ?? ''
  }

  function stepHandledAt (step: ApprovalChainItem[]) {
    return decidedOf(step)?.handled_at ?? ''
  }

  /** 当前待办环节名（左侧卡片标题用） */
  const currentStepLabel = computed(() => {
    const r = runtime.value
    if (!r || !currentStepId.value) {
      return ''
    }
    const i = r.currentStep
    return stepLabel(r.chain[i] ?? [], i)
  })

  function stepClass (index: number) {
    const r = runtime.value
    if (!r) {
      return ''
    }
    if (index === r.currentStep && !r.done) {
      return 'step--current'
    }
    return 'step--done'
  }

  function decisionLabel (stepId: string) {
    return stepNames.value[stepId] || stepId
  }

  /* ==================== 选项 / 提交 ==================== */

  /**
   * 选项的求值上下文：业务快照 + 上一环节结论（`offerWhen` 会用）。
   * 与三个办理入口同一个 helper，保证沙盒看到的选项和真实办理一致。
   */
  const optionsCtx = computed(() => optionContextOf(
    { chain: { context: context.value } },
    runtime.value?.chain ?? null,
    runtime.value?.currentStep ?? 0,
  ))

  const availableOptions = computed(() => filterOfferedOptions(currentOptions.value, optionsCtx.value))

  /**
   * 停用的审批类型不出现在办理选项里（口径见 utils/approvalTypes 的 `enabled`）。
   *
   * ⚠️ 全被停用时退回完整列表：沙盒宁可让人把流程走完看走向，
   *    也不要卡在"这一环没有任何可选项、也就提交不了"。
   */
  const visibleOptions = computed(() => {
    const kept = availableOptions.value.filter(opt => typeTemplateOf(opt.result).enabled !== false)
    return kept.length > 0 ? kept : availableOptions.value
  })

  /** 当前结论生效的类型模板（选中才有） */
  const pickedType = computed(() => (picked.value ? typeTemplateOf(picked.value.result) : undefined))
  /** 这一环要填的字段 */
  const pickedFields = computed(() => pickedType.value?.fields ?? [])

  /*
   * 本单生效的审批类型里"有内容"的那些（字段 / 固定值 / 提示 / 停用 / 副作用 至少占一样）。
   *
   * 为什么只列这些：22 个结论里大部分是**空壳**（不额外要东西），全列出来只是噪音，
   * 而空壳与内置默认逐字相同 —— 列表为空就说明"这一单用的是改造前的行为"。
   */
  const activeTypeTemplates = computed(() => Object.values(typeTemplates.value).filter(t =>
    t.fields.length > 0
    || !!t.fixedValues
    || !!t.note
    || t.enabled === false
    || (t.effects?.length ?? 0) > 0,
  ))

  /** 控件 / 上限来源的中文名（别再在页面里抄一份，口径以 utils/approvalTypes 的导出为准） */
  function controlText (control: string) {
    return TYPE_CONTROL_OPTIONS.find(o => o.value === control)?.title ?? control
  }

  function limitText (limit: string) {
    return TYPE_LIMIT_OPTIONS.find(o => o.value === limit)?.title ?? limit
  }

  function fixedValuesText (fixedValues: Record<string, unknown>) {
    return Object.entries(fixedValues)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join('，')
  }

  function effectsText (effects: readonly string[]) {
    return effects
      .map(e => TYPE_EFFECTS.find(x => x.value === e)?.title ?? e)
      .join('、')
  }

  /**
   * 渲染器要的"上限 / 剩余"旁注值：直接取业务快照里的列。
   * 取不到就给空串 —— 渲染器把空串当成"没有上限"，不会因此把人卡死。
   */
  const typeContext = computed(() => ({
    // 用 types/approval 里的字段常量，别再抄一遍中文字面量（改字段名时只改一处）
    stockQty: textOf(context.value[STOCK_QTY_FIELD]),
    stockAmount: textOf(context.value['总库存金额']),
    remainingQty: textOf(context.value[REMAINING_QTY_FIELD]),
    receivedQty: textOf(context.value[RECEIVED_QTY_FIELD]),
  }))

  function textOf (value: unknown) {
    return value === undefined || value === null ? '' : String(value)
  }

  // 换环节就清掉上一环的选择与备注：否则会出现"这一环默认已经选了某个结论"
  watch(currentStepId, () => {
    picked.value = undefined
    opinion.value = ''
    extraForm.value = {}
    toast.value = ''
  })

  /*
   * 换结论就重铺表单：键名可能相同（qty / amount / reason），但语义不同（接收数量 vs 回收数量），
   * 留着上一份值会让"部分接收填的 3 件"悄悄变成"回收 3 件"。
   * 固定值（如报废清仓的 `confirmed: true`）在这里先铺好，提交时再并进 extra。
   */
  watch(picked, opt => {
    extraForm.value = opt ? { ...typeTemplateOf(opt.result).fixedValues } : {}
    toast.value = ''
  })

  /** 必填校验：只拦"该显示且必填"的字段（被 showWhen 联动隐藏的字段不该拦人） */
  function missingRequired () {
    const type = pickedType.value
    if (!type) {
      return ''
    }
    for (const field of type.fields) {
      if (field.control === 'none' || !isFieldVisible(field, extraForm.value)) {
        continue
      }
      if (field.required && textOf(extraForm.value[field.key]).trim() === '') {
        return field.label || field.key
      }
    }
    return ''
  }

  function doSubmit () {
    const opt = picked.value
    if (!opt) {
      return
    }
    const missing = missingRequired()
    if (missing) {
      toast.value = `请先填写「${missing}」`
      return
    }
    const res = submit({
      result: opt.result,
      resultLabel: opt.text,
      // 固定值在前、表单值在后：固定值本来就不渲染控件，留个覆盖余地但不指望用户改到
      extra: { ...pickedType.value?.fixedValues, ...extraForm.value },
      opinion: opinion.value,
    })
    toast.value = res.message
    if (res.ok) {
      picked.value = undefined
      opinion.value = ''
      extraForm.value = {}
    }
  }

  /**
   * 「选接收方」（control='team'）：沙盒不提供选人面板。
   *
   * 不影响走向：「选中即终结」是由**结论码**（pick_members / pick_team，见 CLOSE_FLOW_RESULTS）
   * 判定的，不依赖 members 填没填；这里只把"为什么没有面板"讲清楚。
   */
  function onPickTeam () {
    toast.value = '沙盒不提供选人面板：提交后仍按结论码判定是否终结，接收方不会被记录'
  }

  /* ==================== 杂项 ==================== */

  function fmtTime (value?: string) {
    if (!value) {
      return ''
    }
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString('zh-CN', { hour12: false })
  }

  function targetNames (item: { targets: Array<{ member: ApprovalChainItem, receive_id: string }> }) {
    const names = item.targets.map(t => t.member.name ?? t.member.email ?? t.receive_id).filter(Boolean)
    return names.length > 0 ? names.join('、') : '（没有收件人）'
  }
</script>

<style scoped>
.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 700;
}

.panel-title::before {
  content: '';
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background-color: #0052D9;
}

.muted {
  color: #8B8B8B;
}

.row-list {
  max-height: 300px;
  overflow-y: auto;
}

.row-item {
  border-radius: 6px;
}

/* ===== 链路：用一条竖线串起来，当前环节高亮 ===== */
.steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step {
  display: flex;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: 8px;
}

.step--done {
  background-color: rgb(var(--v-theme-on-surface) / 3%);
}

.step--current {
  border-color: rgb(var(--v-theme-primary) / 45%);
  background-color: rgb(var(--v-theme-primary) / 8%);
}

.step-index {
  flex: 0 0 20px;
  height: 20px;
  border-radius: 50%;
  font-size: 11px;
  line-height: 20px;
  text-align: center;
  color: #fff;
  background-color: rgb(var(--v-theme-on-surface) / 35%);
}

.step--current .step-index {
  background-color: rgb(var(--v-theme-primary));
}

.end-note {
  padding: 8px 10px;
  border-left: 3px solid #F59E0B;
  border-radius: 6px;
  background-color: rgb(245 158 11 / 10%);
}

/* ===== 审批类型配置列表 ===== */
.type-list {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.type-row {
  padding: 6px 8px;
  border-radius: 6px;
  background-color: rgb(var(--v-theme-on-surface) / 3%);
}

/* 当前选中的那条结论：把配置里那一行点亮，免得在两块内容之间来回找 */
.type-row--picked {
  outline: 1px solid rgb(var(--v-theme-primary) / 45%);
  background-color: rgb(var(--v-theme-primary) / 8%);
}

.field-detail {
  padding: 6px 8px;
  border-radius: 6px;
  background-color: rgb(var(--v-theme-on-surface) / 3%);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ===== 右栏 ===== */
.notify-item {
  padding: 6px 0;
  border-top: 1px dashed rgb(var(--v-theme-on-surface) / 12%);
}

.decision-item {
  display: flex;
  gap: 4px;
  padding: 3px 0;
  border-top: 1px dashed rgb(var(--v-theme-on-surface) / 10%);
}

.notify-item:first-of-type,
.decision-item:first-of-type {
  border-top: none;
}
</style>
