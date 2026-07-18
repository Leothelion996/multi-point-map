# Custom Map Website

Internal Google Maps web app for building and sharing map views.

It supports:

- Location marker groups
- ZIP code polygon groups
- Panel Stock Analysis from `.xlsx` uploads
- CSV/ZIP exports and map screenshots
- Session login with first-run account creation

## Tech Stack

- Frontend: React 19, Vite, React Router, Google Maps JavaScript API, `xlsx`, `html2canvas`, `JSZip`
- Backend: Node.js 20+, Express, PostgreSQL, cookie sessions, bcrypt, multer, Helmet, rate limiting
- Production: Ubuntu VPS, PM2, Nginx, Certbot
- Data: PostgreSQL stores users, groups, locations, panel stock uploads, and ZIP boundaries

## Requirements

- Node.js 20+
- npm
- PostgreSQL
- Google Maps API key with Maps JavaScript API and Places enabled
- For ZIP boundary seeding only: Census ZCTA shapefile at:

```text
MapZipCodes/tl_2020_us_zcta520/tl_2020_us_zcta520.shp
```

`MapZipCodes/` is intentionally gitignored because it is large.

## Environment

Create `.env` in the repo root:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/custommaps
DATABASE_SSL=false
GOOGLE_MAPS_API_KEY=your_google_maps_key
NODE_ENV=development
PORT=3000
```

Notes:

- Use `DATABASE_SSL=true` only when the Postgres provider requires SSL.
- `PORT` defaults to `3000`.
- Do not commit `.env`.

## Local Setup

```bash
npm ci
npm --prefix client ci
```

Create a PostgreSQL database and set `DATABASE_URL`.

If ZIP boundaries have not been seeded into that database and `MapZipCodes/` exists:

```bash
npm run zips:seed
```

Start local development:

```bash
npm run dev
```

Open:

```text
http://localhost:5173
```

The API runs on `http://localhost:3000`. Vite proxies `/api` requests to it.

## First Login

When the database has no users, the login page allows account creation. After the first user exists, registration closes and users must sign in.

## ZIP Boundaries

ZIP boundaries now live in PostgreSQL, not in server memory.

- Table: `zip_boundaries`
- Seeder: `scripts/seedZipBoundaries.js`
- Command: `npm run zips:seed`
- Default range: California ZCTAs, `90001-96162`
- Behavior: idempotent upsert

The server creates the table automatically, but it does not automatically seed boundary rows. If the table is empty, ZIP lookup endpoints return `503` until seeded.

To seed another numeric ZIP range:

```bash
node scripts/seedZipBoundaries.js --min 97001 --max 97920
```

ZIP polygon colors are loaded from `server/staticData/caZipColors.json`. Rebuild only if the source shapefile or color logic changes:

```bash
npm run colors:build
```

## Useful Scripts

```bash
npm run dev              # API + Vite client
npm run dev:server       # Express with nodemon
npm run dev:client       # Vite only
npm run build            # Build client to client/dist
npm start                # Run production Express server
npm run zips:seed        # Seed ZIP boundaries into Postgres
npm run colors:build     # Rebuild committed CA ZIP color data
```

## Production Summary

Current deployment shape:

- Git branch: `main`
- App path: `/var/www/custom-map`
- Process manager: PM2 app named `custom-map`
- Web server: Nginx reverse proxy to `127.0.0.1:3000`
- HTTPS: Certbot/Nginx
- Database: PostgreSQL

Normal update on the server:

```bash
cd /var/www/custom-map
git pull origin main
npm ci
npm --prefix client ci
npm run build
pm2 restart custom-map --update-env
pm2 save
pm2 logs custom-map --lines 80
```

Run `npm run zips:seed` only if Postgres was reset, `zip_boundaries` is empty, or ZIP boundary data changed.

Detailed server notes are in `DEPLOYMENT_RUNBOOK.md`.

## Troubleshooting

- ZIP lookups return `503`: run `npm run zips:seed`, then restart the app.
- Google Maps is blank: check `GOOGLE_MAPS_API_KEY`, enabled APIs, and allowed referrers.
- Build warns about Node engine: use Node.js 20+.
- App is down: check `pm2 status`, `pm2 logs custom-map --lines 80`, and `systemctl status nginx --no-pager`.
- Database errors: check `DATABASE_URL`, `DATABASE_SSL`, and that PostgreSQL is running.
- Login registration is gone: expected after the first user account exists.
