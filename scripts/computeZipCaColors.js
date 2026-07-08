// One-time build script: computes a map-coloring (graph coloring) assignment
// for California ZCTAs (ZIP range 90001-96162) so that no two geographically
// adjacent ZIP polygons share a color on the Panel Stock Analysis map.
//
// Run manually via `npm run colors:build` (requires MapZipCodes/ shapefile
// present on disk — see .gitignore). Only needs re-running if the underlying
// TIGER/Line shapefile is updated; the output (server/staticData/caZipColors.json)
// is committed to the repo and loaded at server startup, not recomputed
// per-request or per-server-boot.
//
// Pipeline:
//   1. Stream-parse the shapefile, keep only ZCTAs in [90001, 96162].
//   2. Bucket ZCTAs into a spatial grid by bounding box to avoid O(n^2)
//      candidate-pair generation.
//   3. For each candidate pair (bbox overlap), test true adjacency via
//      shared boundary segments (not just shared vertices).
//   4. Run Welsh-Powell greedy graph coloring over the adjacency graph.
//   5. Self-check the result, then write the JSON artifact.

const path = require('path');
const fs = require('fs');
const shapefile = require('shapefile');
const PALETTE = require('../server/staticData/zipColorPalette');

const ZIP_MIN = 90001;
const ZIP_MAX = 96162;
const GRID_CELL_DEGREES = 0.5;
const COORD_PRECISION = 6; // decimal places, ~0.11m at CA latitudes
const TOLERANCE_DEGREES = 1e-5;
const BBOX_EPSILON = 1e-6;

function round(n) {
    return Number(n.toFixed(COORD_PRECISION));
}

function coordKey(lng, lat) {
    return `${round(lng)},${round(lat)}`;
}

function segmentKey(a, b) {
    const ka = coordKey(a[0], a[1]);
    const kb = coordKey(b[0], b[1]);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

// Flatten a Polygon/MultiPolygon geometry into an array of rings, each ring
// an array of [lng, lat] points. Same handling as server.js's center calc
// and usePanelStockMap.js's buildPolygons (outer + inner rings included here
// since shared edges can appear on any ring).
function ringsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === 'Polygon') {
        return geometry.coordinates;
    }
    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.flat();
    }
    return [];
}

function boundingBoxOf(rings) {
    let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const ring of rings) {
        for (const [lng, lat] of ring) {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
        }
    }
    return { minLng, maxLng, minLat, maxLat };
}

function bboxesOverlap(a, b) {
    return (
        a.minLng - BBOX_EPSILON <= b.maxLng &&
        b.minLng - BBOX_EPSILON <= a.maxLng &&
        a.minLat - BBOX_EPSILON <= b.maxLat &&
        b.minLat - BBOX_EPSILON <= a.maxLat
    );
}

// Build the segment set for a ZCTA: keys of every consecutive-vertex edge
// across all its rings, order-independent.
function segmentSetOf(rings) {
    const segments = new Set();
    for (const ring of rings) {
        for (let i = 0; i < ring.length - 1; i++) {
            segments.add(segmentKey(ring[i], ring[i + 1]));
        }
    }
    return segments;
}

