/// <reference path="../pb_data/types.d.ts" />
/**
 * user_preferences 补三个「产品详情」字段设置用的 json 字段。
 *
 * ## 为什么必须有
 *
 * components/GoodsInfo.vue 的字段面板（显隐 / 高亮 / 拖拽顺序）会把偏好写进
 * user_preferences（见 stores/user.ts 的 savePreferences），键分别是
 * `goodsFieldVisibility` / `goodsFieldHighlight` / `goodsFieldOrder`。
 *
 * 但建表迁移（1789400000_created_user_preferences.js）里只有
 * `columnVisibility` / `columnLayout` / `columnWidths` 三个 ——
 * 而 **PB 对 schema 中不存在的字段是静默忽略的**：update 请求照样返回 200、
 * 库里一个字节都没写进去、前端也拿不到任何错误。
 * 表现就是「字段设置改完，刷新/换设备又全变回默认」，看日志完全查不出来。
 *
 * ## 口径
 *
 * 三个字段与 columnVisibility 同一套：**只存与默认值不同的项** ——
 *   显隐存"被关掉的"、高亮存"被勾上的"（默认不高亮）、顺序只在真的重排过时才写全量。
 * 所以任一项的体积都很小，不会把 PB 的登录 cookie 顶到 4096 字节上限
 * （那条上限的来龙去脉见 stores/user.ts 的 refreshFromServer）。
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1789400001")

  // 插在 columnWidths 之后、created 之前（位置只为后台看起来整齐，不影响功能）
  collection.fields.addAt(5, new Field({
    "help": "「产品详情」字段面板的显隐。只存被关掉的项。",
    "hidden": false,
    "id": "json1792108901",
    "maxSize": 0,
    "name": "goodsFieldVisibility",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  collection.fields.addAt(6, new Field({
    "help": "「产品详情」字段面板的高亮。只存被勾上的项（默认不高亮）。",
    "hidden": false,
    "id": "json1792108902",
    "maxSize": 0,
    "name": "goodsFieldHighlight",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  collection.fields.addAt(7, new Field({
    "help": "「产品详情」字段面板的排列顺序（字段 key 数组，即表格列顺序）。没重排过就留空，读取侧回落字段清单的默认顺序。",
    "hidden": false,
    "id": "json1792108903",
    "maxSize": 0,
    "name": "goodsFieldOrder",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1789400001")

  collection.fields.removeByName("goodsFieldVisibility")
  collection.fields.removeByName("goodsFieldHighlight")
  collection.fields.removeByName("goodsFieldOrder")

  return app.save(collection)
})
