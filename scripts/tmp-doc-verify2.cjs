/* 探针11：验证追加章节后的文档渲染 + 清理账号（用后即删） */
const path = require('path')
const fs = require('fs')
const PW = require(path.join(__dirname, '.pwtmp', 'node_modules', 'playwright-core', 'index.js'))
const CHROME = 'C:/Users/10074/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const PB = 'http://127.0.0.1:8091'
const APP = 'http://localhost:3001'
const DOC_ID = 'isl7dm7zjdwp8pu'
const OUT = path.join(__dirname, 'doc-verify2.json')

const stamp = Date.now()
const EMAIL = `tmp-dv2-${stamp}@test.local`
const PASSWORD = 'Probe.1234!pw'

async function main () {
  const res = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: 'wy13049303817@163.com', password: 'EJcB2dDPYChcgRTv' }),
  })
  const adminToken = (await res.json()).token
  const cr = await fetch(`${PB}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: adminToken },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, passwordConfirm: PASSWORD, name: '文档验证2' }),
  })
  const uid = (await cr.json()).id
  await fetch(`${PB}/api/collections/users/records/${uid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: adminToken },
    body: JSON.stringify({ verified: true, role: 'approval' }),
  })

  const browser = await PW.chromium.launch({ headless: true, executablePath: CHROME })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  const r = {}
  try {
    await page.goto(APP + '/', { waitUntil: 'networkidle' })
    await page.click('input[placeholder="请输入邮箱"]')
    await page.keyboard.type(EMAIL)
    await page.click('input[placeholder="密码"]')
    await page.keyboard.type(PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForTimeout(3500)

    await page.goto(APP + `/logic?id=${DOC_ID}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(3000)
    r.detail = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll('.md-editor-preview-wrapper img, .v-card img, main img')]
      const heads = [...document.querySelectorAll('h2')].map(h => h.textContent.trim())
      return {
        h1: (document.querySelector('h1') || {}).textContent || null,
        h2: heads,
        imgCount: imgs.length,
        imgLoaded: imgs.filter(i => i.naturalWidth > 0).length,
        codeBlocks: document.querySelectorAll('pre code, pre').length,
        tables: document.querySelectorAll('table').length,
        hasNew: document.body.textContent.includes('模板内板块详解') && document.body.textContent.includes('六类板块卡片'),
      }
    })
    fs.writeFileSync(OUT, JSON.stringify(r, null, 2))
  } finally {
    await browser.close().catch(() => {})
  }
  // 清理本轮 + 可能残留的探针账号
  const q = await fetch(`${PB}/api/collections/users/records?filter=(email~'tmp-')&perPage=50`, { headers: { Authorization: adminToken } })
  const items = (await q.json()).items
  let n = 0
  for (const it of items) {
    const d = await fetch(`${PB}/api/collections/users/records/${it.id}`, { method: 'DELETE', headers: { Authorization: adminToken } })
    if (d.ok || d.status === 404) n++
  }
  r.cleanup = `deleted ${n}/${items.length}`
  fs.writeFileSync(OUT, JSON.stringify(r, null, 2))
}
main().catch(e => { fs.writeFileSync(OUT, JSON.stringify({ fatal: e.message }, null, 2)); process.exit(1) })
