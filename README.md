# 任务管理器

纯静态 PWA 任务管理应用，浏览器直连 Supabase，GitHub Pages 部署。

## 功能

| 视图 | 说明 |
|------|------|
| 总览 | 表格列表，支持搜索、状态/优先级/标签筛选、归档、多选批量操作 |
| 今天 | 日视图，进度环 + 任务列表，可前后翻日 |
| 周视图 | Agenda 列表式，显示任务、标签、可跳转日视图、可拖拽 |
| 月视图 | 日历网格，每天最多显示 4 个标签 + "更多" |
| 收件箱 | 无日期任务的快速收集箱，支持快速录入、回车保存 |

**核心能力：**

- **50 行正则自然语言解析** — 新建任务标题框失焦时自动解析：`明天买牛奶 #生活 高优先级` → 自动填充日期、标签、优先级
- **键盘快捷键** — `N` 新建任务，`T` 切到今天，`Ctrl+↑↓` 切换视图，`Ctrl+←→` 翻页，`Esc` 关闭弹窗
- **拖拽排序** — 日视图、周视图支持拖拽调整任务顺序
- **循环任务** — 支持每日/工作日/每周循环，可设次数或截止日期
- **子任务** — 全部子任务勾选后自动标记父任务完成
- **PWA** — 可安装到桌面，Service Worker 离线缓存

## 架构

```
浏览器 ──HTTPS──→ Supabase (数据库 + API)
```

无中间服务器。安全由 Supabase RLS（Row Level Security）保障，anon key 公开。

## 技术栈

Vanilla JS + CSS，无框架。Supabase 做数据层，Service Worker 做 PWA 缓存。

## 项目结构

```
docs/                    ← GitHub Pages 部署目录
├── index.html           HTML 骨架
├── style.css            样式表
├── app.js               应用主逻辑（~2000 行）
├── shared.js            共享纯函数（浏览器 + Node）
├── config.js            Supabase 配置（已提交，含默认凭证）
├── config.example.js    配置模板
├── manifest.json        PWA 清单
├── sw.js                Service Worker
├── icon-192.png
├── icon-512.png
tests/
├── shared.test.js       单元测试（23 个用例）
migrations/
├── 001-init.sql         数据库迁移脚本
server.js                Express 后端（旧方案，不再使用）
dev-server.js            本地静态开发服务器
```

## 部署

### 1. Supabase 初始化

在 Supabase SQL Editor 执行 `migrations/001-init.sql`：

```sql
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

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_owner ON tasks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```

**重要：** Supabase 项目需关闭公开注册（Authentication → Settings → 关闭 "Enable Signup"）。用户在 Supabase Dashboard 手动创建，网页端仅提供登录。

### 2. 配置凭证

编辑 `docs/config.js`，替换为你的 Supabase 项目凭证（URL + anon key）。

### 3. GitHub Pages

1. Fork 仓库，`docs/` 目录设为 GitHub Pages 来源
2. 推送即自动部署（CI 流水线含 lint + test + deploy）

## 本地开发

```bash
npm install
npm run dev     # http://localhost:3457
npm test        # 运行 23 条单元测试
npm run lint    # ESLint 检查
```

## 离线模式

Service Worker 缓存静态资源，Supabase 不可用时应用仍可加载界面。数据暂存 localStorage，恢复连接后刷新同步。
