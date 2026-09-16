/* =======================================================================
   js/tab-match.js — TAB 1：履歷媒合（配對分數、匹配重點、自我推薦信）
   
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
   TAB 1 — 履歷媒合（配對分數 + 匹配重點 + 自我推薦信）
========================================================= */
document.getElementById('generateBtn1').addEventListener('click', runMatch);

async function runMatch(){
  const btn = document.getElementById('generateBtn1');
  const statusLine = document.getElementById('statusLine1');
  beginRun();
  btn.disabled = true;
  statusLine.classList.remove('err');
  statusLine.innerHTML = '<span class="spinner"></span>AI 正在分析職缺與履歷⋯';

  const jobDesc = sharedJobDesc.value.trim();
  const jobType = document.getElementById('jobType').value;

  const toneMap = {
    '技術研發': '強調解決問題的方法、技術深度與可量化的成果指標（效能、穩定性、產出）。',
    '業務/客戶': '強調數字成果（業績、客戶數、成交率）與對客戶關係/營收的具體影響。',
    '行銷': '強調對品牌聲量、轉換率、成長數據等可衡量成果的影響。',
    '管理/主管': '強調團隊協作、決策判斷與帶來的組織/專案成果，而非個人單打獨鬥的細節。',
    '新鮮人/實習': '放寬「需完全對應經驗」的門檻，改強調學習力、基礎能力與可遷移技能，但仍需保守誠實，不可假裝有不存在的實務經驗。',
    '其他/通用': '維持專業、平衡的敘述方式，不特別偏重單一面向。'
  };

  const systemPrompt = `你是專業且誠實的求職顧問，同時深諳企業用人邏輯。你會收到一段職缺說明與一份履歷全文（純文字，可能因 PDF 擷取而有斷行或排版問題，請忽略排版雜訊，專注於內容）。應徵者鎖定的職務類型為「${jobType}」，撰寫時請：${toneMap[jobType] || ''}

${HONESTY_RULE}

請完成三件事：
0. 媒合分數：先評估履歷與這則職缺的「整體媒合程度」，給一個 matchScore（0-100 整數）。這個分數必須保守誠實，反映真實的專業符合度，不可為了鼓勵應徵者而灌水，也不可因為要寫推薦信就假裝很高分——分數與底下的匹配重點、推薦信內容必須互相一致。再用一句話 scoreReason 說明為什麼打這個分數，具體指出主要加分或扣分的原因。
1. 匹配重點（4 到 6 點）：每點 1 句話，具體指出履歷中的哪項技能/經驗/成果對應職缺的哪項需求，依真實契合程度誠實表達，不使用空泛形容詞。
2. 自我推薦信（繁體中文，約 280-420 字）：語氣專業、有自信、直接，避免謙卑討好或浮誇無依據的保證。內容需包含：
- 開頭簡短說明應徵動機與對這個職缺/公司的理解
- 用履歷中具體、真實的經驗或成果，對應職缺最核心的 2-3 項需求
- 至少 1-2 段從「公司角度」出發，具體說明應徵者加入後能為公司解決什麼問題、帶來什麼價值、如何對業績/成本/獲利/客戶滿意度產生正面影響，須根據履歷真實經驗合理推論，不可空泛喊口號
- 結尾清楚表達合作意願，語氣自信、不卑不亢

${JSON_SAFETY_RULE}

只能輸出一個 JSON 物件，不要任何其他文字、不要 markdown code fence，格式必須完全符合：
{"matchScore": 0, "scoreReason": "...", "matchPoints": ["...", "..."], "coverLetter": "..."}`;

  const userContent = `【職缺說明】\n${jobDesc}\n\n【履歷內容】\n${resumeText}`;
  /* v3.3.50 修復：原本是等 AI 回應「回來之後」才呼叫 currentInputKey() 記錄快照，但
     使用者可能在等待 AI 回應期間（可能長達數十秒）就換了一份新履歷或改了職缺說明。
     這樣一來，實際送出去給 AI 分析的其實是「舊的」履歷/職缺內容，回應回來後卻拿當下
     （已經改變的）輸入內容當作快照存起來，導致系統誤判「這份新輸入的結果是新鮮的」，
     不會顯示⚠️過期提示——但畫面上顯示的其實是舊輸入的分析結果。改成在送出請求「當下」
     就記錄快照與履歷內容，才能正確反映「這份結果實際對應哪一份輸入」（下面的自動重試
     推薦信也改用這份存好的內容，避免同一次分析裡，主要內容跟自動補的推薦信各自對應到
     不同時間點的履歷）。 */
  /* v3.3.50 修復：改在送出請求「當下」記錄快照，避免等待 AI 回應期間使用者換了履歷／
     職缺說明，導致系統誤判「舊結果」對應到「新輸入」，見 tab-match.js 同一處修法的說明。
     v3.3.51 補充：快照額外帶上「職務類型」——這個欄位會影響推薦信的語氣，換了職務類型
     卻沒被算進過期偵測範圍的話，系統不會提示「需要重新產生」。 */
  const snapshotKeyAtRequestTime = currentInputKey(jobType);
  const resumeTextAtRequestTime = resumeText;

  try {
    const parsed = await callClaude(systemPrompt, userContent, 22000, { label: 'match' });

    // v3.3.5：推薦信偶爾會出現「其餘欄位都正常、只有 coverLetter 是空字串」的情況
    // （AI 該次回應品質問題）。與其讓使用者自己發現空白再手動重按一次，這裡先自動
    // 補一次「只重寫推薦信」的請求：沿用同一次分析出來的 matchScore／matchPoints，
    // 確保分數與推薦信內容前後一致，也比整份重新產生省 token、更快。
    let coverLetter = typeof parsed.coverLetter === 'string' ? parsed.coverLetter : '';
    if (coverLetter.trim().length === 0){
      statusLine.innerHTML = '<span class="spinner"></span>推薦信內容是空的，AI 正在自動重新產生一次⋯';
      addDebugLog({ type: 'warning', label: 'match', message: 'coverLetter 為空字串，開始自動重試一次' });
      try {
        const retryLetter = await generateCoverLetterOnly(jobDesc, resumeTextAtRequestTime, jobType, toneMap[jobType] || '', parsed.matchScore, parsed.scoreReason, parsed.matchPoints);
        if (retryLetter && retryLetter.trim().length > 0){
          parsed.coverLetter = retryLetter;
          addDebugLog({ type: 'info', label: 'match', message: '自動重試成功，已補上推薦信內容' });
        } else {
          addDebugLog({ type: 'warning', label: 'match', message: '自動重試後 coverLetter 仍為空字串' });
        }
      } catch (retryErr){
        console.error('自動重試推薦信失敗', retryErr);
        addDebugLog({ type: 'warning', label: 'match', message: '自動重試推薦信時發生錯誤：' + retryErr.message });
      }
    }

    renderMatchResults(parsed);
    statusLine.textContent = '完成';
    jobDescSnapshot[1] = snapshotKeyAtRequestTime;
    setTabDot(1, 'done');
    refreshStaleIndicators();
    lastResult1 = parsed;
    rmStageStats.match = parsed.__meta || null;
    updateStepMeta(1, parsed.__meta || null);
    saveDraft();
    return true;
  } catch (err){
    console.error(err);
    statusLine.textContent = friendlyErrorMessage(err);
    statusLine.classList.add('err');
    rmStageStats.match = { tokensUsed: 0, failed: true };
    updateStepMeta(1, { failed: true });
    return false;
  } finally {
    endRun();
  }
}

