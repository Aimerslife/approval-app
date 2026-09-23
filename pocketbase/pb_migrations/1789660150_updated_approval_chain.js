/// <reference path="../pb_data/types.d.ts" />
/**
 * 给 approval_chain 加 relation 字段，指向 bi_rows。
 *
 * ⚠️ 文件名前缀是 1789660150，**不是原来的 1789548325**。
 *    bi_rows 由 1789660000_created_bi_rows.js 创建，而 1789548325 < 1789660000：
 *    全新库（pb_data 被 gitignore，克隆后必然是新库）回放到原前缀时 bi_rows 还不存在，
 *    直接报 "The relation collection doesn't exist" 并中断整个 PocketBase 启动。
 *    放在 1789660100（bi_rows 收尾）与 1789660200（加 sync_key）之间，
 *    这样 1789660200 的 addAt(5) 仍然正好落在 relation(index 4) 之后。
 *
 * 幂等：老库里这条已按旧文件名 1789548325 执行过、字段已存在，这里直接跳过。
 */
migrate((app) => {
  // 按**名字**取集合，不写死 pbc_xxx id
  const collection = app.findCollectionByNameOrId("approval_chain")

  // 已加过（按旧文件名迁移过来的库）就不重复加，避免 "duplicate field" 报错
  if (collection.fields.getById("relation1653163849")) {
    return
  }

  const biRows = app.findCollectionByNameOrId("bi_rows")

  // add field
  collection.fields.addAt(4, new Field({
    "cascadeDelete": false,
    "collectionId": biRows.id,
    "help": "",
    "hidden": false,
    "id": "relation1653163849",
    "maxSelect": 0,
    "minSelect": 0,
    "name": "relation",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "relation"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("approval_chain")

  // remove field
  collection.fields.removeById("relation1653163849")

  return app.save(collection)
})
