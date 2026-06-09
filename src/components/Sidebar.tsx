import { Cat, FilePlus2, FileText, Gauge, Settings as SettingsIcon, Sparkles, Trash2, UserRound } from 'lucide-react';
import { useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import type { ResumeSession } from '../../shared/types.ts';

export type View = 'home' | 'copilot' | 'memory' | 'ats' | 'settings';

interface SidebarProps {
  sessions: ResumeSession[];
  activeSessionId: string | null;
  view: View;
  hasApiKey: boolean;
  activeProfileName: string | null;
  onNewResume: () => void;
  onSelectView: (view: View) => void;
  onSelectSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => Promise<void>;
  onDeleteSession: (id: string) => void;
}

// ChatGPT-style sidebar: a primary "New resume" action up top, the feature
// shortcuts, the resume-session history in the middle, and settings pinned to
// the bottom.
export default function Sidebar({
  sessions,
  activeSessionId,
  view,
  hasApiKey,
  activeProfileName,
  onNewResume,
  onSelectView,
  onSelectSession,
  onRenameSession,
  onDeleteSession
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState('');

  function remove(id: string, event: MouseEvent): void {
    event.stopPropagation();
    onDeleteSession(id);
  }

  function startRename(session: ResumeSession, event: MouseEvent): void {
    event.stopPropagation();
    setEditingId(session.id);
    setTitleDraft(session.title || 'Untitled role');
  }

  async function saveRename(id: string): Promise<void> {
    const title = titleDraft.trim() || 'Untitled role';
    setEditingId(null);
    await onRenameSession(id, title);
  }

  function onRenameKeyDown(id: string, event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') void saveRename(id);
    if (event.key === 'Escape') setEditingId(null);
  }

  const navActive = (v: View) => !activeSessionId && view === v;

  return (
    <aside className="sidebar">
      <div className="sidebarBrand">
        <span className="brandMark"><Cat size={18} /></span>
        <span className="brandName">Sox</span>
      </div>

      {activeProfileName && (
        <button className="profileChip" onClick={() => onSelectView('settings')} title="Manage profiles">
          <UserRound size={14} />
          <span className="profileChipName">{activeProfileName}</span>
          <span className="profileChipHint">Switch</span>
        </button>
      )}

      <button className="newResume" onClick={onNewResume}>
        <FilePlus2 size={17} /> New resume
      </button>

      <nav className="sidebarNav">
        <button className={navActive('copilot') ? 'active' : ''} onClick={() => onSelectView('copilot')}>
          <Sparkles size={16} /> Copilot chat
        </button>
        <button className={navActive('memory') ? 'active' : ''} onClick={() => onSelectView('memory')}>
          <Cat size={16} /> Memory
        </button>
        <button className={navActive('ats') ? 'active' : ''} onClick={() => onSelectView('ats')}>
          <Gauge size={16} /> ATS analyzer
        </button>
      </nav>

      <div className="sessionScroll">
        <p className="sectionLabel">Resumes</p>
        {sessions.length === 0 && <p className="sidebarEmpty">No resumes yet</p>}
        {sessions.map((s) => (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            className={`sessionRow ${activeSessionId === s.id ? 'active' : ''}`}
            onClick={() => onSelectSession(s.id)}
          >
            <FileText size={15} />
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
                {s.title || 'Untitled role'}
              </span>
            )}
            <span className="rowDelete" onClick={(e) => remove(s.id, e)} aria-label="Delete">
              <Trash2 size={14} />
            </span>
          </div>
        ))}
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
