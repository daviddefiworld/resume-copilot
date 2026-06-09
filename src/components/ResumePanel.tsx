import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Gauge, X } from 'lucide-react';
import { api } from '../api.ts';
import ResumePreview from './ResumePreview.tsx';
import type { ResumeVersion, Template } from '../../shared/types.ts';

interface ResumePanelProps {
  selected: ResumeVersion | null;
  templates: Template[];
  onChangeTemplate: (templateId: string) => void;
  onClose: () => void;
  onCheckAts: () => void;
}

const WIDTH_KEY = 'resumePanelWidth';
const MIN_WIDTH = 360;
const DEFAULT_WIDTH = 460;

function clampWidth(px: number): number {
  return Math.max(MIN_WIDTH, Math.min(px, Math.round(window.innerWidth * 0.82)));
}

// The canvas: just the resume document, a template picker, and PDF export.
// All conversation — strategy, edits, questions — happens in the chat. The panel
// is drag-resizable from its left edge; the chosen width persists across runs.
export default function ResumePanel({ selected, templates, onChangeTemplate, onClose, onCheckAts }: ResumePanelProps) {
  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH;
  });
  const dragging = useRef(false);
  // Mirrors `dragging` in state so we can mount a shield over the PDF iframe
  // while resizing — otherwise the iframe swallows the mouse events and the
  // drag freezes or gets stuck once the cursor crosses over it.
  const [isDragging, setIsDragging] = useState(false);

  const onMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    dragging.current = true;
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    function onMove(event: MouseEvent): void {
      if (!dragging.current) return;
      setWidth(clampWidth(window.innerWidth - event.clientX));
    }
    function onUp(): void {
      if (!dragging.current) return;
      dragging.current = false;
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setWidth((w) => {
        localStorage.setItem(WIDTH_KEY, String(w));
        return w;
      });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  return (
    <aside className="resumeSide" style={{ width }}>
      {isDragging && <div className="dragShield" />}
      <div
        className="resumeResizer"
        onMouseDown={onMouseDown}
        onDoubleClick={() => setWidth(DEFAULT_WIDTH)}
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
