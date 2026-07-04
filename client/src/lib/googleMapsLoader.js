import { getConfig } from '../api/config.js';

// Module-level singleton: the Maps JS API script must only ever be injected
// once ("You have included the Google Maps JavaScript API multiple times"),
// across route remounts and both map pages. Replaces the legacy global
// window.initMap callback pattern.
let mapsPromise = null;

export function loadGoogleMaps() {
  if (!mapsPromise) {
    mapsPromise = (async () => {
      if (window.google?.maps?.Map) return window.google.maps;

      const { googleMapsApiKey } = await getConfig();

      await new Promise((resolve, reject) => {
        window.__gmapsReady = resolve;
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}&libraries=places&callback=__gmapsReady`;
        script.async = true;
        script.defer = true;
        script.onerror = () => reject(new Error('Failed to load Google Maps'));
        document.head.appendChild(script);
      });

      return window.google.maps;
    })().catch((err) => {
      mapsPromise = null; // allow retry after a failure (e.g. 401 before login)
      throw err;
    });
  }
  return mapsPromise;
}
