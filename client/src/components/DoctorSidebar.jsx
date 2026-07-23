import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw } from 'react-feather';
import DoctorPanel from './DoctorPanel.jsx';
import RequireRole from './RequireRole.jsx';
import Button from './Button.jsx';
import { usePopups } from '../context/PopupContext.jsx';
import * as dwcSyncApi from '../api/dwcSync.js';
import * as usersApi from '../api/users.js';
import {
  classificationColor,
  classificationLabel,
  doctorDisplayName
} from '../hooks/useDoctorLocationsEngine.js';

const ROLES = ['admin', 'staff', 'viewer'];

function ClassificationBadge({ classification }) {
  return (
    <span
      className="inline-block px-1.5 py-0.5 rounded text-xs font-medium text-white"
      style={{ backgroundColor: classificationColor(classification) }}
    >
      {classificationLabel(classification)}
    </span>
  );
}

function locationAddressLine(location) {
  if (location.rawAddress) return location.rawAddress;
  const cityStateZip = [location.city, [location.state, location.zipCode].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');
  return [location.street, cityStateZip].filter(Boolean).join(', ');
}

// ================================
// Locations list (modeled on MarkerListPanel)
// ================================

function LocationListPanel({ engine }) {
  const { showPopup } = usePopups();
  const {
    currentDoctorId, locationsLoading,
    plottedLocations, ungeocodedLocations, selectedLocationId, selectLocationFromList,
    geocodePass, retryGeocoding,
    fitMapToMarkers,
    includeInactiveLocations, setIncludeInactiveLocations,
    reloadLocations, refreshDoctors
  } = engine;

  const [checking, setChecking] = useState(false);

  const seeAllDisabled = !currentDoctorId || plottedLocations.length === 0;

  // Single-doctor on-demand DWC check (Admin/Staff) — runs synchronously
  // server-side, then reloads this doctor's locations.
  async function handleCheckNow() {
    if (!currentDoctorId || checking) return;
    setChecking(true);
    try {
      await dwcSyncApi.checkDoctor(currentDoctorId);
      showPopup('success', 'DWC check complete. Refreshing locations...', 'Check Complete');
      reloadLocations();
      refreshDoctors();
    } catch (error) {
      console.error('Error checking doctor:', error);
      showPopup('error', `DWC check failed: ${error.message}`, 'Check Failed');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="border-t border-gray-200 pt-4 mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-900">DWC Locations</h3>
        <div className="flex items-center space-x-2">
          <RequireRole allow={['admin', 'staff']}>
            <button
              onClick={handleCheckNow}
              disabled={!currentDoctorId || checking}
              className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-600 hover:text-gray-800 hover:bg-gray-50 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              title="Run a DWC check for this doctor now"
            >
              {checking ? 'Checking...' : 'Check Now'}
            </button>
          </RequireRole>
          <button
            onClick={fitMapToMarkers}
            disabled={seeAllDisabled}
            className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-600 hover:text-gray-800 hover:bg-gray-50 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            title="Zoom to show all locations"
          >
            See All
          </button>
        </div>
      </div>

      <label className="mb-3 flex items-center text-xs text-gray-600 cursor-pointer">
        <input
          type="checkbox"
          checked={includeInactiveLocations}
          onChange={(e) => setIncludeInactiveLocations(e.target.checked)}
          className="mr-2 h-3.5 w-3.5"
        />
        Include delisted locations
      </label>

      {!currentDoctorId && (
        <p className="text-xs text-gray-500">Select a doctor to load their locations.</p>
      )}
      {currentDoctorId && locationsLoading && (
        <p className="text-xs text-gray-500">Loading locations...</p>
      )}
      {currentDoctorId && !locationsLoading && plottedLocations.length === 0 && ungeocodedLocations.length === 0 && (
        <p className="text-xs text-gray-500">No DWC locations on record for this doctor.</p>
      )}

      <div className="space-y-2">
        {plottedLocations.map((location) => {
          const isSelected = location.id === selectedLocationId;
          const isInactive = location.status === 'inactive';
          return (
            <div
              key={location.id}
              className={`marker-list-item${isSelected ? ' selected active' : ''}${isInactive ? ' opacity-60' : ''}`}
              onClick={(e) => {
                if (!e.target.closest('button') && !e.target.closest('select')) {
                  selectLocationFromList(location.id);
                }
              }}
            >
              <div
                className="marker-numbered-color-indicator"
                style={{ backgroundColor: classificationColor(location.classification) }}
              >
                {location.number}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-700 break-words">{locationAddressLine(location)}</div>
                {location.phone && <div className="text-xs text-gray-500">{location.phone}</div>}
                <div className="flex items-center space-x-1 mt-1">
                  <ClassificationBadge classification={location.classification} />
                  {location.classificationOverride && (
                    <span className="text-xs text-gray-400" title="Manually overridden">manual</span>
                  )}
                  {isInactive && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-600" title="No longer listed on DWC">
                      Delisted
                    </span>
                  )}
                </div>
                {isInactive && location.deactivatedAt && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    Delisted on {new Date(location.deactivatedAt).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Needs-geocoding section: rows never plotted as pins (Section 2) */}
      {currentDoctorId && (ungeocodedLocations.length > 0 || geocodePass.active) && (
        <div className="mt-4 p-2 bg-amber-50 border border-amber-200 rounded">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-medium text-amber-800">Needs Geocoding</h4>
            {!geocodePass.active && ungeocodedLocations.length > 0 && (
              <button
                onClick={retryGeocoding}
                className="text-xs px-2 py-0.5 border border-amber-300 rounded text-amber-700 hover:bg-amber-100 focus:outline-none"
                title="Retry geocoding the remaining addresses"
              >
                <span className="inline-flex items-center"><RefreshCw className="h-3 w-3 mr-1" /> Retry geocoding</span>
              </button>
            )}
          </div>
          {geocodePass.active && (
            <p className="text-xs text-amber-700 mb-1">
              Geocoding {geocodePass.done} of {geocodePass.total}...
              {geocodePass.failed > 0 && ` (${geocodePass.failed} failed)`}
            </p>
          )}
          <div className="space-y-1">
            {ungeocodedLocations.map((location) => (
              <div key={location.id} className="text-xs text-gray-600">
                <div className="break-words">{locationAddressLine(location)}</div>
                {location.geocodeStatus === 'failed' && (
                  <div className="text-red-600">{location.geocodeError || 'Geocoding failed'}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ================================
// Manage Users (Admin only): create-account form + role assignment
// ================================

function ManageUsersSection() {
  const { showPopup } = usePopups();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', role: 'staff' });
  const [submitting, setSubmitting] = useState(false);

  const inputClass = 'block w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

  async function loadUsers() {
    try {
      const fetched = await usersApi.fetchUsers();
      setUsers(Array.isArray(fetched) ? fetched : (fetched?.users || []));
      setLoaded(true);
    } catch (error) {
      console.error('Error fetching users:', error);
      showPopup('error', 'Failed to load users.', 'Load Failed');
    }
  }

  useEffect(() => {
    if (open && !loaded) loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.username.trim() || !form.password || submitting) return;
    setSubmitting(true);
    try {
      await usersApi.createUser({
        username: form.username.trim(),
        password: form.password,
        role: form.role
      });
      setForm({ username: '', password: '', role: 'staff' });
      showPopup('success', 'Account created.', 'User Created');
      loadUsers();
    } catch (error) {
      console.error('Error creating user:', error);
      showPopup('error', `Failed to create account: ${error.message}`, 'Create Failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRoleChange(user, role) {
    try {
      await usersApi.updateUserRole(user.id, role);
      setUsers((list) => list.map((u) => (u.id === user.id ? { ...u, role } : u)));
      showPopup('success', `${user.username} is now ${role}.`, 'Role Updated');
    } catch (error) {
      console.error('Error updating role:', error);
      showPopup('error', `Failed to update role: ${error.message}`, 'Update Failed');
    }
  }

  return (
    <div className="border-t border-gray-200 pt-4 mt-6">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-sm font-medium text-gray-900 focus:outline-none"
      >
        <span>Manage Users</span>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <form onSubmit={handleCreate} className="p-2 bg-gray-50 rounded border space-y-2">
            <h4 className="text-xs font-medium text-gray-700">Create Account</h4>
            <input
              type="text"
              required
              placeholder="Username"
              autoComplete="off"
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              className={inputClass}
            />
            <input
              type="password"
              required
              placeholder="Password"
              autoComplete="new-password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className={inputClass}
            />
            <select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
              className={inputClass}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>{role}</option>
              ))}
            </select>
            <Button type="submit" variant="success" className="text-xs px-3 py-1.5" disabled={submitting}>
              Create Account
            </Button>
          </form>

          <div className="space-y-2">
            {users.map((user) => (
              <div key={user.id} className="flex items-center justify-between p-2 border border-gray-200 rounded">
                <span className="text-sm text-gray-800 flex-1 break-all">{user.username}</span>
                <select
                  value={user.role || 'staff'}
                  onChange={(e) => handleRoleChange(user, e.target.value)}
                  className="ml-2 text-xs border border-gray-300 rounded px-1 py-0.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>{role}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ================================
// Sidebar shell (reuses Sidebar.jsx's outer markup/classes)
// ================================

export default function DoctorSidebar({ engine, open, onCreateDoctor }) {
  return (
    <div
      id="sidebar"
      className={`sidebar ${open ? 'sidebar-open' : 'sidebar-closed'} bg-white w-64 border-l border-gray-200 fixed right-0 z-10 flex flex-col`}
    >
      <div className="flex-shrink-0 p-4 border-b border-gray-200">
        <h2 className="text-lg font-medium text-gray-900">Doctor DWC Locations</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 pb-8 space-y-4">
          <DoctorPanel engine={engine} onCreateNew={onCreateDoctor} />
          <LocationListPanel engine={engine} />
          <RequireRole allow={['admin']}>
            <ManageUsersSection />
          </RequireRole>
        </div>
      </div>
    </div>
  );
}
