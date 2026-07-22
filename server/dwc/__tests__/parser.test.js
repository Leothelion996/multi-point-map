// Fixtures are SYNTHETIC and anonymized — no real scraped names/addresses
// are committed. Their structure faithfully mimics the live DWC results page
// (verified against real responses during implementation, 2026-07):
//   <h1>Qualified Medical Evaluator Database - Returned Records</h1>
//   ... <p>Here are the results of your search (N records): ...</p>
//   <table class="tabborder"><thead><tr><th>Name</th>...</thead><tbody>
//   data rows with 5 tds (Name | Specialty | Address-with-maps-link | Phone
//   | Discipline), &nbsp; entities inside cells, and spaces before commas in
//   addresses.
import { describe, it, expect } from 'vitest';
import parser from '../parser.js';

const { parseDwcResultsHtml } = parser;

function resultsPage(bodyRows) {
    return `
<html><body>
<main id="main">
<h1>Qualified Medical Evaluator Database - Returned Records</h1>
<div>QME Records as of <strong>1/1/2026 6:30:00 AM</strong><br /></div>
<!-- Build the results table -->
<p>Here are the results of your search (${bodyRows.length} records):<br />
<strong> Name: SAMPLE&nbsp;DOCTOR<br /> </strong></p>
<table class="tabborder">
<thead>
<tr> <th>Name</th> <th>Specialty</th> <th>Address (click for map)</th> <th>Phone</th> <th>Discipline</th> </tr>
</thead>
<tbody>
${bodyRows.join('\n')}
</tbody>
</table>
</main>
</body></html>`;
}

function row(name, specialty, address, phone) {
    return `<tr> <td >${name} </td> <td>${specialty} </td> <td><a href = "https://maps.google.com?q=x">${address}</a> </td> <td>${phone} </td> <td class="contentlink"> &nbsp; </td> </tr>`;
}

const TWO_LOCATION_FIXTURE = resultsPage([
    row('JANE&nbsp;Q&nbsp;SAMPLE&nbsp;,&nbsp;DC, L.Ac.', 'Acupuncturist', '100 EXAMPLE ST STE 200 , SAMPLETOWN , CA &nbsp; 90001', '800-555-0100'),
    row('JANE&nbsp;Q&nbsp;SAMPLE&nbsp;,&nbsp;DC, L.Ac.', 'Chiropractic', '100 EXAMPLE ST STE 200 , SAMPLETOWN , CA &nbsp; 90001', '800-555-0100'),
    row('JANE&nbsp;Q&nbsp;SAMPLE&nbsp;,&nbsp;DC, L.Ac.', 'Acupuncturist', '42 FICTIONAL AVE STE B , TESTVILLE , CA &nbsp; 90002', '(800) 555-0101 ext'),
]);

const NO_RESULTS_FIXTURE = `
<html><body>
<main id="main">
<h1>Qualified Medical Evaluator Database - Returned Records</h1>
<div>QME Records as of <strong>1/1/2026 6:30:00 AM</strong><br /></div>
<!-- Build the results table -->
<p>No records match the criteria you have entered. Please press the &quot;back&quot; button on your browser and try again </p>
</main>
</body></html>`;

const TOO_MANY_RESULTS_FIXTURE = `
<html><body>
<main id="main">
<h1>Qualified Medical Evaluator Database - Returned Records</h1>
<p>Too many results were returned. Please narrow your search criteria and try again.</p>
</main>
</body></html>`;

const NO_TABLE_FIXTURE = `
<html><body>
<main id="main">
<h1>Some Unrelated Page</h1>
<p>Nothing useful here.</p>
</main>
</body></html>`;

