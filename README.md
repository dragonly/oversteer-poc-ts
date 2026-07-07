# oversteer-poc

oversteer.ai 的 **POC**(不是 MVP)。刻意降到最小:人在 web UI 建 plan,agent 用 CLI 干活,双方在 plan/task 上 comment,Postgres 存数据。砍掉了 MVP spec 里的 events / cursor / steering / 软图 / escalation / 守门 等概念 —— 这些留给 dogfood 时一边用一边判断该不该加。

设计文档:`~/life/ideas/oversteer-ai/notes/poc.md`。

## 三件事

1. **人**(web UI):创建 plan,读 plan / task / comment,在 plan/task 上评论。
2. **agent**(CLI):读 plan,读写 task(完成 plan),在 plan/task 上评论。
3. **存储**:Postgres,主要表(`plans` / `tasks` / `documents` / `plan_comments` / `task_comments` / `events`),id 用 uuid。document 是挂在 plan 下的活文档(discovery / design / catalog / result),可原地反复编辑,每次编辑进 events 审计流。

## 技术栈

- TypeScript(用 `tsx` 直接跑,无构建步骤)
- Drizzle ORM + drizzle-kit(schema 即 `src/db/schema.ts`,单一来源)
- Postgres 18
- CLI: commander  ·  Web: Hono(hono/jsx 服务端渲染 HTML)
- **分层**:web server 既渲染 HTML(给人),又在 `/api/*` 暴露 JSON HTTP API(给 CLI)。
  server 是唯一直连 Postgres 的进程;CLI 是 `/api/*` 之上的瘦 HTTP 客户端,**不再直连数据库**。
  业务逻辑集中在 `src/data/`,只被 server 调用。

> **CLI 依赖 server 在跑**:用 CLI 前先 `npm run web`(默认 http://localhost:4000)。
> 用 `OVERSTEER_API` 环境变量可指向别的 server,例如 `OVERSTEER_API=http://host:4000 oversteer plan list`。

## 起步

```bash
# 1. 装依赖
npm install

# 2. 建库 + 配置连接
createdb oversteer
cp .env.example .env          # 按需改 DATABASE_URL / PORT

# 3. 把 schema 推到库(POC 阶段直接 push,不留迁移文件)
npm run db:push

# 4. 起 web(人侧)
npm run web                   # http://localhost:4000

# 5. agent 用 CLI(另开一个终端)
npm run cli -- plan list
```

> schema 稳定后可改用 `npm run db:generate` + `npm run db:migrate` 留迁移历史。

## 让 agent 全局用 `oversteer`

agent 不应该被迫先 `cd` 进项目才能调 CLI。装一次全局软链接:

```bash
cd ~/agent/oversteer-poc-ts
npm link            # 把 `oversteer` 挂到全局 PATH
```

之后在**任意目录**都能直接用:

```bash
oversteer plan list
oversteer --json plan get <planId>
```

原理:`bin/oversteer.mjs` 是个 node 启动器,根据自身真实位置(npm link 的 symlink 会被解析到这里)定位项目根,再调**项目本地的 tsx** 跑 `src/cli/index.ts`。所以:

- 只依赖全局有 `node`(必然有),不依赖全局 tsx,也不走慢的 `npx`。
- 从任意 cwd 调用,drizzle/pg 等依赖都从项目自己的 `node_modules` 解析。
- `.env` 由 `src/db/client.ts` 从项目根显式加载(`process.loadEnvFile`),不受 cwd 影响;没 `.env` 时回退到默认连接串。

卸载:`npm rm -g oversteer-poc`。

## CLI(agent 侧)

所有命令支持 `--json`(给 agent host),默认人类可读文本。

```
oversteer plan list                                  # 列出所有 plan
oversteer plan get <planId>                          # plan 全文 + 其下 task + plan 评论

oversteer task list --plan <planId>                  # 某 plan 的 task
oversteer task get <taskId>                          # task 全文 + 其评论
oversteer task create --plan <planId> --title T --intent I
oversteer task update <taskId> [--status todo|in_progress|done] [--intent I] [--pr-ref owner/repo#42]

oversteer comment plan <planId> --author A --text "..."
oversteer comment task <taskId> --author A --text "..."
oversteer comments plan <planId>                     # 读 plan 评论流
oversteer comments task <taskId>                     # 读 task 评论流
```

跑时用 `npm run cli -- <args>`(项目内)或全局 `oversteer <args>`(任意目录,需先 `npm link`),例如:

```bash
npm run cli -- task create --plan <planId> --title "实现 X" --intent "..."
oversteer --json plan get <planId>
```

## Web(人侧)

- `/` plan 列表 + 新建 plan 表单
- `/plans/:id` plan 详情:task 列表 + plan 评论 + 评论框
- `/tasks/:id` task 详情:task 全文 + task 评论 + 评论框

POC 阶段人不在 UI 改 task(那是 agent 的活),但能看全貌、能评论。

## 一次最小闭环(验收)

```bash
# 1. 人在 web UI 新建 plan → 得到 $PLAN

# 2. agent 读 plan,拆 task,认领,评论,完成
npm run cli -- plan get $PLAN
npm run cli -- task create --plan $PLAN --title "实现 plan list" --intent "查 plans 表全量返回"
npm run cli -- task update <task> --status in_progress
npm run cli -- comment task <task> --author agent:dev-1 --text "先做全量"
npm run cli -- task update <task> --status done --pr-ref owner/oversteer#1

# 3. web 上 plan 详情页能看到 task 已 done、PR ref、评论 → 闭环成立
```

## 目录

```
src/
  db/schema.ts     drizzle schema(4 表 + 2 enum)
  db/client.ts     pg pool + drizzle 实例
  data/index.ts    CLI 与 web 共用的数据访问函数
  cli/index.ts     agent 侧 CLI(commander)
  web/server.ts    人侧 web(hono, SSR HTML)
bin/
  oversteer.mjs    全局 CLI 启动器(npm link 的入口)
```
