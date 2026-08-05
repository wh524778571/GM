# 国漫笔记 · 重启版（rebuild）

- **Phase 1**：数据层 + 四平台渲染服务 + 配图匹配服务
- **Phase 2**：AI 层（Provider 抽象 / 重试退避 / 成本埋点）+ 内容闭环
  （选题 → 生成 → 配图 → 四平台预览 → 质检 → 落库 → 追踪 → 数据回流）
- **Phase 3**：前端工作台（Next.js App Router + 设计 Token，7 屏）
- **Phase 4**：**人工发布闭环**（发布包 → 人工确认 → 状态留痕）+ 容器化交付 + 清理与 CI

旧工程与 `phase0-archive/` 只读引用，未做任何修改。

## 目录结构

```
rebuild/
├── .gitignore
├── docker-compose.yml            # ★ Phase 4：backend(8000) + frontend(3000) 一键起
├── backend/
│   ├── .env.example              # 只放占位符，真实 .env 已被忽略
│   ├── Dockerfile                # ★ Phase 4：python:3.13-slim，非 root，密钥只走 env
│   ├── .dockerignore
│   ├── pyproject.toml            # ★ Phase 4：ruff + pytest 配置
│   ├── requirements.txt
│   ├── alembic.ini               # 不写 sqlalchemy.url，一律读环境变量
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   │       ├── …_init_articles_tracking_materials.py
│   │       ├── …_phase2_weekly_plan_and_tracking_revenue.py
│   │       └── …_phase4_publish_records.py   # ★ 人工发布台账
│   ├── config/
│   │   └── platforms.yaml        # 平台规则唯一权威源（标题/字数/配图/RPM）
│   ├── app/
│   │   ├── main.py               # FastAPI 入口（Phase 2 路由集中挂载）
│   │   ├── api/
│   │   │   ├── schemas.py        # 出入参模型（Pydantic）
│   │   │   └── routers/          # articles / tracking / analytics / weekly / publish
│   │   ├── core/
│   │   │   ├── settings.py       # 全项目唯一声明 DATABASE_URL / 读密钥的地方
│   │   │   └── platform_rules.py # platforms.yaml 加载器
│   │   ├── db/base.py            # Engine / Session / session_scope
│   │   ├── models/               # article / tracking / material / weekly_plan / publish_record
│   │   ├── repositories/         # Repository 模式，禁止裸 sqlite3.connect
│   │   └── services/
│   │       ├── ai/               # ★ Phase 2 AI 层
│   │       │   ├── errors.py     #   异常体系（失败绝不静默）
│   │       │   ├── provider.py   #   AIProvider 抽象 / ZhipuProvider / MockProvider
│   │       │   ├── prompts.py    #   SYSTEM_PROMPT + 模板（逐字复制归档）
│   │       │   ├── factory.py    #   build_provider（不做静默降级）
│   │       │   └── generation.py #   四平台生成编排（唯一调用 AI 的地方）
│   │       ├── publishing/       # ★ Phase 4 人工发布闭环
│   │       │   ├── errors.py     #   发布异常（不确定就抛，绝不 success=True）
│   │       │   └── service.py    #   发布包组装 + **全工程唯一**写 published 的地方
│   │       ├── qa.py             # 发布前质检（移植 gen_base 三个函数）
│   │       ├── analytics.py      # KPI / 汇总看板
│   │       ├── lexicon.py        # 国漫词典 + 最大正向匹配分词
│   │       ├── text_utils.py
│   │       ├── rendering/        # styles / markdown_renderer / service
│   │       └── image_matching/   # cache / indexer / matcher
│   ├── scripts/
│   │   ├── demo_closed_loop.py           # ★ 内容闭环端到端演示（8 个阶段）
│   │   ├── verify_prompt_parity.py       # 提示词与归档逐字比对
│   │   ├── verify_render_parity.py       # 与归档渲染器 1:1 回归比对
│   │   ├── regress_character_matching.py # 角色名/作品名配图匹配回归
│   │   └── index_archive_materials.py    # 归档素材索引导入 materials 表
│   └── tests/                    # pytest：provider 退避 / 风格继承 / 端点冒烟 / 发布闭环
└── frontend/                     # Phase 3 工作台 + Phase 4 发布弹窗
    ├── Dockerfile                # ★ Phase 4：多阶段 node:20-slim → next start
    ├── .dockerignore
    ├── app/api/articles/[article_id]/publish/  # ★ 发布相关同源代理（4 条）
    └── components/PublishModal.tsx             # ★ 人工发布弹窗
```

仓库根还有 `.github/workflows/ci.yml`（后端 pytest+ruff / 前端 build+lint / 红线检查）。

## 运行

