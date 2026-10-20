/**
 * productFields.ts
 *
 * BI 产品字段的**唯一清单**：标题 / key / 是否可排序 / 默认可见性 / 列宽。
 *
 * 这份清单以前在三个地方各存了一份副本：
 *   - src/pages/detail.vue       的 headers（还是死代码，从未被引用）
 *   - src/pages/userSetting.vue  的 headers（「字段设置」开关）
 *   - src/utils/mockProduct.ts   的 PRODUCT_HEADERS
 * 三份的 key 完全一致但顺序不同，改字段要同步三处，迟早漏改。
 * 现在统一从这里派生，改字段只改这一处。
 *
 * 关于 visualable：
 *   它是**默认值**。用户改过的存在 users.preferences.columnVisibility，
 *   且只存「与默认值不同」的项 —— 这样 BI 增 / 删字段后，
 *   没存过的字段自动回落这里的默认值，老用户不会被旧快照永久锁定。
 *
 * 关于 width：
 *   **不含单元格内边距**的内容宽度（单位 px），仅供表格做列宽参考。
 *   取值口径：取真实数据里该字段内容的 p90 长度（中文按 2 个半角字符计），
 *   换算 ≈ 字符数 × 6（表上字号 12px），并夹在 [60, 220]；
 *   表头标题本身也作为下限，保证标题能完整显示。
 *   三个已有字段（图片链接 / SKU / 产品名称）是手工调过的，予以保留。
 */

export interface ProductField {
  title: string
  key: string
  sortable?: boolean
  /** 默认是否显示（BI 增 / 删字段时改这里） */
  visualable: boolean
  only: string
  /** 内容宽度（不含单元格内边距）。表格用它做 minWidth，表格因此可横向滚动 */
  width: number
  /**
     * 横向滚动时固定在左侧。
     * 这是 **v-data-table 的原生能力**（headers[].fixed）——
     * Vuetify 会生成 .v-data-table-column--fixed 并为每列算好 left 偏移（fixedOffset），
     * 所以不用自己写 sticky 样式；多列固定也能自动累加偏移。
     */
  fixed?: boolean
}

