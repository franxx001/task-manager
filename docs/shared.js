(function(global) {
  'use strict';

  // ==================== RECURRENCE HELPERS ====================

  function calcNextDate(dateStr, type, weekdays, monthDay) {
    var d = new Date(dateStr + 'T00:00:00');
    if (type === 'daily') { d.setDate(d.getDate() + 1); return d; }
    if (type === 'weekdays') {
      do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6);
      return d;
    }
    if (type === 'monthly') {
      var day = monthDay || parseInt(dateStr.split('-')[2], 10);
      var y = d.getFullYear();
      var m = d.getMonth() + 1;
      if (m > 11) { m = 0; y++; }
      var lastDay = new Date(y, m + 1, 0).getDate();
      d = new Date(y, m, Math.min(day, lastDay));
      return d;
    }
    if (type === 'weekly') {
      if (weekdays && weekdays.length > 0) {
        d.setDate(d.getDate() + 1);
        for (var i = 0; i < 7; i++) {
          if (weekdays.indexOf(d.getDay()) !== -1) return d;
          d.setDate(d.getDate() + 1);
        }
        return d;
      }
      d.setDate(d.getDate() + 7);
      return d;
    }
    return null;
  }

  function fmtDate(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function createNextRecurrence(task) {
    if (!task || !task.recurrence) return null;
    var rec = task.recurrence;
    var type = rec.type, remaining = rec.remaining, endDate = rec.endDate,
        weekdays = rec.weekdays, monthDay = rec.monthDay;
    if (!type) return null;
    if (typeof remaining === 'number' && remaining <= 0) return null;

    var next = calcNextDate(task.date, type, weekdays, monthDay);
    if (!next) return null;
    var nextStr = fmtDate(next);
    if (endDate && nextStr > endDate) return null;

    var nextTask = {
      title: task.title,
      desc: task.desc || '',
      status: 'todo',
      priority: task.priority,
      date: nextStr,
      tags: (task.tags || []).slice(),
      recurrence: {
        type: type,
        remaining: typeof remaining === 'number' ? remaining - 1 : null,
        endDate: endDate || null,
      },
      subtasks: (task.subtasks || []).map(function(s) {
        return { id: s.id, title: s.title, done: false };
      }),
    };
    if (weekdays && weekdays.length > 0) nextTask.recurrence.weekdays = weekdays;
    if (monthDay) nextTask.recurrence.monthDay = monthDay;
    if (nextTask.tags.indexOf('循环') === -1) nextTask.tags.push('循环');
    return nextTask;
  }

  // ==================== NATURAL LANGUAGE PARSER ====================

  function parseNaturalLang(text) {
    var r = { title: '', date: '', priority: 'medium', tags: [], desc: '' };
    var s = (text || '').trim();
    if (!s) return r;

    s = s.replace(/\s*(?:高(?:优先级|优)?|优先|重要|紧急)\s*/g, function() {
      r.priority = 'high'; return ' ';
    });
    s = s.replace(/\s*低(?:优先级|优)?\s*/g, function() {
      r.priority = 'low'; return ' ';
    });

    s = s.replace(/#([\w\u4e00-\u9fff-]+)/g, function(_, tag) {
      r.tags.push(tag); return '';
    });

    var now = new Date();
    var fmt = function(d) {
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');
    };
    var dayMap = {日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6};

    s = s.replace(/今天/g, function() { r.date = fmt(now); return ''; });
    s = s.replace(/明天/g, function() {
      var d = new Date(now); d.setDate(d.getDate() + 1); r.date = fmt(d); return '';
    });
    s = s.replace(/后天/g, function() {
      var d = new Date(now); d.setDate(d.getDate() + 2); r.date = fmt(d); return '';
    });

    s = s.replace(/(?:下?周|下?星期)([一二三四五六日天])/g, function(_, dName) {
      var target = dayMap[dName];
      if (target === undefined) return _;
      var d = new Date(now);
      if (_.indexOf('下') === 0) d.setDate(d.getDate() + 7);
      var diff = (target - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      r.date = fmt(d);
      return '';
    });

    s = s.replace(/(\d{1,2})月(\d{1,2})[日号]?/g, function(_, m, d) {
      var dt = new Date(now.getFullYear(), parseInt(m, 10) - 1, parseInt(d, 10));
      r.date = fmt(dt);
      return '';
    });
    s = s.replace(/(\d{4})-(\d{1,2})-(\d{1,2})/g, function(_, y, m, d) {
      r.date = y + '-' + m.padStart(2, '0') + '-' + d.padStart(2, '0');
      return '';
    });

    s = s.replace(/(早上|早晨|上午|中午|下午|晚上|今晚)/g, function(_, t) {
      r.desc = (r.desc ? r.desc + ' ' : '') + t; return '';
    });
    s = s.replace(/(\d{1,2})[点时:：](\d{0,2})[分]?/g, function(_, h, m) {
      var t = h.padStart(2, '0') + ':' + (m || '00').padStart(2, '0');
      r.desc = (r.desc ? r.desc + ' ' : '') + t;
      return '';
    });

    r.title = s.replace(/\s+/g, ' ').trim() || '新任务';
    return r;
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  // ==================== EXPORTS ====================

  global.calcNextDate = calcNextDate;
  global.fmtDate = fmtDate;
  global.createNextRecurrence = createNextRecurrence;
  global.parseNaturalLang = parseNaturalLang;
  global.todayStr = todayStr;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      calcNextDate: calcNextDate,
      fmtDate: fmtDate,
      createNextRecurrence: createNextRecurrence,
      parseNaturalLang: parseNaturalLang,
      todayStr: todayStr,
    };
  }
})(typeof window !== 'undefined' ? window : global);
