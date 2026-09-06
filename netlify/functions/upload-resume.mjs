// netlify/functions/upload-resume.mjs
// 職透 (JobSight) 後台管理功能 — 儲存使用者上傳的履歷 PDF 原始檔
// 使用者在前端上傳 PDF 並完成本機文字解析後，前端會把原始 PDF（base64）連同
// 檔名一起送到這支 function，存進 Netlify Blobs，讓管理者後台可以查看/下載/刪除。
import { getStore } from '@netlify/blobs';

const INDEX_KEY = 'resume-index.json';

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

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: '請求格式錯誤' }), { status: 400 });
  }

  const { filename, base64 } = body || {};
  if (!filename || !base64) {
    return new Response(JSON.stringify({ error: '缺少檔案內容' }), { status: 400 });
  }
  // 粗略限制大小，避免異常大檔案塞爆 Blobs（base64 後約為原始檔案的 4/3 倍）
  if (base64.length > 15 * 1024 * 1024) {
    return new Response(JSON.stringify({ error: '檔案過大' }), { status: 413 });
  }

  try {
    const filesStore = getStore({ name: 'zhitou-resumes', consistency: 'strong' });
    const indexStore = getStore({ name: 'zhitou-admin', consistency: 'strong' });

    const key = `${Date.now()}-${email}-${filename}`.replace(/[^\w.\-@]/g, '_');
    const buffer = Buffer.from(base64, 'base64');
    await filesStore.set(key, buffer, { metadata: { filename, email, name } });

    let index = [];
    try {
      const existing = await indexStore.get(INDEX_KEY, { type: 'json' });
      if (Array.isArray(existing)) index = existing;
    } catch (e) {
      // 第一次使用，忽略
    }
    index.unshift({
      key,
      filename,
      email,
      name,
      time: new Date().toISOString(),
      size: buffer.length,
    });
    await indexStore.setJSON(INDEX_KEY, index);

    return new Response(JSON.stringify({ ok: true, key }), { status: 200 });
  } catch (err) {
    console.error('upload-resume error', err);
    return new Response(JSON.stringify({ error: '儲存履歷失敗' }), { status: 500 });
  }
};
