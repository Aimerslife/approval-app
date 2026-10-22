/**
 * 「审批类型」模板 —— 办理时"**选中某个结论之后要填什么**"的那份数据。
 *
 * ## 它要解决什么
 * 以前这些差异全是 `components/ApprovalNode.vue` 里的 v-if / v-else-if 与 `collectResult` 的
 * switch：接收类出数量、回收类出数量 + 金额、其他原因出原因/二级原因/补充说明、报废清仓
 * 什么也不填但写死一个确认标记…… 每加一种结论就要动组件。现在把它们收成"数据 + 一个渲染器"，
 * 结论码 -> 要填什么 在**页面**里维护（见 pages/approvalTypeSetting.vue）。
 *
 * ## 三级回落（与 utils/pushRules 的默认规则同一套口径）
 *   1. `DEFAULT_TYPE_TEMPLATES`（本文件，= **改造前硬编码的行为**，逐条固化）；
 *   2. 全局覆盖（`approval_types` 集合里 scope=global 的行）；
 *   3. 审批模板级覆盖（scope=template + 该模板 id 的行）。
 * 后一层能覆盖前一层的 `fields`（**整组替换**）/ `note` / `enabled`；
 * "没配过""表还没建""读失败"三种情况都回落到上一层，于是表现与改造前一致（同 pushRules 的思路）。
 *
 * ## 两条刻意划下的边界（别越界，越了就会退化成半吊子 DSL）
 * 1. **不做表达式/脚本引擎**。模板只能"选内置控件 + 填参数 + 选规则"：
 *    `control` 是内置控件、`limit` 是固定几种上限来源、`showWhen` 只管"另一个键的取值在不在给定集合里"。
 *    带副作用的（接收台账写回、指定接收方即终结、附件）保留为**内置副作用**（`effects`），
 *    只声明"要哪一种"，参数与算法留在代码里（见 TYPE_EFFECTS）。
 * 2. **运行期不查这张表**。类型模板在建单期解析后进单据快照（与 ref / probe / loop 卡片同一时机、
 *    同一套"已建的单不受后来改动影响"的口径）；办理页只读快照。否则今天改一下模板，
 *    历史单的呈现会跟着变 —— 那正是项目一直在避免的事。
 *
 * ## 与选项树的关系
 * 正交，互不冲突：选项树（`ApprovalNodeData.optionGroups`）管"**摆哪些选项、选中走哪条线**"
 * （叶子的 `link` 就是本文件的 `code`），本文件管"**选中之后要填什么**"。
 */
import { APPROVAL_RESULTS } from '@/types/approval'

/**
 * 字段用哪种**内置控件**渲染。
 *
 *   · number / text / textarea —— 输入框三兄弟；
 *   · select / radio —— 选项类；`auto` = **按选项数自动**（≤ RADIO_MAX 用单选，否则下拉，
 *     与改造前的 useOptionRadios 同口径）；
 *   · team —— 「选择接收团队 / 选择接收部门」那种"点开选一个团队/部门"的复合控件（`pick` 决定粒度）；
 *   · none —— 不渲染控件（只在数据里占位，如"选中即写死某字段"的类型）。
 */
export type TypeControl = 'number' | 'text' | 'textarea' | 'select' | 'radio' | 'auto' | 'team' | 'none'

/**
 * 数值上限的**来源**（固定几种，不是表达式）。
 *
 * 与改造前的口径一一对应：
 *   · `receive_cap`   —— 剩余接收数量（没有剩余时退回总库存数量），接收数量的上限；
 *   · `stock_qty`     —— 总库存数量，回收数量的上限；
 *   · `stock_amount`  —— 总库存金额，回收金额的上限。
 * 判定一律用**严格小于**（与改造前的 lessThan 一致：等于上限要选「全部接收」）。
 */
export type TypeLimitSource = 'receive_cap' | 'stock_qty' | 'stock_amount'

/** 下拉/单选的一个候选 */
export interface TypeFieldOption {
  /** 写入该字段的值（如原因那一列存的是**文案**，与改造前 extra.reason 一致） */
  value: string
  /** 给人看的文案 */
  label: string
  /** 分组标题（下拉按它分组显示，如原因分类的「运营 / 库存管理 / 产品侵权 / …」） */
  group?: string
  /**
   * 选中这一项时**一并写入**的其它键。
   * 例：原因要在 extra 里同时记 `reason_target`（英文码）与 `reason_belong`（分类）——
   * 这类"一项带出多个键"的写法在这里声明，不需要任何表达式。
   */
  data?: Record<string, unknown>
  /** 该原因要通知的部门（改造前的 sendDepartment，原样带过来，供后续推送用） */
  departments?: string[]
}

