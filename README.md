# Custom Maps Pro

A web-based mapping application for creating, managing, and exporting custom maps. Built as a React single-page app backed by an Express + PostgreSQL API, it supports location marker groups, ZIP code boundary outlines, and panel stock analysis overlays.

## Features

- 🗺️ **Interactive Google Maps Integration** - Full-featured mapping with search and place autocomplete
- 📍 **Multiple Location Mapping** - Organize numbered markers into named groups with custom colors
- 🗾 **Zip Code Outline** - Render US ZIP code (ZCTA) boundary polygons from Census shapefile data
- 📈 **Panel Stock Analysis** - ZIP outlines merged with centered stock-count icons, driven by session-scoped upload versions (`.xlsx` parsing coming in a later batch)
- 📂 **Bulk Location Import** - Add multiple locations at once from text input (up to 50 addresses)
- 📊 **Data Export** - Export groups as CSV files or ZIP archives
- 📸 **Map Screenshots** - Capture map images with formatted marker lists
- 🔐 **Authentication** - Session-based login; registration opens automatically on first run
- 📱 **Responsive Design** - Works on desktop and mobile

## Technology Stack

**Frontend** (`client/`):
- React 18 + Vite, React Router
- Tailwind CSS (Play CDN) + legacy custom CSS
- Google Maps JavaScript API with Places library
- html2canvas (screenshots), JSZip (exports), react-feather (icons)

**Backend** (`server.js`):
- Node.js, Express.js
- PostgreSQL (`pg`) for users, groups, and locations
- `shapefile` for parsing US Census ZCTA boundary data (loaded into memory at startup)
- Helmet, express-rate-limit, express-validator, bcrypt

## Getting Started

### Prerequisites

- **Node.js 18+** and npm
- **PostgreSQL** database (local or hosted — Railway, Render, Supabase, etc.)
- **Google Maps API key** with the Maps JavaScript API and Places library enabled
- **Census ZCTA shapefile** at `MapZipCodes/tl_2020_us_zcta520/tl_2020_us_zcta520.shp` (2020 ZIP Code Tabulation Areas, available from [census.gov](https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html)) — required for ZIP boundary lookups

### 1. Install dependencies

Server and client have separate package trees; install both:

```bash
npm install
npm --prefix client install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
# PostgreSQL connection string
# Local dev example:  postgresql://postgres:password@localhost:5432/mapdb
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Set to "true" if your Postgres host requires SSL (Railway, Render, Supabase, etc.)
DATABASE_SSL=false

GOOGLE_MAPS_API_KEY=your-google-maps-api-key

# Optional
PORT=3000
NODE_ENV=development
```

Database tables are created automatically on first startup.

### 3. Run in development

```bash
npm run dev
```

This runs both processes concurrently:
- **API** — nodemon serving Express on `http://localhost:3000`
- **Web** — Vite dev server on `http://localhost:5173` with hot reload, proxying `/api` to port 3000

Open **http://localhost:5173** for development.

### 4. Run in production

```bash
npm run build   # builds the React app to client/dist
npm start       # Express serves the API and client/dist on port 3000
```

Open **http://localhost:3000**.

### 5. First login

On first run (no users in the database), the login page switches to **Create your account** mode. Register a username and password, then sign in normally on subsequent visits. Registration is closed once a user exists.

> Note: parsing the ZIP shapefile takes a few seconds at startup — wait for the `✅ Loaded ... ZIP codes` log line before using ZIP lookups.

## Application Pages

All pages are reachable from the hamburger menu (top-left); the top-right icon toggles the right-side panel on map pages.

| Route | Page | Description |
|---|---|---|
| `/` | Multiple Location Mapping | Numbered markers organized into groups |
| `/zipcodes` | Zip Code Outline | ZIP boundary polygons organized into groups |
| `/panel-stock-analysis` | Panel Stock Analysis | ZIP outlines + centered stock-count icons from session upload versions |
| `/login` | Login | Sign in / first-run registration |

Screenshot and Export actions for the active map page live at the bottom of the hamburger menu.

## API Overview

All `/api` routes (except auth) require a logged-in session. Rate limited to 100 requests per 15 minutes per IP.

- `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `GET /api/auth/has-users`
- `GET /api/config` - Google Maps API configuration
- `POST /api/zipcodes/lookup` - ZIP boundary + center lookup (5-digit ZIP)
- `GET|POST|PUT|DELETE /api/{locations|zipcodes}/groups[/:id]` - group CRUD
- `POST|PUT|DELETE /api/{locations|zipcodes}/groups/:id/locations[...]` - locations within a group, incl. reorder
- `GET|POST|DELETE /api/uploads[/:name]` - server file uploads (CSV/TXT/XLS/XLSX, 10 MB each; no UI currently — Panel Stock uploads are session-scoped in the browser)

## Project Structure

```
Custom Map Website/
├── server.js                  # Express API + static serving of client/dist
├── MapZipCodes/               # Census ZCTA shapefile data (not in repo)
├── uploads/                   # Server-side uploaded files
└── client/                    # React SPA (Vite)
    └── src/
        ├── pages/             # MapPage (locations/zipcodes), PanelStockAnalysisPage, LoginPage
        ├── components/        # NavBar, NavMenu, Sidebar, modals, panels
        ├── hooks/             # useMapEngine (groups pages), usePanelStockMap
        ├── context/           # Auth, Shell (nav handlers/sidebar), Popups
        ├── api/               # fetch wrappers for the Express API
        ├── lib/               # markerIcons, screenshot, csvExport, panelStock*, googleMapsLoader
        └── styles/            # shared.css + map.css (legacy CSS contract)
```

## Browser Compatibility

- **Supported**: Chrome 80+, Firefox 75+, Safari 13+, Edge 80+
- **Mobile**: iOS Safari 13+, Chrome Mobile 80+
- **Not Supported**: IE 11

---

## Disclaimer

This website was developed with the assistance of [Claude.ai](https://claude.ai), an AI assistant by Anthropic.