export const PRODUCT_FIELDS: ProductField[] = [
  // 1.图片链接。fixed: 横向滚动时固定在最左侧（原生能力，见 ProductField.fixed 注释）
  { title: '产品图片', key: '图片链接', sortable: false, visualable: false, only: 'all', width: 50, fixed: true },
  // 2.产品信息
  { title: 'SKU', key: 'SKU', sortable: false, visualable: false, only: 'all', width: 100 },
  { title: 'SPU', key: 'SPU', sortable: false, visualable: false, only: 'all', width: 84 },
  { title: '主MODEL', key: '主MODEL', sortable: false, visualable: false, only: 'all', width: 72 },
  { title: '产品名称', key: '产品名称', sortable: false, visualable: false, only: 'all', width: 200 },
  { title: '季节性产品标签', key: '季节性产品标签', sortable: false, visualable: false, only: 'amazon,TK', width: 60 },
  // 3.开售时间
  { title: '最早开售日期-SKU', key: '最早开售日期-SKU', sortable: true, visualable: true, only: 'amazon,TK', width: 96 },
  { title: '拓业部最早时间-SPU', key: '拓业部最早时间-SPU', sortable: true, visualable: true, only: 'expand', width: 108 },
  // 4.组织信息类
  { title: '自产/外购', key: '供应商', sortable: false, visualable: false, only: 'all', width: 60 },
  { title: '组长', key: '组长', sortable: false, visualable: false, only: 'all', width: 60 },
  { title: '团队', key: '团队', sortable: false, visualable: false, only: 'all', width: 60 },
  { title: '部门', key: '部门', sortable: false, visualable: false, only: 'all', width: 60 },
  // 5.平台
  { title: '仓位', key: '仓位', sortable: false, visualable: false, only: 'all', width: 60 },
  { title: '店铺', key: '店铺', sortable: false, visualable: false, only: 'amazon,TK', width: 60 },
  { title: '平台', key: '平台', sortable: false, visualable: false, only: 'all', width: 60 },
  // 6.呆滞 / 待评估（注意「是否属于待评估库存」参与唯一键，见 utils/biRowFields 的 SYNC_KEY_FIELDS）
  { title: '亚马逊呆滞条件', key: '亚马逊呆滞条件', sortable: false, visualable: false, only: 'amazon,TK', width: 220 },
  { title: '拓业部呆滞条件', key: '拓业部呆滞条件', sortable: false, visualable: false, only: 'expand', width: 220 },
  { title: '是否属于待评估库存', key: '是否属于待评估库存', sortable: false, visualable: false, only: 'all', width: 96 },
  { title: '销售状态', key: '销售状态', sortable: false, visualable: false, only: 'amazon,TK', width: 60 },
  // 7.品类
  { title: '一级品类', key: '一级品类', sortable: true, visualable: true, only: 'all', width: 72 },
  { title: '二级品类', key: '二级品类', sortable: true, visualable: true, only: 'all', width: 60 },
  { title: '产品类型', key: '是否属于灯具', sortable: false, visualable: false, only: 'all', width: 72 },
  // 8.库存数量
  { title: '采购中', key: '采购中', sortable: false, visualable: false, only: 'all', width: 60 },
  { title: 'FBA在仓', key: 'FBA在仓', sortable: false, visualable: false, only: 'all', width: 60 },
  { title: 'FBA在途', key: 'FBA在途', sortable: false, visualable: false, only: 'all', width: 60 },
  { title: '本地仓', key: '本地仓', sortable: false, visualable: false, only: 'all', width: 60 },
  { title: '海外仓在仓', key: '海外仓在仓', sortable: false, visualable: false, only: 'all', width: 60 },
  { title: '海外仓在途', key: '海外仓在途', sortable: false, visualable: false, only: 'all', width: 60 },
  // 9.总库存
  { title: '总库存数量', key: '总库存数量', sortable: true, visualable: true, only: 'all', width: 60 },
  { title: '总库存金额', key: '总库存金额', sortable: true, visualable: true, only: 'all', width: 60 },
  { title: '未入仓', key: '未入仓', sortable: false, visualable: false, only: 'all', width: 60 },
  // 10.库龄数量
  { title: '3个月内[数量]', key: '3个月内[0-90]', sortable: true, visualable: true, only: 'all', width: 102 },
  { title: '3-6个月内[数量]', key: '3-6个月内[91-180]', sortable: true, visualable: true, only: 'all', width: 78 },
  { title: '6-9个月内[数量]', key: '6-9个月内[181-270]', sortable: true, visualable: true, only: 'all', width: 108 },
  { title: '9-12个月内[数量]', key: '9-12个月内[271-365]', sortable: true, visualable: true, only: 'all', width: 114 },
  { title: '1年以上[数量]', key: '1年以上[365+]', sortable: true, visualable: true, only: 'all', width: 78 },
  // 11.库龄金额类
  { title: '3个月内（金额）', key: '3个月内[0-90]（金额）', sortable: true, visualable: true, only: 'all', width: 126 },
  { title: '3-6个月内(金额)', key: '3-6个月内[91-180](金额)', sortable: true, visualable: true, only: 'all', width: 138 },
  { title: '6-9个月内(金额)', key: '6-9个月内[181-270](金额)', sortable: true, visualable: true, only: 'all', width: 144 },
  { title: '9-12个月内(金额）', key: '9-12个月内[271-365](金额）', sortable: true, visualable: true, only: 'all', width: 156 },
  { title: '一年以上(金额)', key: '一年以上[365+](金额)', sortable: true, visualable: true, only: 'all', width: 120 },
  // 12.SKU回款
  { title: 'SKU1月前回款', key: 'SKU1月前回款', sortable: true, visualable: true, only: 'amazon,TK', width: 114 },
  { title: 'SKU2月前回款', key: 'SKU2月前回款', sortable: true, visualable: true, only: 'amazon,TK', width: 114 },
  { title: 'SKU3月前回款', key: 'SKU3月前回款', sortable: true, visualable: true, only: 'amazon,TK', width: 114 },
  { title: 'SKU上年回款', key: 'SKU上年回款', sortable: true, visualable: true, only: 'amazon,TK', width: 114 },
  // 13.SKU毛利润
  { title: 'SKU1月前毛利润', key: 'SKU1月前毛利润', sortable: true, visualable: true, only: 'amazon,TK', width: 114 },
  { title: 'SKU2月前毛利润', key: 'SKU2月前毛利润', sortable: true, visualable: true, only: 'amazon,TK', width: 114 },
  { title: 'SKU3月前毛利润', key: 'SKU3月前毛利润', sortable: true, visualable: true, only: 'amazon,TK', width: 114 },
  // 14.父ASIN回款
  { title: '父ASIN1月前回款', key: '父ASIN1月前回款', sortable: true, visualable: true, only: 'amazon,TK', width: 108 },
  { title: '父ASIN2月前回款', key: '父ASIN2月前回款', sortable: true, visualable: true, only: 'amazon,TK', width: 114 },
  { title: '父ASIN3月前回款', key: '父ASIN3月前回款', sortable: true, visualable: true, only: 'amazon,TK', width: 108 },
  { title: '父ASIN上一年回款', key: '父ASIN上一年回款', sortable: true, visualable: true, only: 'amazon,TK', width: 108 },
  // 15.父ASIN毛利润
  { title: '父ASIN1月前毛利润', key: '父ASIN1月前毛利润', sortable: true, visualable: true, only: 'amazon,TK', width: 114 },
  { title: '父ASIN2月前毛利润', key: '父ASIN2月前毛利润', sortable: true, visualable: true, only: 'amazon,TK', width: 114 },
  { title: '父ASIN3月前毛利润', key: '父ASIN3月前毛利润', sortable: true, visualable: true, only: 'amazon,TK', width: 114 },
  // 16.SPU回款
  { title: 'SPU1月前回款', key: 'SPU1月前回款', sortable: true, visualable: true, only: 'expand', width: 114 },
  { title: 'SPU2月前回款', key: 'SPU2月前回款', sortable: true, visualable: true, only: 'expand', width: 114 },
  { title: 'SPU3月前回款', key: 'SPU3月前回款', sortable: true, visualable: true, only: 'expand', width: 114 },
  { title: 'SPU4月前回款', key: 'SPU4月前回款', sortable: true, visualable: true, only: 'expand', width: 114 },
  // 17.SPU毛利润
  { title: 'SPU1月前毛利润', key: 'SPU1月前毛利润', sortable: true, visualable: true, only: 'expand', width: 114 },
  { title: 'SPU2月前毛利润', key: 'SPU2月前毛利润', sortable: true, visualable: true, only: 'expand', width: 114 },
  { title: 'SPU3月前毛利润', key: 'SPU3月前毛利润', sortable: true, visualable: true, only: 'expand', width: 114 },
  { title: 'SPU4月前毛利润', key: 'SPU4月前毛利润', sortable: true, visualable: true, only: 'expand', width: 114 },
  // 18.销量
  { title: 'SKU近一年月平均销量', key: 'SKU近一年月平均销量', sortable: true, visualable: true, only: 'all', width: 114 },
  { title: 'SPU近一年月平均销量', key: 'SPU近一年月平均销量', sortable: true, visualable: true, only: 'expand', width: 114 },
]

