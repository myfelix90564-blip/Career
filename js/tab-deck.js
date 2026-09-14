/* =======================================================================
   js/tab-deck.js — TAB 7：提案簡報（8~10 頁，可下載 PDF/Word）與畫面列印匯出
   
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
   TAB 7 — 提案簡報（8~10 頁，5 款版型可選，可下載 PDF）
   v3.3.0：改採「面試提案簡報黃金架構」（破題亮點 → 痛點洞察 → 提案與
   30-60-90 天計畫 → 能力佐證 → 結語 Q&A），並提供 5 款世界級企業簡報
   版型供使用者挑選（產生後仍可即時切換版型，不需重新呼叫 AI，省 tokens）。
   同樣「不」包含在「一鍵產生全部分析」中，理由同上。
========================================================= */
document.getElementById('generateBtn7').addEventListener('click', runProposalDeck);

/* v3.3.51 修復：這個欄位原本完全沒有綁定任何事件監聽——使用者打了字之後，如果沒有
   剛好觸發其他欄位的自動存檔，重新整理頁面就會遺失；而且改了這裡的內容會直接影響
   簡報規劃，卻不會讓 tab7 的舊結果被標記為過期。 */
const dt7ExtraContextInput = document.getElementById('dt7ExtraContext');
if (dt7ExtraContextInput){
  dt7ExtraContextInput.addEventListener('input', () => {
    refreshStaleIndicators();
    scheduleDraftSave();
  });
}

