// v3.4.12 缺失修復⑬：「團隊脈動」共享儲存的真正後端 API。
//
// 背景：v3.4.11（含）以前的版本，前端的 storageGetShared／storageSetShared／
// storageListShared／storageDeleteShared 只認得 window.storage 這個物件——
// 那其實是 Claude Artifact 預覽環境專屬的暫存空間，不是真正部署到 Netlify 網站
// 後會存在的東西。個人測驗資料另外有一整套「先試 Netlify 後端、沒有才退回本機」
// 的備援機制，但團隊脈動的共享資料完全沒有走這條路，也沒有對應的後端程式可以
// 呼叫——導致這支功能只有在 Claude 對話視窗裡預覽時看起來會動，一旦真的照著
// 部署教學上傳到 Netlify，「分享我的匿名摘要」會一直失敗，「查看團隊聚合」也
// 永遠是 0 人。
//
// 這支程式補上真正能在 Netlify 正式環境運作的共享儲存後端。
//
// 存取設計（配合前端既有「團隊代碼＝雙方約定的字串，非帳號系統」的定位）：
// 不要求 Netlify Identity 登入——任何人只要知道正確的團隊代碼，就能讀寫該代碼
// 底下的資料，這跟前端畫面上「本 Beta 版沒有帳號系統，正式企業導入建議改用
// 組織帳號與存取控制」的但書一致，不是這支程式額外造成的風險。同時做三個
// 基本防護，避免這支不需要登入的公開端點被拿去做其他用途：
//   ① 所有讀寫的 key、以及 list() 的 prefix，都強制要求以 "teampulse:" 開頭，
//      不符合就直接拒絕，確保這支程式只能碰得到團隊脈動自己的資料。
//   ② 單筆資料大小上限 20KB（一個人的匿名摘要不可能這麼大），避免被濫用塞爆
//      儲存空間或當成任意檔案儲存服務。
//   ③ 跟其他後端函式一樣，任何非預期錯誤都回傳看得懂的中文說明，不會讓整個
//      團隊脈動頁面因為單一請求失敗就整個壞掉。
//
// 你不需要修改這支檔案的任何內容，照著部署說明操作即可正常運作——不需要另外
// 設定環境變數，因為這支功能本來就不要求登入。

const { getStore, connectLambda } = require("@netlify/blobs");

const KEY_PREFIX = "teampulse:";
const MIN_TEAM_CODE_LEN = 6; // 跟前端 sanitizeTeamCode 的最低長度要求一致

// v3.4.14 缺失修復（邏輯缺失2）：原本只檢查 prefix 是否以 "teampulse:" 開頭，
// 沒檢查後面有沒有接完整的團隊代碼——直接拿 prefix="teampulse:" 呼叫，會列出
// 「所有」團隊的代碼與提交紀錄，等於繞過「團隊代碼即存取邊界」的設計。這裡額外
// 要求 prefix 必須以冒號結尾、且中間的代碼長度至少 6 碼，才視為合法的單一團隊查詢。
function isValidTeamPrefix(prefix) {
  if (prefix.indexOf(KEY_PREFIX) !== 0) return false;
  if (prefix.charAt(prefix.length - 1) !== ":") return false;
  const codePart = prefix.slice(KEY_PREFIX.length, -1);
  return codePart.length >= MIN_TEAM_CODE_LEN;
}
// 單一 key 的合法結構是 "teampulse:<代碼>:<提交id>"，同樣要求代碼長度合規，
// 避免格式不符預期的 key 被寫入或讀取（防禦性檢查，跟前端的 key 組成方式一致）。
function isValidTeamKey(key) {
  if (key.indexOf(KEY_PREFIX) !== 0) return false;
  const rest = key.slice(KEY_PREFIX.length);
  const parts = rest.split(":");
  return parts.length >= 2 && parts[0].length >= MIN_TEAM_CODE_LEN;
}
const MAX_VALUE_BYTES = 20000;

