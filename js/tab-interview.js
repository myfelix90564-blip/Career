/* =======================================================================
   js/tab-interview.js — TAB 4：模擬面試、反問面試官與隱性風險評估
   
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
   TAB 4 — 模擬面試
========================================================= */
document.getElementById('generateBtn4').addEventListener('click', runInterviewSetup);

async function runInterviewSetup(){
  const btn = document.getElementById('generateBtn4');
  const statusLine = document.getElementById('statusLine4');
  beginRun();
  btn.disabled = true;
  statusLine.classList.remove('err');
  statusLine.innerHTML = '<span class="spinner"></span>AI 正在準備面試題目⋯';

  const interviewJobDesc = sharedJobDesc.value.trim();

  const systemPrompt = `你是資深面試官與求職教練。你會收到一份職缺說明與一份履歷全文。

${HONESTY_RULE}

請找出履歷中「與職缺相關但描述較模糊、缺乏具體成果或證據較弱」的 4 到 5 個地方，針對每個地方出一道面試題，目的是讓應徵者練習把經驗講得更具體、更有說服力。

除了題目本身，請你直接示範一個「AI 建議回答」：只能使用履歷中「實際出現過」的經歷、專案與數字，不可以捏造履歷裡沒有的公司、職稱、專案或成果；用求職者的第一人稱、口語化、適合在面試現場直接講出來的方式作答，盡量套用「情境（S）－任務（T）－行動（A）－成果（R）」的結構，長度約 120～200 字。如果履歷中確實找不到足夠具體的證據，建議回答就誠實承認經驗有限，並說明求職者可以怎麼補強或轉個角度回答，不要硬編。

輸出一個 JSON 物件：
{"questions": [{"question": "面試題目本身，用真人面試官會問的語氣", "targetGap": "這題想考驗/補強履歷中的哪個弱點，一句話說明", "suggestedAnswer": "AI 示範的建議回答，第一人稱、口語化、約120-200字"}]}

${JSON_SAFETY_RULE}

只能輸出這個 JSON 物件，不要任何其他文字、不要 markdown code fence。`;

  const userContent = `【職缺說明】\n${interviewJobDesc}\n\n【履歷內容】\n${resumeText}`;
  /* v3.3.50 修復：改在送出請求「當下」記錄快照，理由同 tab-match.js。 */
  const snapshotKeyAtRequestTime = currentInputKey();

  try {
    const parsed = await callClaude(systemPrompt, userContent, 18000, { label: 'interviewSetup' });
    const questions = Array.isArray(parsed.questions) ? parsed.questions : [];
    if (!questions.length) throw new Error('沒有產生面試題目');
    renderInterviewQuestions(questions);
    statusLine.textContent = '完成，開始作答練習';
    jobDescSnapshot[4] = snapshotKeyAtRequestTime;
    setTabDot(4, 'done');
    refreshStaleIndicators();
    lastResult4 = parsed;
    rmStageStats.interviewSetup = parsed.__meta || null;
    saveDraft();
    return true;
  } catch (err){
    console.error(err);
    statusLine.textContent = friendlyErrorMessage(err);
    statusLine.classList.add('err');
    rmStageStats.interviewSetup = { tokensUsed: 0, failed: true };
    return false;
  } finally {
    endRun();
  }
}

