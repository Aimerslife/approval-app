/**
 * main.ts
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

// Composables
import { createApp } from 'vue'

// Plugins
import { registerPlugins } from '@/plugins'
import VMdEditor from '@kangc/v-md-editor/lib/codemirror-editor';
import '@kangc/v-md-editor/lib/style/codemirror-editor.css';
import githubTheme from '@kangc/v-md-editor/lib/theme/github.js';
import '@kangc/v-md-editor/lib/theme/style/github.css';

// highlightjs
import hljs from 'highlight.js';
import VueApexCharts from 'vue3-apexcharts'
// ApexCharts 从 v4 起把样式拆成了独立 CSS，**不再随 JS 注入**
// （实测 v7.3.0 的 ESM 里搜不到内嵌的 CSS 文本），必须手动引。
// 不引的话图表会缺 46.8KB 的定位/尺寸规则（含 23 条 position 规则），
// 画出来是错位的、看起来仍像「没渲染」。
// 要引在这里：apexcharts 是 vue3-apexcharts 内部 import 的，业务代码不会直接碰它。
import 'apexcharts/dist/apexcharts.css'

// codemirror 编辑器的相关资源
import Codemirror from 'codemirror';
// mode
import 'codemirror/mode/markdown/markdown';
import 'codemirror/mode/javascript/javascript';
import 'codemirror/mode/css/css';
import 'codemirror/mode/htmlmixed/htmlmixed';
import 'codemirror/mode/vue/vue';
// edit
import 'codemirror/addon/edit/closebrackets';
import 'codemirror/addon/edit/closetag';
import 'codemirror/addon/edit/matchbrackets';
// placeholder
import 'codemirror/addon/display/placeholder';
// active-line
import 'codemirror/addon/selection/active-line';
// scrollbar
import 'codemirror/addon/scroll/simplescrollbars';
import 'codemirror/addon/scroll/simplescrollbars.css';
// style
import 'codemirror/lib/codemirror.css';
import VMdPreview from '@kangc/v-md-editor/lib/preview';
import '@kangc/v-md-editor/lib/style/preview.css';

import VxeUI from 'vxe-pc-ui'
import 'vxe-pc-ui/lib/style.css'
import VxeUITable from 'vxe-table'
import 'vxe-table/lib/style.css'

import App from './App.vue'
// Styles
import 'unfonts.css'
import 'virtual:uno.css'
import './styles/main.scss'

VMdEditor.Codemirror = Codemirror;
VMdEditor.use(githubTheme, {
  Hljs: hljs,
})

VMdPreview.use(githubTheme, {
  Hljs: hljs,
});

const app = createApp(App)

registerPlugins(app)

// 注册 v-md-editor 全局组件
app.use(VMdEditor)
app.use(VMdPreview)
app.use(VxeUI)
app.use(VxeUITable)
app.use(VueApexCharts)

app.mount('#app')
