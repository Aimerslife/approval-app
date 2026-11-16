/**
 * 【临时探针】找 flex-basis:0% 的来源规则（跑完即删）
 * 登录 → /mockRun → 遍历 stylesheet 找「匹配 alert 且含 flex-basis/flex 简写」的规则
 */
import { readFileSync } from 'node:fs'
import pw from 'file:///D:/project/vuetify_approval/vite-project/approval-app/scripts/.pwtmp/node_modules/playwright-core/index.js'

const ROOT = 'D:/project/vuetify_approval/vite-project/approval-app'
const APP = 'http://localhost:3001'

const env = Object.fromEntries(
  readFileSync(`${ROOT}/.env.local`, 'utf8')
    .split(/\r?\n/)
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => {
      const i = l.indexOf('=')
      const raw = l.slice(i + 1).trim()
      const val = (raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")) ? raw.slice(1, -1) : raw
      return [l.slice(0, i).trim(), val]
    }),
)
const PB = env.PB_URL || 'http://127.0.0.1:8091'
const stamp = Date.now()
const EMAIL = `tmp-fixmock3-${stamp}@test.local`
const PASSWORD = 'TmP!fix3pass'

async function api (path, opts = {}, token) {
  const res = await fetch(new URL(path, PB), {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}), ...opts.headers },
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

const auth = await api('/api/collections/_superusers/auth-with-password', {
  method: 'POST',
  body: JSON.stringify({ identity: env.PB_ADMIN_EMAIL, password: env.PB_ADMIN_PASSWORD }),
})
const adminToken = auth.body?.token
if (!adminToken) throw new Error(`admin 登录失败 HTTP ${auth.status}`)

const created = await api('/api/collections/users/records', {
  method: 'POST',
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, passwordConfirm: PASSWORD, name: '溢出探针3', open_id: `tmp-fixmock3-${stamp}`, role: 'approval' }),
})
const probeUserId = created.body?.id
if (!probeUserId) throw new Error(`建号失败: ${JSON.stringify(created.body)}`)
await api(`/api/collections/users/records/${probeUserId}`, {
  method: 'PATCH',
  body: JSON.stringify({ verified: true, role: 'approval' }),
}, adminToken)

const browser = await pw.chromium.launch({
  executablePath: 'C:/Users/10074/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  headless: true,
})
try {
  const page = await browser.newPage({ viewport: { width: 1084, height: 700 } })
  await page.goto(`${APP}/`)
  await page.waitForSelector('input[placeholder="请输入邮箱"]', { timeout: 15000 })
  await page.click('input[placeholder="请输入邮箱"]')
  await page.keyboard.type(EMAIL)
  await page.click('input[placeholder="密码"]')
  await page.keyboard.type(PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForSelector('input[placeholder="请输入邮箱"]', { state: 'hidden', timeout: 15000 })

  await page.goto(`${APP}/mockRun`)
  await page.waitForSelector('.mock-context', { timeout: 20000 })
  await page.waitForTimeout(800)

  const rules = await page.evaluate(() => {
    const alerts = Array.from(document.querySelectorAll('.v-alert'))
    const target = alerts[alerts.length - 1]
    const hits = []
    for (const sheet of document.styleSheets) {
      let list
      try { list = sheet.cssRules } catch { continue }
      const walk = (items, media) => {
        for (const rule of items) {
          if (rule.style) {
            // 普通样式规则（新浏览器 CSSStyleRule 也有 cssRules——嵌套子规则，别被它骗去递归跳过）
            let matched = false
            try { matched = target.matches(rule.selectorText) } catch { continue }
            if (!matched) continue
            const t = rule.style.cssText ?? ''
            if (/flex-basis|flex:|flex-shrink|flex-grow|height|min-height/.test(t)) {
              hits.push(`[${media ?? ''}] ${rule.selectorText} => ${t.slice(0, 220)}`)
            }
          } else if (rule.cssRules) {
            walk(rule.cssRules, rule.conditionText ?? media)
          }
        }
      }
      walk(list, null)
    }
    return hits.join('\n')
  })
  console.log(rules)

  const rect = await page.evaluate(() => {
    const alerts = Array.from(document.querySelectorAll('.v-alert'))
    const t = alerts[alerts.length - 1]
    const r = t.getBoundingClientRect()
    const cs = getComputedStyle(t)
    return { h: Math.round(r.height), w: Math.round(r.width), flex: cs.flex, ovf: `${cs.overflowX}/${cs.overflowY}` }
  })
  console.log('ALERT:', JSON.stringify(rect))
  await page.screenshot({ path: 'D:/project/vuetify_approval/vite-project/approval-app/scripts/fixmock4.png', fullPage: false })
} finally {
  try { await browser.close() } catch {}
  if (probeUserId && adminToken) {
    await api(`/api/collections/users/records/${probeUserId}`, { method: 'DELETE' }, adminToken)
  }
  console.log('cleanup done')
}
