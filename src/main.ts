/**
 * main.ts
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

import VMdEditor from '@kangc/v-md-editor/lib/codemirror-editor'
import VMdPreview from '@kangc/v-md-editor/lib/preview'
import githubTheme from '@kangc/v-md-editor/lib/theme/github.js'
// codemirror 编辑器的相关资源
import Codemirror from 'codemirror'
// highlightjs
import hljs from 'highlight.js'
// Composables
import { createApp } from 'vue'
import VxeUI from 'vxe-pc-ui'
import VxeUITable from 'vxe-table'

// Plugins
import { registerPlugins } from '@/plugins'
/*
 * 人员配置（团队 → 默认审批人）：数据在 data/people.json，运行期以 app server 那份为准。
 * 这里在**挂载之前**拉一次（见文件末尾的说明）。
 */
import { hydratePeopleConfig } from '@/utils/peopleConfig'
import App from './App.vue'
import '@kangc/v-md-editor/lib/style/codemirror-editor.css'
import '@kangc/v-md-editor/lib/theme/style/github.css'
/*
 * ApexCharts 已移除：全仓（除本文件外）**没有任何地方使用它** ——
 * 之前这里 `app.use(VueApexCharts)` + 引它的 CSS，等于让每个用户都白下 496KB 的 chunk
 * 与一份图表样式，而「分析」页至今是空占位。
 * 以后真要画图：在用到图表的那个页面里局部 import（别再挂回全局），
 * 并记得 apexcharts v4 起样式是独立的 CSS，要单独引，否则图表会错位。
 */
// mode
import 'codemirror/mode/markdown/markdown'
import 'codemirror/mode/javascript/javascript'
import 'codemirror/mode/css/css'
import 'codemirror/mode/htmlmixed/htmlmixed'
import 'codemirror/mode/vue/vue'
// edit
import 'codemirror/addon/edit/closebrackets'
import 'codemirror/addon/edit/closetag'
import 'codemirror/addon/edit/matchbrackets'
// placeholder
import 'codemirror/addon/display/placeholder'
// active-line
import 'codemirror/addon/selection/active-line'
// scrollbar
import 'codemirror/addon/scroll/simplescrollbars'
import 'codemirror/addon/scroll/simplescrollbars.css'
// style
import 'codemirror/lib/codemirror.css'
import '@kangc/v-md-editor/lib/style/preview.css'
import 'vxe-pc-ui/lib/style.css'
import 'vxe-table/lib/style.css'
// Styles
import 'unfonts.css'
import 'virtual:uno.css'
import './styles/main.scss'

VMdEditor.Codemirror = Codemirror
VMdEditor.use(githubTheme, {
  Hljs: hljs,
})

VMdPreview.use(githubTheme, {
  Hljs: hljs,
})

const app = createApp(App)

registerPlugins(app)

// 注册 v-md-editor 全局组件
app.use(VMdEditor)
app.use(VMdPreview)
app.use(VxeUI)
app.use(VxeUITable)

/*
 * 先取一次最新的团队表，再挂应用。
 *
 * 为什么必须在挂载**之前**：团队表是**同步读取**的（utils/organazation 的 groupManage），
 * 首屏就可能用到它 —— 人员配置表、模板里的「选择接收团队」候选、动态审批人解析。
 * 挂载后再补的话，这些地方会先按打包快照渲染一遍，得刷新一次才正常。
 *
 * hydrate 内部有 1.5s 超时且不抛错：服务没起 / 文件没了都照常启动（用打包里的快照），
 * 不会因为这份"锦上添花"的数据把整个应用卡住白屏。
 */
void (async () => {
  await hydratePeopleConfig()
  app.mount('#app')
})()
