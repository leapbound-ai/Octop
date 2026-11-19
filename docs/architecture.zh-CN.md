# 架构

Octop 是一个面向多用户和多 Agent 的自托管 AI 助手平台，
以单个 Python 进程的形式交付。
它将三个可复用的库——`octop-harness`（基于 LangGraph 的
对话运行时）、`octop-gateway`（IM 渠道流水线）以及 React
与 TypeScript Dashboard——整合到一个 wheel 包中，并提供 CLI、
HTTP/WebSocket API 和 Web UI。

> 如果你要查阅面向贡献者的导航指南（模块边界、变更流程、硬性禁止事项），
> 请参阅仓库根目录下的 [AGENTS.md](../AGENTS.md)。本文档是**面向人类读者**的
> 架构概览；AGENTS.md 则是**面向 Agent** 的操作手册。

## 1. 分层

```
┌──────────────────────────────────────────────────────────────────┐
│  Surface          │  Dashboard (React)   CLI (click)   HTTP API │
├──────────────────────────────────────────────────────────────────┤
│  API layer        │  FastAPI routers       WS / SSE / JSON        │
├──────────────────────────────────────────────────────────────────┤
│  Domain layer     │  AgentManager   Gateway   GlobalProcessor     │
│                   │  CronManager    UserManager   SharedServices │
├──────────────────────────────────────────────────────────────────┤
│  Reusable libs    │  octop-harness   octop-gateway            │
├──────────────────────────────────────────────────────────────────┤
│  Storage          │  SQLite or PostgreSQL control plane + file workspaces│
└──────────────────────────────────────────────────────────────────┘
```

整个技术栈运行在一个进程中。除了用户配置的 LLM 提供商之外，
没有独立的 Worker、外部队列，也不要求其他外部服务。

## 2. 进程模型

`OctopServer.start()` 按依赖顺序组装运行时树。组合根位于
`src/octop/infra/server.py`；FastAPI/uvicorn 从
`src/octop/launch.py` 接入（这是唯一可以同时导入
`infra/server` 和 `api/app` 的模块）。

```
OctopServer.start()
 ├─ PathLayout.from_env()            (root + DB + secrets dirs)
 ├─ load_config(config.json)        (env overrides on top)
 ├─ open_database()                  (SQLite WAL or PostgreSQL via PostgresPool)
 ├─ run_migrations()                 (infra/db/migrations/*.sql, versioned)
 ├─ SharedServices (repos + factories)
 ├─ WizardTokenStore                 (5-min TTL setup tokens)
 ├─ ExpertCatalog  / SubagentCatalog (bundled MD libraries)
 ├─ PluginManager.seed_bundled() then load_installed()  (~/.octop/plugins/*; bundled default off)
 ├─ AgentManager (global registry — one per process)
 │    └─ for each agent row: builds HarnessAgentRuntime on demand
 │       ├─ HarnessAgent (LangGraph)
 │       ├─ GlobalProcessor (slash dispatch + chunk projection)
 │       └─ BackendWorkspace (filesystem or remote storage adapter)
 ├─ Gateway                         (IM channels + WS hub + cron trigger source)
 │    ├─ ChannelManager (one per agent that has a channel row)
 │    └─ WebSocketHub  (dashboard + CLI channel)
 ├─ CronManager (process-wide APScheduler)
 └─ UserManager (auth + per-user lookups)
```

`AppRuntime` 数据类保存四个运行中的单例；
`api/routers/*` 通过 `server.app_runtime.<thing>` 访问它们。

### 按用户隔离

每个请求都通过 JWT 完成身份验证，并解析到一个 `User` 行。
Agent 的所有权在**数据行**级别强制执行（将 `agents.user_id`
与请求调用者匹配；管理员可以绕过该限制）。系统不再为每个用户
维护独立的 `AgentManager`。全局注册表会将请求分发给与数据行匹配的
Harness 运行时，从而简化管理功能（`/api/admin/*`）和跨用户诊断。

Dashboard 始终通过 `/api` HTTP/WebSocket 与 Octop 通信；
React SPA 不会导入 Python 模块，也不会直接打开 SQLite 文件。

## 3. 对话入口

以下三种入口共享同一个 Agent 运行时：

| 入口 | 通信方式 | 默认 Session Key | 说明 |
|---------|------|-----------------------|-------|
| Web UI | WebSocket `/api/agents/{aid}/chat/ws` | `<aid>:dashboard:<user_id>:dm` | Dashboard 对话端点 |
| CLI | 内嵌 `OctopServer`（REPL）或 WebSocket | `<aid>:cli:<user_id>:dm` | `octop chats send` / `chats repl` |
| IM 渠道 | gateway `ChannelManager` | `<aid>:<channel_kind>:<platform_session>:<dm\|group>` | 参见 `infra/gateway/process/message_keys.py` |
| Cron 任务 | APScheduler trigger → `Gateway.push_text_from_session` | 数据行中的 `session_key`（默认为所有者的 `dashboard_key`） | `task_type=text\|agent` 决定直接推送，还是先运行 AI 再推送 |

