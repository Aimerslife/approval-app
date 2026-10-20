<template>
  <div class="option-form-renderer">
    <template v-for="field in visibleFields" :key="field.key">
      <!-- 数字 / 单行文本：与同一份预览里的下拉 / 多行文本同款（outlined + 后缀 + 旁注） -->
      <div v-if="field.control === 'number' || field.control === 'text'" class="field-row">
        <v-text-field
          density="compact"
          hide-details="auto"
          :label="field.label"
          :model-value="valueOf(field.key)"
          :placeholder="field.placeholder"
          :readonly="isReadonly(field)"
          :rules="rulesFor(field)"
          :suffix="field.unit"
          variant="underlined"
          @update:model-value="v => setValue(field.key, v)"
        />

        <span v-if="sideNoteOf(field)" class="field-side">{{ sideNoteOf(field) }}</span>
      </div>

      <!-- 多行文本 -->
      <div v-else-if="field.control === 'textarea'" class="field-row">
        <v-textarea
          class="field-input"
          density="compact"
          hide-details="auto"
          :model-value="valueOf(field.key)"
          :placeholder="field.placeholder || field.label"
          :rows="rowsOf(field)"
          variant="outlined"
          @update:model-value="v => setValue(field.key, v)"
        />
      </div>

      <!-- 下拉 / 单选（auto = 选项 ≤ 3 用单选，与办理页同口径） -->
      <div v-else-if="field.control === 'select' || field.control === 'radio' || field.control === 'auto'" class="field-row">
        <v-select
          v-if="useSelect(field)"
          class="field-select"
          density="compact"
          hide-details="auto"
          :items="itemsOf(field)"
          :label="field.label"
          :menu-props="{ contentClass: 'filter-menu' }"
          :model-value="valueOf(field.key)"
          :rules="rulesFor(field)"
          variant="outlined"
          @update:model-value="v => setValue(field.key, v)"
        />

        <v-radio-group
          v-else
          class="field-radios"
          density="compact"
          hide-details="auto"
          :label="field.label"
          :model-value="valueOf(field.key)"
          :rules="rulesFor(field)"
          @update:model-value="v => setValue(field.key, v)"
        >
          <v-radio v-for="opt in field.options ?? []" :key="opt.value" :label="opt.label" :value="opt.value" />
        </v-radio-group>
      </div>

      <!-- 选接收方（组别 / 团队）：点开选人面板，选中即记为接收方 -->
      <div v-else-if="field.control === 'team'" class="field-row">
        <v-btn
          class="text-none"
          color="primary"
          :disabled="props.readonly"
          prepend-icon="mdi-account-search-outline"
          size="small"
          variant="tonal"
          @click="emit('pick', field)"
        >{{ field.label }}</v-btn>

        <v-chip
          v-for="(m, i) in pickedList(field.key)"
          :key="i"
          closable
          label
          size="small"
          variant="tonal"
          @click:close="removePicked(field.key, i)"
        >{{ pickedTextOf(m) }}</v-chip>

        <span v-if="pickedList(field.key).length === 0" class="field-side">
          还没有选{{ field.pick === 'team' ? '部门' : '团队' }}
        </span>
      </div>

      <div v-if="field.hint" class="field-hint">{{ field.hint }}</div>
    </template>

    <div v-if="visibleFields.length === 0" class="field-empty">
      这个结论不额外要东西：只填备注 / 附件（它们对所有结论都有）
    </div>
  </div>
</template>

