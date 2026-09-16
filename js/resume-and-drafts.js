/* =======================================================================
   js/resume-and-drafts.js — 履歷上傳與草稿自動保存（PDF/Word 解析、簡報與履歷版型、草稿存取）
   
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
/* ---------- global resume upload ---------- */
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const fileChip = document.getElementById('fileChip');
const fileNameEl = document.getElementById('fileName');
const removeFileBtn = document.getElementById('removeFile');
const pdfStatus = document.getElementById('pdfStatus');
const sharedJobDesc = document.getElementById('sharedJobDesc');

const jobDescSnapshot = { 1: null, 2: null, 4: null, 6: null, 7: null };
/* v3.3.49 修復：原本用 resumeFileLabel（只是檔名）＋職缺說明來判斷「輸入是否變過」，
   如果使用者把履歷內容改了、但重新匯出時檔名沒變（例如都叫「履歷.pdf」），這裡算出來
   的 key 會一模一樣，導致系統誤判「沒有過期」，不會提示重新產生，可能讓使用者拿著
   舊分析結果去用。改成直接反映履歷「內容」本身：用長度＋簡單雜湊值當內容指紋，而不是
   把整份履歷全文塞進 snapshot（那樣會讓存到草稿裡的資料重複膨脹好幾倍，因為每個分頁
   的 snapshot 都會各存一份）。這裡只是用來比對「有沒有變」，不需要真的可還原，一般
   雜湊碰撞機率極低，不影響實際使用。 */
