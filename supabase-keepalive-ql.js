// Supabase Keep Alive — 青龙面板脚本（无依赖，仅用 Node 内置 https）
//
// 作用：定期向 Supabase 发一次【真实数据库查询】，防止免费层项目因连续 7 天
//       无数据库活动被自动暂停。
//
// 关键：必须查真实表产生 DB 活动，不能只 ping 根域名或 auth health 端点
//       （那只是服务可达性，不计入数据库活动）。
//
// 前置条件：Supabase 需先执行 GRANT SELECT ON public.tasks TO anon;
//           （2026-05-30 后新建项目默认不给 anon 表权限，否则返回 401）
//
// 定时建议：每 5 天跑一次（cron 日字段写 5 天一次）。
//           不要每 6 天 —— 2 月没有 25 号，会留下约 10 天空窗，
//           超过 7 天阈值必然被暂停。

const https = require('https');

// ==================== 配置 ====================
const SUPABASE_URL = 'https://bbcwbuutltmodlkldezf.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiY3didXV0bHRtb2Rsa2xkZXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NzAzNDAsImV4cCI6MjA5NzI0NjM0MH0.hmXOvHFevOKTFy-_bNV9z8a0Mage9qUOmaFl9-_L9yc';

// 查真实表（tasks），产生真实数据库查询活动
const QUERY_PATH = '/rest/v1/tasks?select=id&limit=1';

const hostname = new URL(SUPABASE_URL).hostname;

const options = {
  hostname: hostname,
  path: QUERY_PATH,
  method: 'GET',
  headers: {
    'apikey': ANON_KEY,
    'Authorization': 'Bearer ' + ANON_KEY,
    'Accept': 'application/json'
  }
};

console.log('[keepalive] ' + new Date().toISOString() + ' 请求 ' + SUPABASE_URL + QUERY_PATH);

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('[keepalive] HTTP status = ' + res.statusCode);
    console.log('[keepalive] body = ' + String(data).slice(0, 200));
    if (res.statusCode === 200) {
      console.log('✅ Supabase keepalive OK（已产生数据库活动）');
    } else {
      console.log('❌ Supabase keepalive FAILED');
      console.log('   → 401: 需先执行 GRANT SELECT ON public.tasks TO anon;');
      console.log('   → 网络错误: 检查青龙容器代理配置');
      process.exit(1);
    }
  });
});

req.on('error', (e) => {
  console.log('❌ 请求错误: ' + e.message);
  console.log('   → 若为 DNS/超时，需给青龙容器配置代理（如 http://192.168.1.10:7897）');
  process.exit(1);
});

req.setTimeout(15000, () => {
  console.log('❌ 请求超时（15s）');
  req.destroy();
  process.exit(1);
});

req.end();
