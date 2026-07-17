const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');

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

    async createUser(username, password) {
        const passwordHash = await bcrypt.hash(password, 10);
        const id = uuidv4();
        try {
            await this.pool.query(
                'INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)',
                [id, username.toLowerCase(), passwordHash]
            );
            return { id, username: username.toLowerCase() };
        } catch (err) {
            if (err.code === '23505') {
                throw new Error('Username already exists');
            }
            throw err;
        }
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
