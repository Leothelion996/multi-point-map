import { createContext, useContext, useMemo, useState } from 'react';

// Shell-level UI state shared between the NavBar and the active page:
// - sidebar open/closed (nav owns the toggle button, MapPage renders the sidebar)
// - nav action handlers (screenshot/export live in the nav but act on map state;
//   the active map page registers them, other pages leave them unset and the
//   buttons hide themselves)
const ShellContext = createContext(null);

export function ShellProvider({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [navHandlers, setNavHandlers] = useState({});

  const value = useMemo(() => ({
    sidebarOpen,
    toggleSidebar: () => setSidebarOpen((open) => !open),
    navHandlers,
    setNavHandlers
  }), [sidebarOpen, navHandlers]);

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell() {
  return useContext(ShellContext);
}
