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
    only:string
    /** 内容宽度（不含单元格内边距）。表格用它做 minWidth，表格因此可横向滚动 */
    width:number
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
    { title: '产品图片', key: '图片链接', sortable: false, visualable: false,only:'all',width:50, fixed: true },
    // 2.产品信息
    { title: 'SKU', key: 'SKU', sortable: false, visualable: false,only:'all',width:100 },
    { title: 'SPU', key: 'SPU', sortable: false, visualable: false,only:'all',width:84  },
    { title: '主MODEL', key: '主MODEL', sortable: false, visualable: false,only:'all',width:72  },
    { title: '产品名称', key: '产品名称', sortable: false, visualable: false,only:'all',width:200  },
    { title: '季节性产品标签', key: '季节性产品标签', sortable: false, visualable: false,only:'amazon tk',width:60  },
    // 3.开售时间
    { title: '最早开售日期-SKU', key: '最早开售日期-SKU', sortable: true, visualable: true,only:'amazon tk',width:96  },
    { title: '拓业部最早时间-SPU', key: '拓业部最早时间-SPU', sortable: true, visualable: true,only:'expand',width:108  },
    // 4.组织信息类
    { title: '自产/外购', key: '供应商', sortable: false, visualable: false,only:'all',width:60  },
    { title: '组长', key: '组长', sortable: false, visualable: false,only:'all',width:60  },
    { title: '组别', key: '组别', sortable: false, visualable: false,only:'all',width:60  },
    { title: '部门', key: '部门', sortable: false, visualable: false,only:'all',width:60  },
    // 5.平台
    { title: '仓位', key: '仓位', sortable: false, visualable: false,only:'all',width:60  },
    { title: '店铺', key: '店铺', sortable: false, visualable: false,only:'amazon,tk',width:60  },
    { title: '平台', key: '平台', sortable: false, visualable: false,only:'all',width:60  },
    // 6.呆滞
    { title: '亚马逊呆滞条件', key: '亚马逊呆滞条件', sortable: false, visualable: false,only:'amazon,tk',width:220  },
    { title: '拓业部呆滞条件', key: '拓业部呆滞条件', sortable: false, visualable: false,only:'expand',width:220  },
    { title: '呆滞情况', key: '是否属于呆滞库存', sortable: false, visualable: false,only:'all',width:96  },
    { title: '销售状态', key: '销售状态', sortable: false, visualable: false,only:'amazon,tk',width:60  },
    // 7.品类
    { title: '一级品类', key: '一级品类', sortable: true, visualable: true,only:'all',width:72  },
    { title: '二级品类', key: '二级品类', sortable: true, visualable: true,only:'all',width:60  },
    { title: '产品类型', key: '是否属于灯具', sortable: false, visualable: false,only:'all',width:72  },
    // 8.库存数量
    { title: '采购中', key: '采购中', sortable: false, visualable: false,only:'all',width:60  },
    { title: 'FBA在仓', key: 'FBA在仓', sortable: false, visualable: false,only:'all',width:60  },
    { title: 'FBA在途', key: 'FBA在途', sortable: false, visualable: false,only:'all',width:60  },
    { title: '本地仓', key: '本地仓', sortable: false, visualable: false,only:'all',width:60  },
    { title: '海外仓在仓', key: '海外仓在仓', sortable: false, visualable: false,only:'all',width:60  },
    { title: '海外仓在途', key: '海外仓在途', sortable: false, visualable: false,only:'all',width:60  },
    // 9.总库存
    { title: '总库存数量', key: '总库存数量', sortable: true, visualable: true,only:'all',width:60  },
    { title: '总库存金额', key: '总库存金额', sortable: true, visualable: true,only:'all',width:60  },
    { title: '未入仓', key: '未入仓', sortable: false, visualable: false,only:'all',width:60  },
    // 10.库龄数量
    { title: '3个月内[数量]', key: '3个月内[0-90]', sortable: true, visualable: true,only:'all',width:102  },
    { title: '3-6个月内[数量]', key: '3-6个月内[91-180]', sortable: true, visualable: true,only:'all',width:78  },
    { title: '6-9个月内[数量]', key: '6-9个月内[181-270]', sortable: true, visualable: true,only:'all',width:108  },
    { title: '9-12个月内[数量]', key: '9-12个月内[271-365]', sortable: true, visualable: true,only:'all',width:114  },
    { title: '1年以上[数量]', key: '1年以上[365+]', sortable: true, visualable: true,only:'all',width:78  },
    // 11.库龄金额类
    { title: '3个月内（金额）', key: '3个月内[0-90]（金额）', sortable: true, visualable: true,only:'all',width:126  },
    { title: '3-6个月内(金额)', key: '3-6个月内[91-180](金额)', sortable: true, visualable: true,only:'all',width:138  },
    { title: '6-9个月内(金额)', key: '6-9个月内[181-270](金额)', sortable: true, visualable: true,only:'all',width:144  },
    { title: '9-12个月内(金额）', key: '9-12个月内[271-365](金额）', sortable: true, visualable: true,only:'all',width:156  },
    { title: '一年以上(金额)', key: '一年以上[365+](金额)', sortable: true, visualable: true,only:'all',width:120  },
    // 12.SKU回款
    { title: 'SKU1月前回款', key: 'SKU1月前回款', sortable: true, visualable: true,only:'amazon,tk',width:114  },
    { title: 'SKU2月前回款', key: 'SKU2月前回款', sortable: true, visualable: true,only:'amazon,tk',width:114  },
    { title: 'SKU3月前回款', key: 'SKU3月前回款', sortable: true, visualable: true,only:'amazon,tk',width:114  },
    { title: 'SKU上年回款', key: 'SKU上年回款', sortable: true, visualable: true,only:'amazon,tk',width:114  },
    // 13.SKU毛利润
    { title: 'SKU1月前毛利润', key: 'SKU1月前毛利润', sortable: true, visualable: true,only:'amazon,tk',width:114  },
    { title: 'SKU2月前毛利润', key: 'SKU2月前毛利润', sortable: true, visualable: true,only:'amazon,tk',width:114  },
    { title: 'SKU3月前毛利润', key: 'SKU3月前毛利润', sortable: true, visualable: true,only:'amazon,tk',width:114  },
    // 14.父ASIN回款
    { title: '父ASIN1月前回款', key: '父ASIN1月前回款', sortable: true, visualable: true,only:'amazon,tk',width:108 },
    { title: '父ASIN2月前回款', key: '父ASIN2月前回款', sortable: true, visualable: true,only:'amazon,tk',width:114 },
    { title: '父ASIN3月前回款', key: '父ASIN3月前回款', sortable: true, visualable: true,only:'amazon,tk',width:108  },
    { title: '父ASIN上一年回款', key: '父ASIN上一年回款', sortable: true, visualable: true,only:'amazon,tk',width:108 },
    // 15.父ASIN毛利润
    { title: '父ASIN1月前毛利润', key: '父ASIN1月前毛利润', sortable: true, visualable: true,only:'amazon,tk',width:114 },
    { title: '父ASIN2月前毛利润', key: '父ASIN2月前毛利润', sortable: true, visualable: true,only:'amazon,tk',width:114  },
    { title: '父ASIN3月前毛利润', key: '父ASIN3月前毛利润', sortable: true, visualable: true,only:'amazon,tk',width:114  },
    // 16.SPU回款
    { title: 'SPU1月前回款', key: 'SPU1月前回款', sortable: true, visualable: true,only:'expand',width:114  },
    { title: 'SPU2月前回款', key: 'SPU2月前回款', sortable: true, visualable: true ,only:'expand',width:114 },
    { title: 'SPU3月前回款', key: 'SPU3月前回款', sortable: true, visualable: true ,only:'expand',width:114 },
    { title: 'SPU4月前回款', key: 'SPU4月前回款', sortable: true, visualable: true ,only:'expand',width:114 },
    // 17.SPU毛利润
    { title: 'SPU1月前毛利润', key: 'SPU1月前毛利润', sortable: true, visualable: true ,only:'expand',width:114 },
    { title: 'SPU2月前毛利润', key: 'SPU2月前毛利润', sortable: true, visualable: true ,only:'expand',width:114 },
    { title: 'SPU3月前毛利润', key: 'SPU3月前毛利润', sortable: true, visualable: true ,only:'expand',width:114 },
    { title: 'SPU4月前毛利润', key: 'SPU4月前毛利润', sortable: true, visualable: true,only:'expand',width:114  },
    // 18.销量
    { title: 'SKU近一年月平均销量', key: 'SKU近一年月平均销量', sortable: true, visualable: true ,only:'all',width:114 },
    { title: 'SPU近一年月平均销量', key: 'SPU近一年月平均销量', sortable: true, visualable: true,only:'expand',width:114  },
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
export function cleanFieldName(name: unknown): string {
    return String(name ?? '').replace(/[\u3000\u00a0]/g, ' ').trim()
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
    '供应商是否为络好饰': '供应商',
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
}

