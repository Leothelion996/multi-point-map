import { useEffect, useMemo, useRef, useState } from 'react';
import * as groupsApi from '../api/groups.js';
import { lookupZip } from '../api/zipcodes.js';
import { loadGoogleMaps } from '../lib/googleMapsLoader.js';
import { createNumberedMarkerIcon } from '../lib/markerIcons.js';
import { buildInfoWindowContent } from '../lib/infoWindowContent.js';
import { geocodeAddress } from '../lib/geocode.js';
import { parseAddresses } from '../lib/parseAddresses.js';
import { usePopups } from '../context/PopupContext.jsx';

// Port of the script.js map engine. Google Maps objects (map, markers,
// polygons, info window) live in refs and are mutated imperatively, exactly
// like the legacy code; plain-data mirrors live in React state so the sidebar
// can render. Any function reachable from a Google Maps event listener reads
// only refs, never captured state.

// Color rotation for bulk upload (script.js:1906)
const BULK_COLORS = [
    '#ef4444', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6',
    '#ec4899', '#6366f1', '#f97316', '#14b8a6', '#6b7280'
];

const TEMP_STORAGE_KEY = 'tempGroups';

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

function readStoredTempGroups() {
    try {
        const raw = JSON.parse(sessionStorage.getItem(TEMP_STORAGE_KEY) || '[]');
        // Legacy entries were bare ids; new entries are {id, groupType}
        return raw.map((entry) => (typeof entry === 'string' ? { id: entry, groupType: null } : entry));
    } catch {
        return [];
    }
}

function writeStoredTempGroups(entries) {
    sessionStorage.setItem(TEMP_STORAGE_KEY, JSON.stringify(entries));
}