<script lang="ts" setup>
  import type { TypeField, TypeFieldOption } from '@/utils/approvalTypes'
  import { isFieldVisible } from '@/utils/approvalTypes'

  /**
   * 办理表单渲染器（见模板里的说明）。
   *
   * `modelValue` 是**扁平的一份表单值**：键就是字段的 `key`（= 将来写进 `extra` 的键名），
   * 外加候选项带出的附加键（如 `reason_belong`），联动 `showWhen` 判的就是它。
   */
  const props = defineProps<{
    /** 该结论要填的字段（来自 utils/approvalTypes 的解析结果） */
    fields: TypeField[]
    /** 表单值：`{ [字段键]: 值 }` */
    modelValue?: Record<string, unknown>
    /**
     * 运行期上下文（办理页有、预览页用假数据）：
     * 数值上限与"剩余多少"这类旁注都从这里取（口径与办理页的 receiveCapText 一致）。
     */
    context?: {
      stockQty?: string
      remainingQty?: string
      receivedQty?: string
      stockAmount?: string
    }
    /** 只读（预览里的"看板"模式） */
    readonly?: boolean
    /** 空值时是否按上限预填（改造前的"接收"就是这个行为）；预览里可关掉 */
    prefill?: boolean
  }>()

  const emit = defineEmits<{
    /*
     * 事件名用 kebab-case（与项目里 EdgeOptionTreeEditor 等受控组件同口径）：
     * Vue 3 的 emit 会把它映射回 onUpdate:modelValue，所以外面 `v-model` 照常可用。
     */
    'update:model-value': [value: Record<string, unknown>]
    /** 点了「选接收方」：本期预览里由页面提示，办理页接真实选人面板 */
    'pick': [field: TypeField]
  }>()

  /** 与办理页的 RADIO_MAX 同口径（approvalTypes 的说明里也提到它） */
  const RADIO_MAX = 3

  const values = computed(() => props.modelValue ?? {})

  /** 联动过滤后的字段（showWhen 只看"写进表单的值"） */
  const visibleFields = computed(() => props.fields.filter(f => f.control !== 'none' && isFieldVisible(f, values.value)))

  function valueOf (key: string): unknown {
    return values.value[key] ?? ''
  }

  /**
   * 写值。选项类字段额外做两件事（与办理页的 reason 那一套一致）：
   *   · 把选中项 `data` 里的键**一并写入**（如 `reason_target` / `reason_belong`）；
   *   · 先把**同字段所有候选**声明过的 data 键清掉，再写新值 —— 换一个原因时不会留着上一个的分类。
   */
  function setValue (key: string, v: unknown) {
    const next: Record<string, unknown> = { ...values.value, [key]: v }
    const field = props.fields.find(f => f.key === key)
    if (field?.options) {
      for (const k of dataKeysOf(field)) {
        delete next[k]
      }
      const hit = v === '' || v === undefined
        ? undefined
        : field.options.find(o => o.value === String(v))
      if (hit?.data) {
        Object.assign(next, hit.data)
      }
    }
    emit('update:model-value', next)
  }

  /** 该字段所有候选声明过的附加键（换值时统一清掉） */
  function dataKeysOf (field: TypeField): string[] {
    const keys = new Set<string>()
    for (const opt of field.options ?? []) {
      for (const k of Object.keys(opt.data ?? {})) {
        keys.add(k)
      }
    }
    return [...keys]
  }

  function useSelect (field: TypeField): boolean {
    if (field.control === 'select') return true
    if (field.control === 'radio') return false
    return (field.options?.length ?? 0) > RADIO_MAX
  }

  /** 下拉条目：有分组时插 subheader（与办理页的原因下拉同一套展示） */
  function itemsOf (field: TypeField): Array<Record<string, unknown>> {
    const opts = field.options ?? []
    const groups = new Map<string, TypeFieldOption[]>()
    for (const opt of opts) {
      const g = opt.group ?? ''
      groups.set(g, [...(groups.get(g) ?? []), opt])
    }
    if (groups.size <= 1 && !opts.some(o => o.group)) {
      return opts.map(o => ({ title: o.label, value: o.value }))
    }
    const items: Array<Record<string, unknown>> = []
    for (const [group, list] of groups) {
      if (group) {
        items.push({ type: 'subheader', title: group })
      }
      for (const o of list) {
        items.push({ title: o.label, value: o.value })
      }
    }
    return items
  }

  // ===== 上限与旁注（口径与办理页的 receiveCapText / stockQtyText 一致）=====

  const stockQtyText = computed(() => String(props.context?.stockQty ?? '').trim())
  const remainingQtyText = computed(() => String(props.context?.remainingQty ?? '').trim())
  const receivedQtyText = computed(() => String(props.context?.receivedQty ?? '').trim())
  const stockAmountText = computed(() => String(props.context?.stockAmount ?? '').trim())

  /** 上限数值：认不出来 = undefined（那就没有上限） */
  function limitValueOf (field: TypeField): number | undefined {
    if (!field.limit) return undefined
    const raw = field.limit === 'receive_cap'
      // 剩余优先、没有剩余（空）时退回总库存 —— 与办理页同口径
      ? (remainingQtyText.value || stockQtyText.value)
      : (field.limit === 'stock_qty' ? stockQtyText.value : stockAmountText.value)
    const n = Number(String(raw).replace(/,/g, ''))
    return Number.isFinite(n) ? n : undefined
  }

  function limitNameOf (field: TypeField): string {
    if (field.limit === 'receive_cap') {
      return remainingQtyText.value ? '剩余接收数量' : '总库存数量'
    }
    return field.limit === 'stock_qty' ? '总库存数量' : '总库存金额'
  }

  /** 上限的单位（报错文案用） */
  function limitUnitOf (field: TypeField): string {
    return field.limit === 'stock_amount' ? '元' : '件'
  }

  /** 取到上限 → 只读（改造前"接收"的行为） */
  function isReadonly (field: TypeField): boolean {
    if (props.readonly) return true
    if (!field.readonlyWhenFull) return false
    return limitValueOf(field) !== undefined
  }

  /** 数字框旁边的提示：剩余多少 / 价值多少 —— 只为预览像真的，不参与计算 */
  function sideNoteOf (field: TypeField): string {
    if (field.limit !== 'receive_cap' || !stockQtyText.value) {
      return ''
    }
    const cap = remainingQtyText.value
    const total = stockQtyText.value
    const got = receivedQtyText.value
    if (!cap || cap === total) {
      return got ? `（总 ${total}，已接收 ${got}）` : ''
    }
    return `剩余 ${cap} 件（总 ${total}，已接收 ${got || 0}）`
  }

  // ===== 校验（文案与办理页逐字一致）=====

  /** textarea 行数（编辑中途可能是空 / 非数字，那会儿按 2 行画，别把预览搞成 0 行高） */
  function rowsOf (field: TypeField): number {
    const rows = Number(field.rows)
    return Number.isFinite(rows) && rows > 0 ? Math.round(rows) : 2
  }

  function rulesFor (field: TypeField): Array<(v: unknown) => true | string> {
    const rules: Array<(v: unknown) => true | string> = []
    if (field.required) {
      rules.push(v => String(v ?? '').trim() !== '' || '请填写')
    }
    if (field.control === 'number') {
      if (field.integer) {
        rules.push(v => v === '' || /^\d+$/.test(String(v)) || '只能填正整数（不支持小数或千分位逗号）')
      }
      /*
       * ⚠️ 位数 / 上下限都先过 `Number.isFinite`：编辑框里删空会写出 NaN，
       * 直接拿去拼正则会得到 `\d{1,NaN}` 这种"永远不命中"的规则，比较大小会得到"不能小于 NaN"。
       * 认不出来就当没配这条规则（与 normalizeTypeFields 的逐项兜底同一口径）。
       */
      if (Number.isFinite(field.decimals) && !field.integer) {
        const re = new RegExp(String.raw`^\d+(?:\.\d{1,${field.decimals}})?$`)
        rules.push(v => v === '' || re.test(String(v)) || `只能填数字，最多 ${field.decimals} 位小数`)
      }
      if (Number.isFinite(field.min)) {
        rules.push(v => v === '' || Number(v) >= field.min! || `不能小于 ${field.min}`)
      }
      if (Number.isFinite(field.max)) {
        rules.push(v => v === '' || Number(v) <= field.max! || `不能大于 ${field.max}`)
      }
      if (field.limit) {
        /*
         * 与办理页同口径：默认**严格小于**上限（等于上限要选"全部接收"那类结论）；
         * 配了 `limitInclusive` 的字段（如「接收」）允许**等于**上限。
         * 上限认不出来时不拦 —— 宁可放过，也不要因为取不到数就把人卡死。
         */
        const inclusive = field.limitInclusive === true
        rules.push(v => {
          const cap = limitValueOf(field)
          if (v === '' || cap === undefined) return true
          const n = Number(v)
          if (!Number.isFinite(n)) return true
          if (inclusive) {
            return n <= cap || `不能大于${limitNameOf(field)}（${cap} ${limitUnitOf(field)}）`
          }
          return n < cap || `必须小于${limitNameOf(field)}（${cap} ${limitUnitOf(field)}）`
        })
      }
    }
    return rules
  }

  // ===== 选接收方 =====

  function pickedList (key: string): Array<Record<string, unknown>> {
    const v = values.value[key]
    return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []
  }

  function pickedTextOf (m: Record<string, unknown>): string {
    const name = String(m.name ?? '')
    const leader = String(m.manager ?? '')
    return leader ? `${name}（负责人 ${leader}）` : name
  }

  function removePicked (key: string, index: number) {
    const next = pickedList(key).slice()
    next.splice(index, 1)
    setValue(key, next)
  }

  /*
   * 「按上限预填」：改造前的"接收"会把数量框预填成剩余上限（只读）。
   * 渲染器不该在渲染中途改数据，所以放在 watch 里、且只在空值时写一次 —— 用户删掉后不会再被他顶回来。
   */
  watch(visibleFields, list => {
    if (props.prefill === false || props.readonly) return
    let next: Record<string, unknown> | null = null
    for (const field of list) {
      if (!field.prefillFromLimit || String(valueOf(field.key) ?? '').trim() !== '') continue
      const cap = limitValueOf(field)
      if (cap === undefined) continue
      next = { ...(next ?? values.value), [field.key]: String(cap) }
    }
    if (next) {
      emit('update:model-value', next)
    }
  }, { immediate: true })
