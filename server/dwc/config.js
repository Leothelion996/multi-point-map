// Central configuration for the DWC QME scraper — mirrors the legacy Apps
// Script CONFIG object ("Remove after implementation verified/Dr. Location
// Aggregator/00. Config.gs.txt"). These are mostly fixed facts about the DWC
// site and PME's own phone number, not per-deploy secrets, so a constants
// module fits better than scattering process.env.DWC_* reads.
module.exports = {
    dwcStartUrl: 'https://www.dir.ca.gov/databases/dwc/qmestartnew.asp',
    dwcResultsUrl: 'https://www.dir.ca.gov/databases/dwc/qmeCRIT.asp',
    pauseMs: parseInt(process.env.DWC_PAUSE_MS, 10) || 350,
    pmePhone: '8003108707', // normalized digits-only (legacy targetPhone '800-310-8707')
    allowedCredentials: new Set([
        'MD', 'DO', 'DC', 'DDS', 'DMD', 'DPM', 'OD', 'PSYD', 'PHD',
        'NP', 'PA', 'RN', 'LAC', 'LMFT', 'LCSW', 'PT', 'OT'
    ])
};
