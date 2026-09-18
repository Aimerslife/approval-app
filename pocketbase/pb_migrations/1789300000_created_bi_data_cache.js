/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = new Collection({
    "createRule": "",
    "deleteRule": "",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text3208210256",
        "max": 15,
        "min": 15,
        "name": "id",
        "pattern": "^[a-z0-9]+$",
        "presentable": false,
        "primaryKey": true,
        "required": true,
        "system": true,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "BI 组件 id。一个组件只保留一条缓存（写入时按它 upsert），所以记录数不会随刷新次数增长。",
        "hidden": false,
        "id": "text1789300001",
        "max": 0,
        "min": 0,
        "name": "component_id",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "归一化后的整份行数据。maxSize 必须显式给大：json 字段 maxSize=0 时 PocketBase 默认只允许 1MB，而实测全量约 10.5MB。PB 的请求体上限实测在 12~35MB 之间（35MB 返回 413），故取 20MB。",
        "hidden": false,
        "id": "json1789300002",
        "maxSize": 20000000,
        "name": "rows",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      },
      {
        "help": "行数，便于不解析 rows 就能在后台看出数据规模",
        "hidden": false,
        "id": "number1789300003",
        "max": null,
        "min": null,
        "name": "row_count",
        "onlyInt": true,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "help": "从 BI 拉到这份数据的时刻（ISO 字符串）。前端按它判断是否过期，而不是用 PB 的 updated —— 重写同一条记录时 updated 会变，但那不代表数据变新了。",
        "hidden": false,
        "id": "text1789300004",
        "max": 0,
        "min": 0,
        "name": "fetched_at",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "缓存结构版本。改了 api.ts 的 normalizeBiRows 或字段别名表就 +1，让老缓存自动失效。",
        "hidden": false,
        "id": "text1789300005",
        "max": 0,
        "min": 0,
        "name": "data_version",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "autodate2990389176",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate3332085495",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_1789300001",
    "indexes": [],
    "listRule": "",
    "name": "bi_data_cache",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1789300001");
  return app.delete(collection);
})
