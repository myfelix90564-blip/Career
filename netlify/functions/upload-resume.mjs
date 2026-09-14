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
//
// v3.3.46 修復：
// 1)「匿名上傳無限制，可塞爆儲存空間」——原本每次上傳都用 Date.now() 當 key 的一部分，
//    同一個人（或同一個繞過登入牆的來源）每上傳一次就多存一筆，永遠不會變少。改成
//    「已登入者」以 email、「未登入者」以來源 IP 當固定 key，同一人再次上傳會直接覆蓋
//    掉自己上一份履歷，系統裡永遠只留「每個人最新的一份」，儲存空間不會被無限塞爆；
//    同時仍保留「不同 IP 各自一筆」，管理者還是看得出有幾個不同來源在繞過登入牆。
// 2)「後台資料寫入沒有防止衝突，可能互蓋」——索引檔（resume-index.json）改用
//    mutateJsonWithRetry 做條件式寫入＋重試，避免兩筆上傳同時處理時互相覆蓋、其中一筆
//    紀錄憑空消失。
import { getStore } from '@netlify/blobs';
import { getUser } from '@netlify/identity';
import { mutateJsonWithRetry } from '../lib/blob-json.mjs';

const INDEX_KEY = 'resume-index.json';
// 索引筆數上限（對應「每個來源只留最新一份」之後，正常情況下筆數等於「曾經出現過的
// 使用者/來源 IP 數」，理論上不會無限成長；這裡再加一道保險，避免極端情況
// （例如遭大量不同 IP 的殭屍網路輪番攻擊）持續增長到失控）。
const MAX_INDEX_ENTRIES = 5000;

function sanitizeKeyPart(value) {
  return String(value).replace(/[^\w.\-@]/g, '_');
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

    // v3.3.46：已登入者用 email 當固定 key，未登入（含繞過登入牆）者用來源 IP 當固定
    // key——同一人／同一來源再次上傳會直接覆蓋掉自己前一份，而不是無限累加新的一筆。
    const key = verified
      ? `resume-verified-${sanitizeKeyPart(email.toLowerCase())}`
      : `resume-anon-${sanitizeKeyPart(ip)}`;
    const buffer = Buffer.from(base64, 'base64');
    await filesStore.set(key, buffer, {
      metadata: { filename, email, name, verified, ip, browser, referer },
    });

    const entry = {
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
    };

    await mutateJsonWithRetry(indexStore, INDEX_KEY, (index) => {
      // 同一個 key 的舊紀錄先移除，換成這次最新的一筆（覆蓋，而非累加）。
      const next = index.filter((r) => r.key !== key);
      next.unshift(entry);
      // 保險上限：即便來源 IP 多到異常，索引也不會無止盡成長。
      if (next.length > MAX_INDEX_ENTRIES) next.length = MAX_INDEX_ENTRIES;
      return next;
    });

    return new Response(JSON.stringify({ ok: true, key }), { status: 200 });
  } catch (err) {
    console.error('upload-resume error', err);
    return new Response(JSON.stringify({ error: '儲存履歷失敗' }), { status: 500 });
  }
};
