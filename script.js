// Only initialize AOS and run map-specific code if we're on the map page
if (typeof isMapPage === 'function' && isMapPage()) {
    // Initialize AOS
    AOS.init();

    // Initialize Feather Icons
    feather.replace();

// DOM Utility Service
class DOMCache {
    constructor() {
        this.elements = {};
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;

        // Cache frequently accessed elements
        this.elements = {
            // Group management
            groupDropdownMenu: document.getElementById('group-dropdown-menu'),
            customGroupSelect: document.getElementById('custom-group-select'),
            newGroupBtn: document.getElementById('new-group-btn'),
            newGroupInput: document.getElementById('new-group-input'),

            // Navigation and controls
            seeAllMarkersBtn: document.getElementById('see-all-markers-btn'),
            addMarkerBtnSidebar: document.getElementById('add-marker-btn-sidebar'),
            bulkUploadBtn: document.getElementById('bulk-upload-btn'),
            saveTempBtn: document.getElementById('save-temp-btn'),
            tempCountBadge: document.getElementById('temp-count-badge'),

            // Search and options
            locationSearch: document.getElementById('location-search'),
            optionsDropdownContent: document.getElementById('options-dropdown-content'),

            // Sidebar and map
            sidebar: document.getElementById('sidebar'),
            mapContainer: document.getElementById('map-container'),
            markersContainer: document.getElementById('markers-container'),

            // Modals
            bulkUploadModal: document.getElementById('bulk-upload-modal'),
            saveTempModal: document.getElementById('save-temp-modal'),
            bulkResultsModal: document.getElementById('bulk-results-modal'),

            // Bulk upload elements
            bulkAddressesInput: document.getElementById('bulk-addresses-input'),
            bulkGroupName: document.getElementById('bulk-group-name'),
            addressCount: document.getElementById('address-count'),

            // Progress tracking
            progressCount: document.getElementById('progress-count'),
            progressPercentage: document.getElementById('progress-percentage'),
            progressBar: document.getElementById('progress-bar'),
            progressStatus: document.getElementById('progress-status'),
            currentAddress: document.getElementById('current-address'),

            // Results
            successCount: document.getElementById('success-count'),
            failedCount: document.getElementById('failed-count'),
            failedAddressesSection: document.getElementById('failed-addresses-section'),
            failedAddressesList: document.getElementById('failed-addresses-list'),

            // Save temp modal elements
            saveTempGroupName: document.getElementById('save-temp-group-name'),
            saveTempGroupSelect: document.getElementById('save-temp-group-select'),
            tempAddressCount: document.getElementById('temp-address-count'),

            // Popup container
            popupContainer: document.getElementById('popup-container')
        };

        this.initialized = true;
    }

    get(elementName) {
        if (!this.initialized) {
            this.init();
        }
        return this.elements[elementName];
    }

    // Helper method to safely get element
    safeGet(elementName) {
        const element = this.get(elementName);
        if (!element) {
            console.warn(`DOM element '${elementName}' not found`);
        }
        return element;
    }

    // Refresh cache (useful after dynamic content changes)
    refresh() {
        this.initialized = false;
        this.init();
    }
}

// Create global DOM cache instance
const domCache = new DOMCache();

// API Service for centralized HTTP requests
class APIService {
    constructor() {
        this.baseURL = '/api';
        this.defaultHeaders = {
            'Content-Type': 'application/json'
        };
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const config = {
            headers: this.defaultHeaders,
            ...options
        };

        if (config.body && typeof config.body === 'object') {
            config.body = JSON.stringify(config.body);
        }

        try {
            const response = await fetch(url, config);

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
            }

            // Handle 204 No Content responses
            if (response.status === 204) {
                return null;
            }

            return await response.json();
        } catch (error) {
            console.error(`API request failed: ${url}`, error);
            throw error;
        }
    }

    // Configuration
    async getConfig() {
        return this.request('/config');
    }

    // Location Groups CRUD
    async getLocationGroups() {
        return this.request('/location-groups');
    }

    async getLocationGroup(id) {
        return this.request(`/location-groups/${id}`);
    }

    async createLocationGroup(name, locations = []) {
        return this.request('/location-groups', {
            method: 'POST',
            body: { name, locations }
        });
    }

    async updateLocationGroup(id, data) {
        return this.request(`/location-groups/${id}`, {
            method: 'PUT',
            body: data
        });
    }

    async deleteLocationGroup(id) {
        return this.request(`/location-groups/${id}`, {
            method: 'DELETE'
        });
    }

    // Locations CRUD
    async createLocation(groupId, locationData) {
        return this.request(`/location-groups/${groupId}/locations`, {
            method: 'POST',
            body: locationData
        });
    }

    async updateLocation(groupId, locationId, data) {
        return this.request(`/location-groups/${groupId}/locations/${locationId}`, {
            method: 'PUT',
            body: data
        });
    }

    async deleteLocation(groupId, locationId) {
        return this.request(`/location-groups/${groupId}/locations/${locationId}`, {
            method: 'DELETE'
        });
    }

    async reorderLocations(groupId, locationIds) {
        return this.request(`/location-groups/${groupId}/locations/reorder`, {
            method: 'PUT',
            body: { locationIds }
        });
    }
}

// Create global API service instance
const apiService = new APIService();

// Global variables
let map;
let markers = [];
let infoWindow;
let bounds;
let currentGroupId = null;
let locationGroups = [];
let googleMapsApiKey = '';
let autocomplete;
let selectedMarker = null;
let tempGroupId = null;
let popupCounter = 0;

// Debounce function for performance optimization
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Function to calculate marker size based on zoom level
function calculateMarkerSize(zoom, isSelected = false) {
    // Set absolute minimum and maximum sizes to prevent compounding
    const MIN_SIZE = 12; // Increased minimum size
    const MAX_SIZE = 24;
    let baseSize;

    // More conservative scaling to prevent shrinking issues
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

// Function to create numbered marker icon with zoom-based sizing
function createNumberedMarkerIcon(number, color, isSelected = false, zoomLevel = 12) {
    const scale = calculateMarkerSize(zoomLevel, isSelected);
    const strokeWeight = isSelected ? 3 : 0;
    const strokeColor = isSelected ? '#ffffff' : '';

    // Adjust font size based on marker size
    const fontSize = Math.max(8, Math.min(14, scale * 0.8));

    // Create SVG for numbered marker
    const svg = `
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="12" fill="${color}" stroke="${strokeColor}" stroke-width="${strokeWeight}"/>
            <text x="16" y="16" text-anchor="middle" dominant-baseline="central" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="white">${number}</text>
        </svg>
    `;

    const encodedSvg = 'data:image/svg+xml;base64,' + btoa(svg);

    return {
        url: encodedSvg,
        scaledSize: new google.maps.Size(scale * 2, scale * 2),
        anchor: new google.maps.Point(scale, scale)
    };
}

// Load configuration and initialize
async function loadConfig() {
    try {
        const response = await fetch('/api/config');

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const config = await response.json();
        googleMapsApiKey = config.googleMapsApiKey;
        loadGoogleMaps();
    } catch (error) {
        console.error('Error loading configuration:', error);
        // Show user-friendly error message
        const mapContainer = document.getElementById('map');
        if (mapContainer) {
            mapContainer.innerHTML = '<div style="display: flex; align-items: center; justify-content: center; height: 100%; background-color: #f3f4f6; color: #6b7280; font-family: Inter, sans-serif;"><div style="text-align: center;"><h3 style="margin: 0 0 8px 0;">Map Configuration Error</h3><p style="margin: 0;">Unable to load Google Maps. Please check the server connection.</p></div></div>';
        }
    }
}

// Dynamically load Google Maps with Places library
function loadGoogleMaps() {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places&callback=initMap`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
}

// API functions
async function fetchLocationGroups() {
    try {
        const response = await fetch('/api/location-groups');

        if (!response.ok) {
            console.error('Failed to fetch location groups:', response.status, response.statusText);
            locationGroups = []; // Ensure it stays an array
            updateGroupSelect();
            return;
        }

        const groups = await response.json();
        locationGroups = Array.isArray(groups) ? groups : [];
        updateGroupSelect();
    } catch (error) {
        console.error('Error fetching location groups:', error);
        locationGroups = []; // Ensure it stays an array
        updateGroupSelect();
    }
}

async function createLocationGroup(name) {
    try {
        const response = await fetch('/api/location-groups', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, locations: [] })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            console.error('Server error creating location group:', errorData);
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const group = await response.json();
        locationGroups.push(group);
        updateGroupSelect();
        return group;
    } catch (error) {
        console.error('Error creating location group:', error);
        throw error; // Re-throw to allow caller to handle
    }
}

async function deleteLocationGroup(groupId) {
    try {
        const response = await fetch(`/api/location-groups/${groupId}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            const deletedGroup = locationGroups.find(g => g.id === groupId);

            // Remove from local array
            locationGroups = locationGroups.filter(group => group.id !== groupId);

            // Clear current selection if it was the deleted group
            if (currentGroupId === groupId) {
                currentGroupId = null;
                markers.forEach(marker => marker.setMap(null));
                markers = [];
                updateMarkerList();
                // Reset group selection UI
                selectGroup(null);
            }

            // Update UI
            updateGroupSelect();

            // Update see all button state
            const seeAllBtn = document.getElementById('see-all-markers-btn');
            seeAllBtn.disabled = !currentGroupId || markers.length === 0;

            // Show success message
            if (deletedGroup) {
                showPopup('success', `Group "${deletedGroup.name}" deleted successfully`, 'Group Deleted');
            }

            return true;
        } else {
            throw new Error('Failed to delete group');
        }
    } catch (error) {
        console.error('Error deleting location group:', error);
        showPopup('error', 'Failed to delete group. Please try again.', 'Delete Error');
        return false;
    }
}

