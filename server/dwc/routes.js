// DWC feature routes — a deliberate, size-justified exception to the
// "everything inline in server.js" convention (15+ endpoints across doctors,
// locations, sync-runs, and user management would push server.js well past
// 1100 lines). Mounted once from server.js defineRoutes() via
// registerDwcRoutes(app, db, requireAuth, requireRole).
const { body, param, query, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const reconciler = require('./reconciler');
const httpClient = require('./httpClient');

const ALLOWED_ROLES = ['admin', 'staff', 'viewer'];
const ALLOWED_CLASSIFICATIONS = ['pme', 'not_pme', 'needs_review'];

// Same validation error handler shape server.js uses inline.
const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array()
        });
    }
    next();
};

function registerDwcRoutes(app, db, requireAuth, requireRole) {
    app.use('/api/dwc', requireAuth);

    // In-process lock for the fire-and-forget full-roster sync — a single
    // boolean-ish flag (the active run id), not DB-level locking. Sufficient
    // for a single Node process with no horizontal scaling; a server restart
    // clears it (any orphaned 'running' row is a stale artifact, not a lock).
    let activeSyncRunId = null;

    // Dedicated stricter limiter for run triggers, layered on top of the
    // global /api/ limiter, so a user can't spam-trigger scrapes against the
    // DWC site.
    const syncLimiter = rateLimit({
        windowMs: 60 * 60 * 1000, // 1 hour
        max: 5,
        message: 'Too many sync triggers, please try again later.',
        standardHeaders: true,
        legacyHeaders: false
    });

    // Creates the run row and kicks off the background loop without awaiting
    // it. Returns the created run. Caller must have checked the lock.
    async function startBackgroundRun(triggeredBy, doctors) {
        const run = await db.createSyncRun({ triggeredBy, doctorCount: doctors.length });
        activeSyncRunId = run.id;
        // Fire-and-forget: runSync never throws (it marks the run 'failed'
        // internally); .finally releases the in-process lock either way.
        reconciler.runSync(db, run.id, doctors).finally(() => {
            if (activeSyncRunId === run.id) {
                activeSyncRunId = null;
            }
        });
        return run;
    }

    // ================================
    // Sync runs
    // ================================

    app.post('/api/dwc/sync-runs', syncLimiter, requireRole('admin', 'staff'), async (req, res) => {
        try {
            if (activeSyncRunId) {
                return res.status(409).json({ error: 'A sync run is already in progress', runId: activeSyncRunId });
            }
            const doctors = await db.getActiveDoctors();
            if (doctors.length === 0) {
                return res.status(400).json({ error: 'No active doctors to sync' });
            }
            const run = await startBackgroundRun(req.deviceId, doctors);
            res.status(202).json({ id: run.id, status: 'running', doctorCount: run.doctorCount });
        } catch (error) {
            console.error('Error triggering sync run:', error);
            res.status(500).json({ error: 'Failed to trigger sync run' });
        }
    });

    app.get('/api/dwc/sync-runs', [
        query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const runs = await db.getSyncRuns(req.query.limit || 20);
            res.json(runs);
        } catch (error) {
            console.error('Error fetching sync runs:', error);
            res.status(500).json({ error: 'Failed to fetch sync runs' });
        }
    });

    app.get('/api/dwc/sync-runs/:id', [
        param('id').isUUID().withMessage('Invalid sync run ID'),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const run = await db.getSyncRun(req.params.id);
            if (!run) {
                return res.status(404).json({ error: 'Sync run not found' });
            }
            res.json(run);
        } catch (error) {
            console.error('Error fetching sync run:', error);
            res.status(500).json({ error: 'Failed to fetch sync run' });
        }
    });

    app.get('/api/dwc/sync-runs/:id/results', [
        param('id').isUUID().withMessage('Invalid sync run ID'),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const run = await db.getSyncRun(req.params.id);
            if (!run) {
                return res.status(404).json({ error: 'Sync run not found' });
            }
            const results = await db.getSyncRunResults(req.params.id);
            res.json(results);
        } catch (error) {
            console.error('Error fetching sync run results:', error);
            res.status(500).json({ error: 'Failed to fetch sync run results' });
        }
    });

    // Retry-failed is its own NEW run scoped to just the failed doctors —
    // never a mutation of the old run, which keeps the audit trail honest.
    app.post('/api/dwc/sync-runs/:id/retry-failed', syncLimiter, requireRole('admin', 'staff'), [
        param('id').isUUID().withMessage('Invalid sync run ID'),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const sourceRun = await db.getSyncRun(req.params.id);
            if (!sourceRun) {
                return res.status(404).json({ error: 'Sync run not found' });
            }
            if (activeSyncRunId) {
                return res.status(409).json({ error: 'A sync run is already in progress', runId: activeSyncRunId });
            }
            const failedIds = await db.getFailedDoctorIdsForRun(req.params.id);
            if (failedIds.length === 0) {
                return res.status(400).json({ error: 'No failed doctors to retry for this run' });
            }
            const doctors = await db.getDoctorsByIds(failedIds);
            const run = await startBackgroundRun(req.deviceId, doctors);
            res.status(202).json({ id: run.id, status: 'running', doctorCount: run.doctorCount });
        } catch (error) {
            console.error('Error retrying failed doctors:', error);
            res.status(500).json({ error: 'Failed to retry failed doctors' });
        }
    });

    // Single-doctor on-demand check — fast enough (~350ms + one fetch) to
    // run synchronously; still tracked as a dwc_sync_run with doctor_count=1.
    app.post('/api/dwc/doctors/:id/check', requireRole('admin', 'staff'), [
        param('id').isUUID().withMessage('Invalid doctor ID'),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const doctor = await db.getDoctor(req.params.id);
            if (!doctor) {
                return res.status(404).json({ error: 'Doctor not found' });
            }
            const run = await db.createSyncRun({ triggeredBy: req.deviceId, doctorCount: 1 });
            let result;
            try {
                await httpClient.warmUp();
                result = await reconciler.checkDoctor(db, doctor, run.id);
            } catch (err) {
                await db.finishSyncRun(run.id, 'failed', err.message);
                throw err;
            }
            const isError = result.status === 'error';
            await db.updateSyncRunProgress(run.id, {
                processedCount: 1,
                successCount: isError ? 0 : 1,
                errorCount: isError ? 1 : 0
            });
            await db.finishSyncRun(run.id, isError ? 'completed_with_errors' : 'completed');
            const finishedRun = await db.getSyncRun(run.id);
            res.json({ run: finishedRun, checkResult: result.checkResult, reconcileSummary: result.reconcileSummary });
        } catch (error) {
            console.error('Error checking doctor:', error);
            res.status(500).json({ error: 'Failed to check doctor' });
        }
    });

    // ================================
    // Doctors
    // ================================

    app.get('/api/dwc/doctors', [
        query('includeInactive').optional().isBoolean().toBoolean(),
        query('withCounts').optional().isBoolean().toBoolean(),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const doctors = await db.getDoctors({
                includeInactive: req.query.includeInactive === true,
                withCounts: req.query.withCounts !== false // default true
            });
            res.json(doctors);
        } catch (error) {
            console.error('Error fetching doctors:', error);
            res.status(500).json({ error: 'Failed to fetch doctors' });
        }
    });

    app.get('/api/dwc/doctors/:id', [
        param('id').isUUID().withMessage('Invalid doctor ID'),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const doctor = await db.getDoctor(req.params.id);
            if (!doctor) {
                return res.status(404).json({ error: 'Doctor not found' });
            }
            res.json(doctor);
        } catch (error) {
            console.error('Error fetching doctor:', error);
            res.status(500).json({ error: 'Failed to fetch doctor' });
        }
    });

    app.post('/api/dwc/doctors', requireRole('admin', 'staff'), [
        body('firstName').isString().trim().isLength({ min: 1, max: 100 }).escape()
            .withMessage('First name must be between 1-100 characters'),
        body('lastName').isString().trim().isLength({ min: 1, max: 100 }).escape()
            .withMessage('Last name must be between 1-100 characters'),
        body('displayName').optional().isString().trim().isLength({ max: 200 }).escape(),
        body('specialtyHint').optional().isString().trim().isLength({ max: 200 }).escape(),
        body('notes').optional().isString().trim().isLength({ max: 2000 }).escape(),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const { firstName, lastName, displayName, specialtyHint, notes } = req.body;
            const doctor = await db.createDoctor({
                firstName, lastName, displayName, specialtyHint, notes,
                createdBy: req.deviceId
            });
            res.status(201).json(doctor);
        } catch (error) {
            console.error('Error creating doctor:', error);
            res.status(500).json({ error: 'Failed to create doctor' });
        }
    });

    app.put('/api/dwc/doctors/:id', requireRole('admin', 'staff'), [
        param('id').isUUID().withMessage('Invalid doctor ID'),
        body('firstName').optional().isString().trim().isLength({ min: 1, max: 100 }).escape(),
        body('lastName').optional().isString().trim().isLength({ min: 1, max: 100 }).escape(),
        body('displayName').optional({ nullable: true }).isString().trim().isLength({ max: 200 }).escape(),
        body('specialtyHint').optional({ nullable: true }).isString().trim().isLength({ max: 200 }).escape(),
        body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }).escape(),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const updates = {};
            for (const field of ['firstName', 'lastName', 'displayName', 'specialtyHint', 'notes']) {
                if (req.body[field] !== undefined) updates[field] = req.body[field];
            }
            const doctor = await db.updateDoctor(req.params.id, updates);
            res.json(doctor);
        } catch (error) {
            console.error('Error updating doctor:', error);
            if (error.message.includes('not found')) {
                res.status(404).json({ error: 'Doctor not found' });
            } else {
                res.status(500).json({ error: 'Failed to update doctor' });
            }
        }
    });

    // The primary "remove a doctor" path (soft, preserves history).
    app.patch('/api/dwc/doctors/:id/active', requireRole('admin', 'staff'), [
        param('id').isUUID().withMessage('Invalid doctor ID'),
        body('isActive').isBoolean().withMessage('isActive must be a boolean'),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const doctor = await db.setDoctorActive(req.params.id, req.body.isActive);
            res.json(doctor);
        } catch (error) {
            console.error('Error updating doctor active state:', error);
            if (error.message.includes('not found')) {
                res.status(404).json({ error: 'Doctor not found' });
            } else {
                res.status(500).json({ error: 'Failed to update doctor' });
            }
        }
    });

    app.delete('/api/dwc/doctors/:id', requireRole('admin'), [
        param('id').isUUID().withMessage('Invalid doctor ID'),
        handleValidationErrors
    ], async (req, res) => {
        try {
            await db.deleteDoctor(req.params.id);
            res.status(204).send();
        } catch (error) {
            console.error('Error deleting doctor:', error);
            if (error.message.includes('not found')) {
                res.status(404).json({ error: 'Doctor not found' });
            } else {
                res.status(500).json({ error: 'Failed to delete doctor' });
            }
        }
    });

    // ================================
    // DWC locations (per doctor)
    // ================================

    app.get('/api/dwc/doctors/:id/locations', [
        param('id').isUUID().withMessage('Invalid doctor ID'),
        query('includeInactive').optional().isBoolean().toBoolean(),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const doctor = await db.getDoctor(req.params.id);
            if (!doctor) {
                return res.status(404).json({ error: 'Doctor not found' });
            }
            const locations = await db.getDoctorLocations(req.params.id, {
                includeInactive: req.query.includeInactive === true
            });
            res.json(locations);
        } catch (error) {
            console.error('Error fetching doctor locations:', error);
            res.status(500).json({ error: 'Failed to fetch doctor locations' });
        }
    });

    // Geocode patch stays open to ANY authenticated role — it's a
    // system-assist write triggered just by viewing the page (the client
    // runs the geocode pass), not a content edit. Restricting it to
    // Staff/Admin would leave a Viewer-only session with permanently
    // ungeocoded pins nobody present can fix.
    app.patch('/api/dwc/locations/:id/geocode', [
        param('id').isUUID().withMessage('Invalid location ID'),
        body('lat').optional().isFloat({ min: -90, max: 90 }).withMessage('Latitude must be between -90 and 90'),
        body('lng').optional().isFloat({ min: -180, max: 180 }).withMessage('Longitude must be between -180 and 180'),
        body('status').optional().isIn(['failed']).withMessage('status may only be "failed"'),
        body('error').optional().isString().trim().isLength({ max: 500 }),
        // formattedAddress is accepted from the client geocode pass but not
        // persisted (no column for it this phase).
        body('formattedAddress').optional().isString(),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const { lat, lng, status, error } = req.body;
            if (status !== 'failed' && (lat === undefined || lng === undefined)) {
                return res.status(400).json({ error: 'Either lat/lng or status:"failed" is required' });
            }
            await db.updateLocationGeocode(req.params.id, {
                lat: lat !== undefined ? parseFloat(lat) : undefined,
                lng: lng !== undefined ? parseFloat(lng) : undefined,
                status,
                error
            });
            res.json({ success: true });
        } catch (error) {
            console.error('Error updating location geocode:', error);
            if (error.message.includes('not found')) {
                res.status(404).json({ error: 'Location not found' });
            } else {
                res.status(500).json({ error: 'Failed to update location geocode' });
            }
        }
    });

    app.patch('/api/dwc/locations/:id/classification', requireRole('admin', 'staff'), [
        param('id').isUUID().withMessage('Invalid location ID'),
        body('classification').isIn(ALLOWED_CLASSIFICATIONS)
            .withMessage(`Classification must be one of: ${ALLOWED_CLASSIFICATIONS.join(', ')}`),
        handleValidationErrors
    ], async (req, res) => {
        try {
            await db.updateLocationClassification(req.params.id, req.body.classification, req.deviceId);
            res.json({ success: true });
        } catch (error) {
            console.error('Error updating location classification:', error);
            if (error.message.includes('not found')) {
                res.status(404).json({ error: 'Location not found' });
            } else {
                res.status(500).json({ error: 'Failed to update location classification' });
            }
        }
    });

    app.delete('/api/dwc/locations/:id/classification-override', requireRole('admin', 'staff'), [
        param('id').isUUID().withMessage('Invalid location ID'),
        handleValidationErrors
    ], async (req, res) => {
        try {
            await db.clearLocationClassificationOverride(req.params.id);
            res.json({ success: true });
        } catch (error) {
            console.error('Error clearing classification override:', error);
            if (error.message.includes('not found')) {
                res.status(404).json({ error: 'Location not found' });
            } else {
                res.status(500).json({ error: 'Failed to clear classification override' });
            }
        }
    });

    // ================================
    // User/role management (Admin only)
    // ================================

    app.get('/api/dwc/users', requireRole('admin'), async (req, res) => {
        try {
            const users = await db.getUsers();
            res.json(users);
        } catch (error) {
            console.error('Error fetching users:', error);
            res.status(500).json({ error: 'Failed to fetch users' });
        }
    });

    // Admin-created accounts — the public /api/auth/register bootstrap path
    // stays closed once any user exists; this is how Admins onboard
    // additional Staff/Viewer accounts. Username/password rules mirror the
    // register handler's validator chains.
    app.post('/api/dwc/users', requireRole('admin'), [
        body('username').isString().trim().isLength({ min: 1, max: 50 }).escape(),
        body('password').isString().isLength({ min: 1 }),
        body('role').isIn(ALLOWED_ROLES).withMessage(`Role must be one of: ${ALLOWED_ROLES.join(', ')}`),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const { username, password, role } = req.body;
            const user = await db.createUser(username, password, role);
            // Same reason as register: groups are keyed by device_id with an
            // FK to devices; auth users reuse their user id as device id.
            await db.registerDevice(user.id);
            res.status(201).json(user);
        } catch (error) {
            if (error.message === 'Username already exists') {
                return res.status(400).json({ error: error.message });
            }
            console.error('Error creating user:', error);
            res.status(500).json({ error: 'Failed to create user' });
        }
    });

    app.put('/api/dwc/users/:id/role', requireRole('admin'), [
        param('id').isUUID().withMessage('Invalid user ID'),
        body('role').isIn(ALLOWED_ROLES).withMessage(`Role must be one of: ${ALLOWED_ROLES.join(', ')}`),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const updated = await db.updateUserRole(req.params.id, req.body.role);
            res.json(updated);
        } catch (error) {
            console.error('Error updating user role:', error);
            if (error.message.includes('not found')) {
                res.status(404).json({ error: 'User not found' });
            } else {
                res.status(500).json({ error: 'Failed to update user role' });
            }
        }
    });
}

module.exports = { registerDwcRoutes };
