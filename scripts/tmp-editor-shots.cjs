/* 探针9：模板编辑器（createStream）文档配图截图（用后即删） */
const path = require('path')
const fs = require('fs')
const PW = require(path.join(__dirname, '.pwtmp', 'node_modules', 'playwright-core', 'index.js'))
const CHROME = 'C:/Users/10074/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe'
const PB = 'http://127.0.0.1:8091'
const APP = 'http://localhost:3001'
const OUTDIR = path.join(__dirname, 'docshots')

const stamp = Date.now()
const EMAIL = `tmp-ed-${stamp}@test.local`
const PASSWORD = 'Probe.1234!pw'

async function main () {
  fs.mkdirSync(OUTDIR, { recursive: true })
  const res = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: 'wy13049303817@163.com', password: 'EJcB2dDPYChcgRTv' }),
  })
  const adminToken = (await res.json()).token
  const cr = await fetch(`${PB}/api/collections/users/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: adminToken },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, passwordConfirm: PASSWORD, name: '文档截图' }),
  })
  const uid = (await cr.json()).id
  await fetch(`${PB}/api/collections/users/records/${uid}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: adminToken },
    body: JSON.stringify({ verified: true, role: 'approval' }),
  })

  // 取一张正本模板 id
  const tq = await fetch(`${PB}/api/collections/app_chain/records?perPage=50`, { headers: { Authorization: adminToken } })
  const tpl = (await tq.json()).items.find(x => !(x.name || '').includes('- 副本'))
  if (!tpl) throw new Error('no template')

  const browser = await PW.chromium.launch({ headless: true, executablePath: CHROME })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 }, deviceScaleFactor: 1.5 })
  const page = await ctx.newPage()
  const r = { tpl: tpl.name }
  try {
    await page.goto(APP + '/', { waitUntil: 'networkidle' })
    await page.click('input[placeholder="请输入邮箱"]')
    await page.keyboard.type(EMAIL)
    await page.click('input[placeholder="密码"]')
    await page.keyboard.type(PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForTimeout(3500)

    await page.goto(APP + '/createStream?id=' + tpl.id, { waitUntil: 'networkidle' })
    await page.waitForSelector('.vue-flow__node-approval', { timeout: 15000 })
    await page.waitForTimeout(1500)

    // 隐藏探针账号痕迹
    await page.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let n
      while ((n = walker.nextNode())) {
        if (n.textContent.includes('@test.local')) n.textContent = 'admin@local'
        else if (n.textContent.includes('文档截图')) n.textContent = '管理员'
      }
    })

    r.nodes = await page.evaluate(() => {
      const all = [...document.querySelectorAll('.vue-flow__node')]
      const byType = {}
      all.forEach(el => { const t = [...el.classList].find(c => c.startsWith('vue-flow__node-') && c !== 'vue-flow__node'); byType[t] = (byType[t] || 0) + 1 })
      return { total: all.length, byType, edges: document.querySelectorAll('.vue-flow__edge').length }
    })
    await page.screenshot({ path: path.join(OUTDIR, 'editor-overview.jpeg'), type: 'jpeg', quality: 80 })

    // 点审批节点卡片上的分支名 → 打开分支配置面板（VueFlow transform 布局，用页面内原生点击绕开视口检查）
    await page.evaluate(() => {
      const el = document.querySelector('.vue-flow__node-approval .branch-item')
      if (el) el.click()
    })
    await page.waitForTimeout(800)
    r.panel = await page.evaluate(() => {
      const panel = document.querySelector('.branch-panel')
      if (!panel) return null
      return {
        title: (panel.querySelector('.panel-title') || {}).textContent?.trim() || null,
        rows: panel.querySelectorAll('.panel-row').length,
        hasCond: !!panel.querySelector('.cond-group, .panel-row select'),
      }
    })
    await page.screenshot({ path: path.join(OUTDIR, 'editor-branch.jpeg'), type: 'jpeg', quality: 80 })

    fs.writeFileSync(path.join(OUTDIR, 'editor-shots.json'), JSON.stringify(r, null, 2))
  } finally {
    await browser.close().catch(() => {})
  }
}
main().catch(e => { fs.writeFileSync(path.join(OUTDIR, 'editor-shots.json'), JSON.stringify({ fatal: e.message, tpl: null }, null, 2)); process.exit(1) })
