// 拖拽的单个字段信息
export interface DroppedField {
  key: string
  title: string
  value: string
}

// 拖拽的整个分组（PRODUCT_GROUPS 中的一组）
export interface DroppedGroup {
  label: string
  icon: string
  fields: DroppedField[]
}

// 统一的拖拽数据：type 区分是单字段还是整组
export interface DroppedItem {
  type: 'field' | 'group'
  field?: DroppedField
  group?: DroppedGroup
}
