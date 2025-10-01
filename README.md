# Custom Map Website

A web application that allows users to create and manage custom maps with location groups stored on a Node.js backend.

## Features

- Create and manage location groups
- Add markers to maps by clicking or searching for addresses
- Store location data persistently on the server
- Interactive map interface with Google Maps
- Responsive design with collapsible sidebar

## Technology Stack

**Frontend:**
- HTML5, CSS3, Vanilla JavaScript
- Google Maps JavaScript API
- Tailwind CSS (via CDN)
- AOS (Animate On Scroll)
- Feather Icons

**Backend:**
- Node.js
- Express.js
- In-memory storage (can be extended to database)

## Installation

1. Install Node.js dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

Or for development with auto-restart:
```bash
npm run dev
```

3. Open your browser and navigate to:
```
http://localhost:3000
```

## API Endpoints

### Location Groups

- `GET /api/location-groups` - Get all location groups
- `GET /api/location-groups/:id` - Get specific location group
- `POST /api/location-groups` - Create new location group
- `PUT /api/location-groups/:id` - Update location group
- `DELETE /api/location-groups/:id` - Delete location group

### Locations within Groups

- `POST /api/location-groups/:id/locations` - Add location to group
- `DELETE /api/location-groups/:groupId/locations/:locationId` - Remove location from group

## Usage

1. **Create a Location Group**: Click the "+" button next to the group selector and enter a name
2. **Select a Group**: Choose from the dropdown to load existing markers
3. **Add Markers**:
   - Click anywhere on the map to add a marker at that location
   - Use the search box to find and add specific addresses
   - Use the "Add Marker" button after entering a search term
4. **Manage Markers**: Click on markers to view details or delete them
5. **View All Markers**: Use the "Show All" button to fit all markers in view

## Configuration

To use your own Google Maps API key, replace the key in the script tag:
```html
<script src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY"></script>
```

## Future Enhancements

- Database integration (MongoDB, PostgreSQL)
- User authentication and authorization
- Marker editing capabilities
- Import/export functionality
- Sharing location groups with other users
- Custom marker icons and styles