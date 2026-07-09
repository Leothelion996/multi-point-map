import { createContext, useCallback, useContext, useRef, useState } from 'react';

// Port of the legacy showPopup/dismissPopup toast system (script.js + shared.js).
// Same classes (.popup-notification etc., styled by shared.css), same defaults:
// every type auto-dismisses after 2s unless a duration is given.

const PopupContext = createContext(null);

const DEFAULT_DURATION = 2000;
const ICONS = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' };
const DEFAULT_TITLES = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Information' };

export function PopupProvider({ children }) {
  const [popups, setPopups] = useState([]);
  const counterRef = useRef(0);

  const dismissPopup = useCallback((id) => {
    // Two-step removal so the slideOutRight animation plays
    setPopups((prev) => prev.map((p) => (p.id === id ? { ...p, removing: true } : p)));
    setTimeout(() => {
      setPopups((prev) => prev.filter((p) => p.id !== id));
    }, 300);
  }, []);

  const showPopup = useCallback((type, message, title = null, duration = null) => {
    const id = `popup-${++counterRef.current}`;
    const autoDismiss = duration !== null ? duration : DEFAULT_DURATION;
    setPopups((prev) => [...prev, { id, type, message, title, autoDismiss, removing: false }]);
    if (autoDismiss) setTimeout(() => dismissPopup(id), autoDismiss);
    return id;
  }, [dismissPopup]);

  return (
    <PopupContext.Provider value={{ showPopup, dismissPopup }}>
      {children}
      <div id="popup-container" className="fixed top-4 right-4 z-50 space-y-2">
        {popups.map((p) => (
          <div key={p.id} className={`popup-notification ${p.type}${p.removing ? ' removing' : ''}`}>
            <div className="popup-icon">{ICONS[p.type] || 'ℹ'}</div>
            <div className="popup-content">
              <div className="popup-title">{p.title || DEFAULT_TITLES[p.type]}</div>
              <div className="popup-message">{p.message}</div>
            </div>
            <button className="popup-close" onClick={() => dismissPopup(p.id)}>✕</button>
            {p.autoDismiss ? (
              <div className="popup-progress">
                <div className="popup-progress-bar" style={{ animation: `shrink ${p.autoDismiss}ms linear forwards` }} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </PopupContext.Provider>
  );
}

export function usePopups() {
  return useContext(PopupContext);
}
