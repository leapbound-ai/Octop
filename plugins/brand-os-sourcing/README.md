# 选品研究插件

在 Octop 对话页选择「选品研究员」，点击快捷场景或输入人群、痛点。已有人民币零售售价区间或明确不限价格时直接开始。价格带未定时，研究员先通过 Octop 提问卡收集价格带，支持预设、自定义区间和不限价格。工具执行约 1–7 分钟，返回带原文证据的四档候选；专家将完整报告保存到 `outbound/*.md`。

卡片支持分档筛选、候选对照、来源跳转、侧栏展开、Markdown 报告和 JSON 数据下载。文件栏仍可预览和下载 Agent 保存的报告。CLI/IM 会收到摘要和文件路径。

## 本机启动

运行 `E:\Octop\scripts\start-sourcing.ps1`，访问 http://localhost:8088/chat 。账号信息见 `E:\Octop\.sourcing-runtime\login.txt`。该目录是独立 Octop 数据目录，不影响默认 `~/.octop`；需随本机备份保留。服务只监听本机。

## 安装到其他 Octop

依赖 Python 3.12+、Octop 与 httpx、pydantic。SOCKS 代理环境另装 `socksio`。安装插件：`octop plugin install ./plugins/brand-os-sourcing`。专家目录位于 `experts/brand-os-sourcing`，可打包成 ZIP，或放到 Octop home 的 `expert_market/brand-os-sourcing` 后通过 `octop agent from-expert brand-os-sourcing --user <账号>` 创建。

在 Octop home 的 `env` 中设置 `DEEPSEEK_API_KEY`（需有 Search 可用权限）。正文使用 harness 内置 web_fetch。可选配置 `APICLAW_API_KEY`，配置后查询美国 Amazon 竞品并消耗该服务额度。可选 `DEEPSEEK_BASE_URL`，默认 `https://api.deepseek.com`；可选 `SOURCING_MODEL`，默认 `deepseek-flash`。重启服务后生效。Agent 的 DeepSeek provider 另按 Octop 标准配置。

## 数据边界

网页引文以抓取后的完整正文核对。仅有检索摘要或引文失配时保留待核线索。指定价格带后，有正文证据但标价缺失的候选保留业务分档，并标明「标价待核」；确认超区间的候选进入放弃档。

1688 结构化字段按展示口径保留。遇登录、人机验证或未返回货源时，可用公开搜索索引补充商品链接，字段仍待核。Amazon 样本按 APIClaw 的口径呈现。`check_sourcing_margin` 核验全部八项成本，以未舍入值判定 30% 门槛。省略 purchase 并指定已确认的货源 ID、询价词和数量时，工具可用现场采集的明确报价测算，其余字段仍须完整。报价测算与实际毛利各有状态。

## 实现与维护

`engine/domain.py` 保留 P130 两段提示词、候选 schema、引文与价格校验。`web_research.py` 是可替换 httpx adapter；`pipeline.py` 编排搜索、核验、市场采集和报告流程；`render.py` 产生 Markdown。market_data.py 使用现有 httpx 实现 1688 和 APIClaw 采集。1688 的 URL 和字段取自 SkillHub 的 1688-trend-trader 1.0.4，Amazon 契约取自 apiclaw-analysis。

`ui/dist/index.js` 是可直接编辑交付的自包含 ESM，无构建依赖，React 使用宿主实例。不要改 Octop dashboard 构建产物。

完整报告位于工具输出顶层，`data` 供卡片使用。OctopUiOffloadMiddleware 只旁路 `data`，不剥离 `report_markdown`，因此 Agent 仍能调用 write_file，ThreadArtifactsMiddleware 负责产物登记。此选择会让完整 Markdown 进入一次模型上下文；它换取不修改 harness 的可靠文件交付。

工具总预算 420 秒，单次搜索阶段内最多 22 秒，正文并发抓取每次最多 16 秒，模型每次最多 70 秒，货源与竞品阶段最多 42 秒。取消不会留下自建后台任务。遇网络或权限失败会明确返回失败，不能声称生成完成。当前不做持久化任务队列或中断续跑。

来源：Brand OS `bos/api/bos_api/sourcing/breadth.py` 与 `web_research.py`，Octop `docs/plugin-package.md`、`docs/expert-package.md`、`docs/octop-ui-payload-offload.md`。