function deleteSelectedGroup() {
    if (!currentGroupId) return;

    const selectedGroup = locationGroups.find(group => group.id === currentGroupId);
    if (!selectedGroup) return;

    const confirmDelete = confirm(`Are you sure you want to delete the group "${selectedGroup.name}"? This will also delete all markers in this group.`);

    if (confirmDelete) {
        deleteLocationGroup(currentGroupId);
    }
}

async function addLocationToGroup(groupId, location) {
    try {
        const response = await fetch(`/api/location-groups/${groupId}/locations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(location)
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            console.error('Server error adding location:', errorData);
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const newLocation = await response.json();
        return newLocation;
    } catch (error) {
        console.error('Error adding location to group:', error);
        throw error; // Re-throw to allow caller to handle
    }
}

async function deleteLocationFromGroup(groupId, locationId) {
    try {
        await fetch(`/api/location-groups/${groupId}/locations/${locationId}`, {
            method: 'DELETE'
        });
    } catch (error) {
        console.error('Error deleting location from group:', error);
    }
}

function updateGroupSelect() {
    const dropdown = document.getElementById('group-dropdown-menu');
    dropdown.innerHTML = '';

    // Filter out temporary groups from the dropdown display
    const visibleGroups = locationGroups.filter(group => !group.name.startsWith('__temp_'));

    visibleGroups.forEach(group => {
        const option = document.createElement('div');
        option.className = 'group-option flex items-center justify-between px-3 py-2 hover:bg-gray-50 cursor-pointer';
        option.dataset.groupId = group.id;
        option.innerHTML = `
            <span class="flex-1 text-sm text-gray-900">${group.name}</span>
            <button class="delete-group-btn ml-2 text-gray-400 hover:text-red-600 p-1" data-group-id="${group.id}" title="Delete group">
                <i data-feather="x" class="h-4 w-4"></i>
            </button>
        `;
        dropdown.appendChild(option);
    });

    // Re-render feather icons
    feather.replace();

    // Add event listeners for group selection and deletion
    dropdown.querySelectorAll('.group-option').forEach(option => {
        option.addEventListener('click', function(e) {
            if (!e.target.closest('.delete-group-btn')) {
                selectGroup(this.dataset.groupId);
            }
        });
    });

    dropdown.querySelectorAll('.delete-group-btn').forEach(button => {
        button.addEventListener('click', function(e) {
            e.stopPropagation();
            const groupId = this.dataset.groupId;
            const group = locationGroups.find(g => g.id === groupId);
            if (group && confirm(`Are you sure you want to delete the group "${group.name}"? This will also delete all markers in this group.`)) {
                deleteLocationGroup(groupId);
            }
        });
    });
}

function selectGroup(groupId) {
    currentGroupId = groupId;
    const selectedGroup = locationGroups.find(g => g.id === groupId);
    const selectedText = document.getElementById('selected-group-text');
    const dropdown = document.getElementById('group-dropdown-menu');
    const selectButton = document.getElementById('custom-group-select');

    if (selectedGroup) {
        // Show user-friendly name for temporary groups
        if (selectedGroup.name.startsWith('__temp_')) {
            selectedText.textContent = 'Temporary Locations';
        } else {
            selectedText.textContent = selectedGroup.name;
        }
        // Add visual feedback for selected state
        selectButton.classList.add('ring-2', 'ring-blue-500', 'border-blue-500');
        selectButton.classList.remove('border-gray-300');
    } else {
        selectedText.textContent = 'Select a group';
        currentGroupId = null;
        // Remove selection styling
        selectButton.classList.remove('ring-2', 'ring-blue-500', 'border-blue-500');
        selectButton.classList.add('border-gray-300');
    }

    // Close dropdown
    dropdown.classList.add('hidden');

    // Load markers for selected group
    loadGroupMarkers();

    // Update see all button state
    const seeAllBtn = document.getElementById('see-all-markers-btn');
    seeAllBtn.disabled = !currentGroupId || markers.length === 0;
}

// Initialize Map
function initMap() {
    bounds = new google.maps.LatLngBounds();
    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: 34.0522, lng: -118.2437 }, // Default to Los Angeles
        zoom: 12,
        mapTypeId: google.maps.MapTypeId.ROADMAP,
        mapTypeControl: true,
        mapTypeControlOptions: {
            style: google.maps.MapTypeControlStyle.DEFAULT,
            position: google.maps.ControlPosition.TOP_RIGHT,
            mapTypeIds: [
                google.maps.MapTypeId.ROADMAP,
                google.maps.MapTypeId.SATELLITE
            ]
        },
        zoomControl: true,
        streetViewControl: true,
        fullscreenControl: true,
        scrollwheel: true,
        gestureHandling: 'greedy' // Allow smooth scroll wheel zoom without requiring Ctrl
    });

    // Info window for markers
    infoWindow = new google.maps.InfoWindow({
        content: document.createElement('div'),
        maxWidth: 200
    });

    // Initialize autocomplete for search input
    const searchInput = document.getElementById('location-search');
    autocomplete = new google.maps.places.Autocomplete(searchInput, {
        types: ['geocode'],
        componentRestrictions: { country: 'us' } // Remove this line to allow worldwide search
    });

    // Listen for place selection
    autocomplete.addListener('place_changed', function() {
        const place = autocomplete.getPlace();
        if (place.geometry) {
            addLocationFromPlace(place);
        }
    });

    // Load existing groups
    fetchLocationGroups();

    // Custom group dropdown toggle
    const customGroupSelect = document.getElementById('custom-group-select');
    if (customGroupSelect) {
        customGroupSelect.addEventListener('click', function() {
            const dropdown = document.getElementById('group-dropdown-menu');
            if (dropdown) {
                dropdown.classList.toggle('hidden');
            }
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', function(e) {
        const dropdown = document.getElementById('group-dropdown-menu');
        const customSelect = document.getElementById('custom-group-select');

        if (!customSelect.contains(e.target) && !dropdown.contains(e.target)) {
            dropdown.classList.add('hidden');
        }
    });

    // New group button event
    const newGroupBtn = document.getElementById('new-group-btn');
    if (newGroupBtn) {
        newGroupBtn.addEventListener('click', function() {
            const input = document.getElementById('new-group-input');
            if (input) {
                input.classList.toggle('hidden');
                input.focus();
            }
        });
    }

    // New group input event
    const newGroupInput = document.getElementById('new-group-input');
    if (newGroupInput) {
        newGroupInput.addEventListener('keypress', async function(e) {
        if (e.key === 'Enter') {
            const name = this.value.trim();
            if (name) {
                try {
                    const group = await createLocationGroup(name);
                    if (group) {
                        // Select the newly created group
                        selectGroup(group.id);
                        this.value = '';
                        this.classList.add('hidden');
                        // Show success feedback
                        showPopup('success', `Group "${group.name}" created successfully!`, 'Group Created');
                    }
                } catch (error) {
                    console.error('Failed to create group:', error);
                    showPopup('error', `Failed to create group: ${error.message}`, 'Group Creation Failed');
                }
            }
        }
        });
    }

    // Add marker button events
    const addMarkerBtn = document.getElementById('add-marker-btn-sidebar');
    if (addMarkerBtn) {
        addMarkerBtn.addEventListener('click', addMarkerFromSearch);
    }

    // Bulk upload button events
    const bulkUploadBtn = document.getElementById('bulk-upload-btn');
    if (bulkUploadBtn) {
        bulkUploadBtn.addEventListener('click', openBulkUploadModal);
    }


    // See all markers button event
    const seeAllMarkersBtn = document.getElementById('see-all-markers-btn');
    if (seeAllMarkersBtn) {
        seeAllMarkersBtn.addEventListener('click', fitMapToMarkers);
    }

    // Fine zoom controls
    const fineZoomInBtn = document.getElementById('fine-zoom-in-btn');
    const fineZoomOutBtn = document.getElementById('fine-zoom-out-btn');
    const zoomLevelDisplay = document.getElementById('zoom-level-display');

    if (fineZoomInBtn && fineZoomOutBtn && zoomLevelDisplay) {
        fineZoomInBtn.addEventListener('click', function() {
            const currentZoom = map.getZoom();
            const newZoom = Math.min(20, currentZoom + 0.25);
            map.setZoom(newZoom);
            updateZoomDisplay(newZoom);
        });

        fineZoomOutBtn.addEventListener('click', function() {
            const currentZoom = map.getZoom();
            const newZoom = Math.max(1, currentZoom - 0.25);
            map.setZoom(newZoom);
            updateZoomDisplay(newZoom);
        });

        // Update zoom display when map zoom changes
        map.addListener('zoom_changed', function() {
            updateZoomDisplay(map.getZoom());
        });

        // Function to update zoom level display
        function updateZoomDisplay(zoomLevel) {
            zoomLevelDisplay.textContent = zoomLevel.toFixed(1);
        }

        // Initialize zoom display
        updateZoomDisplay(map.getZoom());
    }

    // Add enter key support for search input
    const locationSearch = document.getElementById('location-search');
    if (locationSearch) {
        locationSearch.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                addMarkerFromSearch();
            }
        });
    }

    // Add color picker event listeners
    const colorButtons = document.querySelectorAll('#options-dropdown-content button[class*="bg-"]');
    colorButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Remove active state from all color buttons
            colorButtons.forEach(btn => btn.classList.remove('ring-2', 'ring-offset-2'));

            // Add active state to clicked button
            this.classList.add('ring-2', 'ring-offset-2');

            // If a marker is selected, update its color
            if (selectedMarker) {
                const newColor = window.getComputedStyle(this).backgroundColor;
                updateSelectedMarkerColor(newColor);
            }
        });
    });

    // Map click event to clear selection only
    map.addListener('click', function(event) {
        // Clear any selected marker when clicking on empty map
        clearMarkerSelection();
    });

    // Add zoom change listener with debouncing for performance
    const debouncedUpdateMarkers = debounce(updateAllMarkerIcons, 100);
    map.addListener('zoom_changed', debouncedUpdateMarkers);

    // Add bounds change listener to handle fitBounds operations
    const debouncedBoundsUpdate = debounce(updateAllMarkerIcons, 150);
    map.addListener('bounds_changed', debouncedBoundsUpdate);

    // Show all markers button
    const showAllMarkersBtn = document.getElementById('show-all-markers');
    if (showAllMarkersBtn) {
        showAllMarkersBtn.addEventListener('click', function() {
        if (markers.length > 0) {
            const bounds = new google.maps.LatLngBounds();
            markers.forEach(marker => {
                bounds.extend(marker.getPosition());
            });
            map.fitBounds(bounds);

            // Add some padding
            if (markers.length === 1) {
                map.setZoom(15);
            }
        }
        });
    }
}

function createMarker(position, title, color, locationId) {
    const markerNumber = markers.length + 1;
    // Use default zoom for initial creation - event listeners will update sizing
    const marker = new google.maps.Marker({
        position: position,
        map: map,
        title: title,
        locationId: locationId,
        markerNumber: markerNumber,
        icon: createNumberedMarkerIcon(markerNumber, color, false, 12)
    });

    // Store original color for reference
    marker.originalColor = color;

    markers.push(marker);
    bounds.extend(position);

    marker.addListener('click', () => {
        selectMarker(marker);
        const content = document.createElement('div');
        content.className = 'marker-popup';

        // Create title element safely
        const titleElement = document.createElement('h3');
        titleElement.className = 'font-medium text-gray-900';
        titleElement.textContent = marker.getTitle(); // Safe from XSS

        // Create coordinate elements
        const latElement = document.createElement('p');
        latElement.className = 'text-sm text-gray-500 mt-1';
        latElement.textContent = `Lat: ${marker.getPosition().lat().toFixed(4)}`;

        const lngElement = document.createElement('p');
        lngElement.className = 'text-sm text-gray-500';
        lngElement.textContent = `Lng: ${marker.getPosition().lng().toFixed(4)}`;

        // Create color picker section
        const colorSection = document.createElement('div');
        colorSection.className = 'mt-2 mb-2';

        const colorLabel = document.createElement('div');
        colorLabel.className = 'text-xs font-medium text-gray-700 mb-1';
        colorLabel.textContent = 'Change Color:';

        const colorPicker = document.createElement('div');
        colorPicker.className = 'flex space-x-1';

        // Define available colors
        const colors = [
            { name: 'Red', value: '#ef4444', class: 'bg-red-500' },
            { name: 'Blue', value: '#3b82f6', class: 'bg-blue-500' },
            { name: 'Green', value: '#10b981', class: 'bg-green-500' },
            { name: 'Yellow', value: '#f59e0b', class: 'bg-yellow-500' },
            { name: 'Purple', value: '#8b5cf6', class: 'bg-purple-500' },
            { name: 'Pink', value: '#ec4899', class: 'bg-pink-500' },
            { name: 'Orange', value: '#f97316', class: 'bg-orange-500' },
            { name: 'Gray', value: '#6b7280', class: 'bg-gray-500' }
        ];

        colors.forEach(color => {
            const colorButton = document.createElement('button');
            colorButton.className = `w-5 h-5 rounded-full ${color.class} border-2 border-gray-300 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-500`;
            colorButton.title = `Change to ${color.name}`;

            // Highlight current color
            if (marker.originalColor === color.value) {
                colorButton.classList.add('ring-2', 'ring-offset-1', 'ring-gray-500');
            }

            colorButton.addEventListener('click', async () => {
                try {
                    // Update marker color via API
                    await apiService.updateLocation(currentGroupId, marker.locationId, {
                        color: color.value
                    });

                    // Update marker locally
                    marker.originalColor = color.value;

                    // Update marker icon
                    const markerIndex = markers.findIndex(m => m === marker);
                    const number = markerIndex + 1;
                    const isSelected = selectedMarker === marker;
                    marker.setIcon(createNumberedMarkerIcon(number, color.value, isSelected, map.getZoom()));

                    // Update marker list
                    updateMarkerList();

                    // Close popup
                    infoWindow.close();

                    // Show success notification
                    showPopup('success', `Marker color changed to ${color.name}`, 'Color Updated');

                } catch (error) {
                    console.error('Error updating marker color:', error);
                    showPopup('error', 'Failed to update marker color. Please try again.', 'Update Failed');
                }
            });

            colorPicker.appendChild(colorButton);
        });

        colorSection.appendChild(colorLabel);
        colorSection.appendChild(colorPicker);

        // Create button container
        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'mt-2 flex space-x-2';

        // Create delete button safely
        const deleteButton = document.createElement('button');
        deleteButton.className = 'text-xs px-2 py-1 bg-red-100 text-red-800 rounded hover:bg-red-200';
        deleteButton.textContent = 'Delete';
        deleteButton.addEventListener('click', () => deleteMarker(marker.locationId));

        buttonContainer.appendChild(deleteButton);

        // Assemble content safely
        content.appendChild(titleElement);
        content.appendChild(latElement);
        content.appendChild(lngElement);
        content.appendChild(colorSection);
        content.appendChild(buttonContainer);
        infoWindow.setContent(content);
        infoWindow.open(map, marker);
    });

    return marker;
}

function clearMarkers() {
    markers.forEach(marker => marker.setMap(null));
    markers = [];
}

async function loadGroupMarkers() {
    clearMarkers();
    updateMarkerList();

    if (!currentGroupId) return;

    try {
        const response = await fetch(`/api/location-groups/${currentGroupId}`);
        const group = await response.json();

        group.locations.forEach(location => {
            createMarker(
                { lat: location.lat, lng: location.lng },
                location.title,
                location.color,
                location.id
            );
        });

        updateMarkerList();

        if (markers.length > 0) {
            const bounds = new google.maps.LatLngBounds();
            markers.forEach(marker => {
                bounds.extend(marker.getPosition());
            });
            map.fitBounds(bounds);

            if (markers.length === 1) {
                map.setZoom(15);
            }
        }
    } catch (error) {
        console.error('Error loading group markers:', error);
    }
}

function updateMarkerList() {
    const container = document.getElementById('markers-container');
    container.innerHTML = '';

    markers.forEach((marker, index) => {
        const markerNumber = index + 1;
        const item = document.createElement('div');
        item.className = 'marker-list-item';
        item.dataset.locationId = marker.locationId;
        item.dataset.markerIndex = index;
        item.draggable = true;

        // Create numbered color indicator
        const colorIndicator = document.createElement('div');
        colorIndicator.className = 'marker-numbered-color-indicator';
        colorIndicator.style.backgroundColor = marker.originalColor;
        colorIndicator.textContent = markerNumber;

        // Create title span safely
        const titleSpan = document.createElement('span');
        titleSpan.className = 'text-sm text-gray-700 flex-1';
        titleSpan.textContent = marker.getTitle(); // Safe from XSS

        // Create delete button safely
        const deleteButton = document.createElement('button');
        deleteButton.className = 'text-gray-400 hover:text-gray-600';
        deleteButton.addEventListener('click', () => deleteMarker(marker.locationId));

        const deleteIcon = document.createElement('i');
        deleteIcon.setAttribute('data-feather', 'x');
        deleteIcon.className = 'h-4 w-4';
        deleteButton.appendChild(deleteIcon);

        // Assemble item safely
        item.appendChild(colorIndicator);
        item.appendChild(titleSpan);
        item.appendChild(deleteButton);

        // Add drag and drop event listeners
        item.addEventListener('dragstart', handleDragStart);
        item.addEventListener('dragover', handleDragOver);
        item.addEventListener('dragenter', handleDragEnter);
        item.addEventListener('dragleave', handleDragLeave);
        item.addEventListener('drop', handleDrop);
        item.addEventListener('dragend', handleDragEnd);

        item.addEventListener('click', function(e) {
            if (!e.target.closest('button')) {
                selectMarker(marker);
                map.setCenter(marker.getPosition());
                map.setZoom(15);

                document.querySelectorAll('.marker-list-item').forEach(i =>
                    i.classList.remove('active'));
                this.classList.add('active');
            }
        });

        container.appendChild(item);
    });

    // Update see all button state
    const seeAllBtn = document.getElementById('see-all-markers-btn');
    seeAllBtn.disabled = !currentGroupId || markers.length === 0;

    // Update temp button display
    updateTempButtonDisplay();

    feather.replace();
}

async function deleteMarker(locationId) {
    if (!currentGroupId) return;

    try {
        await deleteLocationFromGroup(currentGroupId, locationId);

        const markerIndex = markers.findIndex(m => m.locationId === locationId);
        if (markerIndex !== -1) {
            markers[markerIndex].setMap(null);
            markers.splice(markerIndex, 1);
        }

        updateMarkerList();
        infoWindow.close();
    } catch (error) {
        console.error('Error deleting marker:', error);
    }
}

function getSelectedMarkerColor() {
    const colorButtons = document.querySelectorAll('#options-dropdown-content button[class*="bg-"]');
    for (let button of colorButtons) {
        if (button.classList.contains('ring-2')) {
            const computedStyle = window.getComputedStyle(button);
            const bgColor = computedStyle.backgroundColor;
            // Convert RGB to hex
            const rgb = bgColor.match(/\d+/g);
            if (rgb) {
                const hex = '#' + rgb.map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
                return hex;
            }
        }
    }
    return '#3B82F6'; // Default blue
}

// Add location from Google Places Autocomplete
async function addLocationFromPlace(place) {
    // Show loading feedback
    const searchInput = document.getElementById('location-search');
    const addButton = document.getElementById('add-marker-btn-sidebar');
    const originalButtonText = addButton.innerHTML;
    addButton.innerHTML = '<i data-feather="loader" class="mr-2 animate-spin"></i> Adding...';
    addButton.disabled = true;

    try {
        if (!currentGroupId) {
            // Check if we can create a temp group instead
            if (!tempGroupId) {
                tempGroupId = await createTempGroup();
            }
            if (!tempGroupId) {
                showPopup('warning', 'Unable to create temporary group. Please select a group first.', 'Group Required');
                return;
            }
            currentGroupId = tempGroupId;
        }

        const location = place.geometry.location;
        const locationData = {
            lat: location.lat(),
            lng: location.lng(),
            title: place.formatted_address || place.name,
            color: getSelectedMarkerColor()
        };

        console.log('Adding location:', locationData, 'to group:', currentGroupId);

        if (!currentGroupId || typeof currentGroupId !== 'string') {
            showPopup('error', 'No group selected. Please select or create a group first.', 'Group Required');
            return;
        }

        const newLocation = await addLocationToGroup(currentGroupId, locationData);
        if (newLocation) {
            createMarker(
                { lat: newLocation.lat, lng: newLocation.lng },
                newLocation.title,
                newLocation.color,
                newLocation.id
            );
            updateMarkerList();
            map.setCenter({ lat: newLocation.lat, lng: newLocation.lng });
            map.setZoom(15);

            // Refresh location groups to update location counts
            await fetchLocationGroups();

            // Clear the search input
            searchInput.value = '';

            // Show success feedback
            showPopup('success', `Added "${newLocation.title}" to map`, 'Location Added');
        } else {
            showPopup('error', 'Failed to add location. Please try again.', 'Add Failed');
        }
    } catch (error) {
        console.error('Error adding location:', error);
        showPopup('error', 'Failed to add location. Please try again.', 'Add Failed');
    } finally {
        // Restore button state
        addButton.innerHTML = originalButtonText;
        addButton.disabled = false;
        feather.replace(); // Re-render icons
    }
}

// Fallback function for manual search (if user types and presses enter)
async function addMarkerFromSearch() {
    const searchInput = document.getElementById('location-search');
    const addButton = document.getElementById('add-marker-btn-sidebar');
    const query = searchInput.value.trim();

    if (!query) {
        showPopup('warning', 'Please enter a location to search for!', 'Location Required');
        searchInput.focus();
        return;
    }

    // Show loading state
    const originalButtonText = addButton.innerHTML;
    addButton.innerHTML = '<i data-feather="loader" class="mr-2 animate-spin"></i> Searching...';
    addButton.disabled = true;

    try {
        if (!currentGroupId) {
            // Check if we can create a temp group instead
            if (!tempGroupId) {
                tempGroupId = await createTempGroup();
            }
            if (!tempGroupId) {
                showPopup('warning', 'Unable to create temporary group. Please select a group first.', 'Group Required');
                return;
            }
            currentGroupId = tempGroupId;
        }

        // Use Google Geocoding to get coordinates
        const geocoder = new google.maps.Geocoder();
        geocoder.geocode({ address: query }, async (results, status) => {
            try {
                if (status === 'OK' && results[0]) {
                    const location = results[0].geometry.location;
                    const locationData = {
                        lat: location.lat(),
                        lng: location.lng(),
                        title: results[0].formatted_address,
                        color: getSelectedMarkerColor()
                    };

                    console.log('Adding location from search:', locationData, 'to group:', currentGroupId);

                    const newLocation = await addLocationToGroup(currentGroupId, locationData);
                    if (newLocation) {
                        createMarker(
                            { lat: newLocation.lat, lng: newLocation.lng },
                            newLocation.title,
                            newLocation.color,
                            newLocation.id
                        );
                        updateMarkerList();
                        map.setCenter({ lat: newLocation.lat, lng: newLocation.lng });
                        map.setZoom(15);

                        // Refresh location groups to update location counts
                        await fetchLocationGroups();

                        searchInput.value = '';

                        // Show success feedback
                        showPopup('success', `Added "${newLocation.title}" to map`, 'Location Added');
                    } else {
                        showPopup('error', 'Failed to add location. Please try again.', 'Add Failed');
                    }
                } else {
                    showPopup('error', 'Location not found. Please try a different search term.', 'Search Failed');
                }
            } catch (error) {
                console.error('Error adding location from search:', error);
                showPopup('error', 'Failed to add location. Please try again.', 'Add Failed');
            } finally {
                // Restore button state
                addButton.innerHTML = originalButtonText;
                addButton.disabled = false;
                feather.replace(); // Re-render icons
            }
        });
    } catch (error) {
        console.error('Error in addMarkerFromSearch:', error);
        showPopup('error', 'Search failed. Please try again.', 'Search Error');
        // Restore button state
        addButton.innerHTML = originalButtonText;
        addButton.disabled = false;
        feather.replace();
    }
}

// Toggle sidebar with responsive behavior
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('sidebar-toggle').addEventListener('click', function() {
        const sidebar = document.getElementById('sidebar');
        const mapContainer = document.getElementById('map-container');

        // Check if we're on mobile
        const isMobile = window.innerWidth <= 768;

        if (isMobile) {
            // On mobile, just toggle the sidebar visibility
            sidebar.classList.toggle('sidebar-closed');
            sidebar.classList.toggle('sidebar-open');
        } else {
            // On desktop, toggle sidebar and adjust map container
            sidebar.classList.toggle('sidebar-closed');
            sidebar.classList.toggle('sidebar-open');

            if (sidebar.classList.contains('sidebar-closed')) {
                mapContainer.classList.remove('mr-64');
                mapContainer.classList.add('mr-0');
            } else {
                mapContainer.classList.remove('mr-0');
                mapContainer.classList.add('mr-64');
            }
        }

        // Trigger map resize after sidebar toggle
        setTimeout(() => {
            if (window.google && window.google.maps && map) {
                google.maps.event.trigger(map, 'resize');
            }
        }, 300);
    });

    // Handle window resize for responsive behavior
    window.addEventListener('resize', function() {
        const sidebar = document.getElementById('sidebar');
        const mapContainer = document.getElementById('map-container');
        const isMobile = window.innerWidth <= 768;

        if (isMobile) {
            mapContainer.classList.remove('mr-64');
            mapContainer.classList.add('mr-0');
        } else {
            if (sidebar.classList.contains('sidebar-open')) {
                mapContainer.classList.remove('mr-0');
                mapContainer.classList.add('mr-64');
            }
        }

        // Trigger map resize
        if (window.google && window.google.maps && map) {
            google.maps.event.trigger(map, 'resize');
        }
    });

    // Load configuration when page loads
    loadConfig();
});

// Marker selection functions
function selectMarker(marker) {
    selectedMarker = marker;

    // Update visual feedback in marker list
    document.querySelectorAll('.marker-list-item').forEach(item => {
        item.classList.remove('selected');
        if (item.dataset.locationId === marker.locationId) {
            item.classList.add('selected');
        }
    });

    // Add visual feedback on map (selected state for numbered markers)
    updateAllMarkerIcons();
}

// Function to update all marker icons with current state
function updateAllMarkerIcons() {
    const currentZoom = map ? map.getZoom() : 12;
    markers.forEach((marker, index) => {
        const markerNumber = index + 1;
        const isSelected = marker === selectedMarker;
        marker.markerNumber = markerNumber;
        marker.setIcon(createNumberedMarkerIcon(markerNumber, marker.originalColor, isSelected, currentZoom));
    });
}

function clearMarkerSelection() {
    selectedMarker = null;

    // Remove visual feedback from marker list
    document.querySelectorAll('.marker-list-item').forEach(item => {
        item.classList.remove('selected', 'active');
    });

    // Reset all markers to normal state
    updateAllMarkerIcons();
}

// Update marker color
async function updateSelectedMarkerColor(newColor) {
    if (!selectedMarker || !currentGroupId) return;

    try {
        // Update marker color on server
        const response = await fetch(`/api/location-groups/${currentGroupId}/locations/${selectedMarker.locationId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ color: newColor })
        });

        if (response.ok) {
            // Update the marker's original color
            selectedMarker.originalColor = newColor;

            // Update all marker icons with new color
            updateAllMarkerIcons();

            // Update marker list display
            updateMarkerList();
        }
    } catch (error) {
        console.error('Error updating marker color:', error);
    }
}

