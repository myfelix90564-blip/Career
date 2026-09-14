/* =======================================================================
   js/admin.js — 後台管理面板（僅 ADMIN_EMAIL 可見：登入紀錄、履歷清單、下載/刪除）
   
   v3.3.46：這份程式碼原本和其他 12 個檔案一起擠在 index.html 唯一一個 <script>
   標籤裡。拆成獨立檔案是為了：其一，同一份程式互相牽連太深，過去曾發生過「某一小段
   出錯，導致後面所有按鈕都沒反應」的重大臭蟲；拆開之後，若某一個檔案在載入當下
   丟出例外，只會影響那個檔案剩下的部分，不會連帶讓在它之後載入的其他檔案也失效。
   其二，之後要修改或除錯某個功能時，可以直接找到對應檔案，不用在三千多行的大檔案
   裡面搜尋。
   
   這裡的程式碼內容跟原本 index.html 裡的對應段落逐字相同（純粹搬移、沒有改寫任何
   邏輯），並且刻意維持跟原本一致的「多個 <script> 依序載入、共用同一個全域作用域」
   寫法（沒有改成 ES module），所有函式與變數的呼叫方式完全不變，行為上與拆分前
   100% 相同。載入順序很重要，請維持 index.html 裡目前的 <script src> 排列順序。
========================================================================= */
/* ---------- 後台管理（僅 ADMIN_EMAIL 可見） ---------- */
// v3.3.42：抽出成獨立函式，並支援「強制刷新 Token 後重試」，供 openAdminPanel 在第一次
// 拿到 401 時自動重試一次，不需要使用者手動登出再登入。
async function fetchAdminData(forceRefresh){
  const token = await getIdentityToken(forceRefresh);
  if (!token) return { ok: false, status: 0, error: '無法取得登入憑證，請重新登入後再試。' };
  const res = await fetch('/.netlify/functions/admin-data', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  if (!res.ok){
    const e = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, error: e.error || String(res.status) };
  }
  return { ok: true, data: await res.json() };
}

async function openAdminPanel(){
  const modal = document.getElementById('adminModal');
  modal.style.display = 'flex';
  const body = document.getElementById('adminModalBody');
  body.innerHTML = '<p>載入中…</p>';
  try {
    let result = await fetchAdminData(false);
    // 401 有可能單純是 Token 快過期或剛好卡在刷新時間點，這裡自動用強制刷新過的
    // Token 重試一次，避免使用者誤以為是帳號權限或系統問題。
    if (!result.ok && result.status === 401){
      result = await fetchAdminData(true);
    }
    if (!result.ok){
      body.innerHTML = `<p>讀取失敗：${result.error}</p>`;
      return;
    }
    renderAdminPanel(result.data);
  } catch (e){
    console.error(e);
    body.innerHTML = '<p>讀取後台資料時發生錯誤。</p>';
  }
}

function closeAdminPanel(){
  document.getElementById('adminModal').style.display = 'none';
}