function renderInterviewQuestions(questions){
  const panel = document.getElementById('resultsPanel4');
  panel.classList.remove('empty');
  panel.innerHTML = `<h2 class="section-title">模擬面試題目</h2>` +
    questions.map((q, idx) => `
      <div class="q-card" data-qidx="${idx}">
        <div class="q-title">Q${idx+1}. ${escapeHtml(q.question)}</div>
        <div class="q-gap">考驗重點：${escapeHtml(q.targetGap || '')}</div>

        <div class="suggested-answer-box">
          <div class="suggested-answer-header">
            <span class="suggested-answer-label">💡 AI 建議回答（依你的履歷內容生成，可直接參考或修改後練習口說）</span>
            <button class="ghost regenSuggestedBtn" type="button">🔄 換一個回答</button>
          </div>
          <div class="suggested-answer-text">${escapeHtml(q.suggestedAnswer || '（尚未產生，請按上方按鈕重新產生）')}</div>
        </div>

        <details class="own-answer-block">
          <summary>✍️ 自己打字練習作答（選填，練完可請 AI 給回饋）</summary>
          <div class="own-answer-body">
            <textarea placeholder="可以先照著上面的 AI 建議回答練習口說，再換成自己的說法打字看看⋯" class="answerInput"></textarea>
            <button class="secondary feedbackBtn" type="button">取得回饋</button>
            <div class="feedback-box"></div>
          </div>
        </details>
      </div>
    `).join('');

  panel.querySelectorAll('.q-card').forEach(card => {
    const idx = card.dataset.qidx;
    const q = questions[idx];
    card.querySelector('.feedbackBtn').addEventListener('click', () => getInterviewFeedback(card, q));
    card.querySelector('.regenSuggestedBtn').addEventListener('click', () => regenerateSuggestedAnswer(card, q));
  });
}

async function regenerateSuggestedAnswer(card, q){
  const btn = card.querySelector('.regenSuggestedBtn');
  const textBox = card.querySelector('.suggested-answer-text');
  /* v3.3.51 修復：這個「單題重新產生建議回答」按鈕原本完全沒有加入 beginRun()／
     endRun() 共用忙碌鎖，跟「一鍵產生全部分析」等 6 個主要按鈕的併發保護（v3.3.49
     修復）是分開的兩套系統——使用者可以一邊點這裡、一邊又跑主要流程，同時發出多個
     AI 請求。這裡補上，讓它也遵守同一把鎖。 */
  beginRun();
  btn.disabled = true;
  const prevText = textBox.textContent;
  textBox.innerHTML = '<span class="spinner"></span>AI 正在重新示範回答⋯';

  const systemPrompt = `你是資深面試官與求職教練。你會收到一道面試題、這題想考驗的重點、以及應徵者的履歷全文。

${HONESTY_RULE}

請示範一個「AI 建議回答」：只能使用履歷中「實際出現過」的經歷、專案與數字，不可以捏造履歷裡沒有的公司、職稱、專案或成果；用求職者的第一人稱、口語化、適合在面試現場直接講出來的方式作答，盡量套用「情境（S）－任務（T）－行動（A）－成果（R）」的結構，長度約 120～200 字。請提供一個和先前不同角度或不同切入點的版本。如果履歷中確實找不到足夠具體的證據，就誠實承認經驗有限並說明可以怎麼補強，不要硬編。

${JSON_SAFETY_RULE}

只能輸出一個 JSON 物件：{"suggestedAnswer": "..."}，不要任何其他文字、不要 markdown code fence。`;

  const userContent = `【面試題目】${q.question}\n【考驗重點】${q.targetGap || ''}\n【履歷內容】\n${resumeText}`;

  try {
    const parsed = await callClaude(systemPrompt, userContent, 8000, { label: 'interviewSuggestedAnswer' });
    const newAnswer = typeof parsed.suggestedAnswer === 'string' ? parsed.suggestedAnswer : '';
    if (!newAnswer) throw new Error('沒有取得新的建議回答');
    q.suggestedAnswer = newAnswer;
    textBox.textContent = newAnswer;
    /* v3.3.51 修復：重新產生的建議回答原本只更新了記憶體裡的 q.suggestedAnswer，
       完全沒有觸發草稿保存——這是跟 v3.3.49 修復的「推薦信編輯後同步保存」同一類問題，
       只是發生在不同位置，當時漏改了。沒有這行的話，重新整理頁面選「復原上次內容」，
       剛剛重新產生的版本會悄悄消失，變回最早那一版。 */
    scheduleDraftSave();
  } catch (err){
    console.error(err);
    textBox.textContent = prevText;
    /* v3.3.51 修復：v3.3.47 把 friendlyErrorMessage() 套用到 6 個主要頁籤的狀態列，
       但漏掉了這個較小的「單題重新產生建議回答」功能，這裡補上，不再直接顯示夾帶
       內部代碼的原始錯誤訊息。 */
    alert(friendlyErrorMessage(err));
  } finally {
    btn.disabled = false;
    endRun();
  }
}

