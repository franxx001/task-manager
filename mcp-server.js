#!/usr/bin/env node
/**
 * Task Manager MCP Server
 * 让 WorkBuddy Agent 通过自然语言管理任务
 *
 * 工具：create_task, list_tasks, update_task, delete_task, get_stats
 * 连接方式：stdio (WorkBuddy 自动管理进程生命周期)
 */
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const API = 'http://localhost:3456/api/tasks';

// ==================== API 调用封装 ====================
async function api(method, path, body) {
  const url = path ? `${API}/${path}` : API;
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const json = await res.json();
  if (!json.success) throw new Error(json.error || '请求失败');
  return json.data;
}

// ==================== 服务器定义 ====================
const server = new Server(
  { name: 'task-manager', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

// ==================== 工具注册 ====================
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'create_task',
      description: '创建新任务',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '任务标题（必填）' },
          desc: { type: 'string', description: '任务描述' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '优先级，默认 medium' },
          date: { type: 'string', description: '日期，格式 YYYY-MM-DD，默认今天' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
          recurrence: { type: 'string', enum: ['daily', 'weekdays', 'weekly'], description: '循环类型：每天/工作日/每周' },
          recurrence_end: { type: 'string', description: '终止方式："次数"或"YYYY-MM-DD"' },
        },
        required: ['title'],
      },
    },
    {
      name: 'list_tasks',
      description: '查询任务列表，支持按状态/优先级/日期/标签筛选',
      inputSchema: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['todo', 'done'], description: '按状态筛选' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '按优先级筛选' },
          date: { type: 'string', description: '按日期筛选 YYYY-MM-DD' },
          tag: { type: 'string', description: '按标签筛选' },
          keyword: { type: 'string', description: '关键词搜索标题/描述' },
        },
      },
    },
    {
      name: 'update_task',
      description: '更新任务（任意字段）',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '任务 ID（必填）' },
          title: { type: 'string', description: '新标题' },
          desc: { type: 'string', description: '新描述' },
          status: { type: 'string', enum: ['todo', 'done'], description: '新状态' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '新优先级' },
          date: { type: 'string', description: '新日期 YYYY-MM-DD' },
          tags: { type: 'array', items: { type: 'string' }, description: '新标签列表' },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_task',
      description: '删除任务',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '任务 ID（必填）' },
        },
        required: ['id'],
      },
    },
    {
      name: 'get_stats',
      description: '获取任务统计概览（总数/已完成/待办/进度百分比）',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ],
}));

// ==================== 工具执行 ====================
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'create_task': {
        const defaultDate = new Date().toISOString().slice(0, 10);
        const body = {
          title: args.title,
          desc: args.desc || '',
          priority: args.priority || 'medium',
          date: args.date || defaultDate,
          tags: args.tags || [],
          status: 'todo',
        };
        // Handle recurrence
        if (args.recurrence) {
          const rec = { type: args.recurrence };
          if (args.recurrence_end) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(args.recurrence_end)) {
              rec.endDate = args.recurrence_end;
            } else {
              rec.remaining = parseInt(args.recurrence_end) || 5;
            }
          }
          body.recurrence = rec;
        }
        const task = await api('POST', null, body);
        return {
          content: [{ type: 'text', text: `✅ 已创建任务：${task.title} (ID: ${task.id})` }],
        };
      }

      case 'list_tasks': {
        let tasks = await api('GET');
        if (args.status) tasks = tasks.filter(t => t.status === args.status);
        if (args.priority) tasks = tasks.filter(t => t.priority === args.priority);
        if (args.date) tasks = tasks.filter(t => t.date === args.date);
        if (args.tag) tasks = tasks.filter(t => (t.tags || []).includes(args.tag));
        if (args.keyword) {
          const kw = args.keyword.toLowerCase();
          tasks = tasks.filter(t => t.title.toLowerCase().includes(kw) || (t.desc || '').toLowerCase().includes(kw));
        }

        if (tasks.length === 0) {
          return { content: [{ type: 'text', text: '📭 没有匹配的任务' }] };
        }

        const lines = tasks.map((t, i) => {
          const status = t.status === 'done' ? '✅' : '📌';
          return `${i + 1}. ${status} **${t.title}** [${t.priority}] ${t.date || ''} ${(t.tags||[]).length ? '#' + (t.tags||[]).join(' #') : ''}`;
        });
        return { content: [{ type: 'text', text: `共 ${tasks.length} 个任务：\n\n` + lines.join('\n') }] };
      }

      case 'update_task': {
        const updated = await api('PUT', args.id, args);
        return {
          content: [{ type: 'text', text: `✅ 已更新任务：${updated.title}` }],
        };
      }

      case 'delete_task': {
        await api('DELETE', args.id);
        return {
          content: [{ type: 'text', text: `🗑️ 已删除任务 (ID: ${args.id})` }],
        };
      }

      case 'get_stats': {
        const tasks = await api('GET');
        const total = tasks.length;
        const done = tasks.filter(t => t.status === 'done').length;
        const todo = total - done;
        const pct = total ? Math.round((done / total) * 100) : 0;
        return {
          content: [{
            type: 'text',
            text: `📊 任务统计\n\n总任务：${total}\n已完成：${done}\n待办：${todo}\n进度：${pct}%`,
          }],
        };
      }

      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `❌ 操作失败：${err.message}` }],
    };
  }
});

// ==================== 启动 ====================
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
