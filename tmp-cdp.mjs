const port = 9223
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = list.find(p => p.type === 'page' && p.url.includes('/login'))
if (!page) {
  console.log('NO PAGE', JSON.stringify(list.map(p => [p.type, p.url])))
  process.exit(1)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)

const expr = `(() => {
  const q = s => document.querySelector(s)
  const info = el => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return { w: Math.round(r.width), x: Math.round(r.x), h: Math.round(r.height), flex: cs.flex, minW: cs.minWidth, pad: cs.padding, pos: cs.position, disp: cs.display }
  }
  return JSON.stringify({
    vw: innerWidth,
    docW: document.documentElement.clientWidth,
    page: info(q('.login-page')),
    panel: info(q('.login-panel')),
    form: info(q('.login-panel form')),
    field: info(q('.login-panel .v-field')),
    visual: info(q('.login-visual')),
    img: info(q('.login-page__bg')),
  })
})()`

ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }))
const timer = setTimeout(() => { console.log('TIMEOUT'); process.exit(1) }, 15000)
ws.onmessage = (e) => {
  const d = JSON.parse(e.data)
  if (d.id === 1) {
    clearTimeout(timer)
    console.log(d.result?.result?.value ?? JSON.stringify(d))
    process.exit(0)
  }
}
