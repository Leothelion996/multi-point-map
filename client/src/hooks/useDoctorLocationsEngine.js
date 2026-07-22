import { useEffect, useMemo, useRef, useState } from 'react';
import * as doctorsApi from '../api/doctors.js';
import { loadGoogleMaps } from '../lib/googleMapsLoader.js';
import { createNumberedMarkerIcon } from '../lib/markerIcons.js';
import { geocodeAddress } from '../lib/geocode.js';
import { usePopups } from '../context/PopupContext.jsx';

// Parallel hook to useMapEngine for the /doctor-locations page. Same
// architecture: Google Maps objects (map, markers, info window) live in refs
// and are mutated imperatively; plain-data mirrors live in React state so the
// sidebar can render. Any function reachable from a Google Maps event
// listener reads only refs, never captured state.
//
// Data is doctor-based (doctors + their DWC locations) instead of
// group-based, and this hook owns the client-side background geocoding pass
// (Section 2 of the DWC plan): DWC sync runs never geocode server-side, so
// rows arrive with geocode_status='pending' and get geocoded here on view.

// Pin colors by classification (reuses createNumberedMarkerIcon's color param)
const CLASSIFICATION_COLORS = {
    pme: '#10b981',          // green
    not_pme: '#6b7280',      // gray
    needs_review: '#f59e0b'  // amber
};

export function classificationColor(classification) {
    return CLASSIFICATION_COLORS[classification] || CLASSIFICATION_COLORS.needs_review;
}

export function doctorDisplayName(doctor) {
    if (!doctor) return '';
    return doctor.displayName || `${doctor.firstName || ''} ${doctor.lastName || ''}`.trim();
}

// Same pacing the bulk-upload geocode loop uses (useMapEngine.js) — an
// already-tuned Google Geocoder rate limit, reused rather than re-guessed.
const GEOCODE_PACE_MS = 1200;

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function locationAddress(location) {
    if (location.rawAddress) return location.rawAddress;
    const cityStateZip = [location.city, [location.state, location.zipCode].filter(Boolean).join(' ')]
        .filter(Boolean).join(', ');
    return [location.street, cityStateZip].filter(Boolean).join(', ');
}

const CLASSIFICATION_LABELS = { pme: 'PME', not_pme: 'Not PME', needs_review: 'Needs Review' };

export function classificationLabel(classification) {
    return CLASSIFICATION_LABELS[classification] || classification || 'Unknown';
}

