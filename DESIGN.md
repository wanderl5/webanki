# Web 版 Anki 设计方案

## 1. 项目目标

参考桌面版 Anki，构建一个现代化的 Web 版间隔重复记忆系统，核心特性：

- 浏览器即可使用，无需安装客户端。
- 后端使用 Rust，保证高并发与计算性能（尤其是 FSRS 调度）。
- 引入 Python 处理"非手动"内容：自动从文本/PDF/网页/音频等来源提取知识点并生成卡片。
- AI 作为兜底：当规则化提取无法处理或质量不足时，调用 LLM 生成或润色卡片。
- 保留 Anki 核心学习体验：牌组、卡片、间隔重复、自定义学习、统计。
- **卡片即笔记**：不区分 Note 与 Card，一张卡片就是一个独立的记忆单元。
- **学习自由化**：系统提供复习建议，但用户可以随时复习任意卡片、随时查看，功能尽量简化。

## 2. 技术栈

| 层级 | 选型 | 理由 |
|------|------|------|
| 前端 | React 18 + TypeScript + Tailwind CSS + shadcn/ui | 现代 Web 技术栈，组件丰富，适合复杂交互 |
| 后端 API | Rust + Axum + Tokio | 高性能、类型安全、异步生态成熟 |
| 数据库 | SQLite（主库）+ Redis（可选缓存/任务队列） | 简化部署、单文件易迁移；Redis 可选用于异步任务 |
| 算法 | Rust 实现 FSRS-5 | 官方 Rust 实现 `fsrs-rs` 可直接集成 |
| Python 服务 | Python 3.12 + FastAPI + Celery/RQ | 生态丰富，适合 NLP、文档解析、LLM 调用 |
| AI 兜底 | OpenAI / Claude / 本地模型 API | 通过统一接口封装，便于切换 |
| 部署 | Docker Compose / 单二进制文件 | 低运维成本，也可容器化 |

## 3. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        前端 (React SPA)                       │
│  学习界面 / 牌组管理 / 卡片编辑器 / 统计面板 / AI 导入向导        │
└───────────────────────────┬─────────────────────────────────┘
                            │ HTTPS / WebSocket
┌───────────────────────────▼─────────────────────────────────┐
│                   Rust API Gateway (Axum)                     │
│  认证 / 牌组 CRUD / 卡片 CRUD / 学习会话 / 调度计算 / 统计       │
│  直接调用 fsrs-rs 计算下一张卡片与间隔                         │
└──────────────┬──────────────────────────────┬─────────────────┘
               │                              │
┌──────────────▼──────────────┐  ┌───────────▼──────────────┐
│      SQLite（每用户独立）     │  │    Redis（可选）         │
│  用户 / 牌组 / 卡片 / 复习记录 │  │  会话 / 任务队列 / 缓存   │
└─────────────────────────────┘  └──────────────────────────┘
               │
┌──────────────▼──────────────┐
│   Python 内容处理服务 (FastAPI)│
│  文档解析 / 知识点提取 / LLM 兜底 │
│  通过消息队列异步处理大任务      │
└─────────────────────────────┘
```

## 4. 核心模块设计

### 4.1 认证与用户

- JWT + Refresh Token。
- 支持邮箱注册、OAuth（Google/GitHub）。
- 多用户隔离：所有数据带 `user_id`；每个用户独立 SQLite 数据库文件，便于备份与迁移。

### 4.2 牌组与卡片

**卡片即笔记**：不区分 Note 与 Card，简化数据模型与交互。

- **Deck**：牌组，支持嵌套（类似 Anki 的 `::` 分隔，如 `Language::English::Vocabulary`）。
- **Card**：独立的记忆单元，包含：
  - `front`：正面内容（HTML/Markdown）。
  - `back`：背面内容（HTML/Markdown）。
  - `tags`：标签数组。
  - `media`：关联的音频/图片资源。
  - `template`：可选，用于复杂渲染；默认直接渲染 front/back。
- 一张卡片同时承载"知识点记录"与"复习单元"两个角色，避免 Anki 中 Note/Card 的抽象门槛。

### 4.3 学习引擎（简化版）

- 使用 `fsrs-rs` 计算每次复习后的新状态（interval, difficulty, stability, retrievability）。
- **不强制每日上限**：没有 `new_cards_per_day` 或 `reviews_per_day` 的硬性限制。
- **建议复习队列**：系统按以下优先级给出建议复习顺序：
  1. 已到期（due <= now）且 retrievability 最低的卡片。
  2. 尚未学习过的新卡片。
  3. 未到期但 retrievability 较低的卡片（可选，用于"加练"）。
- **随时学习/查看**：用户可以在任何时间：
  - 进入"今日建议"模式，按系统建议顺序复习。
  - 进入"浏览"模式，查看任意牌组的所有卡片并选择任意卡片复习。
  - 在浏览中直接点击"现在复习"，不影响原有调度，只更新记忆模型。
- **无 Custom Study 概念**：功能合并到浏览模式，直接选择卡片即可复习。

### 4.4 Python 自动内容处理

提供多种"导入源"，减少手动输入：

| 导入源 | Python 处理逻辑 |
|--------|----------------|
| 纯文本/Markdown | 按段落/标题切分，生成 Q&A 卡片 |
| PDF | `pymupdf` / `pdfplumber` 提取文本，按段落处理 |
| 网页 URL | `trafilatura` / `readability-lxml` 提取正文 |
| 音频/视频 | Whisper 转录文本，再切分生成卡片 |
| 图片 | OCR（PaddleOCR / Tesseract）提取文字 |

处理流程：

```
原始内容
   │
   ▼