function simpleContentFingerprint(text){
  let hash = 0;
  for (let i = 0; i < text.length; i++){
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return text.length + ':' + hash;
}
function currentInputKey(extra){
  return simpleContentFingerprint(resumeText.trim()) + '|' + sharedJobDesc.value.trim() + (extra ? '|' + extra : '');
}

function setTabDot(tabNum, state){
  const dot = document.getElementById('dot' + tabNum);
  if (!dot) return;
  dot.classList.remove('done', 'stale', 'show');
  if (state === 'hide') return;
  dot.classList.add('show', state);
}

function refreshStaleIndicators(){
  /* v3.3.51 修復：原本 5 個頁籤共用同一個 currentInputKey()（只看履歷內容＋職缺說明），
     但 tab1（媒合）的推薦信語氣其實還受「職務類型」影響、tab7（提案簡報）的內容還受
     「補充背景資訊」影響、反問面試官還受「市場統計資訊」影響——這幾個欄位改變之後，
     結果理論上也該算過期，卻因為沒被包進比對範圍，不會顯示⚠️過期提示。這裡改成每個
     頁籤各自帶上自己會用到的額外欄位一起比對，不會影響到沒有用到那些欄位的其他頁籤。 */
  const jobTypeEl = document.getElementById('jobType');
  const dt7ExtraEl = document.getElementById('dt7ExtraContext');
  const currentByTab = {
    1: currentInputKey(jobTypeEl ? jobTypeEl.value : ''),
    2: currentInputKey(),
    4: currentInputKey(),
    6: currentInputKey(),
    7: currentInputKey(dt7ExtraEl ? dt7ExtraEl.value.trim() : '')
  };
  [1, 2, 4, 6, 7].forEach(n => {
    const banner = document.getElementById('staleBanner' + n);
    if (jobDescSnapshot[n] === null) return;
    const stale = jobDescSnapshot[n] !== currentByTab[n];
    if (banner) banner.classList.toggle('show', stale);
    setTabDot(n, stale ? 'stale' : 'done');
  });
  if (jobDescSnapshotReverse.value !== null){
    const reverseCurrent = currentInputKey(marketStatsInput ? marketStatsInput.value.trim() : '');
    const reverseBanner = document.getElementById('staleBannerReverse');
    if (reverseBanner) reverseBanner.classList.toggle('show', jobDescSnapshotReverse.value !== reverseCurrent);
  }
}

/* =========================================================
   草稿自動保存：履歷內容、職缺說明與已產生的 AI 結果會自動存到
   使用者自己的儲存空間，重新整理頁面時可以選擇復原。
========================================================= */
let lastResult1 = null, lastResult2 = null, lastResult4 = null, lastResult6 = null, lastResult7 = null;

/* v3.3.0：提案簡報 5 款版型（世界級企業簡報常見風格）。切換版型只換 CSS 變數，不需重新呼叫 AI。 */
const DECK_THEMES = [
  { id:'mckinsey', name:'顧問經典・深藍燙金', desc:'國際顧問公司常見風格，沉穩專業，適合外商、金融、顧問業', bg:'#ffffff', fg:'#1B2A4A', accent:'#B8934A' },
  { id:'corpblue', name:'企業商務・天藍白', desc:'國際企業通用商務風格，清爽好讀，各產業皆適用', bg:'#ffffff', fg:'#0B2545', accent:'#0B5FCC' },
  { id:'techdark', name:'科技新創・暗黑霓虹', desc:'深色底＋亮色重點，適合科技業、新創、產品／設計職位', bg:'#12141A', fg:'#EDEDED', accent:'#3FD0FF' },
  { id:'swiss', name:'瑞士極簡・黑白網格', desc:'大量留白與黑白線條，適合設計、建築、精品等重視質感的產業', bg:'#ffffff', fg:'#0A0A0A', accent:'#0A0A0A' },
  { id:'sealgold', name:'東方雅緻・硃紅燙金', desc:'本站經典配色，沉穩內斂又帶點文化質感，適合傳產、文創、公部門', bg:'#F6F1E7', fg:'#1F2A3C', accent:'#9C7A3C' },
];
let selectedDeckTheme = 'mckinsey';

/* v3.3.2：客製履歷 5 款排版版型。3 款為單欄結構（僅色彩／字體不同，layout:'standard'），
   企業商務為雙欄側邊結構（layout:'sidebar'），科技新創為深色標題列結構（layout:'darkband'）。
   切換版型不需重新呼叫 AI，直接用既有的 lastResult6 資料重新渲染 DOM。 */
const RESUME_THEMES = [
  { id:'mckinsey', name:'顧問經典・單欄序列', desc:'國際顧問與外商最常見的沉穩單欄排版，適合外商、金融、顧問業', layout:'standard', bg:'#ffffff', fg:'#1B2A4A', accent:'#B8934A' },
  { id:'corpblue', name:'企業商務・雙欄側邊', desc:'左側聯絡資訊＋技能欄、右側經歷主欄，資訊層次分明，各產業皆適用', layout:'sidebar', bg:'#ffffff', fg:'#0B2545', accent:'#0B5FCC' },
  { id:'techdark', name:'科技新創・深色標題列', desc:'頂部深色標題色塊＋亮色重點，年輕俐落，適合科技業、新創、產品／設計職位', layout:'darkband', bg:'#12141A', fg:'#EDEDED', accent:'#3FD0FF' },
  { id:'swiss', name:'瑞士極簡・網格線條', desc:'大量留白與黑白線條分隔，去除裝飾，適合設計、建築、精品等重視質感的產業', layout:'standard', bg:'#ffffff', fg:'#0A0A0A', accent:'#0A0A0A' },
  { id:'sealgold', name:'東方雅緻・硃紅燙金', desc:'本站經典配色，沉穩內斂又帶文化質感，適合傳產、文創、公部門', layout:'standard', bg:'#F6F1E7', fg:'#1F2A3C', accent:'#9C7A3C' },
];
let selectedResumeTheme = 'mckinsey';

function renderResumeThemeSwatchHtml(t){
  return `<div class="dtc-swatch" style="background:${t.bg}">
    <span style="top:10px; width:58%; background:${t.fg}; opacity:.85;"></span>
    <span style="top:22px; width:38%; background:${t.accent};"></span>
    <span style="top:34px; width:70%; background:${t.fg}; opacity:.35;"></span>
  </div>`;
}

/* mode 'pick'：產生前的完整卡片選擇器；mode 'switch'：產生後的精簡按鈕列（即時換版型，不重新產生） */
function renderResumeThemePicker(containerId, mode){
  const el = document.getElementById(containerId);
  if (!el) return;
  if (mode === 'switch'){
    el.innerHTML = RESUME_THEMES.map(t =>
      `<button type="button" class="${t.id === selectedResumeTheme ? 'active' : ''}" data-theme="${t.id}">${escapeHtml(t.name)}</button>`
    ).join('');
    el.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedResumeTheme = btn.dataset.theme;
        if (lastResult6) renderTailoredResume(lastResult6);
        /* v3.3.49 修復：這裡原本只重畫了「產生前」用的完整版型選擇區
           （resumeTemplatePicker），卻沒有重畫使用者當下正在看、剛點擊的
           這個「產生後」精簡按鈕列（containerId，也就是這裡的 el 本身）——
           結果實際履歷內容有正確換成新版型，但按鈕列上「目前選中」的
           高亮標記卻停留在上一個版型，跟 tab7（提案簡報）對應的正確寫法
           不一致。改成先重畫自己所在的容器，再重畫另一個選擇區。 */
        renderResumeThemePicker(containerId, 'switch');
        renderResumeThemePicker('resumeTemplatePicker', 'pick');
        saveDraft();
      });
    });
    return;
  }
  el.innerHTML = RESUME_THEMES.map(t => `
    <div class="deck-template-card${t.id === selectedResumeTheme ? ' selected' : ''}" data-theme="${t.id}">
      ${renderResumeThemeSwatchHtml(t)}
      <div class="dtc-name">${escapeHtml(t.name)}</div>
      <div class="dtc-desc">${escapeHtml(t.desc)}</div>
    </div>`).join('');
  el.querySelectorAll('.deck-template-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedResumeTheme = card.dataset.theme;
      renderResumeThemePicker(containerId, 'pick');
      if (lastResult6){
        renderTailoredResume(lastResult6);
        saveDraft();
      }
    });
  });
}

