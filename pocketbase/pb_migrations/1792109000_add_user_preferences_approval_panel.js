/// <reference path="../pb_data/types.d.ts" />
/**
 * user_preferences 补一个「审批页办理面板默认展开」的开关字段。
 *
 * ## 为什么必须有
 *
 * 审批页底部是一个可折叠的办理面板（components/approval/ApprovalHandleForm.vue 的宿主，
 * 见 pages/approvalPage.vue）：默认收起，点「办理」才展开；用户展开 / 收起的状态会存成偏好
 * `approvalPanelOpen`（见 stores/user.ts 的 savePreferences）。
 *
 * 但建表迁移与后续补字段的迁移里都没有这一列 ——
 * **PB 对 schema 中不存在的字段是静默忽略的**：update 返回 200、库里什么都没写、前端也拿不到错误。
 * 表现就是「这次展开、刷新又缩回去了」，且日志里查不出来。
 *
 * ## 口径
 *
 * 只存布尔值：true = 下次进页面默认展开；false / 没存过 = 默认收起（代码里的默认值）。
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1789400001")

  // 插在 goodsFieldOrder 之后、created 之前（位置只为后台看起来整齐，不影响功能）
  collection.fields.addAt(8, new Field({
    "help": "审批页底部办理面板是否默认展开。没存过按收起处理。",
    "hidden": false,
    "id": "bool1792109001",
    "name": "approvalPanelOpen",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "bool"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1789400001")

  collection.fields.removeByName("approvalPanelOpen")

  return app.save(collection)
})
