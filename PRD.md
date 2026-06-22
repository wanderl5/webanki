# Web Anki 产品需求文档（PRD）

## 1. 产品概述

### 1.1 产品名称

Web Anki

### 1.2 产品定位

一个基于浏览器的间隔重复记忆工具，参考 Anki 的核心学习理念，但大幅降低使用门槛：

- 不区分“笔记”与“卡片”，一张卡片就是一个独立记忆单元。
- 系统提供复习建议，但用户可以随时学习、随时查看，不强制每日限额。
- 支持从文本、PDF、网页、音频、图片自动提取知识点，AI 作为兜底生成卡片。

### 1.3 目标用户

- 需要记忆大量知识的学生、考研/考证人群。
- 语言学习者。
- 希望快速将阅读材料转化为记忆卡片的自学者。
- 觉得传统 Anki 操作复杂、希望更轻量的用户。

### 1.4 核心价值

1. **低门槛**：打开浏览器就能用，无需安装。
2. **自动化**：减少手动输入，AI / Python 自动从材料中生成卡片。
3. **自由学习**：有建议计划，但不限制用户何时复习、复习多少。

---

## 2. 核心功能

### 2.1 用户系统

| 功能 | 说明 |
|------|------|
| 注册 | 邮箱 + 密码注册 |
| 登录 | 邮箱 + 密码登录，JWT Token |
| 多用户隔离 | 每个用户独立 SQLite 数据库文件 |

### 2.2 牌组管理

| 功能 | 说明 |
|------|------|
| 创建牌组 | 输入名称创建 |
| 嵌套牌组 | 支持 `语言::英语::词汇` 形式 |
| 编辑/删除 | 修改名称或删除牌组 |
| 牌组列表 | 展示所有牌组及卡片数量 |

### 2.3 卡片管理

| 功能 | 说明 |
|------|------|
| 创建卡片 | 正面（问题）+ 背面（答案）+ 标签 |
| 编辑卡片 | 修改正背面内容与标签 |
| 删除卡片 | 软删除或硬删除 |
| 浏览卡片 | 按牌组查看所有卡片，支持搜索 |

### 2.4 学习功能

| 功能 | 说明 |
|------|------|
| 建议复习队列 | 系统按 FSRS 算法推荐最需要复习的卡片 |
| 自由复习 | 用户可在浏览页直接选择任意卡片复习 |
| 评分 | Again / Hard / Good / Easy 四个等级 |
| 显示答案 | 先显示正面，用户点击后显示背面 |
| 学习记录 | 每次复习生成记录，用于统计 |

### 2.5 自动导入（AI 服务）

| 功能 | 说明 |
|------|------|
| 文本导入 | 粘贴文本，自动切分为 Q&A 卡片 |
| PDF 导入 | 上传 PDF，提取文本后生成卡片 |
| 网页导入 | 输入 URL，提取正文生成卡片 |
| 音频/视频导入 | 语音转文字后生成卡片（后续版本） |
| AI 兜底 | 规则提取效果差时，调用 LLM 生成卡片 |
| 导入审核 | 用户可预览、编辑、删除自动生成的卡片后再入库 |

### 2.6 统计

| 功能 | 说明 |
|------|------|
| 今日复习数 | 当天复习卡片数量 |
| 待复习卡片 | 已到期卡片数量 |
| 总卡片数 | 各牌组卡片统计 |
| 记忆保留率 | 基于 FSRS retrievability 的估算 |

---

## 3. 非功能需求

| 维度 | 要求 |
|------|------|
| 性能 | 页面首屏加载 < 2s；API 响应 < 200ms（P95） |
| 可用性 | 单用户本地部署即可运行，无需复杂配置 |
| 可扩展性 | Python AI 服务可独立扩展 |
| 数据安全 | 密码 bcrypt 加密；JWT 鉴权 |
| 兼容性 | 支持主流浏览器（Chrome、Edge、Firefox、Safari） |

---

## 4. 用户故事

1. 作为一名考研学生，我希望把 PDF 讲义自动转成记忆卡片，以便高效背诵。
2. 作为一名语言学习者，我希望随时打开网页复习单词，不受每日限额限制。
3. 作为一名自学者，我希望粘贴一篇技术文章后自动生成卡片，减少手动整理时间。
4. 作为一名轻度用户，我希望不区分“笔记”和“卡片”，直接创建和复习。

---

## 5. 界面规划

### 5.1 页面列表

