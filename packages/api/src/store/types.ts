import type { GroupPhoto, Person, Revision } from '@vsp/shared';

/**
 * 資料層介面。兩個實作：
 * - DynamoStore：正式環境，單表設計（見 SPEC 第 7 節）
 * - FileStore：本機開發與測試，一個 JSON 檔
 * CSV 匯入 script 也透過這個介面寫入。
 */
export interface Store {
  listPersons(opts?: { includeHidden?: boolean }): Promise<Person[]>;
  getPerson(id: string): Promise<Person | null>;
  putPerson(p: Person): Promise<void>;

  listGroupPhotos(year?: number, opts?: { includeHidden?: boolean }): Promise<GroupPhoto[]>;
  getGroupPhoto(id: string): Promise<GroupPhoto | null>;
  putGroupPhoto(p: GroupPhoto): Promise<void>;

  putRevision(r: Revision): Promise<void>;
  listRevisions(target: Revision['target'], targetId: string): Promise<Revision[]>;
  listRecent(limit: number): Promise<Revision[]>;

  idExists(id: string): Promise<boolean>;

  /** 回傳 true 表示此 IP 在這個時間窗內已超過 limit。 */
  rateLimitHit(ip: string, limit: number, windowSec: number): Promise<boolean>;

  /** 匯入 script 備份用：整張表 dump */
  dumpAll(): Promise<{ persons: Person[]; groupPhotos: GroupPhoto[]; revisions: Revision[] }>;
}
