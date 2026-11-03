<template>
  <!--
    审批结束后的「审批信息表」：放在时间线上方（审批页左栏 / 详情抽屉的顶部）。

    为什么是表格而不是时间线：时间线回答"怎么走到这一步"，归档要的是
    「谁发起、多久办完、各团队接了多少、剩多少、最后结论」—— 一页看得完。
    表里的每个数都与页面其它地方**同源**（见 utils/approvalSummary 的说明），
    导出 PDF 时用的也是这份数据渲染出来的 DOM，不存在"导出的和看到的不一样"。
  -->
  <div v-if="summary" class="approval-summary">
    <div class="summary-bar d-flex align-center ga-2">
      <v-icon color="success" size="16">mdi-check-decagram-outline</v-icon>
      <span class="text-[13px] font-bold">审批信息</span>
      <v-chip label size="x-small" variant="tonal">{{ summary.statusText }}</v-chip>
      <v-spacer />
      <v-btn
        :loading="exporting"
        prepend-icon="mdi-file-export-outline"
        size="x-small"
        variant="tonal"
        @click="exportPdf"
      >
        <span class="mb-1">导出 PDF</span>
      </v-btn>
    </div>

    <!--
      纸张外面套一层横向滚动：右栏抽屉只有三四百 px，8 列的审批过程表一定放不下 ——
      宁可横向滚，也不能把列压成一条缝（导出时按 A4 宽度重排，见 exportPdf）。
    -->
    <div class="paper-scroll">
    <div ref="paperRef" class="paper">
      <div class="paper-head">
        <div class="paper-title">审批信息</div>
        <div class="paper-sub">单号 {{ summary.orderNo }}</div>
      </div>

      <div class="paper-section">一、审批信息</div>
      <table class="kv-table">
        <tbody>
          <tr v-for="(pair, i) in infoPairs" :key="`info-${i}`">
            <th>{{ pair[0].label }}</th>
            <td>{{ pair[0].value }}</td>
            <th>{{ pair[1]?.label ?? '' }}</th>
            <td>{{ pair[1]?.value ?? '' }}</td>
          </tr>
        </tbody>
      </table>

      <div class="paper-section">二、审批过程</div>
      <table class="grid-table">
        <thead>
          <tr>
            <th class="col-index">#</th>
            <th class="col-approver">审批人</th>
            <th class="col-result">结论</th>
            <th class="col-qty">接收数量</th>
            <th class="col-amount">接收金额</th>
            <th class="col-opinion">意见</th>
            <th class="col-at">办理时间</th>
            <th class="col-duration">耗时</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in summary.steps" :key="`step-${s.index}`">
            <td class="col-index">{{ s.index }}</td>
            <td>
              <div class="cell-main">{{ s.approver }}</div>
              <div class="cell-sub">{{ s.department }}</div>
            </td>
            <td>{{ s.result }}</td>
            <td class="num">{{ s.qty }}</td>
            <td class="num">{{ s.amount }}</td>
            <td class="cell-opinion">{{ s.opinion }}</td>
            <td>{{ s.at }}</td>
            <td>{{ s.duration }}</td>
          </tr>
          <tr v-if="summary.steps.length === 0">
            <td class="empty" colspan="8">没有已办环节</td>
          </tr>
        </tbody>
      </table>

      <div class="paper-section">三、接收情况</div>
      <table class="grid-table">
        <thead>
          <tr>
            <th>团队 / 项目</th>
            <th class="col-qty">数量</th>
            <th class="col-amount">金额</th>
            <th>说明</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in summary.receipts" :key="`receipt-${i}`" :class="{ 'row-strong': i >= summary.receipts.length - 2 }">
            <td>{{ r.name }}</td>
            <td class="num">{{ r.qty }}</td>
            <td class="num">{{ r.amount }}</td>
            <td class="cell-opinion">{{ r.note }}</td>
          </tr>
        </tbody>
      </table>

      <div class="paper-section">四、审批结论</div>
      <table class="kv-table">
        <tbody>
          <tr v-for="(pair, i) in conclusionPairs" :key="`conclusion-${i}`">
            <th>{{ pair[0].label }}</th>
            <td>{{ pair[0].value }}</td>
            <th>{{ pair[1]?.label ?? '' }}</th>
            <td>{{ pair[1]?.value ?? '' }}</td>
          </tr>
        </tbody>
      </table>

      <div class="paper-foot">导出时间：{{ exportedAt }}</div>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ApprovalOrder } from '@/types/approval'
import type { SummaryField } from '@/utils/approvalSummary'
import { buildApprovalSummary } from '@/utils/approvalSummary'
import { formatDate } from '@/utils/utils'
import { useUserStore } from '@/stores/user'

