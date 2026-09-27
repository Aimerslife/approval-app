/**
 * 前端权限的**唯一事实源**。
 *
 * 为什么要有这个文件：在此之前，`users.role` 只在「角色设置」页里读写，
 * 别处**没有任何地方消费它** —— 没有守卫、没有菜单过滤，等于没有权限管理。
 * 这里把「角色 → 能去哪」收敛成一张表，**路由守卫和侧边栏菜单共用它**，
 * 避免"菜单藏了但直链能进"或"守卫拦了但菜单还在"这类两处口径不一致的问题。
 *
 * 数据来源：`users.role`（text 字段，PB 迁移 1788261869 新增 / 1789118612 设默认 `normal`）。
 */

/**
 * 权限档位（即 `users.role` 里存的值）。
 * 与「角色设置」页 `roleSetting.vue` 的 roleList 一一对应：
 *   superAdmin = 超级管理员 / approval = 管理员 / normal = 一般员工
 */
export type AppRole = 'superAdmin' | 'approval' | 'normal'

/** 档位中文名（提示文案 / 日志用） */
export const ROLE_LABELS: Record<AppRole, string> = {
  superAdmin: '超级管理员',
  approval: '管理员',
  normal: '一般员工',
}

/**
 * 把 `users.role` 的原始值收敛成三档。
 *
 * ⚠️ 未知值、空值、字段没设（历史用户）**一律按最低档** `normal` 处理 ——
 *    权限判断必须 fail-closed：宁可少给，不能因为数据脏就放行。
 */
export function normalizeRole (raw?: string | null): AppRole {
  return raw === 'superAdmin' || raw === 'approval' ? raw : 'normal'
}

/** 三档都有权限的路由（写全，避免下面重复） */
const ALL_ROLES: AppRole[] = ['superAdmin', 'approval', 'normal']
/** 管理员及以上（超级管理员 + 管理员） */
const ADMIN_UP: AppRole[] = ['superAdmin', 'approval']

/**
 * 路由路径 → 允许的档位。
 *
 * 口径（按需求）：
 *   · 超级管理员：全部，含「角色设置」；
 *   · 管理员：除「角色设置」外全部；
 *   · 一般员工：我的审批单 / 分析 / 数据 / 设置 / 说明文档
 *     （外加从"我的审批单"点进去的审批详情页，否则员工连自己的单子都打不开）。
 *
 * ⚠️ 未列出的路由**不拦**：宁可漏拦一个新页面，也不要因为忘了登记就把人锁在外面。
 *    新增页面时，请在这里补一行。
 * ⚠️ 键必须与 `router/index.ts` 里的 `path` **完全一致**（如子路由是 `/home/newStream`）。
 */
const ROUTE_ROLES: Record<string, AppRole[]> = {
  // 只有超级管理员
  '/roleSetting': ['superAdmin'],

  // 管理员及以上（编排审批流、看全部单据）
  '/home': ADMIN_UP,
  '/home/newStream': ADMIN_UP,
  '/workStream': ADMIN_UP,
  '/approvalModel': ADMIN_UP,
  '/createStream': ADMIN_UP,
  // 流程编排 v2（实验页）：与 createStream 同一档
  '/createStream2': ADMIN_UP,
  '/editStream': ADMIN_UP,
  '/editRule': ADMIN_UP,

  // 三档都能进
  '/': ALL_ROLES,
  '/mine': ALL_ROLES,
  '/analyze': ALL_ROLES,
  '/setDatas': ALL_ROLES,
  '/userSetting': ALL_ROLES,
  '/logic': ALL_ROLES,
  // 「我的审批单」点进去的详情/审批页：员工必须能进
  '/approvalPage': ALL_ROLES,
  '/approvalDetail': ALL_ROLES,
}

/** 没权限时往哪送：取该档位的**首页**，避免又落在一个它进不去的地方（会来回跳） */
const ENTRY_PATH: Record<AppRole, string> = {
  superAdmin: '/home',
  approval: '/home',
  // 员工看不到「所有审批单」，落在「我的审批单」
  normal: '/mine',
}

/** 该档位能不能进这个路径（未登记的路由放行，见 ROUTE_ROLES 的说明） */
export function canAccess (role: AppRole, path: string): boolean {
  const allowed = ROUTE_ROLES[path]
  return !allowed || allowed.includes(role)
}

/** 该档位的入口页（登录后跳转、以及被拦后的兜底） */
export function entryPath (role: AppRole): string {
  return ENTRY_PATH[role]
}

/**
 * 操作级权限（动作 → 允许的档位）。
 *
 * 为什么还要一张表：`ROUTE_ROLES` 管的是"能不能进这个页面"，而**同一个页面里
 * 往往还有更敏感的动作** —— 「数据」页三档都能进（员工要能查数据），
 * 但上传 BI 数据不该给他们：上传会按唯一键**删掉库里多出来的旧行**
 * （`uploadBiRows` 的 `prune`），是整库级别的写操作。
 * 别把"能进页面"当成"页面里什么都能做"。
 *
 * ⚠️ 口径与 `ROUTE_ROLES` **相反**：路由表里"未登记"是**放行**（宁可漏拦一个新页面，
 *    也别因为忘了登记把人锁在外面）；这里"未登记"必须**拒绝** ——
 *    漏登记一个动作等于悄悄给所有人开了个高权限操作，那是更糟的方向。
 */
const ACTION_ROLES = {
  /** 上传 BI 数据到库（会按唯一键删旧行） */
  'bi:upload': ADMIN_UP,
  /**
   * 清空 BI 数据（`bi_rows`）：只给超级管理员。
   *
   * 比上传更狠一档：上传还要选一个文件、还只替换文件覆盖到的行，这里是把整张表清空。
   * 好在 `bi_rows` 是 BI 的**镜像**，可以再同步回来；但一天之内全公司看不了数据，
   * 所以按"整库级操作"对待。
   * 服务端还会再校验一次（server/purgeData.ts 拿 token 问 PB 的 role），
   * 所以这张表是"界面别给人看到"，不是"权限的最终防线"。
   */
  'bi:purge': ['superAdmin'],
} as const

export type AppAction = keyof typeof ACTION_ROLES

/**
 * 该档位能不能做这个动作。
 * 未知动作返回 **false**（fail-closed，理由见 `ACTION_ROLES` 的说明）——
 * 传错动作名的后果是"少给了权限"，而不是"悄悄放行"。
 */
export function canAct (role: AppRole, action: AppAction): boolean {
  const allowed: readonly AppRole[] | undefined = ACTION_ROLES[action]
  return allowed ? allowed.includes(role) : false
}

/**
 * 登录后能不能回跳到这个地址：**只接受站内路径**，否则返回空串。
 *
 * 用途：路由守卫拦下未登录用户时会带上 `?redirect=<原地址>`，登录页据此回跳
 * （飞书卡片深链 `/approvalPage?order_no=…` 靠它保住参数）。
 *
 * 两道检查缺一不可：
 *   1. 必须以 `/` 开头 —— 否则 `redirect=https://evil.com` 就能把人带去外部站点；
 *   2. 不能以 `//` 开头 —— `//evil.com` 是**协议相对地址**，浏览器会当成外部站点，
 *      只查第 1 条会被它绕过。
 */
export function safeRedirectPath (raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : ''
  return s.startsWith('/') && !s.startsWith('//') ? s : ''
}
