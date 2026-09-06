# 職透 (JobSight) V3.3.21 — 後台管理功能部署說明

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
