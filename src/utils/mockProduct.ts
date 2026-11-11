/**
 * mockProduct.ts
 *
 * 产品信息 mock 数据：字段定义（headers）、分组定义、数据生成器。
 * 供审批页等场景以 headers 的 key 展示一条产品信息。
 */

import { PRODUCT_FIELDS } from './productFields'

export interface ProductHeader {
  title: string
  key: string
  sortable?: boolean
}

/**
 * 产品字段定义。
 * 以前这里维护了一份独立副本，和 detail.vue / userSetting.vue 的两份并列，
 * 改字段要同步三处、迟早漏改。现在统一从 productFields.ts 派生。
 */
export const PRODUCT_HEADERS: ProductHeader[] = PRODUCT_FIELDS.map(({ title, key, sortable }) => ({
  title,
  key,
  sortable,
}))

/** 卡片内的一个小节：同组字段再按单位分行（如账龄分布的「数量 / 金额」） */
export interface ProductGroupSection {
  /** 卡片上的行标题 */
  label: string
  keys: string[]
}

export interface ProductGroup {
  label: string
  icon: string
  /**
   * 组内**全部**字段。设置面板、整组拖拽都按它平铺；
   * 有 `sections` 时必须等于各小节 keys 的并集（缺了会出现「设置里没有、卡片上有」）。
   */
  keys: string[]
  /** 卡片内再分行显示：同一批区间只差单位时用，否则挤成一片分不清哪格是数量哪格是金额 */
  sections?: ProductGroupSection[]
  /**
   * 右侧**独立块**的字段（如 SKU 组的近一年月平均销量 / 毛利率）：汇总类指标，
   * 业务要求与逐月明细视觉分开 —— 卡片上切成左右两块，主体在左、这些在右；
   * 设置面板与整组拖拽仍把 keys + asideKeys 当作一组平铺。
   */
  asideKeys?: string[]
}

/**
 * 账龄分布的分行口径。
 *
 * 数量与金额是**同一批库龄区间**（原来分成「账龄分布（数量）」「账龄分布（金额）」两张卡），
 * 分两张卡时读一个区间要上下对照，所以合成一张卡、卡内用「数量 / 金额」两行分开：
 * 两个单位一混排，字面上只差个括号，读者很容易把金额当成件数。
 */
const AGING_SECTIONS: ProductGroupSection[] = [
  {
    label: '数量',
    keys: ['3个月内[0-90]', '3-6个月内[91-180]', '6-9个月内[181-270]', '9-12个月内[271-365]', '1年以上[365+]'],
  },
  {
    label: '金额',
    keys: ['3个月内[0-90]（金额）', '3-6个月内[91-180](金额)', '6-9个月内[181-270](金额)', '9-12个月内[271-365](金额）', '一年以上[365+](金额)'],
  },
]

// 产品字段分组（key 与 PRODUCT_HEADERS 完全一致），用于卡片分组排版
export const PRODUCT_GROUPS: ProductGroup[] = [
  {
    label: '基本信息',
    icon: 'mdi-tag-outline',
    keys: ['主MODEL', '最早开售日期-SKU', '拓业部最早时间-SPU'],
  },
  {
    label: '组织与属性',
    icon: 'mdi-domain',
    keys: ['供应商', '店铺', '组长', '仓位', '团队', '部门', '平台', '一级品类', '二级品类'],
  },
  {
    label: '呆滞 / 待评估',
    icon: 'mdi-alert-circle-outline',
    keys: ['亚马逊呆滞条件', '拓业部呆滞条件', '是否属于待评估库存'],
  },
  {
    label: '库存（数量 / 金额）',
    icon: 'mdi-warehouse',
    keys: ['采购中', 'FBA在仓', 'FBA在途', '本地仓', '海外仓在仓', '海外仓在途', '未入仓', '总库存数量', '总库存金额',
      // 派生指标：由「海外仓在仓 × 单价(暂定60)」算出，BI 里没有这一列（见 biRowFields.deriveFlowFields）
      '海外仓库存金额'],
  },
  {
    label: '账龄分布',
    icon: 'mdi-chart-timeline-variant',
    sections: AGING_SECTIONS,
    // 数量 + 金额并集：设置面板 / 整组拖拽按 keys 平铺，别漏掉金额那一半
    keys: AGING_SECTIONS.flatMap(s => s.keys),
  },
  {
    label: 'SKU 回款 / 毛利',
    icon: 'mdi-currency-usd',
    /*
     * 左块固定两行（回款一行、毛利一行）：右块收窄成内容自适应宽后，
     * 主体变宽，flex-wrap 的随机换行（可能 3+2+2）不如按类目分行整齐。
     * label 留空 → 行首不出标题（字段名本身已带「回款 / 毛利润」字样，再写一遍是冗余）。
     */
    sections: [
      { label: '', keys: ['SKU1月前回款', 'SKU2月前回款', 'SKU3月前回款', 'SKU上年回款'] },
      { label: '', keys: ['SKU1月前毛利润', 'SKU2月前毛利润', 'SKU3月前毛利润'] },
    ],
    keys: ['SKU1月前回款', 'SKU2月前回款', 'SKU3月前回款', 'SKU上年回款', 'SKU1月前毛利润', 'SKU2月前毛利润', 'SKU3月前毛利润'],
    // 汇总指标独立在右侧（见 ProductGroup.asideKeys）
    asideKeys: ['SKU近一年月平均销量',
      // 派生指标：SKU3月前毛利润 / SKU3月前回款 × 100（见 biRowFields.deriveFlowFields）
      '毛利率(SKU3月前)'],
  },
  {
    label: '父ASIN 回款 / 毛利',
    icon: 'mdi-cash-clock',
    keys: ['父ASIN1月前回款', '父ASIN2月前回款', '父ASIN3月前回款', '父ASIN上一年回款', '父ASIN1月前毛利润', '父ASIN2月前毛利润', '父ASIN3月前毛利润'],
  },
  {
    label: 'SPU 回款 / 毛利',
    icon: 'mdi-chart-line',
    keys: ['SPU1月前回款', 'SPU2月前回款', 'SPU3月前回款', 'SPU4月前回款', 'SPU1月前毛利润', 'SPU2月前毛利润', 'SPU3月前毛利润', 'SPU4月前毛利润', 'SPU近一年月平均销量'],
  },
]

