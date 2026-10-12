/// <reference path="../pb_data/types.d.ts" />
/**
 * 飞书推送规则 —— 在「提醒设置」页面（顶栏 mdi-alarm-check）里维护的那一份。
 *
 * 默认值维护在 `src/utils/pushRules.ts`（纯函数，前端页面与服务端跑批共用同一份口径）。
 * 两者的取舍口径与仓库清单同一套（见 utils/warehouse 的文件头）：
 *   · 本表**一条记录都没有** → 用文件里的默认规则（= 改造前的行为：工作日 48h 起每天催当前审批人）；
 *   · 本表**有记录** → 以它为准（页面「恢复默认」= 清空本表）。
 *
 * 一条记录 = 一份全局规则，所以页面的保存是"单条 upsert"（见 utils/collection 的 savePushRules），
 * 不做唯一索引 —— 真要出现多条，读取侧只认最新那条（sort=-updated）。
 *
 * 规则：
 *   · 读：**公开**（空规则）—— 服务端超时跑批是进程级的，没有用户 token 可用，
 *     与 org_tree_cache 同一个做法（那份缓存连整棵通讯录都公开读）；
 *   · 写：管理员及以上 —— 与前端 utils/permissions 的 ACTION_ROLES、以及仓库清单同一口径。
 *     权限判断不能只做在前端：普通员工拿到接口也不该能改推送规则。
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
        "id": "text1790800001",
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
        "help": "定时推送总开关。关掉后跑批不发任何超时提醒（到达提醒不受它管）。",
        "hidden": false,
        "id": "bool1790800002",
        "name": "enabled",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "bool"
      },
      {
        "autogeneratePattern": "",
        "help": "推送频率：daily（每天）/ workdays（仅工作日，周末不推）",
        "hidden": false,
        "id": "text1790800003",
        "max": 20,
        "min": 0,
        "name": "frequency",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "每天不早于几点推送，'HH:mm'（跑批机器所在时区）",
        "hidden": false,
        "id": "text1790800004",
        "max": 5,
        "min": 0,
        "name": "send_time",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "待办超过多少个工作日小时开始推送（业务原口径 48）",
        "hidden": false,
        "id": "num1790800005",
        "max": null,
        "min": null,
        "name": "overdue_hours",
        "onlyInt": true,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "autogeneratePattern": "",
        "help": "推送人员口径：approver（当前审批人）/ custom（仅指定人员）/ both（两者都发）",
        "hidden": false,
        "id": "text1790800006",
        "max": 20,
        "min": 0,
        "name": "receiver_mode",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "固定收件人（receiver_mode 为 custom / both 时生效）：[{name, email, ...}]",
        "hidden": false,
        "id": "json1790800007",
        "maxSize": 100000,
        "name": "receivers",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      },
      {
        "help": "白名单：名单内的人不推送（定时提醒与到达提醒都排除）：[{name, email, ...}]",
        "hidden": false,
        "id": "json1790800008",
        "maxSize": 100000,
        "name": "whitelist",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      },
      {
        "hidden": false,
        "id": "autodate1790800009",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate1790800010",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_1790800000",
    "indexes": [],
    "listRule": "",
    "name": "push_rules",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.role = \"superAdmin\" || @request.auth.role = \"approval\"",
    "viewRule": ""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1790800000");
  return app.delete(collection);
})
