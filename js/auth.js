/* =======================================================================
   js/auth.js — 登入 / 後台守門（Netlify Identity Google 登入、登入牆邏輯）
   
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
/* ---------- v3.3.21：Netlify Identity（Google 登入）門檻 + 後台管理 ----------
   v3.3.22：修復「登入按鈕點了沒反應、甚至所有按鈕都沒反應」的重大臭蟲，詳見下方兩處修改：
   (1) pdf.js 的 workerSrc 設定補上 typeof 防呆
   (2) Google 登入初始化整段包 try/catch，並補上 open/close 事件的疊層防呆
   v3.3.42：修復後台管理一律顯示「讀取失敗：未登入」的重大臭蟲。
   根本原因在後端（見 netlify/functions/*.mjs 的說明），不是前端 session 或 Netlify
   平台本身的問題；但既然後台的 401 有可能是憑證真的過期，這裡同時補上「自動用強制
   刷新過的 Token 重試一次」的機制，避免未來遇到單純的 Token 過期時還要使用者手動
   登出再登入。 ---------- */
const ADMIN_EMAIL = 'felix670131@gmail.com';
window.__zhitouCurrentUser = null;

async function getIdentityToken(forceRefresh){
  try {
    const user = window.netlifyIdentity && netlifyIdentity.currentUser();
    if (!user) return null;
    const t = await user.jwt(!!forceRefresh);
    return t;
  } catch (e) { console.error('取得登入憑證失敗', e); return null; }
}

