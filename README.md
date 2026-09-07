# 職透 (JobSight) V3.3.44 — 後台管理功能部署說明

## v3.3.44 更新重點：後台管理表格「瀏覽器」欄位太長，撐爆版面

### 問題
後台管理跳出的視窗裡，登入紀錄表格的「瀏覽器」欄位直接顯示完整的 User-Agent 原始字串
（例如 `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...`），字串很長又設定
`word-break:break-all` 讓它整段換行顯示，導致每一列的高度被撐得非常高，管理者要一直往下滑
才能看完幾筆紀錄，版面很亂。

### 修法
- 新增 `summarizeUserAgent()`，把落落長的 User-Agent 字串轉換成精簡好讀的摘要，例如
  `Chrome 128 · Windows`、`Safari 17 · iOS`、`Firefox 128 · Linux`，只顯示瀏覽器名稱、
  主版本號、作業系統。
- 表格欄位改成單行顯示＋超出寬度用「…」省略（`white-space:nowrap` + `text-overflow:ellipsis`），
  不會再逐字換行撐高列高；把滑鼠移到欄位上（`title` 屬性）仍可看到完整原始 User-Agent 字串，
  之後真的需要逐字比對時不會遺失資訊。
- 「⚠️ 異常上傳」表格裡的「來源頁面」（Referer/Origin，通常也是一整串網址）比照辦理，
  同樣單行顯示＋省略號，滑鼠移上去看完整網址。

## v3.3.43 更新重點：不管有沒有登入，只要上傳履歷就記錄下來

### 為什麼要這樣改
v3.3.42 修好後台「一律未登入」的臭蟲之後，你希望能進一步確認：**登入牆本身有沒有其他漏洞、
能不能被繞過**。原本 `upload-resume.mjs` 的邏輯是「沒有有效登入身份就直接回傳 401、什麼都
不記錄」——這代表萬一真的有人繞過前端登入牆去呼叫這支 API，後台反而完全看不到任何蛛絲馬跡。

### 這次改了什麼
- `upload-resume.mjs`：不再因為沒有登入身份就拒絕存檔，改成**一律記錄**，並多存一個
  `verified`（是否通過有效的 Google 登入）欄位，以及 IP、瀏覽器（User-Agent）、來源頁面
  （Referer/Origin）等診斷資訊。
- 前端 `uploadResumeToServer()`：不再「沒有登入 Token 就直接放棄上傳呼叫」，一律送出，
  有 Token 就附上，沒有就讓後端標記為未驗證。
- 後台管理畫面：新增一個獨立的「⚠️ 異常上傳」區塊，把 `verified:false` 的紀錄
  （代表沒有通過登入驗證就成功上傳）跟正常使用者分開列出，附上 IP／瀏覽器／來源頁面，
  方便你比對是否真的有人繞過登入牆，或找出前端判斷邏輯還有哪裡沒堵住。

### 重要說明：這不是「降低安全性」
- 下載、刪除履歷、讀取後台清單這幾個管理功能，**仍然**只有 `felix670131@gmail.com`
  能用（`admin-data.mjs`、`admin-resume-file.mjs` 的權限檢查完全沒變）。
- 放寬的只有「上傳履歷」這個單一動作的記錄方式，目的是把potentially 繞過登入牆的行為
  「攤在陽光下」讓你看得到，而不是讓沒登入的人能存取別人的資料。
- 如果後台的「⚠️ 異常上傳」區塊之後真的出現資料，代表登入牆確實有辦法被繞過，
  屆時可以把對應的 IP／瀏覽器／來源頁面資訊交給我，我再往下追查前端登入判斷的漏洞。

## v3.3.42 更新重點：修復後台管理一律顯示「讀取失敗：未登入」

### 根本原因
`netlify/functions/` 底下四支 function（`admin-data.mjs`、`record-login.mjs`、
`upload-resume.mjs`、`admin-resume-file.mjs`）都是用新版（Modern / V2）的
`export default async (req, context)` 簽章撰寫，但判斷登入者身份時卻用了：

```js
const user = context.clientContext && context.clientContext.user;
```

這是**舊版（Lambda-compatible / V1，`exports.handler = async (event, context)`）**
才適用的寫法。Netlify 官方文件（[Use Identity in functions](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/use-identity-in-functions/)）
明確指出：V2 簽章下 `context.clientContext` **不會**自動帶入 Identity 使用者資料，
新版 function 要改用 `@netlify/identity` 套件的 `getUser()`。

也就是說：
- 這**不是** session 過期、也**不是** Netlify 平台本身不穩定造成的偶發問題，而是每一次
  呼叫都必然會回傳「未登入」的結構性問題——不管 Google 帳號有沒有登入成功、Token 新不新。