```bash
PY=/Users/wuhao/.workbuddy/binaries/python/envs/default/bin
cd rebuild/backend

cp .env.example .env          # 按需填 ZHIPU_API_KEY
$PY/pip install -r requirements.txt

$PY/alembic upgrade head      # 建表：articles / tracking / materials / weekly_plan
$PY/python scripts/index_archive_materials.py   # 可选：导入 825 条归档素材
$PY/uvicorn app.main:app --reload --port 8000
```

### 配置 AI 密钥

密钥**只从环境变量读**（`app/core/settings.py` 是唯一读取处），代码与仓库里不出现真实值：

```bash
# rebuild/backend/.env（已被 .gitignore 忽略，禁止提交）
ZHIPU_API_KEY=你的密钥
AI_PROVIDER=zhipu          # 想离线联调改成 mock
```

未配置时 `POST /articles/{id}/generate` 返回 **503 + 明确提示**，
不会退化成 mock 假装生成成功。`GET /health` 里的 `zhipu_api_key_configured`
只回「是否已配置」，永不回显密钥内容。

### 验证脚本（失败一律非 0 退出）

```bash
$PY/python -m pytest tests/ -q                    # 78 项：退避/风格继承/端点/发布闭环
$PY/python scripts/demo_closed_loop.py            # 闭环演示（默认 mock，跑完自动清理）
$PY/python scripts/demo_closed_loop.py --keep --out ./var/demo   # 保留数据+落地预览 HTML
$PY/python scripts/verify_prompt_parity.py        # 人设/模板逐字一致
$PY/python scripts/verify_render_parity.py        # 渲染 1:1，12/12
$PY/python scripts/regress_character_matching.py  # 配图角色名匹配，18/18
```

## 接口

Phase 1：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查（DB、平台列表、素材数、AI 供应商、人设指纹） |
| GET | `/platforms` | 四平台规则（来自 platforms.yaml） |
| GET | `/render/sample` | 样例文章 → 四平台 HTML |
| POST | `/render` | 任意 Markdown → 四平台 HTML |
| GET | `/materials` | 素材列表（work/source/article_id/keyword 过滤） |
| GET | `/materials/search` | 素材模糊检索（跨库打分） |
| GET | `/materials/works` | 素材按作品聚合 |
| GET | `/debug/cache` | 配图三级缓存状态 |

Phase 2：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/articles` | 文章列表（状态/关键词过滤）/ 新建 |
| GET/PATCH | `/articles/{article_id}` | 详情 / 局部更新 |
| POST | `/articles/{article_id}/generate` | **闭环入口**：AI 生成四平台内容 + 配图建议 + 预览 + 质检 |
| POST | `/articles/{article_id}/qa` | 对已落库内容单跑质检（不调 AI） |
| GET/POST | `/tracking` | 发布后数据查询 / 录入（按 date+article+platform upsert） |
| GET | `/analytics` | KPI 看板（文章数/阅读/互动/涨粉代理/收益） |
| GET | `/analytics/summary` | 汇总（平台维度 + 文章 TOP + 按日趋势） |
| GET/POST | `/weekly-plan` | 周计划列表 / 新建 |
| PATCH | `/weekly-plan/{task_id}` | 更新周计划任务 |

生成失败的语义是明确的：AI 未配置 `503`｜AI 限流或调用失败 `502`（带 attempts/retryable）｜
模型输出解析失败或缺平台 `422`｜`strict=true` 且质检不过 `422`（带完整 issues）。

Phase 4：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/articles/{article_id}/publish/packets` | 四平台发布包（可复制正文 + 配图清单 + 人工步骤）**纯读，不改状态** |
| GET | `/articles/{article_id}/publish/status` | 四平台真实状态（默认 `pending` = 待人工发布） |
| POST | `/articles/{article_id}/publish/confirm` | 人工确认已发布，`confirmed` 必须显式为 `true` |
| POST | `/articles/{article_id}/publish/fail` | 登记发布失败，`reason` 必填 |

**这里没有「一键发布」端点，是刻意的。**

## Phase 1 关键约定

- **单一数据源**：只有 `app/core/settings.py` 声明 `DATABASE_URL`，
  models / repositories / alembic 全部由它派生；代码中不存在 `sqlite3.connect`。
- **平台规则单一权威**：标题长度、正文字数、是否配图只在 `config/platforms.yaml`
  定义。小红书 = 纯文字无图、正文 ≤ 1000 字。
- **渲染 1:1**：`scripts/verify_render_parity.py` 用 3 篇样例 × 4 平台与归档
  `md_renderer.gen_body` 逐字节比对，12/12 一致，4/4 平台输出互不相同。
- **绝不静默成功**：渲染返回 `missing_images` / `warnings` / `ok`；
  索引返回 `IndexReport.failures`；DB 异常回滚并抛出。