async function runProposalDeck(){
  const btn = document.getElementById('generateBtn7');
  const statusLine = document.getElementById('statusLine7');
  beginRun();
  btn.disabled = true;
  statusLine.classList.remove('err');
  statusLine.innerHTML = '<span class="spinner"></span>AI 正在依黃金架構製作提案簡報⋯（8~10 頁，需要較長時間，請耐心等候）';

  const jobDesc = sharedJobDesc.value.trim();
  const extraContextEl = document.getElementById('dt7ExtraContext');
  const extraContext = extraContextEl ? extraContextEl.value.trim() : '';

  const systemPrompt = `你是一位資深人資主管與求職策略顧問，請針對「使用者提供的原始履歷」與「這份職缺說明」，製作一份可在面試現場口頭簡報、或主動投遞時附上的「面試提案簡報」，目的不是把履歷再放大一次，而是提出一份「解決方案」，讓招聘方清楚知道這位求職者完全勝任此職位、並能為公司帶來具體價值。

【絕對禁止】
- 禁止捏造原始履歷中不存在的經歷、專案、數字或成果；所有內容都必須基於原始履歷實際寫到的事實。
- 若某項職缺需求原始履歷沒有對應經驗，可以誠實呈現「可轉移的相關能力」，但不可捏造不存在的專案或數字。
- 「現況分析與痛點洞察」段落中，公司/職位的挑戰、市場現況必須根據職缺說明與（若有提供的）補充背景資訊合理推估，不可捏造具體到不合理的內幕資訊；語氣上是「展現你做過功課、看到對方的方向」，而不是斷言式地假裝掌握對方機密。

【簡報黃金架構】（請嚴格依此順序規劃，總頁數含頭尾必須落在 8~10 頁之間）
1. 破題與個人亮點（1~2 頁）：一句話定位自己（大標題說明你是誰、能帶來的最大價值），加上 2~3 項與此職缺最相關的量化成就。
2. 現況分析與痛點洞察（1~2 頁）：點出這間公司或這個職位目前可能面臨的挑戰、市場現況或潛在機會，展現「你懂他們的處境」。
3. 你的提案與行動計畫（3~4 頁，這是整份簡報的靈魂）：針對上一段的痛點提出對症下藥的解決策略，並具體規劃「入職 30-60-90 天計畫」（第一個月熟悉與盤點、第二個月優化與執行、第三個月擴展與產出成效），降低對方對試用期的疑慮。
4. 能力佐證／為什麼是我（1 頁）：用過去的成功案例（附數據）證明你剛才提出的行動計畫，是你真的有能力執行的。
5. 結語與 Q&A（1 頁）：總結價值、表達加入意願、留下聯絡方式，把時間交還給面試官提問。

【排版原則】少即是多：每頁文字盡量精簡，中文字數建議不超過 50 字（不含標題與數字），重點應該由使用者口頭表達，畫面只負責留下關鍵字與數字印象。

【每頁需指定 layout，從以下擇一，欄位需完全符合規格】
"title"：封面／大標題頁。欄位：heading（一句話定位自己的大標語）、subheading（姓名＋應徵職稱）。
"highlight"：個人亮點頁。欄位：heading、stats（2~3 個物件陣列，每個含 number 極短的量化數字如"20%"或"5人團隊"、label 一行說明這個數字代表什麼）、note（選填，一行小補充，可留空字串）。
"painpoint"：現況痛點洞察頁。欄位：heading、bullets（2~4 條，每條一行，指出對方可能面臨的挑戰或機會）。
"solution"：提案對策頁。欄位：heading、pairs（2~4 個物件陣列，每個含 problem 一行痛點、action 一行對應的解決對策）。
"plan306090"：入職 30-60-90 天計畫頁（整份簡報只會出現一次）。欄位：heading、phases（固定 3 個物件陣列，依序為 30/60/90 天，每個含 label 例如"Day 1-30・熟悉與盤點"、bullets 2~3 條該階段具體會做的事）。
"proof"：能力佐證頁。欄位：heading、cases（1~3 個物件陣列，每個含 title 案例名稱、result 一行具體成果數據）。
"bullets"：一般條列頁（僅在上述專用版面都不適合時使用）。欄位：heading、bullets（3~6 條）。
"twoColumn"：左右兩欄對比頁。欄位：heading、leftTitle、leftBullets（陣列）、rightTitle、rightBullets（陣列）。
"quote"：強調金句頁。欄位：heading（可留空字串）、quote（一句話重點）、attribution（可留空字串）。
"closing"：結尾頁。欄位：heading、subheading（聯絡方式或感謝語）。

請只回傳一個 JSON 物件（不要有任何其他文字、不要用 markdown code fence），格式如下：
{"deckTitle":"簡報標題","slides":[{"layout":"title","heading":"...","subheading":"..."},{"layout":"highlight","heading":"...","stats":[{"number":"...","label":"..."}],"note":""},{"layout":"painpoint","heading":"...","bullets":["...","..."]},{"layout":"solution","heading":"...","pairs":[{"problem":"...","action":"..."}]},{"layout":"plan306090","heading":"...","phases":[{"label":"Day 1-30・...","bullets":["...","..."]},{"label":"Day 31-60・...","bullets":["...","..."]},{"label":"Day 61-90・...","bullets":["...","..."]}]},{"layout":"proof","heading":"...","cases":[{"title":"...","result":"..."}]},{"layout":"closing","heading":"...","subheading":"..."}]}`;

  const userContent = `【職缺說明】\n${jobDesc}\n\n${extraContext ? '【使用者補充的背景資訊／已知挑戰】\n' + extraContext + '\n\n' : ''}【原始履歷內容】\n${resumeText}`;
  /* v3.3.50 修復：改在送出請求「當下」記錄快照，理由同 tab-match.js。 */
  /* v3.3.50 修復：改在送出請求「當下」記錄快照，理由同 tab-match.js。
     v3.3.51 補充：快照額外帶上「補充背景資訊」——這欄位會直接影響簡報內容規劃，
     修改後卻沒被算進過期偵測範圍的話，系統不會提示「需要重新產生」。 */
  const snapshotKeyAtRequestTime = currentInputKey(extraContext);

  try {
    const parsed = await callClaude(systemPrompt, userContent, 16000, { label: 'proposalDeck' });
    const slides = Array.isArray(parsed.slides) ? parsed.slides : [];
    if (!slides.length) throw new Error('沒有產生任何投影片內容');
    renderProposalDeck(parsed);
    statusLine.textContent = '完成（共 ' + slides.length + ' 頁），可預覽、更換版型並下載 PDF';
    jobDescSnapshot[7] = snapshotKeyAtRequestTime;
    setTabDot(7, 'done');
    refreshStaleIndicators();
    lastResult7 = parsed;
    saveDraft();
    return true;
  } catch (err){
    console.error(err);
    statusLine.textContent = friendlyErrorMessage(err);
    statusLine.classList.add('err');
    return false;
  } finally {
    endRun();
  }
}

