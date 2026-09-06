// netlify/functions/admin-data.mjs
// 職透 (JobSight) 後台管理功能 — 僅限管理者查看的登入紀錄與履歷清單
// 只有 email 完全等於 ADMIN_EMAIL 的使用者才能取得資料，其餘一律回傳 403。
import { getStore } from '@netlify/blobs';

const ADMIN_EMAIL = 'felix670131@gmail.com';
const LOG_KEY = 'login-log.json';
const INDEX_KEY = 'resume-index.json';

export default async (req, context) => {
  const user = context.clientContext && context.clientContext.user;
  if (!user || !user.email) {
    return new Response(JSON.stringify({ error: '未登入' }), { status: 401 });
  }
  if (user.email.toLowerCase() !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: '無權限存取後台管理資料' }), { status: 403 });
  }

  try {
    const adminStore = getStore({ name: 'zhitou-admin', consistency: 'strong' });
    let logins = [];
    let resumes = [];
    try {
      const l = await adminStore.get(LOG_KEY, { type: 'json' });
      if (Array.isArray(l)) logins = l;
    } catch (e) {}
    try {
      const r = await adminStore.get(INDEX_KEY, { type: 'json' });
      if (Array.isArray(r)) resumes = r;
    } catch (e) {}

    return new Response(JSON.stringify({ logins, resumes }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    console.error('admin-data error', err);
    return new Response(JSON.stringify({ error: '讀取後台資料失敗' }), { status: 500 });
  }
};
