import { useEffect, useState } from 'react';
import { useMapEngine } from '../hooks/useMapEngine.js';
import { useShell } from '../context/ShellContext.jsx';
import { usePopups } from '../context/PopupContext.jsx';
import Sidebar from '../components/Sidebar.jsx';
import BulkUploadModal from '../components/modals/BulkUploadModal.jsx';
import BulkProgressModal from '../components/modals/BulkProgressModal.jsx';
import BulkResultsModal from '../components/modals/BulkResultsModal.jsx';
import SaveTempModal from '../components/modals/SaveTempModal.jsx';
import ExportModal from '../components/modals/ExportModal.jsx';
import { takeMapScreenshot } from '../lib/screenshot.js';

// Shared map page for both routes; groupType ('locations' | 'zipcodes')
// drives all behavioral differences, replacing the legacy body[data-group-type].
export default function MapPage({ groupType }) {
  const engine = useMapEngine(groupType);
  const { showPopup } = usePopups();
  const { sidebarOpen, setNavHandlers } = useShell();
  const [exportOpen, setExportOpen] = useState(false);

  // The legacy map pages set body-level overflow/height locks via body.map-page
  useEffect(() => {
    document.body.classList.add('map-page');
    return () => document.body.classList.remove('map-page');
  }, []);

  // Map tiles need a resize nudge after the sidebar slides (script.js:1707)
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

  async function handleScreenshot() {
    if (engine.screenshotBusy) return;
    if (!engine.currentGroupId) {
      showPopup('warning', 'Please select a location group first to take a screenshot.', 'Group Required');
      return;
    }
    const currentGroup = engine.groups.find((g) => g.id === engine.currentGroupId);
    if (!currentGroup) {
      showPopup('error', 'Selected group not found.', 'Group Error');
      return;
    }

    engine.setScreenshotBusy(true);
    try {
      await takeMapScreenshot({ groupName: currentGroup.name, items: engine.items });
      showPopup('success', 'Screenshot saved successfully!', 'Screenshot Complete');
    } catch (error) {
      console.error('Screenshot error:', error);
      showPopup('error', 'Failed to capture screenshot. Please try again.', 'Screenshot Failed');
    } finally {
      engine.setScreenshotBusy(false);
    }
  }

  // Register nav-level actions; confirmLeave guards navigation away from
  // unsaved temp addresses (replaces the legacy beforeunload-only guard).
  useEffect(() => {
    setNavHandlers({
      onScreenshot: handleScreenshot,
      onExport: () => setExportOpen(true),
      confirmLeave: () => {
        if (engine.hasTemp) {
          engine.openSaveTempModal();
          return false;
        }
        return true;
      }
    });
    return () => setNavHandlers({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.hasTemp, engine.currentGroupId, engine.groups, engine.items, engine.screenshotBusy]);

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
      </div>

      <Sidebar engine={engine} groupType={groupType} open={sidebarOpen} />

      <BulkUploadModal engine={engine} groupType={groupType} />
      <BulkProgressModal engine={engine} groupType={groupType} />
      <BulkResultsModal engine={engine} />
      <SaveTempModal engine={engine} />
      <ExportModal engine={engine} open={exportOpen} onClose={() => setExportOpen(false)} />
    </div>
  );
}