async function getInterviewFeedback(card, q){
  const btn = card.querySelector('.feedbackBtn');
  const box = card.querySelector('.feedback-box');
  const answer = card.querySelector('.answerInput').value.trim();
  if (!answer){
    box.textContent = '請先輸入你的回答，再取得回饋。';
    box.classList.add('show');
    return;
  }
  /* v3.3.51 修復：同上，這個「取得回饋」按鈕原本也沒有加入共用忙碌鎖。 */
  beginRun();
  btn.disabled = true;
  box.classList.add('show');
  box.innerHTML = '<span class="spinner"></span>面試官正在給回饋⋯';

  const systemPrompt = `你是資深面試官。你會收到一道面試題、這題想考驗的重點、以及應徵者的回答。

請用面試官的角度給出簡短、具體、有建設性的回饋（繁體中文，約 80-150 字），指出：回答是否具體（有沒有實際情境與數字/成果）、邏輯是否清楚、還可以怎麼補強。語氣直接但不刻薄，像是真的想幫應徵者準備好上場，不是隨口稱讚。

${JSON_SAFETY_RULE}

只能輸出一個 JSON 物件：{"feedback": "..."}，不要任何其他文字、不要 markdown code fence。`;

  const userContent = `【面試題目】${q.question}\n【考驗重點】${q.targetGap || ''}\n【應徵者回答】${answer}`;

  try {
    const parsed = await callClaude(systemPrompt, userContent, 8000, { label: 'interviewFeedback' });
    box.textContent = typeof parsed.feedback === 'string' ? parsed.feedback : '沒有取得回饋內容';
  } catch (err){
    console.error(err);
    /* v3.3.51 修復：同上，補上遺漏的 friendlyErrorMessage()。 */
    box.textContent = friendlyErrorMessage(err);
  } finally {
    btn.disabled = false;
    endRun();
  }
}

/* ---------- 反問面試官 & 隱性風險評估 ---------- */
const marketStatsInput = document.getElementById('marketStatsInput');
const jobDescSnapshotReverse = { value: null };
/* v3.3.51 修復：改市場統計資訊會影響反問清單內容，原本只觸發草稿保存，沒有一併
   檢查反問面試官的結果是否因此過期。 */
marketStatsInput.addEventListener('input', () => {
  refreshStaleIndicators();
  scheduleDraftSave();
});

function updateReverseButtonState(){
  const ready = resumeText.trim().length > 10 && sharedJobDesc.value.trim().length > 10;
  const btn = document.getElementById('generateReverseBtn');
  btn.disabled = !ready;
  btn.title = ready ? '' : '請先在上方上傳履歷（PDF／Word）並貼上至少 10 個字的職缺說明';
}

document.getElementById('generateReverseBtn').addEventListener('click', runReverseInterview);

