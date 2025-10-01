# Custom Maps Pro

A web-based mapping application that allows users to create, manage, and export custom maps with location groups and markers. Built with modern web technologies, it provides an intuitive interface for organizing geographical data.

## Features

- 🗺️ **Interactive Google Maps Integration** - Full-featured mapping with search and place autocomplete
- 📍 **Location Group Management** - Organize markers into named groups with custom colors
- 📂 **Bulk Location Import** - Add multiple locations at once from text input (up to 50 addresses)
- 📊 **Data Export** - Export location groups as CSV files or ZIP archives
- 📸 **Map Screenshots** - Capture map images with formatted marker lists
- 🎨 **Customizable Markers** - Choose colors and manage marker order with drag-and-drop
- 📱 **Responsive Design** - Works seamlessly on desktop and mobile devices

## Technology Stack

**Frontend:**
- Vanilla JavaScript, Tailwind CSS, HTML5
- Google Maps JavaScript API with Places library
- html2canvas (screenshot capture)
- JSZip (file compression)
- Feather Icons (UI icons)
- AOS (animations)

**Backend:**
- Node.js, Express.js
- Helmet (security headers)
- Express Rate Limit (API protection)
- CORS (cross-origin security)
- In-memory storage

## Installation

### Prerequisites
- Node.js 16+
- npm or yarn
- Google Maps API key with Places library enabled

### Setup Instructions

1. **Clone and Install**:
```bash
cd "Custom Map Website"
npm install
```

2. **Environment Configuration**:
Create a `.env` file in the project root:
```env
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
NODE_ENV=development
PORT=3000
```

3. **Start the Server**:
```bash
npm start      # Standard node server
# or
npm run dev    # Development mode with nodemon auto-reload
```

4. **Access Application**:
- Main app: `http://localhost:3000`
- About page: `http://localhost:3000/about.html`

## API Endpoints

### Security
- **Rate Limiting**: 100 requests per 15 minutes per IP
- **Authentication**: No authentication (suitable for single-user or demo use)
- **API Key Protection**: Google Maps API key served with referrer validation

### Location Groups

- `GET /api/config` - Get Google Maps API configuration
- `GET /api/location-groups` - Get all location groups
- `POST /api/location-groups` - Create new location group
- `PUT /api/location-groups/:id` - Update location group (name, locations)
- `DELETE /api/location-groups/:id` - Delete location group

### Locations within Groups

- `POST /api/location-groups/:id/locations` - Add location to group
- `PUT /api/location-groups/:groupId/locations/reorder` - Reorder locations (drag-and-drop)
- `DELETE /api/location-groups/:groupId/locations/:locationId` - Remove location from group

## Usage

### Creating and Managing Location Groups

1. **Create a Location Group**: Click the "+" button in the sidebar and enter a name
2. **Select a Group**: Choose from the dropdown to load and manage markers
3. **Rename/Delete Groups**: Use the group management options in the sidebar

### Adding Locations

**Single Location:**
- Use the search box to find an address
- Select the desired marker color
- The location will be added to the currently selected group

**Bulk Upload:**
1. Click the "Bulk Upload" button in the sidebar
2. Enter addresses (one per line, up to 50)
3. Select or create a target group
4. Click "Geocode and Add" to process all addresses
5. View success/failure report when complete

### Managing Markers

- **Reorder**: Drag and drop locations in the sidebar list
- **Change Colors**: Select a different color and update individual markers
- **Delete**: Click the trash icon next to any location

### Exporting Data

**Export as CSV:**
- Click the "Export" button in the navigation
- Select one or more groups to export
- Downloads a ZIP file with CSV files for each group

**Screenshot Capture:**
- Click the "Screenshot" button in the navigation
- Map is captured with a formatted marker list
- Downloads as a PNG image

## Architecture

The project follows a **multi-page architecture** with separated concerns:

```
Custom Map Website/
├── index.html              # Main map page
├── about.html              # Additional pages
├── server.js               # Express backend server
├── script.js               # Map-specific JavaScript
├── assets/
│   ├── css/
│   │   ├── shared.css      # Cross-page styles
│   │   └── map.css         # Map-specific styles
│   └── js/
│       └── shared.js       # Cross-page utilities
└── node_modules/           # Dependencies
```

### Key Design Principles
- **Separation of Concerns**: Map-specific code only runs on map pages
- **Shared Resources**: Common styles and utilities are reusable
- **Security First**: Input validation, rate limiting, and secure headers
- **Responsive Design**: Mobile-first approach with progressive enhancements

## Browser Compatibility

- **Supported**: Chrome 80+, Firefox 75+, Safari 13+, Edge 80+
- **Mobile**: iOS Safari 13+, Chrome Mobile 80+
- **Not Supported**: IE 11 (uses modern JavaScript)

## Future Enhancements

- Database integration (MongoDB, PostgreSQL) for persistent storage
- User authentication and authorization
- Custom marker icons and clustering for large datasets
- Sharing location groups with other users
- Real-time collaboration features
- Advanced filtering and search within groups

---

## Disclaimer

This website was developed with the assistance of [Claude.ai](https://claude.ai), an AI assistant by Anthropic.