/** 一个字段：选中该结论后要填的一格 */
export interface TypeField {
  /** 写入 `extra` 的键名（与改造前的键名保持一致：qty / amount / reason / remark / members…） */
  key: string
  /** 界面 label 文案 */
  label: string
  control: TypeControl
  required?: boolean
  /** 输入框后缀（如 件 / ￥） */
  unit?: string
  placeholder?: string
  /** 字段下方的说明（可选） */
  hint?: string
  /** textarea 行数 */
  rows?: number
  /** 只允许正整数（`^\d+$`） */
  integer?: boolean
  /** 最多几位小数（金额 = 2） */
  decimals?: number
  min?: number
  max?: number
  /** 必须**小于**该来源的值（见 TypeLimitSource） */
  limit?: TypeLimitSource
  /**
   * 上限是否**允许等于**（默认 false = 必须严格小于）。
   *
   * 为什么两种都要：接收类里「部分接收」必须小于剩余（等于就该走全部接收），
   * 而「接收」是"能接多少填多少"，接完剩余（等于上限）是完全正常的结果。
   */
  limitInclusive?: boolean
  /** 没填时预填上限（改造前的"接收"就是这个行为） */
  prefillFromLimit?: boolean
  /** 取到上限时只读（改造前的"接收"就是这个行为） */
  readonlyWhenFull?: boolean
  /** select / radio / auto 的候选 */
  options?: TypeFieldOption[]
  /** control='team' 时的粒度：组别 / 团队 */
  pick?: 'group' | 'team'
  /**
   * 联动显隐：**只有当 `key` 的值落在 `in` 里时才显示这个字段**。
   * 只支持这一种（"上级字段的取值"），不支持与或非 —— 见文件头的边界说明。
   * 判断的是**写进表单的值**（含候选带出的附加键，如 `reason_belong`）。
   */
  showWhen?: { key: string, in: string[] }
}

/** 一个结论码的办理模板 */
export interface ApprovalTypeTemplate {
  /** = 结论码（APPROVAL_RESULTS 的 value；选项树叶子的 link 也是它） */
  code: string
  /** 显示名（取自 APPROVAL_RESULTS，不单独存） */
  name: string
  /** 选中这个结论后要填的字段（空数组 = 只填备注/附件，不额外要东西） */
  fields: TypeField[]
  /** 选中即写入的**固定值**（如报废清仓的 `{ confirmed: true }`） */
  fixedValues?: Record<string, unknown>
  /** 需要的**内置副作用**（见 TYPE_EFFECTS）；页面里只读展示，参数与算法在代码里 */
  effects?: readonly string[]
  /** 给办理人的提示（可选） */
  note?: string
  /** 停用的结论不出现在办理选项里（false = 停用；缺省 = 启用） */
  enabled?: boolean
}

/**
 * 内置副作用：只声明"要哪一种"，具体算法留在代码里（见文件头的边界说明）。
 * 页面里以只读方式展示，避免被误当成"可自由编排的能力"。
 */
export const TYPE_EFFECTS: ReadonlyArray<{ value: string, title: string, hint: string }> = [
  {
    value: 'receive_ledger',
    title: '接收台账',
    hint: '按「总库存数量 / 剩余接收数量」累计已接收数量，随办理结果写入 received_qty / remaining_qty',
  },
  {
    value: 'receiver',
    title: '指定接收方即终结',
    hint: '把选中的组别 / 团队记成接收方（members），流程到此结束（见 CLOSE_FLOW_RESULTS）',
  },
]

/** 控件类型的可选项与说明（页面直接用，别再在页面里抄一份文案） */
export const TYPE_CONTROL_OPTIONS: ReadonlyArray<{ value: TypeControl, title: string, hint: string }> = [
  { value: 'number', title: '数字输入', hint: '只填数字，可配整数 / 小数位 / 上限来源' },
  { value: 'text', title: '单行文本', hint: '一行文本' },
  { value: 'textarea', title: '多行文本', hint: '补充说明这类，可配行数' },
  { value: 'select', title: '下拉选择', hint: '选项多、或要分组时用' },
  { value: 'radio', title: '单选按钮', hint: '选项少（≤3）时更直观' },
  { value: 'auto', title: '自动（少用单选、多则下拉）', hint: '与改造前的口径一致：选项 ≤3 用单选，否则下拉' },
  { value: 'team', title: '选接收方（组别 / 团队）', hint: '打开选人面板，选中即记为接收方' },
  { value: 'none', title: '不出控件', hint: '只在数据里占位，不渲染任何输入框' },
]