/** key → 默认可见性。偏好里没存过的字段回落到这里 */
export const DEFAULT_VISUALABLE: Record<string, boolean> = Object.fromEntries(
  PRODUCT_FIELDS.map(f => [f.key, f.visualable]),
)

/* ==================== 字段对齐：外部数据（BI / Excel）→ 页面列 key ==================== */

/**
 * 表头 / 字段名的清洗：去首尾空白，并把全角空格（U+3000）、不换行空格（U+00A0）换成半角。
 *
 * 为什么需要：上传的 Excel 表头常常是从 BI 页面上复制出来的，带这类空格时
 * 肉眼完全看不出差别，但判等会失败，整列静默变空。
 */
export function cleanFieldName (name: unknown): string {
  return String(name ?? '').replace(/[\u3000\u00A0]/g, ' ').trim()
}

/**
 * 外部叫法 → 页面列 key 的别名表。
 * BI 组件改过列名、或数据源用的是别的叫法时，在这里统一对齐，
 * 避免去改模板里几十处 row['xxx']。
 *
 * 表头匹配（matchFieldKey）和 BI 拉取（api.ts 的 normalizeBiRows）**共用这一份**。
 */
export const BI_FIELD_ALIAS: Record<string, string> = {
  '库存SKU': 'SKU',
  // ⚠️ BI/Excel 里这一列的表头叫「匹配店铺」，页面列 key 是「店铺」。
  //    漏了这条别名 = 整列被判成"未匹配列"直接丢弃，而它**参与唯一键**：
  //    键里的店铺段恒为空 → 键退化成 4 段 → 实测 8614 行里冒出 184 组冲突、368 行"重复"。
  '匹配店铺': '店铺',
  '供应商是否为络好饰': '供应商',
  /*
   * 「组别 → 团队」「呆滞情况 → 是否属于待评估库存」两次改名后的**兼容别名**。
   *
   * 页面列 key 现在与 BI 的列名保持一致（团队 / 是否属于待评估库存），
   * 这三条只是兜底：数据源或老 Excel 表头还写着旧叫法时能认出来。
   * （「组别→团队」改的是 **BI 数据列**；utils/organazation.ts 那套「团队/组」的
   *  组织表是另一个概念，不在这条链上。）
   *
   * ⚠️ 这两列都**参与唯一键**
   * （SYNC_KEY_FIELDS = SKU + 团队 + 仓位 + 是否属于待评估库存 + 店铺），
   * 漏了别名不是"少一列"那么轻：键里那一段恒为空 → BI 同步算出的键与库里已有的行
   * 100% 对不上 → 每次同步都"新增一整套 + 把库里的行全判成 orphan"，
   * 内容更新（updated）永远是 0，页面上怎么刷新都不动（踩过）。
   * 服务端那份同名表（server/biSync.ts）必须一起改。
   */
  '组别': '团队',
  '呆滞情况': '是否属于待评估库存',
  '是否属于呆滞库存': '是否属于待评估库存',
  // 库龄数量：BI 用「[数量]」，页面用天数区间
  '3个月内[数量]': '3个月内[0-90]',
  '3-6个月内[数量]': '3-6个月内[91-180]',
  '6-9个月内[数量]': '6-9个月内[181-270]',
  '9-12个月内[数量]': '9-12个月内[271-365]',
  '1年以上[数量]': '1年以上[365+]',
  // 库龄金额：BI 不带天数区间，页面带上；且括号全/半角混用（照 BI 原样写）
  '3个月内（金额）': '3个月内[0-90]（金额）',
  '3-6个月内(金额)': '3-6个月内[91-180](金额)',
  '6-9个月内(金额)': '6-9个月内[181-270](金额)',
  '9-12个月内(金额）': '9-12个月内[271-365](金额）',
  '一年以上(金额)': '一年以上[365+](金额)',
  /*
   * 下面几条来自 BI **导出的 Excel**（实测 src/data/test.xlsx，66 列）的表头。
   * 这些列名和上面那些不一样：不是「改过名」，是导出时被加工过
   * （拼后缀、叠口径、落错别字、区间写错），所以只能逐条认。
   *
   * 为什么非认不可：入库是**按 key 写入**的（server/biSync.ts 用 BI_ROW_FIELDS
   * 反查 PB 列名），认不出来的列不会报错，只在页面提示「N 列未匹配」然后整列丢掉 ——
   * 这批列里有 回款 / 毛利润 / 最早开售日期，丢了表上就是一片空白。
   */
  // 销售状态：BI 导出把多值拼成一列（实测取值 "删除,在售"），表头写成「销售状态拼接」
  '销售状态拼接': '销售状态',
  // 最早开售日期-SKU：导出表头在后面叠了「最早时间」（这一列本来就是 SKU 的最早开售日期）
  '最早开售日期-SKU最早时间': '最早开售日期-SKU',
  // 9-12 个月金额：导出把区间写成 [181-365]，页面列 key 是 [271-365]。
  // 同组的**数量**列导出表头仍是 [271-365]（已按原样匹配上），所以这确实是同一列，
  // 不是一条新字段 —— 别照 [181-365] 新增列，否则金额列会劈成两条。
  '9-12个月内[181-365](金额）': '9-12个月内[271-365](金额）',
  // 「父ASIN前三个月毛利润利」末尾多一个「利」，是导出表头的错别字，照收
  '父ASIN前三个月毛利润利': '父ASIN3月前毛利润',
}

