/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_3142077873")

  // update collection data
  unmarshal({
    "indexes": [
      "CREATE INDEX `idx_syq68shhfb` ON `feishu_departments` (\n  `dept_id`,\n  `parent_dept_id`\n)"
    ]
  }, collection)

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_3142077873")

  // update collection data
  unmarshal({
    "indexes": []
  }, collection)

  return app.save(collection)
})
