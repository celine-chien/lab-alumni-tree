import { randomBytes } from 'node:crypto';
import { GetParameterCommand, ParameterNotFound, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { loadSiteConfig, originSecretParamName } from '@vsp/shared/site-config';

/**
 * 建立正式環境的 SSM 參數（只建立不存在的，不會覆蓋既有值）。
 * 路徑前綴、region 來自 site.config；若設定了 awsAccount 會先比對目前憑證的帳號。
 *
 * 之後改暗號：
 *   aws ssm put-parameter --name <prefix>/passphrase-answer --value XYZ --type String --overwrite
 */
const site = loadSiteConfig();
const region = site.awsRegion;
const { Account: account } = await new STSClient({ region }).send(new GetCallerIdentityCommand({}));
if (site.awsAccount && account !== site.awsAccount) {
  console.error(`目前 AWS 憑證指向帳號 ${account}，但 site.config 指定 ${site.awsAccount}。請切換 profile。`);
  process.exit(1);
}
console.log(`帳號 ${account}，region ${region}，前綴 ${site.ssmPrefix}`);

const ssm = new SSMClient({ region });
const rand = (n: number) => randomBytes(n).toString('base64url').slice(0, n);

async function get(name: string, decrypt = false): Promise<string | null> {
  try {
    const r = await ssm.send(new GetParameterCommand({ Name: name, WithDecryption: decrypt }));
    return r.Parameter?.Value ?? null;
  } catch (e) {
    if (e instanceof ParameterNotFound) return null;
    throw e;
  }
}

async function putIfMissing(name: string, value: string, type: 'String' | 'SecureString') {
  if ((await get(name)) !== null) console.log(`已存在，略過：${name}`);
  else {
    await ssm.send(new PutParameterCommand({ Name: name, Value: value, Type: type }));
    console.log(`已建立：${name}`);
  }
}

const P = site.ssmPrefix;
await putIfMissing(`${P}/passphrase-question`, '實驗室名稱縮寫（三個大寫英文字）：', 'String');
await putIfMissing(`${P}/passphrase-answer`, 'ABC', 'String');
await putIfMissing(`${P}/token-secret`, rand(40), 'SecureString');
await putIfMissing(`${P}/admin-key`, rand(32), 'SecureString');
// CloudFront → API Gateway 驗證用。CDK 在 deploy 時以 AWS::SSM::Parameter::Value 解析，該型別不支援 SecureString，
// 只能用 String；外洩的後果僅是可偽造 IP 繞過 rate limit，換一個值再 deploy 即可。
await putIfMissing(originSecretParamName(site), rand(32), 'String');

console.log();
console.log(`目前的暗號答案：${await get(`${site.ssmPrefix}/passphrase-answer`)}`);
console.log(`管理密鑰：      ${await get(`${site.ssmPrefix}/admin-key`, true)}`);
console.log();
console.log('請把暗號題目與答案改成你們實驗室自己的：');
console.log(`  aws ssm put-parameter --region ${region} --name ${site.ssmPrefix}/passphrase-question --value "..." --type String --overwrite`);
console.log(`  aws ssm put-parameter --region ${region} --name ${site.ssmPrefix}/passphrase-answer --value XYZ --type String --overwrite`);
console.log('（Lambda 會在 60 秒內讀到新值，不需重新部署）');
