import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleMapsLoader.js';
import { createNumberedMarkerIcon } from '../lib/markerIcons.js';
import { lookupZipsBatch, fetchZipColors } from '../api/zipcodes.js';

const DEFAULT_COLOR = '#3b82f6';

// Matches the server-side cap on /api/zipcodes/lookup-batch.
const BATCH_CHUNK_SIZE = 250;

// ZIP boundary lookups are static per session; cache across page remounts.
// Values are promises resolving to the lookup payload (same shape as the
// single-zip endpoint) so failed entries can be dropped and retried.
const zipLookupCache = new Map();

// The CA zip->color map is a single bulk payload (not per-zip like lookups
// above); cache the in-flight/resolved promise across remounts the same way.
let zipColorsPromise = null;

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

// Resolves every ZIP's boundary payload, hitting the batch endpoint only for
// ZIPs not already cached. Successes are seeded into zipLookupCache; ZIPs the
// server doesn't know (notFound) and failed chunks stay uncached so a later
// pass retries them. Returns Map(zipCode -> payload) of successes only.
async function resolveZipsBatched(zipCodes) {
    const resolved = new Map();
    const cachedPromises = [];
    const uncached = [];

    for (const zipCode of new Set(zipCodes)) {
        const cached = zipLookupCache.get(zipCode);
        if (cached) {
            cachedPromises.push(cached.then(
                (data) => { resolved.set(zipCode, data); },
                () => {} // failed entries self-evict from the cache
            ));
        } else {
            uncached.push(zipCode);
        }
    }

    const chunks = [];
    for (let i = 0; i < uncached.length; i += BATCH_CHUNK_SIZE) {
        chunks.push(uncached.slice(i, i + BATCH_CHUNK_SIZE));
    }

    await Promise.all([
        ...cachedPromises,
        ...chunks.map(async (chunk) => {
            try {
                const { results } = await lookupZipsBatch(chunk);
                for (const [zipCode, data] of Object.entries(results || {})) {
                    zipLookupCache.set(zipCode, Promise.resolve(data));
                    resolved.set(zipCode, data);
                }
            } catch (error) {
                console.error('Batch ZIP lookup failed for a chunk:', error);
            }
        })
    ]);

    return resolved;
}

async function getZipColorsCached() {
    if (!zipColorsPromise) {
        zipColorsPromise = fetchZipColors().catch((error) => {
            zipColorsPromise = null; // allow retry after a failure
            throw error;
        });
    }
    return zipColorsPromise;
}

