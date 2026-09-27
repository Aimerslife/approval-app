/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Composables
import { createVuetify } from 'vuetify'
// Styles
import '@mdi/font/css/materialdesignicons.css'
import 'vuetify/styles'
// 中文语言包（Vuetify 自带的一套文案）
import { zhHans } from 'vuetify/locale'

// 品牌色：主色取顶部品牌蓝 #1055C9；暗色下提亮保证对比度与可读性。
// 页面内请优先使用主题变量（rgb(var(--v-theme-*))）与 color="primary"，
// 不要再散落硬编码色值，深浅色才能同步切换。
const lightColors = {
  primary: '#1055C9',
  secondary: '#3378FF',
  info: '#2D74C5',
  success: '#2FB344',
  warning: '#F79009',
  error: '#E5484D',
}

const darkColors = {
  primary: '#4C84FF',
  secondary: '#7BA9FF',
  info: '#5B9DF0',
  success: '#4CC38A',
  warning: '#F5A623',
  error: '#F2555A',
}

/**
 * 组件默认值：空数据文案。
 *
 * 表格**不用**在这里写 —— 下面的 zhHans 语言包里 noDataText 就是「没有数据」，
 * 再写一遍只是重复（已在 node_modules/vuetify/lib/locale/zh-Hans.js 核对过取值）。
 *
 * 要改的只有下拉：那里的空状态是**选项列表为空**，说"没有数据"不准确，应当是「没有选项」。
 * 注意 VSelect 与 VAutocomplete 是两个不同的 prop 默认值来源，所以这里按组件分别给。
 *
 * 页面里显式传了 :no-data-text 的地方仍然优先，不受这里影响 ——
 * setDatas / workStream 的表格就在按加载状态与筛选条件自己组织文案
 * （「没有符合筛选条件的数据，试试放宽条件」比一句"没有数据"有用得多）。
 */
const defaults = {
  VSelect: { noDataText: '没有选项' },
  VAutocomplete: { noDataText: '没有选项' },
  VCombobox: { noDataText: '没有选项' },
}

export default createVuetify({
  defaults,
  /*
   * 界面文案的整体语言。
   *
   * 这里必须配 —— 空数据文案只是英文默认值里最显眼的一个，同源的还有：
   * 表格底部的分页与"每页行数"、日期选择器的月份/星期、文件上传的提示等，
   * 不配就会中英混排。此前历史表格那边是靠页面自己传 items-per-page-text="每页条数"
   * 单独打补丁的（那种补丁只覆盖得到一处）。
   *
   * fallback 留给 'en'：万一某个键在中文包里缺失，显示英文也比显示原始键名好。
   */
  locale: {
    locale: 'zhHans',
    /*
     * ⚠️ 必须显式注册语言包，只写 locale: 'zhHans' 是**空操作** ——
     * Vuetify 内置的只有 en，其余语言包要用 messages 喂进来
     * （类型定义见 vuetify/lib/composables/locale.d.ts 的 LocaleOptions.messages）。
     * 漏了这一步的表现很隐蔽：配置看着"已经是中文了"，运行时却全部回落到英文。
     */
    messages: { zhHans },
    fallback: 'en',
  },
  theme: {
    defaultTheme: 'system',
    themes: {
      light: {
        dark: false,
        colors: lightColors,
      },
      dark: {
        dark: true,
        colors: darkColors,
      },
    },
  },
})