/**
 * 汉字数字 → 阿拉伯数字（只到 10，够用：回款 / 毛利润的月份最多到 4）。
 * 用于把导出表头里的「两个月」折算成列 key 里的「2月前」，见 canonicalFieldName。
 */
const CN_NUMBER: Record<string, string> = {
  一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5',
  六: '6', 七: '7', 八: '8', 九: '9', 十: '10',
}

/**
 * 表头的**宽容归一化**：把同一列的其它写法折算成规范形式，再拿去匹配。
 *
 * 为什么要有这一层：BI 导出的 Excel 表头不是列名，而是「列名 + 导出时的加工」。
 * 实测同一列会写成 `SPU近一个月回款` / `SPU前两个月回款` / `父ASIN前两个月回款求和`
 * 这种形态，逐条写别名表能认下来，但下次导出换个说法（近 1 个月、汇总……）又是一批新条目。
 * 这里把三类加工一次性抹掉：
 *
 *   1) **反斜杠转义**：实测表头是 `3个月内[0-90\]（金额）`（BI 导出把 `]` 转义了），
 *      页面列 key 里没有这个 `\`；
 *   2) **聚合后缀**：`3-6个月内[91-180]求和` / `父ASIN前两个月回款求和` 末尾的
 *      求和 / 汇总 / 合计，说的是这一列怎么算出来的（求和），不是列名的一部分；
 *   3) **月份口径**：`近一个月` / `前两个月` → `1月前` / `2月前`。
 *      注意两个叫法都在用，而且混用：「近一个月回款」和「1月前回款」是同一列
 *      （页面列 key 是后者），实测同一份导出里同时存在这两种写法。
 *
 * ⚠️ 只在**直接匹配失败后**才用它（见 matchFieldKey）—— 直接匹配得到的 key 永远优先，
 *    所以这层再怎么改也影响不到已经认得出来的列。
 */
