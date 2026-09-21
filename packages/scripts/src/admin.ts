import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { loadSiteConfig } from '@vsp/shared/site-config';
import { cdkOutputs, parseArgs } from './common.js';

/**
 * 管理者後門：隱藏／恢復任何內容，不必改程式重新部署。
 *
 *   pnpm admin hide person <personId>
 *   pnpm admin hide groupPhoto <photoId>
 *   pnpm admin hide personPhoto <personId> <s3Key>
 *   pnpm admin unhide person <personId>
 *
 * API 位址：--api https://xxx.cloudfront.net，或自動讀 cdk-outputs.json；本機用 --api http://localhost:8787
 * 密鑰：環境變數 ADMIN_KEY，否則從 SSM <ssmPrefix>/admin-key 讀取（前綴見 site.config）
 */
const { flags, positional } = parseArgs(process.argv.slice(2));
const [action, target, id, s3Key] = positional;
if (!action || !target || !id || !['hide', 'unhide'].includes(action)) {
  console.error('用法：pnpm admin <hide|unhide> <person|groupPhoto|personPhoto> <id> [s3Key] [--api URL]');
  process.exit(1);
}
const api = String(flags.api ?? cdkOutputs().SiteUrl ?? '').replace(/\/$/, '');
if (!api) {
  console.error('找不到 API 位址：請加 --api 或先 deploy');
  process.exit(1);
}
let key = process.env.ADMIN_KEY;
if (!key) {
  const r = await new SSMClient({ region: loadSiteConfig().awsRegion }).send(
    new GetParameterCommand({ Name: `${loadSiteConfig().ssmPrefix}/admin-key`, WithDecryption: true }),
  );
  key = r.Parameter?.Value;
}
const res = await fetch(`${api}/api/admin/hide`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-admin-key': key ?? '' },
  body: JSON.stringify({ target, id, s3Key, action }),
});
console.log(res.status, await res.text());
