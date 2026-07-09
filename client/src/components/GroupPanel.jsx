import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'react-feather';
import { usePopups } from '../context/PopupContext.jsx';

// Port of the custom group dropdown + new-group input (index.html + script.js).
export default function GroupPanel({ engine, groupType }) {
  const { showPopup } = usePopups();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [newGroupVisible, setNewGroupVisible] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const containerRef = useRef(null);
  const newGroupInputRef = useRef(null);

  const { visibleGroups, groups, currentGroupId, selectGroup, createGroup, deleteGroup } = engine;

  const selectedGroup = groups.find((g) => g.id === currentGroupId);
  const selectedText = selectedGroup
    ? (selectedGroup.name.startsWith('__temp_') ? 'Temporary Locations' : selectedGroup.name)
    : 'Select a group';

  // Close dropdown when clicking outside (script.js:650)
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

  useEffect(() => {
    if (newGroupVisible) newGroupInputRef.current?.focus();
  }, [newGroupVisible]);

  async function handleCreateGroup(e) {
    if (e.key !== 'Enter') return;
    const name = newGroupName.trim();
    if (!name) return;
    try {
      const group = await createGroup(name);
      selectGroup(group.id);
      setNewGroupName('');
      setNewGroupVisible(false);
      showPopup('success', `Group "${group.name}" created successfully!`, 'Group Created');
    } catch (error) {
      console.error('Failed to create group:', error);
      showPopup('error', `Failed to create group: ${error.message}`, 'Group Creation Failed');
    }
  }

  function handleDeleteGroup(e, group) {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete the group "${group.name}"? This will also delete all markers in this group.`)) {
      deleteGroup(group.id);
    }
  }

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {groupType === 'zipcodes' ? 'ZIP Code Group' : 'Location Group'}
      </label>
      <div className="flex space-x-2">
        <div className="flex-1 relative" ref={containerRef}>
          <button
            onClick={() => setDropdownOpen((open) => !open)}
            className={`w-full pl-3 pr-10 py-2 text-base border focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md bg-white text-left ${
              selectedGroup ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-300'
            }`}
          >
            <span>{selectedText}</span>
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
              <ChevronDown className="h-4 w-4 text-gray-400" />
            </div>
          </button>

          {dropdownOpen && (
            <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-48 overflow-y-auto">
              {visibleGroups.map((group) => (
                <div
                  key={group.id}
                  className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 cursor-pointer"
                  onClick={() => {
                    setDropdownOpen(false);
                    selectGroup(group.id);
                  }}
                >
                  <span className="flex-1 text-sm text-gray-900">{group.name}</span>
                  <button
                    className="ml-2 text-gray-400 hover:text-red-600 p-1"
                    title="Delete group"
                    onClick={(e) => handleDeleteGroup(e, group)}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          onClick={() => setNewGroupVisible((visible) => !visible)}
          className="px-3 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none"
          title="Create new group"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {newGroupVisible && (
        <input
          ref={newGroupInputRef}
          type="text"
          value={newGroupName}
          onChange={(e) => setNewGroupName(e.target.value)}
          onKeyDown={handleCreateGroup}
          className="mt-2 block w-full pl-3 pr-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
          placeholder="Enter group name and press Enter"
        />
      )}
      <p className="text-xs text-gray-500 mt-1">
        {groupType === 'zipcodes'
          ? 'Create a group first, then add ZIP codes to it.'
          : 'Create a group first, then search for locations to add.'}
      </p>
    </div>
  );
}
