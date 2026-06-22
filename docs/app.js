// ==================== SUPABASE INIT ====================
// config.js 通过 window.SUPABASE_URL 注入，若不存在则使用默认值
var SUPABASE_URL = window.SUPABASE_URL || 'https://bbcwbuutltmodlkldezf.supabase.co';
var SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiY3didXV0bHRtb2Rsa2xkZXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NzAzNDAsImV4cCI6MjA5NzI0NjM0MH0.hmXOvHFevOKTFy-_bNV9z8a0Mage9qUOmaFl9-_L9yc';
let sb = null;
let usingOffline = false;

try {
  if (typeof window.supabase !== 'undefined') {
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, storage: window.localStorage, autoRefreshToken: true, detectSessionInUrl: false },
    });
  } else {
    throw new Error('Supabase SDK not loaded (file:// protocol?)');
  }
} catch (e) {
  console.warn('Supabase init failed, using offline localStorage mode:', e.message);
  usingOffline = true;
}

// ==================== AUTH ====================
let sessionUser = null;

function isLoggedIn() { return !!sessionUser; }

function getAuthToken() { return localStorage.getItem('task-session') || ''; }

async function keyToEmail(key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(key + ':task-manager-supabase');
  const hash = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
  return hex.substring(0, 16) + '@tm.local';
}

async function apiLogin(key) {
  const email = await keyToEmail(key);
  const { data, error } = await sb.auth.signInWithPassword({ email, password: key });
  if (error) throw new Error('密钥错误');
  sessionUser = data.user;
  localStorage.setItem('task-session', '1');
  return data.user;
}

async function ensureAuth() {
  if (sessionUser) return sessionUser;
  // Session lost — try to restore from Supabase
  try {
    const { data } = await sb.auth.getSession();
    if (data?.session?.user) {
      sessionUser = data.session.user;
      return sessionUser;
    }
  } catch {}
  // Session truly gone
  sessionUser = null;
  localStorage.removeItem('task-session');
  showLogin();
  throw new Error('会话已过期，请重新登录');
}

async function apiLogout() {
  await sb.auth.signOut();
  sessionUser = null;
  localStorage.removeItem('task-session');
}

// ==================== SUPABASE DATA LAYER ====================
const TASKS_TABLE = 'tasks';

// Transform Supabase row to app task format (description → desc)
function rowToTask(row) {
  return {
    id: row.id,
    title: row.title,
    desc: row.description || '',
    status: row.status,
    priority: row.priority,
    date: row.date || '',
    tags: row.tags || [],
    subtasks: row.subtasks || [],
    order: row.order || 0,
    recurrence: row.recurrence || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// Transform app task to Supabase row format
function taskToRow(task) {
  const row = {
    title: task.title,
    description: task.desc || '',
    status: task.status || 'todo',
    priority: task.priority || 'medium',
    date: task.date || '',
    tags: task.tags || [],
    subtasks: task.subtasks || [],
    order: task.order || 0,
    recurrence: task.recurrence || null,
  };
  if (task.id) row.id = task.id;
  return row;
}

async function apiGetTasks() {
  if (usingOffline) return loadOfflineTasks();
  const { data, error } = await sb
    .from(TASKS_TABLE)
    .select('*')
    .order('order', { ascending: true });
  if (error) throw new Error(error.message);
  return (data || []).map(rowToTask);
}

async function apiCreateTask(data) {
  if (usingOffline) return createOfflineTask(data);
  await ensureAuth();
  const row = taskToRow(data);
  row.id = 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  if (!row.order || row.order === 0) row.order = Date.now() % 2000000000;
  row.user_id = sessionUser.id;
  const { data: result, error } = await sb
    .from(TASKS_TABLE)
    .insert(row)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToTask(result);
}

async function apiUpdateTask(id, data) {
  if (usingOffline) return updateOfflineTask(id, data);
  await ensureAuth();
  const row = taskToRow(data);
  const { data: result, error } = await sb
    .from(TASKS_TABLE)
    .update(row)
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(error.message);
  return rowToTask(result);
}

async function apiPatchTask(id, data) {
  if (usingOffline) { patchOfflineTask(id, data); return; }
  await ensureAuth();
  if (!id) throw new Error('任务ID缺失');
  // 过滤掉 undefined 值，避免 Supabase 400
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) clean[k] = v;
  }
  const { error } = await sb
    .from(TASKS_TABLE)
    .update(clean)
    .eq('id', id);
  if (error) {
    console.error('apiPatchTask error:', error.message, 'details:', error.details, 'hint:', error.hint, 'code:', error.code);
    throw new Error(error.message);
  }
}

async function apiDeleteTask(id) {
  if (usingOffline) { deleteOfflineTask(id); return; }
  await ensureAuth();
  const { error } = await sb
    .from(TASKS_TABLE)
    .delete()
    .eq('id', id);
  if (error) throw new Error(error.message);
}

// ==================== OFFLINE STORAGE (localStorage fallback) ====================
const OFFLINE_KEY = 'task-manager-offline';

function saveOfflineTasks() { localStorage.setItem(OFFLINE_KEY, JSON.stringify(tasks)); }

function loadOfflineTasks() {
  try { return JSON.parse(localStorage.getItem(OFFLINE_KEY)) || []; } catch { return []; }
}

function createOfflineTask(data) {
  const task = { ...data, id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) };
  if (!task.order || task.order === 0) task.order = Date.now() % 2000000000;
  task.subtasks = task.subtasks || [];
  task.created_at = new Date().toISOString();
  tasks.push(task);
  saveOfflineTasks();
  return task;
}

function updateOfflineTask(id, data) {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) throw new Error('任务不存在');
  tasks[idx] = { ...tasks[idx], ...data };
  saveOfflineTasks();
  return tasks[idx];
}

function patchOfflineTask(id, data) {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return;
  Object.assign(tasks[idx], data);
  saveOfflineTasks();
}

function deleteOfflineTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  saveOfflineTasks();
}

// ==================== REALTIME SYNC ====================
let realtimeChannel = null;

function setupRealtime() {
  if (realtimeChannel) realtimeChannel.unsubscribe();
  realtimeChannel = sb
    .channel('tasks-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: TASKS_TABLE }, payload => {
      // Reload tasks on any change from server
      if (!document.hidden) loadTasksSilent();
    })
    .subscribe();
}

async function loadTasksSilent() {
  try {
    const loaded = await apiGetTasks();
    tasks = loaded;
    localStorage.setItem('task-manager-cache', JSON.stringify(loaded));
    renderAll();
  } catch {}
}

// ==================== CONNECTION STATUS ====================
let connTimeout = null;  // 超时标记
function setConnection(status, msg) {
  const dot = document.getElementById('connDot');
  const text = document.getElementById('connText');
  dot.className = 'connection-dot ' + status;
  const labels = { online: '已连接', offline: '已断开', loading: '连接中...' };
  text.textContent = msg || labels[status] || labels.loading;
  // 离线/断开状态下点击可重试
  dot.style.cursor = (status === 'offline' || status === 'loading') ? 'pointer' : 'default';
  text.style.cursor = (status === 'offline' || status === 'loading') ? 'pointer' : 'default';
  dot.title = (status === 'offline' || status === 'loading') ? '点击重试' : '连接状态';
  text.title = (status === 'offline' || status === 'loading') ? '点击重试' : '连接状态';
  dot.onclick = text.onclick = (status === 'offline' || status === 'loading') ? retryConnection : null;
}

async function retryConnection() {
  if (!sb || usingOffline) return;  // 离线模式不可重试
  setConnection('loading');
  try {
    const result = await withTimeout(sb.auth.getSession(), 8000);
    const session = result?.data?.session;
    if (!session) { setConnection('offline', '未登录'); showLogin(); return; }
    sessionUser = session.user;
    hideLogin();
    await withTimeout(loadTasks(), 8000);
    if (!isLoggedIn()) return;  // loadTasks 内部可能因错误调了 showLogin
    setupRealtime();
    renderAll();
  } catch (e) {
    if (connTimeout) { setConnection('offline', '连接超时'); } else { setConnection('offline', '已断开'); }
    // 从缓存恢复
    const cached = localStorage.getItem('task-manager-cache');
    if (cached) { try { tasks = JSON.parse(cached); } catch {} }
    renderAll();
  }
}

/** 给异步操作加超时，超时抛出并标记 connTimeout */
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const id = setTimeout(() => { connTimeout = true; reject(new Error('TIMEOUT')); }, ms);
      // promise resolve 时自动清除 timeout
      promise.then(() => clearTimeout(id), () => clearTimeout(id));
    })
  ]);
}

// ==================== GLOBAL STATE ====================
let tasks = [];
let editingId = null;
let titleParsed = false; // NL parsing done for current modal session
let weeklyDays = new Set();
let currentView = localStorage.getItem('task-view') || 'overview';
let weekOffset = 0;
let monthOffset = 0;
let dayViewDate = null;

// ==================== TOAST ====================
function showToast(msg, type) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast ' + type + ' show';
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ==================== DATA OPERATIONS ====================
async function loadTasks() {
  try {
    tasks = await apiGetTasks();
    localStorage.setItem('task-manager-cache', JSON.stringify(tasks));
    setConnection('online');
    hideLogin();
    return true;
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('permission denied') || msg.includes('403') || msg.includes('JWT')) {
      setConnection('offline');
      console.error('加载失败(RLS权限):', msg);
      showToast('数据库权限不足。请在 Supabase SQL Editor 中依次执行:\n'
        + '① ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id UUID;\n'
        + '② ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;\n'
        + '③ CREATE POLICY tasks_owner ON tasks FOR ALL\n'
        + '  USING (auth.uid() = user_id)\n'
        + '  WITH CHECK (auth.uid() = user_id);', 'error');
    } else {
      // 离线：从缓存加载
      const cached = localStorage.getItem('task-manager-cache');
      if (cached) { try { tasks = JSON.parse(cached); } catch {} }
      setConnection('offline');
      console.error('加载失败:', err);
    }
    return false;
  }
}