function renderDeckThemeSwatchHtml(t){
  return `<div class="dtc-swatch" style="background:${t.bg}">
    <span style="top:10px; width:58%; background:${t.fg}; opacity:.85;"></span>
    <span style="top:22px; width:38%; background:${t.accent};"></span>
    <span style="top:34px; width:70%; background:${t.fg}; opacity:.35;"></span>
  </div>`;
}

/* mode 'pick'：產生前的完整卡片選擇器；mode 'switch'：產生後的精簡按鈕列（即時換版型，不重新產生） */
function renderDeckThemePicker(containerId, mode){
  const el = document.getElementById(containerId);
  if (!el) return;
  if (mode === 'switch'){
    el.innerHTML = DECK_THEMES.map(t =>
      `<button type="button" class="${t.id === selectedDeckTheme ? 'active' : ''}" data-theme="${t.id}">${escapeHtml(t.name)}</button>`
    ).join('');
    el.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedDeckTheme = btn.dataset.theme;
        applyDeckThemeToExport();
        renderDeckThemePicker(containerId, 'switch');
        renderDeckThemePicker('deckTemplatePicker', 'pick');
        saveDraft();
      });
    });
    return;
  }
  el.innerHTML = DECK_THEMES.map(t => `
    <div class="deck-template-card${t.id === selectedDeckTheme ? ' selected' : ''}" data-theme="${t.id}">
      ${renderDeckThemeSwatchHtml(t)}
      <div class="dtc-name">${escapeHtml(t.name)}</div>
      <div class="dtc-desc">${escapeHtml(t.desc)}</div>
    </div>`).join('');
  el.querySelectorAll('.deck-template-card').forEach(card => {
    card.addEventListener('click', () => {
      selectedDeckTheme = card.dataset.theme;
      renderDeckThemePicker(containerId, 'pick');
      if (lastResult7){
        applyDeckThemeToExport();
        renderDeckThemePicker('deckThemeSwitch', 'switch');
        saveDraft();
      }
    });
  });
}

function applyDeckThemeToExport(){
  const area = document.getElementById('slidesExportArea');
  if (!area) return;
  DECK_THEMES.forEach(t => area.classList.remove('theme-' + t.id));
  area.classList.add('theme-' + selectedDeckTheme);
}
const lastResultReverse = { value: null };
let saveDraftTimer = null;

function scheduleDraftSave(){
  clearTimeout(saveDraftTimer);
  saveDraftTimer = setTimeout(saveDraft, 800);
}

