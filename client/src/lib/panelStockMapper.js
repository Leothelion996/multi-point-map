import { read, utils } from 'xlsx';
import { getSpecialtyName } from './specialtyLabels.js';

const CITY_HEADERS = new Set(['City', 'city', 'Cities', 'cities', 'CITIES', 'CITY']);

// A trailing row-total column, not a specialty — never shown in the
// specialty dropdown even though it's still a valid data column.
const NON_SPECIALTY_HEADERS = new Set(['TOTAL', 'Total', 'total']);

// Parses a single-sheet .xlsx workbook of ZIP-code panel-stock counts into
// { specialties, rows, duplicateZips, blockingErrors }.
//
// - specialties: [{ id, header, name, label }] — id/header are the raw
//   column header text; name comes from specialtyLabels.js (falls back to
//   the header itself); label is "Full Name - HEADER" for the dropdown.
// - rows: [{ zipCode, counts: { [header]: number } }] with duplicate ZIPs
//   already removed.
// - duplicateZips: sorted 5-digit ZIP strings that were found more than once
//   and were excluded entirely (not summed, not first-wins).
// - blockingErrors: string[] describing non-numeric count cells. Non-empty
//   means the upload must NOT be saved — the caller should show these and
//   stop.
//
// Throws only for unrecoverable structural problems (no worksheet, empty
// sheet, missing header row, zero specialty columns) — row-level data
// issues are returned, not thrown, so the caller controls the UX.
export async function mapWorkbookToPanelStock(file) {
    const buffer = await file.arrayBuffer();
    const workbook = read(buffer, { type: 'array' });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
        throw new Error('The spreadsheet has no worksheets.');
    }
    const sheet = workbook.Sheets[sheetName];
    const grid = utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

    if (grid.length < 1) {
        throw new Error('The worksheet is empty.');
    }

    const headerRow = grid[0];
    if (!headerRow || headerRow.length < 2) {
        throw new Error('The header row must include a ZIP Code column and at least one specialty column.');
    }

    const colBRaw = headerRow[1];
    const colBIsCity = typeof colBRaw === 'string' && CITY_HEADERS.has(colBRaw.trim());
    const specialtyStartCol = colBIsCity ? 2 : 1;

    const specialties = [];
    const specialtyByColumn = new Map();
    for (let col = specialtyStartCol; col < headerRow.length; col++) {
        const header = headerRow[col];
        if (header === null || header === undefined || String(header).trim() === '') continue;
        const headerStr = String(header).trim();
        if (NON_SPECIALTY_HEADERS.has(headerStr)) continue;
        const name = getSpecialtyName(headerStr);
        const specialty = {
            id: headerStr,
            header: headerStr,
            name,
            label: `${name} - ${headerStr}`
        };
        specialties.push(specialty);
        specialtyByColumn.set(col, specialty);
    }

    if (specialties.length === 0) {
        throw new Error('No specialty columns found after the ZIP Code (and optional City) column.');
    }

    const blockingErrors = [];
    const parsedRows = [];

    for (let r = 1; r < grid.length; r++) {
        const row = grid[r];
        if (!row || row.every((cell) => cell === null || cell === undefined || cell === '')) {
            continue;
        }

        const rawZip = row[0];
        if (rawZip === null || rawZip === undefined || String(rawZip).trim() === '') {
            continue;
        }

        let zipCode = String(rawZip).trim().replace(/\.0$/, '');
        zipCode = zipCode.padStart(5, '0');
        if (!/^\d{5}$/.test(zipCode)) {
            continue;
        }

        const counts = {};
        for (const [col, specialty] of specialtyByColumn) {
            const raw = row[col];
            if (raw === null || raw === undefined || raw === '') {
                counts[specialty.id] = 0;
                continue;
            }
            const num = typeof raw === 'number' ? raw : Number(String(raw).trim());
            if (!Number.isFinite(num) || !Number.isInteger(num)) {
                blockingErrors.push(`Row ${r + 1}, column "${specialty.header}": "${raw}" is not a whole number.`);
                continue;
            }
            counts[specialty.id] = num;
        }

        parsedRows.push({ zipCode, counts });
    }

    if (blockingErrors.length > 0) {
        return { specialties, rows: [], duplicateZips: [], blockingErrors };
    }

    const zipOccurrences = new Map();
    for (const row of parsedRows) {
        zipOccurrences.set(row.zipCode, (zipOccurrences.get(row.zipCode) || 0) + 1);
    }
    const duplicateZips = [...zipOccurrences.entries()]
        .filter(([, count]) => count > 1)
        .map(([zip]) => zip)
        .sort();

    const rows = parsedRows.filter((row) => !duplicateZips.includes(row.zipCode));

    return { specialties, rows, duplicateZips, blockingErrors: [] };
}