/** 上限来源的可选项（页面直接用） */
export const TYPE_LIMIT_OPTIONS: ReadonlyArray<{ value: TypeLimitSource, title: string }> = [
  { value: 'receive_cap', title: '剩余接收数量（无剩余时按总库存）' },
  { value: 'stock_qty', title: '总库存数量' },
  { value: 'stock_amount', title: '总库存金额' },
]

/**
 * 结论码的分组 —— **只用于列表展示**（页面把 22 条分堆，不然一长条看不过来）。
 * 不落库：分组是"给人看的组织方式"，不是业务配置，改它不该产生数据变更。
 */
export const TYPE_CATEGORY: Readonly<Record<string, string>> = {
  pass: '常规',
  reject: '常规',
  not_receive: '常规',
  pending: '常规',
  receive: '接收类',
  receive_qty: '接收类',
  part_receive: '接收类',
  recycle: '处置类',
  supplier_recycle: '处置类',
  scrap: '处置类',
  rework: '处置类',
  discard: '处置类',
  lack_demand: '处置类',
  other_reason: '原因类',
  pick_members: '选接收方',
  pick_team: '选接收方',
  cat_operation: '原因分类',
  cat_infringe: '原因分类',
  cat_stock: '原因分类',
  cat_env: '原因分类',
  cat_quality: '原因分类',
  cat_dev: '原因分类',
  cat_supply: '原因分类',
}

/** 结论码的分组名（认不出来时给「其他」） */
export function typeCategoryOf (code: string): string {
  return TYPE_CATEGORY[code] ?? '其他'
}

/**
 * 「其他原因」的原因候选 —— 从 `components/ApprovalNode.vue` 的 `approvalModal` 原样搬过来
 * （25 条，含 `belong` 分类与 `sendDepartment`）。
 *
 * ⚠️ 现在两处各有一份（组件里仍是硬编码）。等办理页切到渲染器时，组件那一份**必须删掉**、
 * 只读这一份 —— 两份并存时间越久越容易改歪一处（这里是唯一的"源"）。
 */
