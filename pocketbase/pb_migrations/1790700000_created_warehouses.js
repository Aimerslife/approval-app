/// <reference path="../pb_data/types.d.ts" />
/**
 * 仓库（仓位）清单 —— 在「角色设置 → 仓库设置」里维护的那份。
 *
 * 默认值维护在 `src/utils/warehouse.ts`（前端文件，改它即刻生效）；这张表存"人工维护过"的清单。
 * 两者的取舍口径（见 utils/warehouse 的文件头）：
 *   · 本表**一条记录都没有** → 用文件里的默认值（于是没跑过迁移也不影响任何功能）；
 *   · 本表**有记录** → 完全以它为准，「恢复默认」= 清空本表。
 *
 * 唯一索引建在 (parent, name) 上，而不是只建在 name 上：同名仓库可以挂在多个分类下
 * （现成的例子：「代发仓」在「本地仓」与「中转仓」下各有一条），只按名称唯一会把它们顶掉。
 *
 * 规则：
 *   · 读：任何登录用户 —— 审批流程里会用到仓位候选值；
 *   · 写：管理员及以上 —— 与前端 `utils/permissions` 的 ACTION_ROLES 同一口径。
 *     权限判断不能只做在前端：普通员工拿到接口也不该能改仓库清单。
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
        "id": "text1790700001",
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
        "help": "上级分类：本地仓 / 中转仓 / 海外仓 / 平台仓",
        "hidden": false,
        "id": "text1790700002",
        "max": 0,
        "min": 0,
        "name": "parent",
        "pattern": "",
        "presentable": true,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "仓库名：FBA仓 / 广州仓 / …（与 (parent) 一起唯一）",
        "hidden": false,
        "id": "text1790700003",
        "max": 0,
        "min": 0,
        "name": "name",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "hidden": false,
        "id": "autodate1790700004",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate1790700005",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_1790700000",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_warehouses_parent_name` ON `warehouses` (`parent`, `name`)"
    ],
    "listRule": "@request.auth.id != \"\"",
    "name": "warehouses",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.role = \"superAdmin\" || @request.auth.role = \"approval\"",
    "viewRule": "@request.auth.id != \"\""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1790700000");
  return app.delete(collection);
})
