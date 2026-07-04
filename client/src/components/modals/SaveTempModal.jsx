import { useState } from 'react';
import Modal from '../Modal.jsx';

// Port of the save-temp-addresses modal: name a new group or pick an existing
// one; entering one clears the other (script.js:2853-2865).
export default function SaveTempModal({ engine }) {
  const { saveTempOpen, closeSaveTempModal, saveTempAddresses, discardTempAddresses, tempCount, visibleGroups } = engine;
  const [groupName, setGroupName] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');

  const canSave = groupName.trim().length > 0 || selectedGroupId.length > 0;

  function handleClose() {
    setGroupName('');
    setSelectedGroupId('');
    closeSaveTempModal();
  }

  async function handleSave() {
    await saveTempAddresses({
      newGroupName: groupName.trim() || null,
      existingGroupId: selectedGroupId || null
    });
    setGroupName('');
    setSelectedGroupId('');
  }

  async function handleDiscard() {
    await discardTempAddresses();
    setGroupName('');
    setSelectedGroupId('');
  }

  return (
    <Modal open={saveTempOpen} onClose={handleClose} title="Save Temporary Addresses" maxWidth="max-w-md">
      <p className="text-sm text-gray-600 mb-4">
        You have <span className="font-medium">{tempCount}</span> unsaved addresses. Choose how to save them:
      </p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Group Name</label>
          <input
            type="text"
            value={groupName}
            onChange={(e) => {
              setGroupName(e.target.value);
              if (e.target.value.trim()) setSelectedGroupId('');
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Enter group name..."
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Or select existing group</label>
          <select
            value={selectedGroupId}
            onChange={(e) => {
              setSelectedGroupId(e.target.value);
              if (e.target.value) setGroupName('');
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Choose existing group...</option>
            {visibleGroups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end space-x-3 mt-6">
        <button
          onClick={handleDiscard}
          className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Discard
        </button>
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          Save Addresses
        </button>
      </div>
    </Modal>
  );
}
