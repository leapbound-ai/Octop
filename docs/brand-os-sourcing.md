# Brand OS P130 → Octop 选品扩展

2026-11-15。归属：Octop 独立插件与专家包。目标：本地 SQLite、无 Docker/PG/Redis，场景输入到候选卡片、Markdown 文件与可追溯来源。

## 需求

保留六组搜索、最多十二次正文抓取、候选结构、原文 quote 校验、人民币零售区间核验与候选降级、四档和 30% 实盘毛利门槛。调研启动前，有明确区间或已选不限价格便直接执行，否则优先通过 Octop 的 ask_user_question 暂停确认人民币零售价格带。用户可选择预设、输入自定义区间或选不限价格。无人值守时明确按不限价格继续。无实盘数据留空并标待验，不保证候选数或来源数。报告按候选展示通过正文核验的引文、1688 货源对照表、可选 Amazon 竞品、待核线索和实盘门槛。已核实的零售标价超区间进入放弃。缺标价的候选标记待核，有商品正文证据时保留研究分档。缺少通过核验的商品正文证据进入信息不足。

## 设计

插件 `plugins/brand-os-sourcing`：一次确定性五阶段工具，DeepSeek Search 与 harness web_fetch，P130 原提示词和 Pydantic 校验，纯 Python renderer。市场数据由本地 httpx adapter 采集。1688 结构化查询来自 SkillHub 的 1688-trend-trader 1.0.4，失败时只补充可取得的索引链接。可选 APIClaw 查询美国 Amazon 样本。数据记录包含类型、证据级别、链接、查询、采集时间与 raw 字段。实盘成本工具在用户明确选定货源和数量时可填入单一公示采购价，测算结果标记 quote_estimate。工具不直写 Agent 工作区；模型通过 write_file 写入 outbound/*.md，沿用 ThreadArtifactsMiddleware 登记。

体验升级：预构建自包含 ESM 插件，四档筛选、候选对照、证据展开、侧栏阅读、Markdown 和 JSON 下载。React 从宿主提供，不改控制台源码。顶层 report_markdown 保留给模型；data 用 artifact 旁路展示，避免只剩卡片无法写文件。

原始方案的版本差异：当前插件默认开启语义已生效；octop init --yes 仍要求管理员凭证。使用独立 `.sourcing-runtime` 保存本地配置，不覆盖用户默认 ~/.octop。启动脚本仅监听 loopback。

## 验证计划

真实 DeepSeek 搜索与合成；插件加载与工具 schema；30.00/29.99 边界、伪引文、无来源、售价范围与部分失败；宿主 offload 保留正文；聊天实际 write_file 登记；插件筛选下载与历史回放。沿用 Octop 相关已有测试，不新增单测文件。

## References

- Brand OS `bos/api/bos_api/sourcing/breadth.py`、`web_research.py`（P130 引擎来源）
- Octop `docs/plugin-package.md`、`docs/expert-package.md`
- Octop `src/octop/infra/agents/middleware/octop_ui_offload.py`
- 已安装 octop-harness 1.0.9 `plugins/loader.py`、`plugins/tools.py`