export function useDoctorLocationsEngine() {
    const { showPopup } = usePopups();

    // --- state (drives sidebar rendering) ---
    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState(false);
    const [doctors, setDoctors] = useState([]);
    const [includeInactiveDoctors, setIncludeInactiveDoctorsState] = useState(false);
    const [currentDoctorId, setCurrentDoctorId] = useState(null);
    const [locations, setLocations] = useState([]);
    const [locationsLoading, setLocationsLoading] = useState(false);
    const [selectedLocationId, setSelectedLocationId] = useState(null);
    const [zoomDisplay, setZoomDisplay] = useState('12.0');
    // Background geocoding pass progress: {active, total, done, failed}
    const [geocodePass, setGeocodePass] = useState({ active: false, total: 0, done: 0, failed: 0 });

    // --- refs (imperative map world + values read from map callbacks) ---
    const mapDivRef = useRef(null);
    const mapRef = useRef(null);
    const infoWindowRef = useRef(null);
    const markersRef = useRef([]);
    const selectedMarkerRef = useRef(null);
    const currentDoctorIdRef = useRef(null);
    const locationsRef = useRef([]);
    const includeInactiveDoctorsRef = useRef(false);
    const fractionalZoomRef = useRef(12);
    // Effect guard for the geocode pass: bumping the token cancels any loop
    // still running, so the pass runs once per doctor-selection-with-pending-
    // rows instead of stacking up on re-selections or re-renders.
    const geocodeTokenRef = useRef(0);

    const showPopupRef = useRef(showPopup);
    showPopupRef.current = showPopup;
    const popup = (...args) => showPopupRef.current(...args);

    // ================================
    // State mirror helpers
    // ================================

    function setCurrentDoctor(doctorId) {
        currentDoctorIdRef.current = doctorId;
        setCurrentDoctorId(doctorId);
    }

    function setLocationRows(rows) {
        locationsRef.current = rows;
        setLocations(rows);
    }

    function applyLocationUpdate(locationId, patch) {
        const next = locationsRef.current.map((row) => (row.id === locationId ? { ...row, ...patch } : row));
        setLocationRows(next);
        return next;
    }

    async function refreshDoctors(includeInactive = includeInactiveDoctorsRef.current) {
        try {
            const fetched = await doctorsApi.fetchDoctors({ includeInactive });
            const list = Array.isArray(fetched) ? fetched : (fetched?.doctors || []);
            setDoctors(list);
            return list;
        } catch (error) {
            console.error('Error fetching doctors:', error);
            setDoctors([]);
            return [];
        }
    }

    function setIncludeInactiveDoctors(value) {
        includeInactiveDoctorsRef.current = value;
        setIncludeInactiveDoctorsState(value);
        refreshDoctors(value);
    }

    // ================================
    // Markers (imperative)
    // ================================

    function updateAllMarkerIcons() {
        const currentZoom = mapRef.current ? mapRef.current.getZoom() : 12;
        markersRef.current.forEach((marker, index) => {
            const isSelected = marker === selectedMarkerRef.current;
            marker.setIcon(createNumberedMarkerIcon(index + 1, marker.originalColor, isSelected, currentZoom));
        });
    }

    function selectMarkerObj(marker) {
        selectedMarkerRef.current = marker;
        setSelectedLocationId(marker.locationId);
        updateAllMarkerIcons();
    }

    function clearMarkerSelection() {
        selectedMarkerRef.current = null;
        setSelectedLocationId(null);
        updateAllMarkerIcons();
    }

    function clearMapObjects() {
        markersRef.current.forEach((marker) => marker.setMap(null));
        markersRef.current = [];
        selectedMarkerRef.current = null;
        setSelectedLocationId(null);
        infoWindowRef.current?.close();
    }

    function buildLocationInfoContent(location) {
        const container = document.createElement('div');
        container.className = 'p-1';
        const badgeColor = classificationColor(location.classification);
        container.innerHTML = `
            <div class="text-sm font-medium text-gray-900 mb-1">${escapeHtml(location.dwcDisplayName || locationAddress(location))}</div>
            <div class="text-xs text-gray-600 mb-1">${escapeHtml(locationAddress(location))}</div>
            ${location.phone ? `<div class="text-xs text-gray-600 mb-1">${escapeHtml(location.phone)}</div>` : ''}
            ${location.specialty ? `<div class="text-xs text-gray-600 mb-1">${escapeHtml(location.specialty)}</div>` : ''}
            <div class="text-xs font-medium" style="color: ${badgeColor}">${escapeHtml(classificationLabel(location.classification))}${location.classificationOverride ? ' (manual override)' : ''}</div>
        `;
        return container;
    }

    function openInfoWindowForMarker(marker) {
        const location = locationsRef.current.find((row) => row.id === marker.locationId);
        if (!location) return;
        infoWindowRef.current.setContent(buildLocationInfoContent(location));
        infoWindowRef.current.open(mapRef.current, marker);
    }

    function createMarkerObj(location) {
        const google = window.google;
        const color = classificationColor(location.classification);
        const marker = new google.maps.Marker({
            position: { lat: location.lat, lng: location.lng },
            map: mapRef.current,
            title: locationAddress(location),
            icon: createNumberedMarkerIcon(markersRef.current.length + 1, color, false, mapRef.current?.getZoom() ?? 12)
        });
        marker.locationId = location.id;
        marker.originalColor = color;

        markersRef.current.push(marker);

        marker.addListener('click', () => {
            selectMarkerObj(marker);
            openInfoWindowForMarker(marker);
        });

        return marker;
    }

    function fitMapToMarkers() {
        const google = window.google;
        if (!mapRef.current || markersRef.current.length === 0) return;

        const bounds = new google.maps.LatLngBounds();
        markersRef.current.forEach((marker) => bounds.extend(marker.getPosition()));

        const totalCount = markersRef.current.length;
        let pad = 50;
        if (totalCount === 1) pad = 100;
        else if (totalCount <= 3) pad = 80;

        mapRef.current.fitBounds(bounds, { top: pad, right: pad, bottom: pad, left: pad });

        // Zoom limits after fitBounds settles (same idiom as useMapEngine)
        setTimeout(() => {
            if (!mapRef.current) return;
            const currentZoom = mapRef.current.getZoom();
            let targetZoom = currentZoom;

            if (totalCount === 1) {
                targetZoom = Math.max(12, Math.min(currentZoom, 16));
            } else if (totalCount <= 5) {
                targetZoom = Math.max(10, Math.min(currentZoom, 15));
            } else {
                targetZoom = Math.max(8, Math.min(currentZoom, 14));
            }

            if (targetZoom !== currentZoom) {
                mapRef.current.setZoom(targetZoom);
            }
        }, 100);
    }

    // Only rows the geocoder has resolved get plotted; pending/failed rows
    // are listed in the sidebar's "needs geocoding" section instead.
    function plotLocations(rows, { fit = true } = {}) {
        const hadMarkers = markersRef.current.length > 0;
        clearMapObjects();
        rows
            .filter((row) => row.geocodeStatus === 'ok' && row.lat != null && row.lng != null)
            .forEach((row) => createMarkerObj(row));
        if (markersRef.current.length > 0 && (fit || !hadMarkers)) {
            fitMapToMarkers();
        }
    }

    // ================================
    // Background geocoding pass (Section 2 of the DWC plan)
    // ================================

    // Mirrors the bulk-upload geocode loop in useMapEngine: sequential
    // geocodeAddress calls with 1200ms pacing, cancelled (via token) whenever
    // the doctor selection changes or a newer pass starts.
    async function runGeocodePass(doctorId, rows) {
        const targets = rows.filter((row) => row.geocodeStatus === 'pending' || row.geocodeStatus === 'failed');
        if (targets.length === 0) return;

        const token = ++geocodeTokenRef.current;
        const isStale = () => geocodeTokenRef.current !== token || currentDoctorIdRef.current !== doctorId;

        setGeocodePass({ active: true, total: targets.length, done: 0, failed: 0 });
        let failed = 0;

        for (let i = 0; i < targets.length; i++) {
            if (isStale()) return;

            const row = targets[i];
            const address = locationAddress(row);
            try {
                const result = await geocodeAddress(address);
                if (isStale()) return;

                if (result.success) {
                    await doctorsApi.patchLocationGeocode(row.id, {
                        lat: result.location.lat,
                        lng: result.location.lng,
                        formattedAddress: result.formattedAddress
                    });
                    if (isStale()) return;
                    const next = applyLocationUpdate(row.id, {
                        lat: result.location.lat,
                        lng: result.location.lng,
                        geocodeStatus: 'ok',
                        geocodeError: null
                    });
                    // Re-plot as pins resolve; only auto-fit for the first pins.
                    plotLocations(next, { fit: false });
                } else {
                    failed++;
                    await doctorsApi.patchLocationGeocode(row.id, {
                        status: 'failed',
                        error: result.error || 'Geocoding failed'
                    });
                    if (isStale()) return;
                    applyLocationUpdate(row.id, { geocodeStatus: 'failed', geocodeError: result.error || 'Geocoding failed' });
                }
            } catch (error) {
                // PATCH failed (network/auth) — record locally, keep going.
                console.error('Error persisting geocode result:', error);
                failed++;
                if (isStale()) return;
                applyLocationUpdate(row.id, { geocodeStatus: 'failed', geocodeError: error.message || 'Request failed' });
            }

            setGeocodePass((p) => ({ ...p, done: i + 1, failed }));

            // Respect geocoding rate limits, exactly like the bulk-upload loop
            if (i < targets.length - 1) {
                await sleep(GEOCODE_PACE_MS);
            }
        }

        if (geocodeTokenRef.current === token) {
            setGeocodePass((p) => ({ ...p, active: false }));
            if (failed > 0) {
                popup('warning', `${failed} address${failed === 1 ? '' : 'es'} could not be geocoded. Use "Retry geocoding" to try again.`, 'Geocoding Incomplete');
            }
        }
    }

    // ================================
    // Doctor selection / location loading
    // ================================

    async function loadDoctorLocations(doctorId, { runGeocode = true } = {}) {
        setLocationsLoading(true);
        try {
            const fetched = await doctorsApi.fetchDoctorLocations(doctorId);
            const rows = Array.isArray(fetched) ? fetched : (fetched?.locations || []);
            if (currentDoctorIdRef.current !== doctorId) return;

            setLocationRows(rows);
            plotLocations(rows);

            if (runGeocode) {
                // Fire and forget: the pass paces itself and updates state/pins
                // incrementally. Guarded by geocodeTokenRef against re-entry.
                runGeocodePass(doctorId, rows);
            }
        } catch (error) {
            console.error('Error loading doctor locations:', error);
            popup('error', 'Failed to load DWC locations for this doctor.', 'Load Failed');
        } finally {
            setLocationsLoading(false);
        }
    }

    function selectDoctor(doctorId) {
        // Cancel any in-flight geocode pass for the previous doctor
        geocodeTokenRef.current++;
        setGeocodePass({ active: false, total: 0, done: 0, failed: 0 });

        setCurrentDoctor(doctorId || null);
        clearMapObjects();
        setLocationRows([]);

        if (doctorId) {
            loadDoctorLocations(doctorId);
        }
    }

    // Refetch + re-run the geocode pass for the current doctor (explicit
    // "Retry geocoding" action; reselecting the doctor does the same thing).
    function retryGeocoding() {
        const doctorId = currentDoctorIdRef.current;
        if (!doctorId) return;
        geocodeTokenRef.current++;
        loadDoctorLocations(doctorId);
    }

    // Reload the current doctor's locations without triggering geocoding
    // (used after classification-override clears) or with it (after syncs).
    function reloadLocations({ runGeocode = true } = {}) {
        const doctorId = currentDoctorIdRef.current;
        if (!doctorId) return;
        geocodeTokenRef.current++;
        loadDoctorLocations(doctorId, { runGeocode });
    }

    // ================================
    // Doctor CRUD (Manage Doctors section)
    // ================================

    async function createDoctor(payload) {
        const doctor = await doctorsApi.createDoctor(payload);
        await refreshDoctors();
        return doctor;
    }

    async function updateDoctor(doctorId, payload) {
        const doctor = await doctorsApi.updateDoctor(doctorId, payload);
        await refreshDoctors();
        return doctor;
    }

    async function setDoctorActive(doctorId, isActive) {
        await doctorsApi.setDoctorActive(doctorId, isActive);
        await refreshDoctors();
    }

    async function deleteDoctor(doctorId) {
        await doctorsApi.deleteDoctor(doctorId);
        if (currentDoctorIdRef.current === doctorId) {
            selectDoctor(null);
        }
        await refreshDoctors();
    }

    // ================================
    // Classification overrides (Admin/Staff; server enforces)
    // ================================

    async function setClassification(locationId, classification) {
        try {
            await doctorsApi.patchLocationClassification(locationId, classification);
            applyLocationUpdate(locationId, { classification, classificationOverride: true });

            const marker = markersRef.current.find((m) => m.locationId === locationId);
            if (marker) {
                marker.originalColor = classificationColor(classification);
                updateAllMarkerIcons();
            }
            infoWindowRef.current?.close();
            popup('success', `Classification set to ${classificationLabel(classification)}`, 'Classification Updated');
        } catch (error) {
            console.error('Error updating classification:', error);
            popup('error', 'Failed to update classification. Please try again.', 'Update Failed');
        }
    }

    async function clearClassificationOverride(locationId) {
        try {
            await doctorsApi.clearLocationClassificationOverride(locationId);
            // Clearing only removes the override flag; the classification value
            // itself is re-derived by the next sync, not immediately.
            applyLocationUpdate(locationId, { classificationOverride: false });
            popup('success', 'Manual override cleared. The next sync will auto-classify this location.', 'Override Cleared');
        } catch (error) {
            console.error('Error clearing classification override:', error);
            popup('error', 'Failed to clear override. Please try again.', 'Update Failed');
        }
    }

    // ================================
    // List interactions / view controls
    // ================================

    function selectLocationFromList(locationId) {
        const marker = markersRef.current.find((m) => m.locationId === locationId);
        if (!marker) return;
        selectMarkerObj(marker);
        mapRef.current.setCenter(marker.getPosition());
        mapRef.current.setZoom(15);
    }

    function fineZoom(delta) {
        fractionalZoomRef.current = Math.min(20, Math.max(1, fractionalZoomRef.current + delta));
        mapRef.current?.setZoom(fractionalZoomRef.current);
        setZoomDisplay(fractionalZoomRef.current.toFixed(1));
    }

    function triggerResize() {
        if (window.google?.maps && mapRef.current) {
            window.google.maps.event.trigger(mapRef.current, 'resize');
        }
    }

    // ================================
    // Map initialization (same bootstrap as useMapEngine)
    // ================================

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
                fractionalZoomRef.current = map.getZoom();
                setZoomDisplay(map.getZoom().toFixed(1));

                infoWindowRef.current = new gmaps.InfoWindow({
                    content: document.createElement('div'),
                    maxWidth: 240
                });

                map.addListener('click', () => clearMarkerSelection());

                const debouncedIconUpdate = debounce(updateAllMarkerIcons, 100);
                map.addListener('zoom_changed', debouncedIconUpdate);
                const debouncedBoundsUpdate = debounce(updateAllMarkerIcons, 150);
                map.addListener('bounds_changed', debouncedBoundsUpdate);

                map.addListener('zoom_changed', () => {
                    const z = map.getZoom();
                    // Sync only when zoom changed from outside (scroll wheel, native controls)
                    if (Math.abs(z - fractionalZoomRef.current) > 0.5) {
                        fractionalZoomRef.current = z;
                    }
                    setZoomDisplay(fractionalZoomRef.current.toFixed(1));
                });

                setMapReady(true);
                refreshDoctors();
            })
            .catch((error) => {
                console.error('Error loading configuration:', error);
                if (!cancelled) setMapError(true);
            });

        return () => {
            cancelled = true;
            geocodeTokenRef.current++; // cancel any in-flight geocode pass
            clearMapObjects();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ================================
    // Derived views for the sidebar
    // ================================

    const plottedLocations = useMemo(() => {
        let number = 0;
        return locations
            .filter((row) => row.geocodeStatus === 'ok' && row.lat != null && row.lng != null)
            .map((row) => ({ ...row, number: ++number }));
    }, [locations]);

    const ungeocodedLocations = useMemo(
        () => locations.filter((row) => row.geocodeStatus !== 'ok' || row.lat == null || row.lng == null),
        [locations]
    );

    const currentDoctor = useMemo(
        () => doctors.find((doctor) => doctor.id === currentDoctorId) || null,
        [doctors, currentDoctorId]
    );

    return {
        // refs for JSX
        mapDivRef,
        // map state
        mapReady,
        mapError,
        zoomDisplay,
        // doctors
        doctors,
        currentDoctor,
        currentDoctorId,
        includeInactiveDoctors,
        setIncludeInactiveDoctors,
        selectDoctor,
        refreshDoctors,
        createDoctor,
        updateDoctor,
        setDoctorActive,
        deleteDoctor,
        // locations
        locations,
        locationsLoading,
        plottedLocations,
        ungeocodedLocations,
        selectedLocationId,
        selectLocationFromList,
        reloadLocations,
        // geocoding pass
        geocodePass,
        retryGeocoding,
        // classification
        setClassification,
        clearClassificationOverride,
        // view controls
        fineZoomIn: () => fineZoom(0.1),
        fineZoomOut: () => fineZoom(-0.1),
        fitMapToMarkers,
        triggerResize
    };
}
