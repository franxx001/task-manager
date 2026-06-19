# 任务管理器

纯静态 PWA 任务管理应用，Supabase 后端 + GitHub Pages 部署。

## 功能

| 视图 | 说明 |
|------|------|
| 总览 | 表格列表，支持搜索、状态/优先级/标签筛选、归档、多选批量操作 |
| 今天 | 日视图，进度环 + 任务列表，可前后翻日 |
| 周视图 | Agenda 列表式，显示任务、标签、可跳转日视图、可拖拽 |
| 月视图 | 日历网格，每天最多显示 4 个标签 + "更多" |
| 收件箱 | 无日期任务的快速收集箱，支持快速录入、回车保存 |

**核心能力：**

- **50 行正则自然语言解析** — 新建任务标题框失焦时自动解析：`明天买牛奶 #生活 高优先级` → 自动填充日期 2026-06-19、标签「生活」、优先级「高」
- **键盘快捷键** — `N` 新建任务，`T` 切到今天，`Ctrl+↑↓` 切换视图，`Ctrl+←→` 翻页，`Esc` 关闭弹窗
- **拖拽排序** — 日视图、周视图支持拖拽调整任务顺序
- **循环任务** — 支持每日/工作日/每周循环，可设次数或截止日期
- **子任务** — 全部子任务勾选后自动标记父任务完成
- **PWA** — 可安装到桌面，离线缓存兜底

## 技术栈

单文件 HTML（CSS + JS 内联），无框架。Supabase 做数据层，Service Worker 做 PWA 缓存。

```
docs/
├── index.html       # 主应用（单文件）
├── manifest.json    # PWA 清单
├── sw.js            # Service Worker
├── icon-192.png     # 应用图标
└── icon-512.png
data/
├── tasks.json       # 本地数据（express server 用）
├── auth.json        # 服务端密钥
├── mcp-config.json  # MCP 的 Supabase 配置
└── mcp-auth.json    # MCP 登录态
server.js            # Express 后端（本地双模式：JSON 文件或 Supabase）
dev-server.js        # 纯静态开发服务器
mcp-server.js        # MCP Server（AI 直接操作 Supabase）
mcp-login.js         # MCP 登录脚本
```

## 部署

### 1. Supabase 初始化

```sql
-- 建表
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  desc TEXT DEFAULT '',
  status TEXT DEFAULT 'todo',
  priority TEXT DEFAULT 'medium',
  date TEXT DEFAULT '',
  tags TEXT[] DEFAULT '{}',
  "order" INTEGER DEFAULT 0,
  recurrence JSONB,
  subtasks JSONB DEFAULT '[]',
  user_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_owner ON tasks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

**重要：** Supabase 项目需关闭公开注册（Authentication → Settings → 关闭 "Enable Signup"）。用户在 Supabase Dashboard 手动创建，网页端仅提供登录。

### 2. GitHub Pages

1. Fork 仓库，`docs/` 目录设为 GitHub Pages 来源
2. 修改 `docs/` 中 Supabase 的 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`

### 3. MCP Server（可选）

让 AI 直接操作你的任务数据：

```json
// data/mcp-config.json
{
  "supabaseUrl": "https://xxx.supabase.co",
  "anonKey": "eyJhbG..."
}
```

```
node mcp-login.js   # 先登录获取 session
node mcp-server.js  # 启动 MCP
```

在 WorkBuddy 的 MCP 配置中指向 `mcp-server.js`。

## 本地开发

```bash
npm run dev     # 启动静态服务器 → http://localhost:3457
node server.js  # 启动 Express（含 API） → http://localhost:3456
```

## 离线模式

如果 Supabase 无法连接，应用自动降落：
- 从 localStorage 缓存读取已有任务
- 新任务保存到缓存
- 恢复连接后手动刷新同步
