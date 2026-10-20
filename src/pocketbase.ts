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

/**
 * ## ⚠️ 自动取消：同一集合的并发**清单**请求会互相顶掉
 *
 * SDK 默认开着自动取消：发新请求前会 `cancelRequest(key)`，把**同键的旧请求 abort 掉**，
 * 键取 `requestKey || method + path`。坑在这个 path 是 `baseCrudPath`
 * （`/api/collections/<集合>/records`）—— **不含查询串**，于是
 * **同一集合的并发 GET 清单请求，不管 sort / filter 是否相同，都会互相取消**
 * （`getFullList` / `getList` / `getFirstListItem` 都走这条路，源码里 `getList` 就是
 * `send(this.baseCrudPath, options)`）。
 *
 * 后果很隐蔽：被 abort 的那条抛错，而项目里这些读函数**大都 catch 成空结果**
 * （见 collection.ts 的 `return []`、approvalTypeStore 的"按没有覆盖处理"），
 * 于是页面上只看到"数据莫名空白 / 覆盖莫名全变回默认"，**一条报错都没有**。
 * 已经踩过一次：模板管理页同时读 `getApproval`（表格）与 `getApprovalOptions`（下拉），
 * 从审批类型详情页返回时两个请求恰好并发，表格整块空白。
 *
 * 所以：**同一集合、不同用途的清单读取，各自显式给一个 `requestKey`**——
 * 全部键登记在 `utils/pbRequestKeys`（那里也是新增读入口时该去看的第一处）。
 *   · 不同用途 → 键不同 → 互不打扰；
 *   · 同一用途重复发（连点两次）→ 键相同 → 旧的仍被取消，这正是 SDK 的初衷
 *     （别让先发的旧结果盖住后发的新结果）；
 *   · 同一用途但**参数不同**（按 scope 读、按集合读探针）→ 键里要带上那个参数，
 *     否则两个不同条件会互相取消（见 pbRequestKeys 里的两个 `xxxKey()` 函数）。
 *
 * `getOne` 不用管：path 带 id，天然不撞。`getFirstListItem` 也不用管：
 * SDK 自己按 filter 生成了键（源码里的 `one_by_filter_<path>_<filter>`）。
 */
/**
 * 登录态 cookie 的写入属性。
 *
 * ⚠️ `secure` **必须显式给**：SDK 的 `exportToCookie()` 默认值是
 * `{ secure: true, sameSite: true, httpOnly: true, path: "/" }`
 * （见 node_modules/pocketbase/dist/pocketbase.es.mjs 里的 defaults），
 * 而浏览器**只在安全上下文里接受带 `Secure` 的 cookie** —— https 或 **localhost**。
 *
 * 于是部署到 `http://<IP 或域名>` 时这个 cookie 会被**静默丢弃**
 * （`document.cookie = ...` 不报错、控制台没有任何提示），
 * `loadFromCookie()` 刷新后读到空 → `authStore.isValid` 为 false →
 * 路由守卫把用户送去 `/login`。表现正是「登录后能正常用，一按 F5 就回登录页」。
 *
 * 本地开发永远复现不出来：`http://localhost` 被浏览器当作可信来源，Secure cookie 特例放行。
 */
const AUTH_COOKIE_OPTIONS = {
  // 必须 false：这个 cookie 由 JS 读写（loadFromCookie / document.cookie），
  // httpOnly 的 cookie 在 document.cookie 里读不到，登录态就恢复不了。
  httpOnly: false,
  // 按当前协议自适应：https 下带 Secure，http 下不带（带了必被浏览器丢弃）。
  secure: location.protocol === 'https:',
}

pb.authStore.loadFromCookie(document.cookie)

// 监听登录状态变化，同步写入cookie（页面刷新保持登录）
pb.authStore.onChange(() => {
  document.cookie = pb.authStore.exportToCookie(AUTH_COOKIE_OPTIONS)
})

export default pb
