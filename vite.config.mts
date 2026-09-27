import { fileURLToPath, URL } from 'node:url'
import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Fonts from 'unplugin-fonts/vite'
import { defineConfig } from 'vite'
import Vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    AutoImport({
      imports: [
        'vue',
        'vue-router',
        'vue-i18n',
        '@vueuse/core',
        'pinia',
      ],
      dts: 'types/auto-imports.d.ts', // 使用typescript，需要指定生成对应的d.ts文件或者设置为true,生成默认导入d.ts文件
      dirs: ['src/stores', 'src/composables', 'src/hooks'],
    }),
    Vue({
      template: { transformAssetUrls },
    }), // https://github.com/vuetifyjs/vuetify-loader/tree/master/packages/vite-plugin#readme
    Vuetify({
      autoImport: true,
      styles: {
        configFile: 'src/styles/settings.scss',
      },
    }), Fonts({
      fontsource: {
        families: [
          {
            name: 'Roboto Mono',
            weights: [400, 700],
          },
          {
            name: 'Roboto',
            weights: [100, 300, 400, 500, 700, 900],
            styles: ['normal', 'italic'],
          },
        ],
      },
    }), UnoCSS()],
  define: { 'process.env': {} },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('src', import.meta.url)),
    },
    extensions: [
      '.js',
      '.json',
      '.jsx',
      '.mjs',
      '.ts',
      '.tsx',
      '.vue',
    ],
  },
  optimizeDeps: {
    // dayjs 的 plugin/locale 是 UMD 格式，Vite 预构建做 CJS→ESM interop 时，
    // 增量构建可能生成错误的具名导入（import { t } from 'dayjs'），
    // 运行时报 "does not provide an export named 't'"。
    // 显式列出，让它们在同一批次内一起预构建，避免产物版本错配。
    include: [
      'dayjs',
      'dayjs/plugin/relativeTime',
      'dayjs/locale/zh-cn',
      /*
       * xlsx 与 pinyin 是**动态** import 的（分别见 utils/utils.ts 的 exportExcel、
       * utils/pinyin.ts）—— 静态扫描看不到它们，于是 Vite 会在"第一次用到时"才去预构建。
       *
       * 中途重新预构建会**批量作废已有的模块 URL**（旧的 /node_modules/.vite/deps/*.js?v=<hash>
       * 直接 404），表现就是用户看到的：
       *   Failed to fetch dynamically imported module: http://localhost:3000/src/pages/xxx.vue?t=...
       * ——报错指的是那个页面 chunk，真正 404 的却是它内部引用的依赖。
       * 显式列进来，让它们和上面那批在同一批次里预构建，就不会中途重建了。
       */
      'xlsx',
      'pinyin',
    ],
  },
  server: {
    port: 3000,
    watch: {
      ignored: [
        '**/auth-state.json',
        '**/pocketbase/**',
      ],
    },
    proxy: {
      '/api/feishu': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
      },
      '/api/org-tree': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
      },
      // BI 上传/同步要打到 app server（3002），**必须声明在下面的 '/api' 之前**：
      // 代理是按声明顺序匹配前缀的，'/api' 那个会把 /api/bi/* 一起转给 PocketBase(8091)。
      '/api/bi': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
      },
      // 一言（第三方接口代理）也要打到 app server（3002），
      // 同样**必须声明在下面的 '/api' 之前** —— 否则会被兜底规则转给 PocketBase(8091) 而 404
      '/api/word': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
      },
      // 清空 BI 数据（POST /api/admin/purge）也在 app server 上。
      // 这一条就是上面两次踩过的同一个坑：漏了它就会被兜底规则转给 PocketBase(8091)，
      // 而 PB 没有这个路由 —— 界面上看到的就是"清空失败：HTTP 404"。
      '/api/admin': {
        target: 'http://127.0.0.1:3002',
        changeOrigin: true,
      },
      '/api': 'http://127.0.0.1:8091',
      'files': 'http://127.0.0.1:8091',
    },
  },
})
