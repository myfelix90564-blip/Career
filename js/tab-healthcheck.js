/* =======================================================================
   js/tab-healthcheck.js — TAB 2：履歷健診（ATS 相容度檢查）
   
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
   TAB 2 — 履歷健診（ATS 相容度）
========================================================= */
document.getElementById('generateBtn2').addEventListener('click', runHealthCheck);

async function runHealthCheck(){
  const btn = document.getElementById('generateBtn2');
  const statusLine = document.getElementById('statusLine2');
  beginRun();
  btn.disabled = true;
  statusLine.classList.remove('err');
  statusLine.innerHTML = '<span class="spinner"></span>AI 正在健診履歷⋯';

  const jobDesc = sharedJobDesc.value.trim();

  const systemPrompt = `你是熟悉企業 ATS（應徵者追蹤系統）篩選邏輯與履歷寫作的顧問。你會收到一份職缺說明與一份履歷全文（可能因 PDF 擷取有排版雜訊，請忽略雜訊專注內容）。

${HONESTY_RULE}

請評估這份履歷與該職缺的相容程度，完成：
1. score：0-100 的整數分數，反映關鍵字/技能覆蓋率與整體符合程度（保守評分，不要為了討好應徵者灌水）。
2. missingSkills：履歷中缺少、但職缺明確要求的技能/證照/經驗，最多 6 項，每項一句話。
3. formatRisks：履歷內容或敘述方式中可能造成 ATS 或人資誤讀/漏讀的風險，最多 4 項（例如：經驗描述過於籠統、缺乏量化成果、關鍵字未出現、時間軸不清楚等，請根據實際履歷內容判斷，不要憑空捏造）。
4. suggestions：3-5 條具體、可執行的修改建議，每條需講清楚「改哪裡、怎麼改」，不要空泛評語。

${JSON_SAFETY_RULE}

只能輸出一個 JSON 物件，不要任何其他文字、不要 markdown code fence，格式必須完全符合：
{"score": 0, "missingSkills": ["..."], "formatRisks": ["..."], "suggestions": ["..."]}`;

  const userContent = `【職缺說明】\n${jobDesc}\n\n【履歷內容】\n${resumeText}`;
  /* v3.3.50 修復：改在送出請求「當下」記錄快照，避免等待 AI 回應期間使用者換了履歷／
     職缺說明，導致系統誤判「舊結果」對應到「新輸入」，見 tab-match.js 同一處修法的說明。 */
  const snapshotKeyAtRequestTime = currentInputKey();

  try {
    const parsed = await callClaude(systemPrompt, userContent, 45000, { label: 'healthcheck' });
    renderHealthCheck(parsed);
    statusLine.textContent = '完成';
    jobDescSnapshot[2] = snapshotKeyAtRequestTime;
    setTabDot(2, 'done');
    refreshStaleIndicators();
    lastResult2 = parsed;
    rmStageStats.healthcheck = parsed.__meta || null;
    updateStepMeta(2, parsed.__meta || null);
    saveDraft();
    return true;
  } catch (err){
    console.error(err);
    statusLine.textContent = friendlyErrorMessage(err);
    statusLine.classList.add('err');
    rmStageStats.healthcheck = { tokensUsed: 0, failed: true };
    updateStepMeta(2, { failed: true });
    return false;
  } finally {
    endRun();
  }
}

function renderHealthCheck(parsed){
  let score = Number(parsed.score);
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const missingSkills = Array.isArray(parsed.missingSkills) ? parsed.missingSkills : [];
  const formatRisks = Array.isArray(parsed.formatRisks) ? parsed.formatRisks : [];
  const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];

  const panel = document.getElementById('resultsPanel2');
  panel.classList.remove('empty');
  panel.innerHTML = `
    <div class="score-block">
      <div class="score-number">${score}<sub>/100</sub></div>
      <div class="score-bar-wrap">
        <div class="score-bar"><div class="score-bar-fill" style="width:${score}%"></div></div>
        <div class="score-label">相容度分數 · 依關鍵字覆蓋率與整體符合程度保守評估</div>
      </div>
    </div>
    <div class="check-cols">
      <div><h2 class="section-title">缺少的技能/經驗</h2>
        <ul class="check-list">${missingSkills.length ? missingSkills.map(s=>`<li>${escapeHtml(s)}</li>`).join('') : '<li>沒有偵測到明顯缺口</li>'}</ul></div>
      <div><h2 class="section-title">格式/敘述風險</h2>
        <ul class="check-list">${formatRisks.length ? formatRisks.map(s=>`<li>${escapeHtml(s)}</li>`).join('') : '<li>沒有偵測到明顯風險</li>'}</ul></div>
      <div><h2 class="section-title">修改建議</h2>
        <ul class="check-list">${suggestions.length ? suggestions.map(s=>`<li>${escapeHtml(s)}</li>`).join('') : '<li>暫無額外建議</li>'}</ul></div>
    </div>`;
}

