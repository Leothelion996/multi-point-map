import { useEffect, useRef, useState } from 'react';
import { Download, Loader } from 'react-feather';
import Modal from '../Modal.jsx';
import { exportGroupsAsZip } from '../../lib/csvExport.js';
import { usePopups } from '../../context/PopupContext.jsx';

// Port of the export modal: pick groups, download each as a CSV inside a ZIP.
export default function ExportModal({ engine, open, onClose }) {
  const { showPopup } = usePopups();
  const { fetchGroupsList } = engine;

  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportableGroups, setExportableGroups] = useState([]);
  const [checked, setChecked] = useState({});
  const selectAllRef = useRef(null);

  // Fetch fresh group data on open so location counts are accurate
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setChecked({});
    fetchGroupsList().then((groups) => {
      if (cancelled) return;
      setExportableGroups(groups.filter((group) => !group.name.startsWith('__temp_')));
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const checkedIds = Object.keys(checked).filter((id) => checked[id]);
  const allChecked = exportableGroups.length > 0 && checkedIds.length === exportableGroups.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = checkedIds.length > 0 && !allChecked;
    }
  }, [checkedIds.length, allChecked]);

  function toggleSelectAll(e) {
    const next = {};
    if (e.target.checked) {
      exportableGroups.forEach((group) => { next[group.id] = true; });
    }
    setChecked(next);
  }

  async function handleExport() {
    const groupsToExport = exportableGroups.filter((group) => checked[group.id]);
    if (groupsToExport.length === 0) {
      showPopup('warning', 'Please select at least one group to export.', 'No Groups Selected');
      return;
    }

    setExporting(true);
    try {
      const count = await exportGroupsAsZip(groupsToExport);
      showPopup('success', `Successfully exported ${count} groups as ZIP file!`, 'Export Complete');
      onClose();
    } catch (error) {
      console.error('Export error:', error);
      showPopup('error', 'Failed to create ZIP file. Please try again.', 'Export Failed');
    } finally {
      setExporting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Export Location Groups" maxWidth="max-w-md">
      <div className="mb-4">
        <p className="text-sm text-gray-600 mb-3">Select the groups you want to export as CSV files:</p>

        <div className="space-y-2 max-h-48 overflow-y-auto border rounded-md p-3 bg-gray-50">
          {loading ? (
            <div className="flex items-center justify-center p-4">
              <Loader className="animate-spin h-5 w-5 mr-2" /> Loading groups...
            </div>
          ) : exportableGroups.length === 0 ? (
            <p className="text-gray-500 text-sm">No groups available for export. Create some location groups first.</p>
          ) : (
            exportableGroups.map((group) => (
              <div key={group.id} className="flex items-center">
                <input
                  type="checkbox"
                  id={`export-group-${group.id}`}
                  className="mr-2"
                  checked={Boolean(checked[group.id])}
                  onChange={(e) => setChecked((prev) => ({ ...prev, [group.id]: e.target.checked }))}
                />
                <label htmlFor={`export-group-${group.id}`} className="text-sm text-gray-700 flex-1">{group.name}</label>
                <span className="text-xs text-gray-500">{group.locations?.length || 0} locations</span>
              </div>
            ))
          )}
        </div>

        <div className="mt-3 text-xs text-gray-500">
          Each group will be exported as a separate CSV file in a ZIP archive.
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <input
            ref={selectAllRef}
            type="checkbox"
            id="select-all-groups"
            className="mr-2"
            disabled={exportableGroups.length === 0}
            checked={allChecked}
            onChange={toggleSelectAll}
          />
          <label htmlFor="select-all-groups" className="text-sm text-gray-700">Select All</label>
        </div>
        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={checkedIds.length === 0 || exporting}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none disabled:opacity-50"
          >
            {exporting
              ? <><Loader className="mr-2 h-4 w-4 animate-spin" /> Creating ZIP...</>
              : <><Download className="mr-2 h-4 w-4" /> Export ZIP</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}