/**
 * 值归一化：外部数据里的枚举值和页面判断条件不一致时在这里转换。
 * 键是**原始字段名**（也就是 BI / Excel 叫法）。
 */
export const BI_VALUE_MAP: Record<string, Record<string, string>> = {
    '是否属于灯具': { '灯具': '是', '非灯具': '否' },
    /**
     * 呆滞：统一成 **0 = 呆滞 / 1 = 未呆滞**。
     *
     * ⚠️ 这个字段**参与唯一键**（见 biRowFields.ts 的 SYNC_KEY_FIELDS），
     * 所以归一化不是「好看」的问题：数据源里只要写法不一致
     * （「是」和「呆滞」、「0」和「否」混着来），同一行就会被算成两条记录，库里出现重复。
     * 这里把见过的几种叫法全收进来，统一落到 '0' / '1'。
     *
     * 表格里的显示映射在 pages/setDatas.vue（0 → 呆滞 / 1 → 未呆滞）。
     */
    '是否属于呆滞库存': { '呆滞': '0', '未呆滞': '1', '是': '0', '否': '1', '0': '0', '1': '1' },
}

/** 全部列 key。用于校验「匹配出来的结果是不是一个真实存在的列」 */
const FIELD_KEY_SET: Set<string> = new Set(PRODUCT_FIELDS.map(f => f.key))

