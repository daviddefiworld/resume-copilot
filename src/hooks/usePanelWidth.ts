import { useCallback, useEffect, useRef, useState } from 'react';

interface PanelWidth {
  width: number;
  // True while a drag is in progress, so the panel can mount a shield over any
  // iframe that would otherwise swallow the mouse events and stall the resize.
  isDragging: boolean;
  // Attach to the left-edge resizer's onMouseDown.
  onResizeStart: (event: React.MouseEvent) => void;
  // Restore the default width (e.g. on resizer double-click).
  reset: () => void;
}

// Drag-resizable width for a right-docked side panel, persisted to localStorage.
// The panel sits against the right edge, so width tracks the distance from the
// pointer to the right of the window. Shared by the resume and workspace panels.
export function usePanelWidth(storageKey: string, defaultWidth: number, minWidth: number): PanelWidth {
  const clamp = useCallback(
    (px: number) => Math.max(minWidth, Math.min(px, Math.round(window.innerWidth * 0.82))),
    [minWidth],
  );

  const [width, setWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem(storageKey));
    return saved >= minWidth ? saved : defaultWidth;
  });
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);

  const onResizeStart = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    dragging.current = true;
    setIsDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const reset = useCallback(() => {
    setWidth(defaultWidth);
    localStorage.setItem(storageKey, String(defaultWidth));
  }, [defaultWidth, storageKey]);

  useEffect(() => {
    function onMove(event: MouseEvent): void {
      if (!dragging.current) return;
      setWidth(clamp(window.innerWidth - event.clientX));
    }
    function onUp(): void {
      if (!dragging.current) return;
      dragging.current = false;
      setIsDragging(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setWidth((w) => {
        localStorage.setItem(storageKey, String(w));
        return w;
      });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [clamp, storageKey]);

  return { width, isDragging, onResizeStart, reset };
}
