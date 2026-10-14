/**
 * 服务端配置：**所有**环境变量只在这里读一次、默认值只在这里写一次。
 *
 * ## 为什么要有这一层（部署到云之前整理）
 *
 *   · 原来 `PB_URL` 在 index.ts / pbAdmin.ts / biSync.ts 各读一遍、`PB_ADMIN_*` 在两处各读一遍、
 *     BI 那几个在 biSync 与 snapshotSync 各读一遍 —— 哪天默认值要改（比如 PB 换端口），
 *     漏改一处就变成"某个功能连不上库"，而且不会报错、只会静默失败；
 *   · 必填项（飞书凭据）原来是"读的人自己判空"，散在业务代码里；收在这里可以**启动即校验**；
 *   · 启动日志需要一份"配了哪些、缺哪些"的摘要，但**绝不能打印值**（密钥进日志 = 泄漏）——
 *     见 `configSummary()`：它只输出"有/无"。
 *
 * ## 读取顺序
 * 见 server/env.ts：`APPROVAL_ENV_FILE` → `/etc/approval/env` → `.env.local` → `.env`，
 * 最后是真实进程环境变量（systemd `EnvironmentFile=` 与 shell export 优先级最高）。
 *
 * ## 少了变量会怎样（与改造前**完全一致**，不是"缺了就启动不了"）
 *   · 飞书凭据（FEISHU_APP_ID / FEISHU_APP_SECRET）：**必填**，缺了服务起不来（连客户端都建不出）；
 *   · PB 管理员（PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD）：缺了"清空 BI 数据 / 删除审批单 / 快照同步"
 *     这几个**特权写操作**不可用，其余功能正常；
 *   · BI 同步（BI_ACCESS_KEY_ID / BI_ACCESS_KEY_SECRET 等）：缺了 BI 同步与 BI token 接口不可用。
 */
import './env'

/** 取字符串，空串按没配处理 */
function str (value: string | undefined, fallback = ''): string {
  return String(value ?? '').trim() || fallback
}