/* v3.3.57 修復（根本原因）：這裡原本用的是 window.storage.get/set/delete，這其實是
   Claude.ai 的 Artifact 沙盒環境才有提供的專屬 API，不是瀏覽器原生支援的標準功能。
   這個工具本來就是要部署成一般網站（Netlify）給任何人用一般瀏覽器開啟，一旦不是在
   Claude.ai 的 Artifact 預覽畫面裡執行，window.storage 根本不存在，呼叫
   window.storage.set(...) 一定會直接丟出「Cannot read properties of undefined」
   之類的例外。這正是 v3.3.53 加上的「自動存檔失敗」警示會一開啟就跳出來的根本原因——
   不是那次修的邏輯有問題，而是它正確地把這個從一開始就存在、只是先前被靜默吞掉的
   真正問題揭露出來了。
   修法：改用瀏覽器原生就有的 localStorage，是所有瀏覽器都支援的標準 API，資料會留在
   使用者自己的瀏覽器裡（不會上傳到任何伺服器），行為上等同於原本 window.storage
   想做到的事情——重新整理頁面、甚至關閉分頁再打開，都能讀回上次的內容。 */
const DRAFT_STORAGE_KEY = 'zhitou_jobsight_draft';

async function saveDraft(){
  try {
    const draft = {
      resumeText, resumeFileLabel,
      jobType: document.getElementById('jobType').value,
      sharedJobDesc: sharedJobDesc.value,
      marketStats: marketStatsInput ? marketStatsInput.value : '',
      tab1: lastResult1 ? { parsed: lastResult1, snapshotKey: jobDescSnapshot[1] } : null,
      tab2: lastResult2 ? { parsed: lastResult2, snapshotKey: jobDescSnapshot[2] } : null,
      tab4: lastResult4 ? { parsed: lastResult4, snapshotKey: jobDescSnapshot[4] } : null,
      tab6: lastResult6 ? { parsed: lastResult6, snapshotKey: jobDescSnapshot[6], theme: selectedResumeTheme } : null,
      tab7: lastResult7 ? { parsed: lastResult7, snapshotKey: jobDescSnapshot[7], theme: selectedDeckTheme } : null,
      dt7ExtraContext: (document.getElementById('dt7ExtraContext') || {}).value || '',
      reverse: lastResultReverse.value ? { parsed: lastResultReverse.value, snapshotKey: jobDescSnapshotReverse.value } : null,
      savedAt: new Date().toISOString()
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    /* v3.3.53 修復：存檔成功時，如果之前顯示過失敗警示，這裡要記得收回去，避免使用者
       明明已經恢復正常，畫面卻一直卡著舊的警示訊息。 */
    const warningEl = document.getElementById('draftSaveWarning');
    if (warningEl && warningEl.style.display !== 'none') warningEl.style.display = 'none';
  } catch (e){
    console.error('草稿保存失敗', e);
    addDebugLog({ type: 'error', label: 'draft', message: '自動存檔失敗：' + e.message });
    /* v3.3.53 修復：原本存檔失敗只寫進主控台，一般使用者完全看不到，會誤以為工作
       內容都有自動保存。這裡補上一個明顯但不會打斷操作的警示區塊（不是用 alert()
       彈窗，避免使用者正在打字時被強制中斷）。 */
    const warningEl = document.getElementById('draftSaveWarning');
    if (warningEl) warningEl.style.display = 'block';
  }
}

async function checkForDraft(){
  let draft = null;
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (raw) draft = JSON.parse(raw);
  } catch (e){
    draft = null;
  }
  const hasContent = draft && (draft.resumeFileLabel || (draft.sharedJobDesc && draft.sharedJobDesc.trim().length > 10));
  if (!hasContent) return;
  showDraftBanner(draft);
}

function showDraftBanner(draft){
  const banner = document.getElementById('draftBanner');
  const text = document.getElementById('draftBannerText');
  const when = draft.savedAt ? new Date(draft.savedAt).toLocaleString('zh-TW') : '';
  text.textContent = `偵測到上次未完成的內容${when ? '（' + when + '）' : ''}，要復原履歷、職缺說明與已產生的結果嗎？`;
  banner.style.display = 'flex';
  document.getElementById('restoreDraftBtn').addEventListener('click', () => {
    applyDraft(draft);
    banner.style.display = 'none';
  }, { once: true });
  document.getElementById('dismissDraftBtn').addEventListener('click', async () => {
    banner.style.display = 'none';
    try { localStorage.removeItem(DRAFT_STORAGE_KEY); } catch (e){}
  }, { once: true });
}

