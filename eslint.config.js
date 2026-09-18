import vuetify from 'eslint-config-vuetify'

/**
 * ⚠️ 别尝试包装/扩展这个返回值（2026-09 踩过两次，结论记在这里）：
 *   · `vuetify({ ts: true })` 返回的**不是普通数组**（Array.isArray 为 false、Object.keys 为空），
 *     是个 config-array 实例 —— 展开/拍平后再交给 ESLint 会报
 *       ConfigError: Config (unnamed): Unexpected key "0" found
 *   · 往参数里加自定义项（如 ignores）也不行：
 *       ConfigError: Config (unnamed): Unexpected key "ts" found
 * 所以：**原样导出**。要忽略某些路径，别在这里加 —— 见 README/log.md 的说明。
 *
 * 已知：pocketbase/pb_migrations/*.js（PB 生成物）会报一片 no-undef
 * （migrate / Collection / Field / unmarshal 是 PB 运行时注入的全局），
 * 那是既有状况，不是本次改动引入的。
 */
export default vuetify({
  ts: true,
})