function renderAdminPanel(data){
  const body = document.getElementById('adminModalBody');
  const logins = data.logins || [];
  const resumes = data.resumes || [];

  // v3.3.43：有些履歷可能是「verified: false」（沒有通過任何有效登入就上傳成功），
  // 這種一定跟正常登入的使用者分開處理——不能只靠 email 分組，因為它們的 email
  // 一律是後端寫死的「(未登入或身分不明)」，硬塞進登入紀錄的表格裡會誤導管理者。
  const verifiedResumes = resumes.filter(r => r.verified !== false);
  const anomalyResumes = resumes.filter(r => r.verified === false);

  const resumesByEmail = {};
  verifiedResumes.forEach(r => {
    (resumesByEmail[r.email] = resumesByEmail[r.email] || []).push(r);
  });

  let html = '';

  if (anomalyResumes.length){
    html += `<div class="admin-section-title warn">⚠️ 異常上傳：沒有通過登入驗證卻成功上傳履歷（共 ${anomalyResumes.length} 筆，最新在最上）</div>`;
    html += '<p class="desc" style="margin-top:-4px;">這些上傳請求沒有附上有效的 Google 登入憑證，理論上不應該發生；請比對下方 IP／瀏覽器／來源頁面，確認是否有人繞過登入牆，或前端登入判斷有其他漏洞。</p>';
    html += '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
      '<th>時間</th><th>IP</th><th>瀏覽器</th><th>來源頁面</th><th>履歷 PDF</th>' +
      '</tr></thead><tbody>';
    anomalyResumes.forEach(r => {
      html += `<tr>
        <td>${escapeHtml(formatAdminTime(r.time))}</td>
        <td>${escapeHtml(r.ip || '')}</td>
        <td class="admin-ua">${adminUaCellHtml(r.browser)}</td>
        <td class="admin-ua">${adminUrlCellHtml(r.referer)}</td>
        <td>${adminResumeCellHtml(r)}</td>
      </tr>`;
    });
    html += '</tbody></table></div>';
  }

  html += `<div class="admin-section-title">登入紀錄（共 ${logins.length} 筆，最新在最上）</div>`;
  html += '<div class="admin-table-wrap"><table class="admin-table"><thead><tr>' +
    '<th>中文姓名</th><th>Email</th><th>IP</th><th>時間</th><th>瀏覽器</th><th>履歷 PDF</th>' +
    '</tr></thead><tbody>';

  if (logins.length === 0){
    html += '<tr><td colspan="6">目前沒有登入紀錄</td></tr>';
  } else {
    logins.forEach(l => {
      const files = resumesByEmail[l.email] || [];
      const fileCell = files.length
        ? files.map(f => adminResumeCellHtml(f)).join('')
        : '（尚無上傳）';
      html += `<tr>
        <td>${escapeHtml(l.name || '（未提供）')}</td>
        <td>${escapeHtml(l.email || '')}</td>
        <td>${escapeHtml(l.ip || '')}</td>
        <td>${escapeHtml(formatAdminTime(l.time))}</td>
        <td class="admin-ua">${adminUaCellHtml(l.browser)}</td>
        <td>${fileCell}</td>
      </tr>`;
    });
  }
  html += '</tbody></table></div>';
  body.innerHTML = html;

  body.querySelectorAll('[data-download-key]').forEach(btn => {
    btn.addEventListener('click', () => downloadAdminResume(btn.dataset.downloadKey, btn, btn.dataset.downloadFilename));
  });
  body.querySelectorAll('[data-delete-key]').forEach(btn => {
    btn.addEventListener('click', () => deleteAdminResume(btn.dataset.deleteKey, btn));
  });
}

function adminResumeCellHtml(f){
  const sizeKb = f.size ? Math.round(f.size / 1024) + ' KB' : '';
  return `<div class="admin-file-row">
    <span title="${escapeHtml(f.filename)}">${escapeHtml(f.filename)}</span>
    <span class="admin-file-meta">${sizeKb}</span>
    <button type="button" class="ghost" data-download-key="${escapeHtml(f.key)}" data-download-filename="${escapeHtml(f.filename)}">下載</button>
    <button type="button" class="ghost" data-delete-key="${escapeHtml(f.key)}">刪除</button>
  </div>`;
}

/* v3.3.54 修復：這裡原本是一份獨立維護的 escapeAdminHtml()，跟 shared-helpers.js 的
   escapeHtml() 幾乎一樣卻各自維護、跳脫規則還有些微不一致（技術債）。已經統一改用
   shared-helpers.js 那一份（已補上跳脫單引號），這裡不用再重複定義一次。 */
// v3.3.44：後台管理表格的「瀏覽器」欄位改成顯示精簡摘要（瀏覽器名稱＋版本＋作業系統），
// 不再把整串很長的 User-Agent 文字直接塞進表格造成版面被撐得很長；滑鼠移上去（title）
// 仍可看到完整原始字串，需要時可以複製查證。
function summarizeUserAgent(ua){
  if (!ua) return '';
  let browser = '瀏覽器不明';
  let m;
  if ((m = ua.match(/Edg\/([\d.]+)/))) browser = 'Edge ' + m[1].split('.')[0];
  else if ((m = ua.match(/OPR\/([\d.]+)/))) browser = 'Opera ' + m[1].split('.')[0];
  else if (/Chrome\//.test(ua) && (m = ua.match(/Chrome\/([\d.]+)/))) browser = 'Chrome ' + m[1].split('.')[0];
  else if ((m = ua.match(/Firefox\/([\d.]+)/))) browser = 'Firefox ' + m[1].split('.')[0];
  else if (/Safari\//.test(ua) && (m = ua.match(/Version\/([\d.]+)/))) browser = 'Safari ' + m[1].split('.')[0];

  let os = '';
  if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Macintosh/.test(ua)) os = 'Mac';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Linux/.test(ua)) os = 'Linux';

  return os ? `${browser} · ${os}` : browser;
}
function adminUaCellHtml(ua){
  return `<span title="${escapeHtml(ua || '')}">${escapeHtml(summarizeUserAgent(ua))}</span>`;
}
// 「來源頁面」（Referer/Origin）通常是一整串網址，同樣用單行省略號顯示，
// 完整網址放在 title 裡滑鼠移上去查看。
function adminUrlCellHtml(url){
  return `<span title="${escapeHtml(url || '')}">${escapeHtml(url || '')}</span>`;
}
function formatAdminTime(iso){
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('zh-TW'); } catch(e){ return iso; }
}

