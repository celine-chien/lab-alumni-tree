import { useEffect, useRef, useState } from 'preact/hooks';
import type { Person } from '@vsp/shared';
import { lockScroll, unlockScroll } from '../lib/scrollLock.js';
import { PersonPhotos } from './PersonPhotos.jsx';
import { Revisions } from './Revisions.jsx';

/**
 * 空欄位寫「＋ 新增」而不是「？未填」：描述狀態 vs 邀請動作。
 * 必須真的可點：直接進編輯頁並聚焦該欄位。灰色，不用警示色。
 */
function AddLink({ personId, field, label = '新增' }: { personId: string; field: string; label?: string }) {
  return (
    <a class="add-link" href={`/p/${personId}/edit?focus=${field}`}>
      ＋ {label}
    </a>
  );
}

function Val({ v, personId, field }: { v: string | number | null | undefined; personId: string; field: string }) {
  if (v === null || v === undefined || v === '') return <AddLink personId={personId} field={field} />;
  return <span>{v}</span>;
}

function Degree({ personId, name, prefix, status, start, end, thesis }: {
  personId: string;
  name: '碩士' | '博士';
  prefix: 'master' | 'phd';
  status: Person['hasMaster'];
  start: number | null;
  end: number | null;
  thesis: string;
}) {
  if (status === 'no') return <div class="deg deg-no">無{name}（確定）</div>;
  if (status === 'unknown')
    return (
      <div class="deg deg-unknown">
        <AddLink personId={personId} field={`has${prefix === 'master' ? 'Master' : 'Phd'}`} label={`新增${name}資料`} />
      </div>
    );
  return (
    <div class="deg">
      <div class="deg-head">
        <span class={`badge ${name === '碩士' ? 'badge-master' : 'badge-phd'}`}>{name}</span>
        <span class="deg-years">
          {start ?? <AddLink personId={personId} field={`${prefix}Start`} label="入學年" />}
          <span class="muted">–</span>
          {end ?? <AddLink personId={personId} field={`${prefix}End`} label="畢業年" />}
        </span>
      </div>
      <div class="deg-thesis">
        <span class="text-2 small">論文</span> <Val v={thesis} personId={personId} field={`${prefix}Thesis`} />
      </div>
    </div>
  );
}

/**
 * 人物面板：手機為由下滑上的 bottom sheet（約七成高），桌機為中央 modal。
 * - 左右滑切換同屆的上一位／下一位
 * - 開啟時鎖住背景捲動
 */
export function PersonSheet({ person, prev, next, onClose, onNavigate, onUpdated }: {
  person: Person;
  prev: Person | null;
  next: Person | null;
  onClose: () => void;
  onNavigate: (id: string) => void;
  onUpdated: (p: Person) => void;
}) {
  const [showRevs, setShowRevs] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    lockScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && prev) onNavigate(prev.personId);
      if (e.key === 'ArrowRight' && next) onNavigate(next.personId);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      unlockScroll();
      window.removeEventListener('keydown', onKey);
    };
  }, [prev?.personId, next?.personId]);

  useEffect(() => {
    setShowRevs(false);
    bodyRef.current?.scrollTo(0, 0);
  }, [person.personId]);

  function onTouchStart(e: TouchEvent) {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  }
  function onTouchEnd(e: TouchEvent) {
    const s = touch.current;
    const t = e.changedTouches[0];
    touch.current = null;
    if (!s || !t) return;
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && next) onNavigate(next.personId);
    if (dx > 0 && prev) onNavigate(prev.personId);
  }

  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <section class="sheet" role="dialog" aria-modal="true" aria-label={`${person.nameZh} 的資料`} onClick={(e) => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div class="sheet-handle" aria-hidden="true" />
        <header class="sheet-head">
          <button class="btn btn-ghost btn-sm" disabled={!prev} onClick={() => prev && onNavigate(prev.personId)} aria-label="上一位">
            ‹ {prev ? prev.nameZh : ''}
          </button>
          <div class="sheet-title">
            <div class="sheet-name">{person.nameZh}</div>
            <div class="small text-2">{person.yearJoined} 年入實驗室</div>
          </div>
          <button class="btn btn-ghost btn-sm" disabled={!next} onClick={() => next && onNavigate(next.personId)} aria-label="下一位">
            {next ? next.nameZh : ''} ›
          </button>
        </header>
        <div class="sheet-body" ref={bodyRef}>
          <PersonPhotos person={person} onUpdated={onUpdated} />

          <dl class="fields">
            <div><dt>英文姓名</dt><dd><Val v={person.nameEn} personId={person.personId} field="nameEn" /></dd></div>
            <div><dt>暱稱</dt><dd><Val v={person.nickname} personId={person.personId} field="nickname" /></dd></div>
          </dl>

          <div class="degs">
            <Degree personId={person.personId} name="碩士" prefix="master" status={person.hasMaster} start={person.masterStart} end={person.masterEnd} thesis={person.masterThesis} />
            <Degree personId={person.personId} name="博士" prefix="phd" status={person.hasPhd} start={person.phdStart} end={person.phdEnd} thesis={person.phdThesis} />
          </div>

          <dl class="fields">
            <div><dt>現況</dt><dd><Val v={person.currentStatus} personId={person.personId} field="currentStatus" /></dd></div>
          </dl>

          <div class="sheet-actions row">
            <button class="btn" onClick={() => setShowRevs((v) => !v)}>{showRevs ? '收起紀錄' : '修改紀錄／還原'}</button>
            <a class="btn" href={`/p/${person.personId}/merge`}>合併重複資料</a>
          </div>
          {showRevs && (
            <div class="sheet-revs">
              <Revisions person={person} onUpdated={onUpdated} />
            </div>
          )}
          <div class="muted small" style="margin-top:16px">ID {person.personId}・網址可直接分享</div>
        </div>
        {/* 固定在面板底部，計入 iOS safe area */}
        <footer class="sheet-foot">
          <a class="btn btn-primary btn-block" href={`/p/${person.personId}/edit`}>編輯資料</a>
        </footer>
        <button class="sheet-close" onClick={onClose} aria-label="關閉">×</button>
      </section>
    </div>
  );
}
