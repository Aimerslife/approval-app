/// <reference path="../pb_data/types.d.ts" />
/**
 * 给 approval_chain 加 creator（建单人），指向 users。
 *
 * 为什么需要：审批单原本只记录 `order_no / status / chain`，链路上只有审批人（manager）
 * 与抄送人（cc）—— **没有任何字段说明"这张单是谁提交的"**。
 * 「我的审批单」页要区分「待办 / 抄送我的 / 我发起的」三档，前两档能从链路上算出来，
 * 「我发起的」只能靠建单时把提交者落库。
 *
 * 三条约定：
 *   1. 只在**建单**（utils/collection.ts 的 createApprocalModel）时写一次，之后不随办理变化；
 *   2. 可以为空 —— 加字段之前建的历史单没有这一项，读取侧按「不是我的」处理（fail-closed），
 *      表现是历史单在「我发起的」里看不到，不会把它们错算给别人；
 *   3. 不建索引：单据量级很小（全量一次取回，见 getApprovalOrder），先在内存里筛。
 *
 * 前缀 1789800000 排在已有迁移（最大 1789660200）之后；先按名字取集合再取 users，
 * 不写死 pbc_xxx id（换环境 id 会不同，见 1789660150 的说明）。
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("approval_chain")

  // 已加过就不重复加（避免 duplicate field 报错）
  if (collection.fields.getById("relation1789800000")) {
    return
  }

  const users = app.findCollectionByNameOrId("users")

  // add field（接在 sync_key 之后、created 之前）
  collection.fields.addAt(6, new Field({
    "cascadeDelete": false,
    "collectionId": users.id,
    "help": "建单人（users 记录 id）。用于「我发起的」；加字段之前的历史单为空。",
    "hidden": false,
    "id": "relation1789800000",
    "maxSelect": 1,
    "minSelect": 0,
    "name": "creator",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("approval_chain")

  // remove field
  collection.fields.removeById("relation1789800000")

  return app.save(collection)
})
