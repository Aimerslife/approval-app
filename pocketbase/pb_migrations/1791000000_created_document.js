/// <reference path="../pb_data/types.d.ts" />
/**
 * 「说明文档」集合（`document`）—— 「审批说明」页（顶栏 mdi-book-open-variant → /knowledge）
 * 与文档编辑页（/editRule）用的那一份。
 *
 * ## 这个迁移是「补齐 + 收紧」，不是纯新建
 * 这份集合在本仓库的历史里是**手工在 PB 后台建的**（一直没进迁移），而且里面可能已经有文档。
 * 所以：
 *   · 集合**不存在**（全新部署）→ 按下面的字段定义建出来；
 *   · 集合**已存在**（老库）→ **只收紧访问规则**，字段一个都不动
 *     （动字段要重写数据，风险远大于收益；老库的字段本来就已经齐了）。
 * 这样同一个文件对两种环境都安全，也不会因为"集合已存在"让 PB 起不来。
 *
 * ## ⚠️ 集合 id 与字段 id 都是**照老库写死**的，别改
 * 后台改 schema 时自动生成了三个迁移（`1791798550` 加 subscribe / `1791798590` 把第 3 个字段
 * 改名为 title / `1791856603` 加 status），它们内部用的是
 * `app.findCollectionByNameOrId("pbc_2552746607")` 和写死的字段 id。
 * 所以这里的 id 必须与老库**完全一致**，那三个迁移在全新部署上才会变成
 * "addAt 同 id 同定义 = 空操作"，一路干净地重放到与老库一致的 schema。
 * （自造一个 id 的后果实测过：`migrate up` 在那三个文件上直接
 *  `sql: no rows in result set` 中断。）
 *
 * ## 字段（与老库现状一致，前端只用其中四个）
 *   · `content`   editor —— 正文（v-md-editor 写进来）
 *   · `title`     text   —— 标题（列表卡片 + 发布弹窗填）
 *   · `subscribe` text   —— 简略信息（列表卡片副标题 + 发布弹窗填）
 *   · `status`    number —— **发布标记：1 = 已发布，0 = 未发布**
 *     ⚠️ 前端「列表只显示已发布的」用的就是它（见 utils/collection 的 getDocument）。
 *   · `published` bool   —— 脚手架时代留下的旧标记，**已不再是口径**；
 *     发布时会顺手写成 true，免得两个字段各说各话（口径只认 status）。
 *
 * ## 规则（这次要收紧的地方）
 * 老库里 list/view/create/update/delete 五条**全是空串 = 对所有人开放**，
 * 也就是任何登录用户都能改、能删说明文档。收紧为：
 *   · 读：已登录即可（说明文档本来就是给全员看的）；
 *   · 写（增 / 改 / 删）：**管理员及以上** —— 与 utils/permissions 的
 *     `/editRule`（ADMIN_UP）以及 push_rules / group_approvers / warehouses / approval_types 同一口径。
 *     权限判断不能只做在前端：普通员工拿到接口也不该能改文档。
 */
migrate((app) => {
  const ADMIN_UP = "@request.auth.role = \"superAdmin\" || @request.auth.role = \"approval\"";
  const READ = "@request.auth.id != \"\"";

  // 老库：集合已存在 → 只收紧规则（不碰字段、不碰数据）
  let existing = null;
  try {
    existing = app.findCollectionByNameOrId("pbc_2552746607");
  } catch {
    existing = null;
  }
  if (existing) {
    existing.listRule = READ;
    existing.viewRule = READ;
    existing.createRule = ADMIN_UP;
    existing.updateRule = ADMIN_UP;
    existing.deleteRule = ADMIN_UP;
    return app.save(existing);
  }

  // 全新部署：按老库的字段定义（含 id）建出来
  const collection = new Collection({
    "createRule": ADMIN_UP,
    "deleteRule": ADMIN_UP,
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
        "convertURLs": false,
        "help": "正文（v-md-editor 写进来的 markdown）",
        "hidden": false,
        "id": "editor599990054",
        "maxSize": 0,
        "name": "content",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "editor"
      },
      {
        "help": "旧标记（脚手架时代留下的）：口径已改看 status，发布时会顺手写成 true",
        "hidden": false,
        "id": "bool1748787223",
        "name": "published",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "bool"
      },
      {
        "autogeneratePattern": "",
        "help": "标题：列表卡片与发布弹窗都显示它",
        "hidden": false,
        "id": "text999008199",
        "max": 0,
        "min": 0,
        "name": "title",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "简略信息：列表卡片副标题与发布弹窗都显示它",
        "hidden": false,
        "id": "text1756979006",
        "max": 0,
        "min": 0,
        "name": "subscribe",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "发布标记：1 = 已发布（前端列表只显示 1），0 = 未发布",
        "hidden": false,
        "id": "number2063623452",
        "max": null,
        "min": null,
        "name": "status",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
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
    "id": "pbc_2552746607",
    "indexes": [],
    "listRule": READ,
    "name": "document",
    "system": false,
    "type": "base",
    "updateRule": ADMIN_UP,
    "viewRule": READ
  });

  return app.save(collection);
}, (app) => {
  /*
   * 回滚只把规则放回"公开"，**不删集合**：
   * 老库里的 document 是手工建的、而且装着真实文档，删掉会把文档一起弄没 ——
   * 这个迁移的职责是"确保存在 + 收紧规则"，回滚它也就该只回滚规则。
   */
  const collection = app.findCollectionByNameOrId("pbc_2552746607");
  collection.listRule = "";
  collection.viewRule = "";
  collection.createRule = "";
  collection.updateRule = "";
  collection.deleteRule = "";
  return app.save(collection);
})
