/// <reference path="../pb_data/types.d.ts" />
/**
 * 部门 → 部门审批人（**覆盖值**）。
 *
 * 与 `group_approvers`（团队 → 默认审批人）同构，只有唯一键不同：
 * 这里一行一个**部门**（`groupManage` 的 `parent`，如 B2C销售部），
 * 同一部门下的团队共用这一个审批人。
 *
 * 默认值维护在 `src/utils/organazation.ts` 的 `parentManager`（改文件即刻生效），
 * 这张表只存"在「角色设置」里通过通讯录换过的人"；「恢复默认」= 删掉对应那一行。
 *
 * 规则与 group_approvers 保持一致：
 *   · 读：任何登录用户；
 *   · 写：管理员及以上（@request.auth.role = superAdmin / approval）。
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
        "id": "text1792200001",
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
        "help": "部门名，与 utils/organazation.ts 里的 parent 对齐。唯一索引建在它上面，同部门只留一条。",
        "hidden": false,
        "id": "text1792200002",
        "max": 0,
        "min": 0,
        "name": "dept",
        "pattern": "",
        "presentable": true,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "审批人姓名（通讯录里选的人）",
        "hidden": false,
        "id": "text1792200003",
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
        "help": "审批人邮箱：飞书发提醒时需要落到邮箱，选人时一并存下来",
        "hidden": false,
        "id": "text1792200004",
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
        "id": "text1792200005",
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
        "id": "text1792200006",
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
        "id": "text1792200007",
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
        "id": "autodate1792200008",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate1792200009",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_1792200000",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_dept_approvers_dept` ON `dept_approvers` (`dept`)"
    ],
    "listRule": "@request.auth.id != \"\"",
    "name": "dept_approvers",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.role = \"superAdmin\" || @request.auth.role = \"approval\"",
    "viewRule": "@request.auth.id != \"\""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1792200000");
  return app.delete(collection);
})
