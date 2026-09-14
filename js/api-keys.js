/* =======================================================================
   js/api-keys.js — 多供應商 API Key 管理（Claude / Gemini / ChatGPT / Agnes AI 金鑰設定視窗）
   
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
/* =========================================================
   多供應商 API Key 管理（Claude / Gemini / ChatGPT / Agnes AI）
   金鑰只暫存在本次瀏覽器分頁的 sessionStorage，不會上傳到任何伺服器。
   若使用者沒有設定任何金鑰，維持原本行為：呼叫系統內建連線
   （不帶金鑰，僅在支援此免金鑰連線的環境，例如 Claude 網頁/App 的
   Artifact 預覽環境中才會成功；在一般瀏覽器直接開啟此檔案時，
   請務必先在「AI API Key 設定」貼上你自己的金鑰）。
========================================================= */
const RM_KEY_PREFIX = 'resumeMatcher_';
function getProvider(){ try{ return sessionStorage.getItem(RM_KEY_PREFIX+'provider')||''; }catch(e){ return ''; } }
function setProvider(p){ try{ sessionStorage.setItem(RM_KEY_PREFIX+'provider', p); }catch(e){} }
function getKeyFor(provider){ try{ return sessionStorage.getItem(RM_KEY_PREFIX+'key_'+provider)||''; }catch(e){ return ''; } }
function setKeyFor(provider,k){ try{ sessionStorage.setItem(RM_KEY_PREFIX+'key_'+provider, k); }catch(e){} }
function removeKeyFor(provider){ try{ sessionStorage.removeItem(RM_KEY_PREFIX+'key_'+provider); }catch(e){} }
function isAiKeyMode(){ const p=getProvider(); return !!(p && getKeyFor(p)); }

const PROVIDER_LABEL = { claude:'Claude (Anthropic)', gemini:'Gemini (Google AI Studio)', chatgpt:'ChatGPT (OpenAI)', agnes:'Agnes AI' };
let currentProviderTab = 'claude';

function switchProviderTab(p){
  currentProviderTab = p;
  document.querySelectorAll('.provider-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.provider === p));
  ['claude','gemini','chatgpt','agnes'].forEach(name => {
    const pane = document.getElementById('provider-pane-' + name);
    if (pane) pane.style.display = (name === p) ? 'block' : 'none';
  });
}

function refreshApiUi(){
  const pill = document.getElementById('apiStatusPill');
  const modalMode = document.getElementById('modal-current-mode');
  const provider = getProvider();
  if (isAiKeyMode()){
    if (pill){ pill.classList.add('on'); pill.textContent = '已啟用：' + PROVIDER_LABEL[provider]; }
    if (modalMode) modalMode.innerHTML = '目前狀態：<b>' + PROVIDER_LABEL[provider] + ' 已啟用</b>（使用你自己貼上的 API Key）';
  } else {
    if (pill){ pill.classList.remove('on'); pill.textContent = '尚未設定 API Key（使用系統內建連線）'; }
    if (modalMode) modalMode.textContent = '目前狀態：系統內建連線（未設定任何 API Key）';
  }
}

function openApiModal(){
  const p = getProvider() || 'claude';
  switchProviderTab(p);
  document.getElementById('api-key-input-claude').value  = getKeyFor('claude');
  document.getElementById('api-key-input-gemini').value  = getKeyFor('gemini');
  document.getElementById('api-key-input-chatgpt').value = getKeyFor('chatgpt');
  document.getElementById('api-key-input-agnes').value   = getKeyFor('agnes');
  try{ document.getElementById('api-baseurl-agnes').value = sessionStorage.getItem(RM_KEY_PREFIX+'baseurl_agnes')||''; }catch(e){}
  refreshApiUi();
  document.getElementById('api-modal').classList.add('open');
}
function closeApiModal(){ document.getElementById('api-modal').classList.remove('open'); }

function isValidGeminiKeyFormat(v){ return v.startsWith('AIza') || v.startsWith('AQ.'); }

function saveApiKey(){
  const p = currentProviderTab;
  const v = document.getElementById('api-key-input-' + p).value.trim();
  if (!v){ alert('請先貼上 API Key，或按「清除並改用系統內建」。'); return; }
  if (p === 'claude'  && !v.startsWith('sk-ant-')) { alert('這不像是有效的 Anthropic API Key 格式（應以 sk-ant- 開頭），請確認後再試'); return; }
  if (p === 'gemini'  && !isValidGeminiKeyFormat(v)) { alert('這不像是有效的 Google AI Studio API Key 格式（應以 AIza 或 AQ. 開頭），請確認後再試'); return; }
  if (p === 'chatgpt' && !v.startsWith('sk-')) { alert('這不像是有效的 OpenAI API Key 格式（應以 sk- 開頭），請確認後再試'); return; }
  // Agnes AI：不限制格式，接受任何非空金鑰
  setKeyFor(p, v);
  setProvider(p);
  if (p === 'agnes'){
    const baseUrl = document.getElementById('api-baseurl-agnes').value.trim();
    try{ sessionStorage.setItem(RM_KEY_PREFIX+'baseurl_agnes', baseUrl); }catch(e){}
  }
  refreshApiUi();
  closeApiModal();
}

function clearApiKey(){
  ['claude','gemini','chatgpt','agnes'].forEach(removeKeyFor);
  try{
    sessionStorage.removeItem(RM_KEY_PREFIX+'provider');
    sessionStorage.removeItem(RM_KEY_PREFIX+'baseurl_agnes');
  }catch(e){}
  ['claude','gemini','chatgpt','agnes'].forEach(p => {
    const el = document.getElementById('api-key-input-' + p);
    if (el) el.value = '';
  });
  const baseUrlEl = document.getElementById('api-baseurl-agnes');
  if (baseUrlEl) baseUrlEl.value = '';
  refreshApiUi();
  closeApiModal();
}

