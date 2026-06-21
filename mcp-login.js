#!/usr/bin/env node
/**
 * MCP Login Helper
 * 用你的登录密钥初始化 MCP 会话
 * 用法：node mcp-login.js <你的密钥>
 */
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_FILE = path.join(__dirname, 'data', 'mcp-config.json');
let config = {};
try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch {}
const SUPABASE_URL = config.supabaseUrl || process.env.SUPABASE_URL;
const ANON_KEY = config.anonKey || process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !ANON_KEY) {
  console.log('❌ 缺少 Supabase 配置，请创建 data/mcp-config.json');
  console.log('  { "supabaseUrl": "https://xxx.supabase.co", "anonKey": "eyJ..." }');
  process.exit(1);
}
const AUTH_FILE = path.join(__dirname, 'data', 'mcp-auth.json');

const key = process.argv[2];
if (!key) {
  console.log('用法：node mcp-login.js <你的登录密钥>');
  process.exit(1);
}

async function keyToEmail(k) {
  const encoder = new TextEncoder();
  const data = encoder.encode(k + ':task-manager-supabase');
  const hash = await crypto.webcrypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
  return hex.substring(0, 16) + '@tm.local';
}

(async () => {
  const sb = createClient(SUPABASE_URL, ANON_KEY);
  const email = await keyToEmail(key);
  const { data, error } = await sb.auth.signInWithPassword({ email, password: key });
  if (error) {
    console.log('❌ 登录失败：', error.message);
    process.exit(1);
  }
  const session = data.session;
  fs.writeFileSync(AUTH_FILE, JSON.stringify({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
  }, null, 2));
  const expires = new Date(session.expires_at).toLocaleString();
  console.log(`✅ MCP 认证成功，会话有效期至 ${expires}`);
  console.log(`   认证信息已保存至 ${AUTH_FILE}`);
})();
