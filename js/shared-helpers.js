/* =======================================================================
   js/shared-helpers.js — 共用小工具（pdf.js 初始化防呆、escapeHtml、Word 文件產生、除錯面板）
   
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
/* v3.3.22 修復：這一行原本沒有任何保護，若 pdf.js 的 CDN 腳本載入失敗（廣告攔截器、瀏覽器擴充功能、
   企業網路防火牆濾掉 cdnjs.cloudflare.com、CDN 當機等任何原因），pdfjsLib 就會是 undefined，
   底下這行會立刻丟出例外，而這個檔案從頭到尾只有「一個」<script> 標籤——例外一丟出，
   這一行之後所有還沒執行到的程式碼（包含全部 generate 按鈕、拖拉上傳區、下載按鈕等 addEventListener
   綁定）都不會被執行，導致「按什麼按鈕都沒反應」。加上 typeof 判斷讓它改為安全地跳過並提示，
   不會拖垮其餘整份腳本。 */
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
} else {
  console.error('pdf.js 載入失敗（可能被瀏覽器擴充功能或網路環境阻擋），PDF 解析功能將無法使用，但不影響其他功能。');
}

/* ---------- shared state & helpers ---------- */
let resumeText = '';
let resumeFileLabel = '';

/* =========================================================
   v3.3.47 新增：把 AI 呼叫失敗時的「內部錯誤代碼」轉成使用者看得懂、
   知道該怎麼辦的中文提示。

   背景：ai-providers.js 裡各家供應商的 fetch 函式，會在錯誤訊息前面
   加上像 auth_error: / rate_limit: / overloaded: 這樣的前綴，方便寫
   程式的人快速分辨錯誤類型；但這幾支函式拋出例外後，各頁籤原本是直接
   把 err.message 整串（含前綴）顯示在畫面上，變成使用者會看到
   「發生錯誤：auth_error:Claude API Key 無效或已過期」這種一半英文
   代碼、一半中文說明的怪異訊息，讓人搞不清楚到底發生什麼事，甚至以為
   工具本身壞掉、卡住了——這正是「按了按鈕、畫面卻像沒反應」體驗不佳
   的原因之一（技術上其實有錯誤訊息，只是使用者看不懂、也不知道能做
   什麼，效果上跟沒反應一樣）。
   這個函式統一在畫面顯示前先「翻譯」一次：辨識得出來的代碼，換成
   白話說明＋可以直接採取的下一步；辨識不出來的，至少也把
   「code:」這種格式的前綴拿掉，不會讓使用者看到裸露的英文代碼。
========================================================= */
function friendlyErrorMessage(err){
  const raw = (err && err.message) ? String(err.message) : String(err);

  // 「系統內建連線」（未設定任何金鑰時的預設行為）目前在正式部署環境下必然會失敗，
  // 這裡不是要掩蓋這個根本問題，而是至少讓使用者知道「該怎麼辦」，而不是對著一句
  // 「API 回應失敗 (401)」不知所措。
  if (/^API 回應失敗 \(401\)/.test(raw)) {
    return '發生錯誤：目前使用的「系統內建連線」暫時無法使用，請點右上角「API Key 設定」設定你自己的 Claude／Gemini／ChatGPT API Key 後再試一次。';
  }

  const m = raw.match(/^([a-z_]+):([\s\S]*)$/);
  if (!m) return '發生錯誤：' + raw + '，請再試一次';

  const code = m[1];
  const rest = m[2];
  switch (code) {
    case 'auth_error':
      return '發生錯誤：' + rest + '（點右上角「API Key 設定」即可重新輸入）';
    case 'rate_limit':
    case 'overloaded':
      return '發生錯誤：' + rest;
    case 'empty_response':
      return '發生錯誤：AI 這次沒有回傳任何內容，通常重新產生一次就會恢復正常，請再試一次。';
    case 'api_error':
      return '發生錯誤：AI 服務暫時無法回應（' + rest + '），請稍後再試一次；若持續發生，可到右上角「API Key 設定」確認金鑰是否正確。';
    default:
      return '發生錯誤：' + rest + '，請再試一次';
  }
}