export function canonicalFieldName (name: unknown): string {
  let text = cleanFieldName(name)
  // 1) 反斜杠转义
  text = text.replace(/\\/g, '')
  // 2) 聚合后缀
  text = text.replace(/(求和|汇总|合计)$/, '')
  // 3) 月份口径：近一个月 / 前两个月 / 前 3 个月 → N月前
  text = text.replace(
    /(近|前)\s*([一二两三四五六七八九十]|\d{1,2})\s*个月/g,
    (_, _direction: string, num: string) => `${CN_NUMBER[num] ?? num}月前`,
  )
  return text
}

/**
 * 值归一化：外部数据里的枚举值和页面判断条件不一致时在这里转换。
 * 键是**原始字段名**（也就是 BI / Excel 叫法）。
 */
export const BI_VALUE_MAP: Record<string, Record<string, string>> = {
  是否属于灯具: { 灯具: '是', 非灯具: '否' },
  /**
     * 待评估：统一成 **待评估 / 无需评估** 这两个中文词（值本身就是可读的，不再折算成 0/1）。
     *
     * ⚠️ 这个字段**参与唯一键**（见 biRowFields.ts 的 SYNC_KEY_FIELDS），
     * 所以归一化不是「好看」的问题：数据源里只要写法不一致
     * （0 和「待评估」、「呆滞」和「待评估」混着来），同一行就会被算成两条记录，库里出现重复。
     * 这里把见过的几种叫法全收进来。
     *
     * 新旧对应：**待评估 = 原来的「呆滞」(0)、无需评估 = 原来的「未呆滞」(1)**。
     * 表格直接显示值本身，原来 pages/setDatas.vue 里 0/1 → 文案的显示映射已随之删掉。
     */
  是否属于待评估库存: {
    // 现行口径
    待评估: '待评估', 无需评估: '无需评估',
    // 历史取值与叫法（BI 曾用 0/1，页面列曾叫「是否属于呆滞库存」）
    呆滞: '待评估', 未呆滞: '无需评估', 是: '待评估', 否: '无需评估',
    0: '待评估', 1: '无需评估',
  },
}

