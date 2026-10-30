<template>
  <div class="option-form-renderer">
    <template v-for="field in visibleFields" :key="field.key">
      <!-- 数字 / 单行文本：与同一份预览里的下拉 / 多行文本同款（outlined + 后缀 + 旁注） -->
      <div v-if="field.control === 'number' || field.control === 'text'" class="field-row">
        <v-text-field
          class="field-number"
          density="compact"
          hide-details="auto"
          :label="field.label"
          :model-value="displayValueOf(field)"
          :placeholder="field.placeholder"
          :readonly="isReadonly(field)"
          :rules="rulesFor(field)"
          :suffix="field.unit"
          variant="underlined"
          @update:model-value="v => setValue(field.key, v)"
        />

        <!-- 价值紧跟在数量框右侧（排头）：框宽受限时它会跟着换行，但不会掉到框下面单独成行 -->
        <span v-if="valueNoteOf(field)" class="field-side" :title="valueTitleOf()">
          价值 ￥{{ valueNoteOf(field) }}<template v-if="valueQtyNoteOf(field)">（{{ valueQtyNoteOf(field) }}）</template>
        </span>

        <!--
          「不可修改」：数量是按剩余带出来的（全部接收就是这个语义），不说一句的话，
          看上去跟能改的输入框没差别 —— 用户会点进去发现打不了字。
        -->
        <span v-if="isLockedToCap(field)" class="field-side field-lock">
          <v-icon icon="mdi-lock-outline" size="11" />
          不可修改
        </span>

      </div>

      <!-- 多行文本 -->
      <!-- <div v-else-if="field.control === 'textarea'" class="field-row">
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
      </div> -->

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

      <!--
        选接收方分两种粒度，交互完全不同：

        · 「选择接收团队」—— 把**所有候选团队直接平铺**出来，每个团队后面跟一个接收数量框。
          为什么要摊开：一批货分给几个团队时，逐个"点按钮 → 面板里挑一个"既慢又容易漏
          （面板一关就看不见还剩哪些团队没分配），摊成一张清单才能一眼核对"谁接多少、还有谁没填"。
        · 「选择接收部门」—— 整批交给某一个部门，仍保持"点按钮 → 面板里挑一个"的一对一交接。
      -->
      <div v-else-if="field.control === 'team'" class="field-row field-team">
        <template v-if="qtyEditableOf(field)">
          <div class="team-matrix">
            <template v-for="section in teamSections" :key="section.parent">
              <!-- 退回"全部部门"时按部门分组标个标题；限定了部门就只剩一栏，不用再写一遍 -->
              <div v-if="showDeptTitle" class="team-matrix__dept">{{ section.parent }}</div>

              <div v-for="row in section.rows" :key="row.group" class="team-matrix__row flex-row items-center">
                <span class="team-matrix__name">{{ row.group }}</span>
                <div class="flex-1">
                  <v-chip color="info" size="x-small">{{ row.manager || '（未维护负责人）' }}</v-chip>
                </div>
                <v-text-field
                  class="picked-qty"
                  density="compact"
                  :model-value="qtyOfTeam(field.key, row.group)"
                  :readonly="props.readonly"
                  :rules="qtyRulesOf(field)"
                  suffix="件"
                  variant="underlined"
                  @update:model-value="v => setTeamQty(field.key, row, v)"
                >
                  <template #label>
                    <span class="text-[11px]">数量</span>
                  </template>
                </v-text-field>
              </div>
            </template>

            <div v-if="teamSections.length === 0" class="field-side">
              团队表里还没有团队，先让管理员维护「人员配置」
            </div>
          </div>

          <!-- 清单末尾对一次账：填了几个团队、一共多少件（留空的团队不算接收方） -->
          <span class="field-side">
            已填 <b>{{ chosenCountOf(field.key) }}</b> 个团队 · 合计 <b>{{ totalQtyTextOf(field.key) }}</b> 件
          </span>
        </template>

        <template v-else>
          <v-btn
            class="text-none shrink-0"
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

          <span v-if="pickedList(field.key).length === 0" class="field-side">还没有选部门</span>
        </template>
      </div>

      <div v-if="field.hint" class="field-hint">{{ field.hint }}</div>
    </template>
  </div>
