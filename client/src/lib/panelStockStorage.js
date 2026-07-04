// Session-scoped storage for Panel Stock upload versions, mirroring the
// tempGroups pattern in useMapEngine.js. Each version:
// { id, title, fileName, createdAt, groups, locations }

const STORAGE_KEY = 'panelStockUploads';

export function readPanelStockUploads() {
    try {
        const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

function writePanelStockUploads(uploads) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(uploads));
}

export function addPanelStockUpload({ title, fileName, groups, locations }) {
    const upload = {
        id: crypto.randomUUID(),
        title,
        fileName,
        createdAt: new Date().toISOString(),
        groups: groups || [],
        locations: locations || []
    };
    writePanelStockUploads([...readPanelStockUploads(), upload]);
    return upload;
}
