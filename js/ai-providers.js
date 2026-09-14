/* =======================================================================
   js/ai-providers.js — AI 呼叫層（各供應商 fetch 函式、重試機制、JSON 解析修復、統一入口 callClaude）
   
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
/* ---------------- 通用重試包裝器：處理 429/502/503/504 等暫時性錯誤 ---------------- */
const RM_RETRYABLE_STATUSES = [429, 502, 503, 504];
async function fetchWithRetry(fetchFn, maxRetries){
  let lastResp = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++){
    let resp;
    try { resp = await fetchFn(); }
    catch (err){
      if (attempt < maxRetries){ await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1200)); continue; }
      throw err;
    }
    if (resp.ok) return resp;
    if (RM_RETRYABLE_STATUSES.includes(resp.status) && attempt < maxRetries){
      lastResp = resp;
      await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1200));
      continue;
    }
    return resp;
  }
  return lastResp;
}

/* =========================================================
   v2.9.199 修正：各家供應商的 max_tokens／maxOutputTokens 參數都有
   API 本身的硬性上限（例如 OpenAI 相容端點常見上限落在 16000 左右，
   部分模型甚至更低），若直接把使用者要求的數字（可能高達 45000）原封
   不動送出去，API 極可能直接回傳 400 錯誤（invalid_request_error：
   max_tokens 超過該模型上限），而不是我們原本想解決的「輸出被截
   斷」。因此在真正送出前，統一夾住（clamp）在各供應商已知安全上限
   之內，同時仍盡量給到最大可用值，兩者兼顧。
========================================================= */
const RM_MAX_TOKENS_CAP = { claude: 16000, gemini: 16000, chatgpt: 16000, agnes: 16000, builtin: 8000 };
function clampMaxTokens(provider, requested){
  const cap = RM_MAX_TOKENS_CAP[provider] || 8000;
  const value = requested || 1200;
  return Math.min(value, cap);
}

/* v3.0.99：部分供應商（尤其是舊版/相容端點）不一定會在回應中附上正確的
   usage／用量資訊，這裡提供一個粗略的備援估算（依中英文混合文字概算，
   非精確計算），只在 API 沒有回傳實際用量時才使用，並在畫面上以「約」
   標示，避免誤導使用者以為是精確數字。*/
function estimateTokensFallback(promptText, responseText){
  const totalChars = String(promptText || '').length + String(responseText || '').length;
  return Math.max(1, Math.ceil(totalChars / 2));
}

/* ---------------- 系統內建連線（未設定金鑰時的預設行為，維持原本相容性） ---------------- */
async function fetchClaudeBuiltInText(systemPrompt, userContent, maxTokens){
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: clampMaxTokens('builtin', maxTokens),
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }]
    })
  });
  if (!response.ok){
    let bodyText = '';
    try { bodyText = await response.text(); } catch (e){}
    throw new Error('API 回應失敗 (' + response.status + ')' + (bodyText ? '：' + bodyText.slice(0, 200) : ''));
  }
  const data = await response.json();
  const textBlock = (data.content || []).find(b => b.type === 'text');
  if (!textBlock) throw new Error('沒有收到回應內容，原始回應：' + JSON.stringify(data).slice(0, 300));
  const usage = data.usage;
  const tokensUsed = usage ? (Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0)) : estimateTokensFallback(systemPrompt + userContent, textBlock.text);
  return { text: textBlock.text, truncated: data.stop_reason === 'max_tokens', tokensUsed, tokensExact: !!usage };
}

/* ---------------- Claude (Anthropic) —— 使用者自行貼上的 API Key ---------------- */
async function fetchClaudeText(systemPrompt, userContent, maxTokens, key){
  const doFetch = () => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: clampMaxTokens('claude', maxTokens),
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }]
    })
  });
  const resp = await fetchWithRetry(doFetch, 2);
  if (!resp.ok){
    const errText = await resp.text().catch(() => '');
    if (resp.status === 401) throw new Error('auth_error:Claude API Key 無效或已過期，請重新確認金鑰');
    if (resp.status === 429) throw new Error('rate_limit:Claude API 額度已達上限，已自動重試但仍失敗，請稍後再試');
    if (resp.status === 503) throw new Error('overloaded:Claude 伺服器目前負載過高（503），已自動重試但仍無法回應，請稍後再試');
    throw new Error('api_error:' + resp.status + '：' + errText.slice(0, 200));
  }
  const data = await resp.json();
  const textBlocks = (data.content || []).filter(b => b.type === 'text').map(b => b.text);
  if (!textBlocks.length) throw new Error('empty_response:Claude 回應中沒有文字內容');
  const text = textBlocks.join('');
  const usage = data.usage;
  const tokensUsed = usage ? (Number(usage.input_tokens || 0) + Number(usage.output_tokens || 0)) : estimateTokensFallback(systemPrompt + userContent, text);
  return { text, truncated: data.stop_reason === 'max_tokens', tokensUsed, tokensExact: !!usage };
}

