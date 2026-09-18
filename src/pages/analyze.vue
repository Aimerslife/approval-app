<template>
  <v-container fluid>
    <v-row>
      <v-col cols="4">
        <div style="width:100%;height:100%">
          <!-- VueApexCharts 来自下方显式 import。
         注意：全局注册名是 apexchart，不是 VueApexCharts（见脚本里的说明）。 -->
          <VueApexCharts
            ref="chartRef"
            height="100%"
            :options="chartOptions"
            :series="series"
            type="bar"
          />
        </div>
      </v-col>

      <v-col cols="4" />
      <v-col cols="4" />
    </v-row>
  </v-container>
</template>
<script setup lang="ts">
// 显式 import 之后组件 props 才真正被类型检查（之前组件解析不到，整块都跳过了），
// 所以 options 必须用官方类型标注：否则 title.align 会被推成 string，
// 而 ApexCharts 要的是 'left' | 'center' | 'right' 字面量联合，会报 TS2322。
  import type { ApexOptions } from 'apexcharts'
  /**
   * ⚠️ 这行 import 不能省 —— 它就是「图表不显示」的原因。
   *
   * main.ts 里虽然写了 app.use(VueApexCharts)，但那个插件执行的是
   * `app.component(x.name)`，而组件自身的 name 是 **'apexchart'**
   * （实测 vue3-apexcharts@1.11.1 的 dist：name: apexchart / apexchart-server / apexchart-hydrate）。
   * 也就是说全局注册的只有 <apexchart>，**没有** <VueApexCharts>。
   *
   * 于是模板写 <VueApexCharts> 时 Vue 解析不到，只打印
   * "Failed to resolve component: VueApexCharts" 警告，然后不渲染任何东西 ——
   * 外层 div 有 400px 高，看起来就是「图表没展示」。
   *
   * 显式 import 后在当前组件本地注册，名字就是 VueApexCharts，模板不用改。
   */
  import VueApexCharts from 'vue3-apexcharts'

  // 图表数据 series
  const series = ref([
    {
      name: '销售额',
      data: [31, 40, 28, 51, 42, 109, 100],
    },
  ])

  // 图表配置 options
  const chartOptions = ref<ApexOptions>({
    chart: {
      id: 'sales-chart',
      toolbar: { show: true }, // 右上角下载/缩放工具栏
    },
    title: {
      text: '月度销售额',
      align: 'left',
    },
    xaxis: {
      categories: ['1月', '2月', '3月', '4月', '5月', '6月', '7月'],
    },
    tooltip: {
      enabled: true,
    },
    colors: ['#409eff'],
  })

  // 获取图表实例，调用原生方法
  const chartRef = ref(null)
// chartRef.value.chart.downloadPNG()
</script>
