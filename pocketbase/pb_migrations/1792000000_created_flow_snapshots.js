/// <reference path="../pb_data/types.d.ts" />
/**
 * 「流程快照」集合（`flow_snapshots`）—— **模板版本化瘦身**的另一半（读侧解包见
 * src/utils/flowSnapshot.ts，写侧引用化见 utils/collection 的 createApprocalModel / updateApprovalOrder）。
 *
 * ## 为什么需要它
 *
 * 单据 `chain.flow` 是建单时固化下来的整棵流程（引用模板展开 + 角色解析成具体人 + id 短化），
 * 一张 ~100KB。同模板同团队的多行建单，除业务上下文相关成员外**逐字节相同**——
 * 逐单固化等于把同一份内容抄了几十遍。
 *
 * 引用化后：flow 按**内容 hash（SHA-256 前 16 位 hex）**存进本集合去重，
 * 单据里只留 `{ snap: 记录id }`（几百字节）。读单据时数据访问层按引用批量拉回、
 * 就地还原成数组 —— 下游 runtimeOf / 页面对此无感（拿到的始终是数组）。
 * 快照按内容寻址、**不可变**（同 hash 永远同内容），所以缓存永不失真；
 * 老单不受影响（flow 还是数组，读路径原样透传）。
 *
 * ## 字段
 *   · `hash` text  —— SHA-256(json) 前 16 位，**唯一索引**（并发建同内容靠它撞出重查）
 *   · `flow` json  —— 压缩后的流程（compactFlowSnapshot 的产物）
 *   · `size` number —— json 字节数（体检/监控用，非口径）
 *
 * ## 规则
 *   · 读 / 建：**已登录** —— 建单（引用化）和读单（解包）都需要；快照没有隐私字段，
 *     且 hash 是全文摘要不可枚举。
 *   · 改 / 删：superAdmin / approval —— 快照不可变，谁都不该改它；清理走管理员。
 */
migrate((app) => {
  // 幂等：已建过（按本迁移跑过的库）直接跳过
  try {
    app.findCollectionByNameOrId("flow_snapshots");
    return;
  } catch {
    // 不存在 → 往下建
  }

  const READ = "@request.auth.id != \"\"";
  const ADMIN_UP = "@request.auth.role = \"superAdmin\" || @request.auth.role = \"approval\"";

  const collection = new Collection({
    "createRule": READ,
    "deleteRule": ADMIN_UP,
    "fields": [
      {
        "autogeneratePattern": "[a-z0-9]{15}",
        "hidden": false,
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
        "help": "SHA-256(flow json) 前 16 位 hex —— 全局去重的键",
        "hidden": false,
        "max": 0,
        "min": 0,
        "name": "hash",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": true,
        "system": false,
        "type": "text"
      },
      {
        "help": "压缩后的完整流程（compactFlowSnapshot 产物），单据里只存引用",
        "hidden": false,
        "maxSize": 0,
        "name": "flow",
        "presentable": false,
        "required": true,
        "system": false,
        "type": "json"
      },
      {
        "help": "flow json 的字节数（体检用，非口径）",
        "hidden": false,
        "max": null,
        "min": null,
        "name": "size",
        "onlyInt": false,
        "presentable": false,
        "required": false,
        "system": false,
        "type": "number"
      },
      {
        "hidden": false,
        "name": "created",
        "onCreate": true,
        "onUpdate": false,
        "presentable": false,
        "system": false,
        "type": "autodate"
      },
      {
        "hidden": false,
        "name": "updated",
        "onCreate": true,
        "onUpdate": true,
        "presentable": false,
        "system": false,
        "type": "autodate"
      }
    ],
    "indexes": [
      "CREATE UNIQUE INDEX idx_flow_snapshots_hash ON flow_snapshots (hash)"
    ],
    "listRule": READ,
    "name": "flow_snapshots",
    "system": false,
    "type": "base",
    "updateRule": ADMIN_UP,
    "viewRule": READ
  });

  return app.save(collection);
}, (app) => {
  // 回滚：本集合是纯新建的（老库没有历史数据），直接删
  const collection = app.findCollectionByNameOrId("flow_snapshots");
  return app.delete(collection);
})
