import GroupPanel from './GroupPanel.jsx';
import MapToolbar from './MapToolbar.jsx';
import MarkerListPanel from './MarkerListPanel.jsx';

export default function Sidebar({ engine, groupType, open }) {
  return (
    <div
      id="sidebar"
      className={`sidebar ${open ? 'sidebar-open' : 'sidebar-closed'} bg-white w-64 border-l border-gray-200 fixed right-0 z-10 flex flex-col`}
    >
      <div className="flex-shrink-0 p-4 border-b border-gray-200">
        <h2 className="text-lg font-medium text-gray-900">Customize Your Map</h2>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 pb-8 space-y-4">
          <GroupPanel engine={engine} groupType={groupType} />
          <MapToolbar engine={engine} groupType={groupType} />
          <MarkerListPanel engine={engine} />
        </div>
      </div>
    </div>
  );
}
