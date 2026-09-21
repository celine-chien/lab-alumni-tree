import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { Blobs } from './types.js';

export class S3Blobs implements Blobs {
  private readonly s3 = new S3Client({});
  constructor(private readonly bucket: string) {}

  async put(key: string, body: Uint8Array, contentType: string) {
    await this.s3.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }),
    );
  }

  async exists(key: string) {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