function applyDraft(draft){
  // 舊草稿可能是在修正 PDF 擷取邏輯之前存的，這裡一併清掉殘留的 \u0000。
  resumeText = (draft.resumeText || '').replace(/\u0000/g, '');
  resumeFileLabel = draft.resumeFileLabel || '';
  if (resumeText && resumeFileLabel){
    fileNameEl.textContent = `${resumeFileLabel} · 已還原`;
    fileChip.style.display = 'flex';
    dropzone.style.display = 'none';
    pdfStatus.textContent = '已解析（已還原）';
    renderPdfPreview(resumeText);
  }
  if (draft.jobType) document.getElementById('jobType').value = draft.jobType;
  sharedJobDesc.value = draft.sharedJobDesc || '';
  document.getElementById('jdCountShared').textContent = sharedJobDesc.value.length + ' 字';
  if (marketStatsInput) marketStatsInput.value = draft.marketStats || '';

  if (draft.tab1 && draft.tab1.parsed){
    renderMatchResults(draft.tab1.parsed);
    lastResult1 = draft.tab1.parsed;
    jobDescSnapshot[1] = draft.tab1.snapshotKey;
    setTabDot(1, 'done');
    updateStepMeta(1, draft.tab1.parsed.__meta || null);
  }
  if (draft.tab2 && draft.tab2.parsed){
    renderHealthCheck(draft.tab2.parsed);
    lastResult2 = draft.tab2.parsed;
    jobDescSnapshot[2] = draft.tab2.snapshotKey;
    setTabDot(2, 'done');
    updateStepMeta(2, draft.tab2.parsed.__meta || null);
  }
  if (draft.tab4 && draft.tab4.parsed){
    const questions = Array.isArray(draft.tab4.parsed.questions) ? draft.tab4.parsed.questions : [];
    if (questions.length) renderInterviewQuestions(questions);
    lastResult4 = draft.tab4.parsed;
    jobDescSnapshot[4] = draft.tab4.snapshotKey;
    setTabDot(4, 'done');
    updateStepMeta(4, draft.tab4.parsed.__meta || null);
  }
  if (draft.reverse && draft.reverse.parsed){
    renderReverseInterview(draft.reverse.parsed);
    lastResultReverse.value = draft.reverse.parsed;
    jobDescSnapshotReverse.value = draft.reverse.snapshotKey;
  }
  if (draft.tab6 && draft.tab6.parsed){
    if (draft.tab6.theme && RESUME_THEMES.some(t => t.id === draft.tab6.theme)) selectedResumeTheme = draft.tab6.theme;
    renderTailoredResume(draft.tab6.parsed);
    lastResult6 = draft.tab6.parsed;
    jobDescSnapshot[6] = draft.tab6.snapshotKey;
    setTabDot(6, 'done');
    updateStepMeta(6, draft.tab6.parsed.__meta || null);
  }
  renderResumeThemePicker('resumeTemplatePicker', 'pick');
  const dt7ExtraContextEl = document.getElementById('dt7ExtraContext');
  if (dt7ExtraContextEl) dt7ExtraContextEl.value = draft.dt7ExtraContext || '';
  if (draft.tab7 && draft.tab7.parsed){
    if (draft.tab7.theme && DECK_THEMES.some(t => t.id === draft.tab7.theme)) selectedDeckTheme = draft.tab7.theme;
    renderProposalDeck(draft.tab7.parsed);
    lastResult7 = draft.tab7.parsed;
    jobDescSnapshot[7] = draft.tab7.snapshotKey;
    setTabDot(7, 'done');
    updateStepMeta(7, draft.tab7.parsed.__meta || null);
  }
  renderDeckThemePicker('deckTemplatePicker', 'pick');

  updateAllButtonStates();
  refreshStaleIndicators();
}

sharedJobDesc.addEventListener('input', () => {
  document.getElementById('jdCountShared').textContent = sharedJobDesc.value.length + ' 字';
  updateAllButtonStates();
  refreshStaleIndicators();
  scheduleDraftSave();
});

