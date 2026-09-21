# Security Policy

## 回報漏洞 / Reporting a vulnerability

請**不要**開公開 issue。請用 GitHub 的 private vulnerability reporting（repo 的 Security 分頁 → Report a vulnerability），或直接聯絡 maintainer。
我們會在 7 天內回覆，修好後在 release note 註明。

Please **do not** open a public issue. Use GitHub private vulnerability reporting (Security tab → Report a vulnerability). We aim to respond within 7 days.

## 威脅模型 / Threat model

這個專案是給**信任的小圈子**（一個實驗室的校友）共同編輯的公開網站，設計上刻意簡單：

- 讀取完全公開，不需登入。
- 寫入靠一個**共享暗號**（實驗室內部才知道的問題）換取 token；再加一組獨立的**管理密鑰**給站長隱藏內容用。
- 沒有帳號、沒有個人權限：任何知道暗號的人都能改所有人的資料。
- 補救機制是**所有修改都有紀錄、可還原**，照片一律軟刪除；DynamoDB 開 point-in-time recovery。

因此以下**不在**防護範圍內，回報前請先確認不是設計如此：

- 知道暗號的人惡意編輯（靠還原與管理密鑰處理）
- 暗號外流（換暗號即讓所有 token 失效，見 README）
- 上傳的照片肖像權（由上傳者負責，站長可隱藏）

以下**屬於**我們想知道的問題：

- 不知道暗號也能寫入、繞過 rate limit、或取得管理密鑰
- 上傳處理（圖片解析、大小限制、路徑）可被利用
- 依賴套件的已知漏洞（Dependabot 會開 PR，也歡迎回報）
- CDK 建出來的資源權限過寬
