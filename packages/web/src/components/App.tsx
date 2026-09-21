import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Person, RecentItem } from '@vsp/shared';
import { api } from '../lib/api.js';
import { RecentBar } from './RecentBar.jsx';
import { YearSection } from './YearSection.jsx';
import { PersonSheet } from './PersonSheet.jsx';

const ID_RE = /^\/p\/([A-Za-z0-9]{6})\/?$/;

function idFromUrl(): string | null {
  return ID_RE.exec(location.pathname)?.[1] ?? null;
}

const byName = (a: Person, b: Person) => a.nameZh.localeCompare(b.nameZh, 'zh-Hant') || a.createdAt.localeCompare(b.createdAt);

/**
 * 首頁：唯一的瀏覽頁。年份 → 人。
 * 開頁時打一次 API 撈回全部 Person，之後全在記憶體裡篩年份。
 * 人物面板以覆蓋層呈現，開啟時用 history API 把網址換成 /p/xxxxxx，不換頁。
 */
export function App() {
  const [persons, setPersons] = useState<Person[] | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pendingScroll = useRef<string | null>(null);

  const years = useMemo(() => {
    const m = new Map<number, Person[]>();
    for (const p of persons ?? []) {
      if (!m.has(p.yearJoined)) m.set(p.yearJoined, []);
      m.get(p.yearJoined)!.push(p);
    }
    for (const list of m.values()) list.sort(byName);
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [persons]);

  const byId = useMemo(() => new Map((persons ?? []).map((p) => [p.personId, p])), [persons]);

  /** 展開年份、捲到那一格、開面板（不 push 網址；由呼叫端決定） */
  function reveal(id: string) {
    const p = byId.get(id);
    if (!p) return;
    setExpanded((s) => (s.has(p.yearJoined) ? s : new Set(s).add(p.yearJoined)));
    pendingScroll.current = id;
    setSelectedId(id);
  }

  useEffect(() => {
    if (!pendingScroll.current) return;
    const id = pendingScroll.current;
    pendingScroll.current = null;
    // 面板 mount 時會鎖住捲動並記住位置，所以要在那之前把卡片捲進畫面
    requestAnimationFrame(() => document.getElementById(`p-${id}`)?.scrollIntoView({ block: 'center' }));
  });

  useEffect(() => {
    Promise.all([api.listPersons(), api.recent().catch(() => [] as RecentItem[])])
      .then(([ps, rs]) => {
        setPersons(ps);
        setRecent(rs);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // 由 /p/xxxxxx 連結進入：資料載好後自動展開該年份、捲到該位置、開啟面板
  useEffect(() => {
    if (!persons) return;
    const id = idFromUrl();
    if (!id) return;
    if (byId.has(id)) {
      history.replaceState({ sheet: 'replaced' }, '', `/p/${id}`);
      reveal(id);
    } else {
      // 可能是被合併掉的舊連結
      api.getPerson(id).then((r) => {
        if (r.person.mergedInto) location.replace(`/p/${r.person.mergedInto}`);
        else {
          setError('找不到這個人，可能已被移除');
          history.replaceState(null, '', '/');
        }
      }).catch(() => {
        setError('找不到這個人');
        history.replaceState(null, '', '/');
      });
    }
  }, [persons === null]);

  useEffect(() => {
    const onPop = () => {
      const id = idFromUrl();
      if (id && byId.has(id)) reveal(id);
      else setSelectedId(null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [byId]);

  function openPerson(id: string) {
    if (history.state?.sheet) history.replaceState(history.state, '', `/p/${id}`);
    else history.pushState({ sheet: 'pushed' }, '', `/p/${id}`);
    reveal(id);
  }

  function closePerson() {
    setSelectedId(null);
    if (history.state?.sheet === 'pushed') history.back();
    else history.replaceState(null, '', '/');
  }

  function onUpdated(p: Person) {
    setPersons((ps) => (ps ?? []).map((x) => (x.personId === p.personId ? p : x)));
    api.recent().then(setRecent).catch(() => {});
  }

  const selected = selectedId ? byId.get(selectedId) ?? null : null;
  const siblings = selected ? years.find(([y]) => y === selected.yearJoined)?.[1] ?? [] : [];
  const idx = selected ? siblings.findIndex((p) => p.personId === selected.personId) : -1;

  return (
    <div class="home">
      <div class="home-top">
        <RecentBar items={recent} onOpen={(id) => openPerson(id)} />
        <a class="btn btn-primary btn-add-student" href="/new">＋ 新增學生</a>
      </div>

      {error && <div class="error">{error}</div>}
      {persons === null && !error && <div class="muted" style="padding:32px 0;text-align:center">載入中…</div>}
      {persons && persons.length === 0 && (
        <div class="card" style="text-align:center;padding:40px 16px">
          <p>還沒有任何資料。</p>
          <a class="btn btn-primary" href="/new">＋ 新增第一位學生</a>
        </div>
      )}

      {years.length > 0 && (
        <div class="years-tools small">
          <button class="btn btn-ghost btn-sm" onClick={() => setExpanded(new Set(years.map(([y]) => y)))}>全部展開</button>
          <button class="btn btn-ghost btn-sm" onClick={() => setExpanded(new Set())}>全部收合</button>
          <span class="muted">共 {persons?.length ?? 0} 人・{years.length} 個年份</span>
        </div>
      )}

      {years.map(([year, list]) => (
        <YearSection
          key={year}
          year={year}
          persons={list}
          expanded={expanded.has(year)}
          onToggle={() =>
            setExpanded((s) => {
              const n = new Set(s);
              n.has(year) ? n.delete(year) : n.add(year);
              return n;
            })
          }
          onOpen={openPerson}
          onUpdated={onUpdated}
        />
      ))}

      {selected && (
        <PersonSheet
          person={selected}
          prev={idx > 0 ? siblings[idx - 1]! : null}
          next={idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1]! : null}
          onClose={closePerson}
          onNavigate={openPerson}
          onUpdated={onUpdated}
        />
      )}
    </div>
  );
}
