import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { GroupPhoto, Person, Revision } from '@vsp/shared';
import type { Store } from './types.js';

/**
 * DynamoDB 單表設計：
 * | 項目       | PK                  | SK                | GSI1PK        | GSI1SK           | GSI2PK        | GSI2SK     |
 * | Person     | PERSON#<personId>   | META              | YEAR#<year>   | PERSON#<id>      | PERSON        | updatedAt  |
 * | GroupPhoto | PHOTO#<photoId>     | META              | YEAR#<year>   | PHOTO#<id>       | GROUP_PHOTO   | uploadedAt |
 * | Revision   | PERSON#/PHOTO#<id>  | REV#<ts>#<rand>   | RECENT        | <ts>#<rand>      | —             | —          |
 * | RateLimit  | RATE#<ip>           | <bucket>          | —（有 ttl）    |                  |               |            |
 *
 * GSI1 依年份查 Person / GroupPhoto；GSI1PK=RECENT 給「最近更新」。
 * GSI2 列出全部 Person（開頁一次撈完），避免 Scan 掃到 revision。
 */
export class DynamoStore implements Store {
  private readonly doc: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client?: DynamoDBClient,
  ) {
    this.doc = DynamoDBDocumentClient.from(client ?? new DynamoDBClient({}), {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  private async queryAll(params: ConstructorParameters<typeof QueryCommand>[0]) {
    const items: Record<string, unknown>[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(new QueryCommand({ ...params, ExclusiveStartKey: key }));
      items.push(...((r.Items ?? []) as Record<string, unknown>[]));
      key = r.LastEvaluatedKey;
    } while (key);
    return items;
  }

  private strip<T>(item: Record<string, unknown>): T {
    const { PK, SK, GSI1PK, GSI1SK, GSI2PK, GSI2SK, entity, ttl, ...rest } = item;
    void PK; void SK; void GSI1PK; void GSI1SK; void GSI2PK; void GSI2SK; void entity; void ttl;
    return rest as T;
  }

  async listPersons(opts?: { includeHidden?: boolean }) {
    const items = await this.queryAll({
      TableName: this.table,
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': 'PERSON' },
    });
    return items.map((i) => this.strip<Person>(i)).filter((p) => opts?.includeHidden || p.status === 'active');
  }

  async getPerson(id: string) {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: `PERSON#${id}`, SK: 'META' } }));
    return r.Item ? this.strip<Person>(r.Item) : null;
  }

  async putPerson(p: Person) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          PK: `PERSON#${p.personId}`,
          SK: 'META',
          entity: 'PERSON',
          GSI1PK: `YEAR#${p.yearJoined}`,
          GSI1SK: `PERSON#${p.personId}`,
          GSI2PK: 'PERSON',
          GSI2SK: p.updatedAt,
          ...p,
        },
      }),
    );
  }

  async listGroupPhotos(year?: number, opts?: { includeHidden?: boolean }) {
    const items =
      year === undefined
        ? await this.queryAll({
            TableName: this.table,
            IndexName: 'GSI2',
            KeyConditionExpression: 'GSI2PK = :pk',
            ExpressionAttributeValues: { ':pk': 'GROUP_PHOTO' },
          })
        : await this.queryAll({
            TableName: this.table,
            IndexName: 'GSI1',
            KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :sk)',
            ExpressionAttributeValues: { ':pk': `YEAR#${year}`, ':sk': 'PHOTO#' },
          });
    return items.map((i) => this.strip<GroupPhoto>(i)).filter((g) => opts?.includeHidden || g.status === 'active');
  }

  async getGroupPhoto(id: string) {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK: `PHOTO#${id}`, SK: 'META' } }));
    return r.Item ? this.strip<GroupPhoto>(r.Item) : null;
  }

  async putGroupPhoto(p: GroupPhoto) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          PK: `PHOTO#${p.photoId}`,
          SK: 'META',
          entity: 'GROUP_PHOTO',
          GSI1PK: `YEAR#${p.year}`,
          GSI1SK: `PHOTO#${p.photoId}`,
          GSI2PK: 'GROUP_PHOTO',
          GSI2SK: p.uploadedAt,
          ...p,
        },
      }),
    );
  }

  private revPk(r: Pick<Revision, 'target' | 'targetId'>) {
    return r.target === 'person' ? `PERSON#${r.targetId}` : `PHOTO#${r.targetId}`;
  }

  async putRevision(r: Revision) {
    await this.doc.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          PK: this.revPk(r),
          SK: `REV#${r.revId}`,
          entity: 'REVISION',
          GSI1PK: 'RECENT',
          GSI1SK: r.revId,
          ...r,
        },
      }),
    );
  }

  async listRevisions(target: Revision['target'], targetId: string) {
    const items = await this.queryAll({
      TableName: this.table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': this.revPk({ target, targetId }), ':sk': 'REV#' },
      ScanIndexForward: false,
    });
    return items.map((i) => this.strip<Revision>(i));
  }

  async listRecent(limit: number) {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: 'GSI1',
        KeyConditionExpression: 'GSI1PK = :pk',
        ExpressionAttributeValues: { ':pk': 'RECENT' },
        ScanIndexForward: false,
        Limit: limit,
      }),
    );
    return ((r.Items ?? []) as Record<string, unknown>[]).map((i) => this.strip<Revision>(i));
  }

  async idExists(id: string) {
    const [a, b] = await Promise.all([this.getPerson(id), this.getGroupPhoto(id)]);
    return a !== null || b !== null;
  }

  async rateLimitHit(ip: string, limit: number, windowSec: number) {
    const now = Math.floor(Date.now() / 1000);
    const bucket = Math.floor(now / windowSec);
    const r = await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: `RATE#${ip}`, SK: String(bucket) },
        UpdateExpression: 'ADD #c :one SET #ttl = :ttl, entity = :e',
        ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':one': 1, ':ttl': now + windowSec * 2, ':e': 'RATE' },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(r.Attributes?.count ?? 0) > limit;
  }

  async dumpAll() {
    const persons: Person[] = [];
    const groupPhotos: GroupPhoto[] = [];
    const revisions: Revision[] = [];
    let key: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(new ScanCommand({ TableName: this.table, ExclusiveStartKey: key }));
      for (const item of (r.Items ?? []) as Record<string, unknown>[]) {
        if (item.entity === 'PERSON') persons.push(this.strip<Person>(item));
        else if (item.entity === 'GROUP_PHOTO') groupPhotos.push(this.strip<GroupPhoto>(item));
        else if (item.entity === 'REVISION') revisions.push(this.strip<Revision>(item));
      }
      key = r.LastEvaluatedKey;
    } while (key);
    return { persons, groupPhotos, revisions };
  }
}
