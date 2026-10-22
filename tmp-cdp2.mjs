const list = await (await fetch('http://127.0.0.1:9223/json')).json()
const page = list.find(p => p.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise(r => ws.onopen = r)
const expr = `JSON.stringify({ href: location.href, title: document.title, bodyLen: document.body.innerHTML.length, head: document.body.innerHTML.slice(0, 600), cls: Array.from(document.querySelectorAll('div')).slice(0, 6).map(d => d.className) })`
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }))
ws.onmessage = (e) => {
  const d = JSON.parse(e.data)
  if (d.id === 1) {
    console.log(d.result?.result?.value ?? JSON.stringify(d))
    process.exit(0)
  }
}
