// netlify/functions/upload-resume.mjs
// 職透 (JobSight) 後台管理功能 — 儲存使用者上傳的履歷 PDF 原始檔
// 使用者在前端上傳 PDF 並完成本機文字解析後，前端會把原始 PDF（base64）連同
// 檔名一起送到這支 function，存進 Netlify Blobs，讓管理者後台可以查看/下載/刪除。
//
// v3.3.42 修復：改用 @netlify/identity 的 getUser()，理由與 admin-data.mjs 相同——
// 先前一律因拿不到 context.clientContext.user 而在還沒存檔前就被擋下，履歷 PDF
// 其實從未真正備份到後台。
//
// v3.3.43 新增：無論使用者「有沒有」用 Google 帳號登入、甚至就算是繞過前端登入牆
// 直接呼叫這支 API，只要有上傳履歷 PDF 就一律記錄下來（不再回傳 401 拒絕），並額外
// 記錄 IP、User-Agent、Referer/Origin 等診斷資訊、標記 verified（是否有通過驗證的登入
// 身份）。目的是讓管理者可以在後台一眼看出「有沒有人繞過登入牆在使用系統」，方便排查
// 前端登入牆本身是否還有其他漏洞——這與強制要求登入才能使用是兩件事：
// 這支 function 現在的角色是「盡量記錄、不主動擋人」，真正的存取管控仍然由前端登入牆
// 與 admin-data.mjs／admin-resume-file.mjs 的管理者權限檢查負責。
import { getStore } from '@netlify/blobs';
import { getUser } from '@netlify/identity';

const INDEX_KEY = 'resume-index.json';

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

function extractName(user) {
  const meta = user.userMetadata || user.user_metadata || {};
  return meta.full_name || meta.name || '';
}

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  // v3.3.43：不再因為沒有登入身份就直接拒絕（401）——改成盡量記錄，讓管理者能事後
  // 追查「繞過登入」的情況；verified 為 false 代表這次上傳沒有通過任何有效的 Google 登入。
  const user = await resolveIdentityUser(context);
  const verified = !!(user && user.email);
  const email = verified ? user.email : '(未登入或身分不明)';
  const name = verified ? extractName(user) : '';

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

  // v3.3.43：無論是否驗證通過，都記錄請求端的診斷資訊，方便管理者比對「繞過登入」
  // 的上傳是從哪個 IP／瀏覽器／頁面（Referer）發出。
  const ip =
    req.headers.get('x-nf-client-connection-ip') ||
    req.headers.get('x-forwarded-for') ||
    '未知';
  const browser = req.headers.get('user-agent') || '未知';
  const referer = req.headers.get('referer') || req.headers.get('origin') || '未知';

  try {
    const filesStore = getStore({ name: 'zhitou-resumes', consistency: 'strong' });
    const indexStore = getStore({ name: 'zhitou-admin', consistency: 'strong' });

    const keySafeEmail = verified ? email : 'anonymous';
    const key = `${Date.now()}-${keySafeEmail}-${filename}`.replace(/[^\w.\-@]/g, '_');
    const buffer = Buffer.from(base64, 'base64');
    await filesStore.set(key, buffer, {
      metadata: { filename, email, name, verified, ip, browser, referer },
    });

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
      verified,
      ip,
      browser,
      referer,
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
