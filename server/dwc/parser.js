// DWC results-page HTML parsing. The legacy Apps Script system used regex
// only because Apps Script has no DOM parser; here the algorithm's *steps*
// are ported onto cheerio (see "Remove after implementation verified/Dr.
// Location Aggregator/00. utilities.gs.txt" extractResultsTable/extractRows/
// splitTds/cleanText and "02. DWC Locations.gs.txt" fetchLocationsForName).
const cheerio = require('cheerio');

function collapseWhitespace(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
}

// Locate the results table:
// 1. A heading (h1-h6) whose text contains "Records", then the next
//    following <table> (checked as a sibling of the heading, then of its
//    parent — covers the heading being wrapped in a container element).
// 2. Fallback: any table whose text contains both "Name" and "Specialty"
//    (mirrors the legacy fallback regex).
// Real DWC markup shape has not been re-verified against a live response in
// this environment; the fallback keeps detection resilient either way.
function findResultsTable($) {
    let table = null;
    $('h1, h2, h3, h4, h5, h6').each((i, el) => {
        if (table) return;
        if (!/records/i.test($(el).text())) return;
        let next = $(el).nextAll('table').first();
        if (!next.length) {
            next = $(el).parent().nextAll('table').first();
        }
        if (next.length) table = next;
    });
    if (table) return table;

    $('table').each((i, el) => {
        if (table) return;
        const text = $(el).text();
        if (/name/i.test(text) && /specialty/i.test(text)) {
            table = $(el);
        }
    });
    return table;
}

// Parses a full DWC results page.
// Returns { status: 'ok'|'no_results'|'too_many_results',
//           records: [{name, specialty, address, phone}] }.
// Network/HTTP failures are NOT this module's concern — the scraper maps
// those to 'error' before parsing is ever attempted.
function parseDwcResultsHtml(html) {
    // Normalize whitespace on the raw HTML first — the "Records" heading
    // detection is text-based in the source markup (legacy did the same
    // normalization before its regexes).
    const norm = String(html || '').replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ');
    const $ = cheerio.load(norm);

    const table = findResultsTable($);
    if (!table) {
        if (/too\s+many\s+results/i.test(norm)) {
            return { status: 'too_many_results', records: [] };
        }
        return { status: 'no_results', records: [] };
    }

    const records = [];
    const seen = new Set(); // dedup within one doctor's fetch, keep first (legacy rule)

    table.find('tr').each((i, tr) => {
        const row = $(tr);
        if (row.find('th').length) return; // header rows excluded

        const cells = row.find('td');
        if (cells.length < 4) return;

        const name = collapseWhitespace(cells.eq(0).text());
        const specialty = collapseWhitespace(cells.eq(1).text());
        // Comma-spacing content normalization is a data concern, not an
        // HTML-parsing concern — kept from the legacy cleanup.
        const address = collapseWhitespace(cells.eq(2).text())
            .replace(/\s+,/g, ',')
            .replace(/\s{2,}/g, ' ')
            .trim();
        const phone = collapseWhitespace(cells.eq(3).text())
            .replace(/[^\d\-().\s+]/g, '')
            .trim();

        if (!address) return;

        const key = address.replace(/\s+/g, ' ').trim().toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);

        records.push({ name, specialty, address, phone });
    });

    if (records.length === 0) {
        // A present-but-empty table means DWC authoritatively returned no
        // registered locations — same reconciliation semantics as no table.
        return { status: 'no_results', records: [] };
    }

    return { status: 'ok', records };
}

module.exports = { parseDwcResultsHtml };
