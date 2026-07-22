const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

// Pure string/classification helpers for the DWC reconciliation logic —
// no dependency back on this module (see server/dwc/).
const addressParser = require('../server/dwc/addressParser');
const nameMatcher = require('../server/dwc/nameMatcher');
const classifier = require('../server/dwc/classifier');

// Shared with scripts/seedZipBoundaries.js so the schema lives in one place.
// geometry is pre-stringified GeoJSON TEXT: the lookup endpoints return it as
// a string, so TEXT is a pure pass-through (JSONB would re-serialize).
const ZIP_BOUNDARIES_DDL = `CREATE TABLE IF NOT EXISTS zip_boundaries (
    zip_code   TEXT PRIMARY KEY,
    center_lat DOUBLE PRECISION NOT NULL,
    center_lng DOUBLE PRECISION NOT NULL,
    geometry   TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)`;

class DatabaseService {
    constructor() {
        this.pool = null;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            this.pool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
                max: 10,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 2000,
            });

            // Verify connectivity
            const client = await this.pool.connect();
            client.release();

            await this.createTables();
            this.isInitialized = true;
            console.log('Database initialized successfully');
        } catch (error) {
            console.error('Failed to initialize database:', error);
            throw error;
        }
    }

    async createTables() {
        const statements = [
            `CREATE TABLE IF NOT EXISTS devices (
                device_id TEXT PRIMARY KEY,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                last_seen TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )`,
            `CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
            )`,
            // Roles: 'admin' | 'staff' | 'viewer' — enforced at the
            // application layer only, matching the absence of DB-level
            // CHECK/enum constraints elsewhere in this schema.
            `ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'staff'`,
            `CREATE TABLE IF NOT EXISTS location_groups (
                id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                name TEXT NOT NULL,
                group_type TEXT DEFAULT 'locations',
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
            )`,
            `CREATE TABLE IF NOT EXISTS locations (
                id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL,
                lat DOUBLE PRECISION NOT NULL,
                lng DOUBLE PRECISION NOT NULL,
                title TEXT NOT NULL,
                color TEXT DEFAULT '#3B82F6',
                order_index INTEGER DEFAULT 0,
                geometry TEXT,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (group_id) REFERENCES location_groups(id) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS idx_location_groups_device_id ON location_groups(device_id)`,
            `CREATE INDEX IF NOT EXISTS idx_locations_group_id ON locations(group_id)`,
            `CREATE INDEX IF NOT EXISTS idx_locations_order ON locations(group_id, order_index)`,
            `CREATE INDEX IF NOT EXISTS idx_location_groups_type ON location_groups(device_id, group_type)`,
            `CREATE TABLE IF NOT EXISTS panel_stock_uploads (
                id TEXT PRIMARY KEY,
                device_id TEXT NOT NULL,
                title TEXT NOT NULL,
                file_name TEXT NOT NULL,
                specialties JSONB NOT NULL,
                rows JSONB NOT NULL,
                duplicate_zips JSONB DEFAULT '[]'::jsonb,
                created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS idx_panel_stock_uploads_device_id ON panel_stock_uploads(device_id)`,
            `CREATE INDEX IF NOT EXISTS idx_panel_stock_uploads_created_at ON panel_stock_uploads(device_id, created_at DESC)`,
            ZIP_BOUNDARIES_DDL,
            // ================================
            // DWC doctor location tracking
            // ================================
            // FK dependency order: doctors -> dwc_sync_run -> dwc_location ->
            // dwc_location_event (depends on both) -> dwc_doctor_check_result.
            //
            // TODO(retention): dwc_sync_run, dwc_doctor_check_result, and
            // dwc_location_event all accumulate indefinitely with no cleanup
            // logic, by design — permanent history is a core requirement and
            // current scale doesn't warrant pruning. Revisit retention/
            // archival once real usage data (especially once weekly cron
            // lands in a later phase) shows actual row-growth pressure.
            `CREATE TABLE IF NOT EXISTS doctors (
                id                 TEXT PRIMARY KEY,
                first_name         TEXT NOT NULL,
                last_name          TEXT NOT NULL,
                display_name       TEXT,
                specialty_hint     TEXT,
                is_active          BOOLEAN NOT NULL DEFAULT TRUE,
                notes              TEXT,
                created_by         TEXT,
                last_check_status  TEXT,
                last_check_at      TIMESTAMPTZ,
                last_check_error   TEXT,
                last_success_at    TIMESTAMPTZ,
                created_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                updated_at         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
            )`,
            `CREATE INDEX IF NOT EXISTS idx_doctors_active ON doctors(is_active)`,
            `CREATE INDEX IF NOT EXISTS idx_doctors_last_name ON doctors(last_name)`,
            `CREATE TABLE IF NOT EXISTS dwc_sync_run (
                id               TEXT PRIMARY KEY,
                trigger_type     TEXT NOT NULL DEFAULT 'manual',
                triggered_by     TEXT,
                status           TEXT NOT NULL DEFAULT 'running',
                doctor_count     INTEGER NOT NULL DEFAULT 0,
                processed_count  INTEGER NOT NULL DEFAULT 0,
                success_count    INTEGER NOT NULL DEFAULT 0,
                error_count      INTEGER NOT NULL DEFAULT 0,
                started_at       TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                finished_at      TIMESTAMPTZ,
                error_summary    TEXT,
                FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE SET NULL
            )`,
            `CREATE INDEX IF NOT EXISTS idx_dwc_sync_run_started_at ON dwc_sync_run(started_at DESC)`,
            `CREATE INDEX IF NOT EXISTS idx_dwc_sync_run_status ON dwc_sync_run(status)`,
            `CREATE TABLE IF NOT EXISTS dwc_location (
                id                       TEXT PRIMARY KEY,
                doctor_id                TEXT NOT NULL,
                status                   TEXT NOT NULL DEFAULT 'active',
                street                   TEXT NOT NULL,
                city                     TEXT NOT NULL DEFAULT '',
                state                    TEXT NOT NULL DEFAULT '',
                zip_code                 TEXT NOT NULL DEFAULT '',
                identity_key             TEXT NOT NULL,
                raw_address              TEXT NOT NULL,
                phone                    TEXT,
                dwc_display_name         TEXT,
                specialty                TEXT,
                credentials              TEXT,
                classification           TEXT NOT NULL DEFAULT 'needs_review',
                classification_override  BOOLEAN NOT NULL DEFAULT FALSE,
                classification_overridden_by TEXT,
                lat                      DOUBLE PRECISION,
                lng                      DOUBLE PRECISION,
                geocode_status           TEXT NOT NULL DEFAULT 'pending',
                geocode_error            TEXT,
                geocoded_at              TIMESTAMPTZ,
                first_seen_at            TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                last_seen_at             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                deactivated_at           TIMESTAMPTZ,
                created_at               TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at               TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE,
                FOREIGN KEY (classification_overridden_by) REFERENCES users(id) ON DELETE SET NULL
            )`,
            `CREATE INDEX IF NOT EXISTS idx_dwc_location_doctor_id ON dwc_location(doctor_id)`,
            `CREATE INDEX IF NOT EXISTS idx_dwc_location_doctor_status ON dwc_location(doctor_id, status)`,
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_dwc_location_identity ON dwc_location(doctor_id, identity_key)`,
            `CREATE INDEX IF NOT EXISTS idx_dwc_location_geocode_pending ON dwc_location(geocode_status) WHERE geocode_status = 'pending'`,
            // 'refreshed' events fire every run a location is re-seen
            // unchanged — high row volume once a weekly cron lands (later
            // phase). Acceptable now; a possible future optimization is to
            // only log 'refreshed' when a non-identity field actually
            // changed. Do not build that filtering yet.
            `CREATE TABLE IF NOT EXISTS dwc_location_event (
                id             TEXT PRIMARY KEY,
                location_id    TEXT NOT NULL,
                sync_run_id    TEXT NOT NULL,
                doctor_id      TEXT NOT NULL,
                event_type     TEXT NOT NULL,
                snapshot       JSONB,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (location_id) REFERENCES dwc_location(id) ON DELETE CASCADE,
                FOREIGN KEY (sync_run_id) REFERENCES dwc_sync_run(id) ON DELETE CASCADE,
                FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS idx_dwc_location_event_location_id ON dwc_location_event(location_id)`,
            `CREATE INDEX IF NOT EXISTS idx_dwc_location_event_sync_run_id ON dwc_location_event(sync_run_id)`,
            `CREATE INDEX IF NOT EXISTS idx_dwc_location_event_doctor_created ON dwc_location_event(doctor_id, created_at DESC)`,
            `CREATE TABLE IF NOT EXISTS dwc_doctor_check_result (
                id                 TEXT PRIMARY KEY,
                sync_run_id        TEXT NOT NULL,
                doctor_id          TEXT NOT NULL,
                status             TEXT NOT NULL,
                location_count     INTEGER NOT NULL DEFAULT 0,
                error_detail       TEXT,
                duration_ms        INTEGER,
                created_at         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (sync_run_id) REFERENCES dwc_sync_run(id) ON DELETE CASCADE,
                FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
            )`,
            `CREATE INDEX IF NOT EXISTS idx_dwc_doctor_check_result_run_id ON dwc_doctor_check_result(sync_run_id)`,
            `CREATE INDEX IF NOT EXISTS idx_dwc_doctor_check_result_doctor_id ON dwc_doctor_check_result(doctor_id, created_at DESC)`,
        ];

        for (const sql of statements) {
            await this.pool.query(sql);
        }
        console.log('Database tables created successfully');
    }

    async registerDevice(deviceId) {
        const sql = `
            INSERT INTO devices (device_id, created_at, last_seen)
            VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT (device_id) DO UPDATE SET last_seen = CURRENT_TIMESTAMP
        `;
        await this.pool.query(sql, [deviceId]);
        return deviceId;
    }

    async getLocationGroups(deviceId, groupType = 'locations') {
        const sql = `
            SELECT lg.*,
                   COUNT(l.id) as location_count
            FROM location_groups lg
            LEFT JOIN locations l ON lg.id = l.group_id
            WHERE lg.device_id = $1 AND lg.group_type = $2
            GROUP BY lg.id, lg.device_id, lg.name, lg.group_type, lg.created_at, lg.updated_at
            ORDER BY lg.created_at DESC
        `;
        const result = await this.pool.query(sql, [deviceId, groupType]);

        const groupsWithLocations = await Promise.all(
            result.rows.map(async (group) => {
                const locations = await this.getLocationsForGroup(group.id);
                return {
                    id: group.id,
                    name: group.name,
                    locations: locations,
                    createdAt: group.created_at,
                    updatedAt: group.updated_at
                };
            })
        );

        return groupsWithLocations;
    }

    async getLocationGroup(groupId, deviceId, groupType = 'locations') {
        const sql = `
            SELECT * FROM location_groups
            WHERE id = $1 AND device_id = $2 AND group_type = $3
        `;
        const result = await this.pool.query(sql, [groupId, deviceId, groupType]);
        const row = result.rows[0];

        if (!row) return null;

        const locations = await this.getLocationsForGroup(groupId);
        return {
            id: row.id,
            name: row.name,
            locations: locations,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    async createLocationGroup(deviceId, name, locations = [], groupType = 'locations') {
        const groupId = uuidv4();
        const now = new Date().toISOString();

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `INSERT INTO location_groups (id, device_id, name, group_type, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [groupId, deviceId, name, groupType, now, now]
            );

            if (locations.length > 0) {
                await this._insertLocations(client, groupId, locations);
            }

            await client.query('COMMIT');

            return {
                id: groupId,
                name: name,
                locations: locations,
                createdAt: now,
                updatedAt: now
            };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async updateLocationGroup(groupId, deviceId, updates, groupType = 'locations') {
        const now = new Date().toISOString();
        let sql = 'UPDATE location_groups SET updated_at = $1';
        let params = [now];
        let paramIndex = 2;

        if (updates.name !== undefined) {
            sql += `, name = $${paramIndex++}`;
            params.push(updates.name);
        }

        sql += ` WHERE id = $${paramIndex++} AND device_id = $${paramIndex++} AND group_type = $${paramIndex++}`;
        params.push(groupId, deviceId, groupType);

        const result = await this.pool.query(sql, params);

        if (result.rowCount === 0) {
            throw new Error('Location group not found or access denied');
        }

        if (updates.locations !== undefined) {
            await this.replaceLocationsInGroup(groupId, updates.locations);
        }

        return this.getLocationGroup(groupId, deviceId, groupType);
    }

    async deleteLocationGroup(groupId, deviceId, groupType = 'locations') {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            await client.query('DELETE FROM locations WHERE group_id = $1', [groupId]);

            const result = await client.query(
                'DELETE FROM location_groups WHERE id = $1 AND device_id = $2 AND group_type = $3',
                [groupId, deviceId, groupType]
            );

            if (result.rowCount === 0) {
                await client.query('ROLLBACK');
                throw new Error('Location group not found or access denied');
            }

            await client.query('COMMIT');
            return true;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async getLocationsForGroup(groupId) {
        const sql = `
            SELECT * FROM locations
            WHERE group_id = $1
            ORDER BY order_index ASC, created_at ASC
        `;
        const result = await this.pool.query(sql, [groupId]);

        return result.rows.map(row => {
            const location = {
                id: row.id,
                lat: row.lat,
                lng: row.lng,
                title: row.title,
                color: row.color
            };
            if (row.geometry) location.geometry = row.geometry;
            return location;
        });
    }

    async addLocationToGroup(groupId, deviceId, locationData) {
        const ownerCheck = await this.pool.query(
            'SELECT id FROM location_groups WHERE id = $1 AND device_id = $2',
            [groupId, deviceId]
        );
        if (!ownerCheck.rows[0]) {
            throw new Error('Location group not found or access denied');
        }

        const locationId = uuidv4();
        const now = new Date().toISOString();

        const insertSQL = `
            INSERT INTO locations (id, group_id, lat, lng, title, color, geometry, order_index, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7,
                    (SELECT COALESCE(MAX(order_index), 0) + 1 FROM locations WHERE group_id = $8),
                    $9)
        `;
        await this.pool.query(insertSQL, [
            locationId, groupId, locationData.lat, locationData.lng,
            locationData.title, locationData.color || '#3B82F6',
            locationData.geometry || null, groupId, now
        ]);

        await this.pool.query(
            'UPDATE location_groups SET updated_at = $1 WHERE id = $2',
            [now, groupId]
        );

        const result = {
            id: locationId,
            lat: locationData.lat,
            lng: locationData.lng,
            title: locationData.title,
            color: locationData.color || '#3B82F6'
        };
        if (locationData.geometry) result.geometry = locationData.geometry;
        return result;
    }

    // Internal helper — accepts an existing client to participate in a caller's transaction
    async _insertLocations(client, groupId, locations) {
        const results = [];
        for (let index = 0; index < locations.length; index++) {
            const location = locations[index];
            const locationId = uuidv4();
            const now = new Date().toISOString();

            await client.query(
                `INSERT INTO locations (id, group_id, lat, lng, title, color, geometry, order_index, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    locationId, groupId, location.lat, location.lng,
                    location.title, location.color || '#3B82F6',
                    location.geometry || null, index, now
                ]
            );

            const result = {
                id: locationId,
                lat: location.lat,
                lng: location.lng,
                title: location.title,
                color: location.color || '#3B82F6'
            };
            if (location.geometry) result.geometry = location.geometry;
            results.push(result);
        }
        return results;
    }

    async addLocationsToGroup(groupId, locations) {
        if (!locations || locations.length === 0) return [];

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const results = await this._insertLocations(client, groupId, locations);
            await client.query('COMMIT');
            return results;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async replaceLocationsInGroup(groupId, locations) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM locations WHERE group_id = $1', [groupId]);
            const results = await this._insertLocations(client, groupId, locations);
            await client.query('COMMIT');
            return results;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async reorderLocations(groupId, deviceId, locationIds) {
        const ownerCheck = await this.pool.query(
            'SELECT id FROM location_groups WHERE id = $1 AND device_id = $2',
            [groupId, deviceId]
        );
        if (!ownerCheck.rows[0]) {
            throw new Error('Location group not found or access denied');
        }

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            for (let index = 0; index < locationIds.length; index++) {
                await client.query(
                    'UPDATE locations SET order_index = $1 WHERE id = $2 AND group_id = $3',
                    [index, locationIds[index], groupId]
                );
            }

            await client.query(
                'UPDATE location_groups SET updated_at = $1 WHERE id = $2',
                [new Date().toISOString(), groupId]
            );

            await client.query('COMMIT');
            return true;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async deleteLocation(groupId, locationId, deviceId) {
        const ownerCheck = await this.pool.query(
            'SELECT id FROM location_groups WHERE id = $1 AND device_id = $2',
            [groupId, deviceId]
        );
        if (!ownerCheck.rows[0]) {
            throw new Error('Location group not found or access denied');
        }

        const result = await this.pool.query(
            'DELETE FROM locations WHERE id = $1 AND group_id = $2',
            [locationId, groupId]
        );

        if (result.rowCount === 0) {
            throw new Error('Location not found');
        }

        await this.pool.query(
            'UPDATE location_groups SET updated_at = $1 WHERE id = $2',
            [new Date().toISOString(), groupId]
        );

        return true;
    }

    async updateLocation(groupId, locationId, deviceId, updates) {
        const ownerCheck = await this.pool.query(
            'SELECT id FROM location_groups WHERE id = $1 AND device_id = $2',
            [groupId, deviceId]
        );
        if (!ownerCheck.rows[0]) {
            throw new Error('Location group not found or access denied');
        }

        let setClauses = [];
        let params = [];
        let paramIndex = 1;

        if (updates.color !== undefined) {
            setClauses.push(`color = $${paramIndex++}`);
            params.push(updates.color);
        }

        if (setClauses.length === 0) {
            throw new Error('No valid updates provided');
        }

        params.push(locationId, groupId);
        const sql = `UPDATE locations SET ${setClauses.join(', ')} WHERE id = $${paramIndex++} AND group_id = $${paramIndex++}`;

        const result = await this.pool.query(sql, params);

        if (result.rowCount === 0) {
            throw new Error('Location not found');
        }

        await this.pool.query(
            'UPDATE location_groups SET updated_at = $1 WHERE id = $2',
            [new Date().toISOString(), groupId]
        );

        const updated = await this.pool.query('SELECT * FROM locations WHERE id = $1', [locationId]);
        const row = updated.rows[0];
        return {
            id: row.id,
            lat: row.lat,
            lng: row.lng,
            title: row.title,
            color: row.color
        };
    }

    async getPanelStockUploads(deviceId) {
        const sql = `
            SELECT * FROM panel_stock_uploads
            WHERE device_id = $1
            ORDER BY created_at DESC
        `;
        const result = await this.pool.query(sql, [deviceId]);
        return result.rows.map(row => ({
            id: row.id,
            title: row.title,
            fileName: row.file_name,
            specialties: row.specialties,
            rows: row.rows,
            duplicateZips: row.duplicate_zips,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }

    async getPanelStockUpload(uploadId, deviceId) {
        const sql = `
            SELECT * FROM panel_stock_uploads
            WHERE id = $1 AND device_id = $2
        `;
        const result = await this.pool.query(sql, [uploadId, deviceId]);
        const row = result.rows[0];
        if (!row) return null;
        return {
            id: row.id,
            title: row.title,
            fileName: row.file_name,
            specialties: row.specialties,
            rows: row.rows,
            duplicateZips: row.duplicate_zips,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    async createPanelStockUpload(deviceId, { title, fileName, specialties, rows, duplicateZips }) {
        const id = uuidv4();
        const now = new Date().toISOString();
        await this.pool.query(
            `INSERT INTO panel_stock_uploads
                (id, device_id, title, file_name, specialties, rows, duplicate_zips, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
            [
                id, deviceId, title, fileName,
                JSON.stringify(specialties),
                JSON.stringify(rows),
                JSON.stringify(duplicateZips || []),
                now
            ]
        );
        return {
            id, title, fileName,
            specialties, rows,
            duplicateZips: duplicateZips || [],
            createdAt: now, updatedAt: now
        };
    }

    async deletePanelStockUpload(uploadId, deviceId) {
        const result = await this.pool.query(
            'DELETE FROM panel_stock_uploads WHERE id = $1 AND device_id = $2',
            [uploadId, deviceId]
        );
        if (result.rowCount === 0) {
            throw new Error('Panel stock upload not found or access denied');
        }
        return true;
    }

    async createUser(username, password, role = 'staff') {
        const passwordHash = await bcrypt.hash(password, 10);
        const id = uuidv4();
        try {
            await this.pool.query(
                'INSERT INTO users (id, username, password_hash, role) VALUES ($1, $2, $3, $4)',
                [id, username.toLowerCase(), passwordHash, role]
            );
            return { id, username: username.toLowerCase(), role };
        } catch (err) {
            if (err.code === '23505') {
                throw new Error('Username already exists');
            }
            throw err;
        }
    }

    // Role is looked up from the DB per request (not cached in the session
    // map) so demotions take effect immediately — see requireRole in server.js.
    async getUserRole(userId) {
        const result = await this.pool.query(
            'SELECT role FROM users WHERE id = $1',
            [userId]
        );
        return result.rows[0] ? result.rows[0].role : null;
    }

    async getUsers() {
        const result = await this.pool.query(
            'SELECT id, username, role, created_at FROM users ORDER BY created_at ASC'
        );
        return result.rows.map(row => ({
            id: row.id,
            username: row.username,
            role: row.role,
            createdAt: row.created_at
        }));
    }

    async updateUserRole(userId, role) {
        const result = await this.pool.query(
            'UPDATE users SET role = $1 WHERE id = $2',
            [role, userId]
        );
        if (result.rowCount === 0) {
            throw new Error('User not found');
        }
        return { id: userId, role };
    }

    async verifyUser(username, password) {
        const result = await this.pool.query(
            'SELECT id, username, password_hash FROM users WHERE username = $1',
            [username.toLowerCase()]
        );
        const row = result.rows[0];
        if (!row) return null;
        const match = await bcrypt.compare(password, row.password_hash);
        return match ? { id: row.id, username: row.username } : null;
    }

    async hasUsers() {
        const result = await this.pool.query('SELECT COUNT(*) as count FROM users');
        return parseInt(result.rows[0].count, 10) > 0;
    }

    // ZIP boundary lookups (seeded by scripts/seedZipBoundaries.js).
    // Batch is one indexed query, not N — the PK covers = ANY($1).
    async getZipBoundaries(zipCodes) {
        const result = await this.pool.query(
            `SELECT zip_code, center_lat, center_lng, geometry
             FROM zip_boundaries
             WHERE zip_code = ANY($1)`,
            [zipCodes]
        );
        return result.rows;
    }

    async getZipBoundary(zipCode) {
        const rows = await this.getZipBoundaries([zipCode]);
        return rows[0] || null;
    }

    async countZipBoundaries() {
        const result = await this.pool.query('SELECT COUNT(*) as count FROM zip_boundaries');
        return parseInt(result.rows[0].count, 10);
    }

    // ================================
    // DWC doctor location tracking
    // ================================

    _mapDoctorRow(row) {
        const doctor = {
            id: row.id,
            firstName: row.first_name,
            lastName: row.last_name,
            displayName: row.display_name,
            specialtyHint: row.specialty_hint,
            isActive: row.is_active,
            notes: row.notes,
            createdBy: row.created_by,
            lastCheckStatus: row.last_check_status,
            lastCheckAt: row.last_check_at,
            lastCheckError: row.last_check_error,
            lastSuccessAt: row.last_success_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
        if (row.active_location_count !== undefined) {
            doctor.activeLocationCount = parseInt(row.active_location_count, 10);
        }
        return doctor;
    }

    _mapDwcLocationRow(row) {
        return {
            id: row.id,
            doctorId: row.doctor_id,
            status: row.status,
            street: row.street,
            city: row.city,
            state: row.state,
            zipCode: row.zip_code,
            rawAddress: row.raw_address,
            phone: row.phone,
            dwcDisplayName: row.dwc_display_name,
            specialty: row.specialty,
            credentials: row.credentials,
            classification: row.classification,
            classificationOverride: row.classification_override,
            classificationOverriddenBy: row.classification_overridden_by,
            lat: row.lat,
            lng: row.lng,
            geocodeStatus: row.geocode_status,
            geocodeError: row.geocode_error,
            geocodedAt: row.geocoded_at,
            firstSeenAt: row.first_seen_at,
            lastSeenAt: row.last_seen_at,
            deactivatedAt: row.deactivated_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    _mapSyncRunRow(row) {
        return {
            id: row.id,
            triggerType: row.trigger_type,
            triggeredBy: row.triggered_by,
            status: row.status,
            doctorCount: row.doctor_count,
            processedCount: row.processed_count,
            successCount: row.success_count,
            errorCount: row.error_count,
            startedAt: row.started_at,
            finishedAt: row.finished_at,
            errorSummary: row.error_summary
        };
    }

    async getDoctors({ includeInactive = false, withCounts = true } = {}) {
        let sql;
        if (withCounts) {
            sql = `
                SELECT d.*,
                       COUNT(l.id) FILTER (WHERE l.status = 'active') AS active_location_count
                FROM doctors d
                LEFT JOIN dwc_location l ON l.doctor_id = d.id
                ${includeInactive ? '' : 'WHERE d.is_active = TRUE'}
                GROUP BY d.id
                ORDER BY d.last_name ASC, d.first_name ASC
            `;
        } else {
            sql = `
                SELECT * FROM doctors d
                ${includeInactive ? '' : 'WHERE d.is_active = TRUE'}
                ORDER BY d.last_name ASC, d.first_name ASC
            `;
        }
        const result = await this.pool.query(sql);
        return result.rows.map(row => this._mapDoctorRow(row));
    }

    async getDoctor(doctorId) {
        const result = await this.pool.query(
            'SELECT * FROM doctors WHERE id = $1',
            [doctorId]
        );
        const row = result.rows[0];
        return row ? this._mapDoctorRow(row) : null;
    }

    async getActiveDoctors() {
        const result = await this.pool.query(
            'SELECT * FROM doctors WHERE is_active = TRUE ORDER BY last_name ASC, first_name ASC'
        );
        return result.rows.map(row => this._mapDoctorRow(row));
    }

    async getDoctorsByIds(doctorIds) {
        if (!doctorIds || doctorIds.length === 0) return [];
        const result = await this.pool.query(
            'SELECT * FROM doctors WHERE id = ANY($1) ORDER BY last_name ASC, first_name ASC',
            [doctorIds]
        );
        return result.rows.map(row => this._mapDoctorRow(row));
    }

    async createDoctor({ firstName, lastName, displayName, specialtyHint, notes, createdBy }) {
        const id = uuidv4();
        const now = new Date().toISOString();
        await this.pool.query(
            `INSERT INTO doctors
                (id, first_name, last_name, display_name, specialty_hint, notes, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
            [id, firstName, lastName, displayName || null, specialtyHint || null, notes || null, createdBy || null, now]
        );
        return this.getDoctor(id);
    }

    async updateDoctor(doctorId, updates) {
        const now = new Date().toISOString();
        let setClauses = ['updated_at = $1'];
        let params = [now];
        let paramIndex = 2;

        if (updates.firstName !== undefined) {
            setClauses.push(`first_name = $${paramIndex++}`);
            params.push(updates.firstName);
        }
        if (updates.lastName !== undefined) {
            setClauses.push(`last_name = $${paramIndex++}`);
            params.push(updates.lastName);
        }
        if (updates.displayName !== undefined) {
            setClauses.push(`display_name = $${paramIndex++}`);
            params.push(updates.displayName || null);
        }
        if (updates.specialtyHint !== undefined) {
            setClauses.push(`specialty_hint = $${paramIndex++}`);
            params.push(updates.specialtyHint || null);
        }
        if (updates.notes !== undefined) {
            setClauses.push(`notes = $${paramIndex++}`);
            params.push(updates.notes || null);
        }

        params.push(doctorId);
        const sql = `UPDATE doctors SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`;
        const result = await this.pool.query(sql, params);

        if (result.rowCount === 0) {
            throw new Error('Doctor not found');
        }
        return this.getDoctor(doctorId);
    }

    async setDoctorActive(doctorId, isActive) {
        const result = await this.pool.query(
            'UPDATE doctors SET is_active = $1, updated_at = $2 WHERE id = $3',
            [isActive, new Date().toISOString(), doctorId]
        );
        if (result.rowCount === 0) {
            throw new Error('Doctor not found');
        }
        return this.getDoctor(doctorId);
    }

    async deleteDoctor(doctorId) {
        // Hard delete — cascades to dwc_location / dwc_location_event /
        // dwc_doctor_check_result via FK.
        const result = await this.pool.query(
            'DELETE FROM doctors WHERE id = $1',
            [doctorId]
        );
        if (result.rowCount === 0) {
            throw new Error('Doctor not found');
        }
        return true;
    }

    async getDoctorLocations(doctorId, { includeInactive = false } = {}) {
        const sql = `
            SELECT * FROM dwc_location
            WHERE doctor_id = $1 ${includeInactive ? '' : "AND status = 'active'"}
            ORDER BY status ASC, city ASC, street ASC
        `;
        const result = await this.pool.query(sql, [doctorId]);
        return result.rows.map(row => this._mapDwcLocationRow(row));
    }

    async updateLocationGeocode(locationId, { lat, lng, status, error }) {
        const now = new Date().toISOString();
        let result;
        if (status === 'failed') {
            result = await this.pool.query(
                `UPDATE dwc_location
                 SET geocode_status = 'failed', geocode_error = $1, updated_at = $2
                 WHERE id = $3`,
                [error || null, now, locationId]
            );
        } else {
            result = await this.pool.query(
                `UPDATE dwc_location
                 SET lat = $1, lng = $2, geocode_status = 'ok', geocode_error = NULL,
                     geocoded_at = $3, updated_at = $3
                 WHERE id = $4`,
                [lat, lng, now, locationId]
            );
        }
        if (result.rowCount === 0) {
            throw new Error('Location not found');
        }
        return true;
    }

    async updateLocationClassification(locationId, classification, overriddenBy) {
        const result = await this.pool.query(
            `UPDATE dwc_location
             SET classification = $1, classification_override = TRUE,
                 classification_overridden_by = $2, updated_at = $3
             WHERE id = $4`,
            [classification, overriddenBy, new Date().toISOString(), locationId]
        );
        if (result.rowCount === 0) {
            throw new Error('Location not found');
        }
        return true;
    }

    async clearLocationClassificationOverride(locationId) {
        // Clears the override flag so future scrapes auto-classify again;
        // the current classification value stands until the next sync.
        const result = await this.pool.query(
            `UPDATE dwc_location
             SET classification_override = FALSE, classification_overridden_by = NULL, updated_at = $1
             WHERE id = $2`,
            [new Date().toISOString(), locationId]
        );
        if (result.rowCount === 0) {
            throw new Error('Location not found');
        }
        return true;
    }

    async createSyncRun({ triggeredBy, doctorCount, triggerType = 'manual' }) {
        const id = uuidv4();
        await this.pool.query(
            `INSERT INTO dwc_sync_run (id, trigger_type, triggered_by, status, doctor_count)
             VALUES ($1, $2, $3, 'running', $4)`,
            [id, triggerType, triggeredBy || null, doctorCount]
        );
        return this.getSyncRun(id);
    }

    async getSyncRun(runId) {
        const result = await this.pool.query(
            'SELECT * FROM dwc_sync_run WHERE id = $1',
            [runId]
        );
        const row = result.rows[0];
        return row ? this._mapSyncRunRow(row) : null;
    }

    async getSyncRuns(limit = 20) {
        const result = await this.pool.query(
            'SELECT * FROM dwc_sync_run ORDER BY started_at DESC LIMIT $1',
            [limit]
        );
        return result.rows.map(row => this._mapSyncRunRow(row));
    }

    async updateSyncRunProgress(runId, { processedCount, successCount, errorCount }) {
        await this.pool.query(
            `UPDATE dwc_sync_run
             SET processed_count = $1, success_count = $2, error_count = $3
             WHERE id = $4`,
            [processedCount, successCount, errorCount, runId]
        );
        return true;
    }

    async finishSyncRun(runId, status, errorSummary = null) {
        await this.pool.query(
            `UPDATE dwc_sync_run
             SET status = $1, finished_at = $2, error_summary = $3
             WHERE id = $4`,
            [status, new Date().toISOString(), errorSummary, runId]
        );
        return true;
    }

    async getSyncRunResults(runId) {
        const result = await this.pool.query(
            `SELECT r.*, d.first_name, d.last_name, d.display_name
             FROM dwc_doctor_check_result r
             JOIN doctors d ON d.id = r.doctor_id
             WHERE r.sync_run_id = $1
             ORDER BY r.created_at ASC`,
            [runId]
        );
        return result.rows.map(row => ({
            id: row.id,
            syncRunId: row.sync_run_id,
            doctorId: row.doctor_id,
            doctorFirstName: row.first_name,
            doctorLastName: row.last_name,
            doctorDisplayName: row.display_name,
            status: row.status,
            locationCount: row.location_count,
            errorDetail: row.error_detail,
            durationMs: row.duration_ms,
            createdAt: row.created_at
        }));
    }

    async getFailedDoctorIdsForRun(runId) {
        const result = await this.pool.query(
            `SELECT DISTINCT doctor_id FROM dwc_doctor_check_result
             WHERE sync_run_id = $1 AND status = 'error'`,
            [runId]
        );
        return result.rows.map(row => row.doctor_id);
    }

    async recordDoctorCheckResult(syncRunId, doctorId, { status, locationCount, errorDetail, durationMs }) {
        const id = uuidv4();
        await this.pool.query(
            `INSERT INTO dwc_doctor_check_result
                (id, sync_run_id, doctor_id, status, location_count, error_detail, duration_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [id, syncRunId, doctorId, status, locationCount || 0, errorDetail || null, durationMs ?? null]
        );
        return { id, syncRunId, doctorId, status, locationCount: locationCount || 0, errorDetail: errorDetail || null, durationMs: durationMs ?? null };
    }

    // Called ONLY when a check errored (network failure, non-200,
    // unparseable response) — updates the doctor's cached status without
    // ever touching dwc_location. 'no_results' / 'too_many_results' are NOT
    // errors: those still reconcile (see reconcileDoctorLocations), because
    // DWC authoritatively answered — don't conflate "no rows" with "failed".
    async recordDoctorCheckError(doctorId, errorDetail) {
        const now = new Date().toISOString();
        await this.pool.query(
            `UPDATE doctors
             SET last_check_status = 'error', last_check_at = $1, last_check_error = $2, updated_at = $1
             WHERE id = $3`,
            [now, errorDetail, doctorId]
        );
        return true;
    }

    // Private helper — inserts a dwc_location_event row inside the caller's
    // transaction (same JSONB pattern as panel_stock_uploads).
    async _logLocationEvent(client, locationId, syncRunId, doctorId, eventType, snapshotRecordOrNull) {
        await client.query(
            `INSERT INTO dwc_location_event (id, location_id, sync_run_id, doctor_id, event_type, snapshot)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                uuidv4(), locationId, syncRunId, doctorId, eventType,
                snapshotRecordOrNull ? JSON.stringify(snapshotRecordOrNull) : null
            ]
        );
    }

    // Reconciles one doctor's scraped DWC locations against the permanent
    // dwc_location rows. One transaction PER DOCTOR, opened and committed
    // here, never spanning multiple doctors — a mid-run crash on doctor 40
    // of 80 must not roll back doctors 1-39's already-committed results.
    //
    // Status semantics (easy to conflate — don't):
    // - 'no_results' / 'too_many_results' still reconcile: DWC answered
    //   authoritatively with zero matching rows, so every previously-active
    //   location is deactivated.
    // - Only 'error' (network failure, non-200, unparseable response) skips
    //   reconciliation entirely and leaves existing rows untouched.
    async reconcileDoctorLocations(doctorId, syncRunId, scrapeResult) {
        // scrapeResult: { status: 'ok'|'no_results'|'too_many_results'|'error', records: [...] }
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');

            if (scrapeResult.status === 'error') {
                // Must NOT touch existing rows if the lookup/parse failed.
                await client.query('COMMIT');
                return { created: 0, reactivated: 0, refreshed: 0, deactivated: 0 };
            }

            const existingRows = await client.query(
                `SELECT * FROM dwc_location WHERE doctor_id = $1`, [doctorId]
            );
            const existingByKey = new Map(existingRows.rows.map(r => [r.identity_key, r]));
            const matchedKeys = new Set();
            const now = new Date().toISOString();
            let created = 0, reactivated = 0, refreshed = 0;

            for (const record of scrapeResult.records) {
                const parsedAddr = addressParser.parseAddress(record.address);
                const identityKey = addressParser.buildIdentityKey(parsedAddr);
                matchedKeys.add(identityKey);
                const existing = existingByKey.get(identityKey);
                const credentials = nameMatcher.extractCredentials(record.name).join(', ');
                const classification = classifier.classify(record.phone);

                if (!existing) {
                    const id = uuidv4();
                    await client.query(
                        `INSERT INTO dwc_location
                           (id, doctor_id, status, street, city, state, zip_code, identity_key,
                            raw_address, phone, dwc_display_name, specialty, credentials,
                            classification, geocode_status, first_seen_at, last_seen_at, created_at, updated_at)
                         VALUES ($1,$2,'active',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,$14,$14,$14)`,
                        [id, doctorId, parsedAddr.street, parsedAddr.city, parsedAddr.state, parsedAddr.zipCode,
                         identityKey, record.address, record.phone, record.name, record.specialty, credentials,
                         classification, now]
                    );
                    await this._logLocationEvent(client, id, syncRunId, doctorId, 'created', record);
                    created++;
                } else if (existing.status === 'inactive') {
                    // classification_override guards manual PME/non-PME
                    // overrides from being clobbered by the next scrape.
                    await client.query(
                        `UPDATE dwc_location SET status='active', deactivated_at=NULL, last_seen_at=$1, updated_at=$1,
                         phone=$2, specialty=$3, dwc_display_name=$4, credentials=$5,
                         classification = CASE WHEN classification_override THEN classification ELSE $6 END
                         WHERE id = $7`,
                        [now, record.phone, record.specialty, record.name, credentials, classification, existing.id]
                    );
                    await this._logLocationEvent(client, existing.id, syncRunId, doctorId, 'reactivated', record);
                    reactivated++;
                } else {
                    await client.query(
                        `UPDATE dwc_location SET last_seen_at=$1, updated_at=$1,
                         phone=$2, specialty=$3, dwc_display_name=$4, credentials=$5,
                         classification = CASE WHEN classification_override THEN classification ELSE $6 END
                         WHERE id = $7`,
                        [now, record.phone, record.specialty, record.name, credentials, classification, existing.id]
                    );
                    await this._logLocationEvent(client, existing.id, syncRunId, doctorId, 'refreshed', record);
                    refreshed++;
                }
            }

            const toDeactivate = existingRows.rows.filter(r => r.status === 'active' && !matchedKeys.has(r.identity_key));
            for (const row of toDeactivate) {
                await client.query(
                    `UPDATE dwc_location SET status='inactive', deactivated_at=$1, updated_at=$1 WHERE id=$2`,
                    [now, row.id]
                );
                await this._logLocationEvent(client, row.id, syncRunId, doctorId, 'deactivated', null);
            }

            // doctors.last_check_* is a denormalized cache of the latest
            // state, updated in the SAME transaction as the location events
            // so it cannot drift. Status reflects what DWC actually said
            // ('ok' | 'no_results' | 'too_many_results'); the check itself
            // succeeded either way, so last_success_at always advances.
            await client.query(
                `UPDATE doctors SET last_check_status=$1, last_check_at=$2, last_success_at=$2, last_check_error=NULL, updated_at=$2 WHERE id=$3`,
                [scrapeResult.status, now, doctorId]
            );

            await client.query('COMMIT');
            return { created, reactivated, refreshed, deactivated: toDeactivate.length };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async close() {
        if (this.pool) {
            await this.pool.end();
            console.log('Database connection closed');
        }
    }

    isHealthy() {
        return this.isInitialized && this.pool;
    }
}

module.exports = DatabaseService;
module.exports.ZIP_BOUNDARIES_DDL = ZIP_BOUNDARIES_DDL;