/* v3.3.51 修復：換職務類型會影響推薦信語氣，原本只觸發草稿保存，沒有一併檢查
   tab1 的結果是否因此過期。 */
document.getElementById('jobType').addEventListener('change', () => {
  refreshStaleIndicators();
  scheduleDraftSave();
});

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', e => {
  e.preventDefault(); dropzone.classList.remove('drag');
  if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) handleFile(fileInput.files[0]); });
removeFileBtn.addEventListener('click', () => {
  resumeText = ''; resumeFileLabel = '';
  fileInput.value = ''; fileChip.style.display = 'none'; dropzone.style.display = 'block';
  pdfStatus.textContent = '尚未上傳'; pdfStatus.classList.remove('err');
  hidePdfPreview();
  updateAllButtonStates();
  refreshStaleIndicators();
  saveDraft();
});

/* =========================================================
   v3.2.15 新增①：PDF 文字擷取預覽（前 150 字…後 150 字）。
   讓使用者上傳履歷後，能親眼確認 pdf.js 實際擷取到的文字內容是否完整、
   有沒有明顯缺漏或亂碼，而不是只能盲目相信「已解析」三個字。
   預設只顯示頭尾各 150 字（避免整份履歷洗版），並提供「顯示完整擷取
   文字」的展開按鈕，方便進一步比對。
========================================================= */
const pdfPreviewBox = document.getElementById('pdfPreviewBox');
const pdfPreviewToggleBtn = document.getElementById('pdfPreviewToggleBtn');
let pdfPreviewFullText = '';
let pdfPreviewExpanded = false;

function renderPdfPreview(text){
  pdfPreviewFullText = text || '';
  pdfPreviewExpanded = false;
  if (!pdfPreviewFullText){ hidePdfPreview(); return; }
  pdfPreviewToggleBtn.style.display = 'inline-block';
  pdfPreviewToggleBtn.textContent = '顯示完整擷取文字';
  renderPdfPreviewContent();
}

function renderPdfPreviewContent(){
  const text = pdfPreviewFullText;
  pdfPreviewBox.style.display = 'block';
  if (pdfPreviewExpanded){
    pdfPreviewBox.innerHTML = '<span class="ppb-label">完整擷取文字（共 ' + text.length + ' 字）：</span>' + escapeHtml(text);
    return;
  }
  if (text.length <= 320){
    pdfPreviewBox.innerHTML = '<span class="ppb-label">擷取文字預覽（共 ' + text.length + ' 字，內容不多，已完整顯示）：</span>' + escapeHtml(text);
    return;
  }
  const head = text.slice(0, 150);
  const tail = text.slice(-150);
  const omitted = text.length - 300;
  pdfPreviewBox.innerHTML = '<span class="ppb-label">擷取文字預覽（共 ' + text.length + ' 字，前 150 字…後 150 字）：</span>' +
    escapeHtml(head) + '<span class="ppb-ellipsis"> ......（中間省略 ' + omitted + ' 字）...... </span>' + escapeHtml(tail);
}

function hidePdfPreview(){
  pdfPreviewFullText = '';
  pdfPreviewExpanded = false;
  pdfPreviewBox.style.display = 'none';
  pdfPreviewBox.innerHTML = '';
  pdfPreviewToggleBtn.style.display = 'none';
}

pdfPreviewToggleBtn.addEventListener('click', () => {
  pdfPreviewExpanded = !pdfPreviewExpanded;
  pdfPreviewToggleBtn.textContent = pdfPreviewExpanded ? '收合，只顯示前後 150 字' : '顯示完整擷取文字';
  renderPdfPreviewContent();
});