/**
 * 列 title → 列 key。
 *
 * ⚠️ title 和 key **并不总是一样**，实测这些是不一样的：
 *   图片链接/产品图片、供应商/自产\外购、是否属于呆滞库存/呆滞情况、
 *   是否属于灯具/产品类型、3个月内[0-90]/3个月内[数量]……
 * 用户手上的 Excel 表头很可能写的是 title，所以两个都要能认出来。
 */
const TITLE_TO_KEY = new Map(PRODUCT_FIELDS.map(f => [cleanFieldName(f.title), f.key]))

/**
 * 字段名（BI 字段名 / Excel 表头）→ 页面表格列 key。
 * 别名优先，其次清洗后的原名。**不校验结果是否是已知列** —— 校验见 matchFieldKey。
 */
export function resolveFieldKey(name: unknown): string {
    const original = String(name ?? '')
    return BI_FIELD_ALIAS[original] ?? BI_FIELD_ALIAS[cleanFieldName(original)] ?? cleanFieldName(original)
}

/**
 * 单元格值归一化：按**原始字段名**查枚举表转换。
 *
 * @param originalName 原始表头 / 字段名（BI_VALUE_MAP 的键是这种叫法）
 * @param raw 原始单元格值
 * @param resolvedKey 该列最终落到哪个 key。传了会**再按 key 补查一次** ——
 *   必要，因为有的字段 title 与 key 不同：Excel 表头写「产品类型」时，
 *   按原始名查 BI_VALUE_MAP 会落空，按 key（'是否属于灯具'）才查得到。
 */
export function resolveFieldValue(originalName: unknown, raw: unknown, resolvedKey?: string): unknown {
    const candidates = [cleanFieldName(originalName)]
    if (resolvedKey) candidates.push(cleanFieldName(resolvedKey))
    for (const name of candidates) {
        const map = BI_VALUE_MAP[name]
        if (!map) continue
        return map[String(raw)] ?? map[cleanFieldName(raw)] ?? raw
    }
    return raw
}

/**
 * 表头文本 → 列 key，认不出来返回 null（调用方会把它们汇总报给用户）。
 *
 * 三个来源都要覆盖，少一份就会出现「列名看着对、整列却是空」：
 *   1) 列 key 本身（如 'SKU' / '是否属于呆滞库存'）；
 *   2) 列 title —— 见 TITLE_TO_KEY 的注释，相当多的字段两者不同；
 *   3) BI / 历史叫法，走 BI_FIELD_ALIAS（如 '库存SKU' → 'SKU'）。
 */
export function matchFieldKey(header: unknown): string | null {
    const text = cleanFieldName(header)
    if (!text) return null
    if (FIELD_KEY_SET.has(text)) return text
    const byTitle = TITLE_TO_KEY.get(text)
    if (byTitle) return byTitle
    const aliased = resolveFieldKey(header)
    return FIELD_KEY_SET.has(aliased) ? aliased : null
}
