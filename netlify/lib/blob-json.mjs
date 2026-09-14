// netlify/lib/blob-json.mjs
// 共用工具：用「條件式寫入 (ETag / onlyIfMatch)」安全地讀取→修改→寫回 Netlify Blobs
// 裡的 JSON 資料，避免兩個請求前後腳同時讀到舊資料、各自修改後互相覆蓋，
// 導致其中一筆紀錄（登入紀錄／履歷索引）憑空消失。
//
// v3.3.46 新增：修復「後台資料寫入沒有防止衝突，可能互蓋」的問題。
//
// 注意：這個檔案刻意放在 netlify/lib/ 而不是 netlify/functions/ 裡面，是延續
// v3.3.42 註解裡提到的既有考量——避免 Netlify 把 functions 目錄底下多出來的檔案
// 誤判成另一個新的 function 端點。esbuild 打包時仍會把這裡的程式碼正常一起
// 打進呼叫它的那支 function 裡，不影響任何一支 function 的部署與執行。

const MAX_RETRIES = 5;

/**
 * 以「條件式寫入 + 失敗重試」的方式，安全地修改一份存在 Netlify Blobs 裡的 JSON 陣列。
 *
 * @param {import('@netlify/blobs').Store} store 已經取得的 Netlify Blobs store
 * @param {string} key 資料的 key
 * @param {(current: any[]) => any[]} mutate 接收目前的陣列，回傳修改後的新陣列
 * @returns {Promise<any[]>} 最終成功寫入的陣列內容
 */
export async function mutateJsonWithRetry(store, key, mutate) {
  let lastErr = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let current = [];
    let etag = null;

    try {
      const entry = await store.getWithMetadata(key, { type: 'json' });
      if (entry) {
        current = Array.isArray(entry.data) ? entry.data : [];
        etag = entry.etag || null;
      }
    } catch (e) {
      lastErr = e;
      // 讀取失敗（例如第一次使用、key 還不存在），當作空陣列繼續往下嘗試。
    }

    const next = mutate(current);

    try {
      const writeOpts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
      const result = await store.setJSON(key, next, writeOpts);
      // 較新版本的 @netlify/blobs 會回傳 { modified, etag }；modified === false
      // 代表寫入當下資料已經被別人改過，需要重新讀最新版本再試一次。
      // 若目前用的版本沒有這個欄位（result 是 undefined 或沒有 modified），
      // 視為寫入成功，行為與修改前一致，只是暫時沒有衝突保護。
      if (!result || result.modified !== false) {
        return next;
      }
    } catch (e) {
      lastErr = e;
      // onlyIfNew 在 key 已存在時、或 onlyIfMatch 版本不符時，部分版本會直接丟例外，
      // 同樣視為衝突，重新讀取最新版本再試一次。
    }
  }

  throw new Error(
    `寫入 ${key} 時發生多次資料衝突，請稍後再試` + (lastErr ? `（${lastErr.message}）` : '')
  );
}