function pointDistance(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// Tolerance pass: check whether any endpoint of any segment in A is within
// TOLERANCE_DEGREES of any endpoint of any segment in B, AND the matching
// continues for the paired neighbor (i.e. an actual near-duplicate edge, not
// a coincidental nearby vertex). Only invoked when the exact segment-key
// intersection finds nothing, and only compares points that fall in the same
// or adjacent rounded coordinate bucket to keep this cheap.
function hasToleranceMatch(ringsA, ringsB) {
    const bucketOf = (lng, lat) => `${Math.round(lng / TOLERANCE_DEGREES)},${Math.round(lat / TOLERANCE_DEGREES)}`;
    const bBuckets = new Map(); // bucket -> [[lng,lat], ...]
    for (const ring of ringsB) {
        for (const pt of ring) {
            const key = bucketOf(pt[0], pt[1]);
            if (!bBuckets.has(key)) bBuckets.set(key, []);
            bBuckets.get(key).push(pt);
        }
    }

    const neighborBucketOffsets = [-1, 0, 1];

    for (const ring of ringsA) {
        for (let i = 0; i < ring.length - 1; i++) {
            const a0 = ring[i];
            const a1 = ring[i + 1];
            const baseLngCell = Math.round(a0[0] / TOLERANCE_DEGREES);
            const baseLatCell = Math.round(a0[1] / TOLERANCE_DEGREES);
            for (const dLng of neighborBucketOffsets) {
                for (const dLat of neighborBucketOffsets) {
                    const bucket = bBuckets.get(`${baseLngCell + dLng},${baseLatCell + dLat}`);
                    if (!bucket) continue;
                    for (const bPt of bucket) {
                        if (pointDistance(a0, bPt) < TOLERANCE_DEGREES) {
                            // a0 matches bPt approximately; check if a1 also
                            // approximately matches an adjacent vertex on B's
                            // ring containing bPt, confirming a shared edge
                            // rather than a coincidental single point.
                            if (segmentHasNearEndpoint(ringsB, bPt, a1)) {
                                return true;
                            }
                        }
                    }
                }
            }
        }
    }
    return false;
}

function segmentHasNearEndpoint(ringsB, anchorPt, targetPt) {
    for (const ring of ringsB) {
        for (let i = 0; i < ring.length; i++) {
            if (pointDistance(ring[i], anchorPt) < TOLERANCE_DEGREES) {
                const prev = ring[i - 1];
                const next = ring[i + 1];
                if (prev && pointDistance(prev, targetPt) < TOLERANCE_DEGREES) return true;
                if (next && pointDistance(next, targetPt) < TOLERANCE_DEGREES) return true;
            }
        }
    }
    return false;
}

function areAdjacent(zctaA, zctaB) {
    const exactA = zctaA.segments;
    const exactB = zctaB.segments;
    for (const seg of exactA) {
        if (exactB.has(seg)) return true;
    }
    return hasToleranceMatch(zctaA.rings, zctaB.rings);
}

async function loadCaZctas() {
    const shpPath = path.join(__dirname, '..', 'MapZipCodes', 'tl_2020_us_zcta520', 'tl_2020_us_zcta520.shp');
    console.log('Parsing shapefile:', shpPath);

    const zctas = new Map(); // zip -> { rings, bbox, segments }
    const source = await shapefile.open(shpPath);
    let result = await source.read();
    let scanned = 0;

    while (!result.done) {
        scanned++;
        const feature = result.value;
        const zipCode = feature.properties && feature.properties.ZCTA5CE20;
        const zipNum = Number(zipCode);
        if (zipCode && Number.isInteger(zipNum) && zipNum >= ZIP_MIN && zipNum <= ZIP_MAX) {
            const rings = ringsOf(feature.geometry);
            if (rings.length > 0) {
                zctas.set(zipCode, {
                    zip: zipCode,
                    rings,
                    bbox: boundingBoxOf(rings),
                    segments: segmentSetOf(rings)
                });
            }
        }
        result = await source.read();
    }

    console.log(`Scanned ${scanned} nationwide ZCTAs, kept ${zctas.size} in range [${ZIP_MIN}, ${ZIP_MAX}]`);
    return zctas;
}

function buildSpatialGrid(zctas) {
    const grid = new Map(); // "row,col" -> Set<zip>
    const cellOf = (lng, lat) => `${Math.floor(lng / GRID_CELL_DEGREES)},${Math.floor(lat / GRID_CELL_DEGREES)}`;

    for (const zcta of zctas.values()) {
        const { minLng, maxLng, minLat, maxLat } = zcta.bbox;
        const colMin = Math.floor(minLng / GRID_CELL_DEGREES);
        const colMax = Math.floor(maxLng / GRID_CELL_DEGREES);
        const rowMin = Math.floor(minLat / GRID_CELL_DEGREES);
        const rowMax = Math.floor(maxLat / GRID_CELL_DEGREES);
        for (let col = colMin; col <= colMax; col++) {
            for (let row = rowMin; row <= rowMax; row++) {
                const key = `${row},${col}`;
                if (!grid.has(key)) grid.set(key, new Set());
                grid.get(key).add(zcta.zip);
            }
        }
    }
    return grid;
}

function buildCandidatePairs(zctas, grid) {
    const candidates = new Set(); // "zipA|zipB" with zipA < zipB
    for (const bucket of grid.values()) {
        const zips = Array.from(bucket);
        for (let i = 0; i < zips.length; i++) {
            for (let j = i + 1; j < zips.length; j++) {
                const [a, b] = zips[i] < zips[j] ? [zips[i], zips[j]] : [zips[j], zips[i]];
                candidates.add(`${a}|${b}`);
            }
        }
    }
    return candidates;
}

function buildAdjacencyGraph(zctas) {
    const grid = buildSpatialGrid(zctas);
    const candidates = buildCandidatePairs(zctas, grid);
    console.log(`Grid produced ${candidates.size} candidate pairs from ${zctas.size} ZCTAs (bucketed, not O(n^2))`);

    const adjacency = new Map();
    for (const zip of zctas.keys()) adjacency.set(zip, new Set());

    let bboxRejected = 0;
    let confirmedEdges = 0;

    for (const pairKey of candidates) {
        const [zipA, zipB] = pairKey.split('|');
        const a = zctas.get(zipA);
        const b = zctas.get(zipB);

        if (!bboxesOverlap(a.bbox, b.bbox)) {
            bboxRejected++;
            continue;
        }

        if (areAdjacent(a, b)) {
            adjacency.get(zipA).add(zipB);
            adjacency.get(zipB).add(zipA);
            confirmedEdges++;
        }
    }

    console.log(`Bbox pre-filter rejected ${bboxRejected} candidates; confirmed ${confirmedEdges} adjacency edges`);
    return adjacency;
}

// Welsh-Powell greedy coloring: sort nodes by degree descending, assign the
// lowest color index not used by any already-colored neighbor.
function colorGraph(adjacency) {
    const nodes = Array.from(adjacency.keys()).sort(
        (a, b) => adjacency.get(b).size - adjacency.get(a).size
    );

    const colorOf = new Map();
    for (const node of nodes) {
        const usedByNeighbors = new Set();
        for (const neighbor of adjacency.get(node)) {
            if (colorOf.has(neighbor)) usedByNeighbors.add(colorOf.get(neighbor));
        }
        let color = 0;
        while (usedByNeighbors.has(color)) color++;
        colorOf.set(node, color);
    }

    return colorOf;
}

function selfCheck(adjacency, colorOf) {
    const violations = [];
    for (const [zip, neighbors] of adjacency) {
        for (const neighbor of neighbors) {
            if (colorOf.get(zip) === colorOf.get(neighbor)) {
                violations.push([zip, neighbor, colorOf.get(zip)]);
            }
        }
    }

    const colorCount = new Set(colorOf.values()).size;
    const maxColorIndex = Math.max(...Array.from(colorOf.values()));

    return { violations, colorCount, maxColorIndex };
}

function graphStats(adjacency) {
    const degrees = Array.from(adjacency.values()).map((s) => s.size);
    const totalEdges = degrees.reduce((sum, d) => sum + d, 0) / 2;
    const isolated = degrees.filter((d) => d === 0).length;
    const avgDegree = degrees.length > 0 ? (degrees.reduce((s, d) => s + d, 0) / degrees.length) : 0;
    return {
        nodes: adjacency.size,
        edges: totalEdges,
        avgDegree: Number(avgDegree.toFixed(2)),
        maxDegree: degrees.length > 0 ? Math.max(...degrees) : 0,
        isolatedNodes: isolated
    };
}

async function main() {
    const startTime = Date.now();

    const zctas = await loadCaZctas();
    if (zctas.size === 0) {
        console.error('No CA ZCTAs found in shapefile — aborting.');
        process.exit(1);
    }

    const adjacency = buildAdjacencyGraph(zctas);
    const stats = graphStats(adjacency);
    console.log('Adjacency graph stats:', stats);

    const colorOf = colorGraph(adjacency);
    const { violations, colorCount, maxColorIndex } = selfCheck(adjacency, colorOf);

    if (violations.length > 0) {
        console.error(`Self-check FAILED: ${violations.length} adjacent pairs share a color.`);
        console.error(violations.slice(0, 10));
        process.exit(1);
    }

    if (colorCount > PALETTE.length) {
        console.error(
            `Self-check FAILED: coloring used ${colorCount} colors but the palette only has ${PALETTE.length} entries. ` +
            `Add more colors to server/staticData/zipColorPalette.js rather than allowing a silent modulo wraparound.`
        );
        process.exit(1);
    }

    console.log(`Self-check passed: 0 violations, ${colorCount} distinct colors used (max index ${maxColorIndex}), palette has ${PALETTE.length} entries.`);

    const colors = {};
    for (const zip of Array.from(colorOf.keys()).sort()) {
        colors[zip] = PALETTE[colorOf.get(zip)];
    }

    const output = {
        generatedAt: new Date().toISOString(),
        zipRange: [ZIP_MIN, ZIP_MAX],
        colorCount,
        palette: PALETTE,
        colors
    };

    const outPath = path.join(__dirname, '..', 'server', 'staticData', 'caZipColors.json');
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Wrote ${outPath} (${Object.keys(colors).length} ZIPs) in ${elapsed}s total.`);
}

main().catch((error) => {
    console.error('computeZipCaColors failed:', error);
    process.exit(1);
});