// Drag and drop variables
let draggedElement = null;
let draggedIndex = null;

// Drag and drop event handlers
function handleDragStart(e) {
    draggedElement = this;
    draggedIndex = parseInt(this.dataset.markerIndex);
    this.classList.add('dragging');

    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.outerHTML);
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleDragEnter(e) {
    if (this !== draggedElement) {
        this.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    this.classList.remove('drag-over');
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    if (draggedElement !== this) {
        const targetIndex = parseInt(this.dataset.markerIndex);
        reorderMarkers(draggedIndex, targetIndex);
    }

    return false;
}

function handleDragEnd(e) {
    // Clean up drag states
    document.querySelectorAll('.marker-list-item').forEach(item => {
        item.classList.remove('dragging', 'drag-over');
    });

    draggedElement = null;
    draggedIndex = null;
}

// Function to reorder markers array and update UI
async function reorderMarkers(fromIndex, toIndex) {
    // Move item in markers array
    const movedMarker = markers.splice(fromIndex, 1)[0];
    markers.splice(toIndex, 0, movedMarker);

    // Update the list display (marker icons will update via event listener)
    updateMarkerList();

    // Send reorder request to backend
    if (currentGroupId) {
        try {
            const locationIds = markers.map(marker => marker.locationId);
            await fetch(`/api/location-groups/${currentGroupId}/locations/reorder`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ locationIds })
            });
        } catch (error) {
            console.error('Error reordering markers on server:', error);
        }
    }
}

