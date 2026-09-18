<template>
  <v-app>
    <v-tabs
      v-model="tab"
      align-tabs="center"
      class="sticky top-8 z-99 tabs-shadow"
      :class="{ 'tabs-scrolled': scrolled }"
      color="primary"
      fixed-tabs
      style="background-color: rgb(var(--v-theme-surface))"
    >
      <v-tab prepend-icon="mdi-file-table-box" value="data">
        <span>数据</span>
      </v-tab>

      <v-tab prepend-icon="mdi-chart-areaspline" value="analyze">
        <span>统计</span>
      </v-tab>
    </v-tabs>

    <v-tabs-window v-model="tab">
      <v-tabs-window-item value="data">
        <v-container class="px-3 py-4 h-[calc(100vh-20px)] bg-app" fluid>
          <div class="my-grid-wrap">
            <vxe-grid ref="gridRef" class="my-grid" v-bind="gridOptions" v-on="gridEvents">
              <template #productInfoDefault="{ row }">
                <div class="flex items-center gap-1 node">
                  <span v-if="visible('产品名称')">{{ row['产品名称'] }}</span>

                  <vxe-tag v-if="visible('是否属于灯具')" :status="row['是否属于灯具'] === '是' ? 'primary' : 'info'">
                    <span class="text-[9px]">{{ row['是否属于灯具'] === '是' ? '灯具' : '非灯具' }}</span>
                  </vxe-tag>
                </div>

                <div v-if="visible('SKU')">SKU：{{ row.SKU }}</div>
                <div v-if="visible('SPU')">SPU：{{ row.SPU }}</div>
                <div v-if="visible('主MODEL')">主MODEL：{{ row['主MODEL'] }}</div>
                <div v-if="visible('参考MSKU')">参考MSKU：{{ row['参考MSKU'] }}</div>
              </template>

              <template #saleTimeDefault="{ row }">
                <div v-if="visible('最早开售日期-SKU')">
                  <span class="text-gray-500 block">最早开售日期-SKU：</span>
                  <span>{{ row['最早开售日期-SKU'] }}</span>
                </div>

                <div v-if="visible('拓业部最早时间-SPU')">
                  <span class="text-gray-500 block">拓业部最早时间-SPU：</span>
                  <span>{{ row['拓业部最早时间-SPU'] }}</span>
                </div>
              </template>

              <template #productGroupDefault="{ row }">
                <div v-if="visible('供应商')">供应商：{{ row['供应商'] }}</div>
                <div v-if="visible('组长')">组长：{{ row['组长'] }}</div>
                <div v-if="visible('组别')">组别：{{ row['组别'] }}</div>
                <div v-if="visible('部门')">部门：{{ row['部门'] }}</div>
              </template>

              <template #platformDefault="{ row }">
                <div v-if="visible('仓位')">仓位：{{ row['仓位'] }}</div>
                <div v-if="visible('店铺')">店铺：{{ row['店铺'] }}</div>
                <div v-if="visible('平台')">平台：{{ row['平台'] }}</div>
              </template>

              <template #remainDefault="{ row }">
                <!-- BI 的「是否属于呆滞库存」取值是「呆滞」/空，不是「是」 -->
                <vxe-tag v-if="visible('是否属于呆滞库存')" :status="row['是否属于呆滞库存'] === '呆滞' ? 'danger' : 'success'">
                  {{ row['是否属于呆滞库存'] === '呆滞' ? '呆滞' : '正常' }}
                </vxe-tag>
              </template>

              <template #statusDefault="{ row }">
                <vxe-tag v-if="visible('销售状态')" :status="saleStatusOf(row['销售状态'])">
                  {{ row['销售状态'] }}
                </vxe-tag>
              </template>

              <template #typeDefault="{ row }">
                <div v-if="visible('一级品类')">一级品类：{{ row['一级品类'] }}</div>
                <div v-if="visible('二级品类')">二级品类：{{ row['二级品类'] }}</div>
              </template>

              <template #productAmountDefault="{ row }">
                <div v-if="visible('FBA在仓')">FBA在仓：{{ row['FBA在仓'] }}</div>
                <div v-if="visible('FBA在途')">FBA在途：{{ row['FBA在途'] }}</div>
                <div v-if="visible('海外仓在仓')">海外仓在仓：{{ row['海外仓在仓'] }}</div>
                <div v-if="visible('海外仓在途')">海外仓在途：{{ row['海外仓在途'] }}</div>
              </template>

              <template #otherDefault="{ row }">
                <div v-if="visible('采购中')">采购中：{{ row['采购中'] }}</div>
                <div v-if="visible('本地仓')">本地仓：{{ row['本地仓'] }}</div>
                <div v-if="visible('未入仓')">未入仓：{{ row['未入仓'] }}</div>
              </template>

              <template #totalDefault="{ row }">
                <div v-if="visible('总库存数量')">总库存数量：{{ row['总库存数量'] }}</div>
                <div v-if="visible('总库存金额')">总库存金额：{{ row['总库存金额'] }}</div>
                <div v-if="visible('未入仓')">未入仓：{{ row['未入仓'] }}</div>
              </template>

              <template #timeCountDefault="{ row }">
                <div v-if="visible('3个月内[0-90]')">3个月内[0-90]：{{ row['3个月内[0-90]'] }}</div>
                <div v-if="visible('3-6个月内[91-180]')">3-6个月内[91-180]：{{ row['3-6个月内[91-180]'] }}</div>
                <div v-if="visible('6-9个月内[181-270]')">6-9个月内[181-270]：{{ row['6-9个月内[181-270]'] }}</div>
                <div v-if="visible('9-12个月内[271-365]')">9-12个月内[271-365]：{{ row['9-12个月内[271-365]'] }}</div>
                <div v-if="visible('1年以上[365+]')">1年以上[365+]：{{ row['1年以上[365+]'] }}</div>
              </template>

              <template #timeAmountDefault="{ row }">
                <div v-if="visible('3个月内[0-90]（金额）')">3个月内[0-90]：{{ row['3个月内[0-90]（金额）'] }}</div>
                <div v-if="visible('3-6个月内[91-180](金额)')">3-6个月内[91-180]：{{ row['3-6个月内[91-180](金额)'] }}</div>
                <div v-if="visible('6-9个月内[181-270](金额)')">6-9个月内[181-270]：{{ row['6-9个月内[181-270](金额)'] }}</div>
                <div v-if="visible('9-12个月内[271-365](金额）')">9-12个月内[271-365]：{{ row['9-12个月内[271-365](金额）'] }}</div>
                <div v-if="visible('一年以上[365+](金额)')">一年以上[365+]：{{ row['一年以上[365+](金额)'] }}</div>
              </template>

              <template #skuAmountDefault="{ row }">
                <div v-if="visible('SKU1月前回款')">1月前回款：{{ row['SKU1月前回款'] }}</div>
                <div v-if="visible('SKU2月前回款')">2月前回款：{{ row['SKU2月前回款'] }}</div>
                <div v-if="visible('SKU3月前回款')">3月前回款：{{ row['SKU3月前回款'] }}</div>
                <div v-if="visible('SKU上年回款')">上年回款：{{ row['SKU上年回款'] }}</div>
              </template>

              <template #skuProfitDefault="{ row }">
                <div v-if="visible('SKU1月前毛利润')">1月前毛利润：{{ row['SKU1月前毛利润'] }}</div>
                <div v-if="visible('SKU2月前毛利润')">2月前毛利润：{{ row['SKU2月前毛利润'] }}</div>
                <div v-if="visible('SKU3月前毛利润')">3月前毛利润：{{ row['SKU3月前毛利润'] }}</div>
              </template>

              <template #asinAmountDefault="{ row }">
                <div v-if="visible('父ASIN1月前回款')">1月前回款：{{ row['父ASIN1月前回款'] }}</div>
                <div v-if="visible('父ASIN2月前回款')">2月前回款：{{ row['父ASIN2月前回款'] }}</div>
                <div v-if="visible('父ASIN3月前回款')">3月前回款：{{ row['父ASIN3月前回款'] }}</div>
                <div v-if="visible('父ASIN上一年回款')">上一年回款：{{ row['父ASIN上一年回款'] }}</div>
              </template>

              <template #asinProfitDefault="{ row }">
                <div v-if="visible('父ASIN1月前毛利润')">1月前毛利润：{{ row['父ASIN1月前毛利润'] }}</div>
                <div v-if="visible('父ASIN2月前毛利润')">2月前毛利润：{{ row['父ASIN2月前毛利润'] }}</div>
                <div v-if="visible('父ASIN3月前毛利润')">3月前毛利润：{{ row['父ASIN3月前毛利润'] }}</div>
              </template>

              <template #spuAmountDefault="{ row }">
                <div v-if="visible('SPU1月前回款')">1月前回款：{{ row['SPU1月前回款'] }}</div>
                <div v-if="visible('SPU2月前回款')">2月前回款：{{ row['SPU2月前回款'] }}</div>
                <div v-if="visible('SPU3月前回款')">3月前回款：{{ row['SPU3月前回款'] }}</div>
                <div v-if="visible('SPU4月前回款')">4月前回款：{{ row['SPU4月前回款'] }}</div>
              </template>

              <template #spuProfitDefault="{ row }">
                <div v-if="visible('SPU1月前毛利润')">1月前毛利润：{{ row['SPU1月前毛利润'] }}</div>
                <div v-if="visible('SPU2月前毛利润')">2月前毛利润：{{ row['SPU2月前毛利润'] }}</div>
                <div v-if="visible('SPU3月前毛利润')">3月前毛利润：{{ row['SPU3月前毛利润'] }}</div>
                <div v-if="visible('SPU4月前毛利润')">4月前毛利润：{{ row['SPU4月前毛利润'] }}</div>
              </template>

              <template #salesDefault="{ row }">
                <div v-if="visible('SKU近一年月平均销量')">近一年月平均销量：{{ row['SKU近一年月平均销量'] }}</div>
                <div v-if="visible('SPU近一年月平均销量')">近一年月平均销量：{{ row['SPU近一年月平均销量'] }}</div>
              </template>
            </vxe-grid>
          </div>
        </v-container>
      </v-tabs-window-item>

      <v-tabs-window-item value="analyze">
        <v-container class="bg-app" fluid>
          <v-sheet border class="px-5 pt-4" rounded />

        </v-container>
      </v-tabs-window-item>
    </v-tabs-window>
  </v-app>