export const REASON_OPTIONS: readonly TypeFieldOption[] = [
  { value: '市场需求分析不足/运营策略不当', label: '市场需求分析不足/运营策略不当', group: '运营', data: { reason_target: 'operation-analysis', reason_belong: '运营' } },
  { value: '运营-其他因素', label: '运营-其他因素', group: '运营', data: { reason_target: 'operation-other', reason_belong: '运营' } },
  { value: '销量预测偏差', label: '销量预测偏差', group: '库存管理', data: { reason_target: 'inventory-sales', reason_belong: '库存管理' }, departments: ['运营', 'PMC'] },
  { value: '库存尾数弃置', label: '库存尾数弃置', group: '库存管理', data: { reason_target: 'inventory-tail', reason_belong: '库存管理' } },
  { value: '库存保管不善', label: '库存保管不善', group: '库存管理', data: { reason_target: 'inventory-storage', reason_belong: '库存管理' }, departments: ['工厂'] },
  { value: '产品侵权-外观专利侵权（产品员自查）', label: '产品侵权-外观专利侵权（产品员自查）', group: '产品侵权', data: { reason_target: 'infringement-self', reason_belong: '产品侵权' }, departments: ['开发', '合规管理'] },
  { value: '产品侵权-外观专利侵权（产品合规中心承接）', label: '产品侵权-外观专利侵权（产品合规中心承接）', group: '产品侵权', data: { reason_target: 'infringement-center', reason_belong: '产品侵权' }, departments: ['开发', '合规管理'] },
  { value: '产品侵权-发明专利侵权', label: '产品侵权-发明专利侵权', group: '产品侵权', data: { reason_target: 'infringement-invention', reason_belong: '产品侵权' }, departments: ['开发', '研发', '合规管理'] },
  { value: '产品侵权-常规技术/常规外观竞对恶意专利抢注', label: '产品侵权-常规技术/常规外观竞对恶意专利抢注', group: '产品侵权', data: { reason_target: 'infringement-technology', reason_belong: '产品侵权' }, departments: ['合规管理'] },
  { value: '产品侵权-专利公示时间晚于检索时间', label: '产品侵权-专利公示时间晚于检索时间', group: '产品侵权', data: { reason_target: 'infringement-late', reason_belong: '产品侵权' }, departments: ['开发', '合规管理'] },
  { value: '产品侵权-其他', label: '产品侵权-其他', group: '产品侵权', data: { reason_target: 'infringement-other', reason_belong: '产品侵权' }, departments: ['开发', '合规管理'] },
  { value: '产品侵权-版权', label: '产品侵权-版权', group: '产品侵权', data: { reason_target: 'infringement-copyright', reason_belong: '产品侵权' }, departments: ['设计部'] },
  { value: '产品质量问题', label: '产品质量问题', group: '开发类', data: { reason_target: 'development-quality', reason_belong: '开发类' }, departments: ['开发', '研发', '合规管理', '采购部', '工厂'] },
  { value: '包装及设计问题', label: '包装及设计问题', group: '开发类', data: { reason_target: 'development-design', reason_belong: '开发类' }, departments: ['开发', '合规管理', '采购部', '工厂'] },
  { value: '开发/研发-其他因素', label: '开发/研发-其他因素', group: '开发类', data: { reason_target: 'development-other', reason_belong: '开发类' }, departments: ['开发', '研发'] },
  { value: '供应链-起订量限制', label: '供应链-起订量限制', group: '供应链', data: { reason_target: 'supply-order', reason_belong: '供应链' }, departments: ['运营', '开发', '采购部', '工厂'] },
  { value: '供应链-采购因素', label: '供应链-采购因素', group: '供应链', data: { reason_target: 'supply-purchase', reason_belong: '供应链' }, departments: ['采购部'] },
  { value: '供应链-物流因素', label: '供应链-物流因素', group: '供应链', data: { reason_target: 'supply-logistics', reason_belong: '供应链' }, departments: ['物流部'] },
  { value: '政策与法规变化', label: '政策与法规变化', group: '外部环境', data: { reason_target: 'outside-policy', reason_belong: '外部环境' } },
  { value: '自然灾害与突发事件导致产品不可售', label: '自然灾害与突发事件导致产品不可售', group: '外部环境', data: { reason_target: 'outside-natural', reason_belong: '外部环境' } },
  { value: '平台限制/政策调整等', label: '平台限制/政策调整等', group: '外部环境', data: { reason_target: 'outside-platform', reason_belong: '外部环境' } },
  { value: '历史遗留库存', label: '历史遗留库存', group: '外部环境', data: { reason_target: 'outside-history', reason_belong: '外部环境' } },
  { value: '其他客观因素', label: '其他客观因素', group: '外部环境', data: { reason_target: 'outside-other', reason_belong: '外部环境' } },
]

/**
 * 「二级原因」候选（开发类的进一步归类）—— 原样搬自组件的 `secondApprovalModal`。
 * ⚠️ 同上：切渲染器时组件那一份要删掉。
 */
export const SECOND_REASON_OPTIONS: readonly TypeFieldOption[] = [
  { value: '运营/销售', label: '运营/销售', data: { second_reason_target: 'sale' } },
  { value: '开发', label: '开发', data: { second_reason_target: 'develop' } },
  { value: '研发', label: '研发', data: { second_reason_target: 'search' } },
  { value: '合规管理', label: '合规管理', data: { second_reason_target: 'compliance' } },
  { value: '设计部', label: '设计部', data: { second_reason_target: 'design' } },
  { value: 'PMC', label: 'PMC', data: { second_reason_target: 'pmc' } },
  // 文案里的尾空格是原数据就有的（原样保留，别顺手 trim —— 改文案会让老单的显示对不上）
  { value: '采购部  ', label: '采购部  ', data: { second_reason_target: 'purchase' } },
  { value: '物流部', label: '物流部', data: { second_reason_target: 'logistics' } },
  { value: '工厂', label: '工厂', data: { second_reason_target: 'factory' } },
]

/**
 * 各结论码的**内置默认**办理形态。
 *
 * 这些都是"改造前硬编码在 components/ApprovalNode.vue 里的行为"的逐条固化 —— 键名、文案、
 * 后缀、校验、联动都对着原实现写，**一个字都别顺手改**：它是回落值，改了就等于悄悄改了线上行为
 * （行号见每条的注释）。
 */
