/// <reference path="../pb_data/types.d.ts" />
/**
 * 组别 → 默认审批人（**覆盖值**）。
 *
 * 默认值维护在 `src/utils/organazation.ts`（前端文件，改它即刻生效）；
 * 这张表只存"在「角色设置」里通过通讯录换过的人" —— 一行一个组别（group 上有唯一索引），
 * 所以：默认值仍以文件为准，谁被换过、换成了谁，记在这里。
 * 「恢复默认」= 删掉对应那一行。
 *
 * 规则：
 *   · 读：任何登录用户 —— 建单/看流程时会用到，不该限制；
 *   · 写：管理员及以上 —— 与前端 `utils/permissions` 的 `ACTION_ROLES` 同一口径。
 *     权限判断不能只做在前端：普通员工拿到接口也不该能改审批人。
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
        "help": "组别名，与 utils/organazation.ts 里的 group 对齐。唯一索引建在它上面，同组只留一条。",
        "hidden": false,
        "id": "text1789700001",
        "max": 0,
        "min": 0,
        "name": "group",
        "pattern": "",
        "presentable": true,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "上级部门（冗余存一份，方便这张表自己就能读出层级）",
        "hidden": false,
        "id": "text1789700002",
        "max": 0,
        "min": 0,
        "name": "parent",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "审批人姓名（通讯录里选的人）",
        "hidden": false,
        "id": "text1789700003",
        "max": 0,
        "min": 0,
        "name": "manager",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "审批人邮箱：飞书发提醒时需要落到邮箱，选人时一并存下来，省得回头再查通讯录",
        "hidden": false,
        "id": "text1789700004",
        "max": 0,
        "min": 0,
        "name": "manager_email",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "审批人头像 URL",
        "hidden": false,
        "id": "text1789700005",
        "max": 0,
        "min": 0,
        "name": "manager_avatar",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "审批人所属部门（通讯录里取的最近一层）",
        "hidden": false,
        "id": "text1789700006",
        "max": 0,
        "min": 0,
        "name": "manager_department",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "审批人部门完整路径，如「总公司 / 财务部 / 财务BP组」",
        "hidden": false,
        "id": "text1789700007",
        "max": 0,
        "min": 0,
        "name": "manager_department_path",
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
    "id": "pbc_1789700000",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_group_approvers_group` ON `group_approvers` (`group`)"
    ],
    "listRule": "@request.auth.id != \"\"",
    "name": "group_approvers",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.role = \"superAdmin\" || @request.auth.role = \"approval\"",
    "viewRule": "@request.auth.id != \"\""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1789700000");
  return app.delete(collection);
})
