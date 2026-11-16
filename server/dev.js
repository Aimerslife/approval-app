/**
 * 开发栈入口（package.json 的 `dev` 脚本指向这里）。
 *
 * ## 为什么套一层护栏
 *
 * `yarn dev` 用 concurrently 同起三个端口：PB(8091) / vite(3001) / app server(3002)。
 * 当**上一套还没停**（窗口关了进程树仍存活，或 PB 被单独跑着）再跑一次时，必然连环翻车：
 *   · PocketBase bind 8091 失败退出 → concurrently -k 把刚要起来的 vite/server 一起拖死，
 *     看到的只是干巴巴的「bind: Only one usage of each socket address」；
 *   · 更糟的是 vite 没开 strictPort，3001 被占时它**静默漂到 3003** ——
 *     而 PocketBase 的 CORS origins 只放行 http://localhost:3001，
 *     就算起来了，页面上所有请求也全是 CORS 失败，排查起来更绕。
 *
 * 所以入口先做一次守卫：8091 已经有健康的 PocketBase 在服务 → 明确告知「复用现有实例或先停掉」
 * 再退出（exit 1），绝不半路互杀；8091 是**别的程序**占用 → 照常放行，让 bind 错误自然暴露
 * （那才是真正的端口冲突，不该被吞掉）。
 *
 * 守卫通过后再拉起原来的 concurrently 三件套，行为与从前完全一致。
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

/** PocketBase 端口（与 `pb` 脚本的 --http 参数保持一致） */
const PB_PORT = 8091

/** 8091 上是否已经有健康的 PocketBase 在服务（/api/health 应答 200） */
async function pbAlive () {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 1500)
  try {
    const res = await fetch(`http://127.0.0.1:${PB_PORT}/api/health`, { signal: ctrl.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

if (await pbAlive()) {
  console.log([
    '',
    `⛔ 端口 ${PB_PORT} 已经有一个 PocketBase 在服务 —— 多半是上一次的 dev 栈还没停干净`,
    '   （Windows 下直接关窗口并不会结束 concurrently 的进程树），或者 PB 被单独跑着。',
    '',
    '   再跑一次 yarn dev 只会连环翻车：vite 悄悄漂到别的端口（超出 PB 的 CORS 白名单，',
    '   页面请求全失败）、app server EADDRINUSE，然后 concurrently -k 把一切拖死。',
    '',
    '   二选一：',
    '   · 复用现有实例 —— 直接打开 http://localhost:3001 （若 vite 也还活着）；',
    `   · 停掉旧栈再跑 —— taskkill /IM pocketbase.exe /F 之后照常 yarn dev`,
    '     （vite / app server 通常会随进程树一起消失，若仍在请按同样方式停掉 node）。',
    '',
  ].join('\n'))
  process.exit(1)
}

// concurrently 的 bin 位置从它自己的 package.json 解析，不硬编码路径
const pkg = require('concurrently/package.json')
const bin = path.join(
  path.dirname(require.resolve('concurrently/package.json')),
  typeof pkg.bin === 'string' ? pkg.bin : pkg.bin.concurrently,
)

// 注意不能用 spawn(cmd串, {shell:true})：cmd 对带引号的 .js bin 走「文件关联」而不是 node，
// 行为随机器关联配置漂移。直接用 node 解释 bin，参数走数组，跨 shell 稳定。
const child = spawn(process.execPath, [
  bin,
  '-k', '-n', 'PB,VUE,SRV', '-c', 'blue,green,yellow',
  'yarn pb', 'yarn dev:vite', 'yarn dev:server',
], { stdio: 'inherit' })
child.on('error', (e) => {
  console.error(`无法启动 concurrently（${bin}）：${e.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  // Ctrl+C 在 Windows 控制台是发给整个进程组的，concurrently 收到后退出，这里跟着收尾
  process.exit(code ?? (signal ? 1 : 0))
})