/** 全部列 key。用于校验「匹配出来的结果是不是一个真实存在的列」 */
const FIELD_KEY_SET: Set<string> = new Set(PRODUCT_FIELDS.map(f => f.key))

/**
 * 列 title → 列 key。
 *
 * ⚠️ title 和 key **并不总是一样**，实测这些是不一样的：
 *   图片链接/产品图片、供应商/自产\外购、
 *   是否属于灯具/产品类型、3个月内[0-90]/3个月内[数量]……
 * 用户手上的 Excel 表头很可能写的是 title，所以两个都要能认出来。
 */
const TITLE_TO_KEY = new Map(PRODUCT_FIELDS.map(f => [cleanFieldName(f.title), f.key]))

/**
 * 字段名（BI 字段名 / Excel 表头）→ 页面表格列 key。
 *
 * 顺序：别名（原样 → 清洗后）优先，其次**宽容归一化**（canonicalFieldName，
 * 再查一次别名），都没命中才回落到清洗后的原名。
 * 不校验结果是否是已知列 —— 校验见 matchFieldKey。
 */
export function resolveFieldKey (name: unknown): string {
  const original = String(name ?? '')
  const cleaned = cleanFieldName(original)
  const aliased = BI_FIELD_ALIAS[original] ?? BI_FIELD_ALIAS[cleaned]
  if (aliased) {
    return aliased
  }
  const canonical = canonicalFieldName(cleaned)
  return BI_FIELD_ALIAS[canonical] ?? canonical
}

/**
 * 「值里出现某个词就算某一类」的取值归一化 —— 给**没有固定枚举可查**的字段用。
 *
 * 和 BI_VALUE_MAP 的区别：那个是逐值查表（值必须是表里列过的写法），
 * 这个是**按内容判**，用来收那些取值是拼接串、组合数不可穷举的列。
 * 键同样是**原始字段名**（BI / Excel 叫法），查法也一样走「原名 → 解析后的 key」候选。
 */
const BI_VALUE_CONTAINS: Record<string, { keyword: string, hit: string, miss: string }> = {
  /**
   * 销售状态：BI 这列是**多个状态拼在一起的逗号串**（实测 "删除,在售" / "停售,删除"
   * / "不完整,删除,在售" 等，组合数因人而异），没有可枚举的取值表，所以按内容判：
   * **出现「在售」= 在售，其余非空值一律 停售**。
   *
   * ⚠️ 空值必须**保持为空**，不能判成「停售」—— 空格子的含义是「这行没有这个信息」，
   *    折成停售会让整列凭空多出一片停售。
   *
   * 归一化后这一列不再是多值串：页面取色（detail.vue 的 saleStatusOf 按包含判色）
   * 和规则里的 `销售状态 ~ "在售"` 都照旧命中；但原来按「删除 / 不完整」配的条件
   * 会失去意义（那些取值不再出现），这类条件要改写成 停售。
   */
  销售状态: { keyword: '在售', hit: '在售', miss: '停售' },
}

