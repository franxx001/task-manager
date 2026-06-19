# 任务管理器

> 本地优先的任务管理 PWA —— 月/周/日视图 + 看板拖拽 + 自然语言快速录入 + WorkBuddy MCP 集成

## 特性

- **四维视图**：月视图（标签概览）、周视图（Agenda 拖拽）、日视图（Kanban 三列）、收件箱
- **键盘操作**：`N` 新建 / `T` 切今日 / `/` 搜索，全键盘流
- **自然语言解析**：标题框输入 `明天买牛奶 #生活 高优先级`，失焦自动拆解为日期、标签、优先级
- **拖拽排序**：Agenda 内跨天拖拽、Kanban 跨列拖拽、月视图拖拽改日期
- **循环任务**：每日/工作日/每周循环，完成自动生成下一次
- **标签筛选**：侧边栏按标签过滤 + 进度统计
- **认证安全**：密钥登录 + HMAC Token（30 天有效）
- **MCP Server**：WorkBuddy AI 可直接操作任务——创建/查询/更新/完成/搜索
- **PWA**：可安装到桌面，离线基础可用

## 技术栈

```
前端: 纯 HTML/CSS/JS（单文件 ~80KB，无框架）
后端: Express.js（静态服务 + REST API）
存储: Supabase（云端）+ data/tasks.json（本地缓存）
MCP:  @modelcontextprotocol/sdk（StdioServerTransport）
```

## 项目结构

```
task-manager/
├── docs/
│   ├── index.html      # 前端 SPA（全部逻辑）
│   ├── manifest.json    # PWA 清单
│   └── icon-*.png       # PWA 图标
├── data/
│   ├── tasks.json       # 本地任务数据
│   ├── auth.json        # 登录密钥
│   └── mcp-config.json  # Supabase 配置
├── server.js            # Express 后端（端口 3456）
├── dev-server.js        # 纯静态开发服务器（端口 3457）
├── mcp-server.js        # MCP Server（stdio 传输，直连 Supabase）
├── mcp-login.js         # MCP 登录助手
└── package.json
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 启动服务

```bash
# 带 API 服务（推荐）
npm start
# → 打开 http://localhost:3456

# 或纯静态（不需要后端，但无数据持久化）
node dev-server.js
# → 打开 http://localhost:3457
```

### 3. 登录

首次启动自动生成密钥，控制台会打印。在登录页输入即可，Token 30 天有效。

### 4. 配置 MCP Server（可选）

```bash
# 先通过浏览器登录一次
# 再运行登录助手
node mcp-login.js <你的密钥>

# 在 WorkBuddy MCP 配置中添加：
# {
#   "command": "node",
#   "args": ["你的路径/mcp-server.js"]
# }
```

配置完成后，WorkBuddy 可直接通过 MCP Tools 操作任务。

## MCP Tools

| Tool | 参数 | 说明 |
|------|------|------|
| `create_task` | title, desc?, priority?, date?, tags?, recurrence? | 创建任务 |
| `list_tasks` | status?, priority?, tag?, keyword?, date? | 查询任务列表 |
| `update_task` | id, title?, desc?, status?, ... | 更新任务 |
| `delete_task` | id | 删除任务 |
| `complete_task` | id | 完成任务（循环任务自动生成下一次） |
| `get_stats` | — | 任务统计（总数/完成率/标签分布） |

## 自然语言解析语法

在新建任务的标题框输入，失焦后自动解析：

```
格式: [日期前缀] 任务内容 [#标签1 #标签2] [优先级关键词]

日期前缀:  今天 / 明天 / 后天 / 下周一 ~ 下周日 / 3天后
标签:      #tag   （支持多个）
优先级:    高优先级 / 高 / 紧急 / 低优先级 / 低
```

示例：

| 输入 | 解析结果 |
|------|----------|
| `明天买牛奶 #生活 高优先级` | 日期=明天, 标签=生活, 优先级=high |
| `下周一提交报告 #工作 紧急` | 日期=下周一, 标签=工作, 优先级=high |
| `3天后复习 #学习` | 日期=3天后, 标签=学习, 优先级=medium |

## 快捷键

| 键 | 非输入框聚焦时 | 输入框聚焦时 |
|---|---------------|-------------|
| `N` | 打开新建任务弹窗 | 正常输入 |
| `T` | 切换到今日视图 | 正常输入 |
| `/` | 聚焦搜索框 | 正常输入 |
| `Escape` | 关闭弹窗/取消 | — |
| `Ctrl+Enter` | — | 提交当前表单 |

## 许可证

MIT