/* ---------------- Gemini (Google AI Studio) ---------------- */
async function fetchGeminiText(systemPrompt, userContent, maxTokens, key){
  const doFetch = () => fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { maxOutputTokens: clampMaxTokens('gemini', maxTokens) }
    })
  });
  let resp;
  try { resp = await fetchWithRetry(doFetch, 2); }
  catch (networkErr){ throw new Error('cors_or_network:Gemini API 連線失敗，最常見原因是瀏覽器跨來源請求（CORS）被阻擋，建議改用其他供應商。'); }
  if (!resp.ok){
    const errText = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403) throw new Error('auth_error:Gemini API Key 無效、未啟用或權限不足，請至 aistudio.google.com/apikey 確認');
    if (resp.status === 429) throw new Error('rate_limit:Gemini API 額度已達上限，已自動重試但仍失敗，請稍後再試');
    if (resp.status === 503) throw new Error('overloaded:Gemini 模型目前負載過高（503），已自動重試但仍無法回應，請稍後再試或改用其他供應商');
    throw new Error('api_error:' + resp.status + '：' + errText.slice(0, 200));
  }
  const data = await resp.json();
  const candidate = data.candidates && data.candidates[0];
  const parts = (candidate && candidate.content && candidate.content.parts) || [];
  const text = parts.filter(p => p.text).map(p => p.text).join('');
  const finishReason = candidate && candidate.finishReason;
  if (!text){
    if (finishReason && finishReason !== 'STOP') throw new Error('empty_response:Gemini 回應被中斷（finishReason: ' + finishReason + '），可能是輸出超過長度限制，請稍後再試');
    throw new Error('empty_response:Gemini 回應中沒有文字內容');
  }
  const usageMeta = data.usageMetadata;
  const tokensUsed = usageMeta ? Number(usageMeta.totalTokenCount || 0) : estimateTokensFallback(systemPrompt + userContent, text);
  return { text, truncated: finishReason === 'MAX_TOKENS', tokensUsed, tokensExact: !!usageMeta };
}

/* ---------------- ChatGPT (OpenAI) ---------------- */
async function fetchChatGPTText(systemPrompt, userContent, maxTokens, key){
  const doFetch = () => fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: clampMaxTokens('chatgpt', maxTokens),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    })
  });
  let resp;
  try { resp = await fetchWithRetry(doFetch, 2); }
  catch (networkErr){ throw new Error('cors_or_network:ChatGPT (OpenAI) API 連線失敗，可能是瀏覽器跨來源請求（CORS）被阻擋，建議改用其他供應商。'); }
  if (!resp.ok){
    const errText = await resp.text().catch(() => '');
    if (resp.status === 401) throw new Error('auth_error:OpenAI API Key 無效或已過期，請重新確認金鑰');
    if (resp.status === 429) throw new Error('rate_limit:OpenAI API 額度已達上限，已自動重試但仍失敗，請稍後再試');
    if (resp.status === 503) throw new Error('overloaded:OpenAI 伺服器目前負載過高（503），已自動重試但仍無法回應，請稍後再試');
    throw new Error('api_error:' + resp.status + '：' + errText.slice(0, 200));
  }
  const data = await resp.json();
  const choice = data.choices && data.choices[0];
  const text = choice && choice.message && choice.message.content;
  if (!text){
    if (choice && choice.finish_reason === 'length') throw new Error('empty_response:ChatGPT 回應被截斷（finish_reason: length，輸出超過長度限制），請稍後再試或增加長度上限');
    throw new Error('empty_response:ChatGPT 回應中沒有文字內容');
  }
  const usage = data.usage;
  const tokensUsed = usage ? Number(usage.total_tokens || 0) : estimateTokensFallback(systemPrompt + userContent, text);
  return { text, truncated: choice && choice.finish_reason === 'length', tokensUsed, tokensExact: !!usage };
}