const props = withDefaults(defineProps<{
  /** 单据还没加载出来时传 null —— 组件自己空闲即可（页面不必再套一层 v-if） */
  order?: ApprovalOrder | null
  /**
   * 发起人姓名覆盖值。
   *
   * 单上只有 `creator`（users 记录 id）—— 姓名要么来自 `expand.creator`（受 users 的
   * viewRule 限制，普通员工展开别人会拿到空），要么由调用方/登录者兜底。这里留一个口子，
   * 页面若已经从别处拿到名字就直接传，省一次解析。
   */
  creatorName?: string
}>(), {
  order: null,
  creatorName: '',
})

const userStore = useUserStore()

/**
 * 发起人姓名：expand 展开值 → 传进来的覆盖值 → 「就是登录者自己」时的姓名。
 *
 * 三档都拿不到就留空（表格显示「—」）：宁可空着，也不能把别人名字顶上去 ——
 * 这张表是要导出去归档的。
 */
const resolvedCreatorName = computed(() => {
  const order = props.order
  if (!order) {
    return ''
  }
  const expanded = (order.expand as { creator?: { name?: string } } | undefined)?.creator?.name
  if (expanded) {
    return expanded
  }
  if (props.creatorName) {
    return props.creatorName
  }
  const creator = order.creator ?? ''
  const me = userStore.user
  return creator && me?.id === creator ? (me.name ?? '') : ''
})

/** null = 还没有单据（或模板里没传）：整块不渲染，导出按钮也就无从点起 */
const summary = computed(() => (props.order ? buildApprovalSummary(props.order, resolvedCreatorName.value) : null))

/** 键值对两两一组：一排放四个单元格（key / value / key / value），A4 宽度刚好 */
function toPairs (fields: SummaryField[]): SummaryField[][] {
  const pairs: SummaryField[][] = []
  for (let i = 0; i < fields.length; i += 2) {
    pairs.push(fields.slice(i, i + 2))
  }
  return pairs
}

const infoPairs = computed(() => toPairs(summary.value?.info ?? []))
const conclusionPairs = computed(() => toPairs(summary.value?.conclusion ?? []))
/**
 * 页脚时间在**挂载时**定一次：表里写的是"这份归档是何时导出的"，
 * 跟着实时时钟跳反而成了假信息。
 */
const exportedAt = formatDate(new Date().toISOString())

/* ==================== 导出 PDF ==================== */

const paperRef = ref<HTMLElement | null>(null)
const exporting = ref(false)

/**
 * 表格 → PDF。
 *
 * 为什么用 html2canvas + jsPDF 而不是"直接排文字"：jsPDF 内置字体没有中文，
 * 排文字会整张乱码；要么嵌一个中文字体（项目里没有现成字体文件、且体积可观），
 * 要么把 DOM 画成图再塞进 PDF —— 这里选后者，中文与排版都与页面上完全一致。
 * 两个库都**动态 import**：它们在点导出时才需要（与 utils/utils 的 exportExcel 同一个取舍）。
 *
 * 长图按 A4 可用高度**切片**分页：直接把整张图塞进一页会被压成一条，
 * 而每页重复画整图又会把前几页的内容带进来。
 *
 * 但"切在第几像素"不能按固定高度算：那样会把一张表从中间劈开，
 * 上一页留半张表、下一页接着半张表，归档时根本没法看。
 * 所以分页以**整张表**为单位：这张表在本页放不下，就整张挪到下一页
 * （小节标题跟着表一起走，见 paginate）。
 */
