// v3.2.5 新增：讓管理者查看「所有使用者」的測驗／打卡／整合報告等資料
// （不只是登入紀錄），給 App 裡新增的「👥 使用者資料」管理頁面呼叫。
//
// 資料來源：
//   ① lifecompass-user-data —— data.js 平常在用的 store，每筆資料的 key
//      格式是 "userId/資料項目名稱"（例如 "abc123/lifecompass:integration"）。
//      這支程式把整個 store list 出來，依「/」前面的 userId 分組，
//      就能還原出「每個使用者存了哪些資料、內容是什麼」。
//   ② lifecompass-login-logs —— log-login.js 平常在用的 store，用來反查
//      每個 userId 對應的 email／姓名／最近登入時間，單純是為了讓管理畫面
//      看得懂「這是誰」，不影響權限判斷。
//
// 權限判斷方式跟 login-logs.js 完全一樣：比對登入者 email 是否出現在
// Netlify 環境變數 ADMIN_EMAILS 裡（逗號分隔），不是管理者一律回傳 403，
// 不會拿到任何其他使用者的資料。
//
// v3.2.9 新增：
//   ① GET 加上 ?download=1&userId=xxx 這兩個查詢參數時，改成只回傳「單一
//      使用者」的完整資料，並附上 Content-Disposition 標頭讓瀏覽器直接
//      當成檔案下載，不用再靠前端自己組 Blob（前端目前仍是用這種方式做
//      下載，這支後端的下載模式是保留給未來或其他呼叫端使用的等價能力）。
//   ② 新增 DELETE 方法：?userId=xxx 刪除該使用者「全部」資料，或加上
//      ?item=xxx 只刪除該使用者的單一資料項目。刪除前一樣要通過上面的
//      管理者權限檢查。
//   ③ 不論是「瀏覽清單」「下載」「刪除」，這支程式都會在成功之後於伺服器端
//      補寫一筆稽核紀錄到 lifecompass-audit-log（與 track.js 共用同一個
//      store），紀錄管理者是誰、對哪個使用者做了什麼操作、什麼時間——
//      就算前端程式碼被繞過或呼叫端沒有另外呼叫 track.js，後端這裡還是會
//      留下紀錄，確保「使用者資料的瀏覽／下載／刪除」一定查得到軌跡。

const { getStore, connectLambda } = require("@netlify/blobs");

const MAX_USERS = 500; // 保險上限，避免使用者數量異常暴增時單次回應過大/過慢

// v3.4.12 缺失修復⑯：說明同 login-logs.js／audit-log.js——list() 單次呼叫可能有
// 回傳筆數上限，用 cursor 迴圈抓完所有分頁，確保清單完整（這支程式裡的四處
// store.list() 呼叫都改用這個輔助函式）。
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