/* ---------------- Agnes AI（OpenAI 相容端點） ---------------- */
async function fetchAgnesText(systemPrompt, userContent, maxTokens, key){
  let baseUrl = 'https://apihub.agnes-ai.com/v1';
  try{
    const stored = sessionStorage.getItem(RM_KEY_PREFIX+'baseurl_agnes');
    if (stored && stored.trim()) baseUrl = stored.trim().replace(/\/+$/, '');
  }catch(e){}
  const doFetch = () => fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({
      model: 'agnes-2.0-flash',
      max_tokens: clampMaxTokens('agnes', maxTokens),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]
    })
  });
  let resp;
  // Agnes AI 實測連線穩定度略低於 Claude／Gemini／OpenAI，重試次數加到 3 次（共 4 次嘗試）。
  try { resp = await fetchWithRetry(doFetch, 3); }
  catch (networkErr){ throw new Error('cors_or_network:Agnes AI API 連線失敗（CORS 或 DNS 錯誤，已自動重試 3 次仍失敗）。目前端點：' + baseUrl + '，請確認 Base URL 是否正確；若持續失敗，建議改用 Claude／Gemini／ChatGPT。'); }
  if (!resp.ok){
    const errText = await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403) throw new Error('auth_error:Agnes AI API Key 無效或權限不足，請確認金鑰是否正確');
    if (resp.status === 429) throw new Error('rate_limit:Agnes AI API 額度已達上限，已自動重試但仍失敗，請稍後再試');
    if (resp.status === 503) throw new Error('overloaded:Agnes AI 伺服器目前負載過高（503），已自動重試但仍無法回應，請稍後再試');
    throw new Error('api_error:' + resp.status + '：' + errText.slice(0, 200));
  }
  const data = await resp.json();
  const choice = data.choices && data.choices[0];
  const text = choice && choice.message && choice.message.content;
  if (!text){
    // 實測 Agnes AI 在輸出被截斷（超過 max_tokens）時，有時會回傳完全空白的
    // content，而不是回傳「寫到一半」的內容，因此這裡明確區分「被截斷」與
    // 「單純沒有內容」兩種情況，方便判斷是否該提高 maxTokens。
    if (choice && choice.finish_reason === 'length') throw new Error('empty_response:Agnes AI 回應被截斷（finish_reason: length，輸出超過長度限制），請稍後再試或增加長度上限');
    throw new Error('empty_response:Agnes AI 回應中沒有文字內容');
  }
  const usage = data.usage;
  const tokensUsed = usage ? Number(usage.total_tokens || 0) : estimateTokensFallback(systemPrompt + userContent, text);
  return { text, truncated: choice && choice.finish_reason === 'length', tokensUsed, tokensExact: !!usage };
}

/* =========================================================
   v3.0.99：新增「階段耗時歷史紀錄」與「用量附加資訊」，供「一鍵產生全部
   分析」在依序執行時，即時顯示目前跑到哪一項、預計還要多久、已用多少
   tokens。歷史紀錄只存在本次瀏覽器分頁（sessionStorage），跑過幾次後
   預估時間會越來越準；沒有歷史紀錄時使用保守的預設猜測值。
========================================================= */
const RM_STAGE_HISTORY_KEY = RM_KEY_PREFIX + 'stageDurationHistory';
function getStageHistory(){
  try { return JSON.parse(sessionStorage.getItem(RM_STAGE_HISTORY_KEY) || '{}'); }
  catch (e){ return {}; }
}
function recordStageDuration(label, ms){
  try {
    const hist = getStageHistory();
    if (!hist[label]) hist[label] = [];
    hist[label].push(ms);
    if (hist[label].length > 5) hist[label] = hist[label].slice(-5);
    sessionStorage.setItem(RM_STAGE_HISTORY_KEY, JSON.stringify(hist));
  } catch (e){}
}
const RM_STAGE_DEFAULT_MS = { match: 14000, healthcheck: 28000, interviewSetup: 12000 };
function estimateStageDuration(label){
  const hist = getStageHistory();
  const arr = hist[label];
  if (arr && arr.length) return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
  return RM_STAGE_DEFAULT_MS[label] || 15000;
}

/* ---------------- 統一入口（依目前選擇的供應商分派） ----------------
   呼叫端的用法完全不變：callClaude(systemPrompt, userContent, maxTokens) -> 回傳解析後的 JSON 物件。
   若已設定任一供應商的 API Key，會改用該供應商的真實 API；
   若未設定任何金鑰，則沿用系統內建連線（原本的行為）。
   第 4 個參數 opts（選填）：{ label } —— 若提供 label，會把這次呼叫的
   實際耗時記錄進「階段耗時歷史」，用於之後估算「一鍵產生全部分析」還
   需要多久；同時回傳的 JSON 物件上會附加一個 __meta 欄位
   { tokensUsed, tokensExact, durationMs, provider, label }，
   供呼叫端（例如 runAll）讀取本次實際用量與耗時，不影響原本欄位。 */
