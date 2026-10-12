/// <reference types="vite/client" />
/// <reference types="vite-plugin-vue-layouts-next/client" />

/*
 * `*.vue` 的兜底声明。
 *
 * 必备的理由：`.vue` 不是 TypeScript 认得的模块，类型全靠 Volar（vue-tsc / IDE 里的 Vue 插件）
 * 在解析期提供。**没装 Volar、或语言服务还没索引到新建的 .vue 文件**时，导入 `@/pages/x.vue`
 * 就会报 TS7016「无法找到模块的声明文件，隐式拥有 any」—— 与页面代码本身对错无关
 * （已实测：vue-tsc 全量检查零错误，IDE 仍会对刚新建的页面报这一条）。
 * 有了这个兜底，任何编辑器都能把 .vue 当模块解析，不会再出现"文件明明在、却报找不到声明"。
 *
 * 它**不会**削弱本项目的类型检查：Volar 的模块解析优先于通配兜底声明
 * （env.d.ts 的 include 与本文件同项目，实测 `InstanceType<typeof X>['$props']` 拿到的仍是
 * 组件的真实 props，而不是 any）。
 */
declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent
  export default component
}