// ==================== LOGIN ====================
function showLogin() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    const input = document.getElementById('loginKeyInput');
    if (input) { input.value = ''; input.focus(); }
  }
}

function hideLogin() {
  const overlay = document.getElementById('loginOverlay');
  if (overlay) overlay.classList.add('hidden');
}

async function doLogin() {
  const input = document.getElementById('loginKeyInput');
  const btn = document.getElementById('loginBtn');
  const err = document.getElementById('loginError');
  const key = input.value.trim();
  if (!key) { err.textContent = '请输入密钥'; return; }
  btn.disabled = true;
  err.textContent = '登录中...';
  try {
    await apiLogin(key);
    err.textContent = '';
    hideLogin();
    setConnection('loading');
    await loadTasks();
    setupRealtime();
    renderAll();
  } catch (e) {
    err.textContent = e.message || '登录失败，请重试';
    input.value = '';
    input.focus();
  } finally {
    btn.disabled = false;
  }
}

// Login: button click
document.getElementById('loginBtn').addEventListener('click', doLogin);
// Login: enter key
document.getElementById('loginKeyInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

async function doLogout() {
  await apiLogout();
  tasks = [];
  renderAll();
  setConnection('offline');
  showLogin();
}

async function doSaveTask() {
  const title = document.getElementById('taskTitle').value.trim();
  if (!title) { showToast('请输入任务标题', 'error'); return; }

  const recType = document.getElementById('taskRecurrenceType').value;
  let recurrence = null;
  if (recType) {
    const endType = document.getElementById('taskRecurrenceEnd').value;
    recurrence = { type: recType };
    if (recType === 'weekly' && weeklyDays.size > 0) {
      recurrence.weekdays = Array.from(weeklyDays).sort();
    }
    if (endType === 'count') recurrence.remaining = parseInt(document.getElementById('taskRecurrenceCount').value) || 5;
    if (endType === 'date') recurrence.endDate = document.getElementById('taskRecurrenceDate').value;
  }

  const data = {
    title,
    desc: document.getElementById('taskDesc').value.trim(),
    status: editingId ? (tasks.find(t => t.id === editingId)?.status || 'todo') : 'todo',
    priority: document.querySelector('.priority-btn.active')?.dataset.priority || 'medium',
    date: document.getElementById('taskDate').value,
    tags: currentTags,
    order: editingId ? (tasks.find(t => t.id === editingId)?.order || 0) : 0,
    recurrence,
    subtasks: editingSubtasks.filter(s => s.title.trim()),
  };

  try {
    if (editingId) {
      const updated = await apiUpdateTask(editingId, data);
      const idx = tasks.findIndex(t => t.id === editingId);
      if (idx >= 0) tasks[idx] = updated;
    } else {
      const created = await apiCreateTask(data);
      editingId = created.id;
      tasks.push(created);
    }
    // Auto-complete: all subtasks done → mark parent done
    const validSubs = data.subtasks.filter(s => s.title.trim());
    if (validSubs.length > 0 && validSubs.every(s => s.done) && data.status !== 'done') {
      await apiPatchTask(editingId, { status: 'done' });
      const savedTask = tasks.find(t => t.id === editingId);
      if (savedTask) savedTask.status = 'done';
      // 处理循环任务
      if (savedTask && savedTask.recurrence && savedTask.recurrence.type) {
        const nextTask = createNextRecurrence(savedTask);
        if (nextTask) {
          savedTask.recurrence = null;
          await apiPatchTask(editingId, { recurrence: null });
          const created = await apiCreateTask(nextTask);
          tasks.push(created);
        }
      }
    }
    closeModal();
    renderAll();
    showToast(editingId ? '任务已更新' : '任务已创建', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function doDeleteTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  try {
    await apiDeleteTask(id);
    const delIdx = tasks.findIndex(t => t.id === id);
    if (delIdx >= 0) tasks.splice(delIdx, 1);
    if (editingId === id) closeModal();
    renderAll();
    // Show undo bar
    const timeout = setTimeout(() => { document.getElementById('undoBar').style.display = 'none'; }, 5000);
    undoState = { id: task.id, title: task.title, desc: task.desc, status: task.status, priority: task.priority, date: task.date, tags: task.tags, timeout };
    document.getElementById('undoText').textContent = `已删除「${task.title}」`;
    document.getElementById('undoBar').style.display = 'flex';
  } catch (err) {
    showToast('删除失败', 'error');
  }
}

let undoState = null;
async function undoDelete() {
  if (!undoState) return;
  clearTimeout(undoState.timeout);
  document.getElementById('undoBar').style.display = 'none';
  try {
    const created = await apiCreateTask({ title: undoState.title, desc: undoState.desc, status: undoState.status, priority: undoState.priority, date: undoState.date, tags: undoState.tags });
    tasks.push(created);
    renderAll();
    showToast('已撤销删除', 'success');
    undoState = null;
  } catch { showToast('撤销失败', 'error'); }
}

// ==================== SUBTASK MANAGEMENT ====================
let editingSubtasks = []; // [{id, title, done}] - only used in modal editing

function renderSubtaskList() {
  const list = document.getElementById('subtaskList');
  if (!editingSubtasks.length) {
    list.innerHTML = '<div style="font-size:0.75rem;color:#ccc;padding:0.25rem 0;">暂无子任务</div>';
    updateSubtaskProgress();
    return;
  }
  list.innerHTML = editingSubtasks.map((s, i) => `
    <div class="subtask-row">
      <input type="checkbox" ${s.done ? 'checked' : ''} onchange="toggleSubtaskDone(${i})">
      <input type="text" value="${esc(s.title)}" onchange="updateSubtaskTitle(${i}, this.value)" class="${s.done ? 'subtask-done' : ''}">
      <button class="subtask-del" onclick="removeSubtask(${i})" title="删除">✕</button>
    </div>
  `).join('');
  updateSubtaskProgress();
}

function updateSubtaskProgress() {
  const total = editingSubtasks.length;
  const done = editingSubtasks.filter(s => s.done).length;
  document.getElementById('subtaskProgress').textContent =
    total ? `${done}/${total} 已完成` : '';
}

function addSubtask() {
  const input = document.getElementById('subtaskInput');
  const title = input.value.trim();
  if (!title) { showToast('请输入子任务标题', 'error'); return; }
  editingSubtasks.push({ id: 's_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), title, done: false });
  input.value = '';
  renderSubtaskList();
  input.focus();
}

function removeSubtask(index) {
  editingSubtasks.splice(index, 1);
  renderSubtaskList();
}

function toggleSubtaskDone(index) {
  editingSubtasks[index].done = !editingSubtasks[index].done;
  renderSubtaskList();
}

function updateSubtaskTitle(index, val) {
  editingSubtasks[index].title = val.trim() || editingSubtasks[index].title;
  renderSubtaskList();
}

function subtaskProgress(task) {
  const subs = task.subtasks || [];
  if (!subs.length) return null;
  const done = subs.filter(s => s.done).length;
  return { total: subs.length, done };
}

function subtaskInlineCardHTML(task) {
  const subs = task.subtasks || [];
  if (!subs.length) return '';
  const done = subs.filter(s => s.done).length;
  const pct = Math.round((done / subs.length) * 100);
  return `
    <div class="subtask-card-progress">
      <div class="subtask-card-bar"><div class="subtask-card-fill" style="width:${pct}%"></div></div>
      <span class="subtask-card-label">${done}/${subs.length}</span>
    </div>
    <div class="subtask-card-list" onclick="event.stopPropagation()">
      ${subs.map((s, i) => `
        <label class="subtask-card-item" onclick="event.stopPropagation()" title="${esc(s.title)}">
          <input type="checkbox" ${s.done ? 'checked' : ''} onchange="event.stopPropagation();toggleSubtaskInCard('${task.id}', ${i})">
          <span class="${s.done ? 'subtask-card-text done' : 'subtask-card-text'}">${esc(s.title)}</span>
        </label>
      `).join('')}
    </div>`;
}

function toggleSubtaskInCard(taskId, index) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || !task.subtasks || !task.subtasks[index]) return;
  const oldStatus = task.status;
  const oldSubs = task.subtasks.map(s => ({ ...s }));

  // 乐观更新：先改本地
  task.subtasks[index].done = !task.subtasks[index].done;
  const subs = task.subtasks.map(s => ({ ...s }));
  const allDone = subs.length > 0 && subs.every(s => s.done);
  if (allDone !== (oldStatus === 'done')) {
    task.status = allDone ? 'done' : 'todo';
  }
  renderAll();

  // 后台同步（失败时回滚）
  const patchData = { subtasks: subs };
  if (allDone !== (oldStatus === 'done')) {
    patchData.status = allDone ? 'done' : 'todo';
  }
  apiPatchTask(taskId, patchData)
    .then(() => {})
    .catch(e => {
      console.error('乐观同步失败，已回滚:', e);
      task.status = oldStatus;
      task.subtasks = oldSubs;
      showToast('数据同步失败，已回滚', 'error');
      renderAll();
    });
}

// ==================== RENDER HELPERS ====================
function taskCardHTML(task) {
  const cls = `task-card priority-${task.priority}`;
  return `
    <div class="${cls}" draggable="true" data-id="${task.id}" data-status="${task.status}">
      <div class="task-card-actions">
        <button onclick="event.stopPropagation(); editTask('${task.id}')" title="编辑">✎</button>
        <button class="del" onclick="event.stopPropagation(); doDeleteTask('${task.id}')" title="删除">✕</button>
      </div>
      <div class="task-card-title-line">
        <span class="priority-tag ${task.priority}">${priorityLabel(task.priority)}</span>
        <span class="task-card-title">${esc(task.title)}</span>
        ${task.desc ? `<span class="task-card-desc-inline">${esc(task.desc)}</span>` : ''}
      </div>
      ${subtaskInlineCardHTML(task)}
      <div class="task-card-meta">
        ${task.date ? `<span>📅 ${task.date}</span>` : ''}
        ${tagChipsHTML(task.tags || [])}
      </div>
    </div>`;
}

function esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function priorityLabel(p) { return {high:'高',medium:'中',low:'低'}[p] || p; }
const PRIO_SORT = { high: 0, medium: 1, low: 2 };
function sortByPriority(a, b) {
  const pa = PRIO_SORT[a.priority] ?? 1;
  const pb = PRIO_SORT[b.priority] ?? 1;
  if (pa !== pb) return pa - pb;
  return (a.order || 0) - (b.order || 0);
}
function statusLabel(s) { return {todo:'待办',done:'已完成'}[s] || s; }
function recurrenceLabel(r) {
  if (!r || !r.type) return '';
  const map = { daily:'每天', weekdays:'工作日', weekly:'每周' };
  let s = '🔄 ' + (map[r.type] || r.type);
  if (r.type === 'weekly' && r.weekdays && r.weekdays.length > 0) {
    const dayNames = ['日','一','二','三','四','五','六'];
    s += ' (' + r.weekdays.map(function(d) { return dayNames[d]; }).join('') + ')';
  }
  if (r.remaining !== null && r.remaining !== undefined) s += ' · 剩余' + r.remaining + '次';
  if (r.endDate) s += ' · 至' + r.endDate;
  return s;
}

function onRecurrenceTypeChange() {
  const type = document.getElementById('taskRecurrenceType').value;
  document.getElementById('weeklyDayPicker').style.display = type === 'weekly' ? 'block' : 'none';
  document.getElementById('recurrenceOptions').style.display = type !== '' ? 'block' : 'none';
}
function onRecurrenceEndChange() {
  const v = document.getElementById('taskRecurrenceEnd').value;
  document.getElementById('taskRecurrenceCount').style.display = v === 'count' ? 'inline-block' : 'none';
  document.getElementById('taskRecurrenceDate').style.display = v === 'date' ? 'inline-block' : 'none';
}

// ==================== TAG MANAGEMENT ====================
let currentTags = [];
function getAllTags() {
  const set = new Set();
  tasks.forEach(t => (t.tags || []).forEach(tag => set.add(tag)));
  return [...set].sort();
}
function tagChipsHTML(tags) {
  return (tags || []).map(t => `<span class="tag-chip">${esc(t)}</span>`).join('');
}
function initTagInput(initial) {
  currentTags = [...(initial || [])];
  renderTagChips();
  document.getElementById('tagInput').value = '';
}
function renderTagChips() {
  const wrap = document.getElementById('tagInputWrap');
  const input = document.getElementById('tagInput');
  wrap.querySelectorAll('.tag-chip').forEach(c => c.remove());
  currentTags.forEach((tag, i) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.innerHTML = `${esc(tag)}<span class="tag-remove" data-idx="${i}">×</span>`;
    chip.querySelector('.tag-remove').addEventListener('click', e => {
      e.stopPropagation();
      currentTags.splice(i, 1);
      renderTagChips();
    });
    wrap.insertBefore(chip, input);
  });
}
function addTagFromInput() {
  const input = document.getElementById('tagInput');
  const val = input.value.trim();
  if (!val || currentTags.includes(val)) { input.value = ''; hideSuggestions(); return; }
  currentTags.push(val);
  input.value = '';
  renderTagChips();
  hideSuggestions();
}
function showSuggestions(query) {
  const el = document.getElementById('tagSuggestions');
  const all = getAllTags().filter(t => !currentTags.includes(t));
  if (!query.trim() || all.length === 0) { el.classList.remove('show'); return; }
  const q = query.toLowerCase();
  const matches = all.filter(t => t.toLowerCase().includes(q));
  if (matches.length === 0) { el.classList.remove('show'); return; }
  el.innerHTML = matches.map(t => `<div class="tag-suggestion">${esc(t)}</div>`).join('');
  el.querySelectorAll('.tag-suggestion').forEach(div => {
    div.addEventListener('mousedown', e => {
      e.preventDefault();
      currentTags.push(div.textContent);
      document.getElementById('tagInput').value = '';
      renderTagChips();
      hideSuggestions();
      document.getElementById('tagInput').focus();
    });
  });
  el.classList.add('show');
}
function hideSuggestions() {
  document.getElementById('tagSuggestions').classList.remove('show');
}

// ==================== RECURRENCE HELPERS ====================
function calcNextDate(dateStr, type) {
  const d = new Date(dateStr + 'T00:00:00');
  if (type === 'daily') { d.setDate(d.getDate() + 1); return d; }
  if (type === 'weekdays') {
    do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
    return d;
  }
  if (type === 'weekly') { d.setDate(d.getDate() + 7); return d; }
  return null;
}

function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function createNextRecurrence(task) {
  const { type, remaining, endDate } = task.recurrence;
  if (!type) return null;
  if (typeof remaining === 'number' && remaining <= 0) return null;

  const next = calcNextDate(task.date, type);
  if (!next) return null;
  const nextStr = fmtDate(next);
  if (endDate && nextStr > endDate) return null;

  const nextTask = {
    title: task.title,
    desc: task.desc || '',
    status: 'todo',
    priority: task.priority,
    date: nextStr,
    tags: [...(task.tags || [])],
    order: Date.now() % 2000000000,
    recurrence: {
      type,
      remaining: typeof remaining === 'number' ? remaining - 1 : null,
      endDate: endDate || null,
    },
    subtasks: (task.subtasks || []).map(s => ({ ...s, done: false })),
  };
  if (!nextTask.tags.includes('循环')) nextTask.tags.push('循环');
  return nextTask;
}

// ==================== TOGGLE STATUS ====================
function toggleTaskStatus(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const newStatus = task.status === 'done' ? 'todo' : 'done';

  const prevStatus = task.status;
  const subs = task.subtasks;
  const prevSubs = subs ? subs.map(s => ({ ...s })) : null;

  // 乐观更新：先改本地
  task.status = newStatus;
  let patchData = { status: newStatus };
  if (subs && subs.length > 0) {
    const needsUpdate = subs.some(s => s.done !== (newStatus === 'done'));
    if (needsUpdate) {
      subs.forEach(s => s.done = newStatus === 'done');
      patchData.subtasks = subs.map(s => ({ ...s }));
    }
  }

  // 处理循环任务：完成后生成下一个实例
  let nextTask = null;
  if (newStatus === 'done' && task.recurrence && task.recurrence.type) {
    nextTask = createNextRecurrence(task);
    if (nextTask) {
      patchData.recurrence = null; // 移除当前任务的循环标记
      task.recurrence = null;
    }
  }

  renderAll();

  // 后台同步当前任务（失败时回滚）
  apiPatchTask(id, patchData)
    .then(() => {})
    .catch(e => {
      console.error('乐观同步失败，已回滚:', e);
      task.status = prevStatus;
      if (prevSubs && subs) task.subtasks = prevSubs;
      showToast('数据同步失败，已回滚', 'error');
      renderAll();
    });

  // 后台创建下一个循环实例
  if (nextTask) {
    apiCreateTask(nextTask)
      .then(newT => { tasks.push(newT); renderAll(); })
      .catch(e => { console.error('创建循环任务失败:', e); });
  }
}

// ==================== BULK SELECT ====================
let selectMode = false;
let selectedIds = new Set();

function toggleSelectMode() {
  selectMode = !selectMode;
  selectedIds = new Set();
  document.getElementById('selectBar').style.display = selectMode ? 'flex' : 'none';
  document.getElementById('btnSelectMode').textContent = selectMode ? '退出' : '多选';
  updateSelectCount();
  renderOverview();
}

function updateSelectCount() {
  document.getElementById('selectCount').textContent = `已选 ${selectedIds.size} 项`;
}

function onTaskCheck() {
  // Rebuild selectedIds from all checked checkboxes
  selectedIds = new Set();
  document.querySelectorAll('.task-cb:checked').forEach(cb => selectedIds.add(cb.dataset.id));
  updateSelectCount();
  // Update select all checkbox
  const allBox = document.getElementById('selectAllCB');
  if (allBox) {
    const totalCBs = document.querySelectorAll('.task-cb').length;
    allBox.checked = selectedIds.size === totalCBs && totalCBs > 0;
    allBox.indeterminate = selectedIds.size > 0 && selectedIds.size < totalCBs;
  }
}

function toggleSelectAll() {
  const checked = document.getElementById('selectAllCB').checked;
  document.querySelectorAll('.task-cb').forEach(cb => {
    cb.checked = checked;
    if (checked) selectedIds.add(cb.dataset.id); else selectedIds.delete(cb.dataset.id);
  });
  if (!checked) selectedIds.clear();
  updateSelectCount();
}

async function bulkDelete() {
  if (selectedIds.size === 0) return;
  if (!confirm(`确定要删除 ${selectedIds.size} 个任务吗？此操作不可恢复。`)) return;
  let ok = 0;
  for (const id of selectedIds) {
    try { await apiDeleteTask(id); ok++; } catch {}
  }
  // 从本地数组移除
  for (const id of selectedIds) {
    const idx = tasks.findIndex(t => t.id === id);
    if (idx >= 0) tasks.splice(idx, 1);
  }
  selectedIds.clear();
  selectMode = false;
  document.getElementById('selectBar').style.display = 'none';
  document.getElementById('btnSelectMode').textContent = '☐ 多选';
  renderAll();
  showToast(`${ok} 个任务已删除`, 'success');
}

function showBulkTagInput() {
  document.getElementById('bulkTagBtn').style.display = 'none';
  const inp = document.getElementById('bulkTagInput');
  inp.style.display = '';
  inp.value = '';
  inp.focus();
}
function hideBulkTagInput() {
  document.getElementById('bulkTagBtn').style.display = '';
  document.getElementById('bulkTagInput').style.display = 'none';
}
async function bulkAddTag() {
  const inp = document.getElementById('bulkTagInput');
  const tagName = inp.value.trim();
  if (!tagName || selectedIds.size === 0) { hideBulkTagInput(); return; }
  let ok = 0;
  for (const id of selectedIds) {
    try {
      const t = tasks.find(t2 => t2.id === id);
      const newTags = [...(t ? t.tags || [] : [])];
      if (!newTags.includes(tagName)) newTags.push(tagName);
      await apiPatchTask(id, { tags: newTags });
      if (t) t.tags = newTags;
      ok++;
    } catch {}
  }
  hideBulkTagInput();
  selectedIds.clear();
  selectMode = false;
  document.getElementById('selectBar').style.display = 'none';
  document.getElementById('btnSelectMode').textContent = '☐ 多选';
  renderAll();
  showToast(`已为 ${ok} 个任务添加标签「${tagName}」`, 'success');
}

async function bulkSetPriority() {
  const prio = document.getElementById('bulkPriority').value;
  if (!prio || selectedIds.size === 0) return;
  let ok = 0;
  for (const id of selectedIds) {
    try {
      await apiPatchTask(id, { priority: prio });
      const t = tasks.find(t2 => t2.id === id);
      if (t) t.priority = prio;
      ok++;
    } catch {}
  }
  document.getElementById('bulkPriority').value = '';
  selectedIds.clear();
  selectMode = false;
  document.getElementById('selectBar').style.display = 'none';
  document.getElementById('btnSelectMode').textContent = '☐ 多选';
  renderAll();
  showToast(`${ok} 个任务优先级已更新`, 'success');
}

function bulkSetDate(e) {
  if (selectedIds.size === 0) return;
  const ids = [...selectedIds];
  const inp = document.createElement('input');
  inp.type = 'date';
  const rect = e.currentTarget.getBoundingClientRect();
  inp.style.cssText = `position:fixed;z-index:999;top:${rect.bottom + 2}px;left:${rect.left}px;opacity:0;pointer-events:none;`;
  document.body.appendChild(inp);
  requestAnimationFrame(() => {
    inp.showPicker ? inp.showPicker() : inp.click();
  });
  inp.addEventListener('change', async () => {
    const date = inp.value;
    inp.remove();
    if (!date) return;
    let ok = 0;
    for (const id of ids) {
      try {
        await apiPatchTask(id, { date });
        const t = tasks.find(t2 => t2.id === id);
        if (t) t.date = date;
        ok++;
      } catch {}
    }
    selectedIds.clear();
    selectMode = false;
    document.getElementById('selectBar').style.display = 'none';
    document.getElementById('btnSelectMode').textContent = '☐ 多选';
    renderAll();
    showToast(`${ok} 个任务日期已更新`, 'success');
  });
  inp.addEventListener('blur', () => {
    setTimeout(() => { if (document.body.contains(inp)) inp.remove(); }, 300);
  });
}

function toggleArchive() {
  const cb = document.getElementById('archiveToggle');
  cb.checked = !cb.checked;
  document.getElementById('archiveLabel').classList.toggle('off', !cb.checked);
  renderOverview();
}

// ==================== PROGRESS BAR ====================
function updateProgress() {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const inboxCount = tasks.filter(t => !t.date).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById('progressBar').style.width = pct + '%';
  document.getElementById('progressText').textContent = pct + '%';
  document.getElementById('progressDetail').textContent =
    total ? `${done}/${total} 已完成` : '暂无任务';
  document.getElementById('progressInbox').textContent =
    inboxCount ? `📥 ${inboxCount} 条待排期` : '';
}

// ==================== OVERVIEW ====================
function renderOverview() {
  const search = (document.getElementById('overviewSearch')?.value || '').toLowerCase();
  const filter = document.getElementById('overviewFilter')?.value || 'all';
  const priority = document.getElementById('overviewPriority')?.value || 'all';
  const tagFilter = document.getElementById('overviewTag')?.value || 'all';

  // Update tag dropdown
  const tagSelect = document.getElementById('overviewTag');
  const currentVal = tagSelect.value;
  const allTags = getAllTags();
  tagSelect.innerHTML = '<option value="all">标签</option>' + allTags.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  tagSelect.value = allTags.includes(currentVal) ? currentVal : 'all';

  // 同步侧边栏标签高亮
  sidebarTagFilter = tagFilter;
  renderSidebarTags();

  let filtered = tasks;
  // Archive toggle: hide done tasks by default
  const hideDone = document.getElementById('archiveToggle')?.checked;
  if (hideDone && filter !== 'done') filtered = filtered.filter(t => t.status !== 'done');
  if (search) filtered = filtered.filter(t =>
    t.title.toLowerCase().includes(search) ||
    (t.desc||'').toLowerCase().includes(search) ||
    (t.tags || []).some(tag => tag.toLowerCase().includes(search)) ||
    (t.subtasks || []).some(sub => sub.title.toLowerCase().includes(search))
  );
  if (filter !== 'all') filtered = filtered.filter(t => t.status === filter);
  if (priority !== 'all') filtered = filtered.filter(t => t.priority === priority);
  if (tagFilter !== 'all') filtered = filtered.filter(t => (t.tags || []).includes(tagFilter));

  // 排序：日期升序（无日期排最后）→ 优先级降序（high>medium>low）
  const priorityWeight = { high: 3, medium: 2, low: 1 };
  filtered.sort((a, b) => {
    // 无日期排最后
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    // 日期升序
    const dCmp = a.date.localeCompare(b.date);
    if (dCmp !== 0) return dCmp;
    // 优先级降序
    return (priorityWeight[b.priority] || 1) - (priorityWeight[a.priority] || 1);
  });

  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const todo = tasks.filter(t => t.status === 'todo').length;

  document.getElementById('overviewStats').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon total">📋</div>
      <div><div class="stat-val">${total}</div><div class="stat-label">总任务</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon done">✅</div>
      <div><div class="stat-val">${done}</div><div class="stat-label">已完成</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon" style="background:#fff1f0;">📌</div>
      <div><div class="stat-val">${todo}</div><div class="stat-label">待办</div></div>
    </div>
  `;

  const wrap = document.getElementById('overviewTableWrap');
  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="icon">📭</div><div class="text">没有匹配的任务</div></div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="overview-table">
      <thead>
        <tr>
          <th style="width:2.5rem;">${selectMode ? '<input type="checkbox" id="selectAllCB" onchange="toggleSelectAll()">' : ''}</th>
          <th>任务</th>
          <th>优先级</th>
          <th>标签</th>
          <th>日期</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        ${filtered.map(t => `
          <tr>
            <td>${selectMode ? `<input type="checkbox" class="task-cb" data-id="${t.id}" onchange="onTaskCheck()" ${selectedIds.has(t.id)?'checked':''}>` : `<span class="cb-circle${t.status==='done'?' checked':''}" onclick="event.stopPropagation();toggleTaskStatus('${t.id}')" title="${t.status==='done'?'标记为待办':'标记为完成'}"></span>`}</td>
            <td><span class="${t.status==='done'?'task-done':''}"><strong>${esc(t.title)}</strong>${subtaskProgress(t) ? `<span class="overview-subtask">(${subtaskProgress(t).done}/${subtaskProgress(t).total})</span>` : ''}${t.desc ? `<span class="overview-desc">${esc(t.desc)}</span>` : ''}</span></td>
            <td><span class="priority-tag ${t.priority}">${priorityLabel(t.priority)}</span></td>
            <td>${tagChipsHTML(t.tags || [])}</td>
            <td>${t.date || '-'}</td>
            <td>
              <button class="btn btn-ghost" style="padding:0.125rem 0.5rem;font-size:0.75rem;" onclick="editTask('${t.id}')">编辑</button>
              <button class="btn btn-ghost" style="padding:0.125rem 0.5rem;font-size:0.75rem;color:#cf1322;" onclick="doDeleteTask('${t.id}')">删除</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

// ==================== INBOX ====================
function renderInbox() {
  const search = (document.getElementById('inboxSearch')?.value || '').toLowerCase();
  const filter = document.getElementById('inboxFilter')?.value || 'all';
  const priority = document.getElementById('inboxPriority')?.value || 'all';

  let inboxTasks = tasks.filter(t => !t.date).sort((a, b) => (a.order || 0) - (b.order || 0));
  if (filter !== 'all') inboxTasks = inboxTasks.filter(t => t.status === filter);
  if (priority !== 'all') inboxTasks = inboxTasks.filter(t => t.priority === priority);
  // 归档开关：隐藏已完成
  const archiveDone = document.getElementById('inboxArchiveToggle')?.checked;
  if (archiveDone && filter !== 'done') inboxTasks = inboxTasks.filter(t => t.status !== 'done');
  if (search) inboxTasks = inboxTasks.filter(t =>
    t.title.toLowerCase().includes(search) ||
    (t.desc||'').toLowerCase().includes(search)
  );

  const list = document.getElementById('inboxList');
  if (!inboxTasks.length) {
    list.innerHTML = `<div class="inbox-empty"><div class="icon">📭</div><div class="text">收件箱空空如也</div></div>`;
    return;
  }

  list.innerHTML = inboxTasks.map(t => `
    <div class="inbox-item priority-${t.priority}${t.status === 'done' ? ' done' : ''}" draggable="true" data-id="${t.id}">
      <span class="cb-circle${t.status === 'done' ? ' checked' : ''}"
            onclick="toggleTaskStatus('${t.id}')" title="${t.status === 'done' ? '标记待办' : '标记完成'}"></span>
      <div class="inbox-item-body">
        <div class="inbox-item-title${t.status === 'done' ? ' done' : ''}">
          <span class="priority-tag ${t.priority}">${priorityLabel(t.priority)}</span>
          <span class="inbox-title-text">${esc(t.title)}${subtaskProgress(t) ? ` <span style="font-size:0.75rem;color:#888">(${subtaskProgress(t).done}/${subtaskProgress(t).total})</span>` : ''}</span>
        </div>
        ${t.desc ? `<div class="inbox-item-desc">${esc(t.desc)}</div>` : ''}
      </div>
      ${(t.tags||[]).length ? `<span class="inbox-tags">${tagChipsHTML(t.tags)}</span>` : ''}
      <div class="inbox-item-actions">
        <button class="inbox-btn assign-date" onclick="assignInboxDate('${t.id}', event)" title="分配日期">📅</button>
        <button class="inbox-btn" onclick="editTask('${t.id}')" title="编辑">✎</button>
        <button class="inbox-btn del" onclick="doDeleteTask('${t.id}')" title="删除">✕</button>
      </div>
    </div>
  `).join('');
  setupInboxDragDrop();
}

function inboxQuickAdd() {
  const input = document.getElementById('inboxInput');
  const title = input.value.trim();
  if (!title) { showToast('请输入任务标题', 'error'); return; }
  apiCreateTask({
    title,
    desc: '',
    status: 'todo',
    priority: 'medium',
    date: '',
    tags: []
  }).then(created => {
    input.value = '';
    tasks.push(created);
    renderAll();
    showToast('已添加到收件箱', 'success');
  }).catch(e => showToast(e.message, 'error'));
}

function toggleInboxArchive() {
  const cb = document.getElementById('inboxArchiveToggle');
  cb.checked = !cb.checked;
  document.getElementById('inboxArchiveLabel').classList.toggle('off', !cb.checked);
  localStorage.setItem('task-inbox-archive', cb.checked ? '1' : '0');
  renderInbox();
}

function assignInboxDate(id, e) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  const btn = e.currentTarget || e.target;
  const rect = btn.getBoundingClientRect();
  dateInput.style.cssText = `position:fixed;z-index:999;top:${rect.bottom + 2}px;left:${rect.left}px;opacity:0;pointer-events:none;`;
  document.body.appendChild(dateInput);
  requestAnimationFrame(() => {
    dateInput.showPicker ? dateInput.showPicker() : dateInput.click();
  });
  dateInput.addEventListener('change', async () => {
    if (dateInput.value) {
      try {
        await apiPatchTask(id, { date: dateInput.value });
        const t = tasks.find(t2 => t2.id === id);
        if (t) t.date = dateInput.value;
        renderAll();
        showToast(`已排期至 ${dateInput.value}`, 'success');
      } catch (e) { showToast('排期失败', 'error'); }
    }
    document.body.removeChild(dateInput);
  });
  dateInput.addEventListener('blur', () => {
    setTimeout(() => { if (document.body.contains(dateInput)) document.body.removeChild(dateInput); }, 300);
  });
}

// ==================== TODAY VIEW ====================
function renderKanban() {
  const dateStr = dayViewDate || todayStr();
  const isToday = dateStr === todayStr();

  // Header
  const d = new Date(dateStr + 'T00:00:00');
  const weekNames = ['周日','周一','周二','周三','周四','周五','周六'];
  document.getElementById('todayDateTitle').textContent = isToday ? '今天' : `${d.getMonth()+1}月${d.getDate()}日`;
  document.getElementById('todayDateSub').textContent = isToday
    ? `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 ${weekNames[d.getDay()]}`
    : `${d.getFullYear()}年 ${weekNames[d.getDay()]}`;

  // Show/hide "回到今天" button
  document.getElementById('btnGoToday').style.display = isToday ? 'none' : '';

  const dayTasks = tasks.filter(t => t.date === dateStr);
  const total = dayTasks.length;
  const done = dayTasks.filter(t => t.status === 'done').length;
  const todo = total - done;

  // Progress ring
  const pct = total ? Math.round((done / total) * 100) : 0;
  const ring = document.getElementById('todayProgressRing');
  ring.style.background = `conic-gradient(#52c41a ${pct * 3.6}deg, #e8e8e8 0deg)`;
  document.getElementById('todayProgressInner').textContent = `${done}/${total}`;

  // Task list: todo first, then done
  const sorted = [...dayTasks].sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    return (a.order || 0) - (b.order || 0);
  });

const list = document.getElementById('todayList');
  if (!sorted.length) {
    list.innerHTML = `
      <div class="today-empty">
        <div class="icon">☀️</div>
        <div class="text">今天还没有任务，点击「+ 添加」开始</div>
      </div>`;
  } else {
    list.innerHTML = sorted.map(t => `
      <div class="today-task priority-${t.priority}${t.status === 'done' ? ' done' : ''}" draggable="true" data-id="${t.id}" data-status="${t.status}">
        <div class="today-check" onclick="event.stopPropagation(); toggleTaskStatus('${t.id}')">✓</div>
        <div class="today-task-body" onclick="editTask('${t.id}')">
          <div class="today-task-title">${esc(t.title)}</div>
          ${t.desc ? `<div class="today-task-desc">${esc(t.desc)}</div>` : ''}
          ${todaySubtasksHTML(t)}
        </div>
        ${(t.tags && t.tags.length) ? `<div class="today-task-tags">${tagChipsHTML(t.tags)}</div>` : ''}
        </div>
      </div>`).join('');
  }

  setupTodayDragDrop();
}

