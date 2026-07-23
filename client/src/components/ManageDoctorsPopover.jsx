import { useEffect, useRef, useState } from 'react';
import { Edit2, Plus, Trash2, UserCheck, UserX, X } from 'react-feather';
import RequireRole from './RequireRole.jsx';
import DoctorForm from './DoctorForm.jsx';
import Button from './Button.jsx';
import { usePopups } from '../context/PopupContext.jsx';
import { doctorDisplayName } from '../hooks/useDoctorLocationsEngine.js';

// Doctor roster management, relocated from the sidebar into a popover
// anchored under the map-top "Manage Doctors" button (same trigger idiom as
// Panel Stock's "New Upload" button). Adding a doctor opens AddDoctorModal
// (owned by the page); this popover only lists/edits/deactivates/deletes.
export default function ManageDoctorsPopover({ engine, open, onClose, onAddDoctor }) {
  const containerRef = useRef(null);
  const { showPopup } = usePopups();
  const { doctors, updateDoctor, setDoctorActive, deleteDoctor } = engine;
  const [editingId, setEditingId] = useState(null);

  useEffect(() => {
    if (!open) return undefined;
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) onClose();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

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

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      className="fixed left-4 top-16 w-80 bg-white border border-gray-200 rounded-md shadow-lg z-50 p-4"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-900">Manage Doctors</h3>
        <div className="flex items-center space-x-2">
          <Button variant="primary" className="text-xs px-2 py-1" onClick={onAddDoctor}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Doctor
          </Button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {doctors.length === 0 && (
        <p className="text-xs text-gray-500">No doctors yet. Use "Add Doctor" to create one.</p>
      )}

      <div className="space-y-2 max-h-96 overflow-y-auto">
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
  );
}
