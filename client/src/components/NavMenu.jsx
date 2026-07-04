import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, Download, Grid, Map as MapIcon, MapPin, Menu } from 'react-feather';
import { useShell } from '../context/ShellContext.jsx';

const ROUTES = [
  { to: '/zipcodes', label: 'Zip Code Outline', Icon: MapIcon },
  { to: '/', label: 'Multiple Location Mapping', Icon: MapPin },
  { to: '/panel-stock-analysis', label: 'Panel Stock Analysis', Icon: Grid }
];

// Left hamburger popover: route entries plus the active page's Screenshot /
// Export actions (present only when the page registered handlers).
export default function NavMenu() {
  const { navHandlers } = useShell();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // Same guard as the legacy NavBar links: pages with unsaved temp addresses
  // block navigation and open their save-or-discard modal instead. Close the
  // menu either way so the modal isn't obstructed.
  function guardNavigation(e) {
    if (navHandlers.confirmLeave && !navHandlers.confirmLeave()) {
      e.preventDefault();
    }
    setOpen(false);
  }

  function runAction(action) {
    setOpen(false);
    action();
  }

  const hasActions = navHandlers.onScreenshot || navHandlers.onExport;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Open menu"
        aria-expanded={open}
        className="p-2 rounded-md text-gray-500 hover:text-gray-600 hover:bg-gray-100 focus:outline-none"
      >
        <Menu className="h-6 w-6" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-64 bg-white border border-gray-200 rounded-md shadow-lg z-50 py-1">
          {ROUTES.map(({ to, label, Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={guardNavigation}
              className="flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              <Icon className="mr-3 h-4 w-4 text-gray-400" />
              <span>{label}</span>
            </Link>
          ))}

          {hasActions && (
            <>
              <div className="my-1 border-t border-gray-200" />
              {navHandlers.onScreenshot && (
                <button
                  onClick={() => runAction(navHandlers.onScreenshot)}
                  className="w-full flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Camera className="mr-3 h-4 w-4 text-blue-600" />
                  <span>Screenshot</span>
                </button>
              )}
              {navHandlers.onExport && (
                <button
                  onClick={() => runAction(navHandlers.onExport)}
                  className="w-full flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <Download className="mr-3 h-4 w-4 text-green-600" />
                  <span>Export</span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
