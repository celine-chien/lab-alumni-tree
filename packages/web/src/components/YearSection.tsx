import type { Person } from '@vsp/shared';
import { PersonCard } from './PersonCard.jsx';
import { GroupPhotoStrip } from './GroupPhotoStrip.jsx';

/**
 * 一個年份區塊：標題只有年份與人數（不放待補統計，卡片上已寫缺什麼）。
 * 預設收合。展開後是該屆的格狀排列（手機兩欄、桌機四欄），
 * 最後一格固定是「＋ 新增這一年的學生」；下方是團體照照片帶。
 * 不用 carousel：一次只看得到一到三張卡會消滅「一眼看到一整屆」，也讓缺漏藏起來。
 */
export function YearSection({ year, persons, expanded, onToggle, onOpen, onUpdated }: {
  year: number;
  persons: Person[];
  expanded: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
  onUpdated: (p: Person) => void;
}) {
  return (
    <section class={`year ${expanded ? 'open' : ''}`} id={`y-${year}`}>
      <button class="year-head" onClick={onToggle} aria-expanded={expanded}>
        <span class="year-num">{year}</span>
        <span class="year-meta">{persons.length} 人</span>
        <span class="year-chev" aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      {expanded && (
        <div class="year-body">
          <div class="grid">
            {persons.map((p) => (
              <PersonCard key={p.personId} person={p} onOpen={onOpen} onUpdated={onUpdated} />
            ))}
            <a class="pcard pcard-add" href={`/new?year=${year}`}>
              ＋ 新增這一年的學生
            </a>
          </div>
          <GroupPhotoStrip year={year} />
        </div>
      )}
    </section>
  );
}