// ================================
// BULK UPLOAD FUNCTIONALITY
// ================================

let bulkProcessingCancelled = false;
let bulkColorIndex = 0;

// Color array for alternating colors in bulk upload
const bulkColors = [
    '#ef4444', // red
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // yellow
    '#8b5cf6', // purple
    '#ec4899', // pink
    '#6366f1', // indigo
    '#f97316', // orange
    '#14b8a6', // teal
    '#6b7280'  // gray
];

// Open bulk upload modal
function openBulkUploadModal() {
    const modal = document.getElementById('bulk-upload-modal');
    const textarea = document.getElementById('bulk-addresses-input');
    const addressCount = document.getElementById('address-count');
    const groupNameInput = document.getElementById('bulk-group-name');

    // Reset modal state
    textarea.value = '';
    groupNameInput.value = '';
    addressCount.textContent = '0';
    bulkProcessingCancelled = false;

    modal.classList.remove('hidden');
    modal.classList.add('modal-overlay');
    groupNameInput.focus();
}

// Close bulk upload modal
function closeBulkUploadModal() {
    document.getElementById('bulk-upload-modal').classList.add('hidden');
}

// Parse and validate address input
function parseAddresses(input) {
    if (!input.trim()) return [];

    // Basic input sanitization
    input = input.trim();

    // Limit input length to prevent abuse
    if (input.length > 10000) {
        input = input.substring(0, 10000);
    }

    // Split by newlines first, then by commas as fallback
    let addresses = input.split('\n').map(addr => addr.trim()).filter(addr => addr);

    // If only one line but contains commas, split by commas
    if (addresses.length === 1 && addresses[0].includes(',')) {
        addresses = addresses[0].split(',').map(addr => addr.trim()).filter(addr => addr);
    }

    // Sanitize each address
    addresses = addresses.map(addr => {
        // Remove potentially dangerous characters
        addr = addr.replace(/[<>]/g, '');
        // Limit individual address length
        if (addr.length > 200) {
            addr = addr.substring(0, 200);
        }
        return addr.trim();
    }).filter(addr => addr.length > 0);

    // Remove duplicates and limit to 50
    addresses = [...new Set(addresses)].slice(0, 50);

    return addresses;
}