预处理（清洗、分段）
   │
   ▼
规则化提取（生成候选卡片）
   │
   ▼
质量评分 ━━低────▶ LLM 兜底生成/润色
   │高
   ▼
存入待审核队列 / 直接入库
```

### 4.5 AI 兜底策略

- **触发条件**：
  - 规则提取结果为空或置信度低。
  - 候选卡片 front/back 长度、完整性不达标。
  - 用户主动选择"AI 生成卡片"。
- **Prompt 工程**：
  - 给模型原始材料，要求生成若干张 Anki 卡片（正面问题 + 背面答案）。
  - 输出结构化 JSON，便于入库。
- **成本与速度**：
  - 小模型本地跑（如 Qwen2.5-7B）做初筛。
  - 大模型（GPT-4o / Claude）做高质量兜底。
  - 异步处理，避免阻塞用户。

## 5. 数据模型（简化）

```sql
-- 用户（集中库，用于认证与多租户路由）
users (id, email, username, db_path, created_at)

-- 牌组
decks (id, user_id, parent_id, name, config, created_at)

-- 卡片（即笔记，front/back 直接渲染）
cards (
  id, user_id, deck_id,
  front, back, tags, media,
  state, due, stability, difficulty, elapsed_days, scheduled_days,
  reps, lapses, last_review, created_at, updated_at
)

-- 复习日志
reviews (id, user_id, card_id, rating, state, elapsed_days, scheduled_days, reviewed_at)
```

## 6. API 设计（核心）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/decks` | 牌组列表 |
| POST | `/api/decks` | 创建牌组 |
| GET | `/api/decks/:id/cards` | 牌组卡片 |
| POST | `/api/cards` | 创建卡片 |
| PUT | `/api/cards/:id` | 更新卡片 |
| DELETE | `/api/cards/:id` | 删除卡片 |
| GET | `/api/study/queue` | 获取建议复习队列 |
| POST | `/api/study/:card_id/review` | 提交复习结果 |
| POST | `/api/import/text` | 文本自动导入 |
| POST | `/api/import/file` | 文件自动导入（异步）|
| GET | `/api/stats` | 学习统计 |

## 7. AI/Python 集成方案

### 方案 A：Python 作为独立微服务（推荐）

- Rust API 接收导入请求，将任务写入 Redis/RabbitMQ。
- Python Worker 消费任务，完成解析、提取、LLM 调用。
- 处理完成后回调 Rust API 或将结果写回数据库。

优点：解耦、可独立扩展、Python 生态自由。  
缺点：增加部署复杂度。

### 方案 B：Rust 直接调用 Python（PyO3 / inline-python）

- 在 Rust 进程中嵌入 Python 解释器，直接调用脚本。

优点：延迟低，无需额外服务。  
缺点：部署重、扩展性差、GIL 限制。

**推荐方案 A**。

## 8. 开发阶段

1. **MVP**：Rust 后端 + React 前端 + SQLite，支持手动创建牌组/卡片、FSRS 学习、基础统计。
2. **导入增强**：接入 Python 服务，支持文本/Markdown/PDF 自动导入。
3. **AI 兜底**：集成 LLM，支持低质量内容自动润色与生成。
4. **高级功能**：多媒体卡片、Anki 牌组导入导出、移动端适配、插件系统。

## 9. 参考仓库

- Anki 官方：`https://github.com/ankitects/anki`
- FSRS Rust 实现：`https://github.com/open-spaced-repetition/fsrs-rs`