/* v3.3.53 修復：「下載」「刪除」這兩個動作原本只用一般（可能快過期）的 token 呼叫一次，
   401 就直接顯示失敗；跟 fetchAdminData()／openAdminPanel() 已經有的「401 自動用強制
   刷新過的 token 重試一次」邏輯不一致——同樣是 token 快過期的情況，看後台列表可以自動
   恢復，下載/刪除履歷卻要使用者自己手動再點一次，體驗不一致，也容易被誤以為是權限或
   系統問題。這裡抽出共用的重試邏輯，兩個動作都套用。 */
async function fetchAdminResumeFileWithRetry(buildRequest){
  let token = await getIdentityToken(false);
  if (!token) return { ok: false, res: null, error: '無法取得登入憑證，請重新登入後再試。' };
  let res = await fetch(...buildRequest(token));
  if (res.status === 401){
    token = await getIdentityToken(true);
    if (!token) return { ok: false, res: null, error: '無法取得登入憑證，請重新登入後再試。' };
    res = await fetch(...buildRequest(token));
  }
  return { ok: res.ok, res, error: null };
}

async function downloadAdminResume(key, btn, filename){
  /* v3.3.52 修復：這兩個按鈕原本點擊後完全沒有任何「處理中」的視覺回饋，網路較慢時
     使用者會覺得「按了沒反應」，甚至可能因此重複點擊，造成重複下載/多送出一次刪除
     請求。補上按鈕文字暫時改成「處理中…」並停用，完成或失敗後一律還原。直接使用
     呼叫端傳入的按鈕元素本身，避免用 key 字串重新查詢 DOM 時，key 裡的特殊字元
     （例如 email 裡的 @）讓 CSS 選擇器處理更複雜。
     v3.3.54 修復：檔名原本用 key.split('-').slice(2).join('-') 從儲存 key 反推，是
     v3.3.42 之前「key 裡真的有包含原始檔名」時代留下的寫法。v3.3.46 把 key 格式改成
     resume-verified-${email} / resume-anon-${ip}（不再包含檔名）之後，這行邏輯就已經
     過時，卻沒有跟著更新——實際下載下來的檔案會被命名成類似「alice@example.com」這種
     沒有副檔名的怪檔名。更麻煩的是：只要 <a> 標籤設了 download 屬性，瀏覽器就會優先用
     這個屬性命名，蓋掉伺服器端 Content-Disposition 裡其實已經正確設定好的檔名，讓問題
     不是「沒做」而是「做錯、還蓋掉了本來對的」。改成直接使用渲染列表時已經有的正確
     檔名（透過 data-download-filename 屬性傳進來），不再嘗試從 key 反推。 */
  const originalText = btn ? btn.textContent : '';
  if (btn){ btn.disabled = true; btn.textContent = '下載中…'; }
  try {
    const { ok, res, error } = await fetchAdminResumeFileWithRetry((token) => [
      '/.netlify/functions/admin-resume-file?key=' + encodeURIComponent(key),
      { headers: { 'Authorization': 'Bearer ' + token } }
    ]);
    if (!ok){ alert(error || '下載失敗'); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename || 'resume';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  } catch (e){ console.error(e); alert('下載時發生錯誤'); }
  finally { if (btn){ btn.disabled = false; btn.textContent = originalText; } }
}

async function deleteAdminResume(key, btn){
  if (!confirm('確定要刪除這份履歷檔案嗎？此動作無法復原，會釋放 Netlify Blobs 空間。')) return;
  if (btn){ btn.disabled = true; btn.textContent = '刪除中…'; }
  try {
    const { ok, error } = await fetchAdminResumeFileWithRetry((token) => [
      '/.netlify/functions/admin-resume-file',
      {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', key })
      }
    ]);
    if (!ok){ alert(error || '刪除失敗'); if (btn){ btn.disabled = false; btn.textContent = '刪除'; } return; }
    openAdminPanel(); // 重新整理列表（列表重繪後按鈕會是全新元素，不需要另外還原文字）
  } catch (e){
    console.error(e); alert('刪除時發生錯誤');
    if (btn){ btn.disabled = false; btn.textContent = '刪除'; }
  }
}

