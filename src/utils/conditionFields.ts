import { CURRENT_GROUP_FIELD, RECEIVED_QTY_FIELD, REMAINING_QTY_FIELD } from '@/types/approval'
import { DERIVED_KEYS } from '@/utils/biRowFields'
import { PRODUCT_FIELDS } from '@/utils/productFields'

/** 条件左值 / `@引用` 的一个候选：`value` 是**求值上下文里的键**，`label` 是给人看的说明 */
export interface ConditionFieldOption {
  value: string
  label: string
}


export const CONDITION_FIELD_OPTIONS: readonly ConditionFieldOption[] = [
  ...PRODUCT_FIELDS.map(f => ({ value: f.key, label: f.title })),
  { value: DERIVED_KEYS.grossMargin, label: '派生指标（SKU3月前毛利润 ÷ SKU3月前回款 × 100）' },
  { value: DERIVED_KEYS.overseasAmount, label: '派生指标（= 总库存金额，白板里的"海外仓库存金额/呆滞金额"就是它）' },
  { value: 'result', label: '上一环节的审批结论（pass / reject / …）' },
  { value: CURRENT_GROUP_FIELD, label: '当前环节对应的组别（按组轮询时 = 本轮轮到的那个组）' },
  { value: 'amount', label: '办理时填写的金额' },
  { value: 'qty', label: '办理时填写的数量' },

  { value: RECEIVED_QTY_FIELD, label: '已接收数量（前面各环节接收数量的合计）' },
  { value: REMAINING_QTY_FIELD, label: '剩余接收数量（总库存数量 − 已接收数量）' },
  { value: 'reason_belong', label: '办理时选择的原因分类' },
  { value: 'second_reason', label: '办理时选择的二级原因' },
  { value: 'remark', label: '办理时填写的补充说明' },
  { value: 'confirmed', label: '办理时的确认标记（如报废清仓）' },
]
