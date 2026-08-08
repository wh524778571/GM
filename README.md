# 国漫笔记 · 内容工作台

Yolo 的国漫自媒体内容工作台：把「选题雷达 → 写稿 → 去 AI 味 → 四平台分发 → 数据复盘」做成闭环。
全栈 Next.js + FastAPI，本地一体化运行。

---

## 技术栈

| 层 | 技术 | 端口 |
|---|---|---|
| 前端 | Next.js 14 (App Router) + React 18 + Tailwind + TypeScript | 3000 |
| 后端 | FastAPI + SQLAlchemy + SQLite | 8000 |
| Python 运行时 | managed venv `/Users/wuhao/.workbuddy/binaries/python/envs/default/bin/python3`（含 sqlalchemy） | — |
| Node 运行时 | managed 22.12.0 `/Users/wuhao/.workbuddy/binaries/node/versions/22.12.0/bin` | — |

## 目录结构

```
国漫/
├── rebuild/
│   ├── frontend/            # Next.js 前端（页面 / 代理 / 组件）
│   └── backend/             # FastAPI 后端（路由 / 仓储 / 服务）
│       └── scripts/distribute.py  # 四平台一键分发 CLI（见下）
├── .workbuddy/memory/       # 项目记忆：架构约定 + 运维铁律（MEMORY.md 必读）
├── .env                     # 密钥（REDFOX_API_KEY 等，已 gitignore，绝不提交）
└── README.md
~/Documents/CnLast30Days/    # 每周一选题扫描报告输出目录
```

---

## 启动

### 前端（已由 launchd 托管，开机自启、崩溃自动拉起）

> ⚠️ **不要手动 `npm run dev`** —— 会和托管进程抢 3000 端口陷入死循环。
> 前端由 `~/Library/LaunchAgents/com.guoman.frontend.dev.plist` 管理（`KeepAlive=true`）。

- 页面异常时，直接删 `.next` 让托管进程自动重编译恢复：
  ```bash
  rm -rf rebuild/frontend/.next
  ```
- 验证编译（**不碰运行中的 dev**）：
  ```bash
  cd rebuild/frontend
  npm run typecheck                       # 仅类型检查（推荐）
  NEXT_DIST_DIR=.next-build npm run build # 隔离目录构建验证
  ```
- 仅调试时手动启动：`cd rebuild/frontend && npm run dev`

### 后端（手动启动）

```bash
cd rebuild/backend
/Users/wuhao/.workbuddy/binaries/python/envs/default/bin/python3 -m uvicorn app.main:app \
  --host 127.0.0.1 --port 8000 --reload
```

- 健康检查：`curl http://localhost:8000/health`
- 前端代理目标在 `rebuild/frontend/lib/backend.ts` 默认 `http://localhost:8000`，
  可用环境变量 `BACKEND_BASE_URL` 覆盖。

---

## 环境变量（`.env`，已 gitignore）

| 变量 | 用途 | 必填 |
|---|---|---|
| `REDFOX_API_KEY` | `cn-last30days` 选题热点扫描数据源 | 是（每周一自动化依赖） |
| `ZHIPU_API_KEY` | 后端四平台写稿引擎（GenerationService）真实调用 | 是（写稿 / 分发 CLI 依赖） |
| `GEMINI_API_KEY` | `nano-banana-pro` AI 配图生成 | 否（暂未用） |

获取：REDFOX → https://www.redfox.hk/settings/api-keys ；智谱 → https://open.bigmodel.cn ；GEMINI → https://aistudio.google.com/apikey

---

## 已接入 Skill 与触发时机

| 环节 | Skill | 触发时机 |
|---|---|---|
| 选题热点扫描 | `cn-last30days` | 每周选题 / 蹭热点；每周一 09:00 自动化 |
| 今日选题生成 | `wechat-viral-topic` | 生成选题时融入四基因（情绪钩子/信息差/身份标签/行动触发） |
| 写稿去 AI 味 | `humanizer-zh` | 初稿完成后必过，调 `/articles/{id}/polish` |
| 四平台分发 | `scripts/distribute.py`（原生引擎） | 一条命令出头条/百家/B站/小红书四版，每平台一文件 |
| 数据复盘 | `project-analysis-report` | 发文 24h 数据复盘可视化 |
| AI 配图 | `nano-banana-pro` | 需 `GEMINI_API_KEY`（暂未提供） |
| 安全审计 | `skills-security-check` | 装任何新 skill 前先只读审计 |