`thread_id` 本身不编码来源；来源保存在 `chat_sessions` / `threads`
的数据列中。Thread 的复用与归档都是更新数据行；完整状态机请参阅
`infra/gateway/threads.py`。

> **流式对话现在使用 WebSocket。** 旧版
> `POST /api/agents/{aid}/chat/stream` SSE 端点已被双向 WS 端点取代，
> Dashboard 也可以在对话进行期间发送 slash 命令或 `/compact`。
> `POST /api/agents/{aid}/chat/hitl/resume` 是目前唯一仍使用 SSE 的路由，
> 它会将恢复后的对话流式返回给客户端。

## 4. 存储

**控制平面**（用户、Agent、提供商、渠道、Cron、Session、审计记录和 JWT 密钥）
位于以下两种存储之一：

* SQLite——默认文件位于 `~/.octop/` 下（旧版 `octop.db`，或由
  `config.json` → `database.sqlite_path` 指定）；
* PostgreSQL——通过 `config.json`、`OCTOP_DATABASE_*` 或安装向导中的数据库步骤配置。

迁移文件位于：SQLite 使用 `src/octop/infra/db/migrations/NNN_*.sql`，
PostgreSQL 使用 `NNN_*.pg.sql`。连接相关的 PRAGMA 配置位于 SQLite 连接池中；
PostgreSQL 扩展（例如 `vector`）由 Docker/运维初始化，而不是应用迁移负责。
Agent memory 的 DDL 由 octop-memory 负责。参见
[ADR 002](./adr/002-database-backends.md)。

wheel 包中包含构建好的 Dashboard SPA，因此整个技术栈只需一次
`pip install` 即可安装。

每个 Agent 的工作区文件（Markdown、技能、专家模板）都通过该 Agent 的
`BackendWorkspace`（`octop.infra.backend` → `octop_harness.backends`）读写。
默认后端是一个以 `~/.octop/agents/<agent_id>/` 为根目录的
`filesystem` 适配器；远程后端（S3、COS）会挂载在同一个 `root_dir` 之上，
Octop 服务不会通过 `Path.write_text` / `read_text` 直接读取内容文件。
完整规则请参阅 [agent-backend-file-io.md](./agent-backend-file-io.md)。
Checkpoint、LangGraph 状态以及 `sessions/*.jsonl` 备用文件仍保留在本地工作区目录，
因为它们由 harness 管理。

## 5. 国际化（i18n）

服务端负责的字符串（slash 回复、IM 状态、API 错误消息、工具显示名称和 CLI 输出）
来自 `src/octop/i18n/{en,zh}.json` 中的语言包，以及
`src/octop/i18n/domains/` 下的辅助函数。语言环境解析位于
`infra/utils/locale.py`，顺序为：已保存的用户偏好 → `Accept-Language`
请求头 → 渠道类型提示。Dashboard 在
`dashboard/src/locales/{en,zh}.json → apiErrors.*` 下维护对应的错误码，
也可以通过 `GET /api/i18n/tools` 获取工具标签。

## 6. 多 Agent 交互（harness teams）

`@Agent` 和 `ask_agent` 会通过 harness 的 `TeamManager`
（InboxManager + GlobalProcessor）执行。队列协议请参阅
[agent-interop-mailbox.md](./agent-interop-mailbox.md)；面向用户的两个入口请参阅
[agent-call-agent.md](./agent-call-agent.md) 和
[agent-delegation.md](./agent-delegation.md)。Octop 的
`GlobalProcessor` 实现了 `TeamProcessor` 协议，因此回复会回写到父 Thread
的 checkpoint，并通过 `on_reply` 推送到 Dashboard / IM 渠道。

## 另请参阅

- [AGENTS.md](../AGENTS.md) —— 模块边界、硬性禁止事项和变更流程
- [架构决策记录](./adr/) —— 单进程、无队列（ADR 001）
- [配置说明](configuration.md) —— `~/.octop/` 目录布局和环境变量
- [API 参考](api.md) —— 所有路由、请求体和错误
- [CLI 参考](cli.md) —— 所有子命令
- [Persona](personas.md) —— MBTI 模板和 `mbti_profiles` 数据模块
- [ACP 集成](acp.md) —— ACP 输入/输出服务器和 Runner 工具
- [Agent 互操作](agent-interop-mailbox.md)、
  [Agent 调用](agent-call-agent.md)、[Agent 委派](agent-delegation.md)
- [Agent 后端文件 I/O](agent-backend-file-io.md) —— 内容文件规则
