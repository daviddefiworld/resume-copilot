import { BookOpen, Briefcase, ChevronDown, ChevronRight, Gauge, Settings as SettingsIcon, Sparkles, Target, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { Personality, ResumeSession } from '../../shared/types.ts';
import { PersonaMark } from '../personaVisual.tsx';

export type View = 'home' | 'copilot' | 'memory' | 'ats' | 'settings';

interface SidebarProps {
  sessions: ResumeSession[];
  activeSessionId: string | null;
  view: View;
  hasApiKey: boolean;
  activeProfileName: string | null;
  persona: Personality | null;
  onNewResume: () => void;
  onSelectView: (view: View) => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => Promise<void>;
  onDeleteSession: (id: string) => void;
}

// Date bucketing for the job-hunt history, so a long list folds down to the latest
// hunts. "Today" is never foldered (always shown); every older bucket gets a
// collapsible header. Buckets are by calendar day in the user's local time.
type BucketKey = 'today' | 'yesterday' | 'prev7' | 'prev30' | 'older';
// The foldable groups, in display order (today is rendered separately, above them).
const FOLDABLE_BUCKETS: Exclude<BucketKey, 'today'>[] = ['yesterday', 'prev7', 'prev30', 'older'];
const BUCKET_LABEL: Record<Exclude<BucketKey, 'today'>, string> = {
  yesterday: 'Yesterday',
  prev7: 'Previous 7 days',
  prev30: 'Previous 30 days',
  older: 'Older'
};
// Folded by default, so a big backlog collapses to just today's + yesterday's hunts
// on first load. The user's expand/collapse choice is remembered across reloads.
const DEFAULT_COLLAPSED: BucketKey[] = ['prev7', 'prev30', 'older'];
const COLLAPSE_STORAGE_KEY = 'sox.sidebar.collapsedBuckets';

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// Which bucket a session falls in, by how many calendar days ago it was created.
function bucketOf(createdAt: string, todayStart: number): BucketKey {
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return 'older';
  const days = Math.round((todayStart - startOfDay(created)) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= 7) return 'prev7';
  if (days <= 30) return 'prev30';
  return 'older';
}

function loadCollapsed(): Set<BucketKey> {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as BucketKey[]);
  } catch {
    // Corrupt or blocked storage — fall back to the default folding.
  }
  return new Set(DEFAULT_COLLAPSED);
}

// ChatGPT-style sidebar: a primary "New job hunt" action up top, the feature
// shortcuts, the job-hunt history in the middle (each session is one job), and
// settings pinned to the bottom.
export default function Sidebar({
  sessions,
  activeSessionId,
  view,
  hasApiKey,
  activeProfileName,
  persona,
  onNewResume,
  onSelectView,
  onSelectSession,
  onRenameSession,
  onDeleteSession
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  // Which date groups are folded. Seeded from localStorage so the choice sticks.
  const [collapsed, setCollapsed] = useState<Set<BucketKey>>(loadCollapsed);

  function toggleBucket(key: BucketKey): void {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Storage blocked — folding still works this session, just isn't persisted.
      }
      return next;
    });
  }

  function remove(id: string, event: MouseEvent): void {
    event.stopPropagation();
    onDeleteSession(id);
  }

  function startRename(session: ResumeSession, event: MouseEvent): void {
    event.stopPropagation();
    setEditingId(session.id);
    setTitleDraft(session.title || 'Untitled job');
  }

  async function saveRename(id: string): Promise<void> {
    const title = titleDraft.trim() || 'Untitled job';
    setEditingId(null);
    await onRenameSession(id, title);
  }

  function onRenameKeyDown(id: string, event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') void saveRename(id);
    if (event.key === 'Escape') setEditingId(null);
  }

  const navActive = (v: View) => !activeSessionId && view === v;

  // Bucket the (newest-first) sessions by recency for the foldable history.
  const todayStart = startOfDay(new Date());
  const grouped = new Map<BucketKey, ResumeSession[]>();
  for (const s of sessions) {
    const key = bucketOf(s.created_at, todayStart);
    const list = grouped.get(key);
    if (list) list.push(s);
    else grouped.set(key, [s]);
  }
  const todaySessions = grouped.get('today') ?? [];

  const renderRow = (s: ResumeSession) => (
    <div
      key={s.id}
      role="button"
      tabIndex={0}
      className={`sessionRow ${activeSessionId === s.id ? 'active' : ''}`}
      onClick={() => onSelectSession(s.id)}
    >
      <Briefcase size={15} />
      {editingId === s.id ? (
        <input
          className="sidebarTitleInput"
          value={titleDraft}
          autoFocus
          onChange={(e) => setTitleDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => void saveRename(s.id)}
          onKeyDown={(e) => onRenameKeyDown(s.id, e)}
        />
      ) : (
        <span className="sessionTitle" onDoubleClick={(e) => startRename(s, e)}>
          {s.title || 'Untitled job'}
        </span>
      )}
      <span className="rowDelete" onClick={(e) => remove(s.id, e)} aria-label="Delete">
        <Trash2 size={14} />
      </span>
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sidebarBrand">
        <PersonaMark persona={persona} size={18} className="brandMark" />
        <span className="brandName">{persona?.name ?? 'Sox'}</span>
      </div>

      {activeProfileName && (
        <button className="profileChip" onClick={() => onSelectView('settings')} title="Manage profiles">
          <UserRound size={14} />
          <span className="profileChipName">{activeProfileName}</span>
          <span className="profileChipHint">Switch</span>
        </button>
      )}

      <button className="newResume" onClick={onNewResume}>
        <Target size={17} /> New job hunt
      </button>

      <nav className="sidebarNav">
        <button className={navActive('copilot') ? 'active' : ''} onClick={() => onSelectView('copilot')}>
          <Sparkles size={16} /> Introduce yourself
        </button>
        <button className={navActive('memory') ? 'active' : ''} onClick={() => onSelectView('memory')}>
          <BookOpen size={16} /> Your story
        </button>
        <button className={navActive('ats') ? 'active' : ''} onClick={() => onSelectView('ats')}>
          <Gauge size={16} /> ATS analyzer
        </button>
      </nav>

      <div className="sessionScroll">
        <p className="sectionLabel">Job hunts</p>
        {sessions.length === 0 && <p className="sidebarEmpty">No job hunts yet</p>}
        {todaySessions.map(renderRow)}
        {FOLDABLE_BUCKETS.map((key) => {
          const items = grouped.get(key);
          if (!items || items.length === 0) return null;
          const isCollapsed = collapsed.has(key);
          return (
            <div key={key} className="sessionGroup">
              <button
                className="sessionGroupHeader"
                onClick={() => toggleBucket(key)}
                aria-expanded={!isCollapsed}
              >
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                <span className="sessionGroupLabel">{BUCKET_LABEL[key]}</span>
                <span className="sessionGroupCount">{items.length}</span>
              </button>
              {!isCollapsed && items.map(renderRow)}
            </div>
          );
        })}
      </div>

      <div className="sidebarFooter">
        <button
          className={`footerBtn ${navActive('settings') ? 'active' : ''}`}
          onClick={() => onSelectView('settings')}
        >
          <SettingsIcon size={16} /> Settings
          {!hasApiKey && <span className="dot" title="No API key set" />}
        </button>
      </div>
    </aside>
  );
}
