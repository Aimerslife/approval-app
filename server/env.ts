/**
 * 环境变量加载。**只做加载这一件事**，被需要 env 的服务端模块 import 即可。
 *
 * ⚠️ 为什么要单独抽成一个模块，而不是写在 index.ts 的模块体里：
 *
 *   ESM 的 import 会在**模块体执行之前**全部求值完（依赖先于使用者）。
 *   原来 process.loadEnvFile() 写在 index.ts 的模块体里，而 biSync.ts 是
 *   `import { ... } from './biSync'` 拉进来的 —— 顺序变成：
 *
 *     biSync.ts 顶层 const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || ''  ← 先执行，env 还没加载
 *     index.ts  模块体 for (...) process.loadEnvFile('.env.local')            ← 后执行，太晚了
 *
 *   结果是 biSync.ts 里**所有**顶层 env 读取（PB_ADMIN_* / BI_ACCESS_* / PB_URL /
 *   BI_SHARD_* …）拿到的永远是空串，而 index.ts 自己的 FEISHU_APP_ID 是写在模块体里、
 *   在 loadEnvFile 之后读的，所以它是好的 —— 症状就是"飞书凭据生效了，
 *   PB_ADMIN_EMAIL 明明写了却报缺少环境变量"。
 *
 *   抽成模块后，只要读取方 `import './env'`，本模块就会被先求值，
 *   **与它在 index.ts 里被 import 的位置无关** —— 调整 import 顺序不会再复发。
 *
 * tsx 不会自动加载 .env*（也没开 node 的 --env-file），所以用 node 原生 API 显式加载
 * （node >= 20.12，本项目 v24 满足），把变量写进 .env.local 就行，不必每次 export。
 *
 * 文件不存在会抛错 —— 那是正常情况（.env.local 已被 .gitignore 忽略），忽略即可。
 * 注意 loadEnvFile **不覆盖**已存在的环境变量，所以 shell 里 export 的值优先级更高。
 */
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file)
  } catch {
    /* 文件不存在：忽略 */
  }
}
