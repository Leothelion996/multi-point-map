// Port of generateCSV / exportSelectedGroups (script.js:2964-3058).

export function generateCSV(group) {
    const locations = group.locations || [];
    let csv = `${group.name} Addresses\n`;
    locations.forEach((location) => {
        const title = (location.title || '').replace(/"/g, '""');
        csv += `"${title}"\n`;
    });
    return csv;
}

export async function exportGroupsAsZip(groups) {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();

    groups.forEach((group) => {
        const csv = generateCSV(group);
        const fileName = `${group.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_locations.csv`;
        zip.file(fileName, csv);
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });

    const timestamp = new Date().toISOString().slice(0, 10);
    downloadBlob(zipBlob, `location_groups_export_${timestamp}.zip`);

    return groups.length;
}

export function downloadBlob(blob, fileName) {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
