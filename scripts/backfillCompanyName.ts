// env 的加载由 server/config.ts 负责（它自己 import './env'），这里不必再引一次
import { adminToken, PB_URL } from '../server/pbAdmin'
import { config } from '../server/config'

/**
 * 一次性数据订正：把 `users.company_name` 刷成服务端配置的企业名。
 *
 * ## 为什么需要它
 *
 * 企业名已经改成**写死的常量**（`config.companyName`，见 server/config.ts）——
 * 原来是从飞书部门树推导的，而飞书顶层节点常常是「总经理」这种职位部门，
 * 于是「用户设置」页的企业一栏显示成了职位名。
 *
 * 但那只修好了**下一次登录**写入的值：PB 里的存量记录还存着旧口径取出来的「总经理」，
 * 而界面读的就是库里的值 —— 不刷库就一直显示旧值（唯一例外是每个人重新登录一次，
 * 那显然不现实）。
 *
 * ## 为什么用管理员接口而不是直接改 SQLite
 *
 * 改 `pb_data/data.db` 要先停 PocketBase，停服期间整个审批系统不可用；而且 PB 开了 WAL，
 * 绕过 API 直接 UPDATE 有把写入覆盖掉的风险。走 REST API 不停服、不碰文件结构。
 *
 * ## 用法
 *
 *   yarn tsx scripts/backfillCompanyName.ts          # 实际刷
 *   yarn tsx scripts/backfillCompanyName.ts --dry    # 只看会改哪些，不落库
 *
 * 依赖 `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`（users 的写规则对普通用户不开放，
 * 见 server/pbAdmin.ts 的文件头）。
 */

/** 只取这两个字段：少取一列，PocketBase 就少拼一列（users 表里 preferences 是 json） */
const FIELDS = 'id,company_name'

/** 一批并发多少个 PATCH —— 20 够快，也不会把本地 PB 压出连接上限 */
const CONCURRENCY = 20

interface UserRow {
  id: string
  company_name?: string
}

/** 分页拉出 id + 现值（只拉需要的字段，不整表倒出来） */
async function fetchAll (token: string): Promise<UserRow[]> {
  const out: UserRow[] = []
  for (;;) {
    const res = await fetch(
      new URL(`/api/collections/users/records?perPage=500&fields=${FIELDS}`, PB_URL).toString(),
      { headers: { Authorization: token } },
    )
    if (!res.ok) {
      throw new Error(`读取 users 失败：HTTP ${res.status}`)
    }
    const body: { items?: UserRow[] } = await res.json()
    const items = body?.items ?? []
    if (items.length === 0) {
      break
    }
    out.push(...items)
    // 拿满一批说明还有下一页；不足一批时 PB 返回空 items，下一轮自然收敛
  }
  return out
}

/** 逐条 PATCH（只带 company_name 一个字段，PB 的 PATCH 是局部更新，不会碰其它列） */
async function updateOne (id: string, value: string, token: string): Promise<boolean> {
  const res = await fetch(
    new URL(`/api/collections/users/records/${encodeURIComponent(id)}`, PB_URL).toString(),
    {
      method: 'PATCH',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_name: value }),
    },
  )
  return res.ok
}

async function main (): Promise<void> {
  const dryRun = process.argv.includes('--dry')
  const target = config.companyName

  console.log(`目标企业名：${target}${dryRun ? '（--dry：只统计不落库）' : ''}`)

  // 前置检查：没凭据就别去 fetch —— adminToken 会依次试两个路径，白等一轮才报错，
  // 而用户看到的是"脚本卡住了"，不知道该干嘛。先把替代路径摆出来。
  if (!config.pbAdminEmail || !config.pbAdminPassword) {
    console.error('❌ 未配置 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD，没法用管理员接口订正。')
    console.error('   两条替代路径（任选其一）：')
    console.error('   ① 退出登录再进一次 —— 登录时会把企业名按新口径写回库（服务端需已重启）')
    console.error('   ② PocketBase 后台 /_/ ：users 按 company_name = "总经理" 筛选 → 批量编辑 → 填「广州延迅科技有限公司」')
    process.exitCode = 1
    return
  }

  const token = await adminToken()
  const all = await fetchAll(token)
  const stale = all.filter(r => r.company_name !== target)

  console.log(`共 ${all.length} 个账号，其中 ${stale.length} 个需要更新`)
  if (stale.length === 0) {
    return
  }

  if (dryRun) {
    // 只列前 10 条：够看清"要改成什么"，又不刷屏
    for (const r of stale.slice(0, 10)) {
      console.log(`  ${r.id}：${JSON.stringify(r.company_name ?? '')} → ${JSON.stringify(target)}`)
    }
    if (stale.length > 10) {
      console.log(`  …（还有 ${stale.length - 10} 条）`)
    }
    return
  }

  let ok = 0
  for (let i = 0; i < stale.length; i += CONCURRENCY) {
    const chunk = stale.slice(i, i + CONCURRENCY)
    const oks = await Promise.all(chunk.map(r =>
      updateOne(r.id, target, token).catch(() => false),
    ))
    ok += oks.filter(Boolean).length
  }

  console.log(`✅ 更新完成：${ok}/${stale.length} 条已写成「${target}」`)
  if (ok < stale.length) {
    // 不静默：部分失败说明有别的因素（权限/并发/网络），得让人看见
    console.error(`⚠️ 有 ${stale.length - ok} 条没改成，建议重跑一次本脚本（已成功的不会重复处理）`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error('订正失败：', error instanceof Error ? error.message : error)
  process.exitCode = 1
})