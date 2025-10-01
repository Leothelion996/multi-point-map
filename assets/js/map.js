/* ================================
   MAP PAGE SPECIFIC JAVASCRIPT
   ================================ */

// Only run map-specific code if we're on the map page
if (isMapPage()) {

// ================================
// GOOGLE MAPS INITIALIZATION
// ================================

let map;
let markers = [];
let autocomplete;
let locationGroups = [];
let currentGroupId = null;
let tempMarkers = [];
let tempMarkerVisibility = {};

async function initMap() {
    try {
        // Load configuration from server
        await loadConfig();

        // Initialize map
        map = new google.maps.Map(document.getElementById('map'), {
            zoom: 10,
            center: { lat: 40.7128, lng: -74.0060 }
        });

        // Initialize autocomplete
        const input = document.getElementById('location-search');
        if (input) {
            autocomplete = new google.maps.places.Autocomplete(input);
            autocomplete.bindTo('bounds', map);

            autocomplete.addListener('place_changed', () => {
                const place = autocomplete.getPlace();
                if (!place.geometry || !place.geometry.location) {
                    showPopup('error', 'No details available for input: \'' + place.name + '\'', 'Location Not Found');
                    return;
                }

                if (place.geometry.viewport) {
                    map.fitBounds(place.geometry.viewport);
                } else {
                    map.setCenter(place.geometry.location);
                    map.setZoom(17);
                }

                // Add marker if location is selected
                if (currentGroupId && place.formatted_address) {
                    addLocationToGroup(currentGroupId, {
                        lat: place.geometry.location.lat(),
                        lng: place.geometry.location.lng(),
                        title: place.formatted_address,
                        color: getSelectedMarkerColor()
                    });
                }
            });
        }

        // Load existing location groups
        await fetchLocationGroups();
        updateGroupDropdown();

        // Initialize UI components
        initializeUI();

        showPopup('success', 'Map initialized successfully!', 'Ready');

    } catch (error) {
        console.error('Error initializing map:', error);
        showPopup('error', 'Failed to initialize map. Please refresh the page.', 'Map Error');
    }
}

// Make initMap globally available for Google Maps callback
window.initMap = initMap;

// Continue with the rest of the map-specific functionality...
// [Note: This would contain all the existing script.js functionality]

} // End of isMapPage() conditional