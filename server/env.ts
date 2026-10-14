/**
 * 环境变量加载。**只做加载这一件事**，被需要 env 的服务端模块 import 即可。
 *
 * ## 加载顺序（先加载的赢，`loadEnvFile` 不覆盖已存在的值）
 *
 *   1. `APPROVAL_ENV_FILE` 指向的文件（**部署时推荐**：把密钥放在仓库之外，见下）
 *   2. `/etc/approval/env`（约定位置，存在就用；不存在忽略）
 *   3. `.env.local`、`.env`（本地开发用，已被 .gitignore 忽略）
 *
 * 最后由真实进程环境变量兜底（systemd 的 `EnvironmentFile=` / shell 里 export 的值优先级最高）。
 *
 * ## 为什么支持"仓库外的文件"（部署到云必须这么做）
 *
 * `.env.local` 在项目目录里：一来它跟代码同进同出，打包/备份/误提交都可能带出去；
 * 二来任何能读项目目录的进程都能读到它。放到 `/etc/approval/env` 再 `chmod 600`、
 * 属主设成跑服务的账号，才谈得上"只有该服务读得到"。
 * 两种用法都支持，不改代码、只改这个文件放哪：
 *
 *   · systemd（推荐）：`EnvironmentFile=/etc/approval/env` —— 变量直接进进程环境，
 *     本模块读的是同一份，连文件都不必由 node 打开；
 *   · 或者 `export APPROVAL_ENV_FILE=/etc/approval/env` 后启动 —— 由本模块加载。
 *
 * ⚠️ 为什么"加载"要单独抽成模块（历史上的坑）：
 *   ESM 的 import 会在**模块体执行之前**全部求值完（依赖先于使用者）。原来 `loadEnvFile()`
 *   写在 index.ts 的模块体里，而 biSync.ts 是 `import { ... } from './biSync'` 拉进来的 ——
 *   顺序变成 biSync 顶层的 `process.env.X` 先执行（此时 env 还没加载，全是空串）、
 *   index.ts 的模块体后执行（太晚）。症状是"飞书凭据生效了，PB_ADMIN_EMAIL 明明写了却报缺少"。
 *   抽成模块后，只要读取方 `import './env'`，本模块就会被**先**求值，与 import 位置无关。
 */

/** 本次进程实际加载成功的 env 文件（启动日志打印它，便于排查"我改了怎么没生效"） */
export const loadedEnvFiles: string[] = []

const candidates = [
  // ① 显式指定的仓库外文件（生产推荐）
  process.env.APPROVAL_ENV_FILE,
  // ② 约定位置：密钥放仓库之外
  '/etc/approval/env',
  // ③ 本地开发
  '.env.local',
  '.env',
]

for (const file of candidates) {
  if (!file) {
    continue
  }
  try {
    process.loadEnvFile(file)
    loadedEnvFiles.push(file)
  } catch {
    /* 文件不存在（本地没建 / 生产没放）：忽略 —— 缺什么由 server/config.ts 统一校验并报出来 */
  }
}