function todaySubtasksHTML(task) {
  const subs = task.subtasks || [];
  if (!subs.length) return '';
  return `<div class="today-subtasks" onclick="event.stopPropagation()">
    ${subs.map((s, i) => `
      <label class="today-subtask-item">
        <input type="checkbox" ${s.done ? 'checked' : ''} onchange="event.stopPropagation();toggleSubtaskInCard('${task.id}', ${i})">
        <span class="${s.done ? 'subtask-card-text done' : 'subtask-card-text'}">${esc(s.title)}</span>
      </label>
    `).join('')}
  </div>`;
}

function setupTodayDragDrop() {
  const list = document.getElementById('todayList');
  if (!list || list._tdSetup) return;
  list._tdSetup = true;

  list.addEventListener('dragover', e => {
    e.preventDefault();
    const taskEl = e.target.closest('.today-task');
    if (!taskEl || taskEl.dataset.id === draggedTaskId) return;
    const rect = taskEl.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (e.clientY < mid) {
      taskEl.classList.add('drop-before');
      taskEl.classList.remove('drop-after');
    } else {
      taskEl.classList.add('drop-after');
      taskEl.classList.remove('drop-before');
    }
  });

  list.addEventListener('dragleave', e => {
    const taskEl = e.target.closest('.today-task');
    if (taskEl) { taskEl.classList.remove('drop-before', 'drop-after'); }
  });

  list.addEventListener('drop', async e => {
    e.preventDefault();
    list.querySelectorAll('.today-task').forEach(el => el.classList.remove('drop-before', 'drop-after'));

    const targetEl = e.target.closest('.today-task');
    const taskId = draggedTaskId;
    if (!taskId || !targetEl || targetEl.dataset.id === taskId) return;

    const targetTask = tasks.find(t => t.id === targetEl.dataset.id);
    const dragTask = tasks.find(t => t.id === taskId);
    if (!targetTask || !dragTask) return;

    const rect = targetEl.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;

    // Reorder in today's date tasks
    const dateStr = dayViewDate || todayStr();
    const dateTasks = tasks.filter(t => t.date === dateStr).sort((a, b) => (a.order || 0) - (b.order || 0));
    const targetIdx = dateTasks.findIndex(t => t.id === targetTask.id);
    const newIdx = before ? targetIdx : targetIdx + 1;

    // Calculate new order
    const prevOrder = newIdx > 0 ? dateTasks[newIdx - 1].order || 0 : 0;
    const nextOrder = newIdx < dateTasks.length ? dateTasks[newIdx].order || (prevOrder + 1) : prevOrder + 1;
    const newOrder = (prevOrder + nextOrder) / 2;

    dragTask.order = newOrder;
    renderAll();
    apiPatchTask(taskId, { order: newOrder }).catch(() => {});
  });

  // Clear indicators when leaving
  list.addEventListener('dragleave', e => {
    if (!list.contains(e.relatedTarget)) {
      list.querySelectorAll('.today-task').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    }
  });
}

