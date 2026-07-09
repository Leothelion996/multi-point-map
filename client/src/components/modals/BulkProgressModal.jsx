import Modal from '../Modal.jsx';

export default function BulkProgressModal({ engine, groupType }) {
  const { bulk, cancelBulkProcessing } = engine;
  const open = bulk.phase === 'processing';

  const percentage = bulk.total > 0 ? Math.round((bulk.current / bulk.total) * 100) : 0;

  return (
    <Modal open={open} onClose={() => {}} closable={false} maxWidth="max-w-lg">
      <div className="text-center mb-4">
        <h3 className="text-lg font-medium text-gray-900">
          {groupType === 'zipcodes' ? 'Processing ZIP Codes' : 'Processing Addresses'}
        </h3>
        <p className="text-sm text-gray-600 mt-1">{bulk.status || 'Preparing to process addresses...'}</p>
      </div>

      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-1">
          <span>{bulk.current} of {bulk.total}</span>
          <span>{percentage}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2.5">
          <div
            className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>

      <div className="text-center">
        <div className="text-sm text-gray-600 mb-3">{bulk.currentAddress || 'Ready to start...'}</div>
        <button
          onClick={cancelBulkProcessing}
          className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none"
        >
          Cancel
        </button>
      </div>
    </Modal>
  );
}
