import { App } from 'aws-cdk-lib';
import { loadSiteConfig } from '@vsp/shared/site-config';
import { VspStack } from '../lib/vsp-stack.js';

/**
 * stack 名稱、region、SSM 前綴都來自 site.config.json（疊上 site.config.local.json）。
 * 帳號取自目前 CLI 憑證（CDK_DEFAULT_ACCOUNT）；若設定檔有填 awsAccount 則必須一致，避免部署到錯的帳號。
 */
const site = loadSiteConfig();
const account = process.env.CDK_DEFAULT_ACCOUNT;
if (site.awsAccount && account && account !== site.awsAccount) {
  throw new Error(`目前 AWS 憑證指向帳號 ${account}，但 site.config 指定 ${site.awsAccount}。請切換 profile。`);
}
const app = new App();
new VspStack(app, site.stackName, {
  env: { account: site.awsAccount ?? account, region: process.env.CDK_DEFAULT_REGION ?? site.awsRegion },
  description: `${site.siteTitle}：S3+CloudFront 靜態站、API Gateway+Lambda、DynamoDB 單表、照片 S3`,
  site,
});