export function useMapEngine(groupType) {
    const { showPopup } = usePopups();

    // --- state (drives sidebar/modals rendering) ---
    const [mapReady, setMapReady] = useState(false);
    const [mapError, setMapError] = useState(false);
    const [groups, setGroups] = useState([]);
    const [currentGroupId, setCurrentGroupId] = useState(null);
    const [items, setItems] = useState([]); // [{locationId, kind:'marker'|'polygon', number, title, color}]
    const [selectedLocationId, setSelectedLocationId] = useState(null);
    const [selectedColor, setSelectedColor] = useState('#3b82f6'); // default blue, like legacy
    const [zoomDisplay, setZoomDisplay] = useState('12.0');
    const [tempGroupId, setTempGroupId] = useState(null);
    const [searchBusy, setSearchBusy] = useState(false);
    const [screenshotBusy, setScreenshotBusy] = useState(false);
    const [saveTempOpen, setSaveTempOpen] = useState(false);
    const [bulk, setBulk] = useState({ phase: 'idle', total: 0, current: 0, currentAddress: '', status: '', results: null });

    // --- refs (imperative map world + values read from map callbacks) ---
    const mapDivRef = useRef(null);
    const searchInputRef = useRef(null);
    const mapRef = useRef(null);
    const infoWindowRef = useRef(null);
    const markersRef = useRef([]);
    const polygonsRef = useRef({}); // locationId -> [google.maps.Polygon, ...]
    const selectedMarkerRef = useRef(null);
    const currentGroupIdRef = useRef(null);
    const groupsRef = useRef([]);
    const tempGroupIdRef = useRef(null);
    const selectedColorRef = useRef('#3b82f6');
    const fractionalZoomRef = useRef(12);
    const bulkCancelledRef = useRef(false);
    const bulkColorIndexRef = useRef(0);

    const showPopupRef = useRef(showPopup);
    showPopupRef.current = showPopup;
    const popup = (...args) => showPopupRef.current(...args);

    // ================================
    // State mirror helpers
    // ================================

    function setCurrentGroup(groupId) {
        currentGroupIdRef.current = groupId;
        setCurrentGroupId(groupId);
    }

    function syncItems() {
        const markerItems = markersRef.current.map((marker, index) => ({
            locationId: marker.locationId,
            kind: 'marker',
            number: index + 1,
            title: marker.getTitle(),
            color: marker.originalColor
        }));
        const polygonItems = Object.entries(polygonsRef.current).map(([locationId, parts], index) => ({
            locationId,
            kind: 'polygon',
            number: index + 1,
            title: parts[0].title || `ZIP Code ${index + 1}`,
            color: parts[0].strokeColor || parts[0].fillColor
        }));
        setItems([...markerItems, ...polygonItems]);
    }

    async function fetchGroupsList() {
        try {
            const fetched = await groupsApi.fetchGroups(groupType);
            const list = Array.isArray(fetched) ? fetched : [];
            groupsRef.current = list;
            setGroups(list);
            return list;
        } catch (error) {
            console.error('Error fetching location groups:', error);
            groupsRef.current = [];
            setGroups([]);
            return [];
        }
    }

    // ================================
    // Markers & polygons (imperative)
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

    async function changeItemColor(locationId, color) {
        // color: {name, value}
        try {
            await groupsApi.updateLocation(groupType, currentGroupIdRef.current, locationId, { color: color.value });

            const marker = markersRef.current.find((m) => m.locationId === locationId);
            if (marker) {
                marker.originalColor = color.value;
                updateAllMarkerIcons();
            }
            const parts = polygonsRef.current[locationId];
            if (parts) {
                parts.forEach((p) => p.setOptions({ strokeColor: color.value, fillColor: color.value }));
            }

            syncItems();
            infoWindowRef.current?.close();
            popup('success', `Color changed to ${color.name}`, 'Color Updated');
        } catch (error) {
            console.error('Error updating color:', error);
            popup('error', 'Failed to update color. Please try again.', 'Update Failed');
        }
    }

    async function deleteItem(locationId) {
        if (!currentGroupIdRef.current) return;
        try {
            await groupsApi.deleteLocation(groupType, currentGroupIdRef.current, locationId);

            const markerIndex = markersRef.current.findIndex((m) => m.locationId === locationId);
            if (markerIndex !== -1) {
                if (selectedMarkerRef.current === markersRef.current[markerIndex]) {
                    selectedMarkerRef.current = null;
                    setSelectedLocationId(null);
                }
                markersRef.current[markerIndex].setMap(null);
                markersRef.current.splice(markerIndex, 1);
            }
            removePolygonObj(locationId);

            updateAllMarkerIcons();
            syncItems();
            infoWindowRef.current?.close();
        } catch (error) {
            console.error('Error deleting marker:', error);
        }
    }

    function openInfoWindowForMarker(marker) {
        const content = buildInfoWindowContent({
            title: marker.getTitle(),
            position: { lat: marker.getPosition().lat(), lng: marker.getPosition().lng() },
            currentColor: marker.originalColor,
            onColorPick: (color) => changeItemColor(marker.locationId, color),
            onDelete: () => deleteItem(marker.locationId)
        });
        infoWindowRef.current.setContent(content);
        infoWindowRef.current.open(mapRef.current, marker);
    }

    function createMarkerObj(position, title, color, locationId) {
        const google = window.google;
        const marker = new google.maps.Marker({
            position,
            map: mapRef.current,
            title,
            icon: createNumberedMarkerIcon(markersRef.current.length + 1, color, false, mapRef.current?.getZoom() ?? 12)
        });
        marker.locationId = locationId;
        marker.originalColor = color;

        markersRef.current.push(marker);

        marker.addListener('click', () => {
            selectMarkerObj(marker);
            openInfoWindowForMarker(marker);
        });

        return marker;
    }

    function createPolygonObj(locationId, geometryJson, color, title) {
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
                popup('warning', 'ZIP code boundary data unavailable or unsupported format', 'Polygon Error');
                return null;
            }

            const polygonInstances = [];

            coordinateSets.forEach((polygonCoords) => {
                // GeoJSON [lng, lat] -> Google Maps {lat, lng}; outer ring only
                const paths = polygonCoords[0].map((coord) => ({ lat: coord[1], lng: coord[0] }));

                const polygon = new google.maps.Polygon({
                    paths,
                    strokeColor: color,
                    strokeOpacity: 0.8,
                    strokeWeight: 2,
                    fillColor: color,
                    fillOpacity: 0.35,
                    map: mapRef.current
                });
                polygon.locationId = locationId;
                polygon.title = title;
                polygonInstances.push(polygon);

                polygon.addListener('click', (event) => {
                    const currentColor = polygonsRef.current[locationId]?.[0]?.fillColor;
                    const content = buildInfoWindowContent({
                        title,
                        currentColor,
                        onColorPick: (colorOption) => changeItemColor(locationId, colorOption),
                        onDelete: () => deleteItem(locationId)
                    });
                    infoWindowRef.current.setContent(content);
                    infoWindowRef.current.setPosition(event.latLng);
                    infoWindowRef.current.open(mapRef.current);
                });

                // Hover highlights every part of a MultiPolygon together
                polygon.addListener('mouseover', () => {
                    polygonInstances.forEach((p) => p.setOptions({ fillOpacity: 0.5, strokeWeight: 3 }));
                });
                polygon.addListener('mouseout', () => {
                    polygonInstances.forEach((p) => p.setOptions({ fillOpacity: 0.35, strokeWeight: 2 }));
                });
            });

            polygonsRef.current[locationId] = polygonInstances;
            return polygonInstances;
        } catch (error) {
            console.error('Error creating polygon from geometry:', error);
            return null;
        }
    }

    function removePolygonObj(locationId) {
        const parts = polygonsRef.current[locationId];
        if (parts) {
            parts.forEach((p) => p.setMap(null));
            delete polygonsRef.current[locationId];
        }
    }

    function clearMapObjects() {
        markersRef.current.forEach((marker) => marker.setMap(null));
        markersRef.current = [];
        Object.values(polygonsRef.current).forEach((parts) => parts.forEach((p) => p.setMap(null)));
        polygonsRef.current = {};
        selectedMarkerRef.current = null;
        setSelectedLocationId(null);
    }

    function extendBoundsWithEverything(bounds) {
        markersRef.current.forEach((marker) => bounds.extend(marker.getPosition()));
        Object.values(polygonsRef.current).forEach((parts) => {
            parts.forEach((polygon) => {
                polygon.getPath().forEach((coord) => bounds.extend(coord));
            });
        });
    }

    // Port of fitMapToMarkers (script.js:2364) with the polygon-array bug fixed
    function fitMapToMarkers() {
        const google = window.google;
        const polygonCount = Object.keys(polygonsRef.current).length;
        if (markersRef.current.length === 0 && polygonCount === 0) return;

        const bounds = new google.maps.LatLngBounds();
        extendBoundsWithEverything(bounds);

        const totalCount = markersRef.current.length + polygonCount;
        let pad = 50;
        if (totalCount === 1) pad = 100;
        else if (totalCount <= 3) pad = 80;

        mapRef.current.fitBounds(bounds, { top: pad, right: pad, bottom: pad, left: pad });

        // Zoom limits after fitBounds settles
        setTimeout(() => {
            const currentZoom = mapRef.current.getZoom();
            let targetZoom = currentZoom;

            if (totalCount === 1 && markersRef.current.length === 1) {
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

    // ================================
    // Group selection / loading
    // ================================

    async function loadGroupMarkers(groupId) {
        clearMapObjects();
        syncItems();
        if (!groupId) {
            setItems([]);
            return;
        }

        try {
            const group = await groupsApi.fetchGroup(groupType, groupId);

            group.locations.forEach((location) => {
                if (location.geometry && groupType === 'zipcodes') {
                    createPolygonObj(location.id, location.geometry, location.color, location.title);
                } else {
                    createMarkerObj({ lat: location.lat, lng: location.lng }, location.title, location.color, location.id);
                }
            });

            syncItems();

            if (markersRef.current.length > 0 || Object.keys(polygonsRef.current).length > 0) {
                const google = window.google;
                const mapBounds = new google.maps.LatLngBounds();
                extendBoundsWithEverything(mapBounds);
                mapRef.current.fitBounds(mapBounds);

                if (markersRef.current.length === 1 && Object.keys(polygonsRef.current).length === 0) {
                    mapRef.current.setZoom(15);
                }
            }
        } catch (error) {
            console.error('Error loading group markers:', error);
        }
    }

    function hasTempAddressesNow() {
        return Boolean(
            tempGroupIdRef.current &&
            currentGroupIdRef.current === tempGroupIdRef.current &&
            (markersRef.current.length > 0 || Object.keys(polygonsRef.current).length > 0)
        );
    }

    function selectGroup(groupId, { bypassTempGuard = false } = {}) {
        // Legacy guard: switching away from an unsaved temp group prompts to save first
        if (!bypassTempGuard && hasTempAddressesNow() && groupId !== tempGroupIdRef.current) {
            setSaveTempOpen(true);
            return;
        }
        setCurrentGroup(groupId || null);
        loadGroupMarkers(groupId || null);
    }

    async function createGroup(name) {
        const group = await groupsApi.createGroup(groupType, name);
        groupsRef.current = [...groupsRef.current, group];
        setGroups(groupsRef.current);
        return group;
    }

    async function deleteGroup(groupId) {
        try {
            await groupsApi.deleteGroup(groupType, groupId);
            const deletedGroup = groupsRef.current.find((g) => g.id === groupId);
            groupsRef.current = groupsRef.current.filter((g) => g.id !== groupId);
            setGroups(groupsRef.current);

            if (currentGroupIdRef.current === groupId) {
                setCurrentGroup(null);
                clearMapObjects();
                setItems([]);
            }

            if (deletedGroup) {
                popup('success', `Group "${deletedGroup.name}" deleted successfully`, 'Group Deleted');
            }
            return true;
        } catch (error) {
            console.error('Error deleting location group:', error);
            popup('error', 'Failed to delete group. Please try again.', 'Delete Error');
            return false;
        }
    }

    // ================================
    // Temp group system
    // ================================

    async function ensureGroupSelected() {
        if (currentGroupIdRef.current) return currentGroupIdRef.current;

        if (!tempGroupIdRef.current) {
            try {
                const group = await createGroup(`__temp_${Date.now()}`);
                tempGroupIdRef.current = group.id;
                setTempGroupId(group.id);
                writeStoredTempGroups([...readStoredTempGroups(), { id: group.id, groupType }]);
            } catch (error) {
                console.error('Error creating temp group:', error);
                return null;
            }
        }
        setCurrentGroup(tempGroupIdRef.current);
        return tempGroupIdRef.current;
    }

    async function cleanupTempGroups() {
        const stored = readStoredTempGroups();
        for (const entry of stored) {
            try {
                await groupsApi.deleteGroup(entry.groupType || groupType, entry.id);
            } catch (error) {
                console.error('Error cleaning up temp group:', error);
            }
        }
        sessionStorage.removeItem(TEMP_STORAGE_KEY);
        tempGroupIdRef.current = null;
        setTempGroupId(null);
    }

    function forgetTempGroup(groupId) {
        writeStoredTempGroups(readStoredTempGroups().filter((entry) => entry.id !== groupId));
        tempGroupIdRef.current = null;
        setTempGroupId(null);
    }

    async function saveTempAddresses({ newGroupName, existingGroupId }) {
        const tempId = tempGroupIdRef.current;
        if (!tempId) return;

        let targetGroupId;
        if (newGroupName) {
            try {
                const newGroup = await createGroup(newGroupName);
                targetGroupId = newGroup.id;
            } catch (error) {
                console.error('Failed to create group:', error);
                popup('error', `Failed to create group: ${error.message}`, 'Save Failed');
                return;
            }
        } else if (existingGroupId) {
            targetGroupId = existingGroupId;
        } else {
            popup('warning', 'Please enter a group name or select an existing group.', 'Input Required');
            return;
        }

        try {
            // Move temp locations to the target group: re-add each, then drop the temp group.
            // (The legacy PUT /api/locations/:id endpoint never existed server-side.)
            const tempGroup = await groupsApi.fetchGroup(groupType, tempId);
            for (const location of tempGroup.locations) {
                const payload = {
                    lat: location.lat,
                    lng: location.lng,
                    title: location.title,
                    color: location.color
                };
                if (location.geometry) payload.geometry = location.geometry;
                await groupsApi.addLocation(groupType, targetGroupId, payload);
            }

            await groupsApi.deleteGroup(groupType, tempId);
            forgetTempGroup(tempId);

            await fetchGroupsList();
            selectGroup(targetGroupId, { bypassTempGuard: true });

            setSaveTempOpen(false);
            popup('success', `Successfully saved ${tempGroup.locations.length} addresses!`, 'Addresses Saved');
        } catch (error) {
            console.error('Error saving temp addresses:', error);
            popup('error', 'Failed to save addresses. Please try again.', 'Save Failed');
        }
    }

    async function discardTempAddresses() {
        const tempId = tempGroupIdRef.current;
        if (!tempId) return;

        try {
            await groupsApi.deleteGroup(groupType, tempId);
            forgetTempGroup(tempId);

            groupsRef.current = groupsRef.current.filter((g) => g.id !== tempId);
            setGroups(groupsRef.current);
            setCurrentGroup(null);
            clearMapObjects();
            setItems([]);

            setSaveTempOpen(false);
            popup('info', 'Temporary addresses discarded.', 'Discarded');
        } catch (error) {
            console.error('Error discarding temp addresses:', error);
            popup('error', 'Failed to discard addresses. Please try again.', 'Discard Failed');
        }
    }

    // ================================
    // Adding locations
    // ================================

    async function addLocationAndRender(groupId, locationData, { centerZoom }) {
        const newLocation = await groupsApi.addLocation(groupType, groupId, locationData);
        if (!newLocation) return null;

        if (newLocation.geometry && groupType === 'zipcodes') {
            createPolygonObj(newLocation.id, newLocation.geometry, newLocation.color, newLocation.title);
        } else {
            if (newLocation.geometry === undefined && groupType === 'zipcodes') {
                popup('info', 'No boundary data available for this ZIP code. Showing as marker instead.', 'Notice');
            }
            createMarkerObj({ lat: newLocation.lat, lng: newLocation.lng }, newLocation.title, newLocation.color, newLocation.id);
        }

        syncItems();
        if (centerZoom) {
            mapRef.current.setCenter({ lat: newLocation.lat, lng: newLocation.lng });
            mapRef.current.setZoom(centerZoom);
        }
        await fetchGroupsList();
        return newLocation;
    }

    async function addFromPlace(place) {
        setSearchBusy(true);
        try {
            const groupId = await ensureGroupSelected();
            if (!groupId) {
                popup('warning', 'Unable to create temporary group. Please select a group first.', 'Group Required');
                return;
            }

            const location = place.geometry.location;
            const newLocation = await addLocationAndRender(groupId, {
                lat: location.lat(),
                lng: location.lng(),
                title: place.formatted_address || place.name,
                color: selectedColorRef.current
            }, { centerZoom: 15 });

            if (newLocation) {
                if (searchInputRef.current) searchInputRef.current.value = '';
                popup('success', `Added "${newLocation.title}" to map`, 'Location Added');
            } else {
                popup('error', 'Failed to add location. Please try again.', 'Add Failed');
            }
        } catch (error) {
            console.error('Error adding location:', error);
            popup('error', 'Failed to add location. Please try again.', 'Add Failed');
        } finally {
            setSearchBusy(false);
        }
    }

    async function addFromSearch() {
        const query = searchInputRef.current?.value.trim();
        if (!query) {
            popup('warning', 'Please enter a location to search for!', 'Location Required');
            searchInputRef.current?.focus();
            return;
        }

        setSearchBusy(true);
        try {
            const groupId = await ensureGroupSelected();
            if (!groupId) {
                popup('warning', 'Unable to create temporary group. Please select a group first.', 'Group Required');
                return;
            }

            const result = await geocodeAddress(query);
            if (!result.success) {
                popup('error', 'Location not found. Please try a different search term.', 'Search Failed');
                return;
            }

            const newLocation = await addLocationAndRender(groupId, {
                lat: result.location.lat,
                lng: result.location.lng,
                title: result.formattedAddress,
                color: selectedColorRef.current
            }, { centerZoom: 15 });

            if (newLocation) {
                if (searchInputRef.current) searchInputRef.current.value = '';
                popup('success', `Added "${newLocation.title}" to map`, 'Location Added');
            } else {
                popup('error', 'Failed to add location. Please try again.', 'Add Failed');
            }
        } catch (error) {
            console.error('Error adding location from search:', error);
            popup('error', 'Failed to add location. Please try again.', 'Add Failed');
        } finally {
            setSearchBusy(false);
        }
    }

    async function addZipCode(zipCode) {
        try {
            const groupId = await ensureGroupSelected();
            if (!groupId) {
                popup('warning', 'Unable to create temporary group. Please select a group first.', 'Group Required');
                return;
            }

            let zipData;
            try {
                zipData = await lookupZip(zipCode);
            } catch (error) {
                if (error.status === 404) {
                    popup('error', `ZIP code ${zipCode} not found. Please verify the ZIP code.`, 'ZIP Not Found');
                } else {
                    popup('error', 'Failed to lookup ZIP code. Please try again.', 'Lookup Failed');
                }
                return;
            }

            const locationData = {
                lat: zipData.center.lat,
                lng: zipData.center.lng,
                title: zipData.title,
                color: selectedColorRef.current
            };
            if (zipData.geometry) locationData.geometry = zipData.geometry;

            const newLocation = await addLocationAndRender(groupId, locationData, { centerZoom: 12 });
            if (newLocation) {
                popup('success', `Added ${zipData.title} to map`, 'ZIP Code Added');
            } else {
                popup('error', 'Failed to add ZIP code. Please try again.', 'Add Failed');
            }
        } catch (error) {
            console.error('Error adding ZIP code:', error);
            popup('error', 'Failed to add ZIP code. Please try again.', 'Add Failed');
        }
    }

    // ================================
    // List interactions
    // ================================

    function selectItemFromList(locationId) {
        const marker = markersRef.current.find((m) => m.locationId === locationId);
        if (marker) {
            selectMarkerObj(marker);
            mapRef.current.setCenter(marker.getPosition());
            mapRef.current.setZoom(15);
            return;
        }

        const parts = polygonsRef.current[locationId];
        if (parts) {
            const google = window.google;
            const bounds = new google.maps.LatLngBounds();
            parts.forEach((p) => p.getPath().forEach((coord) => bounds.extend(coord)));
            mapRef.current.fitBounds(bounds);
            setSelectedLocationId(locationId);
        }
    }

    async function reorderMarkers(fromIndex, toIndex) {
        const moved = markersRef.current.splice(fromIndex, 1)[0];
        markersRef.current.splice(toIndex, 0, moved);

        updateAllMarkerIcons();
        syncItems();

        if (currentGroupIdRef.current) {
            try {
                const locationIds = markersRef.current.map((marker) => marker.locationId);
                await groupsApi.reorderLocations(groupType, currentGroupIdRef.current, locationIds);
            } catch (error) {
                console.error('Error reordering markers on server:', error);
            }
        }
    }

    function pickColor(colorHex) {
        selectedColorRef.current = colorHex;
        setSelectedColor(colorHex);
        // Legacy behavior: picking a swatch while a marker is selected recolors it
        if (selectedMarkerRef.current && currentGroupIdRef.current) {
            const marker = selectedMarkerRef.current;
            groupsApi.updateLocation(groupType, currentGroupIdRef.current, marker.locationId, { color: colorHex })
                .then(() => {
                    marker.originalColor = colorHex;
                    updateAllMarkerIcons();
                    syncItems();
                })
                .catch((error) => console.error('Error updating marker color:', error));
        }
    }

    // ================================
    // Zoom controls
    // ================================

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
    // Bulk upload (port of processBulkAddresses, script.js:2091)
    // ================================

    function openBulkModal() {
        bulkCancelledRef.current = false;
        setBulk({ phase: 'input', total: 0, current: 0, currentAddress: '', status: '', results: null });
    }

    function closeBulkModal() {
        setBulk((b) => ({ ...b, phase: 'idle' }));
    }

    function cancelBulkProcessing() {
        bulkCancelledRef.current = true;
        setBulk((b) => ({ ...b, phase: 'idle' }));
    }

    async function startBulkUpload(rawInput, bulkGroupName) {
        const addresses = parseAddresses(rawInput);
        if (addresses.length === 0) {
            popup('warning', 'Please enter at least one address.', 'Input Required');
            return;
        }

        // Resolve target group
        let targetGroupId = currentGroupIdRef.current;
        if (bulkGroupName) {
            try {
                const newGroup = await createGroup(bulkGroupName);
                targetGroupId = newGroup.id;
            } catch (error) {
                console.error('Failed to create group:', error);
                popup('error', `Failed to create group: ${error.message}`, 'Group Creation Failed');
                return;
            }
        } else if (!targetGroupId) {
            if (groupsRef.current.length === 0) {
                try {
                    const defaultGroup = await createGroup('My Locations');
                    targetGroupId = defaultGroup.id;
                } catch {
                    popup('warning', 'Please create a location group first.', 'Group Required');
                    return;
                }
            } else {
                popup('warning', 'Please select a location group or enter a new group name.', 'Group Required');
                return;
            }
        }

        if (addresses.length > 10) {
            if (!window.confirm(`You're about to process ${addresses.length} addresses. This may take a few minutes. Continue?`)) {
                return;
            }
        }

        // Show the target group (loads any existing content), then process
        selectGroup(targetGroupId, { bypassTempGuard: true });

        bulkCancelledRef.current = false;
        bulkColorIndexRef.current = 0;
        setBulk({ phase: 'processing', total: addresses.length, current: 0, currentAddress: 'Preparing...', status: 'Starting bulk upload...', results: null });

        const results = { successful: [], failed: [] };

        for (let i = 0; i < addresses.length; i++) {
            if (bulkCancelledRef.current) break;

            const address = addresses[i];
            setBulk((b) => ({
                ...b,
                current: i,
                currentAddress: address,
                status: `Processing address ${i + 1} of ${addresses.length}...`
            }));

            try {
                let locationData = null;

                if (groupType === 'zipcodes') {
                    const zipCode = address.trim();
                    if (!/^\d{5}$/.test(zipCode)) {
                        results.failed.push({ address, reason: 'Invalid ZIP code format (must be 5 digits)' });
                        continue;
                    }

                    try {
                        const zipData = await lookupZip(zipCode);
                        const color = BULK_COLORS[bulkColorIndexRef.current % BULK_COLORS.length];
                        bulkColorIndexRef.current++;

                        locationData = {
                            lat: zipData.center.lat,
                            lng: zipData.center.lng,
                            title: zipData.title,
                            color
                        };
                        if (zipData.geometry) locationData.geometry = zipData.geometry;
                    } catch (error) {
                        results.failed.push({ address, reason: error.status === 404 ? 'ZIP code not found' : 'Lookup failed' });
                        continue;
                    }
                } else {
                    const result = await geocodeAddress(address);
                    if (!result.success) {
                        results.failed.push({ address, reason: result.error || 'Address not found' });
                        continue;
                    }

                    const color = BULK_COLORS[bulkColorIndexRef.current % BULK_COLORS.length];
                    bulkColorIndexRef.current++;

                    locationData = {
                        lat: result.location.lat,
                        lng: result.location.lng,
                        title: result.formattedAddress,
                        color
                    };
                }

                const newLocation = await groupsApi.addLocation(groupType, targetGroupId, locationData);
                if (newLocation) {
                    if (newLocation.geometry && groupType === 'zipcodes') {
                        createPolygonObj(newLocation.id, newLocation.geometry, newLocation.color, newLocation.title);
                    } else {
                        createMarkerObj({ lat: newLocation.lat, lng: newLocation.lng }, newLocation.title, newLocation.color, newLocation.id);
                    }
                    results.successful.push({ address, result: newLocation });
                } else {
                    results.failed.push({ address, reason: 'Failed to save to database' });
                }
            } catch (error) {
                results.failed.push({ address, reason: error.message || 'Unexpected error' });
            }

            // Respect geocoding rate limits, like the legacy code
            if (i < addresses.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 1200));
            }
        }

        syncItems();
        if (results.successful.length > 0) {
            fitMapToMarkers();
        }
        await fetchGroupsList();

        if (bulkCancelledRef.current) {
            setBulk({ phase: 'results', total: addresses.length, current: addresses.length, currentAddress: '', status: '', results });
        } else {
            setBulk((b) => ({ ...b, current: addresses.length, currentAddress: 'Completed!', status: 'Upload complete' }));
            setTimeout(() => {
                setBulk({ phase: 'results', total: addresses.length, current: addresses.length, currentAddress: '', status: '', results });
            }, 1000);
        }
    }

    // ================================
    // Map initialization
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
                    maxWidth: 200
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
                fetchGroupsList();
                cleanupTempGroups();
            })
            .catch((error) => {
                console.error('Error loading configuration:', error);
                if (!cancelled) setMapError(true);
            });

        return () => {
            cancelled = true;
            clearMapObjects();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Places Autocomplete on the locations page (script.js:621)
    useEffect(() => {
        if (!mapReady || groupType === 'zipcodes' || !searchInputRef.current) return undefined;

        const google = window.google;
        const input = searchInputRef.current;
        const autocomplete = new google.maps.places.Autocomplete(input, {
            types: ['geocode'],
            componentRestrictions: { country: 'us' }
        });

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (place.geometry) {
                addFromPlace(place);
            }
        });

        return () => {
            google.maps.event.clearInstanceListeners(input);
            document.querySelectorAll('.pac-container').forEach((el) => el.remove());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapReady]);

    // Warn before closing/reloading the tab with unsaved temp addresses
    const hasTemp = Boolean(
        tempGroupId &&
        currentGroupId === tempGroupId &&
        items.length > 0
    );

    useEffect(() => {
        if (!hasTemp) return undefined;
        function onBeforeUnload(e) {
            e.preventDefault();
            e.returnValue = 'You have unsaved addresses. Are you sure you want to leave?';
            return e.returnValue;
        }
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [hasTemp]);

    const visibleGroups = useMemo(
        () => groups.filter((group) => !group.name.startsWith('__temp_')),
        [groups]
    );

    return {
        // refs for JSX
        mapDivRef,
        searchInputRef,
        // map state
        mapReady,
        mapError,
        zoomDisplay,
        // groups
        groups,
        visibleGroups,
        currentGroupId,
        tempGroupId,
        selectGroup,
        createGroup,
        deleteGroup,
        fetchGroupsList,
        // items / list
        items,
        selectedLocationId,
        selectItemFromList,
        deleteItem,
        reorderMarkers,
        // colors
        selectedColor,
        pickColor,
        // adding
        addFromSearch,
        addZipCode,
        searchBusy,
        // view controls
        fineZoomIn: () => fineZoom(0.1),
        fineZoomOut: () => fineZoom(-0.1),
        fitMapToMarkers,
        triggerResize,
        // temp groups
        hasTemp,
        tempCount: hasTemp ? items.length : 0,
        saveTempOpen,
        openSaveTempModal: () => setSaveTempOpen(true),
        closeSaveTempModal: () => setSaveTempOpen(false),
        saveTempAddresses,
        discardTempAddresses,
        // bulk upload
        bulk,
        openBulkModal,
        closeBulkModal,
        cancelBulkProcessing,
        startBulkUpload,
        // screenshot busy flag (set by MapPage around lib/screenshot)
        screenshotBusy,
        setScreenshotBusy
    };
}
