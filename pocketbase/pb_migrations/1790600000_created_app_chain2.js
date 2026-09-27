/// <reference path="../pb_data/types.d.ts" />
/*
 * 流程编排 v2 的模板集合（实验用，与 app_chain 完全隔离）。
 *
 * 为什么单独一张表、而不是复用 app_chain 加个标记字段：
 *   · app_chain 的读取路径（审批模板列表页 approvalModel.vue、createStream 的 loadGraph）
 *     都假设 chain 里有 { chain, flow, graph } 这套画布结构；v2 模板没有画布，
 *     混进去会让列表页出现点不开、改不了的记录；
 *   · 两种引擎的行为、校验、运行方式完全不同，物理隔离最省心，也便于随时删掉。
 *
 * 字段：
 *   name   —— 模板名
 *   status —— 1 启用 / 0 停用（与 app_chain 同口径，便于将来加过滤）
 *   spec   —— v2 模板本体：{ entry, nodes: [{ id, name, code }] }
 *             **节点代码是运行期执行的字符串**，见 src/utils/flow2Engine.ts 的说明
 *
 * 时间戳刻意用未来值（本项目惯例，见 1789660200 那条迁移的注释）：
 * 用当前时间会排到已有迁移前面去。
 */
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
        "help": "",
        "hidden": false,
        "id": "text1790600001",
        "max": 0,
        "min": 0,
        "name": "name",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "",
        "hidden": false,
        "id": "number1790600002",
        "max": null,
        "min": null,
        "name": "status",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "help": "",
        "hidden": false,
        "id": "json1790600003",
        "maxSize": 0,
        "name": "spec",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
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
    "id": "pbc_1790600000",
    "indexes": [],
    "listRule": "",
    "name": "app_chain2",
    "system": false,
    "type": "base",
    "updateRule": "",
    "viewRule": ""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1790600000");

  return app.delete(collection);
})
