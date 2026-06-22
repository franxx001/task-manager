const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const shared = require('./docs/shared.js');

const app = express();
const PORT = process.env.PORT || 3456;

// ==================== AUTH ====================
const AUTH_FILE = path.join(__dirname, 'data', 'auth.json');
let authSecret = null;

function initAuth() {
  // Try to load existing auth config
  if (fs.existsSync(AUTH_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
      authSecret = cfg.secret;
      console.log(`🔑 认证密钥已加载`);
      return;
    } catch {}
  }

  // Generate new key
  authSecret = crypto.randomBytes(20).toString('hex');
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ secret: authSecret, created: new Date().toISOString() }, null, 2), 'utf-8');
  console.log('\n' + '='.repeat(60));
  console.log('🔑 首次启动！以下是您的登录密钥（请妥善保管）：');
  console.log('\x1b[36m%s\x1b[0m', '  密钥: ' + authSecret);
  console.log('='.repeat(60) + '\n');
}

function createToken(secret) {
  const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const payload = String(expiry);
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(`${expiry}:${hmac}`).toString('base64');
}

function verifyToken(token, secret) {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const sep = decoded.indexOf(':');
    if (sep === -1) return false;
    const expiry = decoded.slice(0, sep);
    const hmac = decoded.slice(sep + 1);
    if (Date.now() > parseInt(expiry, 10)) return false;
    const expected = crypto.createHmac('sha256', secret).update(expiry).digest('hex');
    return hmac === expected;
  } catch { return false; }
}

initAuth();

// Data file
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// JSON body parser must come before auth middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'docs')));

// Auth middleware - protect /api/ routes except /api/auth/
app.use('/api', (req, res, next) => {
  if (req.path === '/auth/login' && req.method === 'POST') return next();
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: '未登录' });
  }
  const token = authHeader.slice(7);
  if (!verifyToken(token, authSecret)) {
    return res.status(401).json({ success: false, error: '登录已过期，请重新登录' });
  }
  next();
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { key } = req.body;
  if (!key || key !== authSecret) {
    return res.status(401).json({ success: false, error: '密钥错误' });
  }
  const token = createToken(authSecret);
  res.json({ success: true, data: { token } });
});

// ==================== DATA HELPERS ====================
function loadTasks() {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch { return []; }
}

function saveTasks(tasks) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2), 'utf-8');
}

// ==================== RECURRENCE HELPERS ====================

function handleRecurrence(task, tasks) {
  if (!task || !task.recurrence) return;
  var nextTask = shared.createNextRecurrence(task);
  if (!nextTask) return;

  var maxOrder = tasks.reduce(function(max, t) { return Math.max(max, t.order || 0); }, 0);
  nextTask.id = 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  nextTask.order = maxOrder + 1000;
  tasks.push(nextTask);
}

// Demo seeding removed - use the UI to create tasks

// ==================== API ROUTES ====================