// ==================== WEEK VIEW ====================
function getWeekRange(offset) {
  const now = new Date();
  const day = now.getDay() || 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - day + 1 + offset * 7);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }
  return days;
}

function renderWeek() {
  const days = getWeekRange(weekOffset);
  const fmt = d => {
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  };
  const fmtShort = d => {
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${m}-${day}`;
  };
  const today = todayStr();
  const weekNames = ['周一','周二','周三','周四','周五','周六','周日'];

  document.getElementById('weekTitle').textContent =
    `${fmtShort(days[0])} — ${fmtShort(days[6])}`;

  const list = document.getElementById('agendaList');
  const dayTasksMap = {};
  days.forEach(d => {
    const ds = fmt(d);
    dayTasksMap[ds] = { date: d, ds, tasks: tasks.filter(t => t.date === ds).sort(sortByPriority) };
  });

  let html = '';
  days.forEach((d, idx) => {
    const ds = fmt(d);
    const isToday = ds === today;
    const isWeekend = idx >= 5;
    const group = dayTasksMap[ds];
    const dayTasks = group.tasks;

    html += `<div class="agenda-day-group" data-date="${ds}">
      <div class="agenda-day-header${isToday?' today':''}${isWeekend?' weekend':''}" onclick="openDayView('${ds}')" title="点击跳转日视图">
        <span class="agenda-date-badge">${d.getDate()}</span>
        <span class="agenda-day-name">${weekNames[idx]}</span>
        <span class="agenda-day-count">${dayTasks.length ? dayTasks.length + '项' : ''}</span>
      </div>
      <div class="agenda-day-body" data-date="${ds}">`;

    if (!dayTasks.length) {
      html += `<div class="agenda-item" style="justify-content:center;color:#ddd;cursor:default;font-size:0.75rem;">— 无任务 —</div>`;
    } else {
      dayTasks.forEach(t => {
        const checked = t.status === 'done' ? ' checked' : '';
        html += `<div class="agenda-item priority-${t.priority||'medium'}${t.status==='done'?' done':''}" draggable="true" data-id="${t.id}" data-status="${t.status}" onclick="editTask('${t.id}')" title="点击编辑任务">
          <input type="checkbox" class="agenda-check"${checked} onclick="event.stopPropagation();toggleTaskStatus('${t.id}')" title="完成任务">
          <span class="agenda-item-title">${esc(t.title)}</span>`;
        if (t.tags && t.tags.length) {
          html += `<span class="agenda-item-tags">${t.tags.map(tg => `<span class="tag-chip">${esc(tg)}</span>`).join('')}</span>`;
        }
        html += `</div>`;
      });
    }

    html += `</div></div>`;
  });

  list.innerHTML = html;
  setupAgendaDragDrop();
}

function setupAgendaDragDrop() {
  // Drag start on agenda items
  document.querySelectorAll('#agendaList .agenda-item[draggable]').forEach(item => {
    item.addEventListener('dragstart', e => {
      if (e.target.tagName === 'INPUT') { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', item.dataset.id);
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', e => {
      item.classList.remove('dragging');
    });
  });

  // Drop targets: day bodies
  document.querySelectorAll('#agendaList .agenda-day-body').forEach(body => {
    body.addEventListener('dragover', e => {
      e.preventDefault();
      body.classList.add('drag-over');
      e.dataTransfer.dropEffect = 'move';
    });
    body.addEventListener('dragleave', () => body.classList.remove('drag-over'));
    body.addEventListener('drop', async e => {
      e.preventDefault();
      body.classList.remove('drag-over');
      const taskId = e.dataTransfer.getData('text/plain');
      const date = body.dataset.date;
      const task = tasks.find(t => t.id === taskId);
      if (task && date && task.date !== date) {
        try {
          await apiPatchTask(taskId, { date });
          task.date = date;
          renderAll();
        } catch { showToast('操作失败', 'error'); }
      }
    });
  });
}

// ==================== MONTH VIEW ====================
function renderMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + monthOffset;

  const titleDate = new Date(year, month, 1);
  document.getElementById('monthTitle').textContent =
    `${titleDate.getFullYear()}年 ${titleDate.getMonth()+1}月`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay() || 7;
  const totalDays = lastDay.getDate();

  const today = todayStr();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const calendar = document.getElementById('monthCalendar');
  const weekdays = ['一','二','三','四','五','六','日'];

  let html = weekdays.map((w,i) =>
    `<div class="month-weekday${i>=5?' weekend':''}">${w}</div>`
  ).join('');

  for (let i = startDow - 1; i > 0; i--) {
    const d = daysInPrevMonth - i + 1;
    html += `<div class="month-day other-month"><div class="month-day-num">${d}</div></div>`;
  }

  for (let d = 1; d <= totalDays; d++) {
    const ds = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = ds === today;
    const dayTasks = tasks.filter(t => t.date === ds).sort(sortByPriority);

    const total = dayTasks.length;
    const maxItems = 4;
    const visible = dayTasks.slice(0, maxItems);
    const hidden = dayTasks.length - maxItems;

    let itemsHTML = '';
    if (total > 0) {
      itemsHTML = visible.map(t => {
        const pcls = t.status === 'done' ? 'p-done' : t.priority === 'high' ? 'p-high' : t.priority === 'low' ? 'p-low' : 'p-none';
        return `<div class="month-card"><span class="month-priority-bar ${pcls}"></span><span class="month-card-text${t.status === 'done' ? ' done' : ''}">${esc(t.title)}</span></div>`;
      }).join('');
      if (hidden > 0) {
        itemsHTML += `<div class="month-day-more">+${hidden}</div>`;
      }
    }

    html += `
      <div class="month-day${isToday?' today':''}" data-date="${ds}" onclick="openDayView('${ds}')">
        <div class="month-day-num">${d}</div>
        <div class="month-day-items">
          ${itemsHTML}
        </div>
      </div>`;
  }

  const totalCells = startDow - 1 + totalDays;
  const remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
  for (let i = 1; i <= remaining; i++) {
    html += `<div class="month-day other-month"><div class="month-day-num">${i}</div></div>`;
  }

  calendar.innerHTML = html;
}

// ==================== MODAL ====================
function openAddModal(date) {
  editingId = null;
  titleParsed = false;
  document.getElementById('modalTitle').textContent = '新建任务';
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskDesc').value = '';
  // 日视图下添加任务，日期为空时自动取当前日视图日期
  const targetDate = date || (document.getElementById('view-day').classList.contains('active') ? dayViewDate || todayStr() : '');
  document.getElementById('taskDate').value = targetDate;
  document.getElementById('btnDeleteTask').style.display = 'none';
  // Reset priority buttons
  document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.priority-btn[data-priority="medium"]').classList.add('active');
  initTagInput([]);
  // Reset recurrence
  document.getElementById('taskRecurrenceType').value = '';
  document.getElementById('recurrenceOptions').style.display = 'none';
  document.getElementById('weeklyDayPicker').style.display = 'none';
  weeklyDays.clear();
  document.querySelectorAll('.wd-btn').forEach(function(b) { b.classList.remove('active'); });
  // Reset subtasks
  editingSubtasks = [];
  renderSubtaskList();
  document.getElementById('modalOverlay').classList.add('show');
  document.getElementById('taskTitle').focus();
}

function editTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  editingId = id;
  document.getElementById('modalTitle').textContent = '编辑任务';
  document.getElementById('taskTitle').value = task.title;
  document.getElementById('taskDesc').value = task.desc || '';
  document.getElementById('taskDate').value = task.date || '';
  document.getElementById('btnDeleteTask').style.display = 'inline-flex';
  // Set priority buttons
  document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
  const priorityBtn = document.querySelector(`.priority-btn[data-priority="${task.priority || 'medium'}"]`);
  if (priorityBtn) priorityBtn.classList.add('active');
  initTagInput(task.tags || []);
  // Set recurrence
  const rec = task.recurrence;
  if (rec && rec.type) {
    document.getElementById('taskRecurrenceType').value = rec.type;
    document.getElementById('recurrenceOptions').style.display = 'block';
    // Restore weekly days
    if (rec.type === 'weekly') {
      document.getElementById('weeklyDayPicker').style.display = 'block';
      weeklyDays = new Set(rec.weekdays || []);
      document.querySelectorAll('.wd-btn').forEach(function(btn) {
        if (weeklyDays.has(parseInt(btn.dataset.day))) btn.classList.add('active');
      });
    } else {
      document.getElementById('weeklyDayPicker').style.display = 'none';
      weeklyDays.clear();
    }
    if (rec.remaining !== null && rec.remaining !== undefined) {
      document.getElementById('taskRecurrenceEnd').value = 'count';
      document.getElementById('taskRecurrenceCount').value = rec.remaining;
      document.getElementById('taskRecurrenceCount').style.display = 'inline-block';
      document.getElementById('taskRecurrenceDate').style.display = 'none';
    } else if (rec.endDate) {
      document.getElementById('taskRecurrenceEnd').value = 'date';
      document.getElementById('taskRecurrenceDate').value = rec.endDate;
      document.getElementById('taskRecurrenceDate').style.display = 'inline-block';
      document.getElementById('taskRecurrenceCount').style.display = 'none';
    } else {
      document.getElementById('taskRecurrenceEnd').value = 'none';
      document.getElementById('taskRecurrenceCount').style.display = 'none';
      document.getElementById('taskRecurrenceDate').style.display = 'none';
    }
  } else {
    document.getElementById('taskRecurrenceType').value = '';
    document.getElementById('recurrenceOptions').style.display = 'none';
    document.getElementById('weeklyDayPicker').style.display = 'none';
    weeklyDays.clear();
  }
  // Load subtasks
  editingSubtasks = (task.subtasks || []).map(s => ({ ...s }));
  renderSubtaskList();
  document.getElementById('modalOverlay').classList.add('show');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('show');
  editingId = null;
}

// NL parsing on task title blur (新建任务时，失焦自动解析自然语言)
document.getElementById('taskTitle').addEventListener('blur', () => {
  if (editingId) return;           // 编辑任务不解析
  if (titleParsed) return;         // 同一次会话只解析一次
  const input = document.getElementById('taskTitle');
  const text = input.value.trim();
  if (!text) return;
  const parsed = parseNaturalLang(text);
  // 只在解析确实改变了内容时才应用
  if (parsed.title === text && parsed.priority === 'medium' && !parsed.tags.length && !parsed.date && !parsed.desc) return;
  input.value = parsed.title;
  if (parsed.desc) document.getElementById('taskDesc').value = parsed.desc;
  if (parsed.date) document.getElementById('taskDate').value = parsed.date;
  if (parsed.priority !== 'medium') {
    document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
    const pBtn = document.querySelector(`.priority-btn[data-priority="${parsed.priority}"]`);
    if (pBtn) pBtn.classList.add('active');
  }
  if (parsed.tags.length) {
    while (currentTags.length) currentTags.pop();
    parsed.tags.forEach(t => currentTags.push(t));
    renderTagChips();
  }
  titleParsed = true;
});

function setPriority(val) {
  document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.priority-btn[data-priority="${val}"]`).classList.add('active');
}