/* v3.3.5：只重寫推薦信用的輕量版請求。沿用第一次分析已經產生的 matchScore／
   scoreReason／matchPoints（不重新評分，避免兩次呼叫給出不一致的分數），
   只請 AI 針對同一份履歷與職缺，補寫一封自我推薦信。 */
async function generateCoverLetterOnly(jobDesc, resumeContentText, jobType, toneCue, matchScore, scoreReason, matchPoints){
  const systemPrompt = `你是專業且誠實的求職顧問，同時深諳企業用人邏輯。你會收到一段職缺說明與一份履歷全文（純文字，可能因 PDF 擷取而有斷行或排版問題，請忽略排版雜訊，專注於內容）。應徵者鎖定的職務類型為「${jobType}」，撰寫時請：${toneCue}

${HONESTY_RULE}

這份履歷與職缺先前已經完成媒合分析，請直接沿用以下結論（不要重新評分、不要修改分數或重點，只需要依據這些結論撰寫推薦信）：
- 媒合分數：${matchScore}
- 分數說明：${scoreReason}
- 匹配重點：${JSON.stringify(Array.isArray(matchPoints) ? matchPoints : [])}

請撰寫一封自我推薦信（繁體中文，約 280-420 字）：語氣專業、有自信、直接，避免謙卑討好或浮誇無依據的保證。內容需包含：
- 開頭簡短說明應徵動機與對這個職缺/公司的理解
- 用履歷中具體、真實的經驗或成果，對應職缺最核心的 2-3 項需求
- 至少 1-2 段從「公司角度」出發，具體說明應徵者加入後能為公司解決什麼問題、帶來什麼價值、如何對業績/成本/獲利/客戶滿意度產生正面影響，須根據履歷真實經驗合理推論，不可空泛喊口號
- 結尾清楚表達合作意願，語氣自信、不卑不亢

${JSON_SAFETY_RULE}

只能輸出一個 JSON 物件，不要任何其他文字、不要 markdown code fence，格式必須完全符合：
{"coverLetter": "..."}`;

  const userContent = `【職缺說明】\n${jobDesc}\n\n【履歷內容】\n${resumeContentText}`;
  const result = await callClaude(systemPrompt, userContent, 8000, { label: 'matchLetterRetry' });
  return typeof result.coverLetter === 'string' ? result.coverLetter : '';
}

function getMatchTier(score){
  if (score >= 85) return { label: '高度契合，強烈建議投遞', tone: 'high' };
  if (score >= 70) return { label: '專業符合度高，可投遞履歷', tone: 'good' };
  if (score >= 50) return { label: '部分符合，建議先微調履歷再投遞', tone: 'mid' };
  if (score >= 30) return { label: '專業能力不足，需再加強後投遞', tone: 'low' };
  return { label: '落差較大，建議先累積相關經驗再投遞', tone: 'verylow' };
}

