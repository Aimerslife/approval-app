import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import relativeTime from 'dayjs/plugin/relativeTime'
import { flowToChain } from '@/types/approval'
import { createApprocalModel, getApprovalFirstByFilter } from '@/utils/collection'

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
 * 导出表格数据。
 * xlsx 改成**动态** import：它 875KB，而只在点「导出」时才需要（见文件顶部的说明）。
 */
export async function exportExcel (data: any[], fileName: string) {
  const XLSX = await import('xlsx')
  const worksheet = XLSX.utils.json_to_sheet(data)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, fileName)
  XLSX.writeFile(workbook, `${fileName}.xlsx`)
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
export { formatDatas, formatNumber, parseFormattedNumber } from './number'

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
  // chain 由 flow 派生（建单时为主线快照），后续由 rebuildChain 按实际结论重算；
  // flow / graph 作为模板只读保存，decisions 为办理流水，建单时为空
  const res2 = await createApprocalModel({
    chain: flowToChain(flow),
    flow,
    graph: res?.chain?.graph,
    decisions: [],
  })
  console.log(res2)
  return res2
}