/** 基于 PRODUCT_HEADERS 动态生成模拟产品数据 */
export function generateMockData (count = 1): Record<string, unknown>[] {
  const products = ['LED台灯', '智能灯泡', '落地灯', '壁灯', '床头灯', '吸顶灯', '感应灯带', '筒灯']
  const suppliers = ['深圳华强照明', '东莞晶科电子', '中山古镇灯饰', '佛山雷克照明', '惠州亿光实业']
  const stores = ['亚马逊美国站', '亚马逊德国站', '亚马逊日本站', '亚马逊英国站', '亚马逊加拿大站']
  const leaders = ['张伟', '李娜', '王强', '赵敏', '刘洋']
  const departments = ['拓业一部', '拓业二部', '拓业三部', '综合部']
  const platforms = ['Amazon', 'eBay', 'Walmart']
  const c1 = ['灯具', '家居', '电子', '装饰']
  const c2 = ['LED照明', '装饰灯具', '智能家居', '电工电气']
  const salesStatus = ['在售', '停售', '清仓', '新品']
  const rand = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min
  const money = (min = 100, max = 200_000) => Math.round((Math.random() * (max - min) + min) * 100) / 100
  const date = (y: number, m: number, d: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const rows: Record<string, unknown>[] = []
  for (let i = 1; i <= count; i++) {
    const row: Record<string, unknown> = {}
    for (const h of PRODUCT_HEADERS) {
      const key = h.key
      switch (key) {
        case 'SKU': { row[key] = `SKU-${String(1000 + i).padStart(4, '0')}`; break
        }
        case '图片链接': { row[key] = `https://picsum.photos/seed/sku${i}/120/120`; break
        }
        case 'SPU': { row[key] = `SPU${20_000 + i}`; break
        }
        case '主MODEL': { row[key] = `MDL-${String.fromCharCode(65 + (i % 3))}${i}`; break
        }
        case '产品名称': { row[key] = products[i % products.length]; break
        }
        case '最早开售日期-SKU': { row[key] = date(2023, (i % 12) + 1, (i % 28) + 1); break
        }
        case '拓业部最早时间-SPU': { row[key] = date(2022, (i % 12) + 1, (i % 28) + 1); break
        }
        case '供应商': { row[key] = suppliers[i % suppliers.length]; break
        }
        case '店铺': { row[key] = stores[i % stores.length]; break
        }
        case '组长': { row[key] = leaders[i % leaders.length]; break
        }
        case '仓位': { row[key] = `${String.fromCharCode(65 + (i % 10))}-${String((i % 20) + 1).padStart(2, '0')}`; break
        }
        case '团队': { row[key] = `组${(i % 4) + 1}`; break
        }
        case '部门': { row[key] = departments[i % departments.length]; break
        }
        case '平台': { row[key] = platforms[i % platforms.length]; break
        }
        case '亚马逊呆滞条件': { row[key] = '回款金额 < 1000 且 库龄 > 90天'; break
        }
        case '拓业部呆滞条件': { row[key] = '月均销量 < 5 且 库龄 > 180天'; break
        }
        // 与 BI 真实取值对齐：只有「待评估」/空，没有「是」「否」（实测 500 行中 469 空 + 30 待评估）
        case '是否属于待评估库存': { row[key] = i % 3 === 0 ? '待评估' : ''; break
        }
        case '一级品类': { row[key] = c1[i % c1.length]; break
        }
        case '二级品类': { row[key] = c2[i % c2.length]; break
        }
        case '是否属于灯具': { row[key] = i % 4 === 0 ? '非灯具' : '灯具'; break
        }
        case '销售状态': { row[key] = salesStatus[i % salesStatus.length]; break
        }
        case '采购中': { row[key] = rand(0, 500); break
        }
        case 'FBA在仓': { row[key] = rand(0, 2000); break
        }
        case 'FBA在途': { row[key] = rand(0, 800); break
        }
        case '本地仓': { row[key] = rand(0, 1000); break
        }
        case '海外仓在仓': { row[key] = rand(0, 1500); break
        }
        case '海外仓在途': { row[key] = rand(0, 600); break
        }
        case '未入仓': { row[key] = rand(0, 300); break
        }
        case '总库存数量': { row[key] = rand(100, 5000); break
        }
        default: { break
        }
      }
      if (row[key] === undefined) {
        if (/金额|毛利润|利润|回款/.test(key)) {
          row[key] = money()
        } else if (/\d/.test(key) && /[月年内]|销量|库存/.test(key)) {
          row[key] = rand(0, 1000)
        } else {
          row[key] = ''
        }
      }
    }
    rows.push(row)
  }
  return rows
}
