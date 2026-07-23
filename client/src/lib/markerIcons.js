// Verbatim port of calculateMarkerSize / createNumberedMarkerIcon (script.js:248-296).

export function calculateMarkerSize(zoom, isSelected = false) {
    // Set absolute minimum and maximum sizes to prevent compounding
    const MIN_SIZE = 12;
    const MAX_SIZE = 24;
    let baseSize;

    if (zoom <= 8) {
        // World/country view - large markers
        baseSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, 22 - zoom));
    } else if (zoom <= 12) {
        // Regional view - medium to large markers
        baseSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, 18 - (zoom - 8) * 0.5));
    } else if (zoom <= 16) {
        // City view - medium markers
        baseSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, 16 - (zoom - 12) * 0.3));
    } else {
        // Street view - maintain minimum readable size
        baseSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, 15 - (zoom - 16) * 0.2));
    }

    return isSelected ? Math.min(MAX_SIZE * 1.2, baseSize * 1.4) : baseSize;
}

export function createNumberedMarkerIcon(number, color, isSelected = false, zoomLevel = 12, isInactive = false) {
    const scale = calculateMarkerSize(zoomLevel, isSelected);
    const strokeWeight = isSelected ? 3 : (isInactive ? 2 : 0);
    const strokeColor = isSelected ? '#ffffff' : (isInactive ? '#9ca3af' : '');
    const strokeDasharray = isInactive ? ' stroke-dasharray="3,2"' : '';
    const fillOpacity = isInactive ? 0.5 : 1;

    const fontSize = Math.max(8, Math.min(14, scale * 0.8));

    const svg = `
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="12" fill="${color}" fill-opacity="${fillOpacity}" stroke="${strokeColor}" stroke-width="${strokeWeight}"${strokeDasharray}/>
            <text x="16" y="16" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="white" fill-opacity="${isInactive ? 0.8 : 1}">${number}</text>
        </svg>
    `;

    const encodedSvg = 'data:image/svg+xml;base64,' + btoa(svg);

    return {
        url: encodedSvg,
        scaledSize: new window.google.maps.Size(scale * 2, scale * 2),
        anchor: new window.google.maps.Point(scale, scale)
    };
}