/* v3.3.54 修復（防禦性強化，非立即可被利用的漏洞）：這裡跟 admin.js 的
   escapeAdminHtml() 是兩套幾乎一樣、卻各自維護的跳脫規則，escapeAdminHtml 多跳脫了
   單引號、這裡沒有。目前程式碼裡所有 HTML 屬性都統一用雙引號包住，所以實務上還不構成
   可被利用的漏洞；但兩套規則不一致本身就是技術債，日後如果不小心在某處用單引號包
   屬性，AI 產生的內容剛好包含單引號時就可能造成破版。這裡直接讓 escapeHtml 也跳脫
   單引號，補齊防禦，之後 admin.js 也統一改用這一份，不再各自維護一份幾乎一樣的邏輯。 */
function escapeHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* =========================================================
   v3.3.6 新增：Word（.doc）檔案下載。
   做法說明：跟 PDF 下載一樣不引入額外的檔案產生函式庫（docx 產生
   函式庫通常體積不小，且中文相容性需另外測試），改用瀏覽器與 Word
   都認識的「Word HTML」格式：一段帶有 Microsoft Office XML
   命名空間宣告的 HTML，存成副檔名 .doc、MIME 類型 application/msword。
   Word（Windows／Mac）與多數線上工具開啟後即為一份「真正可編輯」的
   文件（字型、段落、清單、表格都可用 Word 工具列調整），求職者可以
   自行微調文字、格式，不受限於本工具產生的排版。
========================================================= */
/* v3.3.64 修復：這裡原本完全沒有接收版型參數，不管使用者在畫面上選了哪一種履歷／簡報
   版型，Word 下載出來的顏色、強調色一律套用同一組寫死的顏色（#10151F 文字、#5B4FE0
   標題底線），跟畫面上實際顯示、也跟 PDF 下載出來的樣子完全對不上——PDF 下載走的是
   「直接列印目前畫面」，本來就會忠實呈現目前選的版型；Word 下載卻是另外產生一份
   全新的 HTML 文件，這份文件從頭到尾沒有讀取 selectedResumeTheme／selectedDeckTheme
   這兩個變數，等於白選了版型。這裡改成接收一個 theme 參數，套用該版型實際的
   背景色／文字色／強調色，讓 Word 下載的顏色跟畫面上選的版型一致。 */
function buildWordDocument(titleText, bodyHtml, theme){
  const t = theme || { bg:'#ffffff', fg:'#10151F', accent:'#5B4FE0' };
  const mutedColor = mixHexTowardGray(t.fg, 0.45);
  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(titleText)}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
  @page Section1 { size: 21cm 29.7cm; margin: 2cm 2cm 2cm 2cm; mso-header-margin:1cm; mso-footer-margin:1cm; }
  div.Section1 { page: Section1; }
  body{ font-family:'Microsoft JhengHei','PMingLiU','Noto Sans TC',Arial,sans-serif; font-size:11pt; color:${t.fg}; background:${t.bg}; line-height:1.6; }
  h1{ font-size:20pt; margin:0 0 4pt; color:${t.fg}; }
  h2{ font-size:13pt; margin:16pt 0 6pt; padding-bottom:3pt; border-bottom:1.5pt solid ${t.accent}; color:${t.fg}; }
  h3{ font-size:11.5pt; margin:10pt 0 2pt; color:${t.fg}; }
  p{ margin:0 0 6pt; }
  ul{ margin:2pt 0 8pt; padding-left:20pt; }
  li{ margin:0 0 3pt; }
  table{ border-collapse:collapse; width:100%; margin:0 0 2pt; }
  td{ vertical-align:top; padding:0; }
  .doc-muted{ color:${mutedColor}; font-size:9.5pt; }
  .doc-meta{ color:${mutedColor}; font-size:10pt; margin:0 0 12pt; }
  .doc-tag{ display:inline-block; border:0.75pt solid ${t.accent}; color:${t.fg}; padding:1pt 6pt; margin:0 6pt 4pt 0; font-size:9.5pt; }
  .doc-footer{ margin-top:16pt; padding-top:6pt; border-top:0.75pt solid ${mutedColor}; font-size:9pt; color:${mutedColor}; }
  .doc-pagebreak{ page-break-before:always; mso-page-break-before:always; }
  hr{ border:none; border-top:0.75pt solid ${mutedColor}; margin:10pt 0; }
