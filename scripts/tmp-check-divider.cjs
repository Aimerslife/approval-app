/* 临时：真机确认「同一人连续多环」各环之间不再有分割线 —— 跑完即删 */
const { chromium } = require('./.pwtmp/node_modules/playwright-core')

const BASE = 'http://localhost:5199'
const ORDER = 'PICK-1794377493029' // 第 1、2 环都是同一人（选点探针）

;(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:/Users/10074/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1400 }, deviceScaleFactor: 2 })
  page.on('console', m => { if (m.type() === 'error') console.log('[page error]', m.text()) })

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await page.locator('input[placeholder="请输入邮箱"]').fill('tmp-divider@test.local')
  await page.locator('input[placeholder="密码"]').fill('Tmp-divider-2026')
  await page.locator('button[type="submit"]').click()
  await page.waitForTimeout(3500)
  await page.goto(`${BASE}/approvalPage?order_no=${ORDER}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(5000)

  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim().startsWith('办理'))
    if (btn) btn.click()
  })
  await page.waitForTimeout(1500)

  // 把面板内容区滚到底，让第 2 环进入可视区
  await page.evaluate(() => {
    const panel = document.querySelector('.handle-panel')
    if (!panel) return
    const scroller = [...panel.querySelectorAll('*')].find(el => el.scrollHeight > el.clientHeight + 20)
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
  await page.waitForTimeout(800)

  const state = await page.evaluate(() => {
    const forms = [...document.querySelectorAll('.handle-form')]
    const rect = el => {
      const b = el.getBoundingClientRect()
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) }
    }
    // 两环之间（父表单末尾 → 子表单开头）有没有任何横线类元素
    const parent = forms[0]
    const child = forms[forms.length - 1]
    const between = []
    if (parent && child && parent !== child) {
      const pBottom = parent.getBoundingClientRect().bottom
      const cTop = child.getBoundingClientRect().top
      for (const el of document.querySelectorAll('.handle-panel *')) {
        const b = el.getBoundingClientRect()
        const isLine = b.height <= 4 && b.width > 100 && b.top >= pBottom - 8 && b.top <= cTop + 8
        if (isLine) between.push({ cls: el.className, ...rect(el) })
      }
    }
    return {
      forms: forms.length,
      rects: forms.map(rect),
      linesBetweenSteps: between,
      dockDividers: [...document.querySelectorAll('.handle-panel .v-divider')].map(rect),
    }
  })
  console.log(JSON.stringify(state, null, 1))

  await page.screenshot({ path: 'scripts/divider-check.png', fullPage: false })
  await browser.close()
})().catch(e => {
  console.log('FAILED', e && e.message)
  process.exit(1)
})