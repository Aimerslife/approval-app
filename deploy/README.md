# 部署到云服务器（腾讯轻量 / 任意 Linux）

这套系统是**三个进程**，别当成一个：

| 进程 | 端口 | 作用 |
|---|---|---|
| PocketBase | 8091（**只听本机**） | 数据库 + REST API + 管理后台 `/_/` + 附件 `/files/` |
| app server（Node） | 3002（**只听本机**） | 飞书**长连接**（发消息 / 收事件）+ `/api/feishu`、`/api/bi`、`/api/approval`、`/api/word`…… |
| nginx | 80 / 443（公网） | 静态前端 + 反向代理上面两个 |

---

## 一、服务器准备

```bash
# Node ≥ 22.12（server/env.ts 用了 process.loadEnvFile；项目按 node22 配置）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo corepack enable && yarn --version          # 包管理器用 yarn

# better-sqlite3 是**原生模块**，要现场编译 → 必须有构建工具
sudo apt install -y python3 make g++

# nginx
sudo apt install -y nginx

# PocketBase：版本必须与本地一致（本地 0.39.8），架构按服务器来（amd64 / arm64）
curl -LO https://github.com/pocketbase/pocketbase/releases/download/v0.39.8/pocketbase_0.39.8_linux_amd64.zip
unzip pocketbase_0.39.8_linux_amd64.zip -d pocketbase && chmod +x pocketbase/pocketbase
```

**目录约定**（下面都以 `/opt/approval` 为例）：

```
/opt/approval/
├── dist/                 前端构建产物（在构建机生成，随包上传）
├── pocketbase/
│   ├── pocketbase        Linux 二进制（平台相关，别从 Windows 拷）
│   ├── pb_migrations/   表结构源码（**必须**一起上传，首次启动自动建表）
│   └── pb_data/         数据（SQLite + 附件；迁移数据时一起拷）
├── server/  src/  package.json …
└── node_modules/        安装时**不要**用 --production（见下）
```

## 二、首次部署

```bash
# 1) 代码 + 数据 + 前端产物上传到 /opt/approval（见"更新一版"里的打包命令）

# 2) 装依赖：⚠️ **不要** --production —— better-sqlite3 与 tsx 都在 devDependencies 里，
#    少了它们服务起不来（一个是原生模块、一个是 TS 运行时）
cd /opt/approval && yarn install --production=false

# 3) 密钥放仓库之外的受保护文件（**不上传到项目目录**）
sudo install -d -m 750 /etc/approval
sudo install -m 600 -o approval -g approval /dev/null /etc/approval/env
sudo nano /etc/approval/env          # 照 deploy/env.example 填；必填只有飞书两项

# 4) 守护进程
sudo cp deploy/approval-pb.service deploy/approval-app.service /etc/systemd/system/
# 超时提醒：一个 oneshot 单元 + 一个每 10 分钟的定时器（见第四节）
sudo cp deploy/approval-reminder.service deploy/approval-reminder.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now approval-pb approval-app
# 定时器 enable 即生效，不需要再手工配 crontab
sudo systemctl enable --now approval-reminder.timer
journalctl -u approval-pb -u approval-app -n 50 --no-pager   # 看启动日志
systemctl list-timers approval-reminder.timer                # 看下次触发时间
```

启动日志里会有一行配置自检（**只报"配没配"，不打印任何密钥值**）：

```
[配置] env 来源：默认位置；飞书凭据：已配置；PB 管理员：已配置；BI 密钥：已配置；PB：http://127.0.0.1:8091（库文件 pocketbase/pb_data/data.db）；端口：3002
```

## 三、nginx 路由（**顺序不能错**）

前端所有请求都是同源相对路径，所以这张表要跟 `vite.config.mts` 的代理完全对应：

```nginx
server {
    listen 443 ssl;
    server_name 你的域名;

    root /opt/approval/dist;
    index index.html;
    # SPA：前端路由交给 index.html
    location / { try_files $uri $uri/ /index.html; }

    # ⚠️ 这 6 条**必须**排在 /api 兜底之前：
    #    它们属于 app server(3002)，漏掉就会被兜底规则转给 PB(8091) 而 404
    #    （踩过两次：/api/bi 与 /api/approval 都表现为"清空失败 / 删除失败 HTTP 404"）
    location ~ ^/api/(feishu|org-tree|bi|admin|approval|word) { proxy_pass http://127.0.0.1:3002; }
    location ~ ^/api/reminders { proxy_pass http://127.0.0.1:3002; }   # 定时催办（只给 cron/内网）

    # 其余 /api 与 PB 自带路径 → PocketBase
    location /api   { proxy_pass http://127.0.0.1:8091; }
    location /_/    { proxy_pass http://127.0.0.1:8091; }   # 管理后台
    location /files { proxy_pass http://127.0.0.1:8091; }   # 附件

    client_max_body_size 64m;   # BI Excel 上传（后端限 35MB 左右，留余量）
}
```

