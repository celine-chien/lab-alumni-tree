import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * 站台設定：repo 根目錄的 site.config.json（進 git，放通用預設值）
 * 疊上 site.config.local.json（不進 git，放你這一站的實驗室名稱、stack 名稱、AWS 帳號）。
 * 只在 Node 端讀（Astro build、CDK synth、scripts）；瀏覽器端不會 import 這個檔。
 */
export interface SiteConfigInput {
  /** 例：王大明教授 */
  professorName: string;
  /** 例：影像處理實驗室 */
  labName: string;
  stackName: string;
  ssmPrefix: string;
  awsRegion: string;
  awsAccount: string | null;
}

export interface SiteConfig extends SiteConfigInput {
  /** 由 professorName + labName 組出來：「王大明教授影像處理實驗室校友族譜」，給 <title> 用；頁首則拆三行顯示 */
  siteTitle: string;
  siteDescription: string;
  stackName: string;
  ssmPrefix: string;
  awsRegion: string;
  awsAccount: string | null;
}

/** 從目前工作目錄往上找 site.config.json（Astro / CDK / scripts 的 cwd 都在 packages/* 底下）。bundler 會改寫 import.meta.url，所以不靠它。 */
export function findRepoRoot(from = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(resolve(dir, 'site.config.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`往上找不到 site.config.json（從 ${from} 開始）`);
    dir = parent;
  }
}

/**
 * CloudFront → API Gateway 的驗證 header 所用的秘密，放在 SSM <ssmPrefix>/origin-secret。
 * 由 secrets:init 建立、CDK 在 deploy 時讀出，同時塞給 CloudFront（自訂 origin header）與 Lambda（環境變數）。
 * Lambda 只在 header 對得上時才信任 CloudFront-Viewer-Address；直接打 API Gateway 原生網址的人偽造不了 IP，繞不過 rate limit。
 */
export function originSecretParamName(site: Pick<SiteConfigInput, 'ssmPrefix'>): string {
  return `${site.ssmPrefix}/origin-secret`;
}

const REQUIRED: (keyof SiteConfigInput)[] = ['professorName', 'labName', 'stackName', 'ssmPrefix', 'awsRegion'];

function readJson(path: string): Partial<SiteConfigInput> {
  if (!existsSync(path)) return {};
  const j = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  delete j.$schema;
  return j as Partial<SiteConfigInput>;
}

let cached: SiteConfig | null = null;

export function loadSiteConfig(root?: string): SiteConfig {
  if (cached) return cached;
  root ??= findRepoRoot();
  const merged = {
    awsAccount: null,
    ...readJson(resolve(root, 'site.config.json')),
    ...readJson(resolve(root, 'site.config.local.json')),
  } as SiteConfigInput;
  const missing = REQUIRED.filter((k) => !merged[k]);
  if (missing.length) throw new Error(`site.config.json 缺少欄位：${missing.join(', ')}`);
  if (!/^\/[A-Za-z0-9/_-]+$/.test(merged.ssmPrefix) || merged.ssmPrefix.endsWith('/')) {
    throw new Error(`ssmPrefix 格式不對（要像 /lab-alumni-tree）：${merged.ssmPrefix}`);
  }
  cached = {
    ...merged,
    siteTitle: `${merged.professorName}${merged.labName}校友族譜`,
    siteDescription: `${merged.professorName}${merged.labName}歷年研究生名單，由校友共同補充`,
  };
  return cached;
}