const BUILTIN: Record<string, Omit<ApprovalTypeTemplate, 'code' | 'name'>> = {
  // 接收：数量预填上限、取到上限只读、写接收台账（组件 163-185 / 1150 / 1159-1166 / 1362-1365）
  receive: {
    fields: [{
      key: 'qty',
      label: '接收数量',
      control: 'number',
      required: true,
      unit: '件',
      integer: true,
      limit: 'receive_cap',
      prefillFromLimit: true,
      readonlyWhenFull: true,
    }],
    effects: ['receive_ledger'],
    note: '这一环接收的数量（取到剩余上限时按"全部接收"处理）',
  },
  // 部分接收：数量可填、必须小于剩余（组件 163-185 / 1131-1133 / 1366-1369）
  part_receive: {
    fields: [{
      key: 'qty',
      label: '接收数量',
      control: 'number',
      required: true,
      unit: '件',
      integer: true,
      limit: 'receive_cap',
    }],
    effects: ['receive_ledger'],
  },
  // 接收：数量可填、**不大于**剩余（可以等于 —— 正好接完也是正常结果），写接收台账
  receive_qty: {
    fields: [{
      key: 'qty',
      label: '接收数量',
      control: 'number',
      required: true,
      unit: '件',
      integer: true,
      limit: 'receive_cap',
      limitInclusive: true,
    }],
    effects: ['receive_ledger'],
    note: '填这一环接收的数量，不能大于剩余接收数量（等于剩余即接完）',
  },
  // 回收 / 供应商回收：数量 + 金额，上限是**总库存**（组件 187-193 / 1136-1147 / 1370-1379）
  recycle: {
    fields: [
      { key: 'qty', label: '回收数量', control: 'number', required: true, unit: '件', integer: true, limit: 'stock_qty' },
      { key: 'amount', label: '回收金额', control: 'number', required: true, unit: '￥', decimals: 2, limit: 'stock_amount' },
    ],
  },
  supplier_recycle: {
    fields: [
      { key: 'qty', label: '回收数量', control: 'number', required: true, unit: '件', integer: true, limit: 'stock_qty' },
      { key: 'amount', label: '回收金额', control: 'number', required: true, unit: '￥', decimals: 2, limit: 'stock_amount' },
    ],
  },
  // 报废清仓：不填任何东西，选中即写死确认标记（组件 1380-1388）
  scrap: {
    fields: [],
    fixedValues: { confirmed: true },
    note: '选中即视为已确认清仓，不需要再点确认',
  },
  /*
   * 其他原因：原因（分组）→ 开发类才出二级原因（组件 195-221 / 1396-1406）。
   *
   * 「外部环境」类**不给「补充说明」框**（原先这里有一个 showWhen=外部环境的 remark 字段，已按业务口径去掉）：
   * 那一类的说明直接写在办理栏下方共用的「意见/备注」里，且该框在这一类下**必填** ——
   * 见 components/approval/ApprovalHandleForm 的 externalReason / opinionRequired。
   */
  other_reason: {
    fields: [
      { key: 'reason', label: '原因', control: 'select', options: [...REASON_OPTIONS] },
      {
        key: 'second_reason',
        label: '二级原因',
        control: 'select',
        options: [...SECOND_REASON_OPTIONS],
        showWhen: { key: 'reason_belong', in: ['开发类'] },
      },
    ],
  },
  // 选接收团队 / 选接收部门：点开选人，选中即记为接收方并终结流程（组件 226-252 / 1407-1422）
  pick_members: {
    fields: [{ key: 'members', label: '选择接收团队', control: 'team', pick: 'group' }],
    effects: ['receiver'],
    note: '选中接收团队后流程即结束，后面的环节不再需要办理',
  },
  pick_team: {
    fields: [{ key: 'members', label: '选择接收部门', control: 'team', pick: 'team' }],
    effects: ['receiver'],
    note: '选中接收部门后流程即结束，后面的环节不再需要办理',
  },
  /*
   * 其余结论（通过 / 驳回 / 不接收 / 建议返工 / 建议弃置 / 市场需求不足 / 待定 / 7 个原因分类）
   * 都不额外要东西：只填备注与附件（备注/附件是**所有结论共有**的，不在这里配 —— 见渲染器的说明）。
   */
}