// v3.4.14 缺失修復（邏輯缺失1）：這支程式裡原本有 4 處用 for...of 序列讀取/刪除，
// 使用者數量或資料筆數一多，就是幾百到幾千次依序等待的網路請求，很容易超過
// Netlify Function 的執行時間上限。改成有限並行度（一次最多同時20個）處理，
// 大幅縮短總等待時間，又不會像「無上限一次全部平行送出」那樣可能瞬間打爆
// 儲存服務或函式自己的連線數。
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
  // Lambda 相容模式必須先呼叫 connectLambda(event) 才能用 Netlify Blobs
  // （原因同 data.js／login-logs.js 裡的說明，否則會出現 MissingBlobsEnvironmentError）。
  connectLambda(event);

  if (event.httpMethod !== "GET" && event.httpMethod !== "DELETE") {
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
    return jsonResponse(403, { error: "你的帳號沒有查看使用者資料的權限。" });
  }

  let dataStore, logStore;
  try {
    dataStore = getStore("lifecompass-user-data");
    logStore = getStore("lifecompass-login-logs");
  } catch (err) {
    return jsonResponse(500, { error: "儲存空間初始化失敗：" + describeError(err) });
  }

  const qs = event.queryStringParameters || {};

  // ---- DELETE：管理者刪除某位使用者的全部（或單一項目）資料 ----
  if (event.httpMethod === "DELETE") {
    const targetUserId = qs.userId;
    if (!targetUserId) return jsonResponse(400, { error: "缺少 userId 參數" });

    try {
      const keysToDelete = (await listAllBlobs(dataStore, { prefix: targetUserId + "/" })).map(function (b) { return b.key; });

      if (qs.item) {
        const singleKey = targetUserId + "/" + qs.item;
        if (keysToDelete.indexOf(singleKey) === -1) {
          return jsonResponse(404, { error: "找不到這筆資料項目。" });
        }
        await dataStore.delete(singleKey);
        await writeAuditRecord(myEmail, user, event, "admin_delete_userdata", targetUserId, "刪除單一項目：" + qs.item);
        return jsonResponse(200, { ok: true, deletedCount: 1 });
      }

      await mapWithConcurrency(keysToDelete, 20, function (key) { return dataStore.delete(key); });
      await writeAuditRecord(myEmail, user, event, "admin_delete_userdata", targetUserId, "刪除該使用者全部資料，共 " + keysToDelete.length + " 筆");
      return jsonResponse(200, { ok: true, deletedCount: keysToDelete.length });
    } catch (err) {
      return jsonResponse(500, { error: "刪除使用者資料失敗：" + describeError(err) });
    }
  }

  // ---- GET + download：管理者下載單一使用者的完整資料 ----
  if (qs.download && qs.userId) {
    const targetUserId = qs.userId;
    try {
      const keys = (await listAllBlobs(dataStore, { prefix: targetUserId + "/" })).map(function (b) { return b.key; });
      const dataObj = {};
      const rawResults = await mapWithConcurrency(keys, 20, function (fullKey) {
        return dataStore.get(fullKey).catch(function () { return null; });
      });
      keys.forEach(function (fullKey, i) {
        const itemName = fullKey.slice(targetUserId.length + 1);
        try { dataObj[itemName] = rawResults[i] ? JSON.parse(rawResults[i]) : null; }
        catch (e) { dataObj[itemName] = null; }
      });
      await writeAuditRecord(myEmail, user, event, "admin_download_userdata", targetUserId, "管理者下載使用者資料");
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": "attachment; filename=\"lifecompass-user-" + encodeURIComponent(targetUserId) + ".json\"",
        },
        body: JSON.stringify({ userId: targetUserId, exportedAt: new Date().toISOString(), data: dataObj }, null, 2),
      };
    } catch (err) {
      return jsonResponse(500, { error: "下載使用者資料失敗：" + describeError(err) });
    }
  }

  // 第一步：把登入紀錄整理成 userId -> { email, name, lastLoginTs } 的對照表，
  // 同一個 userId 可能登入很多次，只保留時間最新的一筆。
  const identityMap = {};
  try {
    const logKeys = (await listAllBlobs(logStore)).map(function (b) { return b.key; });
    const logRaws = await mapWithConcurrency(logKeys, 20, function (key) {
      return logStore.get(key).catch(function () { return null; });
    });
    for (const raw of logRaws) {
      try {
        if (!raw) continue;
        const rec = JSON.parse(raw);
        if (!rec || !rec.userId) continue;
        const prev = identityMap[rec.userId];
        if (!prev || (rec.ts && rec.ts > prev.lastLoginTs)) {
          identityMap[rec.userId] = {
            email: rec.email || "",
            name: rec.name || "",
            lastLoginTs: rec.ts || "",
          };
        }
      } catch (e) {
        // 單筆壞資料跳過，不影響其他人
      }
    }
  } catch (err) {
    // 登入紀錄讀取失敗不影響主要功能（使用者資料），忽略即可，
    // 畫面上該使用者就只會顯示 userId、看不到 email／姓名。
  }

  // 第二步：把使用者資料 store 依 userId 分組。
  try {
    const allKeys = (await listAllBlobs(dataStore)).map(function (b) { return b.key; });

    const grouped = {}; // userId -> [ 完整 key, ... ]
    for (const fullKey of allKeys) {
      const slashIdx = fullKey.indexOf("/");
      if (slashIdx === -1) continue; // 理論上不會發生，保險略過
      const userId = fullKey.slice(0, slashIdx);
      (grouped[userId] = grouped[userId] || []).push(fullKey);
    }

    let userIds = Object.keys(grouped);
    // 讓最近登入過的使用者排前面，方便管理者優先查看。
    userIds.sort(function (a, b) {
      const ta = (identityMap[a] && identityMap[a].lastLoginTs) || "";
      const tb = (identityMap[b] && identityMap[b].lastLoginTs) || "";
      return tb.localeCompare(ta);
    });
    userIds = userIds.slice(0, MAX_USERS);

    const users = [];
    /* 把「每位使用者 × 每個資料欄位」攤平成單一清單一次平行讀取，取代原本的
       雙層序列迴圈（使用者數 × 欄位數，可能是幾百到幾千次依序等待）。 */
    const flatTasks = [];
    for (const userId of userIds) {
      for (const fullKey of grouped[userId]) {
        flatTasks.push({ userId: userId, fullKey: fullKey });
      }
    }
    const flatRaws = await mapWithConcurrency(flatTasks, 20, function (task) {
      return dataStore.get(task.fullKey).catch(function () { return null; });
    });
    const dataObjByUser = {};
    flatTasks.forEach(function (task, i) {
      const itemName = task.fullKey.slice(task.userId.length + 1);
      const obj = (dataObjByUser[task.userId] = dataObjByUser[task.userId] || {});
      try { obj[itemName] = flatRaws[i] ? JSON.parse(flatRaws[i]) : null; }
      catch (e) { obj[itemName] = null; }
    });
    for (const userId of userIds) {
      const idInfo = identityMap[userId] || {};
      users.push({
        userId: userId,
        email: idInfo.email || "",
        name: idInfo.name || "",
        lastLoginTs: idInfo.lastLoginTs || "",
        data: dataObjByUser[userId] || {},
      });
    }

    // v3.2.9 新增：管理者打開「使用者資料」清單這件事本身也留一筆稽核紀錄
    // （不帶特定 target，代表「瀏覽了整份清單」，不是針對單一使用者）。
    await writeAuditRecord(myEmail, user, event, "admin_view_userdata", "", "管理者開啟使用者資料清單，共 " + Object.keys(grouped).length + " 位使用者");

    return jsonResponse(200, { users: users, totalUserCount: Object.keys(grouped).length });
  } catch (err) {
    return jsonResponse(500, { error: "讀取使用者資料失敗：" + describeError(err) });
  }
};

// v3.2.9 新增：把「管理者做了什麼操作」寫進 lifecompass-audit-log
// （跟 track.js 寫入同一個 store，讓「操作紀錄」頁面能統一顯示）。
// 這裡的失敗一律吞掉，絕不能因為稽核紀錄寫不進去，就連帶讓管理者原本要做的
// 瀏覽／下載／刪除操作也失敗。
async function writeAuditRecord(myEmail, user, event, action, target, detail) {
  try {
    const { getStore: getStoreInner } = require("@netlify/blobs");
    const auditStore = getStoreInner("lifecompass-audit-log");
    const meta = (user && user.user_metadata) || {};
    const record = {
      ts: new Date().toISOString(),
      action: action,
      target: target || "",
      detail: detail || "",
      anonId: "",
      userId: (user && user.sub) || "",
      name: meta.full_name || meta.name || "",
      email: myEmail || (user && user.email) || "",
      provider: "admin-panel",
      ip: (event.headers && (event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"])) || "",
      userAgent: (event.headers && event.headers["user-agent"]) || "",
    };
    const key = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    await auditStore.set(key, JSON.stringify(record));
  } catch (err) {
    // 安靜失敗，不影響主要操作。
  }
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