项目运维 SOP（踩坑沉淀）见 user 级 skill `guoman-ops` 与 `.workbuddy/memory/MEMORY.md`。

---

## 自动化

- **每周一 09:00** 国漫选题热点扫描（`automation-1786201098945`）：扫「沧元图,国漫」近 30 天三平台 → 存 `~/Documents/CnLast30Days` → 出本周 3 选题方向。
- **每周五 12:00 / 20:00** 沧元图看番提醒 / 文章截止提醒。

---

## 运维铁律（速查）

1. **验证前端编译绝不破坏运行中的 dev**：用 `typecheck` 或隔离 `NEXT_DIST_DIR` 构建，绝不跑普通 `npm run build`。
2. **dev 由 launchd 托管**：异常删 `.next` 让其自动恢复，不手动 `npm run dev`。
3. **git push 绕开 WorkBuddy 透明代理**：`env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy git push origin main`；代码只本地 commit，push 需用户明确许可。
4. **跨路由需保留的状态用 module 级 store**（`lib/articleSelection.ts`），别放组件 `useState`。
5. **软删除必带「回收站」出口**（FILTERS 加 deleted + 批量恢复）；种子数据只兜底后端不可达，不掩盖真实空列表。
6. **装新 skill 前先安全审计**，绝不在审计前执行被审查代码。

---

## 四平台一键分发（`scripts/distribute.py`）

复用后端原生四平台生成 / 导出引擎（`GenerationService` + `config/platforms.yaml`），
一条命令出「今日头条 / 百家号 / B站 / 小红书」四版 Markdown，**每平台一个文件**，
可直接复制粘贴进各平台编辑器。

> 为什么不复用 `content-repurposer`：那个 skill 默认平台是 Twitter/LinkedIn/IG/Threads，
> 且只是「改写工具」。后端已按国漫四平台的标题上限 / 字数 / 小红书纯文字等规则深度优化，
> 走原生引擎产出的版本最贴合需求。

```bash
# 深度文（默认），一条命令出四版
/Users/wuhao/.workbuddy/binaries/python/envs/default/bin/python3 \
  rebuild/backend/scripts/distribute.py --topic "沧元图最新一集解析：孟川的破局逻辑"

# 资讯 / 盘点文
... distribute.py --type info --topic "本周必追国漫 Top5"

# 长选题从文件读（也支持管道：echo "选题" | ... --type info）
... distribute.py --topic-file topic.md

# 只出部分平台
... distribute.py --topic "..." --platforms toutiao,xhs

# 已落库稿件，只重新导出四版（不重新调 AI）
... distribute.py --export-only --article-id <已有 article_id>
```

- 依赖：后端已启动（`http://127.0.0.1:8000`），且 `.env` 已配 `ZHIPU_API_KEY`。
- 产物默认落在 `国漫/分发输出/`（`--out-dir` 可改），含 `cli-<时间戳>_<平台>.md` 与 `_all.md` 合集。
- 默认 `persist=True`，四版草稿会落库到 `articles` 表（status=draft）。
- 加 `--qa` 可在生成后跑一次质检并打印摘要；`--no-combined` 不写合集。

---

## 常见操作

```bash
# 跑一次选题扫描（需 .env 已配 REDFOX_API_KEY）
cd 国漫 && set -a; source ./.env; set +a
/Users/wuhao/.workbuddy/binaries/python/versions/3.13.12/bin/python3 \
  ~/.workbuddy/skills/cn-last30days/scripts/cn_last30days.py "沧元图,国漫" \
  --platforms xhs,dy,gzh --count 50 --days 30 --output-format both --output-dir ~/Documents/CnLast30Days

# 文章批量恢复（回收站 → 草稿）
curl -s -X POST http://localhost:3000/api/articles/batch-restore \
  -H "Content-Type: application/json" -d '{"ids":["article_id_1","article_id_2"]}'
```