</template>

<script lang="ts" setup>
  import type { TypeField, TypeFieldOption } from '@/utils/approvalTypes'
  import { isFieldVisible } from '@/utils/approvalTypes'
  // 数量框右侧的「价值」：总金额 ÷ 总数量 × 数量（纯函数，零依赖，见 utils/number）
  import { shareValueText } from '@/utils/number'
  // 「选择接收团队」的候选 = 团队表（与 TeamPicker 同一个来源，别在这里另抄一份）
  import { teamRowsForReceiver, type TeamGroupRow } from '@/utils/organazation'

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
    /**
     * 本单所属**部门**（团队表口径，办理页从数据行的团队名反查得到）。
     * 给了就只平铺该部门下的团队；没给 / 该部门没有团队 → 退回全部部门的团队（见 teamRowsForReceiver）。
     */
    receiverTeam?: string
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
  const stockAmountText = computed(() => String(props.context?.stockAmount ?? '').trim())

  /** 「价值」按哪个数量算：与上限同口径（剩余优先，没有剩余退回总库存） */
  const valueBaseQtyText = computed(() => remainingQtyText.value || stockQtyText.value)

  /**
   * 数量框右侧的「价值」：这批货还值多少钱（口径见 utils/number 的 shareValueText）。
   *
   * 只跟 `limit = 'receive_cap'`（接收类数量框）一起出现 —— 别的地方谈"值多少钱"没有依据，
   * 也不该像改造前那样"只要单据带库存金额就在表单里单独占一行"。
   */
  function valueNoteOf (field: TypeField): string {
    if (field.limit !== 'receive_cap') {
      return ''
    }
    return shareValueText(stockAmountText.value, stockQtyText.value, valueBaseQtyText.value)
  }

  /** 「价值」的悬浮说明：把算式写出来，办理人能核对（与改造前那句 title 同一口径） */
  function valueTitleOf (): string {
    const name = remainingQtyText.value ? '剩余数量' : '总库存数量'
    return `价值 = 总库存金额 ÷ 总库存数量 × ${name} = ${stockAmountText.value} ÷ ${stockQtyText.value} × ${valueBaseQtyText.value}`
  }

  /**
   * 「价值」后面括号里的数量：**按哪个数量算的就标哪个**（与 valueBaseQtyText 同源）。
   *
   * 为什么要把数量贴在金额后面：件数本身说明不了轻重，金额又要靠数量才读得出含义
   *（价值 ￥8,000（100 件）），分开摆时办理人得来回对照两次。
   * 取不到数量就返回空串（模板里整对括号都不渲染，不会出现「价值 ￥8,000（）」）。
   */
  function valueQtyNoteOf (field: TypeField): string {
    if (field.limit !== 'receive_cap') {
      return ''
    }
    const qty = String(valueBaseQtyText.value ?? '').trim()
    if (!qty) {
      return ''
    }
    return `${qty} ${field.unit || '件'}`
  }

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

  /**
   * 「按上限带出、且**不可修改**」的字段：模板开了 `readonlyWhenFull`、且上限取得到
   * （「全部接收」就是这一类：数量 = 剩余，不由人填）。
   *
   * 预览里的整表只读（`props.readonly`）不算这一类 —— 那种情况下每一格都不可改，
   * 逐格标「不可修改」只是噪音。
   */
  function isLockedToCap (field: TypeField): boolean {
    if (props.readonly) return false
    return field.readonlyWhenFull === true && limitValueOf(field) !== undefined
  }

  /** 取到上限 → 只读（改造前"接收"的行为） */
  function isReadonly (field: TypeField): boolean {
    return props.readonly || isLockedToCap(field)
  }

  /**
   * 输入框**显示**什么：锁死的字段永远显示上限值。
   *
   * 为什么不直接绑 `valueOf(key)`：那个值要靠预填写进表单（页面数据晚到时可能还没写）。
   * 一旦"只读"先生效、预填还没跑，框就是**空着的**，看上去像坏了 ——
   * 而这一格的语义是"数量已经定死为剩余多少"，空着本身就不对。
   * 这里兜住显示，预填那边仍会把值写进表单（提交时 extra.qty 不能缺）。
   */
  function displayValueOf (field: TypeField): unknown {
    const raw = valueOf(field.key)
    if (String(raw ?? '').trim() !== '') {
      return raw
    }
    if (!isLockedToCap(field)) {
      return raw
    }
    const cap = limitValueOf(field)
    return cap === undefined ? raw : String(cap)
  }

  /*
   * 「（总 12869，已接收 110）」这段**不在这里画了**：
   * 整单的总件数 / 已接收 / 总金额已经统一摆在**办理表单开头**（ApprovalHandleForm 的 approval-total），
   * 这里再写一遍，同一个数在同一个弹窗里会出现两次，反而分不清哪个是整单、哪个是本环。
   * 本环的口径只留「价值 ￥…（剩余 N 件）」（见 valueQtyNoteOf）。
   */

  // ===== 校验（文案与办理页逐字一致）=====

  /** textarea 行数（编辑中途可能是空 / 非数字，那会儿按 2 行画，别把预览搞成 0 行高） */
  function rowsOf (field: TypeField): number {
    const rows = Number(field.rows)
    return Number.isFinite(rows) && rows > 0 ? Math.round(rows) : 2
  }

  function rulesFor (field: TypeField): Array<(v: unknown) => true | string> {
    /*
     * 按上限带出、**不可修改**的字段（「全部接收」的数量）一律不校验。
     *
     * 那个值是系统按剩余算出来的，不是人填的：它天然**等于**上限，而这条上限规则
     * （没配 limitInclusive 时）要求"必须小于上限" —— 于是每次提交都被自己拦下，
     * 报「必须小于剩余接收数量」，怎么点都提不上去（现场反馈）。
     * 「必须小于上限」本来约束的是**部分接收**那种手填场景，锁死的格子上不适用。
     */
    if (isLockedToCap(field)) {
      return []
    }

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

  /** 这个字段要不要平铺「全部团队 + 接收数量」：只有"选择接收团队"（pick='group'）要，选部门不要 */
  function qtyEditableOf (field: TypeField): boolean {
    return field.control === 'team' && field.pick !== 'team'
  }

  /** 候选团队（本单所属部门下的团队；识别不出部门时退回全部，见 teamRowsForReceiver） */
  const teamRows = computed<TeamGroupRow[]>(() => teamRowsForReceiver(props.receiverTeam))

  /** 按部门分组（只为了在"退回全部部门"时插一个小标题，方便找） */
  const teamSections = computed(() => {
    const byDept = new Map<string, TeamGroupRow[]>()
    for (const row of teamRows.value) {
      byDept.set(row.parent, [...(byDept.get(row.parent) ?? []), row])
    }
    return [...byDept].map(([parent, rows]) => ({ parent, rows }))
  })

  /** 限定了部门就只剩一栏，不必再写一遍部门标题 */
  const showDeptTitle = computed(() => !String(props.receiverTeam ?? '').trim())

  /** 该团队已填的数量（空 = 这个团队不接收） */
  function qtyOfTeam (key: string, team: string): string {
    const hit = pickedList(key).find(m => String(m.name ?? '') === team)
    const raw = hit?.qty
    return raw === undefined || raw === null ? '' : String(raw)
  }

  /**
   * 改某个团队的接收数量。**数量 > 0 = 这个团队算接收方**；清空 / 填 0 = 从接收方里去掉。
   *
   * 为什么用"数量决定是否选中"：清单里摊着全部团队，再加一列勾选框就得多一次点击，
   * 而且会出现"勾上了却没填数量"的半截记录（提交后台账算不出各接多少）。
   * 数量存在**成员对象自己身上**（`{ name, manager, qty }`），不另开一张「团队 → 数量」的表。
   */
  function setTeamQty (key: string, row: TeamGroupRow, value: unknown) {
    const text = String(value ?? '').trim()
    const keep = new Map<string, Record<string, unknown>>()
    for (const m of pickedList(key)) {
      keep.set(String(m.name ?? ''), m)
    }
    if (!text || !/^\d+$/.test(text) || Number(text) <= 0) {
      keep.delete(row.group)
    } else {
      keep.set(row.group, {
        name: row.group,
        ...(row.manager ? { manager: row.manager } : {}),
        type: 'manager',
        pick: 'group',
        qty: text,
      })
    }
    // 按团队表的顺序写回：结论文案里的团队顺序就不会随"谁先被填"跳来跳去
    const order = teamRows.value.map(r => r.group)
    const next = [...keep.values()].sort((a, b) => order.indexOf(String(a.name)) - order.indexOf(String(b.name)))
    setValue(key, next)
  }

  /** 填了数量的团队个数（清单末尾对账用） */
  function chosenCountOf (key: string): number {
    return pickedList(key).filter(m => Number(String(m.qty ?? '').trim()) > 0).length
  }

  /** 数量的校验与办理页同口径：空着不管，填了就得是整数 */
  function qtyRulesOf (field: TypeField): Array<(v: unknown) => true | string> {
    if (!qtyEditableOf(field)) return []
    return [v => v === '' || v === undefined || /^\d+$/.test(String(v)) || '只能填正整数']
  }

  /** 已填团队的合计件数（还没填的按 0 算，别把空串拼成 NaN） */
  function totalQtyTextOf (key: string): string {
    const total = pickedList(key).reduce((sum, m) => {
      const n = Number(String(m.qty ?? '').trim())
      return sum + (Number.isFinite(n) ? n : 0)
    }, 0)
    return String(total)
  }

  /**
   * 上限的"快照串"（剩余 / 总库存 / 总金额）。
   *
   * 预填必须**跟着它一起重跑**：页面上的产品数据（库存 / 剩余）是异步到的，
   * 渲染器先挂载时上限还是空的 —— 只盯 `visibleFields` 的话，那一次预填就永远补不上了，
   * 框里空着；而只读判定又按"有上限"算，于是空框还被锁住，表现就是"无法输入接收数量"。
   */
  const limitSignature = computed(() => [remainingQtyText.value, stockQtyText.value, stockAmountText.value].join('|'))

  /*
   * 「按上限预填」：改造前的"接收"会把数量框预填成剩余上限（只读）。
   * 渲染器不该在渲染中途改数据，所以放在 watch 里、且只在空值时写一次 —— 用户删掉后不会再被他顶回来。
   */
  watch([visibleFields, limitSignature], ([list]) => {
    if (props.prefill === false || props.readonly) return
    let next: Record<string, unknown> | null = null
    for (const field of list) {
      /*
       * 要带出的两类：
       *   · `prefillFromLimit`（改造前的"接收"：预填剩余，可改）；
       *   · `readonlyWhenFull`（锁死的上限，**也必须写进表单值** —— 只显示不写的话，
       *     提交时 `extra.qty` 会缺这一项，接收台账就算不出"已接收 / 剩余"，后一组会重复收货）。
       */
      if (field.prefillFromLimit !== true && field.readonlyWhenFull !== true) continue
      if (String(valueOf(field.key) ?? '').trim() !== '') continue
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
 * 输入框里的文字是 .v-field__input（下拉显示已选项用的也是它），标签是 .v-label，后缀是 .v-text-field__suffix。
 *
 * ⚠️ 后缀的类名是 **`v-text-field__suffix`**，不是 `v-field__suffix` —— Vuetify 4 里没有后者，
 *    写错**不报错、只是不生效**（实测：改了字号界面没反应就是这个原因）。
 *    旧写法一并留着，只为了跨版本时不至于完全失效。
 * ⚠️ 下拉的**弹层选项**被 teleport 到 body，不在本组件作用域里，这里管不到（要一起变小得配
 * menu-props 的 contentClass + 一段全局样式）。
 */
.option-form-renderer :deep(.v-field__input),
.option-form-renderer :deep(.v-field__suffix),
.option-form-renderer :deep(.v-text-field__suffix),
.option-form-renderer :deep(.v-label) {
  font-size: 12px;
}

/*
 * 后缀单位（件 / ￥）比输入内容**再小一档**：它只是个量纲，跟数字同大时会抢视线
 * （数量框里「100」和「件」一样大，第一眼分不清哪个才是要看的数）。
 * 必须写在上一条**之后**：两者特异性相同，靠顺序覆盖。
 *
 * `opacity` 那一条是有意的：Vuetify 默认把后缀设成 `opacity: 0`、只在字段激活（聚焦）时
 * 才显示 —— 数量框的「件」是个固定量纲，不该"点进去才看得到"，所以这里让它常态可见、
 * 只是压暗一档（0.7，避免与数字抢注意力）。
 */
.option-form-renderer :deep(.v-text-field__suffix),
.option-form-renderer :deep(.v-field__suffix) {
  font-size: 10px;
  opacity: 0.7;
}

.field-input {
  max-width: 220px;
  flex: none;
}

/* 选接收方：整体顶对齐（团队清单是多行块，跟着中线对齐会整体偏下） */
.field-team {
  align-items: flex-start;
}

/*
 * 「选择接收团队」的平铺清单：全部候选团队各占一行，行尾一个接收数量框。
 *
 * `max-height` + 滚动：一个部门十几个人是常态，全摊开会把下面的「意见/备注」「提交按钮」
 * 顶到屏幕外；限高又保留"能一眼扫完"的优点（不折叠、不藏进下拉）。
 * 团队表里没有团队时由模板里的空态文案兜住，这里不用管。
 */
.team-matrix {
  width: 100%;
  max-height: 260px;
  overflow-y: auto;
  padding-right: 4px;
}

/* 部门小标题：只在"没识别出部门、列了全部"时出现，起分组作用 */
.team-matrix__dept {
  padding: 4px 2px 2px;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.team-matrix__row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.team-matrix__name {
  flex: none;
  min-width: 88px;
  font-size: 12px;
}

.team-matrix__mgr {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  text-overflow: ellipsis;
  white-space: nowrap;
}

/*
 * 每个团队的接收数量框：窄一点，靠右对齐成一列，扫一眼就能比大小。
 * 不限宽时 v-text-field 会吃掉整行（团队名被挤到左边一行、框占满右边），
 * 也看不出"这是哪个团队的数量"。`min-width` 兜住标签「接收数量」不被压没。
 */
.picked-qty {
  margin-top: 5px;
  flex: none;
  min-width: 104px;
  max-width: 132px;
}

/*
 * 数量 / 文本框限宽（与 textarea / select 同一档）：
 * 不限宽时它会吃掉整行，右侧的旁注（价值 / 剩余）只能换行掉到框下面 ——
 * 现场反馈的"价值跑到框下方".
 *
 * `min-width` 是后补的：右侧旁注（价值 ￥…（剩余 … 件））变长后，
 * 这里的 `flex:1 + width:0` 会把输入框压到几十像素 —— 标签被截成「接收…」、
 * 数也看不清，看着就像"不能输入"。给个下限，挤不下时让旁注换行（.field-row 本来就是 wrap）。
 */
.field-number {
  flex:1;
  min-width: 150px;
  width: 0;
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

/*
 * 「不可修改」：小锁 + 文字，与旁注同一档字色（它不是操作入口，别做得像个按钮）。
 */
.field-lock {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0.8;
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