/* =========================================================
   v2.8.99 修正②：PDF 文字擷取品質檢查。
   實測發現：部分 PDF（尤其是某些線上履歷產生器匯出的檔案，例如本次
   用來測試的「游士賢.pdf」）內嵌字型的 ToUnicode 對照表本身就不完整，
   導致無論用哪個 PDF 解析函式庫（pdf.js／pdfminer 等）擷取文字，都會
   有相當比例的字被還原成空白字元（\u0000）而不是原本的中文字，這是
   PDF 檔案本身的問題，不是本工具解析邏輯的錯誤，但若不處理，這些
   \u0000 字元會混進送給 AI 的內容，除了讓 AI 讀到殘缺的履歷、影響
   分析準確率之外，也可能造成 AI 因為要「猜測」殘缺內容而多花不少
   token 在推敲文意，進而更容易撞到 maxTokens 上限、導致 JSON 被截斷
   ——這正是「履歷健診」等功能出現 truncated／無法解析 錯誤的原因之一。
   因此在指派 resumeText 前，先做兩件事：
   ① 移除 \u0000（NUL）字元，避免無意義的殘缺字元混入 AI 提示詞。
   ② 計算「疑似遺失字元」比例，若比例偏高，明確提示使用者此份檔案
      的文字圖層可能不完整，讓使用者自行判斷是否要改用貼上純文字。
   v3.3.46：這個函式原本只處理 PDF，但邏輯本身跟檔案格式無關（純粹是
   文字清理），所以 Word（.docx）上傳也直接沿用同一個函式，不需要另外
   寫一份。
========================================================= */
function sanitizeExtractedPdfText(rawText){
  const totalLen = rawText.length || 1;
  const nulCount = (rawText.match(/\u0000/g) || []).length;
  const cleaned = rawText.replace(/\u0000/g, '').replace(/[ \t]{2,}/g, ' ');
  const corruptionRatio = nulCount / totalLen;
  return { cleaned, corruptionRatio, nulCount };
}

/* =========================================================
   v3.3.46 新增：支援上傳 Word（.docx）履歷。
   原本這個工具只接受 PDF，但很多人手邊的履歷本來就是 .docx，被迫得先
   自己另存成 PDF 才能用；而這個工具本身卻能「輸出」Word 檔，形成
   進、出格式不對等的落差。這裡改用副檔名＋MIME type 雙重判斷檔案
   類型（單看瀏覽器回報的 MIME type 在部分作業系統上不夠可靠），
   .docx 用瀏覽器端的 mammoth.js 直接擷取純文字，不需要任何後端處理，
   後續全部沿用同一套 resumeText 分析流程，完全不用改動其他功能。
   舊版 .doc（非 XML 格式）目前的免費前端函式庫都無法可靠解析，所以
   明確擋下並提示使用者另存成 .docx 或 PDF，而不是讓它悄悄解析失敗。
========================================================= */
function detectResumeFileKind(file){
  const name = (file.name || '').toLowerCase();
  const type = file.type || '';
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  ) return 'docx';
  if (name.endsWith('.doc')) return 'doc-unsupported';
  return null;
}

/* v3.3.51 修復：這裡原本沒有任何機制防止「使用者快速連續選了兩個檔案」的情況——如果
   檔案 A（例如較大的多頁 PDF）還在解析中，使用者又選了檔案 B，兩次 handleFile() 會
   同時執行，最後「完成」的那次會覆蓋另一次的結果，可能出現畫面顯示的檔名跟實際
   resumeText 內容對不上的情況。加上一個簡單的序號防護：每次呼叫都記錄自己的序號，
   真正要寫入 resumeText 等共用狀態之前，先確認序號還是最新的，不是就直接放棄套用
   （使用者選的最後一個檔案，才是真正想要的那一個）。 */
let fileUploadSeq = 0;

/* v3.3.57 修復：原本用 content.items.map(it => it.str).join(' ') 把 pdf.js 擷取出來的
   每一小段文字直接用空白字元接起來。這對「一個 item 就是一整個英文單字」的 PDF 沒問題，
   但很多 PDF（尤其是中文內容，或某些履歷產生工具匯出的檔案）會把「每一個字」都存成
   單獨一個 item，這樣不分青紅皂白地每個 item 中間都塞一個空白，結果就是「個 人 資 料」
   這種每個字之間都被空一格的擷取結果，讀起來很奇怪，也可能讓 AI 分析時多花不必要的
   token 去理解這些其實不存在的空格。
   改成依照每個文字片段實際的座標位置判斷：只有當前後兩個片段之間「真的有明顯間隔」
   （例如一個英文單字跟下一個單字之間），才補上空白；同一行內間隔很小（例如中文
   PDF 逐字排列）就直接接起來、不加空白；偵測到 Y 座標换行則換行。 */
