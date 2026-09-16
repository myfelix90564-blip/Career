// netlify/functions/admin-resume-file.mjs
// 職透 (JobSight) 後台管理功能 — 僅限管理者下載或刪除單一份履歷檔案（PDF 或 Word）
// GET  ?key=xxx  -> 下載該份檔案
// POST { action:'delete', key:'xxx' } -> 刪除該份檔案（同時從索引移除，釋放 Netlify Blobs 空間）
//
// v3.3.42 修復：改用 @netlify/identity 的 getUser()，理由與 admin-data.mjs 相同。
//
// v3.3.46 修復：
// 1)「後台資料寫入沒有防止衝突，可能互蓋」——刪除履歷時改用 mutateJsonWithRetry
//    做條件式寫入＋重試，避免管理者同時刪除多份履歷、或剛好與一次新上傳「撞在一起」時，
//    索引檔互相覆蓋導致其他紀錄憑空消失。
// 2) 新增支援 Word（.docx）履歷上傳後，下載時原本不管實際檔案格式一律回傳
//    content-type: application/pdf，改成依副檔名判斷正確的 content-type，
//    避免使用者下載到的 .docx 檔案被瀏覽器誤判成損毀的 PDF。
import { getStore } from '@netlify/blobs';
import { getUser } from '@netlify/identity';
import { mutateJsonWithRetry } from '../lib/blob-json.mjs';

const ADMIN_EMAIL = 'felix670131@gmail.com';
const INDEX_KEY = 'resume-index.json';

const CONTENT_TYPE_BY_EXT = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function guessContentType(filename) {
  const ext = String(filename).split('.').pop().toLowerCase();
  return CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
}

async function resolveIdentityUser(context) {
  try {
    const user = await getUser();
    if (user && user.email) return user;
  } catch (e) {
    console.error('getUser() 失敗，改用備援方式判斷身份', e);
  }
  const legacyUser = context.clientContext && context.clientContext.user;
  if (legacyUser && legacyUser.email) return legacyUser;
  return null;
}

export default async (req, context) => {
  const user = await resolveIdentityUser(context);
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
        'content-type': guessContentType(filename),
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
      await mutateJsonWithRetry(indexStore, INDEX_KEY, (index) =>
        index.filter((r) => r.key !== body.key)
      );
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    } catch (err) {
      console.error('admin-resume-file delete error', err);
      return new Response(JSON.stringify({ error: '刪除失敗' }), { status: 500 });
    }
  }

  return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
};
