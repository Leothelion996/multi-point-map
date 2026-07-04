import { useState } from 'react';
import { X } from 'react-feather';

// "Your Markers" section: See All, fine zoom, and the draggable marker list.
// Drag-reorder is native HTML5 DnD ported from script.js:1818-1896
// (markers reorder; ZIP polygons are listed but not draggable, as before).
export default function MarkerListPanel({ engine }) {
  const {
    items, selectedLocationId, selectItemFromList, deleteItem, reorderMarkers,
    currentGroupId, fitMapToMarkers, fineZoomIn, fineZoomOut, zoomDisplay
  } = engine;

  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const markerItems = items.filter((item) => item.kind === 'marker');
  const seeAllDisabled = !currentGroupId || items.length === 0;

  function handleDrop(e, targetIndex) {
    e.stopPropagation();
    if (dragIndex !== null && dragIndex !== targetIndex) {
      reorderMarkers(dragIndex, targetIndex);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  }

  function renderItem(item, index, draggable) {
    const isSelected = item.locationId === selectedLocationId;
    return (
      <div
        key={item.locationId}
        className={`marker-list-item${isSelected ? ' selected active' : ''}${dragIndex === index && draggable ? ' dragging' : ''}${dragOverIndex === index && draggable && dragIndex !== index ? ' drag-over' : ''}`}
        draggable={draggable}
        onDragStart={draggable ? () => setDragIndex(index) : undefined}
        onDragOver={draggable ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } : undefined}
        onDragEnter={draggable ? () => setDragOverIndex(index) : undefined}
        onDragLeave={draggable ? () => setDragOverIndex((i) => (i === index ? null : i)) : undefined}
        onDrop={draggable ? (e) => handleDrop(e, index) : undefined}
        onDragEnd={draggable ? () => { setDragIndex(null); setDragOverIndex(null); } : undefined}
        onClick={(e) => {
          if (!e.target.closest('button')) {
            selectItemFromList(item.locationId);
          }
        }}
      >
        <div className="marker-numbered-color-indicator" style={{ backgroundColor: item.color }}>
          {item.number}
        </div>
        <span className="text-sm text-gray-700 flex-1">{item.title}</span>
        <button className="text-gray-400 hover:text-gray-600" onClick={() => deleteItem(item.locationId)}>
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-gray-200 pt-4 mt-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-900">Your Markers</h3>
        <div className="flex items-center space-x-2">
          <button
            onClick={fitMapToMarkers}
            disabled={seeAllDisabled}
            className="text-xs px-2 py-1 border border-gray-300 rounded text-gray-600 hover:text-gray-800 hover:bg-gray-50 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            title="Zoom to show all markers"
          >
            See All
          </button>
        </div>
      </div>

      {/* Fine zoom controls */}
      <div className="mb-3 p-2 bg-gray-50 rounded border">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-700">Fine Zoom</span>
          <div className="flex items-center space-x-1">
            <button
              onClick={fineZoomOut}
              className="w-6 h-6 flex items-center justify-center text-xs border border-gray-300 rounded text-gray-600 hover:text-gray-800 hover:bg-white focus:outline-none"
              title="Zoom out 0.25 levels"
            >
              −
            </button>
            <span className="text-xs text-gray-500 min-w-8 text-center">{zoomDisplay}</span>
            <button
              onClick={fineZoomIn}
              className="w-6 h-6 flex items-center justify-center text-xs border border-gray-300 rounded text-gray-600 hover:text-gray-800 hover:bg-white focus:outline-none"
              title="Zoom in 0.25 levels"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {markerItems.map((item) => renderItem(item, markerItems.indexOf(item), true))}
        {items.filter((i) => i.kind === 'polygon').map((item) => renderItem(item, -1, false))}
      </div>
    </div>
  );
}
