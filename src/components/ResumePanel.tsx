import { Download, X } from 'lucide-react';
import { api } from '../api.ts';
import ResumePreview from './ResumePreview.tsx';
import type { ResumeVersion, Template } from '../../shared/types.ts';

interface ResumePanelProps {
  selected: ResumeVersion | null;
  templates: Template[];
  onChangeTemplate: (templateId: string) => void;
  onClose: () => void;
}

// The canvas: just the resume document, a template picker, and PDF export.
// All conversation — strategy, edits, questions — happens in the chat.
export default function ResumePanel({ selected, templates, onChangeTemplate, onClose }: ResumePanelProps) {
  return (
    <aside className="resumeSide">
      <header className="resumeSideHead">
        <strong>Resume</strong>
        <div className="canvasControls">
          {selected && (
            <label className="templatePick">
              Template
              <select value={selected.template_id} onChange={(e) => onChangeTemplate(e.target.value)} aria-label="Template">
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}
          <button className="ghost" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
      </header>

      {!selected ? (
        <p className="hint sidePad">No draft yet. Ask Sox to generate one in the chat.</p>
      ) : (
        <>
          <ResumePreview content={selected.content} />
          <div className="canvasFooter">
            <a className="pillBtn" href={api.exportUrl(selected.id, selected.template_id)}>
              <Download size={14} /> Export PDF
            </a>
          </div>
        </>
      )}
    </aside>
  );
}
