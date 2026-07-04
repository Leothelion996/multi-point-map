import { CheckCircle, XCircle } from 'react-feather';
import Modal from '../Modal.jsx';
import { usePopups } from '../../context/PopupContext.jsx';

export default function BulkResultsModal({ engine }) {
  const { showPopup } = usePopups();
  const { bulk, closeBulkModal } = engine;
  const open = bulk.phase === 'results';
  const results = bulk.results || { successful: [], failed: [] };

  function copyFailedAddresses() {
    const text = results.failed.map((item) => item.address).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      showPopup('success', 'Failed addresses copied to clipboard!', 'Copied');
    }).catch(() => {
      showPopup('error', 'Failed to copy to clipboard. Please copy manually.', 'Copy Failed');
    });
  }

  return (
    <Modal open={open} onClose={closeBulkModal} title="Upload Results">
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <div className="flex items-center">
            <CheckCircle className="h-5 w-5 text-green-600 mr-2" />
            <div>
              <div className="text-sm font-medium text-green-800">Successfully Added</div>
              <div className="text-lg font-bold text-green-600">{results.successful.length}</div>
            </div>
          </div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center">
            <XCircle className="h-5 w-5 text-red-600 mr-2" />
            <div>
              <div className="text-sm font-medium text-red-800">Failed</div>
              <div className="text-lg font-bold text-red-600">{results.failed.length}</div>
            </div>
          </div>
        </div>
      </div>

      {results.failed.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Failed Addresses:</h4>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 max-h-40 overflow-y-auto">
            <div className="text-sm text-gray-700">
              {results.failed.map((item, index) => (
                <div key={index} className="mb-1">
                  <strong>{item.address}</strong>
                  <br />
                  <span className="text-red-600 text-xs">{item.reason}</span>
                </div>
              ))}
            </div>
          </div>
          <button onClick={copyFailedAddresses} className="mt-2 text-sm text-blue-600 hover:text-blue-800">
            Copy failed addresses to clipboard
          </button>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={closeBulkModal}
          className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none"
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