</script>

<style scoped>
.option-form-renderer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 一行控件 + 右侧旁注（剩余多少 / 价值多少）：居中，旁注跟控件的中线对齐 */
.field-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

/*
 * 控件里的字号统一 12px（= 这一页其它小字）：
 * Vuetify 默认 1rem（16px）在这套 12-13px 的界面里明显偏大，也会把旁注挤成"两块不同大小的字"。
 * 输入框里的文字是 .v-field__input（下拉显示已选项用的也是它），标签是 .v-label，后缀是 .v-field__suffix。
 * ⚠️ 下拉的**弹层选项**被 teleport 到 body，不在本组件作用域里，这里管不到（要一起变小得配
 * menu-props 的 contentClass + 一段全局样式）。
 */
.option-form-renderer :deep(.v-field__input),
.option-form-renderer :deep(.v-field__suffix),
.option-form-renderer :deep(.v-label) {
  font-size: 12px;
}

.field-input {
  max-width: 220px;
  flex: none;
}

.field-select {
  max-width: 260px;
  flex: none;
}

.field-radios {
  width: 100%;
}

/* 旁注与提示：跟着控件一起 12px，别一个 11 一个 16 */
.field-side {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.field-hint {
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.field-empty {
  padding: 6px 2px;
  font-size: 12px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
</style>
