/// <reference path="../pb_data/types.d.ts" />
/**
 * 「审批类型」模板 —— 在审批模板页的「审批类型」按钮（pages/approvalTypeSetting.vue）里维护的那一份。
 *
 * 默认值维护在 `src/utils/approvalTypes.ts`（纯数据 + 纯函数），三级回落口径也写在那个文件头：
 *   1. 文件里的 `DEFAULT_TYPE_TEMPLATES`（= 改造前硬编码在组件里的行为）；
 *   2. 本表 `scope = "global"` 的行（全局覆盖）；
 *   3. 本表 `scope = "template"` + `template = <app_chain 记录 id>` 的行（审批模板级覆盖）。
 * 本表**没有行**时就是第 1 级 —— 所以"表还没建""读失败""没配过"三种情况的表现都与改造前一致
 * （与 push_rules 的取舍完全同一套，见那个迁移的注释）。
 *
 * 一行 = 某个 scope 下**一个结论码**的覆盖（fields / note / enabled）。
 * 页面的保存是"按键 upsert"（scope + template + code），刻意**不做唯一索引**：
 * 真要出现重复行，读取侧只认最新那条（sort=-updated），与 push_rules 同一口径。
 *
 * `template` 用 **text 存 app_chain 的记录 id**，不用 relation：
 *   · 唯一性/过滤口径简单（'' = 全局，无需处理 relation 的数组语义）；
 *   · 模板被删后残留行不影响任何逻辑（读取永远按当前模板 id 查），比 relation 的外键约束更好收拾。
 *
 * 规则：读写都限**管理员及以上**（需求：只有管理员以上能看能编辑）。
 *   注意权限判断不能只做在前端：普通员工拿到接口也不该能改/看这份配置。
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
        "id": "text1790900001",
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
        "help": "覆盖层级：global（全局默认）/ template（某个审批模板）",
        "hidden": false,
        "id": "text1790900002",
        "max": 20,
        "min": 0,
        "name": "scope",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "scope=template 时的审批模板 id（app_chain 记录 id）；scope=global 时为空串",
        "hidden": false,
        "id": "text1790900003",
        "max": 40,
        "min": 0,
        "name": "template",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "结论码（APPROVAL_RESULTS 的 value，如 receive / recycle / other_reason）",
        "hidden": false,
        "id": "text1790900004",
        "max": 40,
        "min": 0,
        "name": "code",
        "pattern": "",
        "presentable": true,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "help": "该结论码要填的字段（TypeField[]，见 src/utils/approvalTypes.ts）。空数组 = 不额外要东西，也是合法覆盖",
        "hidden": false,
        "id": "json1790900005",
        "maxSize": 300000,
        "name": "fields",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      },
      {
        "autogeneratePattern": "",
        "help": "给办理人的提示（缺省 = 沿用上一层）",
        "hidden": false,
        "id": "text1790900006",
        "max": 200,
        "min": 0,
        "name": "note",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "该结论是否可用（缺省 = 沿用上一层；false = 停用，不出现在办理选项里）",
        "hidden": false,
        "id": "bool1790900007",
        "name": "enabled",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "bool"
      },
      {
        "hidden": false,
        "id": "autodate1790900008",
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "id": "autodate1790900009",
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "id": "pbc_1790900000",
    "indexes": [],
    "listRule": "@request.auth.role = \"superAdmin\" || @request.auth.role = \"approval\"",
    "name": "approval_types",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.role = \"superAdmin\" || @request.auth.role = \"approval\"",
    "viewRule": "@request.auth.role = \"superAdmin\" || @request.auth.role = \"approval\""
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1790900000");
  return app.delete(collection);
})
