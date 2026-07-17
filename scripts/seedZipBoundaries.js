// Seed script: streams the US Census ZCTA shapefile and upserts ZIP boundary
// geometries into the zip_boundaries Postgres table, replacing the old
// load-the-whole-shapefile-into-memory approach in server.js (which needed
// 3-5GB of heap and OOMed the 2GB production droplet).
//
// Run manually via `npm run zips:seed` (requires MapZipCodes/ shapefile
// present on disk — see .gitignore — and DATABASE_URL in .env). Idempotent:
// re-running upserts in place. Defaults to California ZCTAs only; pass
// --min/--max to seed additional states later, e.g.:
//   node scripts/seedZipBoundaries.js                      # CA (90001-96162)
//   node scripts/seedZipBoundaries.js --min 97001 --max 97920   # add Oregon
// Bounds are compared numerically — pass them without leading zeros (a
// Northeast range like 06001-06928 is --min 6001 --max 6928).
//
// The production droplet never runs this (the shapefile only lives on dev
// machines); the table is transferred via pg_dump/psql — see "Deploy Plan.om".

require('dotenv').config();
const path = require('path');
const { Client } = require('pg');
const shapefile = require('shapefile');
const { ZIP_BOUNDARIES_DDL } = require('../db/database');

const DEFAULTS = { min: 90001, max: 96162, batch: 100 };

function parseArgs(argv) {
    const args = { ...DEFAULTS };
    for (let i = 2; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--min' || flag === '--max' || flag === '--batch') {
            const value = Number(argv[++i]);
            if (!Number.isInteger(value) || value <= 0) {
                console.error(`Invalid value for ${flag}: ${argv[i]}`);
                process.exit(1);
            }
            args[flag.slice(2)] = value;
        } else {
            console.error(`Unknown argument: ${flag}`);
            console.error('Usage: node scripts/seedZipBoundaries.js [--min 90001] [--max 96162] [--batch 100]');
            process.exit(1);
        }
    }
    return args;
}

// Same center math as the old server.js buildZipResponse: average of the
// outer-ring vertices (Polygon: ring 0; MultiPolygon: ring 0 of each
// polygon). Kept verbatim so stored centers match the old runtime values.
function centerOf(geometry) {
    let centerLat = 0;
    let centerLng = 0;
    let pointCount = 0;

    if (geometry.type === 'Polygon') {
        geometry.coordinates[0].forEach(coord => {
            centerLng += coord[0];
            centerLat += coord[1];
            pointCount++;
        });
    } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach(polygon => {
            polygon[0].forEach(coord => {
                centerLng += coord[0];
                centerLat += coord[1];
                pointCount++;
            });
        });
    }

    if (pointCount === 0) return null;
    return { lat: centerLat / pointCount, lng: centerLng / pointCount };
}

async function flushBatch(client, rows) {
    if (rows.length === 0) return;
    const values = [];
    const params = [];
    rows.forEach((row, i) => {
        const base = i * 4;
        values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
        params.push(row.zip, row.lat, row.lng, row.geometry);
    });
    await client.query(
        `INSERT INTO zip_boundaries (zip_code, center_lat, center_lng, geometry)
         VALUES ${values.join(', ')}
         ON CONFLICT (zip_code) DO UPDATE SET
             center_lat = EXCLUDED.center_lat,
             center_lng = EXCLUDED.center_lng,
             geometry   = EXCLUDED.geometry,
             updated_at = CURRENT_TIMESTAMP`,
        params
    );
}

async function main() {
    const { min, max, batch } = parseArgs(process.argv);
    const startTime = Date.now();

    const client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });
    await client.connect();
    await client.query(ZIP_BOUNDARIES_DDL);

    const shpPath = path.join(__dirname, '..', 'MapZipCodes', 'tl_2020_us_zcta520', 'tl_2020_us_zcta520.shp');
    console.log('Parsing shapefile:', shpPath);
    console.log(`Seeding ZCTAs in range [${min}, ${max}], batch size ${batch}`);

    const source = await shapefile.open(shpPath);
    let result = await source.read();
    let scanned = 0;
    let kept = 0;
    let pending = [];

    while (!result.done) {
        scanned++;
        const feature = result.value;
        const zipCode = feature.properties && feature.properties.ZCTA5CE20;
        const zipNum = Number(zipCode);
        if (zipCode && Number.isInteger(zipNum) && zipNum >= min && zipNum <= max) {
            const center = centerOf(feature.geometry);
            if (center) {
                pending.push({
                    zip: zipCode,
                    lat: center.lat,
                    lng: center.lng,
                    geometry: JSON.stringify(feature.geometry),
                });
                kept++;
                if (pending.length >= batch) {
                    await flushBatch(client, pending);
                    pending = [];
                }
            }
        }
        result = await source.read();
    }
    await flushBatch(client, pending);

    const count = await client.query('SELECT COUNT(*) as count FROM zip_boundaries');
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Scanned ${scanned} nationwide ZCTAs, upserted ${kept} in range [${min}, ${max}] in ${elapsed}s`);
    console.log(`zip_boundaries now holds ${count.rows[0].count} rows total`);

    await client.end();
}

main().catch(err => {
    console.error('Seed failed:', err);
    process.exit(1);
});
