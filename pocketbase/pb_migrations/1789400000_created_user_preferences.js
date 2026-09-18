/// <reference path="../pb_data/types.d.ts" />
/**
 * 把用户偏好从 users 集合搬到独立集合 user_preferences。
 *
 * 为什么必须搬：PB 的登录态是 `base64({token, model})` 塞进**单个 cookie** 的，
 * 浏览器对单个 cookie 的硬上限是 4096 字节，超了会**静默丢弃**（旧 cookie 保留），
 * 于是刷新后读到的是旧记录、偏好"存了又没了"。
 * 实测带 preferences 时 cookie 已 4100~4900 字节必然超限；
 * 搬走之后 users 记录从 ~2.8KB 降到 ~0.9KB，cookie 回到 1.7KB 左右。
 *
 * 规则用 `user = @request.auth.id` —— 只能读写自己的那份。
 * 不能用 ""（那是**任何人**都能读写别人的偏好）。
 */
migrate((app) => {
  const collection = new Collection({
    "createRule": "user = @request.auth.id",
    "deleteRule": "user = @request.auth.id",
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
        "collectionId": "_pb_users_auth_",
        "help": "归属用户。一个用户一条记录（下面有唯一索引）。用户被删时级联删除。",
        "hidden": false,
        "id": "relation1789400001",
        "maxSelect": 1,
        "minSelect": 0,
        "name": "user",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "relation"
      },
      {
        "help": "「字段设置」里各 BI 字段的显隐。只存与代码默认值不同的项。",
        "hidden": false,
        "id": "json1789400002",
        "maxSize": 0,
        "name": "columnVisibility",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      },
      {
        "help": "「数据」表格的列顺序（数组顺序即列顺序）。**只有真的重排过才写**，否则留空回落字段清单的默认顺序 —— 全量 65 项约 1.9KB，没必要常驻。",
        "hidden": false,
        "id": "json1789400003",
        "maxSize": 0,
        "name": "columnLayout",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      },
      {
        "help": "「数据」表格被调过的列宽（稀疏，key → px）。",
        "hidden": false,
        "id": "json1789400004",
        "maxSize": 0,
        "name": "columnWidths",
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
    "id": "pbc_1789400001",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_user_preferences_user` ON `user_preferences` (`user`)"
    ],
    "listRule": "user = @request.auth.id",
    "name": "user_preferences",
    "system": false,
    "type": "base",
    "updateRule": "user = @request.auth.id",
    "viewRule": "user = @request.auth.id"
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1789400001");
  return app.delete(collection);
})
