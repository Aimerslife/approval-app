/* 探针5：复现用户窗口，审计「数据行数 vs DOM 行数」与每层裁剪链（用后即删） */
const path = require('path')
const fs = require('fs')
const PW = require(path.join(__dirname, '.pwtmp', 'node_modules', 'playwright-core', 'index.js'))
const CHROME = 'C:/Users/10074/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const PB = 'http://127.0.0.1:8091'
const APP = 'http://localhost:3001'
const OUT = path.join(__dirname, 'probe-model-out5.json')

const stamp = Date.now()
const EMAIL = `tmp-model4-${stamp}@test.local`
const PASSWORD = 'Probe.1234!pw'

async function main () {
  const report = {}
  const res = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: 'wy13049303817@163.com', password: 'EJcB2dDPYChcgRTv' }),
  })
  const adminToken = (await res.json()).token
  const cr = await fetch(`${PB}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: adminToken },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, passwordConfirm: PASSWORD, name: '缺行探针' }),
  })
  const uid = (await cr.json()).id
  await fetch(`${PB}/api/collections/users/records/${uid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: adminToken },
    body: JSON.stringify({ verified: true, role: 'approval' }),
  })

  const browser = await PW.chromium.launch({ headless: true, executablePath: CHROME })
  // 用户截图尺寸 1080x590
  const ctx = await browser.newContext({ viewport: { width: 1080, height: 590 } })
  const page = await ctx.newPage()
  try {
    await page.goto(APP + '/', { waitUntil: 'networkidle' })
    await page.click('input[placeholder="请输入邮箱"]')
    await page.keyboard.type(EMAIL)
    await page.click('input[placeholder="密码"]')
    await page.keyboard.type(PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForTimeout(3500)
    await page.goto(APP + '/approvalModel', { waitUntil: 'networkidle' })
    await page.waitForTimeout(1500)

    const audit = () => page.evaluate(() => {
      const q = s => document.querySelector(s)
      const qa = s => [...document.querySelectorAll(s)]
      const info = el => {
        if (!el) return null
        const cs = getComputedStyle(el)
        const r = el.getBoundingClientRect()
        return {
          h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom),
          overflowY: cs.overflowY, display: cs.display, flexDir: cs.flexDirection,
          minH: cs.minHeight, flex: cs.flex, ch: el.clientHeight, sh: el.scrollHeight,
        }
      }
      const table = q('.model-sheet-scroll > .model-table')
      const wrapper = table ? table.querySelector('.v-table__wrapper') : null
      const inner = table ? table.querySelector('.v-data-table__table') : null
      const groups = qa('.model-group').map(g => ({
        name: g.querySelector('.model-group__name') ? g.querySelector('.model-group__name').textContent.trim() : '?',
        top: Math.round(g.getBoundingClientRect().top), h: Math.round(g.getBoundingClientRect().height),
      }))
      return {
        tabCount: qa('.sheet-tabs .v-tab').map(t => t.textContent.trim()),
        groupHeads: groups,
        dataRowCount: qa('.model-sheet-scroll > .model-table tbody tr').length,
        scroll: info(q('.model-sheet-scroll')),
        table: info(table),
        wrapper: info(wrapper),
        inner: info(inner),
        drop: info(q('.model-new-section')),
        bar: info(q('.sheet-tab-bar')),
        bodyCh: document.body.clientHeight, bodySh: document.body.scrollHeight,
        winH: window.innerHeight,
      }
    })

    report.win590 = await audit()

    // wrapper 滚到底再测
    await page.evaluate(() => {
      const w = document.querySelector('.model-sheet-scroll > .model-table .v-table__wrapper')
      if (w) w.scrollTop = 99999
    })
    await page.waitForTimeout(300)
    report.afterScroll = await page.evaluate(() => {
      const w = document.querySelector('.model-sheet-scroll > .model-table .v-table__wrapper')
      const rows = [...document.querySelectorAll('.model-sheet-scroll > .model-table tbody tr')]
      return {
        wrapperScrollTop: w ? Math.round(w.scrollTop) : null,
        lastRowText: rows.length ? rows[rows.length - 1].textContent.trim().slice(0, 30) : null,
        lastRowBottom: rows.length ? Math.round(rows[rows.length - 1].getBoundingClientRect().bottom) : null,
      }
    })

    // 换大窗口 1920x937 复测
    await page.setViewportSize({ width: 1920, height: 937 })
    await page.waitForTimeout(500)
    report.win937 = await audit()

    fs.writeFileSync(OUT, JSON.stringify(report, null, 2))
  } finally {
    await browser.close().catch(() => {})
  }
}
main().catch(e => { fs.writeFileSync(OUT, JSON.stringify({ fatal: e.message, stack: e.stack }, null, 2)); process.exit(1) })
