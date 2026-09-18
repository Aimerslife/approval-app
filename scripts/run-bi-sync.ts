/**
 * run-bi-sync.ts
 *
 * 直接跑一次 BI → bi_rows 的同步（不走 HTTP 服务，便于在终端里看完整输出）。
 *
 * 用法：
 *   npx tsx scripts/run-bi-sync.ts            # 默认 dryRun：只拉数据、只报差异，不写库
 *   npx tsx scripts/run-bi-sync.ts --write    # 真正写库
 *   npx tsx scripts/run-bi-sync.ts --write --prune   # 顺带删掉 BI 已不再返回的行
 *
 * 约定：**默认不写库**。要先看 dryRun 的输出确认两件事再写：
 *   1) conflicts 为空（SKU 唯一，否则 upsert 会互相覆盖）；
 *   2) created/updated 的量级符合预期。
 *
 * 环境变量（可用 .env.local 提供，见下方 loadEnv）：
 *   BI_ACCESS_KEY_ID / BI_ACCESS_KEY_SECRET（或 VITE_ACCESSKEYID / VITE_ACCESSKEYSECRET）
 *   PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD    ← bi_rows 只有管理员可写
 *   BI_COMPONENT_ID / PB_URL / BI_BASE_URL 可选
 */
import fs from 'node:fs'

/**
 * 把 .env.local / .env 读进 process.env。
 * 服务端脚本由 tsx 直接跑，**不会**像 Vite 那样自动加载 .env —— 所以这里手动读一次，
 * 这样已经在 .env.local 里的 BI 凭据可以直接复用，不用再配一份。
 */
function loadEnv (files = ['.env.local', '.env']): string[] {
  const loaded: string[] = []
  for (const file of files) {
    if (!fs.existsSync(file)) {
      continue
    }
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][\w.]*)\s*=\s*(.*?)\s*$/i)
      if (!m || line.trim().startsWith('#')) {
        continue
      }
      const value = m[2].replace(/^["']|["']$/g, '')
      // 不覆盖已存在的环境变量，便于命令行临时指定覆盖 .env
      if (process.env[m[1]] === undefined) {
        process.env[m[1]] = value
      }
    }
    loaded.push(file)
  }
  return loaded
}

const loadedFiles = loadEnv()
console.log(`[run-bi-sync] 读到的 env 文件: ${loadedFiles.join(', ') || '（无）'}`)

/**
 * ⚠️ 必须用**动态 import**，不能把 biSync 写在文件顶部的静态 import。
 *
 * ESM 的静态 import 会被提升到整个模块之前执行 —— 那样 biSync.ts 顶层的
 * `const BI_ACCESS_KEY_ID = process.env.BI_ACCESS_KEY_ID || process.env.VITE_ACCESSKEYID`
 * 会在 loadEnv() 之前跑完，环境变量读到的是空值，
 * 表现就是「日志说凭据已配置，但同步报缺少 BI_ACCESS_KEY_ID」。
 * （第一次跑正是这么挂的。）放这里才能保证读到上面刚写进 process.env 的值。
 */
const { syncBiRows } = await import('../server/biSync')

const args = new Set(process.argv.slice(2))
const write = args.has('--write')
const prune = args.has('--prune')

const email = process.env.PB_ADMIN_EMAIL
const hasSecret = !!process.env.PB_ADMIN_PASSWORD

console.log(`[run-bi-sync] 模式: ${write ? '写库（--write）' : 'dryRun（只读，不会写库）'}${prune ? ' + prune' : ''}`)
console.log(`[run-bi-sync] PB 管理员: ${email ? email : '❌ 未配置 PB_ADMIN_EMAIL'}`)
console.log(`[run-bi-sync] PB 管理员密码: ${hasSecret ? '已配置' : '❌ 未配置 PB_ADMIN_PASSWORD'}`)
console.log(`[run-bi-sync] BI 凭据: ${process.env.BI_ACCESS_KEY_ID || process.env.VITE_ACCESSKEYID ? '已配置' : '❌ 缺失'}`)
console.log('')

if (write && (!email || !hasSecret)) {
  console.error('❌ 要写库必须提供 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD（bi_rows 是「仅管理员可写」）')
  console.error('   dryRun 不需要管理员，可以先跑一次不带 --write 的。')
  process.exit(1)
}

try {
  const summary = await syncBiRows(process.env.BI_COMPONENT_ID, { dryRun: !write, prune })
  console.log('')
  console.log('===== 同步结果 =====')
  console.log(JSON.stringify(summary, null, 2))

  if (summary.conflicts.length > 0) {
    console.log('')
    console.log(
      `⚠️ 有 ${summary.conflicts.length} 组「同 key 不同内容」的行。本次按「先到者保留」处理`
      + `（每组只写入第一条），所以唯一索引不会报冲突、写入是安全的。\n`
      + `   若这个数字持续增长，说明 sync_key 还缺维度 —— 看上面「差异列」清单里的**维度列**`
      + `（度量列如总库存数量/金额几乎每组都不同，计数最高但那是噪声）。`,
    )
  }
  if (summary.unmappedColumns.length > 0) {
    console.log('')
    console.log('⚠️ 有未入库的列（数据仍在 data 里）: ' + summary.unmappedColumns.join(', '))
  }
} catch (error: any) {
  console.error('')
  console.error('❌ 同步失败: ' + (error?.message ?? error))
  process.exit(1)
}
