/**
 * ⚠️ 目前**没有被任何地方 import**（部署检查时发现的遗留文件）。
 *
 * 两个问题，谁要用它之前先解决：
 *   1. 原来写的是 `http://localhost:3002/api` —— 部署到云上这个地址指向**用户自己的电脑**，
 *      必然失败。已改成同源相对路径 `/api`（与 src/api/api.ts 一致，由 nginx / Vite 代理转发）；
 *   2. 服务端**没有** `/api/sync-contact` 这个路由（见 server/index.ts 的路由清单）——
 *      即使地址对了也会 404。要么补服务端实现，要么确认不需要后删掉本文件。
 */
const API_BASE = '/api'

export function triggerContactSync () {
  return fetch(`${API_BASE}/sync-contact`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  }).then(res => res.json())
}
