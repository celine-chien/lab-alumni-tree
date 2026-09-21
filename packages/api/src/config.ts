import { GetParametersCommand, SSMClient } from '@aws-sdk/client-ssm';

/**
 * 寫入驗證與管理密鑰。全部放後端：
 * - passphraseQuestion / passphraseAnswer：暗號題。答案若寫在前端 JS 裡等於公開。
 * - tokenSecret：答對後發的 token = HMAC(tokenSecret, 正規化答案)。換題或換 secret 即讓所有 token 失效。
 * - adminKey：管理者後門，與暗號不同的一組密鑰。
 *
 * 正式環境放 SSM Parameter Store（<SSM_PREFIX>/*，前綴由 CDK 依 site.config 注入環境變數），Lambda 啟動時讀取並快取 60 秒，
 * 改參數不必重新部署。本機開發從環境變數讀（.env）。
 */
export interface Secrets {
  passphraseQuestion: string;
  passphraseAnswer: string;
  tokenSecret: string;
  adminKey: string;
}

export type SecretsProvider = () => Promise<Secrets>;

export function envSecrets(): SecretsProvider {
  return async () => ({
    passphraseQuestion: process.env.PASSPHRASE_QUESTION ?? '實驗室名稱縮寫（三個大寫英文字）：',
    passphraseAnswer: process.env.PASSPHRASE_ANSWER ?? 'ABC',
    tokenSecret: process.env.TOKEN_SECRET ?? 'dev-token-secret',
    adminKey: process.env.ADMIN_KEY ?? 'dev-admin-key',
  });
}

export function ssmParamNames(prefix: string) {
  return {
    passphraseQuestion: `${prefix}/passphrase-question`,
    passphraseAnswer: `${prefix}/passphrase-answer`,
    tokenSecret: `${prefix}/token-secret`,
    adminKey: `${prefix}/admin-key`,
  } as const;
}

export function ssmSecrets(prefix = process.env.SSM_PREFIX ?? '/lab-alumni-tree', ttlMs = 60_000): SecretsProvider {
  const SSM_PARAM_NAMES = ssmParamNames(prefix);
  const ssm = new SSMClient({});
  let cached: { at: number; value: Secrets } | null = null;
  return async () => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.value;
    const r = await ssm.send(
      new GetParametersCommand({ Names: Object.values(SSM_PARAM_NAMES), WithDecryption: true }),
    );
    const byName = new Map((r.Parameters ?? []).map((p) => [p.Name!, p.Value ?? '']));
    const missing = Object.values(SSM_PARAM_NAMES).filter((n) => !byName.get(n));
    if (missing.length) throw new Error(`SSM 參數未設定：${missing.join(', ')}（請執行 pnpm secrets:init）`);
    const value: Secrets = {
      passphraseQuestion: byName.get(SSM_PARAM_NAMES.passphraseQuestion)!,
      passphraseAnswer: byName.get(SSM_PARAM_NAMES.passphraseAnswer)!,
      tokenSecret: byName.get(SSM_PARAM_NAMES.tokenSecret)!,
      adminKey: byName.get(SSM_PARAM_NAMES.adminKey)!,
    };
    cached = { at: Date.now(), value };
    return value;
  };
}
