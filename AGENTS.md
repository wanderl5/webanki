# Web Anki — Agent Guide

本文档面向 AI 编码助手，说明项目架构、部署要点、开发规范与常见操作。

## 1. 项目概述

Web Anki 是一个基于 Web 的间隔重复（Spaced Repetition）记忆系统，参考 Anki 但做了简化：

- **Card = Note**：不区分 Note 与 Card，降低概念门槛。
- 支持手动创建卡片、关联卡片对比、FSRS 调度学习。
- 可选 AI 导入：通过 Python 服务从文本 / PDF / 网页 / 图片 / 音频中自动提取知识点。

## 2. 技术架构

```
┌─────────────────────────────────────┐
│  Frontend: React 19 + TypeScript    │
│  + Vite + Tailwind CSS 4            │
│  http://localhost:5173              │
└──────────────┬──────────────────────┘
               │ /api, /uploads
┌──────────────▼──────────────────────┐
│  Backend: Rust + Axum + SQLite      │
│  + fsrs-rs + JWT 认证               │
│  http://localhost:3000              │
└──────────────┬──────────────────────┘
               │ HTTP
┌──────────────▼──────────────────────┐
│  AI Service: Python + FastAPI       │
│  （可选，用于自动导入与 apkg 导出）    │
│  http://localhost:8001              │
└─────────────────────────────────────┘
```

### 2.1 各目录职责

| 目录 | 说明 |
|------|------|
| `backend/` | Rust API 服务，负责认证、牌组/卡片 CRUD、学习调度、媒体文件服务 |
| `frontend/` | React SPA，负责界面渲染与交互 |
| `ai-service/` | Python FastAPI 服务，负责内容解析、LLM 生成、apkg 导出 |
| `data/` | SQLite 数据库文件（运行后生成） |
| `media/` | 上传的媒体文件（运行后生成） |
| `scripts/` | 辅助脚本 |

## 3. 开发环境启动

### 3.1 Backend

```bash
cd backend
# 首次运行会自动执行 migrations
cargo run
```

默认监听 `127.0.0.1:3000`。

### 3.2 Frontend

```bash
cd frontend
npm install
npm run dev
```

默认监听 `127.0.0.1:5173`。

### 3.3 AI Service（可选）

```bash
cd ai-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

## 4. 部署要点

### 4.1 环境变量

#### Backend (`backend/.env` 或环境变量)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `DATABASE_URL` | `sqlite://web-anki.db` | SQLite 数据库路径 |
| `JWT_SECRET` | `dev-secret-change-me` | JWT 签名密钥，**生产环境必须修改** |
| `HOST` | `127.0.0.1` | 监听地址 |
| `PORT` | `3000` | 监听端口 |
| `MEDIA_DIR` | `./media` | 上传媒体文件存放目录 |
| `AI_SERVICE_URL` | `http://localhost:8001` | Python AI 服务地址 |
| `DESIRED_RETENTION` | `0.9` | FSRS 目标保留率，范围 `0.7 ~ 0.97` |

#### Frontend

前端主要通过 `vite.config.ts` 中的代理访问后端：

- `/api` → `http://localhost:3000`
- `/uploads` → `http://localhost:3000`

生产环境使用 `nginx.conf` 做反向代理。

#### AI Service

| 变量 | 说明 |
|------|------|
| `LLM_PROVIDER` | `openai` / `claude` / `local` |
| `LLM_API_KEY` | API Key |
| `LLM_MODEL` | 模型名称 |
| `LLM_BASE_URL` | 自定义 API Base URL |

### 4.2 Docker Compose（推荐生产部署）

```bash
docker-compose up --build
```

服务映射：

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- AI Service: `http://localhost:8001`

**持久化**：

- `./data` → backend SQLite
- `./media` → backend 上传文件

### 4.3 远程访问开发前端

Vite 开发服务器默认只监听 `127.0.0.1`，远程无法访问。需要显式指定 host：

```bash
cd frontend
npm run dev -- --host 0.0.0.0
```

### 4.4 媒体文件服务

- 上传接口：`POST /api/media/upload`
- 上传成功后返回 URL 形如 `/uploads/<uuid>.png`
- Backend 通过 `ServeDir` 在 `/uploads` 路径下直接提供静态文件服务
- Nginx / Vite 代理已将 `/uploads` 转发到后端

## 5. 代码规范

### 5.1 后端（Rust）

- 使用 `axum` 路由分层：`routes/auth.rs`, `routes/cards.rs`, `routes/decks.rs` 等
- 错误处理：统一使用 `AppError` / `AppResult`
- 数据库：使用 `sqlx` 进行编译期检查的查询
- 模型：`models.rs` 中定义数据库模型与 DTO，注意 `CardResponse::from(&Card)` 不会自动填充 `linked_card_ids`，需要手动补充

### 5.2 前端（React + TypeScript）

- 函数组件 + Hooks
- API 封装在 `frontend/src/lib/api.ts`
- 通用组件：`MarkdownRenderer`, `MarkdownEditor`, `MediaRenderer`
- 样式：Tailwind CSS 4，使用 `@tailwindcss/vite`

### 5.3 牌组层级目录

- `decks` 表已有 `parent_id` 字段，支持无限层级嵌套。
- 后端 `POST /decks` 接受 `parent_id`；`PUT /decks/:id` 支持修改 `parent_id`，并会校验循环引用。
- 前端 `/decks` 默认以**树形视图**展示，支持展开/折叠、创建子牌组、移动牌组。
- 前端通过 `buildTree(decks)` 将后端返回的扁平列表转成树；`getDescendantIds()` 用于移动时排除自身及子孙。
- `DeckDetail` 中展示面包屑路径与直接子牌组入口。

### 5.4 图片与媒体

- Markdown 编辑器上传图片：插入 `![name](/uploads/<uuid>.ext)` 到正文
- MediaUpload 组件上传的媒体：保存到卡片的 `media` JSON 数组
- `MediaRenderer` 负责渲染 `media` 数组中的图片与音频
- 清理未引用媒体：后端每天定时执行 `cleanup_unreferenced_media`

## 6. 常见命令

```bash
# 后端检查 + 测试
cd backend
cargo check
cargo test

# 前端构建
cd frontend
npm run build

# 前端 lint（当前 lint 配置会扫描 node_modules/.venv-browser，建议只检查 src）
npx eslint src/

# AI Service 启动
cd ai-service
source .venv/bin/activate
uvicorn main:app --reload --port 8001
```

## 7. 已知注意事项

1. **密码安全**：用户密码使用 bcrypt 哈希存储，**没有明文密码**，无法帮助用户“核对”或“找回”原密码。
2. **AI Service 依赖**：`apkg 导出` 与部分导入功能需要 AI Service 运行，否则后端会返回 500。
3. **后台任务**：直接通过工具启动的 `cargo run` / `npm run dev` 在会话结束时可能被清理；生产环境建议使用 `tmux`、`systemd` 或 Docker。
4. **Lint 配置**：当前 ESLint 默认会扫描 `.venv-browser/` 等目录，建议后续在 `eslint.config.js` 中显式忽略。

## 8. 修改后应更新的文档

- 如果改动涉及环境变量、部署方式、目录结构或关键接口，请同步更新本 `AGENTS.md`。
- 用户-facing 的功能变更应同时更新 `README.md` 或 `DESIGN.md`。