// GET /api/tasks - 获取所有任务
app.get('/api/tasks', (req, res) => {
  try {
    const tasks = loadTasks();
    tasks.sort((a, b) => (a.order || 0) - (b.order || 0));
    res.json({ success: true, data: tasks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/tasks - 创建任务
app.post('/api/tasks', (req, res) => {
  try {
    const { title, desc, status, priority, date, tags, recurrence, subtasks } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: '任务标题不能为空' });
    }

    const tasks = loadTasks();
    const maxOrder = tasks.reduce((max, t) => Math.max(max, t.order || 0), 0);
    const newTask = {
      id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      title: title.trim(),
      desc: (desc || '').trim(),
      status: status || 'todo',
      priority: priority || 'medium',
      date: date || '',
      tags: Array.isArray(tags) ? tags.map(String).filter(Boolean) : [],
      subtasks: Array.isArray(subtasks) ? subtasks.filter(s => s.title && s.title.trim()) : [],
      order: maxOrder + 1000,
    };
    if (recurrence && recurrence.type) {
      newTask.recurrence = {
        type: recurrence.type,
        remaining: recurrence.remaining !== undefined ? recurrence.remaining : null,
        endDate: recurrence.endDate || null,
      };
      if (recurrence.weekdays && recurrence.weekdays.length > 0) {
        newTask.recurrence.weekdays = recurrence.weekdays;
      }
      // Auto-add "循环" tag
      if (!newTask.tags.includes('循环')) newTask.tags.push('循环');
    }
    tasks.push(newTask);
    saveTasks(tasks);
    res.status(201).json({ success: true, data: newTask });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/tasks/:id - 更新任务
app.put('/api/tasks/:id', (req, res) => {
  try {
    const tasks = loadTasks();
    const idx = tasks.findIndex(t => t.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }

    const { title, desc, status, priority, date, tags, order, recurrence, subtasks } = req.body;
    if (title !== undefined && !title.trim()) {
      return res.status(400).json({ success: false, error: '任务标题不能为空' });
    }

    const update = {
      ...(title !== undefined && { title: title.trim() }),
      ...(desc !== undefined && { desc: desc.trim() }),
      ...(status !== undefined && { status }),
      ...(priority !== undefined && { priority }),
      ...(date !== undefined && { date }),
      ...(tags !== undefined && { tags: Array.isArray(tags) ? tags.map(String).filter(Boolean) : [] }),
      ...(order !== undefined && { order }),
      ...(subtasks !== undefined && { subtasks: Array.isArray(subtasks) ? subtasks.filter(s => s.title && s.title.trim()) : [] }),
    };

    if (recurrence !== undefined) {
      update.recurrence = recurrence ? {
        type: recurrence.type,
        remaining: recurrence.remaining !== undefined ? recurrence.remaining : null,
        endDate: recurrence.endDate || null,
      } : null;
      if (recurrence && recurrence.weekdays && recurrence.weekdays.length > 0) {
        update.recurrence.weekdays = recurrence.weekdays;
      }
    }

    tasks[idx] = { ...tasks[idx], ...update };
    saveTasks(tasks);
    res.json({ success: true, data: tasks[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/tasks/:id - 部分更新（用于拖拽 + 完成循环）
app.patch('/api/tasks/:id', (req, res) => {
  try {
    const tasks = loadTasks();
    const idx = tasks.findIndex(t => t.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }

    const { status, date, order, subtasks } = req.body;
    if (status !== undefined) tasks[idx].status = status;
    if (date !== undefined) tasks[idx].date = date;
    if (order !== undefined) tasks[idx].order = order;
    if (subtasks !== undefined) tasks[idx].subtasks = Array.isArray(subtasks) ? subtasks.filter(s => s.title && s.title.trim()) : [];

    // Recurring task completed → generate next & remove done instance
    let responseData = null;
    if (status === 'done' && tasks[idx].recurrence) {
      const oldId = tasks[idx].id;
      handleRecurrence(tasks[idx], tasks);
      // Grab the newly generated task (last in array) before removing the done one
      responseData = tasks[tasks.length - 1];
      // Remove the completed instance
      const delIdx = tasks.findIndex(t => t.id === oldId);
      if (delIdx !== -1) tasks.splice(delIdx, 1);
    }

    saveTasks(tasks);
    res.json({ success: true, data: responseData || tasks[idx] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/tasks/:id - 删除任务
app.delete('/api/tasks/:id', (req, res) => {
  try {
    let tasks = loadTasks();
    const idx = tasks.findIndex(t => t.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: '任务不存在' });
    }
    tasks.splice(idx, 1);
    saveTasks(tasks);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// seedDemoIfEmpty removed - use the UI to create tasks
// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`✅ 任务管理器服务已启动: http://localhost:${PORT}`);
  console.log(`📁 数据文件: ${DATA_FILE}`);
  console.log(`🛑 按 Ctrl+C 停止服务`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 服务已停止');
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('\n🛑 服务已停止');
  process.exit(0);
});
