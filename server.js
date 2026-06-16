const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3456;

// Data file
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'tasks.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

function calcNextDate(dateStr, type) {
  const d = new Date(dateStr + 'T00:00:00');
  if (type === 'daily') {
    d.setDate(d.getDate() + 1);
    return d;
  }
  if (type === 'weekdays') {
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    return d;
  }
  if (type === 'weekly') {
    d.setDate(d.getDate() + 7);
    return d;
  }
  return null;
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function handleRecurrence(task, tasks) {
  if (!task.recurrence) return;

  const { type, remaining, endDate } = task.recurrence;
  if (!type) return;

  // Check remaining count
  if (remaining !== null && remaining !== undefined && remaining <= 0) return;

  // Calculate next date
  const next = calcNextDate(task.date, type);
  if (!next) return;

  const nextStr = fmtDate(next);

  // Check end date
  if (endDate && nextStr > endDate) return;

  const maxOrder = tasks.reduce((max, t) => Math.max(max, t.order || 0), 0);
    const newTask = {
    id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    title: task.title,
    desc: task.desc || '',
    status: 'todo',
    priority: task.priority,
    date: nextStr,
    tags: task.tags || [],
    order: maxOrder + 1000,
    recurrence: {
      type,
      remaining: remaining !== null && remaining !== undefined ? remaining - 1 : null,
      endDate: endDate || null,
    },
  };
  // Ensure "循环" tag
  if (!newTask.tags.includes('循环')) newTask.tags.push('循环');
  tasks.push(newTask);
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
