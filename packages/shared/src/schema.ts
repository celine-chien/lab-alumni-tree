import { z } from 'zod';
import { ID_PATTERN } from './id.js';

const year = z
  .union([z.number(), z.string(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    return Number.isFinite(n) ? Math.trunc(n) : NaN;
  })
  .refine((v) => v === null || (v >= 1900 && v <= 2100), '年份需在 1900～2100 之間');

const text = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v ?? '').toString().trim().slice(0, max));

export const degreeStatusSchema = z.enum(['yes', 'no', 'unknown']).catch('unknown');

/** 前端送來的 Person 欄位。updatedAt 由後端蓋；personId、photos、status 不在此。 */
export const personInputSchema = z.object({
  nameZh: z.string().trim().min(1, '中文姓名必填').max(60),
  yearJoined: year.refine((v) => v !== null, '入實驗室年必填'),
  nameEn: text(120),
  nickname: text(60),
  hasMaster: degreeStatusSchema,
  masterStart: year,
  masterEnd: year,
  masterThesis: text(500),
  hasPhd: degreeStatusSchema,
  phdStart: year,
  phdEnd: year,
  phdThesis: text(500),
  currentStatus: text(500),
  updatedBy: text(60),
});
export type PersonInput = z.infer<typeof personInputSchema>;

export const personPhotoInputSchema = z.object({
  s3Key: z.string().min(1).max(300),
  thumbKey: z.string().min(1).max(300),
  caption: text(200),
  uploadedBy: text(60),
});

export const groupPhotoInputSchema = z.object({
  year: year.refine((v) => v !== null, '年份必填'),
  s3Key: z.string().min(1).max(300),
  thumbKey: z.string().min(1).max(300),
  caption: text(200),
  uploadedBy: text(60),
});

/** POST /api/upload 的 query 參數 */
export const uploadUrlInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), personId: z.string().regex(ID_PATTERN), contentType: z.string() }),
  z.object({ kind: z.literal('group'), year: year.refine((v) => v !== null), contentType: z.string() }),
]);

export const mergeInputSchema = z.object({
  keepId: z.string().regex(ID_PATTERN),
  dropId: z.string().regex(ID_PATTERN),
  merged: personInputSchema,
  photos: z.array(personPhotoInputSchema.extend({ uploadedAt: z.string() })).max(2),
});
export type MergeInput = z.infer<typeof mergeInputSchema>;

export const adminHideInputSchema = z.object({
  target: z.enum(['person', 'groupPhoto', 'personPhoto']),
  id: z.string().regex(ID_PATTERN),
  s3Key: z.string().optional(),
  action: z.enum(['hide', 'unhide']).default('hide'),
});

export const PERSON_LIMITS = { photos: 2 } as const;
export const GROUP_LIMITS = { photosPerYear: 10 } as const;
