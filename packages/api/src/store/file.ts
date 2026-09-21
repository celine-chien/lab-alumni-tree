import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GroupPhoto, Person, Revision } from '@vsp/shared';
import type { Store } from './types.js';

interface Db {
  persons: Record<string, Person>;
  groupPhotos: Record<string, GroupPhoto>;
  revisions: Revision[];
  rate: Record<string, { count: number; exp: number }>;
}

/** 本機開發用：所有資料存在一個 JSON 檔，每次寫入整檔覆寫（原子 rename）。 */
export class FileStore implements Store {
  private db: Db;

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      this.db = JSON.parse(readFileSync(path, 'utf8')) as Db;
      this.db.rate ??= {};
    } else {
      this.db = { persons: {}, groupPhotos: {}, revisions: [], rate: {} };
    }
  }

  private save() {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    renameSync(tmp, this.path);
  }

  async listPersons(opts?: { includeHidden?: boolean }) {
    return Object.values(this.db.persons).filter((p) => opts?.includeHidden || p.status === 'active');
  }
  async getPerson(id: string) {
    return this.db.persons[id] ?? null;
  }
  async putPerson(p: Person) {
    this.db.persons[p.personId] = p;
    this.save();
  }

  async listGroupPhotos(year?: number, opts?: { includeHidden?: boolean }) {
    return Object.values(this.db.groupPhotos).filter(
      (g) => (year === undefined || g.year === year) && (opts?.includeHidden || g.status === 'active'),
    );
  }
  async getGroupPhoto(id: string) {
    return this.db.groupPhotos[id] ?? null;
  }
  async putGroupPhoto(p: GroupPhoto) {
    this.db.groupPhotos[p.photoId] = p;
    this.save();
  }

  async putRevision(r: Revision) {
    this.db.revisions.push(r);
    this.save();
  }
  async listRevisions(target: Revision['target'], targetId: string) {
    return this.db.revisions
      .filter((r) => r.target === target && r.targetId === targetId)
      .sort((a, b) => (a.revId < b.revId ? 1 : -1));
  }
  async listRecent(limit: number) {
    return [...this.db.revisions].sort((a, b) => (a.revId < b.revId ? 1 : -1)).slice(0, limit);
  }

  async idExists(id: string) {
    return id in this.db.persons || id in this.db.groupPhotos;
  }

  async rateLimitHit(ip: string, limit: number, windowSec: number) {
    const now = Date.now();
    const bucket = Math.floor(now / 1000 / windowSec);
    const key = `${ip}#${bucket}`;
    for (const k of Object.keys(this.db.rate)) if (this.db.rate[k]!.exp < now) delete this.db.rate[k];
    const cur = (this.db.rate[key] ??= { count: 0, exp: now + windowSec * 2000 });
    cur.count += 1;
    this.save();
    return cur.count > limit;
  }

  async dumpAll() {
    return {
      persons: Object.values(this.db.persons),
      groupPhotos: Object.values(this.db.groupPhotos),
      revisions: [...this.db.revisions],
    };
  }
}