async function callClaude(systemPrompt, userContent, maxTokens, opts){
  const label = opts && opts.label;
  const startedAt = Date.now();
  let result = null, usedProvider = 'builtin';
  try {
    const provider = getProvider();
    const key = provider ? getKeyFor(provider) : '';
    if (key && provider === 'claude'){ result = await fetchClaudeText(systemPrompt, userContent, maxTokens, key); usedProvider = 'claude'; }
    else if (key && provider === 'gemini'){ result = await fetchGeminiText(systemPrompt, userContent, maxTokens, key); usedProvider = 'gemini'; }
    else if (key && provider === 'chatgpt'){ result = await fetchChatGPTText(systemPrompt, userContent, maxTokens, key); usedProvider = 'chatgpt'; }
    else if (key && provider === 'agnes'){ result = await fetchAgnesText(systemPrompt, userContent, maxTokens, key); usedProvider = 'agnes'; }
    else { result = await fetchClaudeBuiltInText(systemPrompt, userContent, maxTokens); usedProvider = 'builtin'; }

    const rawText = result.text;
    try {
      const parsed = parseJsonLoose(rawText);
      const durationMs = Date.now() - startedAt;
      addDebugLog({ type: 'success', provider: usedProvider, label, durationMs, promptChars: (systemPrompt + userContent).length, responseChars: rawText.length, tokensUsed: result.tokensUsed, tokensExact: !!result.tokensExact });
      if (label) recordStageDuration(label, durationMs);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)){
        parsed.__meta = { tokensUsed: result.tokensUsed || 0, tokensExact: !!result.tokensExact, durationMs, provider: usedProvider, label };
      }
      return parsed;
    } catch (parseErr){
      // 解析失敗時，若這次呼叫本來就已經被供應商標記為「輸出被截斷」，
      // 給出更明確的原因（而不是單純的「無法解析」），方便判斷是否該調高 maxTokens。
      if (result.truncated){
        const actualLimit = clampMaxTokens(usedProvider, maxTokens);
        throw new Error('truncated:AI 回應在完成前被截斷（超過本次呼叫的長度上限，約 ' + actualLimit + ' tokens' + (actualLimit < (maxTokens || 1200) ? '，已被供應商上限夾住，實際小於程式設定的 ' + (maxTokens || 1200) : '') + '），導致 JSON 不完整。建議稍後再試一次，或改用回應較精簡的供應商。');
      }
      throw parseErr;
    }
  } catch (err){
    addDebugLog({ type: 'error', provider: usedProvider, label, message: String(err && err.message || err), name: err && err.name, durationMs: Date.now() - startedAt });
    throw err;
  }
}

window.addEventListener('DOMContentLoaded', function(){ refreshApiUi(); });

/* =========================================================
   v2.8.99 修正：四層 JSON 解析（原本只有三層、且沒有處理「尾隨逗號」）。
   實測 Agnes AI（以及其他較平價的 OpenAI 相容供應商）常見兩種格式錯誤，
   原本的解析器完全沒有處理第①種，導致這類供應商的回應大量解析失敗：
   ① 物件或陣列結尾多一個逗號，例如 {"a":1,"b":2,} 或 ["x","y",]
      —— 這是 JSON.parse 會直接拋錯、但視覺上很容易被忽略的錯誤。
   ② 字串內容中夾帶未轉義的雙引號或裸露的換行/Tab 字元。
   兩種問題可能同時出現，因此採用「多種修復函式排列組合、依序嘗試」的
   四層策略，而不是只修一種就放棄。
========================================================= */
function stripTrailingCommas(t){
  return t.replace(/,(\s*[}\]])/g, '$1');
}

function unifiedJsonRepair(text){
  let out = '';
  let inString = false;
  let pendingInnerOpen = false;
  let i = 0;
  while (i < text.length){
    const ch = text[i];
    if (ch === '\\' && inString){
      out += ch + (text[i + 1] || '');
      i += 2;
      continue;
    }
    if (ch === '"'){
      if (!inString){
        inString = true; pendingInnerOpen = false;
        out += ch;
      } else {
        let j = i + 1;
        while (j < text.length && /\s/.test(text[j])) j++;
        const nextCh = text[j];
        const isStructuralEnd = (nextCh === undefined || nextCh === ',' || nextCh === '}' || nextCh === ']' || nextCh === ':');
        if (isStructuralEnd && !pendingInnerOpen){
          inString = false;
          out += ch;
        } else if (!pendingInnerOpen){
          // 字串中途出現的引號：視為使用者自己在引用文字，轉成中文引號避免破壞 JSON 結構
          pendingInnerOpen = true;
          out += '\u300C'; // 「
        } else {
          pendingInnerOpen = false;
          out += '\u300D'; // 」
        }
      }
    } else if (inString && (ch === '\n' || ch === '\r' || ch === '\t')){
      if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else out += '\\t';
    } else {
      out += ch;
    }
    i++;
  }
  return out;
}