/** 取数字，非数字回落默认值（端口这类不能是 NaN） */
function num (value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 服务端全部配置（**只读**：启动时定下来，运行期不再变） */
export const config = {
  /** app server 监听端口（PB 固定 8091，与它分开） */
  port: num(process.env.PORT, 3002),
  /** PocketBase 地址（服务端内部访问，不走公网） */
  pbUrl: str(process.env.PB_URL, 'http://127.0.0.1:8091'),
  /** PB 的 SQLite 文件（/api/bi/facets 直连它做 DISTINCT，比 REST 分页快两个数量级） */
  pbDbPath: str(process.env.PB_DB, 'pocketbase/pb_data/data.db'),

  /** 飞书自建应用凭据（**必填**；只存在于服务端，绝不要放进 VITE_ 变量） */
  feishuAppId: str(process.env.FEISHU_APP_ID),
  feishuAppSecret: str(process.env.FEISHU_APP_SECRET),

  /** PB 超级管理员（特权写操作用；见文件头说明） */
  pbAdminEmail: str(process.env.PB_ADMIN_EMAIL),
  pbAdminPassword: str(process.env.PB_ADMIN_PASSWORD),

  /** 数跨境 BI */
  bi: {
    baseUrl: str(process.env.BI_BASE_URL, 'https://work.jiushuyun.com/decision'),
    /*
     * 兼容历史写法：以前这两项叫 VITE_ACCESSKEYID / VITE_ACCESSKEYSECRET（会被打进浏览器产物）。
     * 现在密钥一律走服务端（前端改用 POST /api/bi/token 换短期 token），
     * 但**仍然认**旧名字，免得线上 .env 还没改就整个同步挂掉。
     */
    accessKeyId: str(process.env.BI_ACCESS_KEY_ID || process.env.VITE_ACCESSKEYID),
    accessKeySecret: str(process.env.BI_ACCESS_KEY_SECRET || process.env.VITE_ACCESSKEYSECRET),
    componentId: str(process.env.BI_COMPONENT_ID, '0c356d17-3c48-4c3b-b133-e6406a88c5fe'),
    shardDimension: str(process.env.BI_SHARD_DIMENSION, '部门'),
    shardParam: str(process.env.BI_SHARD_PARAM),
  },

  /** 超时提醒跑批（进程内定时；生产更推荐用系统 cron 打 /api/reminders/run?send=1） */
  reminder: {
    /** 每多少分钟跑一次；0 = 不在进程内跑批 */
    intervalMin: num(process.env.REMINDER_INTERVAL_MIN, 0),
    /** true = 真发消息（否则只算一遍并打日志） */
    send: process.env.REMINDER_SEND === '1',
  },
}

/** 必填项（缺失 = 服务无法正常工作） */
export function missingRequiredKeys (): string[] {
  const missing: string[] = []
  if (!config.feishuAppId) {
    missing.push('FEISHU_APP_ID')
  }
  if (!config.feishuAppSecret) {
    missing.push('FEISHU_APP_SECRET')
  }
  return missing
}

/** 可选组（缺失 = 对应功能降级，不影响启动）—— 启动日志里提示一句 */
export function optionalWarnings (): string[] {
  const out: string[] = []
  if (!config.pbAdminEmail || !config.pbAdminPassword) {
    out.push('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD 未配置：清空 BI 数据、删除审批单、快照同步不可用')
  }
  if (!config.bi.accessKeyId || !config.bi.accessKeySecret) {
    out.push('BI_ACCESS_KEY_ID / BI_ACCESS_KEY_SECRET 未配置：BI 同步与 BI token 接口不可用')
  }
  if (config.reminder.intervalMin > 0 && !config.reminder.send) {
    out.push('REMINDER_INTERVAL_MIN 已开但 REMINDER_SEND 不为 1：跑批只算不发（dry-run）')
  }
  return out
}

/**
 * 启动摘要：**只报"配没配"，绝不打印值**。
 *
 * 为什么要专门一个函数：这是最容易出事的地方 —— 顺手 `console.log(config)` 就把飞书密钥、
 * PB 管理员密码、BI accessKeySecret 全写进日志文件了（云服务器上日志往往还转存）。
 * 排查"到底读没读到"只需要知道有/无，不需要知道内容。
 */
export function configSummary (): string {
  const flag = (on: boolean) => (on ? '已配置' : '未配置')
  const files = process.env.APPROVAL_ENV_FILE ? 'APPROVAL_ENV_FILE' : '默认位置'
  return [
    `env 来源：${files}`,
    `飞书凭据：${flag(!!config.feishuAppId && !!config.feishuAppSecret)}`,
    `PB 管理员：${flag(!!config.pbAdminEmail && !!config.pbAdminPassword)}`,
    `BI 密钥：${flag(!!config.bi.accessKeyId && !!config.bi.accessKeySecret)}`,
    `PB：${config.pbUrl}（库文件 ${config.pbDbPath}）`,
    `端口：${config.port}`,
  ].join('；')
}

/**
 * 缺必填就打印原因并退出（行为与改造前一致：宁可起不来，也不要带着错配置跑）。
 * 由 index.ts 在模块体里调用 —— 放在 config 里是为了让"缺什么、去哪配"只有一处文案。
 */
export function assertRequiredKeys (log: (msg: string) => void = console.error): void {
  const missing = missingRequiredKeys()
  if (missing.length === 0) {
    return
  }
  log(`❌ 缺少必要配置：${missing.join('、')}`)
  log('   本地开发：写进项目根目录的 .env.local（已被 .gitignore 忽略）')
  log('   服务器上：写进 /etc/approval/env 并 chmod 600（或用 APPROVAL_ENV_FILE 指定别的路径）')
  log('   参考 deploy/env.example 的字段说明；不要把密钥写进代码或 VITE_ 变量')
  process.exit(1)
}
