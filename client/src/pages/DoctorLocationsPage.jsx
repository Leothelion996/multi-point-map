import { useEffect, useState } from 'react';
import { Users } from 'react-feather';
import { useDoctorLocationsEngine } from '../hooks/useDoctorLocationsEngine.js';
import { useShell } from '../context/ShellContext.jsx';
import RequireRole from '../components/RequireRole.jsx';
import DoctorSidebar from '../components/DoctorSidebar.jsx';
import SyncPopover from '../components/SyncPopover.jsx';
import ManageDoctorsPopover from '../components/ManageDoctorsPopover.jsx';
import AddDoctorModal from '../components/modals/AddDoctorModal.jsx';

// Plays MapPage.jsx's structural role for the /doctor-locations route, but is
// its own component wired to useDoctorLocationsEngine (doctor-based data with
// status/classification/geocode fields the generic group engine doesn't have).
export default function DoctorLocationsPage() {
  const engine = useDoctorLocationsEngine();
  const { sidebarOpen, setNavHandlers } = useShell();
  const [syncPopoverOpen, setSyncPopoverOpen] = useState(false);
  const [manageDoctorsOpen, setManageDoctorsOpen] = useState(false);
  const [addDoctorModalOpen, setAddDoctorModalOpen] = useState(false);

  // Same body-level overflow/height locks as the other map pages
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

  // Register the "DWC Sync" menu action; the popover it opens reads live
  // state from the engine, so it needs no data threaded through here.
  useEffect(() => {
    setNavHandlers({ onOpenSync: () => setSyncPopoverOpen(true) });
    return () => setNavHandlers({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

        {/* Floating control strip, same placement/style as Panel Stock's "New Upload" button */}
        <RequireRole allow={['admin', 'staff']}>
          <div className="absolute top-3 left-3 z-10 bg-white rounded-md shadow-md border border-gray-200 px-3 py-2">
            <button
              onClick={() => setManageDoctorsOpen((o) => !o)}
              className="inline-flex items-center px-3 py-1.5 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none"
            >
              <Users className="mr-1 h-4 w-4" /> Manage Doctors
            </button>
          </div>
        </RequireRole>
      </div>

      <DoctorSidebar engine={engine} open={sidebarOpen} onCreateDoctor={() => setAddDoctorModalOpen(true)} />
      <SyncPopover engine={engine} open={syncPopoverOpen} onClose={() => setSyncPopoverOpen(false)} />
      <ManageDoctorsPopover
        engine={engine}
        open={manageDoctorsOpen}
        onClose={() => setManageDoctorsOpen(false)}
        onAddDoctor={() => setAddDoctorModalOpen(true)}
      />
      <AddDoctorModal
        engine={engine}
        open={addDoctorModalOpen}
        onClose={() => setAddDoctorModalOpen(false)}
      />
    </div>
  );
}
