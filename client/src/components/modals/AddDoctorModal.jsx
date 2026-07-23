import Modal from '../Modal.jsx';
import DoctorForm from '../DoctorForm.jsx';
import { usePopups } from '../../context/PopupContext.jsx';
import { doctorDisplayName } from '../../hooks/useDoctorLocationsEngine.js';

// "Add Doctor" modal, modeled on NewPanelStockUploadModal's structure: a
// shared Modal wrapper around a form, opened by a button (from the map-top
// "Manage Doctors" control or the doctor-picker's "create new" shortcut)
// rather than always rendered inline.
export default function AddDoctorModal({ open, onClose, engine }) {
  const { showPopup } = usePopups();

  async function handleAdd(payload) {
    try {
      const doctor = await engine.createDoctor(payload);
      showPopup('success', `Added ${doctorDisplayName(doctor) || 'doctor'} to the roster.`, 'Doctor Added');
      onClose();
    } catch (error) {
      console.error('Error creating doctor:', error);
      showPopup('error', `Failed to add doctor: ${error.message}`, 'Add Failed');
      throw error;
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add Doctor" maxWidth="max-w-md">
      <DoctorForm submitLabel="Add Doctor" onSubmit={handleAdd} onCancel={onClose} />
    </Modal>
  );
}
