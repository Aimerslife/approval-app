/// <reference path="../pb_data/types.d.ts" />
/**
 * 呆滞库存责任划分规则 —— 在「角色设置 → 责任划分」里维护的那份。
 *
 * 默认值维护在 `src/utils/responsibility.ts`（《全渠道呆滞库存管理制度-责任归属与标准》
 * 那张表的 24 条规则，前端文件，改它即刻生效）；这张表存"人工维护过"的清单。
 * 两者的取舍口径（见 utils/responsibility 的文件头，与 warehouses 完全同款）：
 *   · 本表**一条记录都没有** → 用文件里的默认值（于是没跑过迁移也不影响任何功能）；
 *   · 本表**有记录** → 完全以它为准，「恢复默认」= 清空本表。
 *
 * 故意**不建**唯一索引：制度表里「产品侵权-外观专利侵权（产品合规中心承接）」本来就是
 * 两行（两套承接比率），同名规则合法共存；写入走"整表替换"（先删后建），见 collection.ts。
 * ratios 用 JSON 存「部门 → 承担比率」（只存 > 0 的部门，缺席 = 不承担）。
 *
 * 规则（与 warehouses 同口径）：
 *   · 读：任何登录用户；
 *   · 写：管理员及以上 —— 权限判断不能只做在前端。
 */
migrate((app) => {
  const collection = new Collection({
    "createRule": "@request.auth.role = \"superAdmin\" || @request.auth.role = \"approval\"",
    "deleteRule": "@request.auth.role = \"superAdmin\" || @request.auth.role = \"approval\"",
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "help": "",
        "hidden": false,
        "id": "text1794500001",
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
        "help": "二级原因：如「产品侵权-发明专利侵权」",
        "hidden": false,
        "id": "text1794500002",
        "max": 0,
        "min": 0,
        "name": "reason",
        "pattern": "",
        "presentable": true,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "原因类别：运营类 / 库存管理类 / 产品侵权类 / 开发类 / 供应链类 / 外部环境类",
        "hidden": false,
        "id": "text1794500003",
        "max": 0,
        "min": 0,
        "name": "category",
        "pattern": "",
        "presentable": true,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "部门 → 承担比率（0~1），只存 > 0 的部门；如 {\"运营/销售\": 0.6, \"开发\": 0.4}",
        "hidden": false,
        "id": "json1794500004",
        "maxSize": 2000000,
        "name": "ratios",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      },
      {
        "hidden": false,
        "id": "autodate1794500005",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate1794500006",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_1794500000",
    "indexes": [],
    "listRule": "@request.auth.id != \"\"",
    "name": "responsibility_rules",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.role = \"superAdmin\" || @request.auth.role = \"approval\"",
    "viewRule": "@request.auth.id != \"\""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1794500000");
  return app.delete(collection);
})
