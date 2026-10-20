const Database = require('D:/project/vuetify_approval/vite-project/approval-app/node_modules/better-sqlite3')

const db = new Database('D:/project/vuetify_approval/vite-project/approval-app/.tmp-pbcheck/data.db', {
  readonly: true,
  fileMustExist: true,
})

const col = db.prepare("select fields from _collections where name = 'user_preferences'").get()
console.log('=== 迁移后 user_preferences 字段 ===')
console.log(JSON.parse(col.fields).map(f => `${f.name} (${f.type})`).join('\n'))

console.log('\n=== 迁移后 users 规则 ===')
const users = db.prepare("select listRule, viewRule, updateRule from _collections where name = 'users'").get()
console.log(JSON.stringify(users, null, 2))

db.close()