function saveTask() { doSaveTask(); }
function deleteCurrentTask() { if (editingId) doDeleteTask(editingId); }

// ==================== DRAG & DROP (shared) ====================
let draggedTaskId = null;   // set in dragstart, cleared in dragend

// ==================== INBOX DRAG SORT ====================
function setupInboxDragDrop() {
  const list = document.getElementById('inboxList');
  if (!list || list._ddInbox) return;
  list._ddInbox = true;

  list.addEventListener('dragover', e => {
    e.preventDefault();
    const item = e.target.closest('.inbox-item');
    if (!item || !draggedTaskId) return;
    // Show indicator
    clearInboxIndicator();
    const rect = item.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (e.clientY < mid) {
      item.classList.add('drop-before');
    } else {
      item.classList.add('drop-after');
    }
  });

  list.addEventListener('dragleave', e => {
    if (!list.contains(e.relatedTarget)) clearInboxIndicator();
  });

  list.addEventListener('drop', async e => {
    e.preventDefault();
    clearInboxIndicator();
    const targetItem = e.target.closest('.inbox-item');
    if (!targetItem || !draggedTaskId) return;
    const taskId = draggedTaskId;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const rect = targetItem.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const targetId = targetItem.dataset.id;
    const targetTask = tasks.find(t => t.id === targetId);
    if (!targetTask) return;

    // 纯 midpoint 算法，float8 精度永不重平衡
    const insertBefore = e.clientY < mid;
    const items = [...list.querySelectorAll('.inbox-item')];
    const targetIdx = items.findIndex(it => it.dataset.id === targetId);
    let prevOrder, nextOrder;

    if (insertBefore) {
      prevOrder = targetIdx > 0 ? (tasks.find(t => t.id === items[targetIdx-1].dataset.id)?.order || 0) : 0;
      nextOrder = targetTask.order || 0;
    } else {
      prevOrder = targetTask.order || 0;
      nextOrder = targetIdx < items.length - 1 ? (tasks.find(t => t.id === items[targetIdx+1].dataset.id)?.order || 0) : (prevOrder + 1000000);
    }

    const newOrder = (prevOrder + nextOrder) / 2;

    // Optimistic update
    task.order = newOrder;
    renderAll();

    // Async sync
    apiPatchTask(taskId, { order: newOrder })
      .then(() => {})
      .catch(e => { console.error('inbox排序同步失败:', e); });
  });
}

