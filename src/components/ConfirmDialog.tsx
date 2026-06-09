import { AlertTriangle, Check, X } from 'lucide-react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// In-app confirmation modal. Reuses the .modal styles so confirmations match
// the rest of the UI instead of relying on the native window.confirm dialog,
// which Electron renders inconsistently and which we never want to use.
export default function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  return (
    <div className="modalBackdrop" onClick={onCancel}>
      <div className="modal confirmModal" onClick={(e) => e.stopPropagation()}>
        <h3>{danger && <AlertTriangle size={17} />} {title}</h3>
        <p className="modalSub">{message}</p>
        <div className="modalActions">
          <button className="ghost" onClick={onCancel}><X size={15} /> {cancelLabel}</button>
          <button className={danger ? 'danger' : ''} onClick={onConfirm}>
            <Check size={15} /> {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