/**
 * 全部结论码的内置默认模板（顺序 = APPROVAL_RESULTS 的顺序，页面直接按这个顺序列）。
 *
 * `fields` 写在展开**之后**：BUILTIN 里配过的用它自己那份，没配过的（通过 / 驳回 / 各原因分类…）
 * 回落到空数组（= 不额外要东西）。
 * ⚠️ 别把它写回展开**之前**：那样 TS 会报 TS2783「fields 被指定多次、会被覆盖」
 * （先写的那个就没用了），而"没配过的结论"也拿不到该有的空数组。
 */
export const DEFAULT_TYPE_TEMPLATES: readonly ApprovalTypeTemplate[] = APPROVAL_RESULTS.map(r => {
  const builtin = BUILTIN[r.value]
  return {
    ...builtin,
    code: r.value,
    name: r.label,
    fields: builtin?.fields ?? [],
  }
})

/** code → 内置默认模板 */
export const DEFAULT_TYPE_TEMPLATE_BY_CODE: Readonly<Record<string, ApprovalTypeTemplate>> = Object.fromEntries(
  DEFAULT_TYPE_TEMPLATES.map(t => [t.code, t]),
)

/** 内置默认模板（认不出的码给一个空壳，保证调用方永远拿得到对象） */
export function defaultTypeTemplateOf (code: string): ApprovalTypeTemplate {
  return DEFAULT_TYPE_TEMPLATE_BY_CODE[code] ?? { code, name: code, fields: [] }
}

/**
 * 一层的覆盖内容（集合里一行 = 某个 scope 下某个结论码的覆盖）。
 *
 * `fields` 是**整组替换**（数组不逐条合并：半合并出来的表单谁也说不清长什么样），
 * `note` / `enabled` 逐项覆盖（缺省 = 沿用上一层）。
 */
export interface ApprovalTypeOverride {
  fields?: TypeField[]
  note?: string
  enabled?: boolean
}

/** code → 该层的覆盖（页面与 store 之间传的就是它） */
export type ApprovalTypeOverrideMap = Record<string, ApprovalTypeOverride>

const CONTROL_VALUES: ReadonlySet<string> = new Set(['number', 'text', 'textarea', 'select', 'radio', 'auto', 'team', 'none'])
const LIMIT_VALUES: ReadonlySet<string> = new Set(['receive_cap', 'stock_qty', 'stock_amount'])

/** 认不出的控件 → 按文本处理（写坏了也要能开页面，不要整块崩掉） */
function normalizeControl (raw: unknown): TypeControl {
  const v = String(raw ?? '').trim()
  return (CONTROL_VALUES.has(v) ? v : 'text') as TypeControl
}

function normalizeLimit (raw: unknown): TypeLimitSource | undefined {
  const v = String(raw ?? '').trim()
  return LIMIT_VALUES.has(v) ? (v as TypeLimitSource) : undefined
}

function normalizeOption (raw: unknown): TypeFieldOption | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const o = raw as Record<string, unknown>
  const value = String(o.value ?? '').trim()
  if (!value) {
    return null
  }
  const label = String(o.label ?? '').trim() || value
  const group = String(o.group ?? '').trim()
  const data = (o.data && typeof o.data === 'object') ? o.data as Record<string, unknown> : undefined
  const departments = Array.isArray(o.departments)
    ? o.departments.map(String).filter(Boolean)
    : undefined
  return {
    value,
    label,
    ...(group ? { group } : {}),
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
    ...(departments && departments.length > 0 ? { departments } : {}),
  }
}

/** 文本项：空串 / 空白 = **不写这一项**（写空串会让"没配"与"配了个空值"混在一起，与 onOrderFrom 同口径） */
function trimText (value: unknown): string {
  return String(value ?? '').trim()
}

/** 只认正整数（行数那种） */
function positiveInt (value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined
}

/** 只认"零或正整数"（小数位那种） */
function nonNegativeInt (value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined
}

/** 只认有限的数字（上下限那种） */
function finiteNumber (value: unknown): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

/** 联动：`{ key, in }` 两者**都齐**才算一条（半条联动等于永远不显示） */
function normalizeShowWhen (raw: unknown): { key: string, in: string[] } | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined
  }
  const o = raw as Record<string, unknown>
  const key = trimText(o.key)
  const list = (Array.isArray(o.in) ? o.in : []).map(String).filter(Boolean)
  return key && list.length > 0 ? { key, in: list } : undefined
}