async function exportPdf () {
  const paper = paperRef.value
  const data = summary.value
  if (!paper || !data || exporting.value) {
    return
  }
  exporting.value = true
  try {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ])
    /*
     * 截图前把纸张宽度钉到 A4 比例：屏幕上它可能被右栏抽屉挤成 360px（表格是横滚的），
     * 直接截会得到又细又长、分页还断在列中间的图。`exporting` 这个类是唯一为导出服务的样式。
     */
    paper.classList.add('exporting')
    let canvas: HTMLCanvasElement
    let metrics: PaperMetrics = { rowBreaks: [], blocks: [] }
    try {
      canvas = await html2canvas(paper, {
        // 2 倍绘制：打印时不糊（1 倍在 A4 上字会发虚）
        scale: 2,
        backgroundColor: '#ffffff',
        useCORS: true,
        logging: false,
      })
      // 必须在摘掉 exporting 之前量：宽度一变，每张表的位置就全变了
      metrics = measurePaper(paper, canvas)
    } finally {
      paper.classList.remove('exporting')
    }

    const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' })
    const margin = 24
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const drawW = pageW - margin * 2
    // 图片按 drawW 缩放后 1px 对应多少 pt：切片高度与绘制高度都按它换算
    const scale = drawW / canvas.width
    const usableH = pageH - margin * 2
    const sliceH = Math.floor(usableH / scale)

    // 一页装得下就整张画一页，否则按「整张表不拆」的规则排页
    const pages: PageSlice[] = canvas.height <= sliceH
      ? [{ top: 0, bottom: canvas.height }]
      : paginate(metrics, canvas.height, sliceH)

    // 切片画到一张临时 canvas 上：每页只带自己那一段，页与页之间不重复
    const sliceCanvas = document.createElement('canvas')
    const sliceCtx = sliceCanvas.getContext('2d')
    if (!sliceCtx) {
      throw new Error('无法创建画布上下文')
    }
    sliceCanvas.width = canvas.width
    pages.forEach((page, index) => {
      const h = page.bottom - page.top
      // 改高度会重置画布状态，所以先改尺寸再铺底、再画
      sliceCanvas.height = h
      // 先铺白底：JPEG 没有透明通道，透明像素导出后会变成黑块
      sliceCtx.fillStyle = '#ffffff'
      sliceCtx.fillRect(0, 0, sliceCanvas.width, h)
      sliceCtx.drawImage(canvas, 0, page.top, canvas.width, h, 0, 0, canvas.width, h)
      if (index > 0) {
        pdf.addPage()
      }
      pdf.addImage(sliceCanvas.toDataURL('image/jpeg', 0.95), 'JPEG', margin, margin, drawW, h * scale)
    })

    pdf.save(`${data.fileName}.pdf`)
  } catch (error) {
    console.error('[审批信息] 导出 PDF 失败:', error)
  } finally {
    exporting.value = false
  }
}

/** 画布坐标上的一段：一页就画这一段 */
interface PageSlice {
  top: number
  bottom: number
}

/** 排版单元：一个小节标题 + 它下面的那张表（标题跟着表走，不许分家） */
interface PaperBlock {
  top: number
  bottom: number
}

interface PaperMetrics {
  /** 表格行的下边界（升序）：表比整页还高时，退回到"行与行之间"断 */
  rowBreaks: number[]
  /** 不可再分的单元，按文档顺序 */
  blocks: PaperBlock[]
}

/**
 * 块比整页还高、必须按行断时，断点最靠上的容忍度：
 * 断点若落在页首这个比例以内，本页几乎空白，不如按页高硬切。
 */
const BREAK_MIN_SLICE_RATIO = 0.35

/**
 * 量出分页要用的两样东西（画布坐标）。
 *
 * 必须在纸还是 A4 宽度（`exporting` 类还在）时量：宽度一变，每张表的高度就全变了。
 */
function measurePaper (paper: HTMLElement, canvas: HTMLCanvasElement): PaperMetrics {
  const rect = paper.getBoundingClientRect()
  if (rect.height <= 0) {
    return { rowBreaks: [], blocks: [] }
  }
  // 画布高度可能因取整与布局高度差一两个像素，按比例换算过去
  const k = canvas.height / rect.height
  const toCanvas = (viewportY: number) => (viewportY - rect.top) * k

  const rowBreaks = new Set<number>()
  paper.querySelectorAll('tr, .paper-foot').forEach((el) => {
    // 减 1px：翻页线压在行的下边框上，下一行从自己整行的顶端开始
    const y = Math.round(toCanvas(el.getBoundingClientRect().bottom)) - 1
    if (y > 0 && y < canvas.height) {
      rowBreaks.add(y)
    }
  })

  /*
   * 每个小节标题都是新一轮块的开始：标题 + 它下面那张表 = 一个块。
   * 这样换页时标题不会被单独留在页尾，表也不会跟自己的标题分家。
   */
  const blocks: PaperBlock[] = []
  let blockTop: number | null = null
  let lastBottom = 0
  Array.from(paper.children).forEach((el) => {
    const box = el.getBoundingClientRect()
    if (el.classList.contains('paper-section') && blockTop !== null) {
      blocks.push({ top: blockTop, bottom: lastBottom })
      blockTop = null
    }
    if (blockTop === null) {
      blockTop = toCanvas(box.top)
    }
    lastBottom = toCanvas(box.bottom)
  })
  if (blockTop !== null) {
    blocks.push({ top: blockTop, bottom: lastBottom })
  }

  return { rowBreaks: [...rowBreaks].sort((a, b) => a - b), blocks }
}

/**
 * 把长图排成若干页（画布坐标）。
 *
 * 排版单位是**整张表**：这张表在本页剩余空间放不下，就整张挪到下一页，
 * 上一页底部留白 —— 比"半张表 + 下一页半张表"好读得多。
 * 只有某张表自己就比一整页还高时（审批环节特别多），才退回到
 * 「行与行之间」断开，无论如何不会把某一行劈成两半。
 */
