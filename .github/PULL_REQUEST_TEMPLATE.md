**改了什麼／為什麼**

**檢查**
- [ ] `pnpm typecheck && pnpm test` 通過
- [ ] 若動到 UI：手機寬度（≤ 400px）與深色模式看過
- [ ] 若動到 infra：`cdk diff` 沒有意外的資源替換（DynamoDB table、照片 bucket 不能被 replace）
- [ ] 沒有把實驗室專屬的字串或 AWS 帳號寫死（應放 `site.config.json` / `site.config.local.json`）