// Update address count as user types
function updateAddressCount() {
    const input = document.getElementById('bulk-addresses-input').value;
    const addresses = parseAddresses(input);
    document.getElementById('address-count').textContent = addresses.length;

    const startButton = document.getElementById('start-bulk-upload');
    startButton.disabled = addresses.length === 0;

    if (addresses.length > 50) {
        document.getElementById('address-count').textContent = '50 (max)';
        document.getElementById('address-count').classList.add('text-red-600');
    } else {
        document.getElementById('address-count').classList.remove('text-red-600');
    }
}

// Start bulk upload process
async function startBulkUpload() {
    const input = document.getElementById('bulk-addresses-input').value;
    const addresses = parseAddresses(input);
    const bulkGroupName = document.getElementById('bulk-group-name').value.trim();

    if (addresses.length === 0) {
        showPopup('warning', 'Please enter at least one address.', 'Input Required');
        return;
    }

    // Handle group selection/creation
    let targetGroupId = currentGroupId;

    if (bulkGroupName) {
        // Create new group with provided name
        try {
            const newGroup = await createLocationGroup(bulkGroupName);
            if (newGroup) {
                targetGroupId = newGroup.id;
                currentGroupId = newGroup.id;
                selectGroup(newGroup.id);
            } else {
                showPopup('error', 'Failed to create new group. Please try again.', 'Group Creation Failed');
                return;
            }
        } catch (error) {
            console.error('Failed to create group:', error);
            showPopup('error', `Failed to create group: ${error.message}`, 'Group Creation Failed');
            return;
        }
    } else if (!currentGroupId) {
        // No group selected and no name provided
        if (locationGroups.length === 0) {
            const defaultGroup = await createLocationGroup('My Locations');
            if (defaultGroup) {
                targetGroupId = defaultGroup.id;
                currentGroupId = defaultGroup.id;
                selectGroup(defaultGroup.id);
            } else {
                showPopup('warning', 'Please create a location group first.', 'Group Required');
                return;
            }
        } else {
            showPopup('warning', 'Please select a location group or enter a new group name.', 'Group Required');
            return;
        }
    }

    // Update currentGroupId for the bulk upload process
    currentGroupId = targetGroupId;

    // Show confirmation for large batches
    if (addresses.length > 10) {
        if (!confirm(`You're about to process ${addresses.length} addresses. This may take a few minutes. Continue?`)) {
            return;
        }
    }

    // Close input modal and show progress modal
    closeBulkUploadModal();
    showProgressModal(addresses.length);

    // Start processing
    await processBulkAddresses(addresses);
}

// Show progress modal
function showProgressModal(totalCount) {
    const modal = document.getElementById('bulk-progress-modal');
    document.getElementById('progress-count').textContent = `0 of ${totalCount}`;
    document.getElementById('progress-percentage').textContent = '0%';
    document.getElementById('progress-bar').style.width = '0%';
    document.getElementById('progress-status').textContent = 'Starting bulk upload...';
    document.getElementById('current-address').textContent = 'Preparing...';

    modal.classList.remove('hidden');
    modal.classList.add('modal-overlay');
}

// Update progress display
function updateProgress(current, total, currentAddress, status = '') {
    const percentage = Math.round((current / total) * 100);

    document.getElementById('progress-count').textContent = `${current} of ${total}`;
    document.getElementById('progress-percentage').textContent = `${percentage}%`;
    document.getElementById('progress-bar').style.width = `${percentage}%`;
    document.getElementById('current-address').textContent = currentAddress || '';

    if (status) {
        document.getElementById('progress-status').textContent = status;
    }
}

// Process bulk addresses
async function processBulkAddresses(addresses) {
    const results = {
        successful: [],
        failed: []
    };

    // Reset color index for bulk upload
    bulkColorIndex = 0;

    for (let i = 0; i < addresses.length; i++) {
        if (bulkProcessingCancelled) {
            break;
        }

        const address = addresses[i];
        updateProgress(i, addresses.length, address, `Processing address ${i + 1} of ${addresses.length}...`);

        try {
            // Use Google Geocoder to find the address
            const result = await geocodeAddress(address);

            if (result.success) {
                // Get next color in rotation
                const color = bulkColors[bulkColorIndex % bulkColors.length];
                bulkColorIndex++;

                const locationData = {
                    lat: result.location.lat,
                    lng: result.location.lng,
                    title: result.formattedAddress,
                    color: color
                };

                // Add to database
                const newLocation = await addLocationToGroup(currentGroupId, locationData);

                if (newLocation) {
                    // Create marker on map
                    createMarker(
                        { lat: newLocation.lat, lng: newLocation.lng },
                        newLocation.title,
                        newLocation.color,
                        newLocation.id
                    );

                    results.successful.push({
                        address: address,
                        result: newLocation
                    });
                } else {
                    results.failed.push({
                        address: address,
                        reason: 'Failed to save to database'
                    });
                }
            } else {
                results.failed.push({
                    address: address,
                    reason: result.error || 'Address not found'
                });
            }
        } catch (error) {
            results.failed.push({
                address: address,
                reason: error.message || 'Unexpected error'
            });
        }

        // Add delay to respect API rate limits
        if (i < addresses.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    // Update progress to complete
    if (!bulkProcessingCancelled) {
        updateProgress(addresses.length, addresses.length, 'Completed!', 'Upload complete');
    }

    // Update marker list and map view
    updateMarkerList();
    if (results.successful.length > 0) {
        fitMapToMarkers();
    }

    // Refresh location groups to update location counts
    await fetchLocationGroups();

    // Show results after a brief delay
    setTimeout(() => {
        closeProgressModal();
        showResultsModal(results);
    }, 1000);
}

// Geocode a single address
function geocodeAddress(address) {
    return new Promise((resolve) => {
        const geocoder = new google.maps.Geocoder();

        geocoder.geocode({ address: address }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const location = results[0].geometry.location;
                resolve({
                    success: true,
                    location: {
                        lat: location.lat(),
                        lng: location.lng()
                    },
                    formattedAddress: results[0].formatted_address
                });
            } else {
                let error = 'Address not found';
                if (status === 'OVER_QUERY_LIMIT') {
                    error = 'Rate limit exceeded';
                } else if (status === 'REQUEST_DENIED') {
                    error = 'Request denied';
                } else if (status === 'ZERO_RESULTS') {
                    error = 'No results found';
                }

                resolve({
                    success: false,
                    error: error
                });
            }
        });
    });
}

// Close progress modal
function closeProgressModal() {
    document.getElementById('bulk-progress-modal').classList.add('hidden');
}

// Show results modal
function showResultsModal(results) {
    const modal = document.getElementById('bulk-results-modal');

    // Update success/failure counts
    document.getElementById('success-count').textContent = results.successful.length;
    document.getElementById('failed-count').textContent = results.failed.length;

    // Show failed addresses if any
    const failedSection = document.getElementById('failed-addresses-section');
    if (results.failed.length > 0) {
        failedSection.classList.remove('hidden');

        const failedList = document.getElementById('failed-addresses-list');

        // Clear previous content
        failedList.innerHTML = '';

        // Create failed items safely
        results.failed.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'mb-1';

            const addressStrong = document.createElement('strong');
            addressStrong.textContent = item.address; // Safe from XSS

            const lineBreak = document.createElement('br');

            const reasonSpan = document.createElement('span');
            reasonSpan.className = 'text-red-600 text-xs';
            reasonSpan.textContent = item.reason; // Safe from XSS

            itemDiv.appendChild(addressStrong);
            itemDiv.appendChild(lineBreak);
            itemDiv.appendChild(reasonSpan);
            failedList.appendChild(itemDiv);
        });
    } else {
        failedSection.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    modal.classList.add('modal-overlay');
}