function paginate (metrics: PaperMetrics, canvasH: number, sliceH: number): PageSlice[] {
  const pages: PageSlice[] = []
  const minSlice = Math.floor(sliceH * BREAK_MIN_SLICE_RATIO)
  // 当前页的起点，以及这一页已排内容的下沿
  let pageTop = 0
  let cursor = 0

  for (const block of metrics.blocks) {
    // 放得进本页剩余空间：接着往下排
    if (block.bottom - pageTop <= sliceH) {
      cursor = block.bottom
      continue
    }
    // 放不下了：本页到此为止（页内可能已经有内容）
    if (cursor > pageTop) {
      pages.push({ top: pageTop, bottom: cursor })
    }
    // 块自己能装进一整页 —— 整块挪到下一页
    if (block.bottom - block.top <= sliceH) {
      pageTop = block.top
      cursor = block.bottom
      continue
    }
    // 块比整页还高：只能按行断，每页尽量装满
    let start = block.top
    while (block.bottom - start > sliceH) {
      const limit = Math.floor(start + sliceH)
      const end = pickBreak(metrics.rowBreaks, start + minSlice, limit) ?? limit
      pages.push({ top: start, bottom: end })
      start = end
    }
    pages.push({ top: start, bottom: block.bottom })
    // 这一块已经占满若干整页，后面的块从新页开始
    pageTop = block.bottom
    cursor = block.bottom
  }

  // 最后一页顺势带到纸张底部（页脚与纸张下留白都在这里）
  if (cursor > pageTop) {
    pages.push({ top: pageTop, bottom: Math.min(canvasH, pageTop + sliceH) })
  }
  return pages
}

/** 在 [min, max] 区间里取最靠下的断点；区间内没有断点就返回 null */
function pickBreak (breaks: number[], min: number, max: number): number | null {
  let best: number | null = null
  for (const y of breaks) {
    if (y < min) {
      continue
    }
    if (y > max) {
      break
    }
    best = y
  }
  return best
}
</script>

<style lang="scss" scoped>
.approval-summary {
  background: transparent;
}

.summary-bar {
  padding: 6px 4px;
}

/*
 * 纸张刻意用**写死的浅色**：导出时要的是归档用的白纸黑字，
 * 不能跟着暗色主题走（html2canvas 也不认主题变量里的现代颜色函数）。
 */
.paper-scroll {
  overflow-x: auto;
}

.paper {
  background: #ffffff;
  border: 1px solid #dcdfe4;
  border-radius: 8px;
  color: #1f2328;
  padding: 14px 16px 10px;
  font-size: 12px;
  line-height: 1.5;
  /* 窄容器（右栏抽屉）里保持可读宽度，放不下就横滚，别把列压扁 */
  min-width: 620px;
}

/*
 * 只在导出期间生效：钉成 A4 正文宽度（595pt ≈ 793px，去掉边距约 745px）。
 * 用 !important 压过上面的 min-width 与任何容器约束 —— 它只活到截图结束。
 */
.paper.exporting {
  width: 745px !important;
  max-width: none !important;
  border: none;
}

.paper-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #dcdfe4;
}

.paper-title {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 2px;
}

.paper-sub {
  color: #6b7280;
  font-size: 11px;
}

.paper-section {
  margin: 12px 0 6px;
  font-weight: 700;
  font-size: 12px;
}

.paper-foot {
  margin-top: 10px;
  color: #6b7280;
  font-size: 10px;
  text-align: right;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

th,
td {
  border: 1px solid #dcdfe4;
  padding: 4px 6px;
  vertical-align: top;
  word-break: break-word;
}

/* 键值表：key 列窄、浅底，与值区分开 */
.kv-table {
  th {
    width: 18%;
    background: #f5f6f8;
    font-weight: 500;
    text-align: left;
    color: #4b5563;
  }

  td {
    width: 32%;
  }
}

.grid-table {
  thead th {
    background: #f5f6f8;
    font-weight: 500;
    text-align: left;
    color: #4b5563;
  }

  /* 合计 / 剩余两行加粗：这两行才是业务上真正要看的数 */
  .row-strong td {
    background: #fafbfc;
    font-weight: 700;
  }
}

.col-index {
  width: 28px;
  text-align: center;
}

.col-approver {
  width: 104px;
}

.col-result {
  width: 84px;
}

.col-qty {
  width: 66px;
}

.col-amount {
  width: 84px;
}

.col-opinion {
  width: auto;
}

.col-at {
  width: 96px;
}

.col-duration {
  width: 68px;
}

.cell-main {
  font-weight: 500;
}

.cell-sub {
  color: #6b7280;
  font-size: 10px;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.empty {
  color: #6b7280;
  text-align: center;
}
</style>
