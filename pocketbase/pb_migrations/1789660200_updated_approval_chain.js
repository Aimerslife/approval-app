/// <reference path="../pb_data/types.d.ts" />
/**
 * 给 approval_chain 加 sync_key：审批单与 bi_rows 的**业务键**兜底关联。
 *
 * 为什么光有 relation（1789548325 加的那个）不够：
 *   relation 存的是 bi_rows 的**记录 id**，而 bi_rows 是「每次同步都会重写」的表 ——
 *   server/biSync.ts 按 (component_id, sync_key) upsert：
 *     · 行被更新          → 记录 id 不变，relation 仍然指得对 ✓
 *     · 行在 BI 侧消失、被 prune 删掉、之后又出现 → 会拿到**新的 id** ✗
 *   后一种情况下旧审批单的 relation 就指向了一条不存在的记录 ——
 *   PB 不会因此报错（删被关联记录时它只是把该字段清空），这张单就再也对不回数据了。
 *
 * sync_key 不受重写影响：口径是 SYNC_KEY_FIELDS
 * （SKU|店铺|仓位|组别|是否属于呆滞库存，见 src/utils/biRowFields.ts），
 * 由业务字段拼成，行换了 id 还是同一个键。
 * 读取侧用 `relation = <id> || sync_key = <key>` 即可在换 id 之后重新对上，
 * 写入侧见 src/utils/collection.ts 的 createApprocalModel / getOrdersByRow。
 *
 * 刻意不加唯一索引：同一条数据可以有多张审批单（驳回后重开），sync_key 本来就会重复。
 * 本迁移只加一列，不动规则、不动索引。
 *
 * 注：前缀取 1789660200 而不是当前时间 —— 本项目已有的迁移用的是**未来**时间戳
 *     （最大 1789660100，比当前 epoch 还大），用当前时间会排到它们前面去。
 */
migrate((app) => {
  // 按**名字**取集合，不写死 pbc_xxx id：别的环境里 id 不一定相同，
  // 1789548325 那条把 bi_rows 的 id 写死，导致全新库跑到它就报
  // "The relation collection doesn't exist"（因为 bi_rows 的迁移前缀更大、还在后面）。
  const collection = app.findCollectionByNameOrId("approval_chain")

  // add field（放在 relation 之后）
  collection.fields.addAt(5, new Field({
    "autogeneratePattern": "",
    "help": "业务键（= bi_rows.sync_key，SKU|店铺|仓位|组别|是否属于呆滞库存）。bi_rows 重写后 id 会变，用它兜底。",
    "hidden": false,
    "id": "text1789660201",
    "max": 0,
    "min": 0,
    "name": "sync_key",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("approval_chain")

  // remove field
  collection.fields.removeById("text1789660201")

  return app.save(collection)
})
