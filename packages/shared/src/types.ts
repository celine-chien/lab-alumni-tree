/**
 * 資料模型。只有兩個 entity：Person 與 GroupPhoto。
 * 個人照直接存在 Person.photos 陣列裡，不獨立成表。
 */

/**
 * 學位狀態是三態，不是 boolean。
 * - unknown：還沒人填。UI 上是「待補」標記，是眾包補資料的線索。
 * - no：確定沒有。UI 上顯示為確定資訊（例如「僅博士」）。
 * - yes：有。年份與論文只是細節，「yes 但年份不詳」是合法狀態。
 */
export type DegreeStatus = 'yes' | 'no' | 'unknown';

export type EntityStatus = 'active' | 'hidden';

export interface PersonPhoto {
  s3Key: string;
  thumbKey: string;
  caption: string;
  uploadedAt: string; // ISO 8601
  uploadedBy: string;
}

/**
 * 學位欄位（hasMaster/masterStart/masterEnd/masterThesis 與 phd 那一組）
 * **僅指在本實驗室取得的學位**。
 * 若某人碩士在別校、博士才進本實驗室，碩士那一組完全不填
 * （hasMaster 維持 unknown 或設為 no）。
 *
 * 不儲存任何聯絡資訊（email、電話）。公開無登入頁面放聯絡資訊等於送給爬蟲。
 */
export interface Person {
  /** 6 碼英數字，系統產生，永遠不變。不可用年份編碼。 */
  personId: string;
  nameZh: string;
  /** 唯一分組依據：第一次進實驗室的年份。可被修改，因此不可與 personId 綁定。 */
  yearJoined: number;
  nameEn: string;
  nickname: string;
  hasMaster: DegreeStatus;
  masterStart: number | null;
  masterEnd: number | null;
  masterThesis: string;
  hasPhd: DegreeStatus;
  phdStart: number | null;
  phdEnd: number | null;
  phdThesis: string;
  /** 表單需標示「請勿輸入任何個資」。 */
  currentStatus: string;
  /** 最多 2 張。格狀清單顯示較早上傳那張（陣列第一個），不設 coverPhotoId。 */
  photos: PersonPhoto[];
  /** 軟刪除用；合併時被併掉的那筆也標 hidden。 */
  status: EntityStatus;
  /** 合併後指向保留的 personId，讓舊連結可轉址。 */
  mergedInto?: string;
  createdAt: string;
  updatedAt: string; // 後端自動蓋
  updatedBy: string; // 選填署名
}

export interface GroupPhoto {
  photoId: string;
  /** 單一值。想出現在兩個年份就上傳兩次。 */
  year: number;
  s3Key: string;
  thumbKey: string;
  caption: string;
  status: EntityStatus;
  uploadedAt: string;
  uploadedBy: string;
}

export type RevisionKind =
  | 'create'
  | 'update'
  | 'restore'
  | 'merge'
  | 'merged_away'
  | 'photo_add'
  | 'photo_delete'
  | 'group_photo_add'
  | 'group_photo_delete'
  | 'admin_hide'
  | 'admin_unhide';

/**
 * 每次寫入 append 一筆 revision：時間、改前的完整內容、選填署名。
 * before 為 null 表示新增。還原 = 把某筆 before 當成新內容再存一次。
 */
export interface Revision {
  revId: string; // `${ts}#${rand}`，可排序
  target: 'person' | 'groupPhoto';
  targetId: string;
  ts: string; // ISO 8601
  kind: RevisionKind;
  /** 改前的完整內容；新增時為 null */
  before: Person | GroupPhoto | null;
  /** 改動的欄位名稱（供「最近更新」產生描述） */
  changedFields: string[];
  /** 當時的姓名／年份快照，供最近更新列使用，不必再查 Person */
  nameZh: string;
  year: number;
  by: string;
}

export type RecentItem = Pick<
  Revision,
  'revId' | 'target' | 'targetId' | 'ts' | 'kind' | 'changedFields' | 'nameZh' | 'year' | 'by'
>;
