import { useRef, useState } from 'react';
import { UploadCloud, File as FileIcon, X } from 'react-feather';
import Modal from '../Modal.jsx';
import { usePopups } from '../../context/PopupContext.jsx';
import { mapWorkbookToPanelStock } from '../../lib/panelStockMapper.js';
import { createPanelStockUpload } from '../../api/panelStock.js';

const MAX_FILE_SIZE = 10 * 1024 * 1024;

// New Upload modal for Panel Stock versions. The .xlsx file is parsed
// client-side (panelStockMapper.js) and the resulting JSON is saved via the
// panel-stock API, backed by Postgres.
export default function NewPanelStockUploadModal({ open, onClose, onCreated }) {
  const { showPopup } = usePopups();
  const inputRef = useRef(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function reset() {
    setTitle('');
    setFile(null);
    setDragOver(false);
    setError('');
    setSubmitting(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function handleClose() {
    reset();
    onClose();
  }

  function acceptFile(fileList) {
    const picked = fileList?.[0];
    if (!picked) return;
    if (!picked.name.toLowerCase().endsWith('.xlsx')) {
      setError(`"${picked.name}" is not supported. Only .xlsx files are allowed.`);
      return;
    }
    if (picked.size > MAX_FILE_SIZE) {
      setError(`"${picked.name}" is larger than 10 MB.`);
      return;
    }
    setError('');
    setFile(picked);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim()) {
      setError('Upload title is required.');
      return;
    }
    if (!file) {
      setError('An .xlsx file is required.');
      return;
    }

    setSubmitting(true);
    setError('');

    let parsed;
    try {
      parsed = await mapWorkbookToPanelStock(file);
    } catch (err) {
      setError(err.message || 'Failed to read the spreadsheet.');
      setSubmitting(false);
      return;
    }

    if (parsed.blockingErrors.length > 0) {
      setError(parsed.blockingErrors[0]);
      setSubmitting(false);
      return;
    }

    if (parsed.duplicateZips.length > 0) {
      showPopup(
        'warning',
        `Duplicate ZIP codes were found and were not processed: ${parsed.duplicateZips.join(', ')}. Fix the spreadsheet and upload an updated file for accurate visualization.`,
        'Duplicate ZIP Codes Found'
      );
    }

    try {
      const upload = await createPanelStockUpload({
        title: title.trim(),
        fileName: file.name,
        specialties: parsed.specialties,
        rows: parsed.rows,
        duplicateZips: parsed.duplicateZips
      });
      showPopup('success', `Upload "${upload.title}" saved.`, 'Upload Created');
      reset();
      onCreated(upload);
    } catch (err) {
      setError(err.message || 'Failed to save the upload.');
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="New Panel Stock Upload" maxWidth="max-w-md">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="panel-stock-upload-title" className="block text-sm font-medium text-gray-700 mb-1">
            Upload Title <span className="text-red-500">*</span>
          </label>
          <input
            id="panel-stock-upload-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. July Panel Stock"
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            acceptFile(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:bg-gray-50'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => acceptFile(e.target.files)}
          />
          {file ? (
            <div className="flex items-center justify-center text-sm text-gray-700">
              <FileIcon className="h-5 w-5 text-blue-600 mr-2" />
              <span className="font-medium">{file.name}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                  if (inputRef.current) inputRef.current.value = '';
                }}
                className="ml-2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <UploadCloud className="mx-auto h-8 w-8 text-gray-400 mb-2" />
              <p className="text-sm font-medium text-gray-700">Drag and drop an .xlsx file here, or click to browse</p>
              <p className="text-xs text-gray-500 mt-1">.xlsx only — up to 10 MB</p>
            </>
          )}
        </div>

        <p className="text-xs text-gray-500">
          Reminder: If Column B contains city names, delete that column before uploading. If left in place with a City/Cities header, it will be ignored automatically.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end space-x-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none disabled:opacity-50"
          >
            {submitting ? 'Uploading…' : 'Create Upload'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