function renderSlide(slide, index, total){
  const layout = slide.layout;
  const numberHtml = `<span class="slide-number">${index + 1} / ${total}</span>`;
  if (layout === 'title'){
    return `<div class="slide-page slide-title-layout">
      <div class="slide-heading">${escapeHtml(slide.heading || '')}</div>
      ${slide.subheading ? `<div class="slide-subheading">${escapeHtml(slide.subheading)}</div>` : ''}
      ${numberHtml}
    </div>`;
  }
  if (layout === 'twoColumn'){
    const leftBullets = Array.isArray(slide.leftBullets) ? slide.leftBullets : [];
    const rightBullets = Array.isArray(slide.rightBullets) ? slide.rightBullets : [];
    return `<div class="slide-page slide-bullets-layout">
      <div class="slide-heading">${escapeHtml(slide.heading || '')}</div>
      <div class="slide-two-col">
        <div class="col">${slide.leftTitle ? `<div class="col-title">${escapeHtml(slide.leftTitle)}</div>` : ''}<ul>${leftBullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul></div>
        <div class="col">${slide.rightTitle ? `<div class="col-title">${escapeHtml(slide.rightTitle)}</div>` : ''}<ul>${rightBullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul></div>
      </div>
      ${numberHtml}
    </div>`;
  }
  if (layout === 'quote'){
    return `<div class="slide-page slide-quote-layout">
      ${slide.heading ? `<div class="slide-heading">${escapeHtml(slide.heading)}</div>` : ''}
      <div class="slide-quote-text">「${escapeHtml(slide.quote || '')}」</div>
      ${slide.attribution ? `<div class="slide-quote-attr">${escapeHtml(slide.attribution)}</div>` : ''}
      ${numberHtml}
    </div>`;
  }
  if (layout === 'closing'){
    return `<div class="slide-page slide-title-layout">
      <div class="slide-heading">${escapeHtml(slide.heading || '')}</div>
      ${slide.subheading ? `<div class="slide-subheading">${escapeHtml(slide.subheading)}</div>` : ''}
      ${numberHtml}
    </div>`;
  }
  if (layout === 'highlight'){
    const stats = Array.isArray(slide.stats) ? slide.stats : [];
    return `<div class="slide-page slide-bullets-layout">
      <div class="slide-heading">${escapeHtml(slide.heading || '')}</div>
      <div class="slide-stat-grid">${stats.map(s => `
        <div class="slide-stat-card">
          <div class="slide-stat-num">${escapeHtml(String(s.number || ''))}</div>
          <div class="slide-stat-label">${escapeHtml(s.label || '')}</div>
        </div>`).join('')}</div>
      ${slide.note ? `<div class="slide-highlight-note">${escapeHtml(slide.note)}</div>` : ''}
      ${numberHtml}
    </div>`;
  }
  if (layout === 'painpoint'){
    const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
    return `<div class="slide-page slide-bullets-layout">
      <div class="slide-heading">${escapeHtml(slide.heading || '')}</div>
      <ul class="slide-painpoint-list">${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
      ${numberHtml}
    </div>`;
  }
  if (layout === 'solution'){
    const pairs = Array.isArray(slide.pairs) ? slide.pairs : [];
    return `<div class="slide-page slide-bullets-layout">
      <div class="slide-heading">${escapeHtml(slide.heading || '')}</div>
      <ul class="slide-solution-list">${pairs.map(p => `
        <li class="slide-solution-row">
          <span class="slide-solution-problem">${escapeHtml(p.problem || '')}</span>
          <span class="slide-solution-arrow">→</span>
          <span class="slide-solution-action">${escapeHtml(p.action || '')}</span>
        </li>`).join('')}</ul>
      ${numberHtml}
    </div>`;
  }
  if (layout === 'plan306090'){
    const phases = Array.isArray(slide.phases) ? slide.phases : [];
    return `<div class="slide-page slide-bullets-layout">
      <div class="slide-heading">${escapeHtml(slide.heading || '')}</div>
      <div class="slide-plan-cols">${phases.map(p => `
        <div class="slide-plan-col">
          <div class="slide-plan-col-title">${escapeHtml(p.label || '')}</div>
          <ul>${(Array.isArray(p.bullets) ? p.bullets : []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
        </div>`).join('')}</div>
      ${numberHtml}
    </div>`;
  }
  if (layout === 'proof'){
    const cases = Array.isArray(slide.cases) ? slide.cases : [];
    return `<div class="slide-page slide-bullets-layout">
      <div class="slide-heading">${escapeHtml(slide.heading || '')}</div>
      <div class="slide-proof-list">${cases.map(c => `
        <div class="slide-proof-item">
          <div class="slide-proof-title">${escapeHtml(c.title || '')}</div>
          <div class="slide-proof-result">${escapeHtml(c.result || '')}</div>
        </div>`).join('')}</div>
      ${numberHtml}
    </div>`;
  }
  // 預設當作 bullets 版面
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  return `<div class="slide-page slide-bullets-layout">
    <div class="slide-heading">${escapeHtml(slide.heading || '')}</div>
    <ul>${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
    ${numberHtml}
  </div>`;
}

/* v3.3.6：把單一投影片轉成 Word 文件裡的一個段落區塊（標題＋內容），
   不同 layout 一律轉成「標題＋條列／表格」的線性文件排法，讓求職者
   拿到手是一份可以直接用 Word 編輯、列印、或貼進提案信件的文件。 */
function buildSlideWordHtml(slide, index, total){
  const layout = slide.layout;
  const pageBreak = index === 0 ? '' : ' doc-pagebreak';
  const wrapOpen = `<div class="${pageBreak.trim()}">`;
  const wrapClose = `</div>`;
  const pageLabel = `<p class="doc-muted">第 ${index + 1} / ${total} 頁</p>`;

  if (layout === 'title' || layout === 'closing'){
    return `${wrapOpen}
      <h1>${escapeHtml(slide.heading || '')}</h1>
      ${slide.subheading ? `<p class="doc-meta">${escapeHtml(slide.subheading)}</p>` : ''}
      ${pageLabel}
    ${wrapClose}`;
  }
  if (layout === 'twoColumn'){
    const leftBullets = Array.isArray(slide.leftBullets) ? slide.leftBullets : [];
    const rightBullets = Array.isArray(slide.rightBullets) ? slide.rightBullets : [];
    return `${wrapOpen}
      <h2>${escapeHtml(slide.heading || '')}</h2>
      <table><tr>
        <td style="width:50%;padding-right:10pt;">
          ${slide.leftTitle ? `<h3>${escapeHtml(slide.leftTitle)}</h3>` : ''}
          <ul>${leftBullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
        </td>
        <td style="width:50%;padding-left:10pt;">
          ${slide.rightTitle ? `<h3>${escapeHtml(slide.rightTitle)}</h3>` : ''}
          <ul>${rightBullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
        </td>
      </tr></table>
      ${pageLabel}
    ${wrapClose}`;
  }
  if (layout === 'quote'){
    return `${wrapOpen}
      ${slide.heading ? `<h2>${escapeHtml(slide.heading)}</h2>` : ''}
      <p>「${escapeHtml(slide.quote || '')}」</p>
      ${slide.attribution ? `<p class="doc-muted">${escapeHtml(slide.attribution)}</p>` : ''}
      ${pageLabel}
    ${wrapClose}`;
  }
  if (layout === 'highlight'){
    const stats = Array.isArray(slide.stats) ? slide.stats : [];
    return `${wrapOpen}
      <h2>${escapeHtml(slide.heading || '')}</h2>
      <table><tr>${stats.map(s => `<td style="text-align:center;padding:4pt;"><b style="font-size:16pt;">${escapeHtml(String(s.number || ''))}</b><br><span class="doc-muted">${escapeHtml(s.label || '')}</span></td>`).join('')}</tr></table>
      ${slide.note ? `<p>${escapeHtml(slide.note)}</p>` : ''}
      ${pageLabel}
    ${wrapClose}`;
  }
  if (layout === 'painpoint'){
    const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
    return `${wrapOpen}
      <h2>${escapeHtml(slide.heading || '')}</h2>
      <ul>${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
      ${pageLabel}
    ${wrapClose}`;
  }
  if (layout === 'solution'){
    const pairs = Array.isArray(slide.pairs) ? slide.pairs : [];
    return `${wrapOpen}
      <h2>${escapeHtml(slide.heading || '')}</h2>
      <ul>${pairs.map(p => `<li>${escapeHtml(p.problem || '')} → ${escapeHtml(p.action || '')}</li>`).join('')}</ul>
      ${pageLabel}
    ${wrapClose}`;
  }
  if (layout === 'plan306090'){
    const phases = Array.isArray(slide.phases) ? slide.phases : [];
    return `${wrapOpen}
      <h2>${escapeHtml(slide.heading || '')}</h2>
      <table><tr>${phases.map(p => `
        <td style="width:${phases.length ? Math.floor(100/phases.length) : 100}%;vertical-align:top;padding:0 8pt 0 0;">
          <h3>${escapeHtml(p.label || '')}</h3>
          <ul>${(Array.isArray(p.bullets) ? p.bullets : []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
        </td>`).join('')}</tr></table>
      ${pageLabel}
    ${wrapClose}`;
  }
  if (layout === 'proof'){
    const cases = Array.isArray(slide.cases) ? slide.cases : [];
    return `${wrapOpen}
      <h2>${escapeHtml(slide.heading || '')}</h2>
      ${cases.map(c => `<p><b>${escapeHtml(c.title || '')}</b>：${escapeHtml(c.result || '')}</p>`).join('')}
      ${pageLabel}
    ${wrapClose}`;
  }
  // 預設當作 bullets 版面
  const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
  return `${wrapOpen}
    <h2>${escapeHtml(slide.heading || '')}</h2>
    <ul>${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
    ${pageLabel}
  ${wrapClose}`;
}

function downloadDeckWord(){
  if (!lastResult7) return;
  const deckTitle = typeof lastResult7.deckTitle === 'string' ? lastResult7.deckTitle : '提案簡報';
  const slides = Array.isArray(lastResult7.slides) ? lastResult7.slides : [];
  const bodyHtml = `
    <h1>${escapeHtml(deckTitle)}</h1>
    <p class="doc-meta">共 ${slides.length} 頁</p>
    <hr>
    ${slides.map((s, i) => buildSlideWordHtml(s, i, slides.length)).join('<hr>')}
    <div class="doc-footer">本文件由 AI 依據原始履歷內容與職缺說明產生，正式送出前請自行核實所有內容是否正確；您可直接在 Word 中修改文字、字型與排版，或依此內容重新製作簡報。</div>
  `;
  const fileLabel = (deckTitle || '提案簡報').replace(/[\\/:*?"<>|]/g, '');
  downloadWordDocument(`${fileLabel}`, deckTitle, bodyHtml);
}

function renderProposalDeck(parsed){
  const deckTitle = typeof parsed.deckTitle === 'string' ? parsed.deckTitle : '提案簡報';
  const slides = Array.isArray(parsed.slides) ? parsed.slides : [];

  const panel = document.getElementById('resultsPanel7');
  panel.classList.remove('empty');
  /* v3.3.52 修復：同 tab-tailored-resume.js，避免「STEP 1 版型選擇區」跟結果區的
     「更換版型」精簡按鈕列同時存在，造成同一個功能重複出現在兩個地方。 */
  const step1 = document.getElementById('deckThemeStep1');
  if (step1) step1.style.display = 'none';
  panel.innerHTML = `
    <div class="cta-row" style="margin-top:0;">
      <button class="secondary" id="downloadSlidesBtn" type="button">📊 下載 PDF（開啟列印視窗，選擇「另存為 PDF」；建議在列印設定選擇「橫向」）</button>
      <button class="secondary" id="downloadSlidesWordBtn" type="button">📝 下載 Word（.doc，可自行編輯）</button>
    </div>
    <p class="tool-note">《${escapeHtml(deckTitle)}》共 ${slides.length} 頁</p>
    <div class="deck-theme-switch-wrap">
      <span class="deck-theme-switch-label">更換版型（即時切換，不需重新產生）</span>
      <div class="deck-theme-switch" id="deckThemeSwitch"></div>
    </div>
    <div class="slides-export theme-${selectedDeckTheme}" id="slidesExportArea">
      ${slides.map((s, i) => `<div class="slide-page-wrap">${renderSlide(s, i, slides.length)}</div>`).join('')}
    </div>
  `;
  document.getElementById('downloadSlidesBtn').addEventListener('click', () => printExportArea('slides'));
  document.getElementById('downloadSlidesWordBtn').addEventListener('click', () => downloadDeckWord());
  renderDeckThemePicker('deckThemeSwitch', 'switch');
}

/* =========================================================
   共用：以瀏覽器原生列印機制輸出 PDF。
   選擇這個做法而不是引入 PDF 產生函式庫（如 jsPDF）的原因：這類函式庫
   內建字型不支援中文，要正確顯示中文必須額外嵌入中文字型檔（動輒數
   MB），會讓單一 HTML 檔案暴增；改用瀏覽器原生列印，直接沿用畫面上
   已經正確顯示的中文字型與排版，使用者在列印對話框選擇「另存為 PDF」
   即可，不需要額外套件，中文顯示也絕對不會缺字。
========================================================= */
function printExportArea(mode){
  const modeClass = mode === 'slides' ? 'printing-slides-mode' : 'printing-resume-mode';
  const pageSizeStyle = document.getElementById('dynPageSizeStyle');
  if (pageSizeStyle){
    pageSizeStyle.textContent = mode === 'slides'
      ? '@page{ size: landscape; margin: 10mm; }'
      : '@page{ size: portrait; margin: 15mm 18mm; }';
  }
  document.body.classList.add(modeClass);
  window.print();
}
window.addEventListener('afterprint', () => {
  document.body.classList.remove('printing-resume-mode', 'printing-slides-mode');
});

