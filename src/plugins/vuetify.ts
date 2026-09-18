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

export default createVuetify({
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
