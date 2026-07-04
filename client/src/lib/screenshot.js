import { downloadBlob } from './csvExport.js';

// Port of the screenshot feature (script.js:3107-3322): capture the map,
// render the marker list to a side canvas, combine, download as PNG.
// The marker list is drawn from plain item data instead of scraping the DOM.

export async function takeMapScreenshot({ groupName, items }) {
    const { default: html2canvas } = await import('html2canvas');

    const sidebar = document.getElementById('sidebar');
    const mapContainer = document.getElementById('map-container');

    // Hide sidebar temporarily for a cleaner screenshot
    const originalSidebarDisplay = sidebar ? sidebar.style.display : '';
    const originalMapClassName = mapContainer.className;

    if (sidebar) sidebar.style.display = 'none';
    mapContainer.className = mapContainer.className.replace('mr-64', 'mr-0');

    try {
        // Wait a moment for layout adjustment
        await new Promise((resolve) => setTimeout(resolve, 300));

        const mapCanvas = await html2canvas(mapContainer, {
            useCORS: true,
            allowTaint: true,
            scale: 1,
            width: mapContainer.offsetWidth,
            height: mapContainer.offsetHeight,
            backgroundColor: '#ffffff'
        });

        const markerListCanvas = await generateMarkerListCanvas(html2canvas, groupName, items);
        const combinedCanvas = combineCanvases(mapCanvas, markerListCanvas);

        await new Promise((resolve, reject) => {
            combinedCanvas.toBlob((blob) => {
                if (!blob) return reject(new Error('Canvas export failed'));
                const fileName = `${groupName.replace(/[^a-z0-9]/gi, '_')}_Locations_Map.png`;
                downloadBlob(blob, fileName);
                resolve();
            }, 'image/png');
        });
    } finally {
        if (sidebar) sidebar.style.display = originalSidebarDisplay;
        mapContainer.className = originalMapClassName;
    }
}

async function generateMarkerListCanvas(html2canvas, groupName, items) {
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '-9999px';
    tempDiv.style.width = '300px';
    tempDiv.style.backgroundColor = '#ffffff';
    tempDiv.style.padding = '20px';
    tempDiv.style.fontFamily = 'Inter, sans-serif';
    tempDiv.style.fontSize = '14px';
    tempDiv.style.lineHeight = '1.4';

    const header = document.createElement('h3');
    header.style.margin = '0 0 16px 0';
    header.style.fontSize = '18px';
    header.style.fontWeight = '600';
    header.style.color = '#111827';
    header.textContent = groupName;
    tempDiv.appendChild(header);

    if (items.length === 0) {
        const noMarkersText = document.createElement('p');
        noMarkersText.style.color = '#6b7280';
        noMarkersText.style.fontStyle = 'italic';
        noMarkersText.textContent = 'No locations in this group';
        tempDiv.appendChild(noMarkersText);
    } else {
        items.forEach((item, index) => {
            const markerItem = document.createElement('div');
            markerItem.style.display = 'flex';
            markerItem.style.alignItems = 'flex-start';
            markerItem.style.marginBottom = '12px';
            markerItem.style.padding = '8px';
            markerItem.style.backgroundColor = '#f9fafb';
            markerItem.style.borderRadius = '6px';

            // Number indicator - px units and line-height for html2canvas compatibility
            const numberIndicator = document.createElement('div');
            numberIndicator.style.width = '24px';
            numberIndicator.style.height = '24px';
            numberIndicator.style.borderRadius = '50%';
            numberIndicator.style.backgroundColor = item.color || '#3B82F6';
            numberIndicator.style.color = 'white';
            numberIndicator.style.fontSize = '12px';
            numberIndicator.style.fontWeight = 'bold';
            numberIndicator.style.textAlign = 'center';
            numberIndicator.style.lineHeight = '10px';
            numberIndicator.style.marginRight = '12px';
            numberIndicator.style.marginTop = '8px';
            numberIndicator.style.flexShrink = '0';
            numberIndicator.style.border = '2px solid white';
            numberIndicator.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
            numberIndicator.style.textShadow = '1px 1px 1px rgba(0, 0, 0, 0.5)';
            numberIndicator.textContent = (item.number ?? (index + 1)).toString();

            const addressText = document.createElement('div');
            addressText.style.flex = '1';
            addressText.style.color = '#374151';
            addressText.style.fontSize = '13px';
            addressText.style.lineHeight = '1.4';
            addressText.style.wordBreak = 'break-word';
            addressText.textContent = item.title;

            markerItem.appendChild(numberIndicator);
            markerItem.appendChild(addressText);
            tempDiv.appendChild(markerItem);
        });
    }

    document.body.appendChild(tempDiv);
    try {
        return await html2canvas(tempDiv, {
            backgroundColor: '#ffffff',
            scale: 2, // Higher quality for text
            width: 300,
            useCORS: true
        });
    } finally {
        document.body.removeChild(tempDiv);
    }
}

function combineCanvases(mapCanvas, markerListCanvas) {
    const combinedCanvas = document.createElement('canvas');
    const ctx = combinedCanvas.getContext('2d');

    const totalWidth = mapCanvas.width + markerListCanvas.width;
    const totalHeight = Math.max(mapCanvas.height, markerListCanvas.height);

    combinedCanvas.width = totalWidth;
    combinedCanvas.height = totalHeight;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalWidth, totalHeight);
    ctx.drawImage(mapCanvas, 0, 0);
    ctx.drawImage(markerListCanvas, mapCanvas.width, 0);

    return combinedCanvas;
}
