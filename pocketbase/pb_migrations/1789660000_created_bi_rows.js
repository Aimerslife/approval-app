/// <reference path="../pb_data/types.d.ts" />
/**
 * BI 数据行表：**一行一条记录**，替代原来 bi_data_cache 里「整份数据塞一个 json 字段」的做法。
 *
 * 为什么要拆（原方案：一个组件一条记录，rows 是 20MB 的 json）：
 *   1) 每次进数据页都要把 **10.5MB** 全量传回浏览器，哪怕只看 20 行；
 *   2) 服务端筛选 / 排序 / 分页全部做不到 —— 只能在浏览器里算，
 *      而 BI 接口又不支持 sorts（实测四种形态均被静默忽略），所以之前只能退回客户端全量；
 *   3) 无法与审批规则建立关联 —— relation 字段指不进 json 内部；
 *   4) 改一行要整条回写 10.5MB，且单条体积已逼近 PB 的请求体上限（实测 35MB 返回 413）。
 *
 * 字段设计是**混合**的，这是关键：
 *   - 整行原样存在 data(json) 里 —— BI 增删列**不需要改迁移**；
 *   - 只把「要匹配 / 要筛选 / 要排序」的维度**提升为真列**并建索引。
 *   不要给 65 个字段都建真列：BI 一改列就要写一次迁移，维护不住。
 *
 * 数据量参考：实测约 7918 行（其中约 53% 是完全重复的行），去重后约 3000+ 行。
 *
 * ⚠️ 关于 sync_key（幂等键）与唯一索引：
 *   下面给 (component_id, sync_key) 建了 UNIQUE 索引，sync_key 取 SKU。
 *   如果 BI 里 SKU 有重复，**第一次同步就会直接报唯一索引冲突**（报错里带冲突的 SKU），
 *   不会静默写坏数据 —— 这正是想要的行为。若 SKU 确实不唯一，
 *   就把 sync_key 改成「SKU + 其它维度」的组合（改 server/biSync.ts）。
 *
 * ⚠️ PB 字段的 help 上限是 300 **字节**（一个中文 3 字节，即约 100 字）。
 *   超了会在 migrate 时报 "help: the length must be between 1 and 300"。
 *   所以这里的长篇说明一律写在注释里，help 只留一句话。
 */
migrate((app) => {
  const collection = new Collection({
    "createRule": null,
    "deleteRule": null,
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
        "help": "BI 组件 id。同一个 BI 组件的数据都带同一个值，便于换组件时整批替换。",
        "hidden": false,
        "id": "text1789660001",
        "max": 0,
        "min": 0,
        "name": "component_id",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "幂等键 = SKU。同步按 (component_id, sync_key) upsert，同一 SKU 只留一条。见文件头注释。",
        "hidden": false,
        "id": "text1789660002",
        "max": 0,
        "min": 0,
        "name": "sync_key",
        "pattern": "",
        "presentable": true,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "SKU（BI 字段名是「库存SKU」，api.ts 里有别名映射）。",
        "hidden": false,
        "id": "text1789660003",
        "max": 0,
        "min": 0,
        "name": "sku",
        "pattern": "",
        "presentable": true,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "SPU。",
        "hidden": false,
        "id": "text1789660004",
        "max": 0,
        "min": 0,
        "name": "spu",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "维度：平台。审批规则按这个字段匹配。",
        "hidden": false,
        "id": "text1789660005",
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
        "help": "维度：部门。",
        "hidden": false,
        "id": "text1789660006",
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
        "help": "维度：组别。\n字段名不叫 group 是因为 group 是 SQL 保留字，PB 生成过滤 SQL 时容易出问题。",
        "hidden": false,
        "id": "text1789660007",
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
        "help": "维度：组长。",
        "hidden": false,
        "id": "text1789660008",
        "max": 0,
        "min": 0,
        "name": "leader",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "维度：仓位。",
        "hidden": false,
        "id": "text1789660009",
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
        "help": "维度：店铺。",
        "hidden": false,
        "id": "text1789660010",
        "max": 0,
        "min": 0,
        "name": "shop",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "维度：一级品类。",
        "hidden": false,
        "id": "text1789660011",
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
        "help": "维度：二级品类。",
        "hidden": false,
        "id": "text1789660012",
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
        "help": "维度：销售状态。**可能是多值逗号串**（实测有「删除,在售」「停售,删除,在售」），所以规则匹配要用「包含」而不是相等。",
        "hidden": false,
        "id": "text1789660013",
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
        "help": "维度：自产/外购。BI 里的字段名是「供应商是否为络好饰」，界面上显示为「自产/外购」。",
        "hidden": false,
        "id": "text1789660014",
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
        "help": "维度：是否属于呆滞库存。取值已归一化为「是」/「否」。",
        "hidden": false,
        "id": "text1789660015",
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
        "autogeneratePattern": "",
        "help": "维度：是否属于灯具。取值已归一化为「是」/「否」。",
        "hidden": false,
        "id": "text1789660016",
        "max": 0,
        "min": 0,
        "name": "is_lamp",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "autogeneratePattern": "",
        "help": "最早开售日期-SKU。用 text 而不是 date：BI 给的就是 'YYYY-MM-DD' 字符串，字典序即时间序，可以直接比大小；转成 date 反而要额外处理空值。",
        "hidden": false,
        "id": "text1789660017",
        "max": 0,
        "min": 0,
        "name": "sell_date",
        "pattern": "",
        "presentable": false,
        "primaryKey": false,
        "required": false,
        "system": false,
        "type": "text"
      },
      {
        "help": "整行原始数据（65 个字段原样保留）。BI 增删列时这里自动跟上，不用改迁移；表格要显示非索引列也从这里取。",
        "hidden": false,
        "id": "json1789660018",
        "maxSize": 100000,
        "name": "data",
        "presentable": false,
        "required": false,
        "system": false,
        "type": "json"
      },
      {
        "help": "这一行数据是从 BI 拉到的时间（ISO 字符串）。整批同步时写入同一个值。",
        "hidden": false,
        "id": "text1789660019",
        "max": 0,
        "min": 0,
        "name": "fetched_at",
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
    "id": "pbc_1789660001",
    "indexes": [
      "CREATE UNIQUE INDEX `idx_bi_rows_sync_key` ON `bi_rows` (`component_id`, `sync_key`)",
      "CREATE INDEX `idx_bi_rows_dims` ON `bi_rows` (`platform`, `department`, `group_name`)",
      "CREATE INDEX `idx_bi_rows_sku` ON `bi_rows` (`sku`)"
    ],
    "listRule": "@request.auth.id != ''",
    "name": "bi_rows",
    "system": false,
    "type": "base",
    "updateRule": null,
    "viewRule": "@request.auth.id != ''"
  });

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1789660001");
  return app.delete(collection);
})