</template>
<script lang="ts" setup>
  import type { VxeColumnPropTypes, VxeComponentStatusType, VxeGridInstance, VxeGridListeners, VxeGridProps, VxeGridPropTypes } from 'vxe-table'
  import { useTheme } from 'vuetify'
  import { setTheme } from 'vxe-table'
  import XEUtils from 'xe-utils'
  import { getDashbordDatas } from '@/api/api'
  import { useUserStore } from '@/stores/user'
  import { DEFAULT_VISUALABLE } from '@/utils/productFields'
  const theme = useTheme()
  const gridRef = ref<VxeGridInstance>()

  const tab = ref('数据')
  const userStore = useUserStore()

  /**
   * BI 的「销售状态」是逗号分隔的多值组合（实测有「停售,删除,在售」「不完整,删除,在售」等 8 种），
   * 简单的等值查表会全部落到 info，这里按包含关系取色：优先停售 > 在售 > 未知。
   */
  function saleStatusOf (v: unknown): VxeComponentStatusType {
    const s = String(v ?? '')
    if (s.includes('停售')) return 'danger'
    if (s.includes('在售')) return 'success'
    return 'info'
  }
  // BI 组件拉回来的真实行数据：getDashbordDatas 已把 fields+二维 rows 归一化成对象数组，
  // key 为中文列名（部分已通过别名对齐到表格配置）。字段随 BI 配置变化，故不写死类型。
  const setDatas = ref<Record<string, unknown>[]>([])
  // 行数据 key 由 BI 组件决定（中文列名，见 api.ts 的 BI_FIELD_ALIAS），
  // 列定义里的 field 只是占位（真实取值走各列的 slot），所以不再固定 RowVO 结构。
  type RowVO = Record<string, any>

  const productUrlCellRender = reactive<VxeColumnPropTypes.CellRender>({
    name: 'VxeImage',
    props: {
      width: 100,
      height: 100,
    },
  })

  const countRow = reactive({
    checkbox: '合计',
    productName: 0,
    productAmount: 0,
  })

  const gridOptions = reactive<VxeGridProps<RowVO> & { pagerConfig: VxeGridPropTypes.PagerConfig }>({
    border: true,
    loading: false,
    stripe: true,
    showOverflow: true,
    showFooter: true,
    height: '100%',
    autoResize: true,
    cellConfig: {
      height: 120,
    },
    columnConfig: {
      resizable: true,
      drag: true,
    },
    columnDragConfig: {
      trigger: 'cell',
      showIcon: false,
    },
    rowConfig: {
      drag: true,
    },
    resizableConfig: {
      isDblclickAutoWidth: true,
    },
    expandConfig: {
      padding: true,
    },
    formConfig: {
      titleWidth: 80,
      titleAlign: 'right',
      items: [
        { field: 'productName', title: '产品名称', span: 6, itemRender: { name: 'VxeInput' } },
        { field: 'productTime', title: '开售时间', span: 6, itemRender: { name: 'VxeInput' } },
        { field: 'productGroup', title: '组织信息', span: 6, itemRender: { name: 'VxeInput' } },
        { field: 'platform', title: '平台', span: 6, folding: true, itemRender: { name: 'VxeInput' } },
        { field: 'remain', title: '呆滞', span: 6, folding: true, itemRender: { name: 'VxeInput' } },
        { field: 'type', title: '品类', span: 6, folding: true, itemRender: { name: 'VxeDatePicker' } },
        { field: 'endTime', title: '结束时间', span: 6, folding: true, itemRender: { name: 'VxeDatePicker' } },
        {
          span: 6,
          collapseNode: true,
          itemRender: {
            name: 'VxeButtonGroup',
            options: [
              { type: 'submit', content: '查询', status: 'primary', icon: 'vxe-icon-search' },
              { type: 'reset', content: '重置', icon: 'vxe-icon-repeat' },
            ],
          },
        },
      ],
    },
    toolbarConfig: {
      custom: true,
      refresh: true,
      zoom: true,
    },
    checkboxConfig: {
      range: true,
    },
    mouseConfig: {
      selected: true,
    },
    keyboardConfig: {
      isEdit: true,
      isArrow: true,
      isEnter: true,
      isBack: true,
      isDel: true,
      isEsc: true,
    },
    pagerConfig: {
      pageSize: 100,
      pageSizes: [3, 20, 100, 500, 1000, 5000, 10_000, 50_000, 100_000],
    },
    virtualXConfig: {
      gt: 0,
      enabled: true,
    },
    virtualYConfig: {
      gt: 0,
      enabled: true,
    },
    columns: [
      { field: 'seq', type: 'seq', width: 50, align: 'center' },
      { field: '图片链接', title: '产品图片', width: 140, align: 'center', cellRender: productUrlCellRender },
      { field: 'productInfo', title: '产品名称', minWidth: 150, slots: { default: 'productInfoDefault' } },
      { field: 'saleTime', title: '开售时间', minWidth: 150, slots: { default: 'saleTimeDefault' } },
      { field: 'productGroup', title: '组织信息', minWidth: 150, slots: { default: 'productGroupDefault' } },
      { field: 'platform', title: '平台', width: 130, slots: { default: 'platformDefault' } },
      { field: 'remain', title: '呆滞情况', width: 60, slots: { default: 'remainDefault' } },
      { field: 'saleStatus', title: '在售情况', width: 60, slots: { default: 'statusDefault' } },
      { field: 'type', title: '品类', width: 150, align: 'center', slots: { default: 'typeDefault' } },
      { field: 'productAmount', title: '库存数量', width: 120, slots: { default: 'productAmountDefault' } },
      { field: 'onAmount', title: '其他库存', width: 100, slots: { default: 'otherDefault' } },
      { field: 'total', title: '总库存', width: 150, slots: { default: 'totalDefault' } },
      { field: 'timeCount', title: '库龄数量', width: 180, slots: { default: 'timeCountDefault' } },
      { field: 'timeAmount', title: '库龄金额', width: 200, slots: { default: 'timeAmountDefault' } },
      { field: 'skuAmount', title: 'SKU回款', width: 160, slots: { default: 'skuAmountDefault' } },
      { field: 'skuProfit', title: 'SKU毛利润', width: 160, slots: { default: 'skuProfitDefault' } },
      { field: 'asinAmount', title: '父ASIN回款', width: 160, slots: { default: 'asinAmountDefault' } },
      { field: 'asinProfit', title: '父ASIN毛利润', width: 160, slots: { default: 'asinProfitDefault' } },
      { field: 'spuAmount', title: 'SPU回款', width: 160, slots: { default: 'spuAmountDefault' } },
      { field: 'spuProfit', title: 'SPU毛利率', width: 160, slots: { default: 'spuProfitDefault' } },
      { field: 'sales', title: '销量', width: 160, slots: { default: 'salesDefault' } },
    ],
    proxyConfig: {
      form: true,
      response: {
        result: 'data',
        total: 'total',
      },
      ajax: {
        // 数据源：getDatas() 从 BI 拉到的 setDatas；这里按分页切片后返回
        query ({ page }) {
          const all = setDatas.value || []
          const start = (page.currentPage - 1) * page.pageSize
          const data = all.slice(start, start + page.pageSize)
          return Promise.resolve({ data, total: all.length })
        },
      },
    },
    footerData: [
      countRow,
    ],
  })

  /**
   * 字段级显隐：优先取用户偏好，没存过的回落 productFields.ts 的默认值。
   * 读的是 Pinia 里的响应式状态，所以模板里的 v-if 会随偏好实时更新。
   */
  function visible (key: string): boolean {
    const v = userStore.user?.preferences?.columnVisibility?.[key]
    return typeof v === 'boolean' ? v : (DEFAULT_VISUALABLE[key] ?? true)
  }

  /**
   * 每列承载的 BI 字段（key 必须与 gridOptions.columns 里的 field 一致）。
   * 一个分组列用 slot 渲染多个字段，所以是「列 → 字段数组」而非一对一。
   */
  const COLUMN_FIELDS: Record<string, string[]> = {
    图片链接: ['图片链接'],
    productInfo: ['产品名称', '是否属于灯具', 'SKU', 'SPU', '主MODEL', '参考MSKU'],
    saleTime: ['最早开售日期-SKU', '拓业部最早时间-SPU'],
    productGroup: ['供应商', '组长', '组别', '部门'],
    platform: ['仓位', '店铺', '平台'],
    remain: ['是否属于呆滞库存'],
    saleStatus: ['销售状态'],
    type: ['一级品类', '二级品类'],
    productAmount: ['FBA在仓', 'FBA在途', '海外仓在仓', '海外仓在途'],
    onAmount: ['采购中', '本地仓', '未入仓'],
    total: ['总库存数量', '总库存金额', '未入仓'],
    timeCount: ['3个月内[0-90]', '3-6个月内[91-180]', '6-9个月内[181-270]', '9-12个月内[271-365]', '1年以上[365+]'],
    timeAmount: ['3个月内[0-90]（金额）', '3-6个月内[91-180](金额)', '6-9个月内[181-270](金额)', '9-12个月内[271-365](金额）', '一年以上[365+](金额)'],
    skuAmount: ['SKU1月前回款', 'SKU2月前回款', 'SKU3月前回款', 'SKU上年回款'],
    skuProfit: ['SKU1月前毛利润', 'SKU2月前毛利润', 'SKU3月前毛利润'],
    asinAmount: ['父ASIN1月前回款', '父ASIN2月前回款', '父ASIN3月前回款', '父ASIN上一年回款'],
    asinProfit: ['父ASIN1月前毛利润', '父ASIN2月前毛利润', '父ASIN3月前毛利润'],
    spuAmount: ['SPU1月前回款', 'SPU2月前回款', 'SPU3月前回款', 'SPU4月前回款'],
    spuProfit: ['SPU1月前毛利润', 'SPU2月前毛利润', 'SPU3月前毛利润', 'SPU4月前毛利润'],
    sales: ['SKU近一年月平均销量', 'SPU近一年月平均销量'],
  }

  /** 整列字段全被关掉时把列本身隐藏，避免留一列空白（如默认全关的「呆滞情况」） */
  function syncColumnVisibility () {
    const cols = gridOptions.columns
    if (!cols) return
    for (const col of cols) {
      const keys = COLUMN_FIELDS[String(col.field ?? '')]
      if (!keys) continue
      col.visible = keys.some(visible)
    }
  }
  // immediate：首屏就要按偏好隐藏；deep：偏好里任意一项变化都要重算
  watch(() => userStore.user?.preferences?.columnVisibility, syncColumnVisibility, { deep: true, immediate: true })

  const gridEvents: VxeGridListeners = {
    pageChange ({ pageSize }) {
      gridOptions.pagerConfig.pageSize = pageSize
    },
    proxyQuery () {
      updateFooterCount()
    },
  }

  /** 按真实数据计算 footer：总条数 + 「总库存金额」合计 */
  function updateFooterCount () {
    const rows = setDatas.value || []
    countRow.productName = rows.length
    countRow.productAmount = rows.reduce(
      (sum, r) => sum + (Number(r?.['总库存金额']) || 0),
      0,
    )
  }
  const scrolled = ref(false)
  function onScroll () {
    // 向上滚动（scrollTop > 0）时显示阴影
    scrolled.value = (window.scrollY || document.documentElement.scrollTop) > 4
  }
  async function getDatas () {
    gridOptions.loading = true
    try {
      // getDashbordDatas 已把 BI 的 fields+二维 rows 归一化成对象数组
      setDatas.value = await getDashbordDatas('0c356d17-3c48-4c3b-b133-e6406a88c5fe')
      // 数据是本地全量（分页在 ajax.query 里切片），拉到后要让表格重新查一次
      await gridRef.value?.commitProxy('query')
    } catch (error) {
      console.error('[detail] 拉取 BI 数据失败:', error)
    } finally {
      gridOptions.loading = false
    }
  }
  watch(() => theme.global.name.value, name => setTheme(name === 'dark' ? 'dark' : 'light'), { immediate: true })
  onMounted(() => {
    // 拉取 BI 组件真实数据；vxe-grid 分页由 ajax.query 切 setDatas
    window.addEventListener('scroll', onScroll, { passive: true })
    getDatas()
  })
  onUnmounted(() => window.removeEventListener('scroll', onScroll))
</script>

<style scoped>
.my-grid-wrap {
  height: calc(100vh - 100px);
}

.my-grid {
  height: 100%;
  font-size: 12px;
}

.my-grid :deep(.vxe-table) {
  font-size: 12px;
}
:deep(.vxe-tools--operate){
  margin-right: 10px;
}
.my-grid :deep(.vxe-cell) {
  font-size: 12px;
}
.node :deep(.vxe-tag) {
  padding: 0 2px;
  height: auto;
  line-height: 1.5;
  vertical-align: middle;
}
.my-grid :deep(.vxe-tag--content) {
  margin: 0;
}
.tabs-scrolled {
  box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.15);
}
</style>
