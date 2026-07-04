import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'react-feather';
import { usePanelStockMap } from '../hooks/usePanelStockMap.js';
import { useShell } from '../context/ShellContext.jsx';
import { usePopups } from '../context/PopupContext.jsx';
import NewPanelStockUploadModal from '../components/modals/NewPanelStockUploadModal.jsx';
import { readPanelStockUploads } from '../lib/panelStockStorage.js';
import { takeMapScreenshot } from '../lib/screenshot.js';
import { downloadBlob } from '../lib/csvExport.js';

// Panel Stock Analysis: ZIP polygon outlines (like the Zip Codes page) merged
// with a centered stock-count icon per ZIP. Data comes from sessionStorage
// upload versions, not the server groups API — see usePanelStockMap.
export default function PanelStockAnalysisPage() {
  const { showPopup } = usePopups();
  const { sidebarOpen, setNavHandlers } = useShell();
  const [uploads, setUploads] = useState(() => readPanelStockUploads());
  const [selectedUploadId, setSelectedUploadId] = useState(() => readPanelStockUploads()[0]?.id ?? '');
  const [hideEmpty, setHideEmpty] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [screenshotBusy, setScreenshotBusy] = useState(false);

  const activeUpload = uploads.find((u) => u.id === selectedUploadId) || null;
  const locations = useMemo(() => activeUpload?.locations ?? [], [activeUpload]);

  const engine = usePanelStockMap({ locations, hideEmpty });

  // Same body-level viewport lock as MapPage (body.map-page in map.css)
  useEffect(() => {
    document.body.classList.add('map-page');
    return () => document.body.classList.remove('map-page');
  }, []);

  // Map tiles need a resize nudge after the sidebar slides
  useEffect(() => {
    const timeout = setTimeout(() => engine.triggerResize(), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarOpen]);

  useEffect(() => {
    function onResize() { engine.triggerResize(); }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // List items mirror what the map renders; the hide-empty filter applies to
  // both so screenshots match the visible map.
  const listItems = useMemo(
    () => locations
      .map((location) => ({
        title: location.title || `ZIP ${location.zipCode}`,
        number: location.number ?? 0,
        color: location.color || '#3b82f6'
      }))
      .filter((item) => !(hideEmpty && item.number === 0)),
    [locations, hideEmpty]
  );

  async function handleScreenshot() {
    if (screenshotBusy) return;
    if (!activeUpload) {
      showPopup('warning', 'Create or select a Panel Stock upload first to take a screenshot.', 'Upload Required');
      return;
    }
    setScreenshotBusy(true);
    try {
      await takeMapScreenshot({ groupName: activeUpload.title, items: listItems });
      showPopup('success', 'Screenshot saved successfully!', 'Screenshot Complete');
    } catch (error) {
      console.error('Screenshot error:', error);
      showPopup('error', 'Failed to capture screenshot. Please try again.', 'Screenshot Failed');
    } finally {
      setScreenshotBusy(false);
    }
  }

  function handleExport() {
    if (!activeUpload || locations.length === 0) {
      showPopup('warning', 'No panel stock data to export yet.', 'Nothing to Export');
      return;
    }
    const rows = [
      ['ZIP Code', 'Title', 'Number'],
      ...locations.map((location) => [location.zipCode, location.title || '', String(location.number ?? 0)])
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `${activeUpload.title.replace(/[^a-z0-9]/gi, '_')}_Panel_Stock.csv`);
  }

  // Register nav-level actions (Screenshot/Export in the hamburger popover);
  // no confirmLeave — this page has no unsaved temp concept.
  useEffect(() => {
    setNavHandlers({
      onScreenshot: handleScreenshot,
      onExport: handleExport
    });
    return () => setNavHandlers({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUpload, listItems, screenshotBusy]);

  function handleUploadCreated(upload) {
    setUploads(readPanelStockUploads());
    setSelectedUploadId(upload.id);
    setUploadModalOpen(false);
  }

  return (
    <div className="flex h-screen">
      <div
        id="map-container"
        className={`flex-1 ${sidebarOpen ? 'mr-64' : 'mr-0'} transition-all duration-300 relative`}
      >
        {engine.mapError ? (
          <div className="w-full h-full flex items-center justify-center bg-gray-100 text-gray-500">
            <div className="text-center">
              <h3 className="font-medium mb-2">Map Configuration Error</h3>
              <p className="text-sm">Unable to load Google Maps. Please check the server connection.</p>
            </div>
          </div>
        ) : (
          <div id="map" ref={engine.mapDivRef} className="w-full h-full" />
        )}

        {/* Compact control strip for upload versions, floating over the map */}
        <div className="absolute top-3 left-3 z-10 bg-white rounded-md shadow-md border border-gray-200 px-3 py-2 flex items-center space-x-3">
          <select
            value={selectedUploadId}
            onChange={(e) => setSelectedUploadId(e.target.value)}
            className="border border-gray-300 rounded-md text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 max-w-48"
          >
            {uploads.length === 0 && <option value="">No uploads yet</option>}
            {uploads.map((upload) => (
              <option key={upload.id} value={upload.id}>{upload.title}</option>
            ))}
          </select>
          <button
            onClick={() => setUploadModalOpen(true)}
            className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none"
          >
            <Plus className="mr-1 h-4 w-4" /> New Upload
          </button>
          <label className="inline-flex items-center text-sm text-gray-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideEmpty}
              onChange={(e) => setHideEmpty(e.target.checked)}
              className="mr-1.5 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
            Hide all empty locations
          </label>
        </div>
      </div>

      {/* Right panel: same shell/ids as the shared Sidebar (CSS contract) */}
      <div
        id="sidebar"
        className={`sidebar ${sidebarOpen ? 'sidebar-open' : 'sidebar-closed'} bg-white w-64 border-l border-gray-200 fixed right-0 z-10 flex flex-col`}
      >
        <div className="flex-shrink-0 p-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Panel Stock</h2>
          {activeUpload && (
            <p className="text-xs text-gray-500 mt-1 truncate">{activeUpload.fileName}</p>
          )}
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 pb-8 space-y-2">
            {!activeUpload && (
              <p className="text-sm text-gray-500 italic">Create a new upload to get started.</p>
            )}
            {activeUpload && listItems.length === 0 && (
              <p className="text-sm text-gray-500 italic">
                {locations.length === 0
                  ? 'No locations in this upload yet. ZIP data will appear here once spreadsheet parsing is available.'
                  : 'All locations are empty and hidden.'}
              </p>
            )}
            {listItems.map((item, index) => (
              <div key={`${item.title}-${index}`} className="flex items-center p-2 bg-gray-50 rounded-md">
                <span
                  className="flex-shrink-0 w-6 h-6 rounded-full text-white text-xs font-bold flex items-center justify-center mr-2"
                  style={{ backgroundColor: item.color }}
                >
                  {item.number}
                </span>
                <span className="text-sm text-gray-700 truncate">{item.title}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <NewPanelStockUploadModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onCreated={handleUploadCreated}
      />
    </div>
  );
}