function clearInboxIndicator() {
  document.querySelectorAll('#inboxList .inbox-item').forEach(el => {
    el.classList.remove('drop-before', 'drop-after');
  });
}

document.addEventListener('dragstart', e => {
  const card = e.target.closest('.task-card, .today-task');
  if (card) {
    draggedTaskId = card.dataset.id;
    e.dataTransfer.setData('text/plain', card.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'), 0);
    return;
  }
  // Inbox drag
  const item = e.target.closest('.inbox-item');
  if (item) {
    draggedTaskId = item.dataset.id;
    e.dataTransfer.setData('text/plain', item.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => item.classList.add('dragging'), 0);
  }
});

document.addEventListener('dragend', () => {
  draggedTaskId = null;
  document.querySelectorAll('.dragging, .drop-before, .drop-after, .drop-indicator').forEach(el => {
    el.classList.remove('dragging', 'drop-before', 'drop-after');
    if (el.classList.contains('drop-indicator')) el.remove();
  });
});

// ==================== SIDEBAR ====================
let sidebarCollapsed = false;
let sidebarTagFilter = 'all';
let sidebarMobileOpen = false;

function toggleSidebar() {
  // Mobile: sidebar-toggle button closes sidebar
  if (window.innerWidth <= 768 && !sidebarCollapsed) {
    closeMobileSidebar();
    return;
  }
  const sidebar = document.getElementById('sidebar');
  sidebarCollapsed = !sidebarCollapsed;
  sidebar.classList.toggle('collapsed', sidebarCollapsed);
  // Update toggle button icon
  const toggle = sidebar.querySelector('.sidebar-toggle');
  toggle.textContent = '☰';
  // Sync bottom bar
  const bottomBar = document.getElementById('bottomBar');
  if (bottomBar) bottomBar.style.left = sidebarCollapsed ? '0' : '15rem';
  // Save preference
  localStorage.setItem('task-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
}

function closeMobileSidebar() {
  if (window.innerWidth > 768) return;
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.add('collapsed');
  document.getElementById('sidebarOverlay').classList.remove('show');
  sidebarCollapsed = true;
  localStorage.setItem('task-sidebar-collapsed', '1');
  const bb = document.getElementById('bottomBar');
  if (bb) bb.style.left = '0';
}

function toggleSidebarSection(id) {
  document.getElementById(id).classList.toggle('collapsed');
  // Save state
  const collapsed = document.getElementById(id).classList.contains('collapsed');
  localStorage.setItem('task-section-' + id, collapsed ? '1' : '0');
}

function selectSidebarTag(tag) {
  sidebarTagFilter = tag;
  renderSidebarTags();
  // Apply tag filter to current view
  if (currentView === 'overview') {
    document.getElementById('overviewTag').value = tag;
    renderOverview();
  }
}

function renderSidebarTags() {
  const allTags = getAllTags();
  const list = document.getElementById('sidebarTagList');
  if (!allTags.length) {
    list.innerHTML = '<div style="font-size:0.75rem;color:#ccc;padding:0.25rem 0.5rem;">暂无标签</div>';
    return;
  }
  list.innerHTML = allTags.map(tag => {
    const count = tasks.filter(t => (t.tags || []).includes(tag)).length;
    const active = sidebarTagFilter === tag ? ' active' : '';
    return `
      <div class="sidebar-tag-item${active}" onclick="selectSidebarTag('${sidebarTagFilter === tag ? 'all' : esc(tag)}')">
        <span class="sidebar-tag-dot"></span>
        <span>${esc(tag)}</span>
        <span class="sidebar-tag-count">${count}</span>
      </div>`;
  }).join('');
}

function updateSidebarStats() {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  const inProgress = tasks.filter(t => t.status === 'todo').length;
  const inboxCount = tasks.filter(t => !t.date).length;
  document.getElementById('sidebarStatTotal').textContent = total;
  document.getElementById('sidebarStatDone').textContent = done;
  document.getElementById('sidebarStatProgress').textContent = inProgress;
  document.getElementById('navBadgeTotal').textContent = total;
  document.getElementById('navBadgeInbox').textContent = inboxCount || '0';
}

// ==================== VIEW SWITCHING ====================
function switchView(view) {
  currentView = view;
  localStorage.setItem('task-view', view);
  // Update sidebar nav
  document.querySelectorAll('.sidebar-nav-item').forEach(item => item.classList.remove('active'));
  const sideItem = document.querySelector(`.sidebar-nav-item[data-view="${view}"]`);
  if (sideItem) sideItem.classList.add('active');
  // Show tag filter only on overview page
  const tagSection = document.getElementById('sidebarTagSection');
  tagSection.style.display = view === 'overview' ? '' : 'none';
  // Update view visibility
  document.querySelectorAll('.view').forEach(v => {
    v.classList.add('abs-hide');
    v.classList.remove('active');
  });
  const target = document.getElementById('view-' + view);
  target.classList.remove('abs-hide');
  void target.offsetWidth;
  target.classList.add('active');
  renderView(view);
}

function openDayView(dateStr) {
  dayViewDate = dateStr;
  switchView('day');
}

function goToday() {
  dayViewDate = null;
  switchView('day');
}

function renderView(view) {
  switch (view) {
    case 'overview': renderOverview(); break;
    case 'day': renderKanban(); break;
    case 'week': renderWeek(); break;
    case 'month': renderMonth(); break;
    case 'inbox': renderInbox(); break;
    default: break;
  }
}

function renderAll() {
  updateProgress();
  updateSidebarStats();
  renderSidebarTags();
  renderView(currentView);
}

// ==================== WEEK/MONTH NAVIGATION ====================
function navigateWeek(dir) {
  weekOffset = dir === 0 ? 0 : weekOffset + dir;
  renderWeek();
}

function navigateMonth(dir) {
  monthOffset = dir === 0 ? 0 : monthOffset + dir;
  renderMonth();
}

// ==================== NATURAL LANGUAGE PARSER ====================
function parseNaturalLang(text) {
  // ═══════════════════════════════════════════════
  // ~50行正则：提取日期/优先级/标签 → 返回 {title,date,priority,tags}
  // ═══════════════════════════════════════════════
  const r = { title: '', date: '', priority: 'medium', tags: [], desc: '' };
  let s = text.trim();
  if (!s) return r;

  // ① 优先级：高(优先级|优) / 重要/紧急 → high；低(优先级|优) → low
  s = s.replace(/\s*(?:高(?:优先级|优)?|优先|重要|紧急)\s*/g, () => { r.priority = 'high'; return ' '; });
  s = s.replace(/\s*低(?:优先级|优)?\s*/g, () => { r.priority = 'low'; return ' '; });

  // ② 标签：#中文或英文
  s = s.replace(/#([\w\u4e00-\u9fff-]+)/g, (_, tag) => { r.tags.push(tag); return ''; });

  // ③ 日期解析
  const now = new Date();
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const dayMap = {日:0,天:0,一:1,二:2,三:3,四:4,五:5,六:6};

  // 今天 / 明天 / 后天
  s = s.replace(/今天/g,   () => { r.date = fmt(now); return ''; });
  s = s.replace(/明天/g,   () => { const d=new Date(now);d.setDate(d.getDate()+1);r.date=fmt(d); return ''; });
  s = s.replace(/后天/g,   () => { const d=new Date(now);d.setDate(d.getDate()+2);r.date=fmt(d); return ''; });

  // 周X / 下周X / 星期X
  s = s.replace(/(?:下?周|下?星期)([一二三四五六日天])/g, (_, dName) => {
    const target = dayMap[dName];
    if (target === undefined) return _;
    const d = new Date(now);
    if (_.startsWith('下')) d.setDate(d.getDate() + 7);
    const diff = (target - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    r.date = fmt(d);
    return '';
  });

  // MM月DD日 / YYYY-MM-DD / MM/DD
  s = s.replace(/(\d{1,2})月(\d{1,2})[日号]?/g, (_, m, d) => {
    const dt = new Date(now.getFullYear(), parseInt(m)-1, parseInt(d));
    r.date = fmt(dt);
    return '';
  });
  s = s.replace(/(\d{4})-(\d{1,2})-(\d{1,2})/g, (_, y, m, d) => {
    r.date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    return '';
  });

  // ④ 时间描述：X点X分 / X:XX → 拼入desc
  const timeMap = {早上:'08:00',早晨:'08:00',上午:'10:00',中午:'12:00',下午:'15:00',晚上:'19:00',今晚:'19:00'};
  s = s.replace(/(早上|早晨|上午|中午|下午|晚上|今晚)/g, (_, t) => { r.desc = (r.desc?r.desc+' ':'') + t; return ''; });
  s = s.replace(/(\d{1,2})[点时:：](\d{0,2})[分]?/g, (_, h, m) => {
    const t = `${h.padStart(2,'0')}:${(m||'00').padStart(2,'0')}`;
    r.desc = (r.desc?r.desc+' ':'') + t;
    return '';
  });

  // ⑤ 剩余文本作为标题
  r.title = s.replace(/\s+/g, ' ').trim() || '新任务';
  return r;
}

function handleNLInput() {
  const input = document.getElementById('nlInput');
  const text = input.value.trim();
  if (!text) return;
  const parsed = parseNaturalLang(text);
  // 打开弹窗预填
  openAddModal();
  document.getElementById('taskTitle').value = parsed.title;
  document.getElementById('taskDesc').value = parsed.desc || '';
  if (parsed.date) document.getElementById('taskDate').value = parsed.date;
  document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
  const pBtn = document.querySelector(`.priority-btn[data-priority="${parsed.priority}"]`);
  if (pBtn) pBtn.classList.add('active');
  if (parsed.tags.length) {
    while (currentTags.length) currentTags.pop();
    parsed.tags.forEach(t => currentTags.push(t));
    renderTagChips();
  }
  input.value = '';
}

// ==================== HELPERS ====================
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

document.getElementById('sidebarNav').addEventListener('click', e => {
  const item = e.target.closest('.sidebar-nav-item');
  if (!item) return;
  switchView(item.dataset.view);
  // On mobile, close sidebar after nav
  if (window.innerWidth <= 768) closeMobileSidebar();
});

document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

// ==================== HELP TOOLTIP ====================
function toggleHelpTooltip(e) {
  e.stopPropagation();
  const tip = document.getElementById('helpTooltip');
  tip.classList.toggle('show');
}
// Click outside to close
document.addEventListener('click', () => {
  document.getElementById('helpTooltip').classList.remove('show');
});

// ==================== KEYBOARD SHORTCUTS ====================
const VIEW_ORDER = ['overview', 'day', 'week', 'month', 'inbox'];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.getElementById('modalOverlay').classList.contains('show')) {
      closeModal();
    } else {
      hideSuggestions();
    }
    return;
  }
  // Don't intercept when typing in inputs/textareas (except ctrl+arrow combos)
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    // Allow Ctrl+arrow even in inputs (navigate views / flip pages)
    if (!e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  }

  // Ctrl+↑↓: cycle through views
  if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const idx = VIEW_ORDER.indexOf(currentView);
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    const next = VIEW_ORDER[(idx + dir + VIEW_ORDER.length) % VIEW_ORDER.length];
    switchView(next);
    return;
  }
  // Ctrl+←→: flip pages (week / month)
  if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const dir = e.key === 'ArrowRight' ? 1 : -1;
    if (currentView === 'week') { navigateWeek(dir); }
    else if (currentView === 'month') { navigateMonth(dir); }
    return;
  }

  // Single-key shortcuts (only when NOT focused on input)
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    openAddModal();
  } else if (e.key === 't' || e.key === 'T') {
    e.preventDefault();
    switchView('day');
  } else if (e.key === '/') {
    e.preventDefault();
    const searchInput = document.getElementById('overviewSearch');
    if (searchInput) searchInput.focus();
  }
});

