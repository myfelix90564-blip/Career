/* =======================================================================
   js/tab-tailored-resume.js — TAB 6：客製履歷（依職缺重新編排，可下載 PDF/Word）
   
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
   TAB 6 — 客製履歷（依此職缺重新編排一份新履歷，可下載 PDF）
   v3.2.15 新增。刻意「不」包含在「一鍵產生全部分析」中：完整重新編排
   一份履歷所需的輸出長度，遠比健診/媒合分析的簡短 JSON 多很多，若也
   塞進一鍵批次，會拉長整體等待時間、也更容易撞到 tokens 上限，因此
   維持「需單獨生成」。
   PDF 產生方式：由於是純瀏覽器端工具、且必須完整支援中文字型，這裡
   採用瀏覽器原生的「列印 → 另存為 PDF」機制，而不是使用需要額外嵌入
   中文字型檔（動輒數 MB）的 PDF 產生函式庫，確保中文顯示不會缺字。
========================================================= */
document.getElementById('generateBtn6').addEventListener('click', runTailoredResume);

async function runTailoredResume(){
  const btn = document.getElementById('generateBtn6');
  const statusLine = document.getElementById('statusLine6');
  beginRun();
  btn.disabled = true;
  statusLine.classList.remove('err');
  statusLine.innerHTML = '<span class="spinner"></span>AI 正在依此職缺重新編排履歷⋯（內容較長，可能需要一點時間）';

  const jobDesc = sharedJobDesc.value.trim();

  const systemPrompt = `你現在是一位擁有十年經驗的頂尖跨國企業（如 Google、Apple、McKinsey）人資主管與履歷撰寫專家。請針對「使用者提供的原始履歷」與「這份職缺說明」，重新撰寫一份符合世界級企業標準（強調 STAR 原則、量化數據導向、凸顯商業價值）的專業履歷初稿。

【絕對禁止（最優先，任何情況都不可違反）】
- 禁止捏造原始履歷中不存在的公司、職稱、經歷、專案、數字或成果。
- 若職缺要求的某項經驗，原始履歷完全沒有對應內容，只能誠實地不特別強調，絕不可以無中生有創造案例或數字來湊。
- 聯絡資訊（姓名、電話、Email、地區等）必須完全比照原始履歷內容，不可修改、簡化或捏造；若原始履歷沒有提供某項聯絡資訊，該欄位留空字串即可。

【撰寫要求】
1. 高度對齊：分析職缺說明中的關鍵字與核心需求，將原始經歷重新包裝、排序，與職缺需求強烈對應，以利通過 ATS 篩選。
2. 強勢動詞＋量化敘述：每一條工作經歷的列點請用強而有力的動詞開頭（例如：帶領、優化、創下、建置、驅動、重塑），將模糊的描述轉化為具體成就。
   - 若原始履歷「已經存在」具體數字或事實，直接沿用、表達得更清楚，不可竄改成不同的數字。
   - 若某項成就原始履歷完全沒有提供數字，但職缺明顯重視該項成果，可以在該條列點文字後方加註「[請補充數據：例如提升了X%或節省X小時]」這樣的提示語句，引導使用者事後自行填入真實數字；絕對不可以自己編造一個看似合理的數字放進去頂替。
3. 專業架構：依序輸出個人摘要（Professional Summary）、核心技能（Core Competencies）、工作經歷（Professional Experience，含公司、職稱、期間與量化重點列點）、學歷（Education）。
4. 精簡有力：優先保留與此職缺最相關、最具衝擊力的戰功；與職缺無關的瑣碎日常行政事項可以精簡或省略，讓整體篇幅盡量貼近「一頁式履歷（One-page resume）」的資訊密度。

請只回傳一個 JSON 物件（不要有任何其他文字、不要用 markdown code fence），格式如下：
{"name":"姓名（比照原始履歷）","targetTitle":"這份履歷要應徵的職稱（對應此職缺）","contactLine":"電話｜Email｜地區（比照原始履歷，用｜分隔，缺項留空）","summary":"2~4句自我介紹，針對此職缺客製化","coreSkills":["關鍵技能1","關鍵技能2","..."],"experience":[{"company":"公司名稱","title":"職稱","period":"任職期間","bullets":["重點描述1","重點描述2","..."]}],"education":[{"school":"學校","department":"科系/學位","period":"就讀期間"}],"certifications":["證照或語言能力，若無則為空陣列"],"changeNotes":["說明這次針對此職缺做了哪些調整、為什麼這樣調整，3~6點，給使用者自己核對用，不會出現在履歷上"]}`;

  const userContent = `【職缺說明】\n${jobDesc}\n\n【原始履歷內容】\n${resumeText}`;
  /* v3.3.50 修復：改在送出請求「當下」記錄快照，理由同 tab-match.js。 */
  const snapshotKeyAtRequestTime = currentInputKey();

  try {
    const parsed = await callClaude(systemPrompt, userContent, 16000, { label: 'tailoredResume' });
    renderTailoredResume(parsed);
    statusLine.textContent = '完成，可預覽並下載 PDF';
    jobDescSnapshot[6] = snapshotKeyAtRequestTime;
    setTabDot(6, 'done');
    refreshStaleIndicators();
    lastResult6 = parsed;
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

/* 依版型 layout（standard／sidebar／darkband）組出履歷內文 DOM，內容資料完全相同，
   只是排版結構不同：sidebar 版把聯絡資訊/技能/證照放進側邊欄，darkband 版把姓名/職稱/
   聯絡資訊包進頂部深色色塊，其餘兩者則是單欄由上到下依序排列。 */
function buildResumeBodyHtml(data, layout){
  const { name, targetTitle, contactLine, summary, coreSkills, experience, education, certifications } = data;

  const expHtml = experience.map(job => {
    const bullets = Array.isArray(job.bullets) ? job.bullets : [];
    return `
      <div class="re-job">
        <div class="re-job-head"><span>${escapeHtml(job.title || '')}｜${escapeHtml(job.company || '')}</span><span class="re-job-period">${escapeHtml(job.period || '')}</span></div>
        <ul>${bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
      </div>`;
  }).join('');

  const eduHtml = education.map(ed => `
      <div class="re-job">
        <div class="re-job-head"><span>${escapeHtml(ed.school || '')}</span><span class="re-job-period">${escapeHtml(ed.period || '')}</span></div>
        <div style="font-size:12.5px;color:var(--re-muted);">${escapeHtml(ed.department || '')}</div>
      </div>`).join('');

  const summaryHtml = summary ? `<div class="re-section-title">自我介紹</div><div class="re-summary">${escapeHtml(summary)}</div>` : '';
  const skillsHtml = coreSkills.length ? `<div class="re-section-title">核心技能</div><div class="re-skills">${coreSkills.map(s => `<span class="re-skill-chip">${escapeHtml(s)}</span>`).join('')}</div>` : '';
  const certHtml = certifications.length ? `<div class="re-section-title">證照／語言能力</div><div class="re-skills">${certifications.map(s => `<span class="re-skill-chip">${escapeHtml(s)}</span>`).join('')}</div>` : '';
  const footerHtml = `<div class="re-footer-note">本履歷由 AI 依據原始履歷內容重新編排，正式送出前請自行核實所有內容是否正確。</div>`;
  const headerInner = `
      <h1>${escapeHtml(name)}</h1>
      ${targetTitle ? `<div class="re-target-title">應徵職稱：${escapeHtml(targetTitle)}</div>` : ''}
      ${contactLine ? `<div class="re-contact">${escapeHtml(contactLine)}</div>` : ''}`;

  if (layout === 'sidebar'){
    return `
      <div class="re-sidebar">
        ${headerInner}
        ${skillsHtml}
        ${certHtml}
      </div>
      <div class="re-main">
        ${summaryHtml}
        ${expHtml ? `<div class="re-section-title">工作經驗</div>${expHtml}` : ''}
        ${eduHtml ? `<div class="re-section-title">學歷</div>${eduHtml}` : ''}
        ${footerHtml}
      </div>`;
  }
  if (layout === 'darkband'){
    return `
      <div class="re-header-band">${headerInner}</div>
      ${summaryHtml}
      ${skillsHtml}
      ${expHtml ? `<div class="re-section-title">工作經驗</div>${expHtml}` : ''}
      ${eduHtml ? `<div class="re-section-title">學歷</div>${eduHtml}` : ''}
      ${certHtml}
      ${footerHtml}`;
  }
  return `
      ${headerInner}
      ${summaryHtml}
      ${skillsHtml}
      ${expHtml ? `<div class="re-section-title">工作經驗</div>${expHtml}` : ''}
      ${eduHtml ? `<div class="re-section-title">學歷</div>${eduHtml}` : ''}
      ${certHtml}
      ${footerHtml}`;
}

/* v3.3.6：把客製履歷資料組成 Word 版本可用的 HTML（純語意化標籤＋
   內嵌樣式，不使用畫面上的 CSS 變數版型，確保在 Word 開啟時排版正常、
   且求職者可以直接用 Word 的段落／清單工具繼續編輯）。 */
function buildResumeWordHtml(data){
  const { name, targetTitle, contactLine, summary, coreSkills, experience, education, certifications } = data;

  const expHtml = experience.map(job => `
    <table><tr>
      <td><b>${escapeHtml(job.title || '')}｜${escapeHtml(job.company || '')}</b></td>
      <td align="right" class="doc-muted">${escapeHtml(job.period || '')}</td>
    </tr></table>
    <ul>${(Array.isArray(job.bullets) ? job.bullets : []).map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>
  `).join('');

  const eduHtml = education.map(ed => `
    <table><tr>
      <td><b>${escapeHtml(ed.school || '')}</b></td>
      <td align="right" class="doc-muted">${escapeHtml(ed.period || '')}</td>
    </tr></table>
    <p class="doc-muted">${escapeHtml(ed.department || '')}</p>
  `).join('');

  const skillsHtml = coreSkills.length ? coreSkills.map(s => `<span class="doc-tag">${escapeHtml(s)}</span>`).join('') : '';
  const certHtml = certifications.length ? certifications.map(s => `<span class="doc-tag">${escapeHtml(s)}</span>`).join('') : '';

  return `
    <h1>${escapeHtml(name)}</h1>
    ${targetTitle ? `<p class="doc-meta">應徵職稱：${escapeHtml(targetTitle)}</p>` : ''}
    ${contactLine ? `<p class="doc-meta">${escapeHtml(contactLine)}</p>` : ''}
    ${summary ? `<h2>自我介紹</h2><p>${escapeHtml(summary)}</p>` : ''}
    ${skillsHtml ? `<h2>核心技能</h2><p>${skillsHtml}</p>` : ''}
    ${expHtml ? `<h2>工作經驗</h2>${expHtml}` : ''}
    ${eduHtml ? `<h2>學歷</h2>${eduHtml}` : ''}
    ${certHtml ? `<h2>證照／語言能力</h2><p>${certHtml}</p>` : ''}
    <div class="doc-footer">本履歷由 AI 依據原始履歷內容重新編排，正式送出前請自行核實所有內容是否正確；您可直接在 Word 中修改文字、字型與排版。</div>
  `;
}

function downloadResumeWord(){
  if (!lastResult6) return;
  const name = typeof lastResult6.name === 'string' ? lastResult6.name : (resumeFileLabel || '');
  const targetTitle = typeof lastResult6.targetTitle === 'string' ? lastResult6.targetTitle : '';
  const contactLine = typeof lastResult6.contactLine === 'string' ? lastResult6.contactLine : '';
  const summary = typeof lastResult6.summary === 'string' ? lastResult6.summary : '';
  const coreSkills = Array.isArray(lastResult6.coreSkills) ? lastResult6.coreSkills : [];
  const experience = Array.isArray(lastResult6.experience) ? lastResult6.experience : [];
  const education = Array.isArray(lastResult6.education) ? lastResult6.education : [];
  const certifications = Array.isArray(lastResult6.certifications) ? lastResult6.certifications : [];
  const bodyHtml = buildResumeWordHtml({ name, targetTitle, contactLine, summary, coreSkills, experience, education, certifications });
  const fileLabel = (name || '客製履歷').replace(/[\\/:*?"<>|]/g, '');
  downloadWordDocument(`${fileLabel}_客製履歷`, `${name} 客製履歷`, bodyHtml);
}

function renderTailoredResume(parsed){
  const name = typeof parsed.name === 'string' ? parsed.name : (resumeFileLabel || '');
  const targetTitle = typeof parsed.targetTitle === 'string' ? parsed.targetTitle : '';
  const contactLine = typeof parsed.contactLine === 'string' ? parsed.contactLine : '';
  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
  const coreSkills = Array.isArray(parsed.coreSkills) ? parsed.coreSkills : [];
  const experience = Array.isArray(parsed.experience) ? parsed.experience : [];
  const education = Array.isArray(parsed.education) ? parsed.education : [];
  const certifications = Array.isArray(parsed.certifications) ? parsed.certifications : [];
  const changeNotes = Array.isArray(parsed.changeNotes) ? parsed.changeNotes : [];

  const panel = document.getElementById('resultsPanel6');
  panel.classList.remove('empty');
  /* v3.3.52 修復：「版面排版重大缺失」之一——產生結果後，畫面上同時存在兩套功能一樣的
     版型選擇器：上面 STEP 1 的完整卡片選擇區，跟結果區裡「更換版型」的精簡按鈕列，
     容易讓使用者搞不清楚該用哪一個、也白白佔用版面。改成產生結果後隱藏上面的 STEP 1
     選擇區，只留下結果區裡的「更換版型」，避免同一個功能重複出現在兩個地方。 */
  const step1 = document.getElementById('resumeThemeStep1');
  if (step1) step1.style.display = 'none';

  const theme = RESUME_THEMES.find(t => t.id === selectedResumeTheme) || RESUME_THEMES[0];
  const bodyHtml = buildResumeBodyHtml({ name, targetTitle, contactLine, summary, coreSkills, experience, education, certifications }, theme.layout);

  panel.innerHTML = `
    <div class="cta-row" style="margin-top:0;">
      <button class="secondary" id="downloadResumeBtn" type="button">📄 下載 PDF（開啟列印視窗，選擇「另存為 PDF」）</button>
      <button class="secondary" id="downloadResumeWordBtn" type="button">📝 下載 Word（.doc，可自行編輯）</button>
    </div>
    <div class="deck-theme-switch-wrap">
      <span class="deck-theme-switch-label">更換版型（即時切換，不需重新產生）</span>
      <div class="deck-theme-switch" id="resumeThemeSwitch"></div>
    </div>
    <div class="resume-export theme-${theme.id} layout-${theme.layout}" id="resumeExportArea">
      ${bodyHtml}
    </div>
    ${changeNotes.length ? `
    <div class="change-notes-box">
      <span class="cn-title">這次針對此職缺做了哪些調整（僅供你自己核對，不會出現在履歷上）：</span>
      <ul class="check-list">${changeNotes.map(n => `<li>${escapeHtml(n)}</li>`).join('')}</ul>
    </div>` : ''}
  `;
  document.getElementById('downloadResumeBtn').addEventListener('click', () => printExportArea('resume'));
  document.getElementById('downloadResumeWordBtn').addEventListener('click', () => downloadResumeWord());
  renderResumeThemePicker('resumeThemeSwitch', 'switch');
}

