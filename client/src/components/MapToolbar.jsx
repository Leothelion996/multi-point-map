import { useState } from 'react';
import { ChevronDown, Loader, Plus, Save, Search, Upload } from 'react-feather';
import { usePopups } from '../context/PopupContext.jsx';

// The collapsible "Map Options" section: search input, color swatches,
// and the Add Marker / Bulk Add / Save temp action buttons.

// Tailwind-500 palette hexes matching the legacy swatch classes; the legacy
// code sent the swatch's computed background color to the API.
const SWATCHES = [
  { class: 'bg-red-500', hex: '#ef4444' },
  { class: 'bg-blue-500', hex: '#3b82f6' },
  { class: 'bg-green-500', hex: '#22c55e' },
  { class: 'bg-yellow-500', hex: '#eab308' },
  { class: 'bg-purple-500', hex: '#a855f7' },
  { class: 'bg-pink-500', hex: '#ec4899' },
  { class: 'bg-indigo-500', hex: '#6366f1' },
  { class: 'bg-orange-500', hex: '#f97316' },
  { class: 'bg-teal-500', hex: '#14b8a6' },
  { class: 'bg-gray-500', hex: '#6b7280' }
];

export default function MapToolbar({ engine, groupType }) {
  const { showPopup } = usePopups();
  const [open, setOpen] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const isZipPage = groupType === 'zipcodes';

  const { searchInputRef, selectedColor, pickColor, addFromSearch, addZipCode, searchBusy, openBulkModal, hasTemp, tempCount, openSaveTempModal } = engine;

  async function handleSearchKeyDown(e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();

    if (isZipPage) {
      if (zipBusy) return;
      const input = e.target.value.trim();
      if (/^\d{5}$/.test(input)) {
        setZipBusy(true);
        try {
          await addZipCode(input);
          if (searchInputRef.current) searchInputRef.current.value = '';
        } finally {
          setZipBusy(false);
          searchInputRef.current?.focus();
        }
      } else {
        showPopup('warning', 'Please enter a valid 5-digit ZIP code', 'Invalid Input');
      }
    } else {
      addFromSearch();
    }
  }

  return (
    <div className="unified-options-section">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left py-2 px-3 bg-gray-50 hover:bg-gray-100 rounded-md focus:outline-none"
      >
        <span className="text-sm font-medium text-gray-700">Map Options</span>
        <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div id="options-dropdown-content" className="mt-2 space-y-4">
          {/* Search */}
          <div className="bg-white border border-gray-200 rounded-md p-3">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {isZipPage ? 'Add ZIP Code' : 'Search Location'}
            </label>
            <div className="relative">
              <input
                ref={searchInputRef}
                type="text"
                disabled={zipBusy}
                onKeyDown={handleSearchKeyDown}
                className="block w-full pl-3 pr-10 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
                placeholder={isZipPage ? 'Enter 5-digit ZIP code...' : 'Start typing an address...'}
              />
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-gray-400" />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {isZipPage ? 'Press Enter to add ZIP code.' : 'Autocomplete will suggest addresses as you type.'}
            </p>
          </div>

          {/* Marker colors */}
          <div className="bg-white border border-gray-200 rounded-md p-3">
            <label className="block text-sm font-medium text-gray-700 mb-2">Marker Color</label>
            <div className="flex flex-wrap gap-2">
              {SWATCHES.map((swatch) => (
                <button
                  key={swatch.hex}
                  onClick={() => pickColor(swatch.hex)}
                  className={`w-6 h-6 rounded-full ${swatch.class} border-2 border-gray-300 focus:outline-none ${
                    selectedColor === swatch.hex ? 'ring-2 ring-offset-2 ring-gray-500' : ''
                  }`}
                  title={swatch.hex}
                />
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">Select a marker first, then choose a color to update it.</p>
          </div>

          {/* Action buttons */}
          <div className="space-y-2">
            {!isZipPage && (
              <button
                onClick={addFromSearch}
                disabled={searchBusy}
                className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none disabled:opacity-60"
              >
                {searchBusy
                  ? <><Loader className="mr-2 h-4 w-4 animate-spin" /> Adding...</>
                  : <><Plus className="mr-2 h-4 w-4" /> Add Marker</>}
              </button>
            )}
            <button
              onClick={openBulkModal}
              className="w-full inline-flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none"
            >
              <Upload className="mr-2 h-4 w-4" /> Bulk Add
            </button>
            {hasTemp && (
              <button
                onClick={openSaveTempModal}
                className="w-full inline-flex justify-center items-center px-4 py-2 border border-orange-500 text-sm font-medium rounded-md shadow-sm text-orange-600 bg-orange-50 hover:bg-orange-100 focus:outline-none"
              >
                <Save className="mr-2 h-4 w-4" /> Save
                <span className="ml-1 bg-orange-500 text-white text-xs px-2 py-0.5 rounded-full">{tempCount}</span>
                <span className="ml-1">Addresses</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
