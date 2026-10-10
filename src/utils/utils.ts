import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import relativeTime from 'dayjs/plugin/relativeTime'
import { flowToChain } from '@/types/approval'
import { createApprocalModel, getApprovalFirstByFilter } from '@/utils/collection'
// 建单期展开（数据查询 / 组间轮询）：与 pages/workStream 同一口径
import { expandFlowForOrder } from '@/utils/expandFlowForOrder'

/*
 * ⚠️ 本文件里**不要**再静态 import 重型库。
 *
 * home / mine / setDatas / workStream / approvalPage / logic … 都要从这里取
 * formatDate / formatTimeDiff，所以本文件被**每个页面**静态依赖 ——
 * 顶部静态 import 什么，所有页面就在渲染前一起付这笔下载与解析成本。
 * 曾经因此进过 6.3MB 的公共 chunk：xlsx（875KB，只在导出用）与
 * pinyin（入口文件 7.2MB，只在算姓名首字母时用）。
 * 两者现在都是动态 import：xlsx 见 exportExcel，pinyin 见 utils/pinyin.ts。
 */

import 'dayjs/locale/zh-cn'

dayjs.extend(relativeTime)
dayjs.extend(duration)
// 设置为中文
dayjs.locale('zh-cn')

/**
 * 导出表里的一列。**顺序、标题、列宽全部由调用方按"当前表格"给出**
 * （见 pages/workStream 与 pages/setDatas 的 exportColumns）。
 */
export interface ExportColumn {
  /** 表头文字：必须与页面上那一列的标题一致 */
  title: string
  /** 取哪一列的值（行对象里的键，通常是中文列名） */
  key?: string
  /** 自定义取值（计算列，如「任务状态」）：给了它就不看 key */
  value?: (row: Record<string, unknown>) => unknown
  /** 列宽（px，与页面上那一列同口径）；不传用默认宽度 */
  width?: number
}

/**
 * 导出表格数据。
 *
 * ## 表头必须由调用方按当前表格给出
 *
 * 原来用 `json_to_sheet(rows)`：它拿**第一行对象的键顺序**当表头，而那是 PB 记录的
 * 原始字段顺序（id / created / updated / data / 中文列名…），与用户在页面上看到的
 * 列顺序、显隐、标题完全对不上 —— 导出来的表头是乱的，还得手工删列、挪列。
 * 现在手写「表头行 + 数据行」：
 *   · 列顺序 / 标题 = 传入的 columns（页面怎么显示就怎么导）；
 *   · 列宽 = columns 里的 width（px → Excel 字符宽）；
 *   · 取不到值填空串，绝不写 undefined（否则 Excel 里会冒出 "undefined" 这几个字）。
 *
 * ⚠️ xlsx **社区版不能写单元格样式**（表头加粗/底色、冻结首行都是 Pro 功能），
 * 所以这里只对齐"列"本身：顺序、标题、宽度。要真样式得换导出实现，别在这里试 `s` 属性。
 *
 * xlsx 改成**动态** import：它 875KB，而只在点「导出」时才需要（见文件顶部的说明）。
 */
export async function exportExcel (
  rows: Array<Record<string, unknown>>,
  fileName: string,
  columns: ExportColumn[],
): Promise<void> {
  const XLSX = await import('xlsx')
  const aoa: unknown[][] = [
    columns.map(c => c.title),
    ...rows.map(row => columns.map(c => cellValue(row, c))),
  ]
  const worksheet = XLSX.utils.aoa_to_sheet(aoa)
  worksheet['!cols'] = columns.map(c => ({ wch: excelWidth(c.width) }))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, fileName)
  XLSX.writeFile(workbook, `${fileName}.xlsx`)
}

/** 一格的取值：计算列优先，其次按键取；空值统一成空串（见 exportExcel 的说明） */
function cellValue (row: Record<string, unknown>, col: ExportColumn): unknown {
  let v: unknown = ''
  if (col.value) {
    v = col.value(row)
  } else if (col.key) {
    v = row[col.key]
  }
  return v === null || v === undefined ? '' : v
}

