# lab-alumni-tree — 實驗室校友族譜

[![CI](https://github.com/celine-chien/lab-alumni-tree/actions/workflows/ci.yml/badge.svg)](https://github.com/celine-chien/lab-alumni-tree/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

給大學實驗室用的**校友名錄網站**：依入實驗室年份列出歷屆學生，每人一張卡片（姓名、學位、論文、現況、個人照），每個年份可以掛團體照。
不需登入，校友答對一個「只有實驗室的人才知道」的暗號就能補資料；所有修改都有紀錄、可還原。
設計：字大、快、零操作門檻。

> **English:** A crowd-sourced alumni directory for a university research lab. Students are listed by the year they joined; anyone who answers a lab-insider passphrase can edit, every change is versioned and revertable. Static Astro front-end + a small Hono API on AWS Lambda/DynamoDB/S3, deployed with CDK. Copy `site.config.json`, run `pnpm deploy`, and you have your own. Docs are in Traditional Chinese; the code comments too. PRs welcome.


## 架你們實驗室自己的一站

需要：一個 AWS 帳號、[AWS CLI](https://aws.amazon.com/cli/) 已設好憑證、Node 22、pnpm 11（`corepack enable`）。
這個規模（幾百人、幾百張照片）**每月 AWS 費用接近 0 元**（DynamoDB / Lambda / API Gateway 都在免費額度內，CloudFront 與 S3 是幾塊錢台幣）。

```bash
git clone https://github.com/celine-chien/lab-alumni-tree.git
cd lab-alumni-tree
pnpm install

# 1. 站台設定：實驗室名稱、CloudFormation stack 名稱、region
cp site.config.json site.config.local.json
#    → 編輯 site.config.local.json（這個檔不進 git）

# 2. 確認 AWS 憑證指向正確的帳號
aws sts get-caller-identity

# 3. 第一次才需要：建立暗號等秘密參數、CDK bootstrap
pnpm secrets:init
pnpm --filter @vsp/infra exec cdk bootstrap

# 4. 部署（build 前端 + cdk deploy，約 3–5 分鐘）
pnpm deploy
```

跑完印出的 `SiteUrl` 就是網址（CloudFront 預設網域）。接著：

- **改暗號**：`pnpm secrets:init` 預設的答案是 `ABC`，一定要改（見下方「改暗號」）。
- **匯入既有名單**：見「CSV 匯入」。
- **自訂網域**：目前尚未內建，需自己在 CDK 加 ACM 憑證與 alias（歡迎 PR）。

### `site.config.json` 欄位

| 欄位 | 說明 |
| --- | --- |
| `professorName` | 教授名（含「教授」），頁首第一行，例：`王大明教授` |
| `labName` | 實驗室名稱，頁首第二行，例：`影像處理實驗室`。第三行固定是「校友族譜」；瀏覽器分頁標題與 `<meta description>` 由這兩欄組成 |
| `stackName` | CloudFormation stack 名稱。同一個 AWS 帳號架兩站要不同名 |
| `ssmPrefix` | 暗號等秘密的 SSM Parameter Store 路徑前綴，如 `/lab-alumni-tree` |
| `awsRegion` | 部署 region；`CDK_DEFAULT_REGION` 環境變數可覆蓋 |
| `awsAccount` | 選填。填了之後 deploy 與 `secrets:init` 會比對目前憑證的帳號，不符就中止 |

`site.config.json` 進 git、放通用預設值；`site.config.local.json` 不進 git、疊在上面。改任何一個都要重新 `pnpm deploy`。

## 架構

```
packages/
  shared/   型別、驗證 schema、personId 規則、暗號正規化、site.config 讀取（前後端共用）
  api/      Hono API。同一份程式：Lambda（DynamoDB + S3）／本機 dev（JSON 檔 + 本機資料夾）
  web/      Astro 靜態站 + Preact islands（首頁、編輯表單、合併畫面）
  infra/    AWS CDK：S3 + CloudFront、API Gateway + Lambda、DynamoDB 單表、照片 S3
  scripts/  CSV 匯入／匯出、備份、管理者後門、秘密參數初始化、本機假資料
```

每個設計決策的理由見 [SPEC.md](./SPEC.md)。

網址結構（CloudFront Function 改寫到靜態 HTML）：

| 路徑 | 說明 |
| --- | --- |
| `/` | 年份清單（唯一的瀏覽頁） |
| `/p/xxxxxx` | 同首頁，自動展開年份、開啟人物面板 |
| `/p/xxxxxx/edit` | 編輯表單 |
| `/new?year=1985` | 新增（年份預填） |
| `/p/xxxxxx/merge` | 合併重複資料 |
| `/api/*` | API（同網域，無 CORS） |
| `/photos/*` | 照片（S3 經 CloudFront） |

照片上傳走同網域 `POST /api/upload`（multipart，Lambda 寫入 S3），**不用 presigned URL**：iOS Safari 對跨網域 PUT S3 會出現「Load failed」，同網域完全避開 CORS。此規模經過 Lambda 的成本可忽略。

API Gateway 的原生網址是公開可達的，所以 CloudFront 打到 API 時會帶一個 `X-Origin-Verify` header（值放 SSM `<ssmPrefix>/origin-secret`，由 `secrets:init` 建立、CDK 部署時注入）。Lambda 只在這個 header 對得上時才採信 `CloudFront-Viewer-Address` 做 rate limit，繞過 CloudFront 直接打 API Gateway 的人偽造不了自己的 IP。

### 安全模型

寫入靠一個共享暗號 + 一組站長用的管理密鑰，沒有帳號系統；補救靠修改紀錄與軟刪除。這是刻意的取捨，細節與「哪些不在防護範圍」見 [SECURITY.md](./SECURITY.md)。網站上明確要求不要填任何聯絡方式或個資。

## 本機開發

```bash
pnpm install
pnpm --filter @vsp/scripts seed   # 可選：20 筆假資料
pnpm dev                    # API :8787 + Astro :4321（被占用時會往後找）
```

打開 http://localhost:4321 。本機暗號答案是 `ABC`、管理密鑰 `dev-admin-key`；想改就 `cp .env.example .env` 再編輯（沒有 `.env` 也能跑，用預設值）。
本機資料在 `.data/db.json`，照片在 `.data/photos/`，都不進 git。本機不讀 `site.config.local.json` 的 AWS 欄位，但標題會用。

```bash
pnpm test        # shared / api / scripts 的測試
pnpm typecheck
```

## 部署與更新

```bash
aws sts get-caller-identity   # 確認帳號
pnpm deploy                   # build 前端 + cdk deploy
```

`packages/infra/cdk-outputs.json`（不進 git）會被 scripts 讀取（table 名稱、網址）。
改程式後（或 `git pull` 拿到新版後）重新 `pnpm deploy` 即可；DynamoDB table 與照片 bucket 是 `RETAIN`，不會因為重新部署而消失。

### 移除站台

```bash
pnpm backup --store dynamo                 # 先留一份
pnpm --filter @vsp/infra exec cdk destroy  # 刪掉 stack
```

DynamoDB table 與照片 bucket 因為是 `RETAIN`，`cdk destroy` 之後仍留在帳號裡（會繼續產生極少量費用），確定不要了請到 AWS 主控台手動刪除；SSM 參數同理（`aws ssm delete-parameter`）。

### 改暗號／管理密鑰

`secrets:init` 會在 SSM Parameter Store（前綴 = `ssmPrefix`）建立五個參數：`passphrase-question`、`passphrase-answer`、`token-secret`、`admin-key`、`origin-secret`；已存在的不會覆蓋。前四個 Lambda 每 60 秒重讀，改了**不需重新部署**：

```bash
P=/lab-alumni-tree   # 換成你的 ssmPrefix
aws ssm put-parameter --name $P/passphrase-question --value "實驗室名稱縮寫（三個大寫英文字）：" --type String --overwrite
aws ssm put-parameter --name $P/passphrase-answer --value XYZ --type String --overwrite
aws ssm get-parameter --name $P/admin-key --with-decryption --query Parameter.Value --output text
```

換暗號會讓所有已發出的 token 失效（大家再答一次即可）。`origin-secret` 是 CloudFront ↔ API 之間的驗證值，改了要重新 `pnpm deploy` 才會生效。

## 維護

### 管理者後門：隱藏不當內容

```bash
pnpm admin hide person <personId>
pnpm admin hide groupPhoto <photoId>
pnpm admin hide personPhoto <personId> <s3Key>
pnpm admin unhide person <personId>
```

或直接 curl：`POST /api/admin/hide`，header `X-Admin-Key`，body `{ "target": "person", "id": "xxxxxx", "action": "hide" }`。
「現況」欄位被填了電話之類的，直接在網站上編輯清掉即可（有修改紀錄）。

### 備份

```bash
pnpm backup --store dynamo      # 整張表 dump 到 backups/
```

DynamoDB 也開了 point-in-time recovery。

### CSV 匯入（只由擁有者執行，網站上不提供）

```bash
cp packages/scripts/import.config.example.json import.config.json   # 依真實 CSV 改欄位對應
pnpm import --file data.csv --config import.config.json --store dynamo            # dry-run
pnpm import --file data.csv --config import.config.json --store dynamo --commit   # 寫入（先自動備份）
```

- 預設 dry-run，印出新增／更新／疑似重複與逐筆差異
- 有 `personId` 的列 → 更新；沒有 → 新增；沒有 id 但姓名＋入實驗室年命中既有資料 → 疑似重複，**不寫入**（要更新請填 personId；確定是不同人加 `--allow-duplicates`）
- 自動偵測 Big5 / UTF-8 BOM
- 論文系統「一列一本論文」格式：設定 `degree` / `thesisTitle` 欄位後會依姓名合併成一人，dry-run 會印出合併結果，請逐筆檢查
- 民國年：`yearFormat: "roc"`

### CSV 匯出（含 personId，可改完匯回）

```bash
pnpm export --out persons.csv --store dynamo
```

## 常見問題

- **`pnpm deploy` 說「目前 AWS 憑證指向帳號 …，但 site.config 指定 …」**：CLI 用錯 profile。`export AWS_PROFILE=xxx` 或把 `site.config.local.json` 的 `awsAccount` 改對。
- **`pnpm deploy` 說 `Unable to fetch parameters [/xxx/origin-secret]` 或參數不存在**：這是 2026-09 之後才加的參數。跑一次 `pnpm secrets:init`（只補缺的，不動既有值）再 deploy。
- **`cdk deploy` 抱怨沒有 bootstrap / `SSM parameter /cdk-bootstrap/...` not found**：每個帳號＋region 第一次都要跑 `pnpm --filter @vsp/infra exec cdk bootstrap`。
- **網站打開是空的、或 API 回 500**：Lambda 讀不到 SSM 參數。跑 `pnpm secrets:init` 建齊四個參數，60 秒內生效。
- **剛部署完網頁還是舊的**：CloudFront 快取。`pnpm deploy` 會自動 invalidate，但可能要等一兩分鐘；HTML 本身不快取，`_astro/` 底下的檔名有 hash。
- **`pnpm import` 說找不到 table**：需要 `packages/infra/cdk-outputs.json`（由 `pnpm deploy` 產生）。在另一台機器執行時加 `--table <TableName>`。
- **想換網域**：目前沒內建，要自己在 `packages/infra/lib/vsp-stack.ts` 的 `Distribution` 加 `certificate`（ACM，必須在 us-east-1）與 `domainNames`，再到 DNS 加 CNAME。

## 資料模型與 API

端點一覽與 DynamoDB 單表設計見 [SPEC.md 第 7 節](./SPEC.md#7-技術架構與-api)；欄位語意以 `packages/shared/src/types.ts` 的註解為準，驗證規則在 `schema.ts`，路由在 `packages/api/src/app.ts`。