function joinPdfTextItems(items){
  let result = '';
  let lastItem = null;
  for (const item of items){
    const str = item.str || '';
    if (!str){ continue; } // pdf.js 有時會給空字串的定位標記，跳過即可
    if (lastItem){
      const lastY = lastItem.transform[5];
      const curY = item.transform[5];
      const sameLine = Math.abs(curY - lastY) < Math.max(2, (item.height || 10) * 0.4);
      if (!sameLine){
        result += '\n';
      } else {
        const lastEndX = lastItem.transform[4] + (lastItem.width || 0);
        const curStartX = item.transform[4];
        const gap = curStartX - lastEndX;
        const spaceThreshold = Math.max(1.5, (item.height || lastItem.height || 10) * 0.28);
        if (gap > spaceThreshold) result += ' ';
      }
    }
    result += str;
    lastItem = item;
  }
  return result;
}

async function handleFile(file){
  const mySeq = ++fileUploadSeq;
  const kind = detectResumeFileKind(file);
  if (kind === 'doc-unsupported'){
    pdfStatus.textContent = '不支援舊版 .doc 格式，請在 Word 另存新檔為 .docx，或轉存成 PDF 後再上傳';
    pdfStatus.classList.add('err');
    return;
  }
  if (!kind){
    pdfStatus.textContent = '請上傳 PDF 或 Word（.docx）檔案';
    pdfStatus.classList.add('err');
    return;
  }
  pdfStatus.classList.remove('err');
  pdfStatus.textContent = '解析中…';
  try {
    const buf = await file.arrayBuffer();
    let text = '';
    let fileMetaLabel = '';

    if (kind === 'pdf'){
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      for (let i = 1; i <= pdf.numPages; i++){
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += joinPdfTextItems(content.items) + '\n';
      }
      fileMetaLabel = `${pdf.numPages} 頁 · `;
    } else {
      // kind === 'docx'
      if (typeof mammoth === 'undefined'){
        pdfStatus.textContent = 'Word 解析元件載入失敗，請重新整理頁面後再試一次，或改用 PDF';
        pdfStatus.classList.add('err');
        return;
      }
      const result = await mammoth.extractRawText({ arrayBuffer: buf });
      text = result.value || '';
    }

    text = text.trim();
    if (!text){
      pdfStatus.textContent = kind === 'pdf'
        ? '讀不到文字內容，可能是掃描檔（沒有文字圖層）'
        : '讀不到文字內容，這份 Word 檔可能是空白文件或內容都是圖片';
      pdfStatus.classList.add('err');
      return;
    }
    if (mySeq !== fileUploadSeq){
      // 使用者在這次解析完成之前，又選了另一個檔案——那次呼叫才是使用者真正想要的
      // 最終結果，這裡直接放棄套用，避免兩次結果互相覆蓋、畫面對不上實際內容。
      return;
    }
    const { cleaned, corruptionRatio } = sanitizeExtractedPdfText(text);
    resumeText = cleaned; resumeFileLabel = file.name;
    fileNameEl.textContent = `${file.name} · ${fileMetaLabel}${cleaned.length} 字`;
    fileChip.style.display = 'flex'; dropzone.style.display = 'none';
    renderPdfPreview(cleaned);
    if (corruptionRatio > 0.08){
      const pct = Math.round(corruptionRatio * 100);
      pdfStatus.textContent = '已解析，但偵測到約 ' + pct + '% 文字可能因字型編碼問題而遺失（常見於部分文件轉出工具），可能影響 AI 分析準確率，建議改用「複製履歷文字」貼上或更換檔案來源';
      pdfStatus.classList.add('err');
    } else {
      pdfStatus.textContent = '已解析';
    }
    updateAllButtonStates();
    refreshStaleIndicators();
    saveDraft();
    uploadResumeToServer(file);
  } catch (err){
    console.error(err);
    if (mySeq !== fileUploadSeq) return; // 同上：已經有更新的一次上傳在處理，這次的錯誤不重要了
    pdfStatus.textContent = kind === 'pdf'
      ? '無法讀取這份 PDF'
      : '無法讀取這份 Word 檔（可能檔案已損毀，或不是標準 .docx 格式）';
    pdfStatus.classList.add('err');
  }
}

