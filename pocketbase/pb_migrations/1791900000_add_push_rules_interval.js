/// <reference path="../pb_data/types.d.ts" />
/**
 * 「提醒设置」加一列「推送间隔」：超时之后每隔多少小时**再**催一次。
 *
 * 为什么单开一个迁移、而不是改 1790800000_created_push_rules：
 * 那一份在本地/线上都已经跑过，**改历史迁移不会重新执行** —— 列加不上，
 * 页面保存时还会因为"未知字段"被 PB 拒掉。加列一律走新迁移。
 *
 * 这一列可以为空：`push_rules` 表里**没有记录**时用 src/utils/pushRules 的默认规则（24 小时 = 每天一条），
 * 已有记录缺这一列时 normalizePushRules 也会回落到 24 —— 三种情况（没配过 / 老记录 / 读失败）
 * 的表现都与改造前一致，不会因为上线这个字段让提醒突然变多。
 */
migrate((app) => {
  const collection = app.findCollectionByNameOrId("pbc_1790800000");

  // add field：插在 overdue_hours 之后（它俩是"什么时候开始催"和"多久再催一次"，读代码时挨着最清楚）
  collection.fields.addAt(5, new Field({
    "help": "推送间隔（小时）：超时后每隔多少小时再催一次（24 = 每天一条，与改造前一致）",
    "hidden": false,
    "id": "num1791900001",
    "max": null,
    "min": null,
    "name": "interval_hours",
    "onlyInt": true,
    "presentable": false,
    "required": false,
    "system": false,
    "type": "number"
  }));

  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("pbc_1790800000");

  // remove field
  collection.fields.removeById("num1791900001");

  return app.save(collection);
});
