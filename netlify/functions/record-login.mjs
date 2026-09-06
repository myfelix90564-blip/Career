// netlify/functions/record-login.mjs
// 職透 (JobSight) 後台管理功能 — 記錄登入事件
// 每次使用者用 Google 帳號透過 Netlify Identity 登入成功後，前端會呼叫這支 function，
// 把「中文姓名／email／IP／時間／瀏覽器」寫進 Netlify Blobs，供管理者後台查詢。
import { getStore } from '@netlify/blobs';

const LOG_KEY = 'login-log.json';
const MAX_RECORDS = 2000; // 避免無限成長，只保留最新 2000 筆

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const user = context.clientContext && context.clientContext.user;
  if (!user || !user.email) {
    return new Response(JSON.stringify({ error: '未登入或憑證無效' }), { status: 401 });
  }

  const email = user.email;
  const name =
    (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || '';

  // Netlify 會自動把使用者真實 IP 放在這個 header 裡
  const ip =
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for') ||
    '未知';
  const browser = req.headers.get('user-agent') || '未知';
  const time = new Date().toISOString();

  try {
    const store = getStore({ name: 'zhitou-admin', consistency: 'strong' });
    let list = [];
    try {
      const existing = await store.get(LOG_KEY, { type: 'json' });
      if (Array.isArray(existing)) list = existing;
    } catch (e) {
      // 第一次使用，還沒有任何紀錄，忽略讀取錯誤
    }

    list.unshift({ name, email, ip, browser, time });
    if (list.length > MAX_RECORDS) list = list.slice(0, MAX_RECORDS);

    await store.setJSON(LOG_KEY, list);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error('record-login error', err);
    return new Response(JSON.stringify({ error: '寫入紀錄失敗' }), { status: 500 });
  }
};