async function runReverseInterview(){
  const btn = document.getElementById('generateReverseBtn');
  const statusLine = document.getElementById('reverseStatusLine');
  beginRun();
  btn.disabled = true;
  statusLine.classList.remove('err');
  statusLine.innerHTML = '<span class="spinner"></span>AI 正在準備反問清單與風險評估⋯';

  const jobDesc = sharedJobDesc.value.trim();
  const marketStats = marketStatsInput.value.trim();

  const systemPrompt = `你是資深獵頭顧問與面試教練，非常了解台灣就業市場（包括 104、1111 等人力銀行職缺說明常見的公版話術與其背後可能代表的意思）。你會收到：(1) 履歷全文 (2) 職缺說明 (3) 使用者選填、可能為空的公開統計資訊（例如從 104/1111 職缺頁面看到的薪資範圍、應徵人數、公司規模等，使用者手動貼上，不保證完整或最新）。

${HONESTY_RULE}

請完成三件事：

1. reverseQuestions：10 個候選人應該在面試中主動反問面試官的重要問題。這些問題要根據這個職缺說明的具體內容量身設計（不要用「公司文化如何」這種泛用模板題），目的是幫助候選人判斷自己是否真的能勝任、以及這份工作有沒有被職缺說明隱藏起來的問題（例如實際工作範圍、團隊穩定度、成功指標、資源支援、加班狀況、這個職缺為什麼現在在招人等）。每題附上一句話 purpose，說明這題想確認或揭露什麼。

2. hiddenRisks：根據職缺說明的措辭、（若有提供）公開統計資訊，列出 2-5 個「值得留意的潛在隱性風險」。這些是根據文字線索做的推測，不是確定的事實，必須使用「可能」「建議進一步確認」等語氣。如果職缺說明看起來沒有明顯疑慮，就誠實說「目前資訊沒有看到明顯的隱性風險」，不要為了湊數硬找問題。

3. competencyAssessment：根據履歷與職缺的落差，給一段誠實、簡短（2-3 句話）的初步勝任度判斷，說明目前看起來勝任的部分、以及還需要在面試中進一步確認的部分。必須明確表達這只是根據書面資料的初步判斷、不是最終結論，實際情況要以面試中蒐集到的資訊為準。

${JSON_SAFETY_RULE}

只能輸出一個 JSON 物件，不要任何其他文字、不要 markdown code fence，格式必須完全符合：
{"reverseQuestions": [{"question": "...", "purpose": "..."}], "hiddenRisks": ["..."], "competencyAssessment": "..."}`;

  const userContent = `【職缺說明】\n${jobDesc}\n\n【履歷內容】\n${resumeText}\n\n【使用者提供的公開統計資訊（可能為空）】\n${marketStats || '（未提供）'}`;
  /* v3.3.50 修復：改在送出請求「當下」記錄快照，理由同 tab-match.js。
     v3.3.51 補充：快照額外帶上「市場統計資訊」——這欄位會直接影響反問清單與風險評估的
     內容，修改後卻沒被算進過期偵測範圍的話，系統不會提示「需要重新產生」。 */
  const snapshotKeyAtRequestTime = currentInputKey(marketStats);

  try {
    const parsed = await callClaude(systemPrompt, userContent, 26000, { label: 'reverseInterview' });
    renderReverseInterview(parsed);
    statusLine.textContent = '完成';
    jobDescSnapshotReverse.value = snapshotKeyAtRequestTime;
    const banner = document.getElementById('staleBannerReverse');
    if (banner) banner.classList.remove('show');
    lastResultReverse.value = parsed;
    saveDraft();
  } catch (err){
    console.error(err);
    statusLine.textContent = friendlyErrorMessage(err);
    statusLine.classList.add('err');
  } finally {
    endRun();
  }
}

function renderReverseInterview(parsed){
  const questions = Array.isArray(parsed.reverseQuestions) ? parsed.reverseQuestions : [];
  const hiddenRisks = Array.isArray(parsed.hiddenRisks) ? parsed.hiddenRisks : [];
  const competencyAssessment = typeof parsed.competencyAssessment === 'string' ? parsed.competencyAssessment : '';

  const panel = document.getElementById('reverseResultsPanel');
  panel.classList.remove('empty');
  panel.innerHTML = `
    <h2 class="section-title">你可以反問面試官的問題</h2>
    ${questions.map((q, idx) => `
      <div class="reverse-q-card">
        <div><span class="reverse-q-num">Q${idx+1}.</span>${escapeHtml(q.question)}</div>
        <div class="reverse-q-purpose">為什麼問這題：${escapeHtml(q.purpose || '')}</div>
      </div>
    `).join('')}
    <h2 class="section-title" style="margin-top:22px;">潛在隱性風險</h2>
    <ul class="risk-list">${hiddenRisks.length ? hiddenRisks.map(r=>`<li>${escapeHtml(r)}</li>`).join('') : '<li>目前資訊沒有看到明顯的隱性風險</li>'}</ul>
    <h2 class="section-title" style="margin-top:22px;">初步勝任度判斷</h2>
    <div class="competency-box">${escapeHtml(competencyAssessment)}</div>
  `;
}