function renderMatchResults(parsed){
  let matchScore = Number(parsed.matchScore);
  if (!Number.isFinite(matchScore)) matchScore = null;
  if (matchScore !== null) matchScore = Math.max(0, Math.min(100, Math.round(matchScore)));
  const scoreReason = typeof parsed.scoreReason === 'string' ? parsed.scoreReason : '';
  const matchPoints = Array.isArray(parsed.matchPoints) ? parsed.matchPoints : [];
  const coverLetter = typeof parsed.coverLetter === 'string' ? parsed.coverLetter : '';
  const letterIsEmpty = coverLetter.trim().length === 0;
  if (letterIsEmpty){
    // v3.3.5：走到這裡代表 runMatch 裡「自動重試一次」也還是失敗（或重試時發生錯誤），
    // 屬於連續兩次都不順利的少見狀況，才需要請使用者自己手動再按一次。
    addDebugLog({ type: 'warning', label: 'match', message: 'coverLetter 欄位為空字串（已自動重試過一次仍為空），需使用者手動重新產生' });
  }
  const panel = document.getElementById('resultsPanel1');
  panel.classList.remove('empty');

  let scoreBlockHtml = '';
  if (matchScore !== null){
    const tier = getMatchTier(matchScore);
    scoreBlockHtml = `
      <div class="score-block">
        <div class="score-number">${matchScore}<sub>/100</sub></div>
        <div class="score-bar-wrap">
          <div class="score-bar"><div class="score-bar-fill tier-${tier.tone}" style="width:${matchScore}%"></div></div>
          <div class="tier-badge tier-${tier.tone}">${escapeHtml(tier.label)}</div>
          ${scoreReason ? `<div class="score-reason">${escapeHtml(scoreReason)}</div>` : ''}
        </div>
      </div>`;
  }

  panel.innerHTML = `
    ${scoreBlockHtml}
    <div class="results-grid">
      <div>
        <h2 class="section-title">匹配重點</h2>
        <ul class="match-list">${matchPoints.map(p => `<li><span class="dot"></span><span>${escapeHtml(p)}</span></li>`).join('')}</ul>
      </div>
      <div class="letter-box">
        <h2 class="section-title">自我推薦信（可直接編輯）</h2>
        ${letterIsEmpty ? '' : `<div class="seal" id="seal"><span>已生成<br>推薦信</span></div>`}
        ${letterIsEmpty ? `<div class="stale-banner show" style="margin:0 0 10px;">⚠️ AI 已自動重試一次仍沒有產生推薦信內容（媒合分數與匹配重點不受影響，仍正常），請點擊上方「產生媒合分析」按鈕再手動產生一次。</div>` : ''}
        <textarea id="coverLetter">${escapeHtml(coverLetter)}</textarea>
        <div class="letter-actions">
          <button class="secondary" id="copyBtn">複製文字</button>
          <button class="secondary" id="downloadBtn">下載 .txt</button>
          <span class="char-count" id="letterCount">${coverLetter.length} 字</span>
        </div>
      </div>
    </div>`;
  const seal = document.getElementById('seal');
  if (seal) requestAnimationFrame(() => seal.classList.add('show'));

  const letterEl = document.getElementById('coverLetter');
  const letterCount = document.getElementById('letterCount');
  /* v3.3.49 修復：原本這裡只更新字數顯示，使用者手動編輯過的推薦信內容完全沒有同步
     寫回 lastResult1（也沒有觸發草稿保存）。「複製」「下載」兩個按鈕當下讀的是文字框
     即時內容，沒有問題；但只要編輯之後、重新整理頁面前，又觸發了任何一次自動存草稿
     （例如接著去改職缺說明），存進草稿的還是 AI 原始版本，不是使用者編輯過的版本。
     等重新整理頁面選擇「復原上次內容」時，編輯過的內容就會被原始版本悄悄蓋掉，且完全
     沒有警告。這裡補上同步寫回與觸發草稿保存。 */
  letterEl.addEventListener('input', () => {
    letterCount.textContent = letterEl.value.length + ' 字';
    if (lastResult1) lastResult1.coverLetter = letterEl.value;
    scheduleDraftSave();
  });

  document.getElementById('copyBtn').addEventListener('click', async () => {
    const b = document.getElementById('copyBtn'); const orig = b.textContent;
    /* v3.3.53 修復：同 shared-helpers.js 的除錯面板複製按鈕，補上原本缺少的錯誤處理。 */
    try {
      await navigator.clipboard.writeText(letterEl.value);
      b.textContent = '已複製'; setTimeout(() => b.textContent = orig, 1500);
    } catch (e){
      console.error('複製失敗', e);
      alert('自動複製失敗（可能是瀏覽器權限限制），請直接從上方文字框手動選取複製。');
    }
  });
  document.getElementById('downloadBtn').addEventListener('click', () => {
    const blob = new Blob([letterEl.value], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = '自我推薦信.txt'; a.click();
    URL.revokeObjectURL(url);
  });
}
