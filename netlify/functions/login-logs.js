// v3.2.2 新增：讀取登入紀錄清單（只有管理者能看）。
//
// 這支 API 給 App 裡的「登入紀錄」頁面呼叫。判斷「誰是管理者」的方式：
// 到 Netlify 後台 → Project configuration → Environment variables，新增一個
// 叫做 ADMIN_EMAILS 的變數，值填你自己的信箱（多個管理者用逗號分隔，例如
// "you@gmail.com,partner@gmail.com"）。只有登入信箱出現在這個清單裡的人，
// 呼叫這支 API 才拿得到資料，其他人一律收到「沒有權限」的錯誤訊息。
//
// 這支程式不需要你修改任何內容，只要照部署說明去 Netlify 後台設定
// ADMIN_EMAILS 這個環境變數即可。

const { getStore, connectLambda } = require("@netlify/blobs");

const MAX_RECORDS = 300;

// v3.4.12 缺失修復⑯：Netlify Blobs 的 list() 單次呼叫通常有回傳筆數上限，資料量
// 一旦超過這個上限，原本「呼叫一次 list() 就當作拿到全部」的寫法會漏掉沒抓到的
// 部分——而且是在還沒排序之前就漏了，不保證漏掉的剛好是舊資料。這裡補上一個共用
// 的輔助函式，用官方提供的 cursor（分頁代碼）迴圈抓完所有分頁，確保清單完整。
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

// v3.4.14 缺失修復（邏輯缺失1）：原本用 for...of 迴圈序列讀取每一筆資料，
// 筆數一多（例如 300 筆登入紀錄）就是 300 次依序等待的網路請求，容易超過
// Netlify Function 的執行時間上限而整個逾時。改成有限並行度（一次最多同時
// 20 個請求）平行讀取——比完全序列快很多，又不會像「無上限一次全部平行送出」
// 那樣可能把儲存服務或函式自己的連線數瞬間打爆。
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

exports.handler = async (event, context) => {
  // v3.2.3 修復：Lambda 相容模式必須先呼叫 connectLambda(event) 才能用 Netlify Blobs，
  // 否則會出現 MissingBlobsEnvironmentError（詳見 data.js 裡的說明）。
  connectLambda(event);

  if (event.httpMethod !== "GET") {
    return jsonResponse(405, { error: "不支援的方法" });
  }

  const user = context.clientContext && context.clientContext.user;
  if (!user || !user.sub) {
    return jsonResponse(401, { error: "尚未登入。" });
  }

  const adminEmails = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map(function (s) { return s.trim().toLowerCase(); })
    .filter(Boolean);

  if (adminEmails.length === 0) {
    return jsonResponse(403, {
      error: "尚未設定管理者名單。請到 Netlify 後台 Project configuration → Environment variables，" +
        "新增 ADMIN_EMAILS（值填你的登入信箱），存檔後重新部署一次網站即可。",
    });
  }

  const myEmail = (user.email || "").toLowerCase();
  if (adminEmails.indexOf(myEmail) === -1) {
    return jsonResponse(403, { error: "你的帳號沒有查看登入紀錄的權限。" });
  }

  let store;
  try {
    store = getStore("lifecompass-login-logs");
  } catch (err) {
    return jsonResponse(500, { error: "儲存空間初始化失敗：" + describeError(err) });
  }

  try {
    const blobs = await listAllBlobs(store);
    let keys = blobs.map(function (b) { return b.key; });
    // key 的開頭是時間戳記字串，字串排序（由大到小）就等於「由新到舊」的時間排序。
    keys.sort().reverse();
    keys = keys.slice(0, MAX_RECORDS);

    const raws = await mapWithConcurrency(keys, 20, function (key) {
      return store.get(key).catch(function () { return null; });
    });
    const records = [];
    for (const raw of raws) {
      if (!raw) continue;
      try { records.push(JSON.parse(raw)); } catch (e) { /* 單筆解析失敗就跳過 */ }
    }
    return jsonResponse(200, { records: records });
  } catch (err) {
    return jsonResponse(500, { error: "讀取登入紀錄失敗：" + describeError(err) });
  }
};

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
