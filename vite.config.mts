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
    include: ['dayjs', 'dayjs/plugin/relativeTime', 'dayjs/locale/zh-cn'],
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
      '/api': 'http://127.0.0.1:8091',
      'files': 'http://127.0.0.1:8091',
    },
  },
})
