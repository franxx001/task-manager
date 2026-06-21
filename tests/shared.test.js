var shared = require('../docs/shared.js');
var assert = require('assert');

describe('calcNextDate', function() {
  it('returns next day for daily', function() {
    var r = shared.calcNextDate('2026-01-01', 'daily');
    assert.strictEqual(shared.fmtDate(r), '2026-01-02');
  });

  it('returns next week for weekly', function() {
    var r = shared.calcNextDate('2026-01-01', 'weekly');
    assert.strictEqual(shared.fmtDate(r), '2026-01-08');
  });

  it('skips weekend for weekdays', function() {
    var r = shared.calcNextDate('2026-06-19', 'weekdays'); // Friday
    assert.strictEqual(shared.fmtDate(r), '2026-06-22');   // Monday
  });

  it('handles Saturday input for weekdays', function() {
    var r = shared.calcNextDate('2026-06-20', 'weekdays'); // Saturday
    assert.strictEqual(shared.fmtDate(r), '2026-06-22');   // Monday
  });

  it('returns null for unknown type', function() {
    var r = shared.calcNextDate('2026-01-01', 'monthly');
    assert.strictEqual(r, null);
  });
});

describe('fmtDate', function() {
  it('formats date to YYYY-MM-DD', function() {
    var d = new Date(2026, 5, 21);
    assert.strictEqual(shared.fmtDate(d), '2026-06-21');
  });

  it('pads month and day with zeros', function() {
    var d = new Date(2026, 0, 5);
    assert.strictEqual(shared.fmtDate(d), '2026-01-05');
  });
});

describe('createNextRecurrence', function() {
  it('generates next daily task', function() {
    var task = { title: 'test', date: '2026-01-01', priority: 'high', recurrence: { type: 'daily' } };
    var next = shared.createNextRecurrence(task);
    assert.ok(next);
    assert.strictEqual(next.title, 'test');
    assert.strictEqual(next.date, '2026-01-02');
    assert.strictEqual(next.status, 'todo');
    assert.strictEqual(next.priority, 'high');
    assert.ok(next.tags.indexOf('循环') !== -1);
  });

  it('decrements remaining count', function() {
    var task = { title: 'test', date: '2026-01-01', recurrence: { type: 'daily', remaining: 3 } };
    var next = shared.createNextRecurrence(task);
    assert.strictEqual(next.recurrence.remaining, 2);
  });

  it('returns null when remaining is 0', function() {
    var task = { title: 'test', date: '2026-01-01', recurrence: { type: 'daily', remaining: 0 } };
    assert.strictEqual(shared.createNextRecurrence(task), null);
  });

  it('returns null when endDate is reached', function() {
    var task = { title: 'test', date: '2026-06-21', recurrence: { type: 'daily', endDate: '2026-06-21' } };
    assert.strictEqual(shared.createNextRecurrence(task), null);
  });

  it('returns null for task without recurrence', function() {
    assert.strictEqual(shared.createNextRecurrence({ title: 'test' }), null);
    assert.strictEqual(shared.createNextRecurrence(null), null);
  });

  it('resets subtask done status', function() {
    var task = {
      title: 'test', date: '2026-01-01',
      subtasks: [{ id: 's1', title: 'sub1', done: true }],
      recurrence: { type: 'daily' },
    };
    var next = shared.createNextRecurrence(task);
    assert.strictEqual(next.subtasks[0].title, 'sub1');
    assert.strictEqual(next.subtasks[0].done, false);
  });
});

describe('parseNaturalLang', function() {
  it('returns defaults for empty input', function() {
    var r = shared.parseNaturalLang('');
    assert.strictEqual(r.title, '');
    assert.strictEqual(r.priority, 'medium');
    assert.strictEqual(r.tags.length, 0);
    assert.strictEqual(r.date, '');
  });

  it('parses high priority', function() {
    var r = shared.parseNaturalLang('买牛奶 高优先级');
    assert.strictEqual(r.priority, 'high');
  });

  it('parses low priority', function() {
    var r = shared.parseNaturalLang('买牛奶 低优先级');
    assert.strictEqual(r.priority, 'low');
  });

  it('parses tags', function() {
    var r = shared.parseNaturalLang('买牛奶 #生活 #购物');
    assert.deepStrictEqual(r.tags, ['生活', '购物']);
  });

  it('parses 今天', function() {
    var r = shared.parseNaturalLang('买牛奶 今天');
    var today = new Date();
    var expected = today.getFullYear() + '-' +
      String(today.getMonth() + 1).padStart(2, '0') + '-' +
      String(today.getDate()).padStart(2, '0');
    assert.strictEqual(r.date, expected);
  });

  it('parses 明天', function() {
    var r = shared.parseNaturalLang('开会 明天');
    var d = new Date();
    d.setDate(d.getDate() + 1);
    var expected = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    assert.strictEqual(r.date, expected);
  });

  it('parses YYYY-MM-DD format', function() {
    var r = shared.parseNaturalLang('买牛奶 2026-12-25');
    assert.strictEqual(r.date, '2026-12-25');
  });

  it('parses Chinese date format MM月DD日', function() {
    var r = shared.parseNaturalLang('买牛奶 12月25日');
    var year = new Date().getFullYear();
    assert.strictEqual(r.date, year + '-12-25');
  });

  it('extracts remaining text as title', function() {
    var r = shared.parseNaturalLang('买牛奶 今天 高优先级 #生活');
    assert.strictEqual(r.title, '买牛奶');
  });
});

describe('todayStr', function() {
  it('returns current date in YYYY-MM-DD format', function() {
    var r = shared.todayStr();
    var d = new Date();
    var expected = d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
    assert.strictEqual(r, expected);
  });
});