| 页面 | 路径 | 说明 |
|------|------|------|
| 登录 | `/login` | 邮箱密码登录 |
| 注册 | `/register` | 邮箱密码注册 |
| 牌组列表 | `/decks` | 展示所有牌组 |
| 牌组详情 | `/decks/:id` | 展示牌组内卡片，可新建/编辑/删除 |
| 创建卡片 | `/cards/new?deckId=` | 创建新卡片 |
| 编辑卡片 | `/cards/:id/edit` | 编辑卡片 |
| 建议学习 | `/study` | 按系统建议顺序复习 |
| 自由复习 | `/study/free?deckId=` | 浏览并选择卡片复习 |
| 导入 | `/import` | 文本/PDF/网页导入入口 |
| 统计 | `/stats` | 学习数据统计 |

### 5.2 学习页面交互

1. 显示卡片正面。
2. 用户回忆后点击“显示答案”。
3. 显示背面，并显示四个评分按钮。
4. 用户评分后，系统自动计算并跳转到下一张卡片。

---

## 6. 技术方案

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite + Tailwind CSS 4 |
| 后端 | Rust + Axum + Tokio |
| 数据库 | SQLite（每用户独立文件） |
| 间隔重复算法 | FSRS-5（`fsrs` crate） |
| AI 服务 | Python 3.12 + FastAPI |
| 任务队列 | Redis（可选，后续版本） |
| 部署 | 单二进制 + 静态前端 / Docker Compose |

---

## 7. 数据模型

```sql
-- 用户（集中认证库）
users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT,
  password_hash TEXT NOT NULL,
  db_path TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- 牌组
decks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  config TEXT, -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- 卡片（即笔记）
cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  tags TEXT, -- JSON array
  media TEXT, -- JSON array
  state INTEGER DEFAULT 0, -- 0=new, 1=learning, 2=review, 3=relearning
  due DATETIME,
  stability REAL,
  difficulty REAL,
  elapsed_days INTEGER,
  scheduled_days INTEGER,
  reps INTEGER DEFAULT 0,
  lapses INTEGER DEFAULT 0,
  last_review DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

-- 复习日志
reviews (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  rating INTEGER NOT NULL, -- 1=Again, 2=Hard, 3=Good, 4=Easy
  state INTEGER NOT NULL,
  elapsed_days INTEGER,
  scheduled_days INTEGER,
  reviewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

---

## 8. API 规范

### 8.1 认证

- `POST /api/auth/register` — 注册
- `POST /api/auth/login` — 登录

### 8.2 牌组

- `GET /api/decks` — 牌组列表
- `POST /api/decks` — 创建牌组
- `PUT /api/decks/:id` — 更新牌组
- `DELETE /api/decks/:id` — 删除牌组

### 8.3 卡片

- `GET /api/decks/:id/cards` — 牌组内卡片
- `POST /api/cards` — 创建卡片
- `PUT /api/cards/:id` — 更新卡片
- `DELETE /api/cards/:id` — 删除卡片

### 8.4 学习

- `GET /api/study/queue` — 建议复习队列
- `POST /api/study/:card_id/review` — 提交评分

### 8.5 导入

- `POST /api/import/text` — 文本导入
- `POST /api/import/file` — 文件导入

### 8.6 统计

- `GET /api/stats` — 学习统计

---

## 9. 开发里程碑

### Milestone 1：MVP（4 周）

- [x] 项目骨架搭建
- [x] 用户注册/登录
- [x] 牌组 CRUD
- [x] 卡片 CRUD
- [x] FSRS 学习与评分
- [x] 基础统计
- [x] 前后端联调

### Milestone 2：自动导入（2 周）

- [x] 文本导入（基础规则切分）
- [x] PDF 导入
- [x] 网页 URL 导入
- [x] 导入结果预览与编辑

### Milestone 3：AI 兜底（2 周）

- [x] LLM 接入（OpenAI / Claude / 本地模型可配置）
- [x] 规则提取为空时自动触发 LLM
- [x] AI 生成卡片标识

### Milestone 4：高级功能（后续）

- [x] 多媒体卡片（图片/音频）
- [x] Anki 牌组导入导出
- [x] 移动端适配优化
- [ ] 插件系统（暂不要求）

---

## 10. 风险与假设

| 风险 | 应对措施 |
|------|----------|
| FSRS 算法集成复杂度 | 使用官方 `fsrs` crate，逐步验证 |
| AI 生成卡片质量不稳定 | 先做规则提取，AI 仅兜底，并提供人工审核 |
| 大文件导入超时 | 使用异步任务队列处理 |
| 多用户 SQLite 并发 | 单用户本地部署场景为主；后续可切换 PostgreSQL |

---

## 11. 参考

- Anki 官方文档：https://docs.ankiweb.net/
- FSRS 算法：https://github.com/open-spaced-repetition/fsrs-rs