/**
 * 收敛**一个字段**：没有键名的丢弃、控件 / 上限来源 / 联动认不出的回退、空项一律不写。
 *
 * 与 `normalizePushRules` 同一个思路：**逐项兜底**，别整体判空 ——
 * 库里的记录可能是人手改的、也可能是老版本写的，那时只有坏的那一项回默认，别的照旧生效。
 */
function normalizeField (raw: unknown): TypeField | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const o = raw as Record<string, unknown>
  const key = trimText(o.key)
  if (!key) {
    return null
  }
  const pick = trimText(o.pick)
  const unit = trimText(o.unit)
  const placeholder = trimText(o.placeholder)
  const hint = trimText(o.hint)
  const rows = positiveInt(o.rows)
  const decimals = nonNegativeInt(o.decimals)
  const min = finiteNumber(o.min)
  const max = finiteNumber(o.max)
  const limit = normalizeLimit(o.limit)
  const showWhen = normalizeShowWhen(o.showWhen)
  const options = (Array.isArray(o.options) ? o.options : [])
    .map(item => normalizeOption(item))
    .filter((x): x is TypeFieldOption => x !== null)
  return {
    key,
    label: trimText(o.label) || key,
    control: normalizeControl(o.control),
    ...(o.required === true ? { required: true } : {}),
    ...(unit ? { unit } : {}),
    ...(placeholder ? { placeholder } : {}),
    ...(hint ? { hint } : {}),
    ...(rows === undefined ? {} : { rows }),
    ...(o.integer === true ? { integer: true } : {}),
    ...(decimals === undefined ? {} : { decimals }),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
    ...(limit ? { limit } : {}),
    ...(o.limitInclusive === true ? { limitInclusive: true } : {}),
    ...(o.prefillFromLimit === true ? { prefillFromLimit: true } : {}),
    ...(o.readonlyWhenFull === true ? { readonlyWhenFull: true } : {}),
    ...(options.length > 0 ? { options } : {}),
    ...(pick === 'group' || pick === 'team' ? { pick } : {}),
    ...(showWhen ? { showWhen } : {}),
  }
}

/**
 * 收敛一组字段：丢掉认不出的、**同键去重**（后一条覆盖前一条）。
 *
 * 与 `normalizePushRules` 同一个思路：**逐项兜底**，别整体判空 ——
 * 库里的记录可能是人手改的、也可能是老版本写的，那时只有坏的那一项回默认，别的照旧生效。
 */
export function normalizeTypeFields (raw: unknown): TypeField[] {
  const list = Array.isArray(raw) ? raw : []
  const out: TypeField[] = []
  const seen = new Set<string>()
  for (const item of list) {
    const field = normalizeField(item)
    if (!field || seen.has(field.key)) {
      continue
    }
    seen.add(field.key)
    out.push(field)
  }
  return out
}

/** 收敛一层的覆盖（`null` = 这一层没有覆盖） */
export function normalizeTypeOverride (raw: unknown): ApprovalTypeOverride {
  if (!raw || typeof raw !== 'object') {
    return {}
  }
  const o = raw as Record<string, unknown>
  const note = String(o.note ?? '').trim()
  return {
    ...(Array.isArray(o.fields) ? { fields: normalizeTypeFields(o.fields) } : {}),
    ...(note ? { note } : {}),
    ...(o.enabled === undefined ? {} : { enabled: o.enabled !== false }),
  }
}

/**
 * 把三层合成一份**最终模板**：内置默认 → 全局覆盖 → 模板级覆盖。
 *
 * 后一层能覆盖前一层的 `fields`（整组替换）/ `note` / `enabled`；没有覆盖的项沿用前一层。
 */
export function resolveTypeTemplate (
  code: string,
  layers: ReadonlyArray<ApprovalTypeOverrideMap | undefined> = [],
): ApprovalTypeTemplate {
  const base = defaultTypeTemplateOf(code)
  const merged: ApprovalTypeTemplate = { ...base }
  for (const layer of layers) {
    const ov = layer?.[code]
    if (!ov) {
      continue
    }
    if (ov.fields) {
      merged.fields = ov.fields
    }
    if (ov.note !== undefined) {
      merged.note = ov.note
    }
    if (ov.enabled !== undefined) {
      merged.enabled = ov.enabled
    }
  }
  return merged
}

/** 全部结论码的最终模板（顺序与 DEFAULT_TYPE_TEMPLATES 一致） */
export function resolveTypeTemplates (
  layers: ReadonlyArray<ApprovalTypeOverrideMap | undefined> = [],
): ApprovalTypeTemplate[] {
  return DEFAULT_TYPE_TEMPLATES.map(t => resolveTypeTemplate(t.code, layers))
}

