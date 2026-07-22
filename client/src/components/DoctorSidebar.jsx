import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Edit2, RefreshCw, RotateCcw, Trash2, UserCheck, UserX } from 'react-feather';
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

const CLASSIFICATIONS = ['pme', 'not_pme', 'needs_review'];
const ROLES = ['admin', 'staff', 'viewer'];
const TERMINAL_RUN_STATUSES = ['completed', 'completed_with_errors', 'failed'];

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
    setClassification, clearClassificationOverride,
    fitMapToMarkers, fineZoomIn, fineZoomOut, zoomDisplay,
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

  function renderClassificationControls(location) {
    return (
      <RequireRole allow={['admin', 'staff']}>
        <div className="flex items-center space-x-1 mt-1">
          <select
            value={location.classification || 'needs_review'}
            onChange={(e) => setClassification(location.id, e.target.value)}
            className="text-xs border border-gray-300 rounded px-1 py-0.5 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
            title="Override classification"
          >
            {CLASSIFICATIONS.map((value) => (
              <option key={value} value={value}>{classificationLabel(value)}</option>
            ))}
          </select>
          {location.classificationOverride && (
            <button
              onClick={() => clearClassificationOverride(location.id)}
              className="text-gray-400 hover:text-gray-600 p-0.5"
              title="Clear manual override (next sync will auto-classify)"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </RequireRole>
    );
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

      {/* Fine zoom controls (same block as MarkerListPanel) */}
      <div className="mb-3 p-2 bg-gray-50 rounded border">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-700">Fine Zoom</span>
          <div className="flex items-center space-x-1">
            <button
              onClick={fineZoomOut}
              className="w-6 h-6 flex items-center justify-center text-xs border border-gray-300 rounded text-gray-600 hover:text-gray-800 hover:bg-white focus:outline-none"
              title="Zoom out"
            >
              −
            </button>
            <span className="text-xs text-gray-500 min-w-8 text-center">{zoomDisplay}</span>
            <button
              onClick={fineZoomIn}
              className="w-6 h-6 flex items-center justify-center text-xs border border-gray-300 rounded text-gray-600 hover:text-gray-800 hover:bg-white focus:outline-none"
              title="Zoom in"
            >
              +
            </button>
          </div>
        </div>
      </div>

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
          return (
            <div
              key={location.id}
              className={`marker-list-item${isSelected ? ' selected active' : ''}`}
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
                {location.specialty && <div className="text-xs text-gray-500">{location.specialty}</div>}
                <div className="flex items-center space-x-1 mt-1">
                  <ClassificationBadge classification={location.classification} />
                  {location.classificationOverride && (
                    <span className="text-xs text-gray-400" title="Manually overridden">manual</span>
                  )}
                </div>
                {renderClassificationControls(location)}
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
// Run Now panel (Admin/Staff): trigger + 2s polling + results summary
// ================================

function SyncPanel({ engine }) {
  const { showPopup } = usePopups();
  const [run, setRun] = useState(null);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const pollTimerRef = useRef(null);

  const isRunning = run?.status === 'running';

  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  useEffect(() => stopPolling, []);

  // Show the most recent run on mount (and resume polling if one is running)
  useEffect(() => {
    let cancelled = false;
    dwcSyncApi.fetchSyncRuns({ limit: 1 })
      .then((fetched) => {
        if (cancelled) return;
        const list = Array.isArray(fetched) ? fetched : (fetched?.runs || []);
        if (list.length > 0) {
          setRun(list[0]);
          if (list[0].status === 'running') startPolling(list[0].id);
        }
      })
      .catch((error) => console.error('Error fetching sync runs:', error));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadResults(runId) {
    try {
      const fetched = await dwcSyncApi.fetchSyncRunResults(runId);
      setResults(Array.isArray(fetched) ? fetched : (fetched?.results || []));
    } catch (error) {
      console.error('Error fetching sync run results:', error);
    }
  }

  function startPolling(runId) {
    stopPolling();
    setResults(null);
    pollTimerRef.current = setInterval(async () => {
      try {
        const latest = await dwcSyncApi.fetchSyncRun(runId);
        setRun(latest);
        if (TERMINAL_RUN_STATUSES.includes(latest.status)) {
          stopPolling();
          loadResults(runId);
          // Sync may have added/removed locations: refresh what's on screen
          engine.refreshDoctors();
          engine.reloadLocations();
        }
      } catch (error) {
        console.error('Error polling sync run:', error);
      }
    }, 2000);
  }

  async function handleRunNow() {
    if (busy || isRunning) return;
    setBusy(true);
    try {
      const created = await dwcSyncApi.triggerSync();
      setRun(created);
      startPolling(created.id);
      showPopup('info', 'Sync started. Progress will update below.', 'Sync Running');
    } catch (error) {
      if (error.status === 409) {
        showPopup('warning', 'A sync is already running. Showing its progress.', 'Sync In Progress');
        // Pick up the in-flight run and poll it
        try {
          const fetched = await dwcSyncApi.fetchSyncRuns({ limit: 5 });
          const list = Array.isArray(fetched) ? fetched : (fetched?.runs || []);
          const running = list.find((r) => r.status === 'running');
          if (running) {
            setRun(running);
            startPolling(running.id);
          }
        } catch (fetchError) {
          console.error('Error fetching running sync:', fetchError);
        }
      } else {
        console.error('Error triggering sync:', error);
        showPopup('error', `Failed to start sync: ${error.message}`, 'Sync Failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryFailed() {
    if (!run || busy) return;
    setBusy(true);
    try {
      const created = await dwcSyncApi.retryFailed(run.id);
      setRun(created);
      startPolling(created.id);
      showPopup('info', 'Retrying failed doctors...', 'Retry Started');
    } catch (error) {
      console.error('Error retrying failed doctors:', error);
      showPopup('error', `Failed to start retry: ${error.message}`, 'Retry Failed');
    } finally {
      setBusy(false);
    }
  }

  const failedResults = (results || []).filter((r) => r.status === 'error');

  return (
    <div className="border-t border-gray-200 pt-4 mt-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-900">DWC Sync</h3>
        <RequireRole allow={['admin', 'staff']}>
          <Button
            variant="primary"
            className="text-xs px-3 py-1.5"
            onClick={handleRunNow}
            disabled={busy || isRunning}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isRunning ? 'animate-spin' : ''}`} />
            {isRunning ? 'Running...' : 'Run Now'}
          </Button>
        </RequireRole>
      </div>

      {!run && <p className="text-xs text-gray-500">No syncs have been run yet.</p>}

      {run && (
        <div className="text-xs text-gray-600 space-y-1">
          <div>
            <span className="font-medium">Last run:</span>{' '}
            {run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}
          </div>
          <div>
            <span className="font-medium">Status:</span>{' '}
            <span className={
              run.status === 'failed' ? 'text-red-600'
                : run.status === 'completed_with_errors' ? 'text-amber-600'
                  : run.status === 'completed' ? 'text-green-600' : 'text-blue-600'
            }>
              {run.status}
            </span>
          </div>
          {isRunning && (
            <div>
              <span className="font-medium">Progress:</span>{' '}
              {run.processedCount ?? 0} of {run.doctorCount ?? '?'} doctors
            </div>
          )}
          {!isRunning && (
            <div>
              <span className="font-medium">Results:</span>{' '}
              {run.successCount ?? 0} ok, {run.errorCount ?? 0} errors
              {run.errorSummary && <div className="text-red-600">{run.errorSummary}</div>}
            </div>
          )}
        </div>
      )}

      {failedResults.length > 0 && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-medium text-red-800">Failed Doctors</h4>
            <RequireRole allow={['admin', 'staff']}>
              <button
                onClick={handleRetryFailed}
                disabled={busy}
                className="text-xs px-2 py-0.5 border border-red-300 rounded text-red-700 hover:bg-red-100 focus:outline-none disabled:opacity-50"
              >
                Retry Failed
              </button>
            </RequireRole>
          </div>
          <div className="space-y-1">
            {failedResults.map((result) => (
              <div key={result.id || result.doctorId} className="text-xs text-gray-600">
                <span className="font-medium">
                  {result.doctorName || doctorDisplayName(result) || result.doctorId}
                </span>
                {result.errorDetail && <span>: {result.errorDetail}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ================================
// Manage Doctors (Admin/Staff): add form + edit/deactivate/delete list
// ================================

const EMPTY_DOCTOR_FORM = { firstName: '', lastName: '', specialtyHint: '', notes: '' };

function DoctorForm({ initial = EMPTY_DOCTOR_FORM, submitLabel, onSubmit, onCancel, firstInputRef }) {
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const inputClass = 'block w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500';

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        specialtyHint: form.specialtyHint.trim() || undefined,
        notes: form.notes.trim() || undefined
      });
      setForm(EMPTY_DOCTOR_FORM);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input ref={firstInputRef} type="text" required placeholder="First name" value={form.firstName} onChange={set('firstName')} className={inputClass} />
        <input type="text" required placeholder="Last name" value={form.lastName} onChange={set('lastName')} className={inputClass} />
      </div>
      <input type="text" placeholder="Specialty hint (optional)" value={form.specialtyHint} onChange={set('specialtyHint')} className={inputClass} />
      <input type="text" placeholder="Notes (optional)" value={form.notes} onChange={set('notes')} className={inputClass} />
      <div className="flex space-x-2">
        <Button type="submit" variant="success" className="text-xs px-3 py-1.5" disabled={submitting}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" className="text-xs px-3 py-1.5" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

function ManageDoctorsSection({ engine, open, setOpen, addFormRef }) {
  const { showPopup } = usePopups();
  const { doctors, createDoctor, updateDoctor, setDoctorActive, deleteDoctor } = engine;
  const [editingId, setEditingId] = useState(null);

  async function handleAdd(payload) {
    try {
      const doctor = await createDoctor(payload);
      showPopup('success', `Added ${doctorDisplayName(doctor) || 'doctor'} to the roster.`, 'Doctor Added');
    } catch (error) {
      console.error('Error creating doctor:', error);
      showPopup('error', `Failed to add doctor: ${error.message}`, 'Add Failed');
      throw error;
    }
  }

  async function handleEdit(doctorId, payload) {
    try {
      await updateDoctor(doctorId, payload);
      setEditingId(null);
      showPopup('success', 'Doctor updated.', 'Doctor Updated');
    } catch (error) {
      console.error('Error updating doctor:', error);
      showPopup('error', `Failed to update doctor: ${error.message}`, 'Update Failed');
    }
  }

  async function handleToggleActive(doctor) {
    const name = doctorDisplayName(doctor);
    const deactivating = doctor.isActive !== false;
    const message = deactivating
      ? `Deactivate ${name}? They will be excluded from syncs and hidden from the doctor list, but their location history is kept.`
      : `Reactivate ${name}? They will be included in future syncs again.`;
    if (!window.confirm(message)) return;
    try {
      await setDoctorActive(doctor.id, !deactivating);
      showPopup('success', `${name} ${deactivating ? 'deactivated' : 'reactivated'}.`, 'Doctor Updated');
    } catch (error) {
      console.error('Error updating doctor active state:', error);
      showPopup('error', `Failed to update doctor: ${error.message}`, 'Update Failed');
    }
  }

  // Hard delete cascades to all DWC locations, events, and check history —
  // hence the strong confirm wording. Deactivation is the soft path.
  async function handleDelete(doctor) {
    const name = doctorDisplayName(doctor);
    if (!window.confirm(
      `PERMANENTLY DELETE ${name}?\n\nThis erases the doctor AND their entire DWC location history, audit events, and check results. This cannot be undone.\n\nIf you just want to stop tracking them, use Deactivate instead.`
    )) return;
    try {
      await deleteDoctor(doctor.id);
      showPopup('success', `${name} and all their history deleted.`, 'Doctor Deleted');
    } catch (error) {
      console.error('Error deleting doctor:', error);
      showPopup('error', `Failed to delete doctor: ${error.message}`, 'Delete Failed');
    }
  }

  return (
    <div className="border-t border-gray-200 pt-4 mt-6">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-sm font-medium text-gray-900 focus:outline-none"
      >
        <span>Manage Doctors</span>
        {open ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div className="p-2 bg-gray-50 rounded border">
            <h4 className="text-xs font-medium text-gray-700 mb-2">Add Doctor</h4>
            <DoctorForm submitLabel="Add Doctor" onSubmit={handleAdd} firstInputRef={addFormRef} />
          </div>

          <div className="space-y-2">
            {doctors.map((doctor) => (
              <div key={doctor.id} className="p-2 border border-gray-200 rounded">
                {editingId === doctor.id ? (
                  <DoctorForm
                    initial={{
                      firstName: doctor.firstName || '',
                      lastName: doctor.lastName || '',
                      specialtyHint: doctor.specialtyHint || '',
                      notes: doctor.notes || ''
                    }}
                    submitLabel="Save"
                    onSubmit={(payload) => handleEdit(doctor.id, payload)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm ${doctor.isActive === false ? 'text-gray-400' : 'text-gray-800'}`}>
                        {doctorDisplayName(doctor)}
                        {doctor.isActive === false && ' (inactive)'}
                      </span>
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => setEditingId(doctor.id)}
                          className="text-gray-400 hover:text-blue-600 p-1"
                          title="Edit doctor"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleToggleActive(doctor)}
                          className="text-gray-400 hover:text-amber-600 p-1"
                          title={doctor.isActive === false ? 'Reactivate doctor' : 'Deactivate doctor'}
                        >
                          {doctor.isActive === false
                            ? <UserCheck className="h-3.5 w-3.5" />
                            : <UserX className="h-3.5 w-3.5" />}
                        </button>
                        <RequireRole allow={['admin']}>
                          <button
                            onClick={() => handleDelete(doctor)}
                            className="text-gray-400 hover:text-red-600 p-1"
                            title="Permanently delete doctor and all history"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </RequireRole>
                      </div>
                    </div>
                    {doctor.lastCheckStatus && (
                      <div className="text-xs text-gray-500 mt-0.5">
                        Last check: {doctor.lastCheckStatus}
                        {doctor.lastCheckStatus === 'error' && doctor.lastCheckError && ` — ${doctor.lastCheckError}`}
                      </div>
                    )}
                  </>
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

export default function DoctorSidebar({ engine, open }) {
  const [manageDoctorsOpen, setManageDoctorsOpen] = useState(false);
  const addDoctorInputRef = useRef(null);

  // DoctorPanel's "create new" opens the add-doctor form here
  function openAddDoctorForm() {
    setManageDoctorsOpen(true);
    setTimeout(() => addDoctorInputRef.current?.focus(), 0);
  }

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
          <DoctorPanel engine={engine} onCreateNew={openAddDoctorForm} />
          <LocationListPanel engine={engine} />
          <SyncPanel engine={engine} />
          <RequireRole allow={['admin', 'staff']}>
            <ManageDoctorsSection
              engine={engine}
              open={manageDoctorsOpen}
              setOpen={setManageDoctorsOpen}
              addFormRef={addDoctorInputRef}
            />
          </RequireRole>
          <RequireRole allow={['admin']}>
            <ManageUsersSection />
          </RequireRole>
        </div>
      </div>
    </div>
  );
}
