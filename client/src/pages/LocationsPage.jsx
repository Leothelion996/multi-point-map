import MapPage from './MapPage.jsx';

// key forces a full remount when switching between Locations and ZIP Codes,
// mirroring the legacy full-page navigation between index.html and zipcodes.html.
export default function LocationsPage() {
  return <MapPage key="locations" groupType="locations" />;
}