// Tag input events
document.getElementById('tagInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addTagFromInput(); }
  if (e.key === 'Backspace' && e.target.value === '' && currentTags.length > 0) {
    currentTags.pop(); renderTagChips();
  }
});
document.getElementById('tagInput').addEventListener('input', e => {
  showSuggestions(e.target.value);
});
document.getElementById('tagInput').addEventListener('blur', () => {
  setTimeout(hideSuggestions, 150);
});

// Close suggestions on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.tag-form-group')) hideSuggestions();
});

// Weekday picker toggle
document.getElementById('weekdayPicker').addEventListener('click', function(e) {
  var btn = e.target.closest('.wd-btn');
  if (!btn) return;
  var day = parseInt(btn.dataset.day);
  if (weeklyDays.has(day)) {
    weeklyDays.delete(day);
    btn.classList.remove('active');
  } else {
    weeklyDays.add(day);
    btn.classList.add('active');
  }
});

// Startup

// ==================== DEBOUNCE ====================
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
const debouncedRenderOverview = debounce(renderOverview);
const debouncedRenderInbox = debounce(renderInbox);


// Startup
(async function init() {
  // Sidebar: auto-collapse on mobile only; desktop always starts visible
  if (window.innerWidth <= 768) {
    sidebarCollapsed = true;
    document.getElementById('sidebar').classList.add('collapsed');
    document.querySelector('.sidebar-toggle').textContent = '☰';
  }
  // Sync bottom bar with sidebar state
  const bb = document.getElementById('bottomBar');
  if (bb) bb.style.left = sidebarCollapsed ? '0' : '15rem';
  // Restore collapsible section states
  ['sidebarTagSection'].forEach(id => {
    if (localStorage.getItem('task-section-' + id) === '1') {
      document.getElementById(id).classList.add('collapsed');
    }
  });
  // Restore last view (sidebar nav + view visibility)
  switchView(currentView);
  // Header hamburger: open sidebar on mobile
  const hamburger = document.getElementById('headerHamburger');
  hamburger.addEventListener('click', () => {
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar').classList.remove('collapsed');
      document.getElementById('sidebarOverlay').classList.add('show');
      sidebarCollapsed = false;
      localStorage.setItem('task-sidebar-collapsed', '0');
      const bb = document.getElementById('bottomBar');
      if (bb) bb.style.left = '0';
    } else {
      toggleSidebar();
    }
  });

  // Init archive label state
  const archiveCb = document.getElementById('archiveToggle');
  if (!archiveCb.checked) document.getElementById('archiveLabel').classList.add('off');

  // Init inbox archive state
  const inboxArcCb = document.getElementById('inboxArchiveToggle');
  if (inboxArcCb) {
    const inboxArcState = localStorage.getItem('task-inbox-archive');
    if (inboxArcState === '1') {
      inboxArcCb.checked = true;
    } else {
      document.getElementById('inboxArchiveLabel').classList.add('off');
    }
  }

  // Register Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // 离线模式：跳过登录，直接使用 localStorage
  if (usingOffline) {
    console.log('init: offline mode, loading from localStorage');
    tasks = loadOfflineTasks();
    setConnection('offline');
    document.getElementById('connText').textContent = '离线模式';
    hideLogin();
    renderAll();
    return;
  }

  // Check existing auth session
  console.log('init: checking session');
  let session = null;
  try {
    connTimeout = false;
    const result = await withTimeout(sb.auth.getSession(), 8000);
    session = result.data?.session || null;
    console.log('init: session result', session ? 'has session' : 'no session');
  } catch (e) {
    console.error('init: getSession error/timeout', e);
    if (connTimeout) {
      setConnection('offline', '连接超时');
    } else {
      setConnection('offline', '已断开');
    }
    // 尝试从缓存回退
    const cached = localStorage.getItem('task-manager-cache');
    if (cached) { try { tasks = JSON.parse(cached); } catch {} }
    hideLogin();
    renderAll();
    return;
  }
  // No existing session — show login
  if (!session) {
    setConnection('offline');
    showLogin();
    renderAll();
    return;
  }

  // Has session — load data
  sessionUser = session.user;
  hideLogin();
  setConnection('loading');
  connTimeout = false;
  let ok = false;
  try {
    ok = await withTimeout(loadTasks(), 10000);
  } catch (e) {
    console.error('init: loadTasks error/timeout', e);
    const cached = localStorage.getItem('task-manager-cache');
    if (cached) { try { tasks = JSON.parse(cached); } catch {} }
    if (connTimeout) setConnection('offline', '加载超时');
    else setConnection('offline', '加载失败');
  }
  if (ok) setupRealtime();
  renderAll();
})();

// Auto-refresh when tab becomes visible
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && isLoggedIn() && !usingOffline) loadTasksSilent();
});