> `/api/reminders/run?send=1` 会**真的发消息**，建议在 nginx 上限制来源或只从本机 cron 调用。

## 四、定时催办（超时提醒怎么被触发）

**默认方式：systemd timer，部署即生效，无需人工操作。**

```bash
sudo systemctl enable --now approval-reminder.timer   # 首次部署时已在上面的第 4 步执行
systemctl list-timers approval-reminder.timer         # 下次触发时间 / 上次触发时间
journalctl -u approval-reminder -n 30 --no-pager      # 每轮跑了什么（成功=HTTP 200）
```

`approval-reminder.timer` 每 10 分钟拉起一次 `approval-reminder.service`，
后者向 `http://127.0.0.1:3002/api/reminders/run?send=1` 发一个 POST。
**"打"是廉价的，"发不发"由「提醒设置」里的规则决定** —— 总开关、是否工作日、
不早于 sendTime 这三道闸门都在服务端判断（`utils/pushRules` 的 `shouldPushNow`），
被挡掉时会在「执行日志」里写明原因，所以每 10 分钟打一次是安全的。

两种备选（**与 timer 二选一，别同时开**，否则白跑）：

```bash
# 备选 ①：crontab —— 不能改 systemd 时的退路
*/10 * * * * curl -s -X POST 'http://127.0.0.1:3002/api/reminders/run?send=1' >/dev/null

# 备选 ②：进程内定时 —— 在 /etc/approval/env 里设（改完 restart approval-app）
REMINDER_INTERVAL_MIN=30   # 每 30 分钟跑一轮
REMINDER_SEND=1            # 不设这行就永远只算不发（dry-run）
```

> **两个"间隔"别搞混**（源码说明见 `server/index.ts` 末尾）：
> **tick**（timer / `REMINDER_INTERVAL_MIN`）= 多久检查一次，决定"到点后最迟晚多久发"；
> **推送间隔**（页面里配的 `intervalHours`）= 同一单两次提醒至少隔多久。
> **tick 必须明显小于推送间隔** —— 页面里最小档是 1 小时，所以 tick 取 10~30 分钟。
>
> 另外「不早于 09:00」是按**服务器时区**判断的，`approval-app.service` 里已经显式设了
> `TZ=Asia/Shanghai`，别去依赖服务器默认时区。

## 五、更新一版

```bash
# 构建机（本地）
yarn build                                  # 产出 dist/
tar -czf /tmp/approval-$(date +%F).tgz \
    dist server src types package.json yarn.lock \
    pocketbase/pb_migrations deploy
scp /tmp/approval-*.tgz user@server:/tmp/

# 服务器
cd /opt/approval && tar -xzf /tmp/approval-*.tgz
yarn install --production=false
sudo systemctl restart approval-app
```

> **只有改过 `deploy/*.service` / `*.timer` 时才需要**（改源码不用）：
> ```bash
> sudo cp deploy/approval-*.service deploy/approval-*.timer /etc/systemd/system/
> sudo systemctl daemon-reload
> sudo systemctl restart approval-app approval-reminder.timer
> ```
> `approval-reminder.timer` 是常驻的，改完必须 restart 才会重新读配置（`daemon-reload` 只重读 unit 定义）。
>
> **数据库不在更新包里**：`pb_data/` 只在首次部署或迁移数据时拷一次。
> 以后每次改表结构都是新加一个 `pb_migrations/*.js`（PB 重启时自动执行）。

## 六、上线前检查清单

- [ ] `/etc/approval/env` 权限 **600**、属主是跑服务的账号；项目目录里没有 `.env.local`
- [ ] 启动日志里飞书凭据 = 已配置；缺 PB 管理员 / BI 密钥时按需补
- [ ] **通知测试闸门已关**（`VITE_NOTIFY_TEST_OPEN_ID` 不要设 —— 见 `src/utils/notifyGate.ts`）
- [ ] **前端产物里没有 BI 永久密钥**（已改为服务端 `POST /api/bi/token` 代取）
- [ ] `--origins` 换成了生产域名（`deploy/approval-pb.service`）
- [ ] nginx 那 6 条 app server 路由在 `/api` 兜底**之前**
- [ ] HTTPS 证书就绪（飞书网页授权回调通常要求 https）
- [ ] 域名已备案（国内轻量云 + 域名访问必须）
- [ ] `approval-reminder.timer` 已 enable（`systemctl list-timers` 能看到下次触发时间）
- [ ] 超时提醒可用：先跑一次 `POST /api/reminders/run`（**不带** send）看 `tasks` 是否符合预期，
      再等一轮 timer（或看 `journalctl -u approval-reminder`）确认真发的条数对得上