// Close results modal
function closeResultsModal() {
    document.getElementById('bulk-results-modal').classList.add('hidden');
}

// Copy failed addresses to clipboard
function copyFailedAddresses() {
    const failedList = document.getElementById('failed-addresses-list');
    const failedAddresses = Array.from(failedList.querySelectorAll('div')).map(div => {
        const strong = div.querySelector('strong');
        return strong ? strong.textContent : '';
    }).filter(addr => addr).join('\n');

    navigator.clipboard.writeText(failedAddresses).then(() => {
        showPopup('success', 'Failed addresses copied to clipboard!', 'Copied');
    }).catch(() => {
        showPopup('error', 'Failed to copy to clipboard. Please copy manually.', 'Copy Failed');
    });
}

// Cancel bulk processing
function cancelBulkProcessing() {
    bulkProcessingCancelled = true;
    closeProgressModal();
}

// Fit map to show all markers with smart padding and zoom limits
function fitMapToMarkers() {
    if (markers.length === 0) return;

    const bounds = new google.maps.LatLngBounds();
    markers.forEach(marker => {
        bounds.extend(marker.getPosition());
    });

    // Add padding options for better visual experience
    const padding = {
        top: 50,
        right: 50,
        bottom: 50,
        left: 50
    };

    // Adjust padding based on number of markers
    if (markers.length === 1) {
        // More padding for single markers to show context
        padding.top = 100;
        padding.right = 100;
        padding.bottom = 100;
        padding.left = 100;
    } else if (markers.length <= 3) {
        // Medium padding for small groups
        padding.top = 80;
        padding.right = 80;
        padding.bottom = 80;
        padding.left = 80;
    }

    // Fit bounds with padding
    map.fitBounds(bounds, padding);

    // Set zoom limits after fitBounds
    setTimeout(() => {
        const currentZoom = map.getZoom();
        let targetZoom = currentZoom;

        if (markers.length === 1) {
            // For single markers, prefer street-level view but not too close
            targetZoom = Math.max(12, Math.min(currentZoom, 16));
        } else if (markers.length <= 5) {
            // Small groups: neighborhood level
            targetZoom = Math.max(10, Math.min(currentZoom, 15));
        } else {
            // Larger groups: city/regional level
            targetZoom = Math.max(8, Math.min(currentZoom, 14));
        }

        if (targetZoom !== currentZoom) {
            map.setZoom(targetZoom);
        }
    }, 100); // Small delay to let fitBounds complete
}

// Initialize unified dropdown and bulk upload event listeners
document.addEventListener('DOMContentLoaded', function() {
    // Unified options dropdown functionality
    const optionsDropdownBtn = document.getElementById('options-dropdown-btn');
    const optionsDropdownContent = document.getElementById('options-dropdown-content');

    if (optionsDropdownBtn && optionsDropdownContent) {
        const chevronIcon = optionsDropdownBtn.querySelector('[data-feather="chevron-down"]');

        // Toggle dropdown visibility
        optionsDropdownBtn.addEventListener('click', function() {
            if (optionsDropdownContent.classList.contains('hidden')) {
                // Show dropdown
                optionsDropdownContent.classList.remove('hidden');
                if (chevronIcon) chevronIcon.classList.add('rotate-180');
            } else {
                // Hide dropdown
                optionsDropdownContent.classList.add('hidden');
                if (chevronIcon) chevronIcon.classList.remove('rotate-180');
            }
            feather.replace();
        });
    }


    // Bulk upload modal events
    document.getElementById('bulk-addresses-input').addEventListener('input', updateAddressCount);
    document.getElementById('close-bulk-modal').addEventListener('click', closeBulkUploadModal);
    document.getElementById('cancel-bulk-upload').addEventListener('click', closeBulkUploadModal);
    document.getElementById('start-bulk-upload').addEventListener('click', startBulkUpload);

    // Progress modal events
    document.getElementById('cancel-processing').addEventListener('click', cancelBulkProcessing);

    // Results modal events
    document.getElementById('close-results-modal').addEventListener('click', closeResultsModal);
    document.getElementById('close-results').addEventListener('click', closeResultsModal);
    document.getElementById('copy-failed-addresses').addEventListener('click', copyFailedAddresses);

    // Close modals when clicking outside
    document.getElementById('bulk-upload-modal').addEventListener('click', function(e) {
        if (e.target === this) closeBulkUploadModal();
    });

    document.getElementById('bulk-results-modal').addEventListener('click', function(e) {
        if (e.target === this) closeResultsModal();
    });
});

// ================================
// POPUP NOTIFICATION SYSTEM
// ================================

function showPopup(type, message, title = null, duration = null) {
    const container = document.getElementById('popup-container');
    const popupId = `popup-${++popupCounter}`;

    // Default durations by type
    const defaultDurations = {
        success: 2000,
        info: 2000,
        warning: 2000, // Changed from manual dismiss to auto-dismiss
        error: 2000    // Changed from manual dismiss to auto-dismiss
    };

    const autoDismiss = duration !== null ? duration : defaultDurations[type];

    // Icon mapping
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };

    // Title mapping
    const defaultTitles = {
        success: 'Success',
        error: 'Error',
        warning: 'Warning',
        info: 'Information'
    };

    const popup = document.createElement('div');
    popup.id = popupId;
    popup.className = `popup-notification ${type}`;

    // Create icon container
    const iconDiv = document.createElement('div');
    iconDiv.className = 'popup-icon';
    iconDiv.textContent = icons[type] || 'ℹ';

    // Create content container
    const contentDiv = document.createElement('div');
    contentDiv.className = 'popup-content';

    // Create title safely
    const titleDiv = document.createElement('div');
    titleDiv.className = 'popup-title';
    titleDiv.textContent = title || defaultTitles[type]; // Safe from XSS

    // Create message safely
    const messageDiv = document.createElement('div');
    messageDiv.className = 'popup-message';
    messageDiv.textContent = message; // Safe from XSS

    contentDiv.appendChild(titleDiv);
    contentDiv.appendChild(messageDiv);

    // Create close button safely
    const closeButton = document.createElement('button');
    closeButton.className = 'popup-close';
    closeButton.textContent = '✕';
    closeButton.addEventListener('click', () => dismissPopup(popupId));

    // Assemble popup
    popup.appendChild(iconDiv);
    popup.appendChild(contentDiv);
    popup.appendChild(closeButton);

    // Add progress bar if auto-dismiss
    if (autoDismiss) {
        const progressDiv = document.createElement('div');
        progressDiv.className = 'popup-progress';

        const progressBar = document.createElement('div');
        progressBar.className = 'popup-progress-bar';
        progressBar.style.animation = `shrink ${autoDismiss}ms linear forwards`;

        progressDiv.appendChild(progressBar);
        popup.appendChild(progressDiv);
    }

    container.appendChild(popup);

    // Auto-dismiss if specified
    if (autoDismiss) {
        setTimeout(() => {
            dismissPopup(popupId);
        }, autoDismiss);
    }

    return popupId;
}

function dismissPopup(popupId) {
    const popup = document.getElementById(popupId);
    if (popup) {
        popup.classList.add('removing');
        setTimeout(() => {
            if (popup.parentNode) {
                popup.parentNode.removeChild(popup);
            }
        }, 300);
    }
}

// Add CSS animation for progress bar
const style = document.createElement('style');
style.textContent = `
    @keyframes shrink {
        from { width: 100%; }
        to { width: 0%; }
    }
`;
document.head.appendChild(style);

// ================================
// TEMPORARY GROUP SYSTEM
// ================================

async function createTempGroup() {
    const tempName = `__temp_${Date.now()}`;
    try {
        const response = await fetch('/api/location-groups', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: tempName, locations: [], isTemporary: true })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            console.error('Server error creating temp group:', errorData);
            throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const group = await response.json();
        tempGroupId = group.id;

        // Store in session for cleanup
        const tempGroups = JSON.parse(sessionStorage.getItem('tempGroups') || '[]');
        tempGroups.push(group.id);
        sessionStorage.setItem('tempGroups', JSON.stringify(tempGroups));

        return group.id;
    } catch (error) {
        console.error('Error creating temp group:', error);
        return null;
    }
}

function isTempGroup(groupId) {
    return groupId === tempGroupId;
}

function hasTempAddresses() {
    return tempGroupId && markers.some(marker => marker.groupId === tempGroupId);
}

function getTempAddressCount() {
    if (!tempGroupId) return 0;
    return markers.filter(marker => marker.groupId === tempGroupId).length;
}

async function cleanupTempGroups() {
    const tempGroups = JSON.parse(sessionStorage.getItem('tempGroups') || '[]');

    for (const groupId of tempGroups) {
        try {
            await fetch(`/api/location-groups/${groupId}`, {
                method: 'DELETE'
            });
        } catch (error) {
            console.error('Error cleaning up temp group:', error);
        }
    }

    sessionStorage.removeItem('tempGroups');
    tempGroupId = null;
}

// Clean up temp groups on page load
window.addEventListener('load', cleanupTempGroups);

// Warn before leaving page if temp addresses exist
window.addEventListener('beforeunload', function(e) {
    if (hasTempAddresses()) {
        e.preventDefault();
        e.returnValue = 'You have unsaved addresses. Are you sure you want to leave?';
        return e.returnValue;
    }
});