// Lean map hook for the Panel Stock Analysis page. Unlike useMapEngine it has
// no server groups API behind it: locations come from the sessionStorage
// upload versions and render as ZIP polygons with a centered numbered icon.
//
// minCount hides ZIPs whose count is below it (null = off); it combines with
// hideEmpty. onZipClick(zipCode|null) fires when a ZIP overlay is clicked on
// the map (null = selection cleared) so the page can sync the sidebar list.
export function usePanelStockMap({ locations, hideEmpty, minCount, onZipClick }) {
    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState(false);
    const [resolvedColors, setResolvedColors] = useState({});

    const mapDivRef = useRef(null);
    const mapRef = useRef(null);
    // [{ zipCode, title, number, color, marker, polygons }]
    const overlaysRef = useRef([]);
    const hideEmptyRef = useRef(hideEmpty);
    hideEmptyRef.current = hideEmpty;
    const minCountRef = useRef(minCount);
    minCountRef.current = minCount;
    const onZipClickRef = useRef(onZipClick);
    onZipClickRef.current = onZipClick;
    const selectedZipRef = useRef(null);

    function styleOverlaySelection(overlay, selected) {
        const zoom = mapRef.current?.getZoom();
        overlay.marker?.setIcon(createNumberedMarkerIcon(overlay.number, overlay.color, selected, zoom));
        overlay.polygons.forEach((p) => p.setOptions(selected
            ? { strokeWeight: 4, strokeOpacity: 1, fillOpacity: 0.5, zIndex: 10 }
            : { strokeWeight: 2, strokeOpacity: 0.8, fillOpacity: 0.35, zIndex: 0 }));
    }

    // Restyles only the overlays whose selection state changed.
    function setSelection(zipCode) {
        const previous = selectedZipRef.current;
        if (previous === zipCode) return;
        selectedZipRef.current = zipCode;
        overlaysRef.current.forEach((overlay) => {
            if (overlay.zipCode === previous) styleOverlaySelection(overlay, false);
            if (overlay.zipCode === zipCode) styleOverlaySelection(overlay, true);
        });
    }

    function clearSelection() {
        if (selectedZipRef.current === null) return;
        setSelection(null);
        onZipClickRef.current?.(null);
    }

    function applyVisibility() {
        const map = mapRef.current;
        overlaysRef.current.forEach((overlay) => {
            const visible = !(hideEmptyRef.current && overlay.number === 0)
                && !(minCountRef.current != null && overlay.number < minCountRef.current);
            overlay.marker?.setMap(visible ? map : null);
            overlay.polygons.forEach((p) => p.setMap(visible ? map : null));
            // A filter that hides the selected ZIP also deselects it so the
            // map highlight and the sidebar row never point at hidden state.
            if (!visible && overlay.zipCode === selectedZipRef.current) clearSelection();
        });
    }

    function updateMarkerIcons() {
        const map = mapRef.current;
        if (!map) return;
        const zoom = map.getZoom();
        overlaysRef.current.forEach((overlay) => {
            overlay.marker?.setIcon(createNumberedMarkerIcon(
                overlay.number,
                overlay.color,
                overlay.zipCode === selectedZipRef.current,
                zoom
            ));
        });
    }

    function clearOverlays() {
        const gevent = window.google?.maps?.event;
        overlaysRef.current.forEach((overlay) => {
            if (overlay.marker) {
                gevent?.clearInstanceListeners(overlay.marker);
                overlay.marker.setMap(null);
            }
            overlay.polygons.forEach((p) => {
                gevent?.clearInstanceListeners(p);
                p.setMap(null);
            });
        });
        overlaysRef.current = [];
    }

    function triggerResize() {
        const map = mapRef.current;
        if (!map) return;
        const center = map.getCenter();
        window.google.maps.event.trigger(map, 'resize');
        if (center) map.setCenter(center);
    }

    // Selects the ZIP and fits the map to its polygons (same pattern as
    // useMapEngine.selectItemFromList). No-op if the ZIP never resolved.
    function focusZip(zipCode) {
        const map = mapRef.current;
        const overlay = overlaysRef.current.find((o) => o.zipCode === zipCode);
        if (!map || !overlay) return;
        setSelection(zipCode);
        if (overlay.polygons.length > 0) {
            const bounds = new window.google.maps.LatLngBounds();
            overlay.polygons.forEach((p) => p.getPath().forEach((coord) => bounds.extend(coord)));
            map.fitBounds(bounds);
        } else if (overlay.marker) {
            map.setCenter(overlay.marker.getPosition());
            map.setZoom(12);
        }
    }

    // Same GeoJSON handling as useMapEngine's createPolygonObj (outer ring
    // only, MultiPolygon-aware) minus the info-window/hover interactions.
    function buildPolygons(geometryJson, color, map) {
        const google = window.google;
        try {
            const geometry = JSON.parse(geometryJson);
            let coordinateSets = [];
            if (geometry.type === 'Polygon' && geometry.coordinates && geometry.coordinates[0]) {
                coordinateSets = [geometry.coordinates];
            } else if (geometry.type === 'MultiPolygon' && geometry.coordinates) {
                coordinateSets = geometry.coordinates;
            } else {
                console.error('Invalid or unsupported polygon geometry:', geometry);
                return [];
            }
            return coordinateSets.map((polygonCoords) => new google.maps.Polygon({
                paths: polygonCoords[0].map((coord) => ({ lat: coord[1], lng: coord[0] })),
                strokeColor: color,
                strokeOpacity: 0.8,
                strokeWeight: 2,
                fillColor: color,
                fillOpacity: 0.35,
                map
            }));
        } catch (error) {
            console.error('Error creating polygon from geometry:', error);
            return [];
        }
    }

    // Map initialization (same options as useMapEngine)
    useEffect(() => {
        let cancelled = false;

        loadGoogleMaps()
            .then((gmaps) => {
                if (cancelled || !mapDivRef.current || mapRef.current) return;

                const map = new gmaps.Map(mapDivRef.current, {
                    center: { lat: 34.0522, lng: -118.2437 }, // Default to Los Angeles
                    zoom: 12,
                    mapTypeId: gmaps.MapTypeId.ROADMAP,
                    mapTypeControl: true,
                    mapTypeControlOptions: {
                        style: gmaps.MapTypeControlStyle.DEFAULT,
                        position: gmaps.ControlPosition.TOP_RIGHT,
                        mapTypeIds: [gmaps.MapTypeId.ROADMAP, gmaps.MapTypeId.SATELLITE]
                    },
                    zoomControl: true,
                    streetViewControl: true,
                    fullscreenControl: true,
                    scrollwheel: true,
                    gestureHandling: 'greedy'
                });
                mapRef.current = map;

                map.addListener('zoom_changed', debounce(updateMarkerIcons, 100));
                // Clicks on empty map (polygon clicks don't bubble here) clear
                // the selection on both the map and the sidebar list.
                map.addListener('click', () => clearSelection());

                setMapReady(true);
            })
            .catch((error) => {
                console.error('Error loading configuration:', error);
                if (!cancelled) setMapError(true);
            });

        return () => {
            cancelled = true;
            clearOverlays();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Render the active version's locations as polygons + centered numbers
    useEffect(() => {
        if (!mapReady) return undefined;
        let cancelled = false;
        const google = window.google;
        const map = mapRef.current;

        clearOverlays();
        clearSelection(); // overlays are rebuilding; a stale selection would point nowhere

        (async () => {
            // Colors are a single bulk payload shared by every location in
            // this render pass, unlike the per-zip boundary lookups below.
            let caColors = {};
            try {
                const zipColors = await getZipColorsCached();
                caColors = zipColors.colors || {};
            } catch (error) {
                console.error('Failed to fetch CA ZIP colors, falling back to default color:', error);
            }
            if (cancelled) return;

            const resolved = await resolveZipsBatched(locations.map((l) => l.zipCode));
            if (cancelled) return;

            const built = [];
            const missing = [];
            for (const location of locations) {
                const zipData = resolved.get(location.zipCode);
                if (!zipData) {
                    missing.push(location.zipCode);
                    continue;
                }

                const color = location.color || caColors[location.zipCode] || DEFAULT_COLOR;
                // Future parser fills number; default to 0 until then.
                const number = location.number ?? 0;
                const polygons = zipData.geometry ? buildPolygons(zipData.geometry, color, map) : [];
                const marker = new google.maps.Marker({
                    position: zipData.center,
                    map,
                    title: location.title || zipData.title,
                    icon: createNumberedMarkerIcon(number, color, false, map.getZoom())
                });
                const overlay = {
                    zipCode: location.zipCode,
                    title: location.title || zipData.title,
                    number,
                    color,
                    marker,
                    polygons
                };
                const handleClick = () => {
                    setSelection(overlay.zipCode);
                    onZipClickRef.current?.(overlay.zipCode);
                };
                marker.addListener('click', handleClick);
                polygons.forEach((p) => p.addListener('click', handleClick));
                built.push(overlay);
            }
            if (missing.length > 0) {
                console.warn(`ZIP lookup failed for ${missing.length} ZIP(s):`, missing.join(', '));
            }
            overlaysRef.current = built;
            applyVisibility();
            setResolvedColors(
                built.reduce((acc, overlay) => {
                    acc[overlay.zipCode] = overlay.color;
                    return acc;
                }, {})
            );

            if (built.length > 0) {
                const bounds = new google.maps.LatLngBounds();
                built.forEach((overlay) => {
                    if (overlay.marker) bounds.extend(overlay.marker.getPosition());
                    overlay.polygons.forEach((polygon) => {
                        polygon.getPath().forEach((coord) => bounds.extend(coord));
                    });
                });
                map.fitBounds(bounds);
            }
        })();

        return () => {
            cancelled = true;
            clearOverlays();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapReady, locations]);

    // Hide filters are visual only; session data is untouched.
    useEffect(() => {
        if (!mapReady) return;
        applyVisibility();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapReady, hideEmpty, minCount]);

    return { mapDivRef, mapReady, mapError, triggerResize, resolvedColors, focusZip };
}
