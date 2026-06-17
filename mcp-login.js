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

const SUPABASE_URL = 'https://bbcwbuutltmodlkldezf.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJiY3didXV0bHRtb2Rsa2xkZXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2NzAzNDAsImV4cCI6MjA5NzI0NjM0MH0.hmXOvHFevOKTFy-_bNV9z8a0Mage9qUOmaFl9-_L9yc';
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
