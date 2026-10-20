/**
 * PocketBase 清单请求的**请求键**（`requestKey`）注册表。
 *
 * ## 为什么需要它
 *
 * SDK 默认的请求键是 `method + baseCrudPath`（`/api/collections/<集合>/records`）—— **不含查询串**。
 * 也就是说：**同一集合的并发清单请求，不管 `sort` / `filter` 是否相同，都会互相取消**
 * （SDK 发新请求前会 abort 掉同键的旧请求；机制与源码位置见 pocketbase.ts 的自动取消说明）。
 *
 * 危险的地方在于本项目这些读函数**大多 catch 成空结果**：`return []`、
 * "按没有覆盖处理"、"回落默认清单 / 默认规则"。于是撞车时页面只是
 * **"莫名空白 / 莫名变回默认"**，一条报错都没有，排查时根本想不到是两条请求互相踩了。
 *
 * ## 口径
 *
 * **同一集合、不同用途的清单读取，各给一个键**：
 *   · 不同用途 → 键不同 → 互不打扰；
 *   · 同一用途重复发（连点两次、并发两轮取数）→ 键相同 → 旧的仍被取消 ——
 *     **这正是要的**：别让先发的旧结果盖住后发的新结果。
 *
 * 命名统一 `<集合>:<用途>`。参数不同会撞到一起的（按 scope 读、按集合读探针），
 * 用下面的函数把参数编进键里，别共用一个常量。
 *
 * 不需要登记的两种情况：
 *   · `getOne` / `update` / `delete` —— path 带 id，天然不撞；
 *   · `getFirstListItem` —— SDK 自己按 filter 生成了键（源码里的 `one_by_filter_<path>_<filter>`）。
 *
 * ⚠️ 新增"读同一张表的第二个入口"时，**先来这里确认键不重复**。
 */

export const PB_REQUEST_KEY = {
  // ===== users（成员清单，见 utils/collection）=====
  /**
   * 「角色设置」页要的**全量成员** —— `getUserInfo`。
   *
   * 它是 `getFullList`（内部会循环翻页、连发多次同键请求）。目前本集合的清单读
   * **只此一处**，但登记在这里：以后想加"按部门筛成员""通讯录候选"之类的入口时，
   * 先来这里确认键不重复，否则两边会互相取消、各自变成空列表。
   */
  usersList: 'users:list',

  // ===== app_chain（审批流**模板**，见 utils/collection）=====
  /** 模板管理页的表格 —— `getApproval` */
  chainList: 'app_chain:list',
  /** 只给 id / name 的候选（「引用模板」卡片的源模板下拉、审批类型的作用域下拉）—— `getApprovalOptions` */
  chainOptions: 'app_chain:options',
  /**
   * 删除模板前的**引用关系检查** —— `findTemplatesUsing`。
   * 这一步尤其不能撞：被取消会走进它的 catch 返回 `[]`，而调用方把 `[]` 理解成
   * "没有模板引用它"，于是一张**被引用的模板会被放行删除**，问题要到下一次建单才暴露。
   */
  chainRefs: 'app_chain:refs',

  // ===== approval_types（审批类型覆盖，见 utils/approvalTypeStore）=====
  /** 写入某层某个结论码的覆盖（upsert 之前那次"有没有旧行"的读） */
  approvalTypesWrite: 'approval_types:write',
  /** 整层恢复默认（先读全部再逐条删） */
  approvalTypesReset: 'approval_types:reset',

  // ===== approval_chain（审批**单**，见 utils/collection 与 stores/pending）=====
  /** 单据列表（首页 / 我的审批单那张表）—— `getApprovalOrder` */
  orderList: 'approval_chain:list',
  /** 单行反查单据（办理页按一条数据找它的单）—— `getOrdersByRow` */
  orderByRow: 'approval_chain:by-row',
  /** 批量按行反查（列表页几十行一次查完，分块发）—— `getOrdersByRows` */
  orderByRows: 'approval_chain:by-rows',
  /** 只取关联键（工作台按任务状态筛数据行）—— `getOrderRowKeys` */
  orderRowKeys: 'approval_chain:row-keys',
  /**
   * 侧边栏「我的审批单」角标那个 COUNT（stores/pending 的 `refresh`）。
   *
   * 它在**每次路由切换 / 每 60s / 窗口聚焦**时都会发，所以和单据列表撞车的概率极高 ——
   * 必须单独一个键：否则一边被顶掉，重的那个就是"进列表页整屏空白"。
   */
  orderPendingCount: 'approval_chain:pending-count',

  // ===== bi_rows（BI 数据行，见 api/api 与 utils/rotationData）=====
  /** 分页列表（数据页表格）—— `fetchBiRows` */
  biRowsPage: 'bi_rows:page',
  /** 导出用的全量拉取 —— `fetchAllBiRows` */
  biRowsAll: 'bi_rows:all',
  /** 轮询节点建单期取数 —— `utils/rotationData` */
  biRowsRotation: 'bi_rows:rotation',
  /** 探针那种"只问有没有"的单行读 —— `getProduct` */
  biRowsOne: 'bi_rows:one',

  // ===== warehouses（仓库清单，见 utils/collection）=====
  /** 读本次要用的清单（读失败回落默认清单）—— `loadWarehouses` */
  warehousesList: 'warehouses:list',
  /** 整表对齐写入前的读 —— `saveWarehouses` */
  warehousesWrite: 'warehouses:write',
  /** 恢复默认（清空表）前的读 —— `resetWarehouses` */
  warehousesReset: 'warehouses:reset',

  // ===== push_rules（飞书推送规则，见 utils/pushRulesStore）=====
  /** 读规则（失败回落默认规则）—— `loadPushRules` */
  pushRulesLoad: 'push_rules:load',
  /** 单条 upsert 写入前的读 —— `savePushRules` */
  pushRulesWrite: 'push_rules:write',
  /** 恢复默认（删记录）前的读 —— `resetPushRules` */
  pushRulesReset: 'push_rules:reset',
} as const

/**
 * `approval_types` 某一层的取数键 —— **按 scope 分**。
 *
 * 为什么不共用一个常量：不同层（全局 / 各张模板）会并发读（切作用域、页面同时要全局层与模板层），
 * 共用键会让它们互相取消；而取消的后果是"这一层没有覆盖"，
 * 界面上就是**覆盖明明配过却显示成默认**。
 * 同一层重复读仍然会互相取消（旧结果不该盖住新结果）。
 */
export function approvalTypesLoadKey (scopeId: string): string {
  return `approval_types:load:${scopeId}`
}

/**
 * 建单期「数据查询」探针的键 —— **按集合分**。
 *
 * 探针查哪个集合是用户在流程里配的，可能与页面正在读的同一张表撞上
 * （例如探针查 `bi_rows`，而页面同时在拉数据行）。探针是**"查不出来就抛错"**的：
 * 被取消会被当成"查询失败"而让这一条建单失败，所以必须与别的读隔开。
 */
export function probeQueryKey (collection: string): string {
  return `probe:${collection}`
}
