// Thin wrapper around Node's built-in global fetch (Node 18+, zero new
// dependency) for talking to the DWC QME database site.
const config = require('./config');

// GET the start page once per sync run — the DWC app sometimes needs a
// session/cookie warm-up before qmeCRIT.asp answers. Errors are silently
// swallowed, matching the legacy Apps Script behavior (a failed warm-up is
// not fatal; the per-doctor POST is what matters).
async function warmUp() {
    try {
        await fetch(config.dwcStartUrl, { redirect: 'follow' });
    } catch (err) {
        // Intentionally ignored — warm-up is best-effort.
    }
}

// POST a first/last name search to the results page. Body keys are exactly
// {first, last}, the known-good param names from the legacy harvester.
async function fetchDoctorHtml(first, last) {
    const body = new URLSearchParams({ first, last });
    const response = await fetch(config.dwcResultsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'follow'
    });
    const html = await response.text();
    return { ok: response.ok, status: response.status, html };
}

module.exports = { warmUp, fetchDoctorHtml };
