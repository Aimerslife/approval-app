// 临时探针：通过 CDP 从背景图往上走一遍祖先链，打印每层的盒子与关键样式。用完即删。
const CDP = 'http://127.0.0.1:9224'

async function waitForTarget () {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`${CDP}/json`)).json()
      const page = list.find(t => t.type === 'page' && t.url.includes('/login'))
      if (page) return page
    } catch { /* 端口还没起来 */ }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error('没等到调试目标')
}

const page = await waitForTarget()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let seq = 0
const pending = new Map()
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data)
  const slot = pending.get(msg.id)
  if (slot) { pending.delete(msg.id); slot(msg.result) }
})
const send = (method, params = {}) => new Promise(resolve => {
  const id = ++seq
  pending.set(id, resolve)
  ws.send(JSON.stringify({ id, method, params }))
})
const evaluate = expression => send('Runtime.evaluate', { expression, returnByValue: true })

await new Promise(r => ws.addEventListener('open', r))
await send('Page.enable')
// 开发服务器首次访问要现编一堆模块：轮询到应用挂载为止
for (let i = 0; i < 90; i++) {
  const probe = await evaluate('!!document.querySelector(".v-img")')
  if (probe.result?.value === true) break
  await new Promise(r => setTimeout(r, 1000))
}

const expression = `(() => {
  const out = []
  let el = document.querySelector('.v-img')
  const seen = new Set()
  while (el && !seen.has(el)) {
    seen.add(el)
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 70),
      rect: [r.x, r.y, r.width, r.height].map(v => Math.round(v)).join(','),
      width: cs.width + ' max=' + cs.maxWidth + ' min=' + cs.minWidth,
      margin: [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].join(' '),
      padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].join(' '),
      disp: cs.display + ' pos=' + cs.position,
      flex: cs.flex + ' jc=' + cs.justifyContent + ' ai=' + cs.alignItems + ' gap=' + cs.gap,
      box: cs.boxSizing,
    })
    el = el.parentElement
  }
  return JSON.stringify({
    viewport: [window.innerWidth, window.innerHeight],
    dpr: window.devicePixelRatio,
    row: (() => { const e = document.querySelector('.v-row'); if (!e) return null; const c = getComputedStyle(e); return { gap: c.gap, w: e.getBoundingClientRect().width, jc: c.justifyContent, disp: c.display } })(),
    chain: out,
  }, null, 1)
})()`
const evaluated = await evaluate(expression)
console.log(evaluated.result?.value ?? JSON.stringify(evaluated))
ws.close()
process.exit(0)