// Save Temporary Addresses Modal Functions
function showSaveTempModal() {
    if (!hasTempAddresses()) return;

    const modal = document.getElementById('save-temp-modal');
    const countSpan = document.getElementById('temp-address-count');
    const groupSelect = document.getElementById('save-temp-group-select');
    const groupNameInput = document.getElementById('save-temp-group-name');
    const saveButton = document.getElementById('save-temp-addresses');

    // Update count
    countSpan.textContent = getTempAddressCount();

    // Populate existing groups dropdown
    groupSelect.innerHTML = '<option value="">Choose existing group...</option>';
    locationGroups.forEach(group => {
        if (!group.isTemporary) {
            const option = document.createElement('option');
            option.value = group.id;
            option.textContent = group.name;
            groupSelect.appendChild(option);
        }
    });

    // Reset form
    groupNameInput.value = '';
    groupSelect.value = '';
    saveButton.disabled = true;

    modal.classList.remove('hidden');
    feather.replace();
}

function closeSaveTempModal() {
    document.getElementById('save-temp-modal').classList.add('hidden');
}

async function saveTempAddresses() {
    const groupName = document.getElementById('save-temp-group-name').value.trim();
    const selectedGroupId = document.getElementById('save-temp-group-select').value;

    let targetGroupId;

    if (groupName) {
        // Create new group
        try {
            const newGroup = await createLocationGroup(groupName);
            if (!newGroup) {
                showPopup('error', 'Failed to create new group. Please try again.', 'Save Failed');
                return;
            }
            targetGroupId = newGroup.id;
        } catch (error) {
            console.error('Failed to create group:', error);
            showPopup('error', `Failed to create group: ${error.message}`, 'Save Failed');
            return;
        }
    } else if (selectedGroupId) {
        // Use existing group
        targetGroupId = selectedGroupId;
    } else {
        showPopup('warning', 'Please enter a group name or select an existing group.', 'Input Required');
        return;
    }

    try {
        // Get all temp addresses
        const tempAddresses = markers.filter(marker => marker.groupId === tempGroupId);

        // Move addresses to target group
        for (const marker of tempAddresses) {
            await fetch(`/api/locations/${marker.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    groupId: targetGroupId
                })
            });

            // Update marker group reference
            marker.groupId = targetGroupId;
        }

        // Delete temporary group
        if (tempGroupId) {
            await fetch(`/api/location-groups/${tempGroupId}`, {
                method: 'DELETE'
            });
        }

        // Update UI
        tempGroupId = null;
        currentGroupId = targetGroupId;
        await loadLocationGroups();
        await updateMarkerList();
        selectGroup(targetGroupId);

        closeSaveTempModal();
        showPopup('success', `Successfully saved ${tempAddresses.length} addresses!`, 'Addresses Saved');

    } catch (error) {
        console.error('Error saving temp addresses:', error);
        showPopup('error', 'Failed to save addresses. Please try again.', 'Save Failed');
    }
}

async function discardTempAddresses() {
    if (!hasTempAddresses()) return;

    try {
        // Delete all temp markers
        const tempMarkers = markers.filter(marker => marker.groupId === tempGroupId);
        for (const marker of tempMarkers) {
            await deleteLocation(marker.id);
        }

        // Delete temporary group
        if (tempGroupId) {
            await fetch(`/api/location-groups/${tempGroupId}`, {
                method: 'DELETE'
            });
        }

        // Reset state
        tempGroupId = null;
        currentGroupId = null;

        await updateMarkerList();
        closeSaveTempModal();
        showPopup('info', 'Temporary addresses discarded.', 'Discarded');

    } catch (error) {
        console.error('Error discarding temp addresses:', error);
        showPopup('error', 'Failed to discard addresses. Please try again.', 'Discard Failed');
    }
}

// Function to update temp button visibility and count
function updateTempButtonDisplay() {
    const tempButton = document.getElementById('save-temp-btn');
    const tempCountBadge = document.getElementById('temp-count-badge');

    if (hasTempAddresses()) {
        const count = getTempAddressCount();
        tempCountBadge.textContent = count;
        tempButton.classList.remove('hidden');
    } else {
        tempButton.classList.add('hidden');
    }
}

// Event listeners for save temp modal
document.addEventListener('DOMContentLoaded', function() {
    // Modal controls
    document.getElementById('close-save-temp-modal').addEventListener('click', closeSaveTempModal);
    document.getElementById('save-temp-addresses').addEventListener('click', saveTempAddresses);
    document.getElementById('discard-temp-addresses').addEventListener('click', discardTempAddresses);

    // Save temp button
    document.getElementById('save-temp-btn').addEventListener('click', showSaveTempModal);

    // Form validation
    const groupNameInput = document.getElementById('save-temp-group-name');
    const groupSelect = document.getElementById('save-temp-group-select');
    const saveButton = document.getElementById('save-temp-addresses');

    function validateForm() {
        const hasGroupName = groupNameInput.value.trim().length > 0;
        const hasGroupSelected = groupSelect.value.length > 0;
        saveButton.disabled = !(hasGroupName || hasGroupSelected);
    }

    groupNameInput.addEventListener('input', function() {
        if (this.value.trim()) {
            groupSelect.value = '';
        }
        validateForm();
    });

    groupSelect.addEventListener('change', function() {
        if (this.value) {
            groupNameInput.value = '';
        }
        validateForm();
    });

    // Show modal when user tries to navigate away with temp addresses
    function checkForTempAddressesAndPrompt() {
        if (hasTempAddresses()) {
            showSaveTempModal();
        }
    }

    // Add save prompt to existing navigation events
    const originalSelectGroup = window.selectGroup;
    if (originalSelectGroup) {
        window.selectGroup = function(groupId) {
            if (hasTempAddresses() && groupId !== tempGroupId) {
                showSaveTempModal();
                return;
            }
            originalSelectGroup(groupId);
        };
    }
});

// ================================
// EXPORT FUNCTIONALITY
// ================================

async function openExportModal() {
    const modal = document.getElementById('export-modal');
    const groupsList = document.getElementById('export-groups-list');

    // Show loading state
    groupsList.innerHTML = '<div class="flex items-center justify-center p-4"><i data-feather="loader" class="animate-spin h-5 w-5 mr-2"></i> Loading groups...</div>';
    modal.classList.remove('hidden');
    feather.replace();

    // Fetch fresh group data to ensure accurate location counts
    await fetchLocationGroups();

    // Clear loading content
    groupsList.innerHTML = '';

    // Filter out temporary groups for export
    const exportableGroups = locationGroups.filter(group => !group.name.startsWith('__temp_'));

    if (exportableGroups.length === 0) {
        groupsList.innerHTML = '<p class="text-gray-500 text-sm">No groups available for export. Create some location groups first.</p>';
        document.getElementById('start-export').disabled = true;
        document.getElementById('select-all-groups').disabled = true;
    } else {
        // Create checkboxes for each group
        exportableGroups.forEach(group => {
            const checkboxDiv = document.createElement('div');
            checkboxDiv.className = 'flex items-center';
            checkboxDiv.innerHTML = `
                <input type="checkbox" id="export-group-${group.id}" class="export-group-checkbox mr-2" data-group-id="${group.id}">
                <label for="export-group-${group.id}" class="text-sm text-gray-700 flex-1">${group.name}</label>
                <span class="text-xs text-gray-500">${group.locations?.length || 0} locations</span>
            `;
            groupsList.appendChild(checkboxDiv);
        });

        // Enable controls
        document.getElementById('select-all-groups').disabled = false;
        updateExportButtonState();
    }

    // Final feather icon replacement
    feather.replace();
}

function closeExportModal() {
    const modal = document.getElementById('export-modal');
    modal.classList.add('hidden');

    // Reset form
    document.querySelectorAll('.export-group-checkbox').forEach(checkbox => {
        checkbox.checked = false;
    });
    document.getElementById('select-all-groups').checked = false;
    updateExportButtonState();
}

function updateExportButtonState() {
    const checkedBoxes = document.querySelectorAll('.export-group-checkbox:checked');
    const exportButton = document.getElementById('start-export');
    exportButton.disabled = checkedBoxes.length === 0;
}

function toggleSelectAll() {
    const selectAllCheckbox = document.getElementById('select-all-groups');
    const groupCheckboxes = document.querySelectorAll('.export-group-checkbox');

    groupCheckboxes.forEach(checkbox => {
        checkbox.checked = selectAllCheckbox.checked;
    });

    updateExportButtonState();
}

function generateCSV(group) {
    const locations = group.locations || [];

    // CSV header - use group name in header
    let csv = `${group.name} Addresses\n`;

    // Add each location - only the title/address
    locations.forEach(location => {
        const title = (location.title || '').replace(/"/g, '""'); // Escape quotes
        csv += `"${title}"\n`;
    });

    return csv;
}

async function exportSelectedGroups() {
    const checkedBoxes = document.querySelectorAll('.export-group-checkbox:checked');
    const exportButton = document.getElementById('start-export');

    if (checkedBoxes.length === 0) {
        showPopup('warning', 'Please select at least one group to export.', 'No Groups Selected');
        return;
    }

    // Show loading state
    const originalButtonText = exportButton.innerHTML;
    exportButton.innerHTML = '<i data-feather="loader" class="mr-2 h-4 w-4 animate-spin"></i> Creating ZIP...';
    exportButton.disabled = true;

    try {
        // Create a new JSZip instance
        const zip = new JSZip();
        let fileCount = 0;

        // Process each selected group
        for (const checkbox of checkedBoxes) {
            const groupId = checkbox.dataset.groupId;
            const group = locationGroups.find(g => g.id === groupId);

            if (group) {
                // Generate CSV content for this group
                const csv = generateCSV(group);
                const fileName = `${group.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_locations.csv`;

                // Add the CSV file to the ZIP
                zip.file(fileName, csv);
                fileCount++;

                // Update button text to show progress
                exportButton.innerHTML = `<i data-feather="loader" class="mr-2 h-4 w-4 animate-spin"></i> Adding ${fileCount}/${checkedBoxes.length}...`;
                feather.replace();

                // Small delay for visual feedback
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        // Update button text for ZIP generation
        exportButton.innerHTML = '<i data-feather="loader" class="mr-2 h-4 w-4 animate-spin"></i> Generating ZIP...';
        feather.replace();

        // Generate the ZIP file
        const zipBlob = await zip.generateAsync({ type: 'blob' });

        // Create download link for the ZIP file
        const link = document.createElement('a');
        const url = URL.createObjectURL(zipBlob);

        // Create a descriptive filename
        const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format
        const zipFileName = `location_groups_export_${timestamp}.zip`;

        link.setAttribute('href', url);
        link.setAttribute('download', zipFileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the URL object
        URL.revokeObjectURL(url);

        showPopup('success', `Successfully exported ${fileCount} groups as ZIP file!`, 'Export Complete');
        closeExportModal();

    } catch (error) {
        console.error('Export error:', error);
        showPopup('error', 'Failed to create ZIP file. Please try again.', 'Export Failed');
    } finally {
        // Restore button state
        exportButton.innerHTML = originalButtonText;
        exportButton.disabled = false;
        feather.replace();
    }
}

// Event listeners for export functionality
document.addEventListener('DOMContentLoaded', function() {
    // Export button in navigation
    document.getElementById('export-btn').addEventListener('click', openExportModal);

    // Modal controls
    document.getElementById('close-export-modal').addEventListener('click', closeExportModal);
    document.getElementById('cancel-export').addEventListener('click', closeExportModal);
    document.getElementById('start-export').addEventListener('click', exportSelectedGroups);

    // Select all checkbox
    document.getElementById('select-all-groups').addEventListener('change', toggleSelectAll);

    // Update export button state when individual checkboxes change
    document.addEventListener('change', function(e) {
        if (e.target.classList.contains('export-group-checkbox')) {
            updateExportButtonState();

            // Update select all checkbox state
            const allCheckboxes = document.querySelectorAll('.export-group-checkbox');
            const checkedCheckboxes = document.querySelectorAll('.export-group-checkbox:checked');
            const selectAllCheckbox = document.getElementById('select-all-groups');

            if (checkedCheckboxes.length === 0) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = false;
            } else if (checkedCheckboxes.length === allCheckboxes.length) {
                selectAllCheckbox.indeterminate = false;
                selectAllCheckbox.checked = true;
            } else {
                selectAllCheckbox.indeterminate = true;
            }
        }
    });

    // Close modal when clicking outside
    document.getElementById('export-modal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeExportModal();
        }
    });
});

// ================================
// SCREENSHOT FUNCTIONALITY
// ================================

async function takeMapScreenshot() {
    const screenshotButton = document.getElementById('screenshot-btn');

    // Check if a group is selected
    if (!currentGroupId) {
        showPopup('warning', 'Please select a location group first to take a screenshot.', 'Group Required');
        return;
    }

    // Get current group info
    const currentGroup = locationGroups.find(g => g.id === currentGroupId);
    if (!currentGroup) {
        showPopup('error', 'Selected group not found.', 'Group Error');
        return;
    }

    // Show loading state
    const originalButtonText = screenshotButton.innerHTML;
    screenshotButton.innerHTML = '<i data-feather="loader" class="mr-2 h-4 w-4 animate-spin"></i> Capturing...';
    screenshotButton.disabled = true;

    try {
        // Hide sidebar temporarily for cleaner screenshot
        const sidebar = document.getElementById('sidebar');
        const mapContainer = document.getElementById('map-container');
        const originalSidebarDisplay = sidebar.style.display;
        const originalMapMargin = mapContainer.className;

        sidebar.style.display = 'none';
        mapContainer.className = mapContainer.className.replace('mr-64', 'mr-0');

        // Wait a moment for layout adjustment
        await new Promise(resolve => setTimeout(resolve, 300));

        // Capture the map
        const mapCanvas = await html2canvas(mapContainer, {
            useCORS: true,
            allowTaint: true,
            scale: 1,
            width: mapContainer.offsetWidth,
            height: mapContainer.offsetHeight,
            backgroundColor: '#ffffff'
        });

        // Restore sidebar
        sidebar.style.display = originalSidebarDisplay;
        mapContainer.className = originalMapMargin;

        // Generate marker list
        const markerListCanvas = await generateMarkerListCanvas(currentGroup);

        // Combine map and marker list
        const combinedCanvas = combineCanvases(mapCanvas, markerListCanvas);

        // Download the image
        downloadCanvas(combinedCanvas, currentGroup.name);

        showPopup('success', 'Screenshot saved successfully!', 'Screenshot Complete');

    } catch (error) {
        console.error('Screenshot error:', error);
        showPopup('error', 'Failed to capture screenshot. Please try again.', 'Screenshot Failed');
    } finally {
        // Restore button state
        screenshotButton.innerHTML = originalButtonText;
        screenshotButton.disabled = false;
        feather.replace();
    }
}

async function generateMarkerListCanvas(group) {
    // Create a temporary div to render the marker list
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

    // Create header
    const header = document.createElement('h3');
    header.style.margin = '0 0 16px 0';
    header.style.fontSize = '18px';
    header.style.fontWeight = '600';
    header.style.color = '#111827';
    header.textContent = `${group.name}`;

    tempDiv.appendChild(header);

    // Get current markers for this group
    const groupMarkers = markers.filter(marker => {
        // Since we don't have groupId on markers, we'll use all current markers
        // This assumes the current markers are from the selected group
        return true;
    });

    if (groupMarkers.length === 0) {
        const noMarkersText = document.createElement('p');
        noMarkersText.style.color = '#6b7280';
        noMarkersText.style.fontStyle = 'italic';
        noMarkersText.textContent = 'No locations in this group';
        tempDiv.appendChild(noMarkersText);
    } else {
        // Create marker list
        groupMarkers.forEach((marker, index) => {
            const markerItem = document.createElement('div');
            markerItem.style.display = 'flex';
            markerItem.style.alignItems = 'flex-start';
            markerItem.style.marginBottom = '12px';
            markerItem.style.padding = '8px';
            markerItem.style.backgroundColor = '#f9fafb';
            markerItem.style.borderRadius = '6px';

            // Number indicator - use px units and line-height for html2canvas compatibility
            const numberIndicator = document.createElement('div');
            numberIndicator.style.width = '24px';
            numberIndicator.style.height = '24px';
            numberIndicator.style.borderRadius = '50%';
            numberIndicator.style.backgroundColor = marker.originalColor || '#3B82F6';
            numberIndicator.style.color = 'white';
            numberIndicator.style.fontSize = '12px';
            numberIndicator.style.fontWeight = 'bold';
            numberIndicator.style.textAlign = 'center';
            numberIndicator.style.lineHeight = '10px'; // Move text up 10px total within circle (20px - 10px = 10px)
            numberIndicator.style.marginRight = '12px';
            numberIndicator.style.marginTop = '8px'; // Move circle down by total 8px for larger adjustment
            numberIndicator.style.flexShrink = '0';
            numberIndicator.style.border = '2px solid white';
            numberIndicator.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.1)';
            numberIndicator.style.textShadow = '1px 1px 1px rgba(0, 0, 0, 0.5)';
            numberIndicator.textContent = (index + 1).toString();

            // Address text
            const addressText = document.createElement('div');
            addressText.style.flex = '1';
            addressText.style.color = '#374151';
            addressText.style.fontSize = '13px';
            addressText.style.lineHeight = '1.4';
            addressText.style.wordBreak = 'break-word';
            addressText.textContent = marker.getTitle();

            markerItem.appendChild(numberIndicator);
            markerItem.appendChild(addressText);
            tempDiv.appendChild(markerItem);
        });
    }

    // Add to DOM temporarily
    document.body.appendChild(tempDiv);

    try {
        // Capture the marker list
        const canvas = await html2canvas(tempDiv, {
            backgroundColor: '#ffffff',
            scale: 2, // Higher quality for text
            width: 300,
            useCORS: true
        });

        return canvas;
    } finally {
        // Remove temporary div
        document.body.removeChild(tempDiv);
    }
}

function combineCanvases(mapCanvas, markerListCanvas) {
    // Create combined canvas
    const combinedCanvas = document.createElement('canvas');
    const ctx = combinedCanvas.getContext('2d');

    // Set dimensions
    const mapWidth = mapCanvas.width;
    const mapHeight = mapCanvas.height;
    const listWidth = markerListCanvas.width;
    const totalWidth = mapWidth + listWidth;
    const totalHeight = Math.max(mapHeight, markerListCanvas.height);

    combinedCanvas.width = totalWidth;
    combinedCanvas.height = totalHeight;

    // Fill background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalWidth, totalHeight);

    // Draw map on left
    ctx.drawImage(mapCanvas, 0, 0);

    // Draw marker list on right
    ctx.drawImage(markerListCanvas, mapWidth, 0);

    return combinedCanvas;
}

function downloadCanvas(canvas, groupName) {
    // Create download link
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD format
    const fileName = `${groupName.replace(/[^a-z0-9]/gi, '_')}_Locations_Map.png`;

    // Convert canvas to blob and download
    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, 'image/png');
}

// Event listeners for screenshot functionality
document.addEventListener('DOMContentLoaded', function() {
    // Screenshot button
    document.getElementById('screenshot-btn').addEventListener('click', takeMapScreenshot);
});

// Make initMap globally available for Google Maps callback
window.initMap = initMap;

} // End of isMapPage() conditional