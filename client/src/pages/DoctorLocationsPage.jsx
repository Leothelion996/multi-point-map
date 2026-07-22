import { useEffect } from 'react';
import { useDoctorLocationsEngine } from '../hooks/useDoctorLocationsEngine.js';
import { useShell } from '../context/ShellContext.jsx';
import DoctorSidebar from '../components/DoctorSidebar.jsx';

// Plays MapPage.jsx's structural role for the /doctor-locations route, but is
// its own component wired to useDoctorLocationsEngine (doctor-based data with
// status/classification/geocode fields the generic group engine doesn't have).
export default function DoctorLocationsPage() {
  const engine = useDoctorLocationsEngine();
  const { sidebarOpen } = useShell();

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

      <DoctorSidebar engine={engine} open={sidebarOpen} />
    </div>
  );
}
