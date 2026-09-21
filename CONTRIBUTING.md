# 參與開發 / Contributing

謝謝你想幫忙。這個專案的目標是**讓任何一個實驗室都能在一小時內架起自己的校友族譜**，所以改動的原則是：通用優先、簡單優先、教授用舊手機也要順。

## 開發環境

需要 Node 22 與 pnpm 11（`corepack enable` 即可）。

```bash
pnpm install
cp .env.example .env
pnpm --filter @vsp/scripts seed   # 20 筆假資料
pnpm dev                          # API :8787 + 前端 :4321
```

送 PR 前：

```bash
pnpm typecheck
pnpm test
pnpm --filter @vsp/web build
```

## 專案結構

見 [README](./README.md#架構)。規格與設計決策在 [SPEC.md](./SPEC.md)，改行為前先看那裡有沒有寫理由。

## 開 issue

- 錯誤請附：怎麼重現、手機／瀏覽器、是自己部署的站還是本機。
- 功能建議請先想「別的實驗室也需要嗎」。實驗室專屬的東西（欄位、文案）建議 fork 後自己改，或提議做成 `site.config.json` 的選項。

## 送 PR

- 一個 PR 做一件事。
- 不要把實驗室名稱、AWS 帳號、網址寫死在程式裡；那些屬於 `site.config.local.json`。
- 動到資料模型（`packages/shared/src/types.ts`）要一併更新 zod schema、DynamoDB store、CSV 匯入匯出與測試。
- 動到 infra 請貼 `cdk diff` 摘要；DynamoDB table 與照片 bucket 是 `RETAIN`，任何會 replace 它們的改動都不能合併。
- UI 改動請在手機寬度與深色模式下看過。字級不要縮小——使用者是退休教授。
- Commit message 用什麼語言都可以，說清楚「為什麼」比「改了什麼」重要。

## 行為準則

參與即表示同意 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)。

## 授權

你的貢獻會以 [MIT](./LICENSE) 授權釋出。
