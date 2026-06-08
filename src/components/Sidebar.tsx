import { Cat, FilePlus2, FileText, Settings as SettingsIcon, Sparkles, Trash2 } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { ResumeSession } from '../../shared/types.ts';

export type View = 'home' | 'copilot' | 'memory' | 'settings';

interface SidebarProps {
  sessions: ResumeSession[];
  activeSessionId: string | null;
  view: View;
  hasApiKey: boolean;
  onNewResume: () => void;
  onSelectView: (view: View) => void;
  onSelectSession: (id: string) => void;
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
  onNewResume,
  onSelectView,
  onSelectSession,
  onDeleteSession
}: SidebarProps) {
  function remove(id: string, event: MouseEvent): void {
    event.stopPropagation();
    onDeleteSession(id);
  }

  const navActive = (v: View) => !activeSessionId && view === v;

  return (
    <aside className="sidebar">
      <div className="sidebarBrand">
        <span className="brandMark"><Cat size={18} /></span>
        <span className="brandName">Sox</span>
      </div>

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
      </nav>

      <div className="sessionScroll">
        <p className="sectionLabel">Resumes</p>
        {sessions.length === 0 && <p className="sidebarEmpty">No resumes yet</p>}
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`sessionRow ${activeSessionId === s.id ? 'active' : ''}`}
            onClick={() => onSelectSession(s.id)}
          >
            <FileText size={15} />
            <span className="sessionTitle">{s.title || 'Untitled role'}</span>
            <span className="rowDelete" onClick={(e) => remove(s.id, e)} aria-label="Delete">
              <Trash2 size={14} />
            </span>
          </button>
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
