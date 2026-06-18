import { Download, Gauge, X } from 'lucide-react';
import { api } from '../api.ts';
import ResumePreview from './ResumePreview.tsx';
import { usePanelWidth } from '../hooks/usePanelWidth.ts';
import type { ResumeVersion, Template } from '../../shared/types.ts';

interface ResumePanelProps {
  selected: ResumeVersion | null;
  templates: Template[];
  onChangeTemplate: (templateId: string) => void;
  onClose: () => void;
  onCheckAts: () => void;
}

// The canvas: just the resume document, a template picker, and PDF export.
// All conversation — strategy, edits, questions — happens in the chat. The panel
// is drag-resizable from its left edge; the chosen width persists across runs.
export default function ResumePanel({ selected, templates, onChangeTemplate, onClose, onCheckAts }: ResumePanelProps) {
  // While resizing, isDragging mounts a shield over the PDF iframe — otherwise
  // the iframe swallows the mouse events and the drag stalls over it.
  const { width, isDragging, onResizeStart, reset } = usePanelWidth('resumePanelWidth', 460, 360);

  return (
    <aside className="resumeSide" style={{ width }}>
      {isDragging && <div className="dragShield" />}
      <div
        className="resumeResizer"
        onMouseDown={onResizeStart}
        onDoubleClick={reset}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize resume panel"
      />
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
          <ResumePreview version={selected} />
          <div className="canvasFooter">
            <button className="pillBtn ghost" onClick={onCheckAts}>
              <Gauge size={14} /> Check ATS score
            </button>
            <a className="pillBtn" href={api.exportUrl(selected.id, selected.template_id)}>
              <Download size={14} /> Export PDF
            </a>
          </div>
        </>
      )}
    </aside>
  );
}
