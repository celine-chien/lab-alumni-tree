import type { RecentItem } from '@vsp/shared';
import { describeRevision } from '@vsp/shared';
import { timeAgo } from '../lib/format.js';

/** 首頁最上方的「最近更新」：證明真的有人在用，帶動其他人也來填。 */
export function RecentBar({ items, onOpen }: { items: RecentItem[]; onOpen: (id: string, year: number) => void }) {
  if (items.length === 0) return null;
  const shown = items.slice(0, 3);
  return (
    <section class="recent" aria-label="最近更新">
      <div class="recent-title">最近更新</div>
      <ul>
        {shown.map((r) => (
          <li key={r.revId}>
            <span class="muted small">{timeAgo(r.ts)}</span>{' '}
            {r.target === 'person' && r.kind !== 'merged_away' ? (
              <a href={`/p/${r.targetId}`} onClick={(e) => { e.preventDefault(); onOpen(r.targetId, r.year); }}>
                {describeRevision(r)}
              </a>
            ) : (
              <span>{describeRevision(r)}</span>
            )}
            {r.by && <span class="muted small">（{r.by}）</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
