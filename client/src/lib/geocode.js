// Port of geocodeAddress (script.js:2253-2285).
export function geocodeAddress(address) {
    return new Promise((resolve) => {
        const geocoder = new window.google.maps.Geocoder();

        geocoder.geocode({ address }, (results, status) => {
            if (status === 'OK' && results[0]) {
                const location = results[0].geometry.location;
                resolve({
                    success: true,
                    location: { lat: location.lat(), lng: location.lng() },
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
                resolve({ success: false, error });
            }
        });
    });
}
