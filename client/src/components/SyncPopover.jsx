import { useEffect, useRef } from 'react';
import { RefreshCw, X } from 'react-feather';
import RequireRole from './RequireRole.jsx';
import Button from './Button.jsx';
import { doctorDisplayName } from '../hooks/useDoctorLocationsEngine.js';

// DWC Sync controls, relocated from the sidebar into a popover anchored under
// the top-left menu (same trigger idiom as the Screenshot action). State
// lives in the engine hook so polling survives regardless of whether this
// popover is open.
export default function SyncPopover({ engine, open, onClose }) {
  const containerRef = useRef(null);
  const { syncRun, syncResults, syncBusy, runSyncNow, retrySyncFailed } = engine;

  useEffect(() => {
    if (!open) return undefined;
    function onMouseDown(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) onClose();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  const isRunning = syncRun?.status === 'running';
  const failedResults = (syncResults || []).filter((r) => r.status === 'error');

  return (
    <div
      ref={containerRef}
      className="fixed left-4 top-16 w-80 bg-white border border-gray-200 rounded-md shadow-lg z-50 p-4"
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-gray-900">DWC Sync</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X className="h-4 w-4" />
        </button>
      </div>

      <RequireRole allow={['admin', 'staff']}>
        <Button
          variant="primary"
          className="text-xs px-3 py-1.5 mb-3"
          onClick={runSyncNow}
          disabled={syncBusy || isRunning}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1 ${isRunning ? 'animate-spin' : ''}`} />
          {isRunning ? 'Running...' : 'Run Now'}
        </Button>
      </RequireRole>

      {!syncRun && <p className="text-xs text-gray-500">No syncs have been run yet.</p>}

      {syncRun && (
        <div className="text-xs text-gray-600 space-y-1">
          <div>
            <span className="font-medium">Last run:</span>{' '}
            {syncRun.startedAt ? new Date(syncRun.startedAt).toLocaleString() : '—'}
          </div>
          <div>
            <span className="font-medium">Status:</span>{' '}
            <span className={
              syncRun.status === 'failed' ? 'text-red-600'
                : syncRun.status === 'completed_with_errors' ? 'text-amber-600'
                  : syncRun.status === 'completed' ? 'text-green-600' : 'text-blue-600'
            }>
              {syncRun.status}
            </span>
          </div>
          {isRunning && (
            <div>
              <span className="font-medium">Progress:</span>{' '}
              {syncRun.processedCount ?? 0} of {syncRun.doctorCount ?? '?'} doctors
            </div>
          )}
          {!isRunning && (
            <div>
              <span className="font-medium">Results:</span>{' '}
              {syncRun.successCount ?? 0} ok, {syncRun.errorCount ?? 0} errors
              {syncRun.errorSummary && <div className="text-red-600">{syncRun.errorSummary}</div>}
            </div>
          )}
        </div>
      )}

      {failedResults.length > 0 && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded">
          <div className="flex items-center justify-between mb-1">
            <h4 className="text-xs font-medium text-red-800">Failed Doctors</h4>
            <RequireRole allow={['admin', 'staff']}>
              <button
                onClick={retrySyncFailed}
                disabled={syncBusy}
                className="text-xs px-2 py-0.5 border border-red-300 rounded text-red-700 hover:bg-red-100 focus:outline-none disabled:opacity-50"
              >
                Retry Failed
              </button>
            </RequireRole>
          </div>
          <div className="space-y-1">
            {failedResults.map((result) => (
              <div key={result.id || result.doctorId} className="text-xs text-gray-600">
                <span className="font-medium">
                  {result.doctorName || doctorDisplayName(result) || result.doctorId}
                </span>
                {result.errorDetail && <span>: {result.errorDetail}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
