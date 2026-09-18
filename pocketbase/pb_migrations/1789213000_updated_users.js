/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  // 企业名称：取用户所在部门的顶层祖先部门名（飞书没有「查企业名」的公开接口）
  collection.fields.addAt(13, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text2460500861",
    "max": 0,
    "min": 0,
    "name": "company_name",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // 部门名：用户所在的最近一级部门（与飞书 department.get 的 name 一致）
  collection.fields.addAt(14, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text8815642903",
    "max": 0,
    "min": 0,
    "name": "department",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  // 部门完整路径：形如「总公司 / 财务部 / 财务BP组」，由服务端沿 parent_department_id 上溯拼成
  collection.fields.addAt(15, new Field({
    "autogeneratePattern": "",
    "help": "",
    "hidden": false,
    "id": "text3310457928",
    "max": 0,
    "min": 0,
    "name": "department_path",
    "pattern": "",
    "presentable": false,
    "primaryKey": false,
    "required": false,
    "system": false,
    "type": "text"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  collection.fields.removeById("text2460500861")
  collection.fields.removeById("text8815642903")
  collection.fields.removeById("text3310457928")

  return app.save(collection)
})
