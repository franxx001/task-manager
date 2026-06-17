#!/usr/bin/env node
/**
 * Task Manager MCP Server v2 — Direct Supabase
 * 不再依赖 localhost:3456，直接连接 Supabase
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// ==================== 配置 ====================
const CONFIG_FILE = path.join(__dirname, 'data', 'mcp-config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch {}

const SUPABASE_URL = config.supabaseUrl || 'https://bbcwbuutltmodlkldezf.supabase.co';
const SUPABASE_ANON_KEY = config.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiY3didXV0bHRtb2Rsa2xkZXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NzAzNDAsImV4cCI6MjA5NzI0NjM0MH0.hmXOvHFevOKTFy-_bNV9z8a0Mage9qUOmaFl9-_L9yc';
const AUTH_FILE = path.join(__dirname, 'data', 'mcp-auth.json');

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==================== 认证 ====================
let sessionUser = null;

async function ensureAuth() {
  if (sessionUser) return;
  // Try restore from saved session
  try {
    const { data } = await sb.auth.getSession();
    if (data?.session?.user) {
      sessionUser = data.session.user;
      return;
    }
  } catch {}

  // Try saved token
  try {
    const saved = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    if (saved.refresh_token) {
      const { data, error } = await sb.auth.setSession({
        access_token: saved.access_token,
        refresh_token: saved.refresh_token,
      });
      if (!error && data?.user) {
        sessionUser = data.user;
        return;
      }
    }
  } catch {}

  throw new Error('未登录。请先在浏览器打开任务管理器并登录，再运行：node mcp-login.js <密钥>');
}

async function apiGetTasks() {
  const { data, error } = await sb
    .from('tasks').select('*').order('order', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function apiCreateTask(data) {
  await ensureAuth();
  const row = {
    id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    title: data.title,
    desc: data.desc || '',
    status: data.status || 'todo',
    priority: data.priority || 'medium',
    date: data.date || '',
    tags: data.tags || [],
    order: Date.now() % 2000000000,
    user_id: sessionUser.id,
  };
  if (data.recurrence) row.recurrence = data.recurrence;
  const { error } = await sb.from('tasks').insert(row);
  if (error) throw error;
  return row;
}

async function apiUpdateTask(id, data) {
  await ensureAuth();
  const { error } = await sb.from('tasks').update(data).eq('id', id);
  if (error) throw error;
  return { id, ...data };
}

async function apiDeleteTask(id) {
  await ensureAuth();
  const { error } = await sb.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

// ==================== MCP Server ====================
const server = new Server(
  { name: 'task-manager', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

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
          date: { type: 'string', description: '日期 YYYY-MM-DD，留空为无日期' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签' },
          recurrence: { type: 'string', enum: ['daily', 'weekdays', 'weekly'], description: '循环类型' },
          recurrence_end: { type: 'string', description: '终止方式："次数"或"YYYY-MM-DD"' },
        },
        required: ['title'],
      },
    },
    {
      name: 'list_tasks',
      description: '查询任务列表，支持筛选',
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
      description: '更新任务',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '任务 ID（必填）' },
          title: { type: 'string' }, desc: { type: 'string' },
          status: { type: 'string', enum: ['todo', 'done'] },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          date: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
        },
        required: ['id'],
      },
    },
    {
      name: 'delete_task',
      description: '删除任务',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: '任务 ID（必填）' } },
        required: ['id'],
      },
    },
    {
      name: 'get_stats',
      description: '获取任务统计',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    switch (name) {
      case 'create_task': {
        const body = { title: args.title, desc: args.desc, priority: args.priority, date: args.date, tags: args.tags };
        if (args.recurrence) {
          const rec = { type: args.recurrence };
          if (args.recurrence_end) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(args.recurrence_end)) rec.endDate = args.recurrence_end;
            else rec.remaining = parseInt(args.recurrence_end) || 5;
          }
          body.recurrence = rec;
        }
        const task = await apiCreateTask(body);
        return { content: [{ type: 'text', text: `✅ 已创建：${task.title}` }] };
      }
      case 'list_tasks': {
        let tasks = await apiGetTasks();
        if (args?.status) tasks = tasks.filter(t => t.status === args.status);
        if (args?.priority) tasks = tasks.filter(t => t.priority === args.priority);
        if (args?.date) tasks = tasks.filter(t => t.date === args.date);
        if (args?.tag) tasks = tasks.filter(t => (t.tags || []).includes(args.tag));
        if (args?.keyword) {
          const kw = args.keyword.toLowerCase();
          tasks = tasks.filter(t => t.title.toLowerCase().includes(kw) || (t.desc || '').toLowerCase().includes(kw));
        }
        if (!tasks.length) return { content: [{ type: 'text', text: '📭 没有匹配的任务' }] };
        const lines = tasks.map((t, i) => {
          const s = t.status === 'done' ? '✅' : '📌';
          return `${i + 1}. ${s} **${t.title}** [${t.priority}] ${t.date || '📥'} ${(t.tags||[]).length ? '#' + (t.tags||[]).join(' #') : ''}`;
        });
        return { content: [{ type: 'text', text: `共 ${tasks.length} 个任务：\n\n` + lines.join('\n') }] };
      }
      case 'update_task': {
        const updated = await apiUpdateTask(args.id, args);
        return { content: [{ type: 'text', text: `✅ 已更新：${updated.title || args.id}` }] };
      }
      case 'delete_task': {
        await apiDeleteTask(args.id);
        return { content: [{ type: 'text', text: `🗑️ 已删除 (ID: ${args.id})` }] };
      }
      case 'get_stats': {
        const all = await apiGetTasks();
        const total = all.length;
        const done = all.filter(t => t.status === 'done').length;
        const pct = total ? Math.round((done / total) * 100) : 0;
        return { content: [{ type: 'text', text: `📊 总任务：${total}  已完成：${done}  待办：${total - done}  进度：${pct}%` }] };
      }
      default:
        throw new Error(`未知工具: ${name}`);
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `❌ 操作失败：${err.message}` }] };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch(console.error);
