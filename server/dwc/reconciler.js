// Thin orchestration glue between the scraper and the DB. The actual
// mutations live on DatabaseService (db.reconcileDoctorLocations etc.),
// matching this codebase's convention that service code calls db.* methods
// rather than issuing raw SQL itself.
const scraper = require('./scraper');
const httpClient = require('./httpClient');
const config = require('./config');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Checks a single doctor: scrape, record the check result, then reconcile.
//
// IMPORTANT distinction (easy to conflate "no rows" with "failed"):
// - 'no_results' / 'too_many_results' are legitimate DWC responses — they
//   still reconcile, deactivating all previously-active locations, because
//   DWC is authoritatively saying "no registered locations now".
// - Only 'error' (network failure, non-200, unparseable response) skips
//   reconciliation entirely — existing rows must NOT be touched when the
//   lookup itself failed.
async function checkDoctor(db, doctor, syncRunId) {
    const startedAt = Date.now();
    const scrapeResult = await scraper.scrapeDoctor(doctor);
    const durationMs = Date.now() - startedAt;

    const checkResult = await db.recordDoctorCheckResult(syncRunId, doctor.id, {
        status: scrapeResult.status,
        locationCount: scrapeResult.records.length,
        errorDetail: scrapeResult.errorDetail || null,
        durationMs
    });

    if (scrapeResult.status === 'error') {
        await db.recordDoctorCheckError(doctor.id, scrapeResult.errorDetail || 'Unknown error');
        return { status: 'error', errorDetail: scrapeResult.errorDetail || 'Unknown error', checkResult, reconcileSummary: null };
    }

    const reconcileSummary = await db.reconcileDoctorLocations(doctor.id, syncRunId, scrapeResult);
    return { status: scrapeResult.status, checkResult, reconcileSummary };
}

// Full fire-and-forget sync: warm up once per run, iterate doctors
// sequentially with pacing, reconcile per doctor (one transaction each —
// a mid-run crash never rolls back already-committed doctors), bump run
// counters after each. Never throws — top-level failures mark the run
// 'failed' so a polling client always reaches a terminal status.
async function runSync(db, syncRunId, doctors) {
    let processed = 0;
    let success = 0;
    let errors = 0;

    try {
        await httpClient.warmUp();

        for (const doctor of doctors) {
            try {
                const result = await checkDoctor(db, doctor, syncRunId);
                if (result.status === 'error') {
                    errors++;
                } else {
                    success++;
                }
            } catch (err) {
                // Unexpected failure for this doctor (e.g. DB error mid-
                // reconcile) — record it and keep going; one doctor must not
                // abort the rest of the run.
                console.error(`DWC sync: unexpected failure for doctor ${doctor.id}:`, err);
                errors++;
                try {
                    await db.recordDoctorCheckResult(syncRunId, doctor.id, {
                        status: 'error',
                        locationCount: 0,
                        errorDetail: err.message,
                        durationMs: null
                    });
                    await db.recordDoctorCheckError(doctor.id, err.message);
                } catch (recordErr) {
                    console.error('DWC sync: failed to record doctor check error:', recordErr);
                }
            }

            processed++;
            await db.updateSyncRunProgress(syncRunId, {
                processedCount: processed,
                successCount: success,
                errorCount: errors
            });

            await sleep(config.pauseMs);
        }

        await db.finishSyncRun(syncRunId, errors > 0 ? 'completed_with_errors' : 'completed');
    } catch (err) {
        console.error(`DWC sync run ${syncRunId} failed:`, err);
        try {
            await db.finishSyncRun(syncRunId, 'failed', err.message);
        } catch (finishErr) {
            console.error(`DWC sync: failed to mark run ${syncRunId} as failed:`, finishErr);
        }
    }
}

module.exports = { checkDoctor, runSync };
