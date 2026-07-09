import { useEffect } from 'react';
import { X } from 'react-feather';

// Shared modal wrapper matching the legacy markup pattern:
// fixed overlay + centered card, closes on Escape and backdrop click.
export default function Modal({ open, onClose, title, maxWidth = 'max-w-2xl', children, closable = true }) {
  useEffect(() => {
    if (!open || !closable) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closable, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50"
      onMouseDown={(e) => {
        if (closable && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal-content relative top-20 mx-auto p-5 border w-11/12 ${maxWidth} shadow-lg rounded-md bg-white`}>
        <div className="mt-3">
          {title && (
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium text-gray-900">{title}</h3>
              {closable && (
                <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                  <X className="h-6 w-6" />
                </button>
              )}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