function parseJsonLoose(text){
  const original = text;
  let t = String(text == null ? '' : text).trim();
  t = t.replace(/```json/gi, '').replace(/```/g, '').trim();

  // 找出第一個 { 或 [ 到對應最後一個 } 或 ] 之間的內容，去除模型可能加的
  // 前後說明文字（例如「好的，以下是分析結果：...」），Agnes 這類供應商比
  // Claude 更常在 JSON 前後夾帶這類客套話。
  const firstObj = t.indexOf('{');
  const firstArr = t.indexOf('[');
  let start;
  if (firstObj === -1 && firstArr === -1) start = -1;
  else if (firstObj === -1) start = firstArr;
  else if (firstArr === -1) start = firstObj;
  else start = Math.min(firstObj, firstArr);
  if (start >= 0){
    const isArr = t[start] === '[';
    const end = isArr ? t.lastIndexOf(']') : t.lastIndexOf('}');
    if (end > start) t = t.slice(start, end + 1);
  }

  const attempts = [
    { label: '第一層：標準解析', fn: s => s },
    { label: '第二層：移除尾隨逗號', fn: s => stripTrailingCommas(s) },
    { label: '第三層：修復未轉義引號／控制字元', fn: s => unifiedJsonRepair(s) },
    { label: '第四層：修復引號控制字元＋移除尾隨逗號', fn: s => stripTrailingCommas(unifiedJsonRepair(s)) }
  ];
  let lastErr = null;
  for (const attempt of attempts){
    try {
      const parsed = JSON.parse(attempt.fn(t));
      if (attempt.label !== '第一層：標準解析'){
        console.info('[parseJsonLoose] 已透過「' + attempt.label + '」修復成功');
      }
      return parsed;
    } catch (e){ lastErr = e; }
  }
  console.warn('[parseJsonLoose] 四層解析全部失敗，原始回應：', original);
  throw new Error('無法解析 AI 回傳的內容，請再試一次' + (lastErr ? '（' + lastErr.message + '）' : ''));
}

const HONESTY_RULE = `【誠實原則，最優先】只能依據履歷中「實際存在」的經驗、技能與成果作答。真正吻合就明確寫出來；只是部分相關或程度不足，要用保守、如實的說法呈現，不可誇大或編造成完全符合；完全找不到證據的項目不要硬寫進去。目標是讓內容經得起面試官檢驗，而不是每一項都硬湊成 100% 符合。`;

const JSON_SAFETY_RULE = `JSON 格式安全規則：字串內容中一律使用「」來標示引用文字，不可使用直式雙引號 " ；字串內容中不可包含真正的換行字元，需要換行請用 \\n 表示。這是為了確保輸出是可以被直接解析的合法 JSON。`;

/* =========================================================
   併發保護：所有會呼叫 AI 的按鈕共用同一把忙碌鎖，避免「一鍵產生
   全部」執行中又手動觸發個別分頁，造成重複呼叫、浪費 API 成本。
   v3.3.49 修復：beginRun() 原本定義好了卻沒有任何地方呼叫，等於這道
   保護完全沒有生效——現在 6 個個別產生函式（runMatch／runHealthCheck／
   runInterviewSetup／runReverseInterview／runTailoredResume／
   runProposalDeck）與 runAll() 都已經在各自開頭呼叫 beginRun()，
   跟原本就有的 endRun() 配成對。用計數器而非布林值設計，是為了支援
   runAll() 內部依序呼叫上述個別函式時的巢狀情境：只有最外層那次
   呼叫的 endRun() 讓計數器歸零，才會真正解鎖按鈕，中間三個階段
   銜接時不會出現短暫解鎖的空檔。
========================================================= */
const AI_BUTTON_IDS = ['generateBtn1', 'generateBtn2', 'generateBtn4', 'runAllBtn', 'generateReverseBtn', 'generateBtn6', 'generateBtn7'];
let activeRunCount = 0;

function beginRun(){
  activeRunCount++;
  if (activeRunCount === 1){
    AI_BUTTON_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = true; });
  }
}

function endRun(){
  activeRunCount = Math.max(0, activeRunCount - 1);
  if (activeRunCount === 0){
    updateAllButtonStates();
  }
}

