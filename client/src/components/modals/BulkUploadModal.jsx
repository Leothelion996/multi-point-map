import { useMemo, useState } from 'react';
import Modal from '../Modal.jsx';
import { parseAddresses } from '../../lib/parseAddresses.js';

export default function BulkUploadModal({ engine, groupType }) {
  const { bulk, closeBulkModal, startBulkUpload } = engine;
  const [groupName, setGroupName] = useState('');
  const [input, setInput] = useState('');

  const isZipPage = groupType === 'zipcodes';
  const addressCount = useMemo(() => parseAddresses(input).length, [input]);
  const open = bulk.phase === 'input';

  function handleClose() {
    setGroupName('');
    setInput('');
    closeBulkModal();
  }

  async function handleStart() {
    const name = groupName.trim();
    const raw = input;
    setGroupName('');
    setInput('');
    await startBulkUpload(raw, name);
  }

  return (
    <Modal open={open} onClose={handleClose} title={isZipPage ? 'Bulk Add ZIP Codes' : 'Bulk Add Addresses'}>
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Group Name (optional)</label>
        <input
          type="text"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          className="block w-full pl-3 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          placeholder="Enter group name or leave blank to use selected group"
        />
        <p className="text-xs text-gray-500 mt-1">
          If provided, a new group will be created. Otherwise, the currently selected group will be used.
        </p>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {isZipPage ? 'Enter ZIP codes (one per line):' : 'Enter addresses (one per line):'}
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="w-full h-40 px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          placeholder={isZipPage ? '90210\n10001\n60601' : '123 Main St, New York, NY\n456 Oak Ave, Los Angeles, CA\n789 Pine Rd, Chicago, IL'}
        />
        <p className="text-xs text-gray-500 mt-1">
          {isZipPage
            ? 'You can enter ZIP codes separated by new lines or commas. Maximum 50 per batch.'
            : 'You can enter addresses separated by new lines or commas. Maximum 50 addresses per batch.'}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          <span className={addressCount >= 50 ? 'text-red-600' : ''}>{addressCount >= 50 ? '50 (max)' : addressCount}</span>
          {' '}{isZipPage ? 'ZIP codes' : 'addresses'} detected
        </div>
        <div className="flex space-x-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none"
          >
            Cancel
          </button>
          <button
            onClick={handleStart}
            disabled={addressCount === 0}
            className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none disabled:opacity-50"
          >
            Start Upload
          </button>
        </div>
      </div>
    </Modal>
  );
}
