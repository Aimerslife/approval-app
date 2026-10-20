/// <reference path="../pb_data/types.d.ts" />
/**
 * users 集合的 API 规则：放行「超级管理员」看 / 改**全部**成员。
 *
 * ## 为什么必须改
 *
 * auth 集合（`_pb_users_auth_`）的默认规则是 `id = @request.auth.id` ——
 * `listRule` 会把列表接口**在服务端**过滤成"只剩调用者自己那一条"。
 * 于是「角色设置」页的成员表格永远只有自己一位（本地库里当时确实只有 1 个用户，
 * 但即使有几百人，`getUserInfo()` 也照样只拿得到自己），
 * `updateRule` 同样使得"改别人角色"必然 403。
 *
 * 三条规则统一改成：**本人 或 应用里的超级管理员**（`@request.auth.role`）。
 * 普通用户的口径**没有变化** —— 依然只能看自己、改自己。
 *
 * ## 代价（明知而为）
 *
 * superAdmin 由此能通过 API 直接改**任意用户记录的任意字段**（含 `password`）。
 * 界面上只暴露了「角色」一个入口，但这是 PB 层的真实权限面。
 * 若要收紧，得把"改角色"挪到服务端（拿 PB_ADMIN_* 代改，见 server/ 下那些特权接口）。
 *
 * ## 依赖
 *
 * 规则里的 `@request.auth.role` 读的是 `users.role` 的原始值，
 * 与 `src/utils/permissions.ts` 的 `superAdmin / approval / normal` 同一口径。
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  const rule = '@request.auth.id != "" && (@request.auth.role = "superAdmin" || id = @request.auth.id)'

  collection.listRule = rule
  collection.viewRule = rule
  collection.updateRule = rule

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("_pb_users_auth_")

  // 回滚成 PB 给 auth 集合的默认值（只能操作自己）
  collection.listRule = "id = @request.auth.id"
  collection.viewRule = "id = @request.auth.id"
  collection.updateRule = "id = @request.auth.id"

  return app.save(collection)
})