- 除了後台管理讀不到資料以外，**每次登入的紀錄（`record-login`）與使用者上傳的履歷 PDF
  備份（`upload-resume`）也同樣因為這個原因從未真正寫入過**，只是因為前端這兩支呼叫是
  「不影響主要功能」的背景動作、失敗時只印 console，畫面上完全看不出來，所以先前沒被發現。

### 修法
四支 function 都改用官方建議的 `@netlify/identity` 的 `getUser()` 取得登入者：

```js
import { getUser } from '@netlify/identity';
const user = await getUser(); // 自動讀取前端送來的 Authorization: Bearer <token>
```

並保留 `context.clientContext.user` 作為備援（`getUser()` 失敗或回傳空值時才會用到），
避免未來 Netlify 行為再調整時，整個後台又無預警失效。

`package.json` 已新增 `@netlify/identity` 相依套件，部署時 Netlify 會自動安裝，
不需要手動處理。

### 順便補上的防呆：自動重試一次
後台管理面板呼叫 `admin-data` 若收到 401，前端會**自動用強制刷新過的 Netlify Identity
Token 重試一次**，才會顯示「讀取失敗」。這是為了因應「Token 剛好在快過期的時間點被使用」
這種單純的時間差狀況，讓管理者不必手動登出再登入。（這次的「未登入」本身跟 Token 過期
無關，但這道防呆能避免以後真的遇到 Token 過期時又要重新走一次登入流程。）

### 部署時請注意：避免互蓋檔案
這次版本是獨立資料夾 `zhitou-jobsight-v3.3.42`，**不會**跟 v3.3.22 的檔案共用檔名之外的
任何東西。部署時請用這個版本**完整取代**舊版的所有檔案（`index.html`、`netlify.toml`、
`package.json`、整個 `netlify/functions/` 資料夾），不要只挑幾個檔案覆蓋，避免新舊版本的
`package.json`（相依套件不同）或 functions 混在一起造成部署失敗或行為不一致。


## 這個壓縮檔裡有什麼
```
index.html                          ← 主程式（原本的單一 HTML 檔，改名為 index.html）
netlify.toml                        ← Netlify 建置設定（告訴 Netlify functions 資料夾在哪）
package.json                        ← 宣告 @netlify/blobs、@netlify/identity 套件，部署時 Netlify 會自動安裝
netlify/functions/record-login.mjs        ← 記錄登入事件（姓名/email/IP/時間/瀏覽器）
netlify/functions/upload-resume.mjs       ← 儲存使用者上傳的履歷 PDF 原始檔
netlify/functions/admin-data.mjs          ← 後台管理讀取清單（僅 felix670131@gmail.com 可用）
netlify/functions/admin-resume-file.mjs   ← 後台下載／刪除單一份履歷 PDF（僅管理者可用）
```

## 部署步驟
1. 把整個資料夾內容（含 `netlify` 資料夾）推到你原本的 GitHub repo，**完整取代**舊版檔案
   （見上方「避免互蓋檔案」說明）。
   - 如果你的 Netlify 網站原本是直接部署單一 HTML 檔（沒有用 GitHub），這次因為多了
     `netlify/functions` 資料夾，建議改成透過 GitHub repo 連接 Netlify 自動部署，
     這樣 Netlify 才能正確安裝 `@netlify/blobs`、`@netlify/identity` 並部署這些後台功能。
2. 部署完成後，不需要另外手動啟用 Netlify Blobs——只要有部署 Functions，Blobs 會自動可用，
   不需額外設定或額外費用（在一般用量下包含在 Netlify 的免費方案內）。
3. 確認 Site configuration → Identity 裡的 Google 登入設定維持原樣即可，不需要更動。
4. 部署完成後，用 `felix670131@gmail.com` 重新登入一次（若瀏覽器已有舊的登入狀態，建議先
   登出再重新登入一次，確保拿到的是新的 Token），再打開「後台管理」確認能正常讀到資料。

## 這次新增了什麼
- 只要有人用 Google 帳號登入，就會自動記錄一筆：中文姓名、Email、IP、時間、瀏覽器
  （v3.3.42 前這個功能其實從未真正寫入成功，見上方「根本原因」說明）。
- 使用者上傳履歷 PDF 時，除了原本在瀏覽器內做文字解析外，也會把 PDF 原始檔另外存一份到
  Netlify Blobs（v3.3.42 前這個功能其實從未真正寫入成功，見上方「根本原因」說明）。
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
- v3.3.42 之前累積的登入紀錄與履歷備份，因為根本沒有寫入成功，Netlify Blobs 裡不會有任何
  歷史資料可以救回；後台管理看到的資料會從這次部署後才開始累積。