exports.handler = async (event, context) => {
  connectLambda(event);

  if (["GET", "POST", "DELETE"].indexOf(event.httpMethod) === -1) {
    return jsonResponse(405, { error: "不支援的方法" });
  }

  let store;
  try {
    store = getStore("lifecompass-teampulse");
  } catch (err) {
    return jsonResponse(500, { error: "儲存空間初始化失敗：" + describeError(err) });
  }

  const qs = event.queryStringParameters || {};

  // ---- GET + list：列出某個團隊代碼底下的所有 key ----
  if (event.httpMethod === "GET" && qs.list) {
    const prefix = String(qs.prefix || "");
    if (!isValidTeamPrefix(prefix)) return jsonResponse(400, { error: "prefix 格式不正確，必須是完整的團隊代碼（至少6碼）加冒號" });
    try {
      const blobs = await listAllBlobs(store, { prefix: prefix });
      return jsonResponse(200, { keys: blobs.map(function (b) { return b.key; }) });
    } catch (err) {
      return jsonResponse(500, { error: "讀取清單失敗：" + describeError(err) });
    }
  }

  // ---- GET：讀取單一 key ----
  if (event.httpMethod === "GET") {
    const key = String(qs.key || "");
    if (!isValidTeamKey(key)) return jsonResponse(400, { error: "缺少或不合法的 key 參數" });
    try {
      const raw = await store.get(key);
      return jsonResponse(200, { value: raw ? JSON.parse(raw) : null });
    } catch (err) {
      return jsonResponse(500, { error: "讀取資料失敗：" + describeError(err) });
    }
  }

  // ---- DELETE：刪除單一 key（使用者自己移除分享） ----
  if (event.httpMethod === "DELETE") {
    const key = String(qs.key || "");
    if (!isValidTeamKey(key)) return jsonResponse(400, { error: "缺少或不合法的 key 參數" });
    try {
      await store.delete(key);
      return jsonResponse(200, { ok: true });
    } catch (err) {
      return jsonResponse(500, { error: "刪除資料失敗：" + describeError(err) });
    }
  }

  // ---- POST：寫入單一 key ----
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return jsonResponse(400, { error: "請求格式錯誤，body 必須是合法的 JSON" });
  }
  const key = String(body.key || "");
  if (!isValidTeamKey(key)) return jsonResponse(400, { error: "缺少或不合法的 key 參數" });
  const serialized = JSON.stringify(body.value === undefined ? null : body.value);
  /* v3.4.14 缺失修復（邏輯缺失5）：原本用 serialized.length（字元數）比對大小上限，
     這個 App 內容以中文為主，中文字在真正的 UTF-8 位元組數通常是3個位元組，
     用字元數當替代品，對中文內容而言實際能通過的位元組數可能是設定值的2~3倍。
     改用 TextEncoder 算出真正的 UTF-8 位元組數再比對。 */
  const byteLength = Buffer.byteLength(serialized, "utf8");
  if (byteLength > MAX_VALUE_BYTES) {
    return jsonResponse(413, { error: "資料過大，超過單筆上限" });
  }
  try {
    await store.set(key, serialized);
    return jsonResponse(200, { ok: true });
  } catch (err) {
    return jsonResponse(500, { error: "寫入資料失敗：" + describeError(err) });
  }
};

// 說明同 login-logs.js／audit-log.js／admin-userdata.js：Netlify Blobs 的
// list() 單次呼叫可能有回傳筆數上限，用 cursor 迴圈抓完所有分頁，確保清單完整。
async function listAllBlobs(store, options) {
  let blobs = [];
  let cursor;
  do {
    const result = await store.list(Object.assign({}, options || {}, cursor ? { cursor: cursor } : {}));
    blobs = blobs.concat((result && result.blobs) || []);
    cursor = result && result.cursor;
  } while (cursor);
  return blobs;
}

function jsonResponse(statusCode, bodyObj) {
  return {
    statusCode: statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  };
}

function describeError(err) {
  return err && err.message ? err.message : String(err);
}