describe('parseDwcResultsHtml', () => {
    it('parses a results table into records, deduping by address (keep first)', () => {
        const result = parseDwcResultsHtml(TWO_LOCATION_FIXTURE);
        expect(result.status).toBe('ok');
        // 3 data rows, but rows 1+2 share an address — dedup keeps the first
        expect(result.records).toHaveLength(2);

        const [first, second] = result.records;
        expect(first.name).toBe('JANE Q SAMPLE , DC, L.Ac.');
        expect(first.specialty).toBe('Acupuncturist'); // first row wins over Chiropractic
        expect(first.address).toBe('100 EXAMPLE ST STE 200, SAMPLETOWN, CA 90001');
        expect(first.phone).toBe('800-555-0100');

        expect(second.address).toBe('42 FICTIONAL AVE STE B, TESTVILLE, CA 90002');
        // non-phone chars stripped, allowed chars kept
        expect(second.phone).toBe('(800) 555-0101');
    });

    it('normalizes spaces before commas and collapses &nbsp; runs in addresses', () => {
        const result = parseDwcResultsHtml(TWO_LOCATION_FIXTURE);
        expect(result.records[0].address).not.toMatch(/\s,/);
        expect(result.records[0].address).not.toMatch(/ /);
    });

    it('excludes header rows (th) from records', () => {
        const result = parseDwcResultsHtml(TWO_LOCATION_FIXTURE);
        expect(result.records.some(r => r.name === 'Name')).toBe(false);
    });

    it('skips rows with fewer than 4 cells and rows with an empty address', () => {
        const html = resultsPage([
            '<tr><td>SHORT ROW</td><td>Only two cells</td></tr>',
            row('JOHN&nbsp;NOADDRESS&nbsp;,&nbsp;MD', 'Orthopedic Surgery', '&nbsp;', '800-555-0102'),
            row('JOHN&nbsp;SAMPLE&nbsp;,&nbsp;MD', 'Orthopedic Surgery', '7 REAL ROW BLVD , DEMO CITY , CA &nbsp; 90003', '800-555-0103'),
        ]);
        const result = parseDwcResultsHtml(html);
        expect(result.status).toBe('ok');
        expect(result.records).toHaveLength(1);
        expect(result.records[0].name).toBe('JOHN SAMPLE , MD');
    });

    it('decodes HTML entities via cheerio', () => {
        const html = resultsPage([
            row('MARY&nbsp;O&#39;SAMPLE&nbsp;,&nbsp;MD', 'Pain Medicine &amp; Rehab', '9 AMPERSAND &amp; CO WAY , DEMO CITY , CA &nbsp; 90004', '800-555-0104'),
        ]);
        const result = parseDwcResultsHtml(html);
        expect(result.records[0].name).toBe("MARY O'SAMPLE , MD");
        expect(result.records[0].specialty).toBe('Pain Medicine & Rehab');
        expect(result.records[0].address).toBe('9 AMPERSAND & CO WAY, DEMO CITY, CA 90004');
    });

    it('returns no_results for a "no records match" page (heading, no table)', () => {
        const result = parseDwcResultsHtml(NO_RESULTS_FIXTURE);
        expect(result.status).toBe('no_results');
        expect(result.records).toEqual([]);
    });

    it('returns too_many_results when no table and the page says so', () => {
        const result = parseDwcResultsHtml(TOO_MANY_RESULTS_FIXTURE);
        expect(result.status).toBe('too_many_results');
        expect(result.records).toEqual([]);
    });

    it('returns no_results for a page with neither table nor too-many text', () => {
        const result = parseDwcResultsHtml(NO_TABLE_FIXTURE);
        expect(result.status).toBe('no_results');
        expect(result.records).toEqual([]);
    });

    it('returns no_results for a table present but with zero data rows', () => {
        const result = parseDwcResultsHtml(resultsPage([]));
        expect(result.status).toBe('no_results');
        expect(result.records).toEqual([]);
    });

    it('falls back to Name+Specialty table detection when no heading matches', () => {
        const html = `
<html><body>
<div>
<table>
<tr><th>Name</th><th>Specialty</th><th>Address</th><th>Phone</th></tr>
${row('ALEX&nbsp;FALLBACK&nbsp;,&nbsp;MD', 'Neurology', '11 FALLBACK LN , DEMO CITY , CA &nbsp; 90005', '800-555-0105')}
</table>
</div>
</body></html>`;
        const result = parseDwcResultsHtml(html);
        expect(result.status).toBe('ok');
        expect(result.records).toHaveLength(1);
        expect(result.records[0].name).toBe('ALEX FALLBACK , MD');
    });
});