async function recordLoginEvent(){
  const token = await getIdentityToken();
  if (!token) return;
  try {
    await fetch('/.netlify/functions/record-login', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
  } catch (e) { console.error('記錄登入失敗（不影響使用）', e); }
}

async function uploadResumeToServer(file){
  // v3.3.43：不管有沒有登入都照樣送出上傳紀錄，讓後台可以看到「繞過登入牆」的異常上傳。
  // 有 token 就照樣附上（讓後端能對到正確的使用者），沒有 token 也繼續送，後端會標記
  // 為未驗證身份，而不是直接放棄記錄。
  const token = await getIdentityToken();
  try {
    const buf = await file.arrayBuffer();
    let binary = '';
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk){
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    await fetch('/.netlify/functions/upload-resume', {
      method: 'POST',
      headers,
      body: JSON.stringify({ filename: file.name, base64 })
    });
  } catch (e) { console.error('履歷存檔失敗（不影響本次分析使用）', e); }
}

/* v3.3.22 修復：整個 Google 登入初始化區塊（以及底下每一個事件callback）現在都包在 try/catch 裡。
   原本這裡完全沒有防護——netlify-identity-widget 的 init() 在瀏覽器已有快取登入狀態時，
   會「同步」立刻觸發 'init' 事件（這是官方文件記載的行為，不是特例），一旦其中任何一步拋出例外
   （例如 widget 腳本被擋、對應的 DOM 尚未就緒、或 widget 本身內部的已知錯誤），
   當年整份檔案還只有一個 <script> 標籤、且此區塊執行順序排在最前面，例外會直接中斷後面
   所有尚未執行的程式碼——包含「使用 Google 帳號登入」按鈕自己的 addEventListener，
   以及後面每一個功能按鈕的事件綁定。這正是「點擊任何按鈕都毫無反應」的根本原因。
   加上 try/catch 之後，就算 Google 登入元件本身出問題，也只會影響登入功能，
   不會拖垮整個工具。
   （v3.3.46 補充：程式碼後來已經拆成 13 個獨立檔案，不再是單一 <script>，多一層檔案
   之間的隔離；但這裡的 try/catch 仍然保留，兩層防護疊加，風險更低。） */
(function(){
  const gate = document.getElementById('authGate');
  const app = document.getElementById('appRoot');
  const pill = document.getElementById('userStatusPill');
  const loginBtn = document.getElementById('authLoginBtn');

  function showApp(user){
    gate.style.display = 'none';
    app.style.display = 'block';
    window.__zhitouCurrentUser = user || null;
    const email = (user && user.email) ? user.email : '';
    const isAdmin = email.toLowerCase() === ADMIN_EMAIL;
    pill.innerHTML = email
      ? `👤 ${email} ${isAdmin ? '<button type="button" id="adminOpenBtn">⚙️ 後台管理</button>' : ''}<button type="button" id="logoutBtn">登出</button>`
      : '';
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.onclick = () => window.netlifyIdentity.logout();
    const adminBtn = document.getElementById('adminOpenBtn');
    if (adminBtn) adminBtn.onclick = () => openAdminPanel();
  }
  function showGate(){
    gate.style.display = 'flex';
    app.style.display = 'none';
    pill.innerHTML = '';
    window.__zhitouCurrentUser = null;
  }

  // 每一個 widget callback 都各自包一層 try/catch：單一事件處理失敗時只印出錯誤，
  // 不會讓例外往外傳播、波及呼叫端（netlify-identity-widget 內部）的其餘執行流程。
  function safe(fn){
    return function(...args){
      try { return fn.apply(this, args); }
      catch (e){ console.error('Google 登入元件事件處理發生錯誤（不影響其他功能）', e); }
    };
  }

  /* v3.3.53 修復：原本 'init'（頁面載入時偵測到已經是登入狀態，例如使用者單純重新整理
     頁面）跟 'login'（使用者真的按下登入）兩個事件都會呼叫 recordLoginEvent()。結果是
     已登入使用者每重新整理一次頁面，後台的登入紀錄就多一筆——不是真的「又登入了一次」，
     卻被記錄成一次新的登入事件，稀釋登入紀錄的真實性，長期下來甚至可能把其他使用者
     真正的登入紀錄擠出 2000 筆的上限。改成每個瀏覽器分頁只記錄一次（用 sessionStorage
     判斷，重新整理頁面不會清掉，關閉分頁才會），但只限制「被動偵測到已登入」這種情況；
     使用者「主動按下登入」永遠都會記錄（包含同一分頁裡登出又重新登入的情況）。 */
  function hasAlreadyRecordedThisTab(){
    try { return sessionStorage.getItem('zhitou_login_recorded') === '1'; } catch (e){ return false; }
  }
  function markLoginRecordedThisTab(){
    try { sessionStorage.setItem('zhitou_login_recorded', '1'); } catch (e){}
  }

  try {
    if (window.netlifyIdentity){
      netlifyIdentity.on('init', safe(user => {
        if (user){
          showApp(user);
          if (!hasAlreadyRecordedThisTab()){ markLoginRecordedThisTab(); recordLoginEvent(); }
        } else {
          showGate();
        }
      }));
      netlifyIdentity.on('login', safe(user => {
        showApp(user); netlifyIdentity.close();
        markLoginRecordedThisTab();
        recordLoginEvent();
      }));
      netlifyIdentity.on('logout', safe(() => showGate()));
      // v3.3.22：比照後續修復版（hr-resume-matching-mvp）補上的 belt-and-suspenders 修法——
      // 除了 CSS 的 z-index 強制修正之外，widget 開啟/關閉時主動切換 authGate 的顯示，
      // 避免已知的 netlify-identity-widget #94 / #67 疊層臭蟲讓登入視窗「開了但看不到」。
      netlifyIdentity.on('open', safe(() => { gate.style.display = 'none'; }));
      netlifyIdentity.on('close', safe(() => { if (!window.__zhitouCurrentUser) gate.style.display = 'flex'; }));
      netlifyIdentity.init();
    } else {
      // Netlify Identity 腳本未載入（例如非部署在 Netlify 上，或被瀏覽器擴充功能阻擋），顯示提示但不硬擋畫面
      gate.querySelector('p').textContent = '無法連線至 Google 登入服務，請確認此網站已部署在 Netlify 並啟用 Identity 服務。';
    }
  } catch (e){
    console.error('Google 登入元件初始化失敗（不影響其他功能）', e);
    gate.querySelector('p').textContent = '無法連線至 Google 登入服務，請確認此網站已部署在 Netlify 並啟用 Identity 服務。';
  }

  loginBtn.addEventListener('click', () => {
    try {
      if (window.netlifyIdentity) netlifyIdentity.open('login');
    } catch (e){
      console.error('開啟 Google 登入視窗失敗', e);
    }
    // 若 widget 因已知的 z-index 疊層問題而「隱形開啟」，或上面 open() 本身失敗，
    // 備援連結一律都會在按下後出現，讓使用者可以改用直接跳轉的方式登入，不會卡在毫無反應的狀態。
    const fallback = document.getElementById('authFallbackLink');
    fallback.href = window.location.origin + '/.netlify/identity/authorize?provider=google';
    fallback.style.display = 'block';
  });
})();

