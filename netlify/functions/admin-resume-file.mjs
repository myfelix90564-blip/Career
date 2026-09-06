// netlify/functions/admin-resume-file.mjs
// 職透 (JobSight) 後台管理功能 — 僅限管理者下載或刪除單一份履歷 PDF
// GET  ?key=xxx  -> 下載該份 PDF
// POST { action:'delete', key:'xxx' } -> 刪除該份 PDF（同時從索引移除，釋放 Netlify Blobs 空間）
import { getStore } from '@netlify/blobs';

const ADMIN_EMAIL = 'felix670131@gmail.com';
const INDEX_KEY = 'resume-index.json';

export default async (req, context) => {
  const user = context.clientContext && context.clientContext.user;
  if (!user || !user.email) {
    return new Response(JSON.stringify({ error: '未登入' }), { status: 401 });
  }
  if (user.email.toLowerCase() !== ADMIN_EMAIL) {
    return new Response(JSON.stringify({ error: '無權限' }), { status: 403 });
  }

  const filesStore = getStore({ name: 'zhitou-resumes', consistency: 'strong' });
  const indexStore = getStore({ name: 'zhitou-admin', consistency: 'strong' });

  if (req.method === 'GET') {
    const url = new URL(req.url);
    const key = url.searchParams.get('key');
    if (!key) return new Response(JSON.stringify({ error: '缺少 key' }), { status: 400 });

    const blob = await filesStore.getWithMetadata(key, { type: 'arrayBuffer' });
    if (!blob) return new Response(JSON.stringify({ error: '檔案不存在或已被刪除' }), { status: 404 });

    const filename = (blob.metadata && blob.metadata.filename) || 'resume.pdf';
    return new Response(blob.data, {
      status: 200,
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      },
    });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: '請求格式錯誤' }), { status: 400 });
    }
    if (body.action !== 'delete' || !body.key) {
      return new Response(JSON.stringify({ error: '參數錯誤' }), { status: 400 });
    }
    try {
      await filesStore.delete(body.key);
      let index = [];
      try {
        const existing = await indexStore.get(INDEX_KEY, { type: 'json' });
        if (Array.isArray(existing)) index = existing;
      } catch (e) {}
      index = index.filter(r => r.key !== body.key);
      await indexStore.setJSON(INDEX_KEY, index);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    } catch (err) {
      console.error('admin-resume-file delete error', err);
      return new Response(JSON.stringify({ error: '刪除失敗' }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
};
