// Orchestrates one doctor's DWC check: POST via httpClient, parse via
// parser, validate rows via nameMatcher (drop rows that don't belong to the
// doctor — guards against too-broad DWC matches under a common last name),
// split addresses via addressParser, classify via classifier.
//
// This is the only file the reconciler depends on directly — it doesn't
// reach into the sub-modules itself. Warm-up (httpClient.warmUp()) is called
// once per RUN by the caller, not once per doctor here.
const httpClient = require('./httpClient');
const parser = require('./parser');
const nameMatcher = require('./nameMatcher');
const addressParser = require('./addressParser');
const classifier = require('./classifier');

// Returns { status: 'ok'|'no_results'|'too_many_results'|'error',
//           records: [...], errorDetail?: string }.
// Records carry the raw scraped fields ({name, specialty, address, phone})
// plus derived fields (parsedAddress, identityKey, credentials,
// classification) for callers that want them without re-deriving.
async function scrapeDoctor(doctor) {
    let response;
    try {
        response = await httpClient.fetchDoctorHtml(doctor.firstName, doctor.lastName);
    } catch (err) {
        return { status: 'error', records: [], errorDetail: `Network error: ${err.message}` };
    }

    if (!response.ok || !response.html) {
        return { status: 'error', records: [], errorDetail: `HTTP ${response.status}: no HTML or non-200 response` };
    }

    let parsed;
    try {
        parsed = parser.parseDwcResultsHtml(response.html);
    } catch (err) {
        return { status: 'error', records: [], errorDetail: `Parse error: ${err.message}` };
    }

    if (parsed.status !== 'ok') {
        return { status: parsed.status, records: [] };
    }

    const records = parsed.records
        .filter(record => nameMatcher.rowBelongsToDoctor(record.name, doctor))
        .map(record => {
            const parsedAddress = addressParser.parseAddress(record.address);
            return {
                ...record,
                parsedAddress,
                identityKey: addressParser.buildIdentityKey(parsedAddress),
                credentials: nameMatcher.extractCredentials(record.name),
                classification: classifier.classify(record.phone)
            };
        });

    if (records.length === 0) {
        // Every parsed row belonged to somebody else — for THIS doctor, DWC
        // returned nothing, which reconciles the same as no_results.
        return { status: 'no_results', records: [] };
    }

    return { status: 'ok', records };
}

module.exports = { scrapeDoctor };