</style>
</head>
<body>
<div class="Section1">
${bodyHtml}
</div>
</body>
</html>`;
}

/* v3.3.64 新增：Word 文件裡的輔助說明文字（doc-muted／doc-meta／頁尾分隔線）不能直接用
   版型的主文字色（對比太強、像在強調不重要的資訊），但也不能寫死一個固定的灰色（深色
   版型like techdark用深灰色會完全看不見）。這裡寫一個簡單的函式，把版型的文字顏色跟
   「中性灰」以指定比例混合，讓輔助文字的顏色會依據淺色/深色版型自動變成偏灰或偏淺灰，
   但不會失去可讀性。 */
function mixHexTowardGray(hex, ratio){
  const clean = String(hex || '#666666').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  const r = parseInt(full.substring(0, 2), 16) || 0;
  const g = parseInt(full.substring(2, 4), 16) || 0;
  const b = parseInt(full.substring(4, 6), 16) || 0;
  const gray = 128;
  const mix = (c) => Math.round(c + (gray - c) * ratio);
  const toHex = (v) => v.toString(16).padStart(2, '0');
  return '#' + toHex(mix(r)) + toHex(mix(g)) + toHex(mix(b));
}

function downloadWordDocument(filename, titleText, bodyHtml, theme){
  const fullHtml = buildWordDocument(titleText, bodyHtml, theme);
  const blob = new Blob(['\ufeff', fullHtml], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.doc') ? filename : filename + '.doc';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/* =========================================================
   除錯記錄：把每次 API 呼叫的結果（成功/失敗、狀態碼、回應片段）
   記錄下來，方便未來排查問題時提供給開發人員。
========================================================= */
let debugLog = [];
let debugModeOn = false;

function addDebugLog(entry){
  debugLog.unshift({ time: new Date().toLocaleTimeString('zh-TW'), ...entry });
  if (debugLog.length > 50) debugLog.pop();
  if (debugModeOn) renderDebugLog();
}

function renderDebugLog(){
  const el = document.getElementById('debugLogContent');
  if (!el) return;
  el.textContent = debugLog.length ? debugLog.map(e => JSON.stringify(e, null, 2)).join('\n---\n') : '（目前沒有紀錄）';
}

document.getElementById('debugToggleBtn').addEventListener('click', () => {
  debugModeOn = !debugModeOn;
  document.getElementById('debugPanel').style.display = debugModeOn ? 'block' : 'none';
  document.getElementById('debugToggleBtn').textContent = debugModeOn ? '關閉除錯模式' : '除錯模式';
  if (debugModeOn) renderDebugLog();
});
document.getElementById('debugCopyBtn').addEventListener('click', async () => {
  const text = debugLog.length ? debugLog.map(e => JSON.stringify(e)).join('\n') : '（目前沒有紀錄）';
  const b = document.getElementById('debugCopyBtn'); const orig = b.textContent;
  /* v3.3.53 修復：navigator.clipboard.writeText() 原本沒有任何錯誤處理——部分瀏覽器
     環境（例如未取得剪貼簿權限、或在較舊的內嵌瀏覽器）會讓這個呼叫失敗，失敗時按鈕
     文字完全不會變化，使用者會覺得「按了沒反應」。加上 try/catch，成功顯示「已複製」，
     失敗則明確告知並提供文字內容讓使用者自行複製。 */
  try {
    await navigator.clipboard.writeText(text);
    b.textContent = '已複製'; setTimeout(() => b.textContent = orig, 1500);
  } catch (e){
    console.error('複製失敗', e);
    alert('自動複製失敗（可能是瀏覽器權限限制），請手動選取以下內容複製：\n\n' + text);
  }
});
document.getElementById('debugClearBtn').addEventListener('click', () => {
  debugLog = [];
  renderDebugLog();
});

