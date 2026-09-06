# 職透 (JobSight) V3.3.22 — 後台管理功能部署說明

## v3.3.22 更新重點：修復「按鈕點了沒反應」的重大臭蟲
v3.3.21（及更早版本）有兩處程式碼完全沒有防護，只要其中任一狀況發生，就會讓整份 `index.html`
唯一的 `<script>` 區塊在執行到一半時直接被 JavaScript 例外中斷，導致**該行之後所有還沒來得及
註冊的按鈕事件（含 Google 登入按鈕本身）全部失效、點了毫無反應**：

1. **pdf.js 初始化未防呆**：`pdfjsLib.GlobalWorkerOptions.workerSrc = ...` 這一行直接假設
   pdf.js 的 CDN 腳本一定會成功載入。只要遇到廣告攔截器、瀏覽器隱私擴充功能、企業網路防火牆
   濾掉 `cdnjs.cloudflare.com`，或 CDN 短暫不穩，`pdfjsLib` 就會是 `undefined`，這行會立刻
   丟出例外，直接讓後面所有 `addEventListener`（拖拉上傳、每一顆「產生」按鈕、下載按鈕等）
   都沒有機會被執行。
2. **Google 登入（Netlify Identity）初始化未防呆**：`netlifyIdentity.init()` 在瀏覽器已有
   快取登入狀態時，會依官方文件記載「同步」立刻觸發 `init` 事件；只要這個事件處理過程中
   有任何一步出錯（例如 widget 腳本被瀏覽器擴充功能擋下、或 widget 本身既有的已知疊層錯誤），
   例外一樣會直接中斷腳本，而且因為這段程式碼在檔案最前面執行，甚至連「使用 Google 帳號登入」
   按鈕自己的點擊事件都還沒被綁定，所以看起來就是「登入按鈕點了完全沒反應」。

這兩個問題已對照 `hr-resume-matching-mvp`（PDF上傳資料正確穩定版）專案中同類型、已修復過的
`pdf.js CDN-load crash guard` 與 `Netlify Identity` 防呆寫法，在 v3.3.22 中一併補上：
- pdf.js 初始化改為 `typeof pdfjsLib !== 'undefined'` 判斷後才執行，載入失敗時只會停用
  PDF 解析功能，不影響其他按鈕。
- Google 登入初始化整段包進 `try/catch`，每個事件 callback 也各自有防護，任何一步出錯都只會
  印出 console 錯誤、不會波及其他功能；同時補上 `open`/`close` 事件的疊層防呆（與已知的
  `netlify-identity-widget #94 / #67` z-index 臭蟲相同修法），登入按鈕點擊時也一律會顯示
  備援直接跳轉連結，不會再卡在「毫無反應」的狀態。


## 這個壓縮檔裡有什麼
```
index.html                          ← 主程式（原本的單一 HTML 檔，改名為 index.html）
netlify.toml                        ← Netlify 建置設定（告訴 Netlify functions 資料夾在哪）
package.json                        ← 宣告 @netlify/blobs 套件，部署時 Netlify 會自動安裝
netlify/functions/record-login.mjs        ← 記錄登入事件（姓名/email/IP/時間/瀏覽器）
netlify/functions/upload-resume.mjs       ← 儲存使用者上傳的履歷 PDF 原始檔
netlify/functions/admin-data.mjs          ← 後台管理讀取清單（僅 felix670131@gmail.com 可用）
netlify/functions/admin-resume-file.mjs   ← 後台下載／刪除單一份履歷 PDF（僅管理者可用）
```

## 部署步驟
1. 把整個資料夾內容（含 `netlify` 資料夾）推到你原本的 GitHub repo，取代舊的檔案。
   - 如果你的 Netlify 網站原本是直接部署單一 HTML 檔（沒有用 GitHub），這次因為多了
     `netlify/functions` 資料夾，建議改成透過 GitHub repo 連接 Netlify 自動部署，
     這樣 Netlify 才能正確安裝 `@netlify/blobs` 並部署這些後台功能。
2. 部署完成後，不需要另外手動啟用 Netlify Blobs——只要有部署 Functions，Blobs 會自動可用，不需額外設定或額外費用（在一般用量下包含在 Netlify 的免費方案內）。
3. 確認 Site configuration → Identity 裡的 Google 登入設定維持原樣即可，不需要更動。

## 這次新增了什麼
- 只要有人用 Google 帳號登入，就會自動記錄一筆：中文姓名、Email、IP、時間、瀏覽器。
- 使用者上傳履歷 PDF 時，除了原本在瀏覽器內做文字解析外，也會把 PDF 原始檔另外存一份到 Netlify Blobs。
- 當登入帳號是 **felix670131@gmail.com** 時，畫面右上角會多一個「後台管理」按鈕，
  點開後可以看到所有人的登入紀錄，並在對應的履歷欄位「下載」或「刪除」該份 PDF
  （刪除後會釋放 Netlify Blobs 空間，且無法復原）。
- 其他帳號登入時完全看不到「後台管理」按鈕，且就算直接呼叫後台的網址／API，
  伺服器端也會檢查登入者的 email 是否等於 felix670131@gmail.com，不是的話一律拒絕（403）。
- 因為現在履歷 PDF 原始檔會被保存一份，頁尾原本「PDF 不會被儲存」的說明文字已經同步改成正確的說明。

## 已知限制 / 之後可以考慮的加強
- IP 位址是 Netlify 平台自動提供的來源 IP，若使用者是透過公司 VPN 或行動網路，看到的可能是共用 IP。
- 目前登入紀錄與履歷索引各自存成一個 JSON 檔案，在使用量很大（例如上千筆同時寫入）時理論上有極小機率互相覆寫；以目前預期的使用規模不會有實際影響，但若未來使用者暴增，可以考慮改成每筆一個獨立檔案的結構。
- 「中文姓名」欄位來自 Google 帳號本身填寫的姓名（`full_name`），如果使用者的 Google 帳號沒有填寫姓名，會顯示「（未提供）」。
