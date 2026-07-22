// PME classification by phone number — the legacy rule ("04. Not Our
// Locations Remover.gs.txt") kept rows whose phone matched CONFIG.targetPhone
// exactly. Here it's a classification, not a deletion: straight digits-only
// equality against PME's number, not fuzzy matching.
const config = require('./config');

function classify(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return 'needs_review';
    return digits === config.pmePhone ? 'pme' : 'not_pme';
}

module.exports = { classify };
