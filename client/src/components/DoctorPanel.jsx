import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus } from 'react-feather';
import RequireRole from './RequireRole.jsx';
import { doctorDisplayName } from '../hooks/useDoctorLocationsEngine.js';

// "Select a doctor" dropdown, modeled on GroupPanel's custom dropdown.
// Selecting a doctor plots their DWC locations the way selecting a group
// plots its markers. The "create new" affordance opens the add-doctor form
// in the Manage Doctors section (more fields than a group name).
export default function DoctorPanel({ engine, onCreateNew }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const containerRef = useRef(null);

  const {
    doctors, currentDoctorId, selectDoctor,
    includeInactiveDoctors, setIncludeInactiveDoctors
  } = engine;

  const selectedDoctor = doctors.find((doctor) => doctor.id === currentDoctorId);
  const selectedText = selectedDoctor ? doctorDisplayName(selectedDoctor) : 'Select a doctor';

  // Close dropdown when clicking outside (same idiom as GroupPanel)
  useEffect(() => {
    if (!dropdownOpen) return undefined;
    function onDocClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [dropdownOpen]);

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">Doctor</label>
      <div className="flex space-x-2">
        <div className="flex-1 relative" ref={containerRef}>
          <button
            onClick={() => setDropdownOpen((open) => !open)}
            className={`w-full pl-3 pr-10 py-2 text-base border focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md bg-white text-left ${
              selectedDoctor ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-300'
            }`}
          >
            <span>{selectedText}</span>
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </div>
          </button>

          {dropdownOpen && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
              {doctors.length === 0 && (
                <div className="px-3 py-2 text-sm text-gray-500">No doctors yet</div>
              )}
              {doctors.map((doctor) => (
                <div
                  key={doctor.id}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 cursor-pointer"
                  onClick={() => {
                    setDropdownOpen(false);
                    selectDoctor(doctor.id);
                  }}
                >
                  <span className={`flex-1 text-sm ${doctor.isActive === false ? 'text-gray-400' : 'text-gray-900'}`}>
                    {doctorDisplayName(doctor)}
                    {doctor.isActive === false && ' (inactive)'}
                  </span>
                  {doctor.locationCount != null && (
                    <span className="ml-2 text-xs text-gray-400">{doctor.locationCount}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <RequireRole allow={['admin', 'staff']}>
          <button
            onClick={onCreateNew}
            className="px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none"
            title="Add new doctor"
          >
            <Plus className="h-4 w-4" />
          </button>
        </RequireRole>
      </div>
      <label className="mt-2 flex items-center text-xs text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={includeInactiveDoctors}
          onChange={(e) => setIncludeInactiveDoctors(e.target.checked)}
          className="mr-2 h-3.5 w-3.5"
        />
        Include inactive doctors
      </label>
      <p className="text-xs text-gray-500 mt-1">
        Select a doctor to see their registered DWC office locations.
      </p>
    </div>
  );
}
