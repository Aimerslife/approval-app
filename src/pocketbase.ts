import PocketBase from 'pocketbase'

// PocketBase 服务地址。
// 默认用当前站点 origin（同源请求走 Vite 代理 /api → 8091，见 vite.config.mts），
// 避免浏览器直连 8091 触发 CORS；
// 部署时若 PB 与前端不同域，再通过 VITE_PB_URL 显式指定绝对地址并配置 PB 的 CORS。
const PB_URL = import.meta.env.VITE_PB_URL || window.location.origin
export const pb = new PocketBase(PB_URL)

/**
 * PocketBase **自带后台**（数据浏览 / 集合管理 / 日志）的地址 —— 顶栏「Collection」入口跳这里。
 *
 * ## 同一个实例，不需要第二个 PB
 *
 * v0.39 的 PB 把后台界面与数据 API 放在**同一个进程、同一个端口**上，只是路径不同：
 *   · `/api/`  —— 数据接口（应用平时用的就是它）；
 *   · `/_/`    —— 后台界面（超管账号登录）。
 * 所以"跳到我的 PB 数据库"就是打开 `/_/`，不必额外部署一个只用来管库的实例。
 *
 * ## 为什么按**同源**拼、不写死主机端口
 *
 * 开发时前端在 3001、PB 在 8091，直接拼 `http://127.0.0.1:8091/_/` 会把地址写死在代码里
 * （换域名 / 换端口就要改代码）。这里用相对路径 `/_/`，由代理把前缀转到 PB：
 *   · 开发：vite.config.mts 里 `/_/` → 8091（与 /api、/files 同一套）；
 *   · 生产：反向代理同样加一条 `/_/`（或给 PB 配 `--http` 同域）。
 * 若显式配了 `VITE_PB_URL`（PB 与前端不同域），就按它的绝对地址拼 —— 那种情况下
 * 后台是同源还是跨域都无所谓：浏览器**顶层导航**不受 CORS 限制（只是拿不到同源便利）。
 */
export const PB_ADMIN_URL = new URL('/_/', PB_URL).href

pb.authStore.loadFromCookie(document.cookie)

// 监听登录状态变化，同步写入cookie（页面刷新保持登录）
pb.authStore.onChange((token, model) => {
  document.cookie = pb.authStore.exportToCookie({ httpOnly: false })
})

export default pb
