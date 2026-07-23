import { useState } from 'react';
import Button from './Button.jsx';

const EMPTY_DOCTOR_FORM = { firstName: '', lastName: '', specialtyHint: '', notes: '' };

// Add/edit doctor form, shared by the inline "Manage Doctors" edit flow
// (DoctorSidebar.jsx) and the "Add Doctor" modal (modals/AddDoctorModal.jsx).
export default function DoctorForm({ initial = EMPTY_DOCTOR_FORM, submitLabel, onSubmit, onCancel, firstInputRef }) {
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
