import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { SiteConfig } from '@vsp/shared/site-config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

export interface VspStackProps extends StackProps {
  site: SiteConfig;
}

export class VspStack extends Stack {
  constructor(scope: Construct, id: string, props: VspStackProps) {
    const { site, ...stackProps } = props;
    super(scope, id, stackProps);

    /* ---------- DynamoDB 單表（見 SPEC 第 7 節與 api/src/store/dynamo.ts） ---------- */
    const table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });
    table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
    });

    /* ---------- S3：靜態站 + 照片（皆私有，經 CloudFront OAC 讀取） ---------- */
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const photosBucket = new s3.Bucket(this, 'PhotosBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: RemovalPolicy.RETAIN, // 照片一律軟刪除，bucket 也不跟著 stack 消失
      versioned: true,
      // 上傳經 API Lambda 寫入（同網域），瀏覽器不直接對 S3 發請求，不需要 CORS
    });

    /* ---------- Lambda + HTTP API ---------- */
    const fn = new NodejsFunction(this, 'ApiFn', {
      entry: resolve(root, 'packages/api/src/lambda.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(15),
      environment: {
        TABLE_NAME: table.tableName,
        PHOTOS_BUCKET: photosBucket.bucketName,
        SSM_PREFIX: site.ssmPrefix,
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        format: OutputFormat.ESM,
        target: 'node22',
        minify: true,
        sourceMap: true,
        // ESM bundle 裡若有 CJS 套件用到 require，補上 shim
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        externalModules: ['@aws-sdk/*'],
      },
      depsLockFilePath: resolve(root, 'pnpm-lock.yaml'),
      projectRoot: root,
    });
    table.grantReadWriteData(fn);
    photosBucket.grantPut(fn);
    photosBucket.grantRead(fn);
    fn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['ssm:GetParameters', 'ssm:GetParameter'],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter${site.ssmPrefix}/*`],
      }),
    );

    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      defaultIntegration: new HttpLambdaIntegration('ApiIntegration', fn),
    });

    /* ---------- CloudFront：同一網域下 / 靜態、/api/* → API、/photos/* → 照片 ---------- */
    const rewriteFn = new cloudfront.Function(this, 'RewriteFn', {
      code: cloudfront.FunctionCode.fromFile({ filePath: resolve(here, '../functions/rewrite.js') }),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    const apiOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'ApiOriginRequestPolicy', {
      // 不能轉送 Host（API Gateway 需要自己的 host）；帶上寫入 token、管理密鑰、以及 viewer IP 供 rate limit
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        'Content-Type',
        'Accept',
        'X-Write-Token',
        'X-Admin-Key',
        'CloudFront-Viewer-Address',
        'User-Agent',
      ),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
    });

    const apiDomain = `${httpApi.apiId}.execute-api.${this.region}.${this.urlSuffix}`;

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: site.siteTitle,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // 含亞洲節點
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [{ function: rewriteFn, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        '/api/*': {
          origin: new origins.HttpOrigin(apiDomain, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: apiOriginRequestPolicy,
          compress: true,
        },
        '/photos/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(photosBucket, { originPath: '/' }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          functionAssociations: [
            {
              // /photos/persons/x/y.jpg → S3 key persons/x/y.jpg
              function: new cloudfront.Function(this, 'PhotosPrefixFn', {
                code: cloudfront.FunctionCode.fromInline(
                  "function handler(e){var r=e.request;r.uri=r.uri.replace(/^\\/photos\\//,'/');return r;}",
                ),
                runtime: cloudfront.FunctionRuntime.JS_2_0,
              }),
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.minutes(1) },
        { httpStatus: 404, responseHttpStatus: 404, responsePagePath: '/404.html', ttl: Duration.minutes(1) },
      ],
    });

    /* ---------- 上傳前端 build 產物 ---------- */
    // _astro/ 底下是 hash 過的檔名，可長期快取；HTML 等其他檔案每次重新驗證
    const webDist = resolve(root, 'packages/web/dist');
    new s3deploy.BucketDeployment(this, 'SiteDeployAssets', {
      sources: [s3deploy.Source.asset(resolve(webDist, '_astro'))],
      destinationBucket: siteBucket,
      destinationKeyPrefix: '_astro/',
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=31536000, immutable')],
    });
    new s3deploy.BucketDeployment(this, 'SiteDeploy', {
      sources: [s3deploy.Source.asset(webDist, { exclude: ['_astro/*'] })],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      prune: false,
      cacheControl: [s3deploy.CacheControl.fromString('public, max-age=0, must-revalidate')],
    });

    new CfnOutput(this, 'SiteUrl', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'TableName', { value: table.tableName });
    new CfnOutput(this, 'PhotosBucketName', { value: photosBucket.bucketName });
    new CfnOutput(this, 'ApiUrl', { value: httpApi.apiEndpoint });
  }
}
