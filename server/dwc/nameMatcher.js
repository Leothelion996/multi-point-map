// Name matching + credentials extraction, ported VERBATIM from the legacy
// Apps Script utilities ("Remove after implementation verified/Dr. Location
// Aggregator/00. utilities.gs.txt").
//
// Only the FIRST matching algorithm is ported (normalized last name matches
// exactly AND all first-name tokens appear in order within the DWC name
// part — tolerates middle initials). The legacy second algorithm
// (parseDWCNameToKey diffing keys) is intentionally NOT ported: it existed
// only because the legacy system re-derived doctor identity from scratch
// every run. Here DWC is always queried FOR a known doctors row, so
// rowBelongsToDoctor is a validation guard (catches a too-broad DWC match
// under a common last name), not an identity-derivation step.
const config = require('./config');

function normalizeName(s) {
    return String(s || '').toLowerCase().replace(/[^a-z]/g, '').trim();
}

function normalizeSpaces(s) {
    return String(s || '').replace(/\s{2,}/g, ' ').trim();
}

function tokenizeName(s) {
    return String(s || '')
        .replace(/\./g, ' ')
        .replace(/[^\w\s-]/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(t => t.toUpperCase());
}

function getNamePartBeforeComma(displayName) {
    const s = String(displayName || '');
    const idx = s.indexOf(',');
    return (idx >= 0 ? s.slice(0, idx) : s).trim();
}

function extractLastNameNorm(namePartBeforeComma) {
    const toks = String(namePartBeforeComma || '')
        .replace(/\./g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!toks.length) return '';
    return normalizeName(toks[toks.length - 1]);
}

function containsTokensInOrder(haystackUpper, tokensUpper) {
    if (!tokensUpper.length) return false;
    let pos = 0;
    const h = String(haystackUpper || '');
    for (const t of tokensUpper) {
        const found = h.indexOf(t, pos);
        if (found < 0) return false;
        pos = found + t.length;
    }
    return true;
}

function isCredentialLike(x) {
    const t = String(x || '').replace(/\./g, '').toUpperCase();
    if (config.allowedCredentials.has(t)) return true;
    if (/^[A-Z]{1,4}\-?[A-Z]{0,2}$/.test(t) && t.length <= 6) return true;
    return false;
}

// Extracts credential tokens (e.g. ["MD", "QME"]) from a scraped DWC display
// name like "JANE Q SAMPLE , MD, QME". Deduped case-insensitively, keeping
// the first-seen casing.
function extractCredentials(displayName) {
    const s = String(displayName || '').trim();
    if (!s) return [];
    const idx = s.indexOf(',');
    if (idx < 0) return [];

    const tail = s.slice(idx + 1);
    const rawParts = tail.split(',').map(x => String(x).trim()).filter(Boolean);

    const out = [];
    for (const p of rawParts) {
        const sub = p.split(/\s+/).map(x => x.trim()).filter(Boolean);
        for (const token of sub) {
            if (!token) continue;
            if (isCredentialLike(token)) out.push(token);
        }
    }

    // dedup case-insensitive
    const seen = new Set();
    const dedup = [];
    for (const c of out) {
        const k = c.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        dedup.push(c);
    }
    return dedup;
}

// Match rule (legacy "03. Set Specialties.gs.txt"):
// - DWC last name must match the doctor's last name exactly (normalized)
// - The DWC name part before the comma must contain all first-name tokens
//   in order (loose spacing — tolerates middle initials/names)
//
// Deliberate deviation from the verbatim legacy algorithm: the legacy code
// compared only the FINAL whitespace token of the DWC name against the full
// roster last name, which silently rejects multi-token last names (verified
// against live DWC data: "OSCAR M DEL RIO-MARQUEZ , DC" vs roster last name
// "Del Rio-Marquez" — token "RIO-MARQUEZ" != "delriomarquez", so all of his
// locations would be dropped and wrongly deactivated). Fix: compare the
// trailing N tokens of the DWC name part, where N is the token count of the
// doctor's last name. For single-token last names (the overwhelmingly common
// case) this is byte-for-byte identical to the legacy behavior.
function rowBelongsToDoctor(dwcName, doctor) {
    const namePart = getNamePartBeforeComma(dwcName);
    const namePartNorm = normalizeSpaces(namePart).toUpperCase();
    if (!namePartNorm) return false;

    const doctorLastNorm = normalizeName(doctor.lastName);
    if (!doctorLastNorm) return false;
    const doctorLastTokenCount = String(doctor.lastName || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .length;

    const rowToks = String(namePart)
        .replace(/\./g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!rowToks.length) return false;

    const tailCount = Math.min(doctorLastTokenCount, rowToks.length);
    const rowLastNorm = normalizeName(rowToks.slice(rowToks.length - tailCount).join(' '));
    if (!rowLastNorm || rowLastNorm !== doctorLastNorm) return false;

    const firstTokens = tokenizeName(doctor.firstName);
    return containsTokensInOrder(namePartNorm, firstTokens);
}

module.exports = {
    rowBelongsToDoctor,
    extractCredentials,
    // internals exported for unit tests
    normalizeName,
    normalizeSpaces,
    tokenizeName,
    getNamePartBeforeComma,
    extractLastNameNorm,
    containsTokensInOrder,
    isCredentialLike
};
