/// <reference path="../pb_data/types.d.ts" />
/**
 * 审批规则表：**一条审批流管一类数据**（按维度匹配），对应「A 方案」。
 *
 * 为什么用规则表、而不是给 bi_rows 每一行加外键：
 *   bi_rows 有约 3000+ 行，而规则通常只有几十条，并且语义是「平台=亚马逊 且 部门=X 的数据走这条流」。
 *   把归属写到 3000 行上，等于把「规则」物化成了 3000 份副本 —— 改一条规则要改几千行，
 *   而且 BI 每次同步都会把行替换掉，归属还得重算。
 *   放在规则表里，匹配是「3000 行 × 几十条规则」的一次求值，两边都不需要写死。
 *
 * 匹配语义（与页面顶部的筛选栏同一套心智模型）：
 *   - 下面 9 个维度字段，**留空 = 该维度不限**；
 *   - 填了的维度必须**全部满足**（AND）；
 *   - 多条规则同时命中时，取 priority 最大的那条；
 *   - sale_status 与 bi_rows 一样是多值逗号串，用「包含」匹配。
 */
migrate((app) => {
  // app_chain 的集合 id 不写死，从库里现取 —— 硬编码 pbc_xxx 在别人环境里必定失效
  const appChain = app.findCollectionByNameOrId("app_chain");

  const collection = new Collection({
    "createRule": "@request.auth.id != ''",
    "deleteRule": "@request.auth.id != ''",
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
        "cascadeDelete": true,
        "collectionId": appChain.id,
        "help": "命中的审批流模板（app_chain）。模板被删时级联删掉这条规则。",
        "hidden": false,
        "id": "relation1789660061",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "app_chain",
        "presentable": true,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "autogeneratePattern": "",
        "help": "规则名（给人看的备注，如「亚马逊-灯具-呆滞」）。",
        "hidden": false,
        "id": "text1789660062",
        "max": 0,
        "min": 0,
        "name": "name",
        "pattern": "",
        "presentable": true,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "停用的规则不参与匹配（保留配置，不用删掉重填）。",
        "hidden": false,
        "id": "bool1789660063",
        "name": "enabled",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "bool"
      },
      {
        "help": "多条规则同时命中时取最大值。留空按 0 处理；建议留出间隔（10/20/30…）便于插队。",
        "hidden": false,
        "id": "number1789660064",
        "max": null,
        "min": null,
        "name": "priority",
        "onlyInt": true,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "autogeneratePattern": "",
        "help": "维度：平台。留空 = 不限。",
        "hidden": false,
        "id": "text1789660065",
        "max": 0,
        "min": 0,
        "name": "platform",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "维度：部门。留空 = 不限。",
        "hidden": false,
        "id": "text1789660066",
        "max": 0,
        "min": 0,
        "name": "department",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "维度：组别。留空 = 不限。",
        "hidden": false,
        "id": "text1789660067",
        "max": 0,
        "min": 0,
        "name": "group_name",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "维度：一级品类。留空 = 不限。",
        "hidden": false,
        "id": "text1789660068",
        "max": 0,
        "min": 0,
        "name": "category1",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "维度：二级品类。留空 = 不限。",
        "hidden": false,
        "id": "text1789660069",
        "max": 0,
        "min": 0,
        "name": "category2",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "维度：自产/外购（BI 字段「供应商是否为络好饰」）。留空 = 不限。",
        "hidden": false,
        "id": "text1789660070",
        "max": 0,
        "min": 0,
        "name": "supplier",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "维度：仓位。留空 = 不限。",
        "hidden": false,
        "id": "text1789660071",
        "max": 0,
        "min": 0,
        "name": "warehouse",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "维度：销售状态。取值用「包含」匹配 —— bi_rows 里这列是多值逗号串（如「停售,删除,在售」），用相等会漏掉所有组合值。留空 = 不限。",
        "hidden": false,
        "id": "text1789660072",
        "max": 0,
        "min": 0,
        "name": "sale_status",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "维度：是否属于呆滞库存（「是」/「否」）。留空 = 不限。",
        "hidden": false,
        "id": "text1789660073",
        "max": 0,
        "min": 0,
        "name": "is_dead",
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
    "id": "pbc_1789660060",
    "indexes": [
      "CREATE INDEX `idx_approval_rules_enabled` ON `approval_rules` (`enabled`, `priority`)"
    ],
    "listRule": "@request.auth.id != ''",
    "name": "approval_rules",
    "system": false,
    "type": "base",
    "updateRule": "@request.auth.id != ''",
    "viewRule": "@request.auth.id != ''"
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1789660060");
  return app.delete(collection);
})