- **跨平台**：图片格式/尺寸一律 Pillow，未使用 macOS 专有的 `sips`。
- **密钥**：`ZHIPU_API_KEY` 只在 `app/core/settings.py` 里被 `os.getenv` 读取一次，
  其余位置（`.env.example` / 报错文案 / 文档）只出现变量名，仓库中不存在任何真实值。

## Phase 2 关键约定

### AI 层：失败可见、开销可见

`AIProvider` 是抽象基类，用模板方法把**重试 / 指数退避 / 限流 / 埋点**收敛在基类
`generate()`，子类只实现「发一次请求」的 `_invoke`：

- **重试**：`RetryPolicy(max_attempts, base_delay, factor, max_delay, jitter)`，
  退避 `min(base * factor^(n-1), max_delay)`；429 若带 `Retry-After` 以服务端为准。
  只有 `retryable` 的异常（429 / 5xx / 超时）才重试，鉴权失败不浪费配额。
- **不静默**：任何失败都抛 `AIProviderError` 子类（自带 `provider/status_code/attempts/retryable`），
  由路由层翻成 503/502/422。**模型返回空内容也算失败**——旧实现会兜底成
  `"# 标题\n\n> AI 未连接"` 当成功返回，这条路已被堵死。
- **埋点**：`telemetry.snapshot()` 给出调用数/重试数/token/耗时/估算成本，随生成结果返回。
- **可离线测**：`MockProvider(script=[...])` 支持「先 429 两次再成功」这类脚本，
  单测零网络即可覆盖全部退避与失败路径。

### 风格不漂移的三重保证

M2 最大的风险是生成时没继承人设，写出另一个号的味道。三道锁：

1. `app/services/ai/prompts.py` 的 `SYSTEM_PROMPT` / `PROMPTS_BASE`
   **逐字复制**自 `phase0-archive/prompts/gen_article_from_request.py`；
   `scripts/verify_prompt_parity.py` 用 `ast` 静态解析归档文件逐字符比对（不执行归档代码）。
2. **结构性保证**：全工程只有 `GenerationService` 一处调用 `provider.generate()`，
   第一个实参写死 `SYSTEM_PROMPT`，`generate()` 不提供任何 `system` 覆盖参数。
3. **产物可追溯**：生成结果与 `/health` 都带 `system_prompt_fingerprint`
   （SYSTEM_PROMPT 的 sha256 前 12 位，当前 `fcdd75eebebc`），人设被改一眼可见。

### 质检：规则只有一份

`app/services/qa.py` 移植归档 `gen_base.py` 的 `validate_titles` /
`validate_image_placeholders` / `quality_check`，但把写死的 `TITLE_LIMITS` 和
`quality_check()` 内部那份重复的 `limits/targets`（两处数字必然漂移）
统一改读 `config/platforms.yaml`。返回结构化 `QAReport`（error 阻断 / warning 透出），
不再靠 `print` 表达结论。生成阶段还会按规则**强制**执行小红书「纯文字无图」，
剔除动作逐条登记在 `enforcements` 里。

### 数据看板：宁可说「没有」，不编数字

- **收益**：`platforms.yaml → analytics.revenue_rpm_cents` 目前全为 0
  （头条原创标签待开通、百家分成待确认），`/analytics` 明确返回
  `rpm_configured: false` 并说明原因，**不用编的系数把预估说成真收益**。
  后台开通后填真实 RPM 即自动生效，无需改代码。
- **小红书涨粉**：粉丝数无法从内容数据推导，只给 `xhs_follower_proxy`
  （点赞+收藏代理值）并把 `real_follower_count` 显式置为 `null`。
- **互动率**：无追踪数据时返回 `null`（前端显示「暂无数据」），不是 `0%`。

### 已知偏差（有意为之，非遗漏）

1. **四平台标题是派生的**。归档 prompt 的输出契约里只有正文 JSON
   （`core/toutiao/baijia/bilibili/xhs`），标题原本在 `gen_*.py` 里人工手写。
   为了不改动归档 prompt 的字面内容，`GenerationService` 用**确定性截断**
   从选题派生各平台标题，超限一律截断并在 `enforcements` 中如实登记
   「建议人工改写」——不臆造标题、不静默放行超限。后续若要模型直接产出标题，
   需同步修改归档 prompt 并重跑 `verify_prompt_parity.py`。
2. **weekly_plan 独立建表**，没有指向 `articles` 的外键。周计划里存在
   「盘点素材」「数据复盘」这类不对应任何文章的任务，且计划通常先于文章存在，
   加外键会逼出假文章行。`article_id` 只做弱关联并建索引。
3. **`tracking.revenue_cents` 是人工录入字段**（默认 0），与看板的「预估收益」
   分开展示：一个是后台抄来的真实数，一个是 RPM 换算值，绝不混为一谈。

## Phase 4 关键约定

### 人工发布闭环：宁可承认「还没发」，不假装发出去了