/**
 * 建单期要随单据带走的那一份：只留**非空壳**的行。
 *
 * 空壳（`fields` 为空、没有 note / fixedValues / effects、也没被停用）与内置默认完全一致，
 * 存进快照只是白占体积 —— 22 个结论里大部分都是这种。
 * 读的一侧永远经 `typeTemplateFromSnapshot` 兜底，所以"没存"与"存了空壳"是同一种结果。
 */
export function slimTypeTemplates (list: readonly ApprovalTypeTemplate[]): Record<string, ApprovalTypeTemplate> {
  const kept = list.filter(t =>
    t.fields.length > 0
    || !!t.fixedValues
    || !!t.note
    || t.enabled === false
    || (t.effects?.length ?? 0) > 0,
  )
  return Object.fromEntries(kept.map(t => [t.code, t]))
}

/**
 * 读单据快照里的 `types`（建单期由 slimTypeTemplates 写进去）。
 *
 * 容错：老单（那会儿还没有这一项）/ 手改坏的 JSON / 少字段 —— 一律当"没配"跳过，
 * 最后由 typeTemplateFromSnapshot 回落到内置默认（= 改造前的行为）。
 */
export function typesFromSnapshot (raw: unknown): Record<string, ApprovalTypeTemplate> {
  if (!raw || typeof raw !== 'object') {
    return {}
  }
  const out: Record<string, ApprovalTypeTemplate> = {}
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    const t = value as Partial<ApprovalTypeTemplate> | null | undefined
    if (!t || typeof t !== 'object' || !Array.isArray(t.fields)) {
      continue
    }
    out[code] = {
      code,
      name: String(t.name ?? code),
      fields: normalizeTypeFields(t.fields),
      ...(t.fixedValues ? { fixedValues: t.fixedValues } : {}),
      ...(t.note ? { note: String(t.note) } : {}),
      ...(t.enabled === false ? { enabled: false } : {}),
      ...(Array.isArray(t.effects) ? { effects: t.effects.map(String) } : {}),
    }
  }
  return out
}

/**
 * 办理期取某个结论**生效**的模板：**只读快照**。
 *
 * 这是文件头第 2 条边界的落点：运行期不查 `approval_types` 表，
 * 否则今天改一下模板，历史单的填写项会跟着变。快照里没有（老单）→ 内置默认。
 */
export function typeTemplateFromSnapshot (
  snapshot: Record<string, ApprovalTypeTemplate> | undefined,
  code: string,
): ApprovalTypeTemplate {
  return snapshot?.[code] ?? defaultTypeTemplateOf(code)
}

/** 这条字段当前是否要展示（联动口径见 TypeField.showWhen） */
export function isFieldVisible (field: TypeField, values: Record<string, unknown>): boolean {
  if (!field.showWhen) {
    return true
  }
  const cur = String(values[field.showWhen.key] ?? '')
  return field.showWhen.in.includes(cur)
}

/**
 * **一组**字段的一行摘要 —— 列表里"选中这个结论要填什么"那一列。
 *
 * 空数组（= 不额外要东西）也要说清楚，**别留空白**：空白看上去像"没配好"，
 * 而这其实是一个正常且常见的配置。审批类型列表页与详情页左列表**共用**这一句话
 * （只此一处，别在两处各写一份：改文案时一定会漏一处）。
 */
export function typeFieldsSummaryOf (fields: readonly TypeField[] | undefined): string {
  const list = fields ?? []
  return list.length === 0 ? '不需要额外填写' : list.map(f => f.label || f.key).join('、')
}

/** 字段的一行摘要（列表里不展开也能看个大概：`接收数量 · 数字 · 必填`） */
export function fieldSummaryOf (field: TypeField): string {
  const controlTitle = TYPE_CONTROL_OPTIONS.find(o => o.value === field.control)?.title ?? field.control
  const parts = [field.control === 'team' ? controlTitle : controlTitle]
  if (field.required) {
    parts.push('必填')
  }
  if (field.limit) {
    parts.push(`< ${TYPE_LIMIT_OPTIONS.find(o => o.value === field.limit)?.title ?? field.limit}`)
  }
  if (field.showWhen) {
    parts.push(`当 ${field.showWhen.key} ∈ ${field.showWhen.in.join('/')}`)
  }
  return parts.join(' · ')
}