/** px（页面上的列宽）→ Excel 字符宽：约 7px 一个字符；下限保证不挤成一条缝 */
function excelWidth (px?: number): number {
  return typeof px === 'number' && px > 0 ? Math.max(8, Math.round(px / 7)) : 12
}

export function formatDate (date?: string | null) {
  if (!date) {
    return ''
  }
  const d = dayjs(date)
  // 无效时间（如脏数据）会返回 "Invalid Date"，统一兜底为空串
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm:ss') : ''
}

export function createChain (data: any[], key: string) {
  const chain: any[] = []
  for (const item of data) {
    if (item[key] !== null) {
      chain.push(item)
    }
  }
  return chain
}

/**
 * 相对时间（如"3 分钟前"）。
 * 注意：dayjs(undefined) 会被当作"当前时间"，从而算出"几秒前"，
 * 因此数据未加载时必须先兜底返回空串，否则页面会显示错误耗时。
 */
// export function formatTimeDiff(time?: string | null) {
//     if (!time) return ''
//     const targetTime = dayjs(time)
//     return targetTime.isValid() ? targetTime.fromNow() : ''
// }
/** 计算时间差文案。end 省略（或为空）时以「当下」为终点。
 *  end 放宽为 string / number / Date —— dayjs 都能解析，便于传入某个环节的办理时间。 */
export function formatTimeDiff (time?: string | null, end?: string | number | Date | null) {
  const startTime = dayjs(time)
  const endTime = end ? dayjs(end) : dayjs()

  // 计算差值（毫秒）
  const diffMs = endTime.diff(startTime)

  // 用 duration 封装差值
  const dur = dayjs.duration(diffMs)

  // 提取各个单位
  const hours = Math.floor(dur.asHours())
  const minutes = dur.minutes()
  const seconds = dur.seconds()

  // 组装显示字符串（只显示有意义的单位）
  const parts = []
  if (hours > 0) {
    parts.push(`${hours}小时`)
  }
  if (minutes > 0) {
    parts.push(`${minutes}分钟`)
  }
  if (hours == 0 && minutes == 0 && seconds > 0) {
    parts.push(`${seconds}秒`)
  }

  return parts.join('') || '0秒'
}

/**
 * 数字的展示格式化。
 * 实现刻意放在零依赖的 ./number 里（utils.ts 会连带拉进 pocketbase.ts，
 * 在浏览器外无法加载，不利于单测），这里只做统一出口。
 */
export { formatDatas, formatNumber, parseFormattedNumber, shareValueText } from './number'

/*
 * getPinyinInitials 已移到 utils/pinyin.ts，并改成**动态**加载：
 * pinyin 的入口文件 7.2MB，不能挂在每个页面的关键路径上。
 * 那边导出的是 ensurePinyin() + pinyinInitials()，唯一调用方见 components/ApprovalNode.vue。
 */

export async function generateApprovalChain () {
  const res = await getApprovalFirstByFilter(`name="测试模板"`)
  console.log(res)
  // flow 是唯一事实源：模板没配流程就不建单，避免生成结构不完整的审批单
  const flow = res?.chain?.flow
  if (!flow?.length) {
    console.error('未找到「前置模板」或该模板未配置审批流程')
    return undefined
  }
  /*
   * 建单期展开（数据查询 → 组间轮询）：与 pages/workStream 的真实建单路径同一口径，
   * 见 utils/expandFlowForOrder。测试单没有业务行数据，ctx 传空 ——
   * 配了 `{:列名}` 占位符的查询会明确报错，这正是要的：宁可这里失败，
   * 也别建出一张"办到那一环就报单据数据不完整"的单。
   */
  const expanded = await expandFlowForOrder(flow, {})
  if (expanded.issues.length > 0) {
    console.error('测试建单失败：流程展开不了 ——', expanded.issues.join('；'))
    return undefined
  }
  // chain 由 flow 派生（建单时为主线快照），后续由 rebuildChain 按实际结论重算；
  // flow / graph 作为模板只读保存，decisions 为办理流水，建单时为空
  const res2 = await createApprocalModel({
    chain: flowToChain(expanded.flow),
    flow: expanded.flow,
    graph: res?.chain?.graph,
    decisions: [],
  })
  console.log(res2)
  return res2
}
