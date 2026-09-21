import { handle } from 'hono/aws-lambda';
import { createApp } from './app.js';
import { DynamoStore } from './store/dynamo.js';
import { S3Blobs } from './blobs/s3.js';
import { ssmSecrets } from './config.js';

const app = createApp({
  store: new DynamoStore(process.env.TABLE_NAME!),
  blobs: new S3Blobs(process.env.PHOTOS_BUCKET!),
  secrets: ssmSecrets(),
});

export const handler = handle(app);
