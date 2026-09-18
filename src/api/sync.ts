const API_BASE = 'http://localhost:3002/api'
export function triggerContactSync () {
  return fetch(`${API_BASE}/sync-contact`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  }).then(res => res.json())
}