旧工程 `publisher.py` 的每个平台方法都是 `return {"success": True}` 的空壳，
界面上一片绿，实际一篇没发 —— 这是审计头号问题。重建版的做法是**不做自动发布**：
系统不持有任何平台登录态，也不会替你开浏览器。它只把「发布」这件事拆成人能执行的步骤。

流程（界面：`/articles` 每行的「发布」按钮 → 弹窗）：

1. `build_packets()` 组装四平台发布包：可直接复制的标题/正文（已按平台规则渲染，
   小红书强制纯文字无图）、配图清单（哪几张、建议文件名、素材库是否已匹配）、
   6 步人工操作说明、以及各平台后台地址。**看发布包不等于发过，这一步不写任何状态。**
2. 你自己去平台后台粘贴、上传、点发布。
3. 回来点「我已在 XX 平台发布」（可填作品链接）→ `confirm_publish()` 写 `publish_records`。
   发失败就点「登记失败」，**原因必填**。

结构性保证（不是靠自觉，是靠代码形状 + 测试）：

- `publish_records` 表是唯一台账：**没有记录 = pending**，不存在「默认已发布」。
- 全工程只有 `confirm_publish()` 一处会写 `state=published`，且入口即校验
  `confirmed is not True → 抛 ConfirmationRequired(422)`。
  `tests/test_publish.py` 用**源码扫描**断言这个写入点只有一处，多写一处就红。
- 另一条测试扫描 `services/publishing/` 不得出现 `httpx/requests/selenium`
  —— 发布模块一旦联网就意味着有人在偷偷实现自动发布。
- 文章级 `status` 只有**四个平台全部人工确认**才升到 `published`；有失败则 `failed`；
  其余一律 `pending`。前端状态药丸直接照抄后端，不做任何「乐观显示」。

### 容器化：换台机器/换台服务器就能跑

```bash
cd rebuild
export ZHIPU_API_KEY=你的密钥      # 不设也能起，只是 /generate 会明确报未配置
docker compose up --build
# 前端 http://localhost:3000   后端 http://localhost:8000/docs
```

- 后端 `python:3.13-slim`，非 root 用户，启动前先 `alembic upgrade head`，
  迁移失败直接退出（不带着半截 schema 假装启动成功）。
- 前端多阶段构建（deps → build → prod-deps → runner），运行期不含 devDependencies。
- **镜像里没有任何密钥**：`ZHIPU_API_KEY` / `DATABASE_URL` / `BACKEND_BASE_URL`
  全部运行时注入；`.dockerignore` 明确排除 `.env`、`*.db`。
- 换 Postgres 只改 `DATABASE_URL` 一行，代码零改动（单一数据源的兑现方式）。

### CI 与清理

`.github/workflows/ci.yml`（ubuntu-latest）三个 job：

| job | 内容 |
| --- | --- |
| backend | Python 3.13 → `ruff check .` → `alembic upgrade head` → `pytest` |
| frontend | Node 20 → `npm ci` → `next lint` → `tsc --noEmit` → `next build` |
| guardrails | grep 红线：无 `sqlite3.connect(`、无 `sips` 调用、无写死密钥、发布模块无网络调用 |

清理：`rebuild/` 下无 `gen_*.py`、无散落的 `sqlite3.connect`；
仓库根那个 0 字节的游离 `app.db`（错误工作目录下被 SQLite 顺手建出来的空库）
已**移动**到 `_cleanup_trash/app.db` 而非删除，理由与恢复方式写在
`_cleanup_trash/README.md` 里。

## 配图中文分词修复（2026-08）

归档缺失 `工具/image_utils.py`，Phase 1 的 `extract_keywords` 是按行为反推重写的，
存在两处真实缺陷，导致**国漫角色名匹配不到素材**：

1. 切词用「单字分隔符」，`飞 / 看 / 望 / 冲` 等常用字把多字专名劈开
   —— `择日飞升` → `择日`，作品名丢失。
2. 整词命中文件名只给 3 分，低于跨库复用阈值 `MIN_REUSE_SCORE = 5`。
   `南宫婉` 已经把正确素材排在第 1 位（score=3），仍被阈值挡回 `None`。

修复：新增 `app/services/lexicon.py`，**词典最大正向匹配优先、残片再走原逻辑**，
并按词的专指程度加权（专指词 +4 → 7 分，作品名 +2 → 5 分，未登录词维持 3 分）。
阈值 `MIN_REUSE_SCORE` 保持 5 不变。同时修掉两个连带缺陷：标签重复计分
（`['凡人修仙传','凡人','修仙传']` 被计 3 次）、Round 1a 标签命中取任意一张。

回归：`scripts/regress_character_matching.py` 跑真实 825 条素材，
命中率 **28% → 100%（18/18）**，其中「语料里没有的角色必须返回 None」也在断言内。