/**
 * 单元格值归一化：按**原始字段名**查枚举表 / 内容规则转换。
 *
 * @param originalName 原始表头 / 字段名（BI_VALUE_MAP / BI_VALUE_CONTAINS 的键是这种叫法）
 * @param raw 原始单元格值
 * @param resolvedKey 该列最终落到哪个 key。传了会**再按 key 补查一次** ——
 *   必要，因为有的字段 title 与 key 不同：Excel 表头写「产品类型」时，
 *   按原始名查 BI_VALUE_MAP 会落空，按 key（'是否属于灯具'）才查得到；
 *   销售状态那类走「包含」判定的规则同理（BI 侧原始列名可能是「销售状态拼接」）。
 */
export function resolveFieldValue (originalName: unknown, raw: unknown, resolvedKey?: string): unknown {
  const candidates = [cleanFieldName(originalName)]
  if (resolvedKey) {
    candidates.push(cleanFieldName(resolvedKey))
  }
  for (const name of candidates) {
    const map = BI_VALUE_MAP[name]
    if (!map) {
      continue
    }
    return map[String(raw)] ?? map[cleanFieldName(raw)] ?? raw
  }
  for (const name of candidates) {
    const rule = BI_VALUE_CONTAINS[name]
    if (!rule) {
      continue
    }
    const text = cleanFieldName(raw)
    // 空值留空：见 BI_VALUE_CONTAINS 的注释
    return text ? (text.includes(rule.keyword) ? rule.hit : rule.miss) : raw
  }
  return raw
}

/**
 * 表头文本 → 列 key，认不出来返回 null（调用方会把它们汇总报给用户）。
 *
 * 四个来源都要覆盖，少一份就会出现「列名看着对、整列却是空」：
 *   1) 列 key 本身（如 'SKU' / '是否属于待评估库存'）；
 *   2) 列 title —— 见 TITLE_TO_KEY 的注释，相当多的字段两者不同；
 *   3) BI / 历史叫法，走 BI_FIELD_ALIAS（如 '库存SKU' → 'SKU'）；
 *   4) **宽容归一化后**再走一遍 1~3（canonicalFieldName：反斜杠 / 求和后缀 / 月份口径）。
 * 前三条是「一看就对得上」的，第 4 条是兜底；任何一条返回的 key 都必须是真实存在的列。
 */
export function matchFieldKey (header: unknown): string | null {
  const text = cleanFieldName(header)
  if (!text) {
    return null
  }
  if (FIELD_KEY_SET.has(text)) {
    return text
  }
  const byTitle = TITLE_TO_KEY.get(text)
  if (byTitle) {
    return byTitle
  }
  // 别名表里逐条列出来的叫法（BI 字段名 / 导出表头）
  const aliased = BI_FIELD_ALIAS[text] ?? BI_FIELD_ALIAS[cleanFieldName(header)]
  if (aliased && FIELD_KEY_SET.has(aliased)) {
    return aliased
  }
  // 最后才折算（反斜杠 / 聚合后缀 / 月份口径），折算结果同样要是一个真实存在的列
  const canonical = canonicalFieldName(text)
  if (canonical !== text) {
    if (FIELD_KEY_SET.has(canonical)) {
      return canonical
    }
    const canonicalTitle = TITLE_TO_KEY.get(canonical)
    if (canonicalTitle) {
      return canonicalTitle
    }
    const canonicalAlias = BI_FIELD_ALIAS[canonical]
    if (canonicalAlias && FIELD_KEY_SET.has(canonicalAlias)) {
      return canonicalAlias
    }
  }
  return null
}
