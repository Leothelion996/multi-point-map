# Custom Maps Pro - Project Documentation

## 📋 Table of Contents
- [Project Overview](#project-overview)
- [Architecture & File Structure](#architecture--file-structure)
- [Detailed File Breakdown](#detailed-file-breakdown)
- [Major Features Deep Dive](#major-features-deep-dive)
- [API Documentation](#api-documentation)
- [Development Guide](#development-guide)
- [Troubleshooting](#troubleshooting)

## 🎯 Project Overview

**Custom Maps Pro** is a web-based mapping application that allows users to create, manage, and export custom maps with location groups and markers. Built with modern web technologies, it provides an intuitive interface for organizing geographical data.

### Key Features
- 🗺️ **Interactive Google Maps Integration** - Full-featured mapping with search and place autocomplete
- 📍 **Location Group Management** - Organize markers into named groups with custom colors
- 📂 **Bulk Location Import** - Add multiple locations at once from text input
- 📊 **Data Export** - Export location groups as CSV files or ZIP archives
- 📸 **Map Screenshots** - Capture map images with formatted marker lists
- 🎨 **Customizable Markers** - Choose colors and manage marker order with drag-and-drop
- 📱 **Responsive Design** - Works seamlessly on desktop and mobile devices

### Technology Stack
- **Frontend**: Vanilla JavaScript, Tailwind CSS, HTML5
- **Backend**: Node.js, Express.js
- **Maps**: Google Maps JavaScript API with Places library
- **Libraries**:
  - `html2canvas` for screenshot capture
  - `JSZip` for file compression
  - `feather-icons` for UI icons
  - `AOS` for animations
- **Security**: Helmet, Express Rate Limit, CORS, Input validation

## 🏗️ Architecture & File Structure

The project follows a **multi-page architecture** with separated concerns for scalability:

```
Custom Map Website/
├── 📄 index.html              # Main map page
├── 📄 about.html              # Example additional page
├── 📄 server.js               # Express backend server
├── 📄 script.js               # Map-specific JavaScript (conditionally loaded)
├── 📄 styles.css              # Legacy styles (being phased out)
├── 📄 package.json            # Dependencies and scripts
├── 📄 project-info.md         # This documentation file
├── 📁 assets/
│   ├── 📁 css/
│   │   ├── 📄 shared.css      # Cross-page styles (navigation, popups, modals)
│   │   └── 📄 map.css         # Map-specific styles
│   └── 📁 js/
│       ├── 📄 shared.js       # Cross-page JavaScript utilities
│       └── 📄 map.js          # Future map-specific modular code
└── 📁 node_modules/           # Dependencies
```

### Architecture Principles

1. **Separation of Concerns**: Map-specific code only runs on map pages
2. **Shared Resources**: Common styles and utilities are reusable across pages
3. **Progressive Enhancement**: Core functionality works without JavaScript
4. **Security First**: Input validation, rate limiting, and secure headers
5. **Responsive Design**: Mobile-first approach with progressive desktop enhancements

## 📁 Detailed File Breakdown

### 🖥️ **server.js** - Backend API Server
**Purpose**: Express.js server providing REST API for location group management

#### Key Sections:

**Security Configuration** (Lines 14-43):
```javascript
// CORS configuration with environment-based origins
const corsOptions = {
    origin: process.env.NODE_ENV === 'production'
        ? ['https://yourdomain.com']
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    optionsSuccessStatus: 200
};

// Security headers and rate limiting
app.use(helmet({
    contentSecurityPolicy: false, // Disabled for Google Maps
    crossOriginEmbedderPolicy: false
}));

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
});
```

**Data Storage** (Line 58):
```javascript
let locationGroups = {}; // In-memory storage (temporary solution)
```

**API Endpoints**:
- `GET /api/config` - Serves Google Maps API key with referrer validation
- `GET /api/location-groups` - Returns all location groups
- `POST /api/location-groups` - Creates new location group
- `PUT /api/location-groups/:id` - Updates existing group
- `DELETE /api/location-groups/:id` - Deletes location group
- Location-specific endpoints for CRUD operations within groups

### 🗺️ **index.html** - Main Map Page
**Purpose**: Primary user interface for the mapping application

#### Structure Breakdown:

**Head Section** (Lines 1-14):
```html
<!-- External Dependencies -->
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://unpkg.com/aos@2.3.1/dist/aos.js"></script>
<script src="https://cdn.jsdelivr.net/npm/feather-icons/dist/feather.min.js"></script>

<!-- Custom Stylesheets -->
<link rel="stylesheet" href="assets/css/shared.css">
<link rel="stylesheet" href="assets/css/map.css">
```

**Navigation** (Lines 16-39):
- Grid-based layout with logo, spacer, and controls
- About link, Screenshot button, Export button, Sidebar toggle
- Responsive design that collapses on mobile

**Main Layout** (Lines 41-43):
```html
<!-- Flexbox layout: Map container + Right sidebar -->
<div class="flex h-screen">
    <div id="map-container" class="flex-1 mr-64 transition-all duration-300 relative">
        <div id="map" class="w-full h-full"></div>
    </div>
```

**Sidebar Components** (Lines 45-366):
- Location Group Management
- Search functionality with Google Places autocomplete
- Marker color selection
- Bulk upload modal system
- Location list with drag-and-drop reordering

### 🎨 **assets/css/shared.css** - Cross-Page Styles
**Purpose**: Reusable styles for navigation, popups, and common UI components

#### Key Style Groups:

**Navigation System** (Lines 10-32):
```css
.nav-grid-container {
    display: grid;
    grid-template-columns: auto 1fr auto; /* Logo | Spacer | Controls */
    align-items: center;
    width: 100%;
}
```

**Popup Notification System** (Lines 40-150):
- Four notification types: success, error, warning, info
- Animated slide-in/slide-out effects
- Auto-dismiss functionality with progress bars
- Mobile-responsive positioning

**Modal System** (Lines 155-185):
- Backdrop blur effects
- Slide-in animations
- Loading states and progress indicators

### 🗺️ **assets/css/map.css** - Map-Specific Styles
**Purpose**: Styles that only apply to the map page, preventing conflicts on other pages

#### Critical Map Styles:

**Page-Specific Body Constraints**:
```css
body.map-page {
    overflow: hidden;      /* Prevents page scrolling */
    height: 100vh;         /* Full viewport height */
    width: 100vw;         /* Full viewport width */
}
```

**Map Container Sizing**:
```css
#map, #map-container {
    height: calc(100vh - 64px); /* Full height minus navigation */
    max-height: calc(100vh - 64px);
}
```

**Sidebar Positioning** (Lines 25-35):
```css
.sidebar {
    transition: all 0.3s ease;
    height: calc(100vh - 64px) !important;
    top: 64px;                    /* Below navigation */
    max-height: calc(100vh - 64px);
}

.sidebar-closed { transform: translateX(100%); }  /* Hidden right */
.sidebar-open { transform: translateX(0); }      /* Visible */
```

### 🧠 **script.js** - Main Application Logic
**Purpose**: Core functionality for map interaction, data management, and user interface

#### Major Code Sections:

**Page Detection Wrapper** (Lines 1-7):
```javascript
// Only initialize AOS and run map-specific code if we're on the map page
if (typeof isMapPage === 'function' && isMapPage()) {
    // All map-specific code runs inside this conditional
    // Prevents errors on non-map pages
}
```

**Service Classes** (Lines 8-250):

1. **DOMCache Class** - Centralized DOM element management
2. **APIService Class** - HTTP request handling with error management
3. **ConfigService Class** - Google Maps API key management

**Google Maps Integration** (Lines 300-400):
```javascript
async function initMap() {
    // Load API configuration
    await loadConfig();

    // Initialize map with default center (NYC)
    map = new google.maps.Map(document.getElementById('map'), {
        zoom: 10,
        center: { lat: 40.7128, lng: -74.0060 }
    });

    // Set up Places autocomplete
    autocomplete = new google.maps.places.Autocomplete(input);
    autocomplete.bindTo('bounds', map);
}
```

**Location Group Management** (Lines 500-800):
- CRUD operations for groups and locations
- Real-time UI updates
- Data synchronization with backend

**Bulk Upload System** (Lines 1200-1600):
- Address parsing and validation
- Geocoding with Google Places API
- Progress tracking and user feedback
- Error handling for failed geocoding

**Export Functionality** (Lines 1700-2000):
- CSV generation with proper formatting
- ZIP file creation using JSZip
- Multiple group export with organized structure

**Screenshot Capture** (Lines 2300-2600):
- HTML5 Canvas manipulation
- Sidebar hiding for clean captures
- Marker list generation
- Image composition and download

### 🔧 **assets/js/shared.js** - Cross-Page Utilities
**Purpose**: Reusable JavaScript functionality for all pages

#### Core Functions:

**Popup Notification System**:
```javascript
function showPopup(type, message, title, autoDismiss = 2000) {
    // Creates animated notifications with auto-dismiss
    // Supports: success, error, warning, info types
    // Handles proper cleanup and memory management
}
```

**Page Detection Utilities**:
```javascript
function getCurrentPage() {
    const path = window.location.pathname;
    const filename = path.split('/').pop() || 'index.html';
    return filename === 'index.html' || filename === '' ? 'map' : filename.replace('.html', '');
}

function isMapPage() {
    return getCurrentPage() === 'map';
}
```

**Utility Functions**:
- `debounce()` - Rate limiting for user input
- `throttle()` - Performance optimization for scroll/resize events
- `initializeNavigation()` - Cross-page navigation management

## 🚀 Major Features Deep Dive

### 📍 Location Group Management

**How it Works**:
1. User creates a group via dropdown or bulk upload
2. Frontend sends POST request to `/api/location-groups`
3. Backend generates UUID and stores in memory
4. UI updates immediately with new group

**Key Functions**:
- `createLocationGroup(name)` - API call to create group
- `selectGroup(groupId)` - Updates UI and loads group markers
- `updateGroupDropdown()` - Refreshes group selection UI

### 🔍 Address Search & Geocoding

**Implementation**:
```javascript
// Google Places Autocomplete setup
autocomplete = new google.maps.places.Autocomplete(input);
autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (place.geometry) {
        // Add marker to current group
        addLocationToGroup(currentGroupId, {
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            title: place.formatted_address,
            color: getSelectedMarkerColor()
        });
    }
});
```

### 📂 Bulk Upload System

**Process Flow**:
1. Parse addresses from textarea (line-by-line)
2. Validate and limit to 50 addresses max
3. Create or select target group
4. Geocode each address using Google Places API
5. Display progress with success/failure tracking
6. Add successful locations to map and group

**Error Handling**:
- Invalid addresses are logged and reported
- API rate limiting is respected
- User sees detailed results modal

### 📊 Export Functionality

**CSV Generation**:
```javascript
function generateCSV(group) {
    const headers = ['Address'];
    const rows = group.locations.map(loc => [loc.title]);

    const csvContent = [
        `${group.name} Addresses`,
        headers.join(','),
        ...rows.map(row => row.join(','))
    ].join('\n');

    return csvContent;
}
```

**ZIP Creation**:
- Uses JSZip library to bundle multiple CSV files
- Organized folder structure by group name
- Automatic file naming with timestamps

### 📸 Screenshot Capture

**Technical Implementation**:
1. Temporarily hide sidebar for clean map view
2. Use `html2canvas` to capture map container
3. Generate marker list as separate canvas
4. Combine map and list using Canvas API
5. Download as PNG with descriptive filename

**Canvas Composition**:
```javascript
function combineCanvases(mapCanvas, markerListCanvas) {
    const combinedCanvas = document.createElement('canvas');
    const ctx = combinedCanvas.getContext('2d');

    // Set dimensions for side-by-side layout
    combinedCanvas.width = mapCanvas.width + markerListCanvas.width;
    combinedCanvas.height = Math.max(mapCanvas.height, markerListCanvas.height);

    // Draw map on left, list on right
    ctx.drawImage(mapCanvas, 0, 0);
    ctx.drawImage(markerListCanvas, mapCanvas.width, 0);

    return combinedCanvas;
}
```

## 📡 API Documentation

### Authentication
- **Current**: No authentication required
- **Security**: Referrer checking for Google Maps API key
- **Rate Limiting**: 100 requests per 15 minutes per IP

### Endpoints

#### `GET /api/config`
**Purpose**: Retrieve Google Maps API key
**Security**: Referrer validation
```javascript
Response: {
    "googleMapsApiKey": "your-api-key"
}
```

#### `GET /api/location-groups`
**Purpose**: Get all location groups
```javascript
Response: [
    {
        "id": "uuid-string",
        "name": "Group Name",
        "locations": [...],
        "createdAt": "2024-01-01T00:00:00Z",
        "updatedAt": "2024-01-01T00:00:00Z"
    }
]
```

#### `POST /api/location-groups`
**Purpose**: Create new location group
**Validation**: Name required (1-100 chars), locations array optional
```javascript
Request: {
    "name": "My New Group",
    "locations": []  // optional
}

Response: {
    "id": "generated-uuid",
    "name": "My New Group",
    "locations": [],
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
}
```

#### `PUT /api/location-groups/:id`
**Purpose**: Update existing group
**Validation**: Name (1-100 chars), locations array
```javascript
Request: {
    "name": "Updated Name",      // optional
    "locations": [...]           // optional
}
```

#### `DELETE /api/location-groups/:id`
**Purpose**: Delete location group
**Response**: 204 No Content on success

#### `POST /api/location-groups/:id/locations`
**Purpose**: Add location to specific group
**Validation**: lat (-90 to 90), lng (-180 to 180), title (1-200 chars)
```javascript
Request: {
    "lat": 40.7128,
    "lng": -74.0060,
    "title": "New York, NY",
    "color": "#FF0000"           // optional, defaults to blue
}

Response: {
    "id": "location-uuid",
    "lat": 40.7128,
    "lng": -74.0060,
    "title": "New York, NY",
    "color": "#FF0000"
}
```

#### `PUT /api/location-groups/:groupId/locations/reorder`
**Purpose**: Reorder locations within group (for drag-and-drop)
```javascript
Request: {
    "locationIds": ["uuid1", "uuid2", "uuid3"]
}

Response: {
    "success": true,
    "locations": [...]  // reordered array
}
```

#### `DELETE /api/location-groups/:groupId/locations/:locationId`
**Purpose**: Remove specific location from group
**Response**: 204 No Content on success

### Error Responses
All endpoints return consistent error format:
```javascript
{
    "error": "Description of error",
    "details": [...]  // validation errors if applicable
}
```

**Common HTTP Status Codes**:
- `400` - Bad Request (validation errors)
- `404` - Not Found (group/location doesn't exist)
- `429` - Too Many Requests (rate limiting)
- `500` - Internal Server Error

## 🛠️ Development Guide

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
Create `.env` file:
```env
GOOGLE_MAPS_API_KEY=your-google-maps-api-key
NODE_ENV=development
PORT=3000
```

3. **Start Development Server**:
```bash
npm run dev    # Uses nodemon for auto-reload
# or
npm start      # Standard node server                 <-----------------------------------------
```

4. **Access Application**:
- Main app: `http://localhost:3000`
- About page: `http://localhost:3000/about.html`

### Development Workflow

**Adding New Pages**:
1. Create new HTML file in root directory
2. Include shared CSS: `<link rel="stylesheet" href="assets/css/shared.css">`
3. Add navigation links to existing pages
4. Test page detection with `getCurrentPage()` function

**Modifying Styles**:
- **Global changes**: Edit `assets/css/shared.css`
- **Map-specific**: Edit `assets/css/map.css`
- **New page styles**: Create new CSS file and link in HTML

**Adding Features**:
1. Plan backend API endpoints if needed
2. Add frontend functionality to appropriate section
3. Test on both desktop and mobile
4. Update this documentation

### File Modification Guidelines

**script.js**:
- All new map functionality goes inside `isMapPage()` conditional
- Use existing service classes (DOMCache, APIService)
- Follow error handling patterns
- Add proper cleanup in event listeners

**server.js**:
- Add input validation for new endpoints
- Follow RESTful naming conventions
- Include rate limiting for new routes
- Add appropriate error responses

### Testing Checklist
- [ ] Map loads correctly with Google API
- [ ] All CRUD operations work (create, read, update, delete)
- [ ] Bulk upload handles errors gracefully
- [ ] Export generates proper CSV/ZIP files
- [ ] Screenshot captures work on different screen sizes
- [ ] Responsive design works on mobile
- [ ] Navigation works between pages
- [ ] No JavaScript errors in console

## 🐛 Troubleshooting

### Common Issues

#### **Map Not Loading**
**Symptoms**: Gray area where map should be, console errors about API key
**Solutions**:
1. Check `.env` file has correct `GOOGLE_MAPS_API_KEY`
2. Verify API key has Maps JavaScript API and Places API enabled
3. Check browser console for specific error messages
4. Ensure referrer restrictions allow your domain

#### **"Address already in use" Error**
**Symptoms**: Server won't start, EADDRINUSE error
**Solutions**:
```bash
# Kill existing node processes
taskkill /F /IM node.exe

# Or use different port
set PORT=3001 && npm start
```

#### **Location Search Not Working**
**Symptoms**: Autocomplete dropdown doesn't appear
**Solutions**:
1. Verify Places API is enabled in Google Cloud Console
2. Check API key billing is set up
3. Look for console errors about quota exceeded

#### **Export Not Downloading**
**Symptoms**: Export button works but no file downloads
**Solutions**:
1. Check browser's download settings
2. Look for popup blockers preventing downloads
3. Verify JavaScript console for blob/URL errors

#### **Sidebar Not Responsive**
**Symptoms**: Sidebar doesn't hide/show on mobile
**Solutions**:
1. Check CSS for proper media queries
2. Verify JavaScript event listeners are attached
3. Test with browser developer tools device simulation

#### **Bulk Upload Fails**
**Symptoms**: Progress shows but no locations added
**Solutions**:
1. Check address format (one per line)
2. Verify group is selected before upload
3. Look for geocoding API quota issues
4. Check network requests in developer tools

### Performance Optimization

**Large Number of Markers**:
- Consider marker clustering for 100+ locations
- Implement virtualization for location lists
- Use marker bounds to limit visible markers

**Slow Loading**:
- Enable Google Maps API key restrictions
- Implement lazy loading for heavy components
- Optimize image assets and external libraries

### Browser Compatibility
- **Supported**: Chrome 80+, Firefox 75+, Safari 13+, Edge 80+
- **Known Issues**: IE 11 not supported (uses modern JavaScript)
- **Mobile**: iOS Safari 13+, Chrome Mobile 80+

### Security Considerations
- **API Key Exposure**: Keys are served from backend with referrer checking
- **Input Validation**: All user input is sanitized and validated
- **Rate Limiting**: Prevents abuse of bulk operations
- **CORS**: Configured for specific origins only

---

## 📝 Contributing

When contributing to this project:

1. **Document Changes**: Update this file for significant modifications
2. **Test Thoroughly**: Verify functionality on desktop and mobile
3. **Follow Patterns**: Use existing code patterns and service classes
4. **Security First**: Validate all inputs and handle errors gracefully

## 📞 Support

For questions or issues:
1. Check this documentation first
2. Look for similar issues in browser console
3. Verify Google Maps API configuration
4. Test with minimal examples to isolate problems

---

*Last Updated: 9/16/2025*
*Project Version: 1.0.0*