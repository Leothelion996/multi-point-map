import { useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleMapsLoader.js';
import { createNumberedMarkerIcon } from '../lib/markerIcons.js';
import { lookupZip } from '../api/zipcodes.js';

const DEFAULT_COLOR = '#3b82f6';

// ZIP boundary lookups are static per session; cache across page remounts.
const zipLookupCache = new Map();

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

async function lookupZipCached(zipCode) {
    if (!zipLookupCache.has(zipCode)) {
        zipLookupCache.set(zipCode, lookupZip(zipCode).catch((error) => {
            zipLookupCache.delete(zipCode); // allow retry after a failure
            throw error;
        }));
    }
    return zipLookupCache.get(zipCode);
}

// Lean map hook for the Panel Stock Analysis page. Unlike useMapEngine it has
// no server groups API behind it: locations come from the sessionStorage
// upload versions and render as ZIP polygons with a centered numbered icon.
export function usePanelStockMap({ locations, hideEmpty }) {
    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState(false);

    const mapDivRef = useRef(null);
    const mapRef = useRef(null);
    // [{ zipCode, title, number, color, marker, polygons }]
    const overlaysRef = useRef([]);
    const hideEmptyRef = useRef(hideEmpty);
    hideEmptyRef.current = hideEmpty;

    function applyVisibility() {
        const map = mapRef.current;
        overlaysRef.current.forEach((overlay) => {
            const visible = !(hideEmptyRef.current && overlay.number === 0);
            overlay.marker?.setMap(visible ? map : null);
            overlay.polygons.forEach((p) => p.setMap(visible ? map : null));
        });
    }

    function updateMarkerIcons() {
        const map = mapRef.current;
        if (!map) return;
        const zoom = map.getZoom();
        overlaysRef.current.forEach((overlay) => {
            overlay.marker?.setIcon(createNumberedMarkerIcon(overlay.number, overlay.color, false, zoom));
        });
    }

    function clearOverlays() {
        overlaysRef.current.forEach((overlay) => {
            overlay.marker?.setMap(null);
            overlay.polygons.forEach((p) => p.setMap(null));
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

        (async () => {
            const built = [];
            for (const location of locations) {
                try {
                    const zipData = await lookupZipCached(location.zipCode);
                    if (cancelled) return;

                    const color = location.color || DEFAULT_COLOR;
                    // Future parser fills number; default to 0 until then.
                    const number = location.number ?? 0;
                    const polygons = zipData.geometry ? buildPolygons(zipData.geometry, color, map) : [];
                    const marker = new google.maps.Marker({
                        position: zipData.center,
                        map,
                        title: location.title || zipData.title,
                        icon: createNumberedMarkerIcon(number, color, false, map.getZoom())
                    });
                    built.push({
                        zipCode: location.zipCode,
                        title: location.title || zipData.title,
                        number,
                        color,
                        marker,
                        polygons
                    });
                } catch (error) {
                    console.error(`ZIP lookup failed for ${location.zipCode}:`, error);
                }
            }
            if (cancelled) {
                built.forEach((overlay) => {
                    overlay.marker?.setMap(null);
                    overlay.polygons.forEach((p) => p.setMap(null));
                });
                return;
            }
            overlaysRef.current = built;
            applyVisibility();

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

    // Hide-empty is a visual filter only; session data is untouched.
    useEffect(() => {
        if (!mapReady) return;
        applyVisibility();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapReady, hideEmpty]);

    return { mapDivRef, mapReady, mapError, triggerResize };
}
