const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

class DatabaseService {
    constructor() {
        this.db = null;
        this.dbPath = path.join(__dirname, '..', 'data', 'location_groups.db');
        this.isInitialized = false;
    }

    // Initialize database connection and create tables if needed
    async initialize() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // Create database connection
            this.db = new sqlite3.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Error opening database:', err.message);
                    throw err;
                }
                console.log('Connected to SQLite database');
            });

            // Create tables if they don't exist
            await this.createTables();
            this.isInitialized = true;
            console.log('Database initialized successfully');
        } catch (error) {
            console.error('Failed to initialize database:', error);
            throw error;
        }
    }

    // Create database tables
    createTables() {
        return new Promise((resolve, reject) => {
            const createTablesSQL = `
                -- Devices table for tracking unique browsers
                CREATE TABLE IF NOT EXISTS devices (
                    device_id TEXT PRIMARY KEY,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
                );

                -- Location groups with device association
                CREATE TABLE IF NOT EXISTS location_groups (
                    id TEXT PRIMARY KEY,
                    device_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (device_id) REFERENCES devices(device_id) ON DELETE CASCADE
                );

                -- Individual locations within groups
                CREATE TABLE IF NOT EXISTS locations (
                    id TEXT PRIMARY KEY,
                    group_id TEXT NOT NULL,
                    lat REAL NOT NULL,
                    lng REAL NOT NULL,
                    title TEXT NOT NULL,
                    color TEXT DEFAULT '#3B82F6',
                    order_index INTEGER DEFAULT 0,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (group_id) REFERENCES location_groups(id) ON DELETE CASCADE
                );

                -- Create indexes for better performance
                CREATE INDEX IF NOT EXISTS idx_location_groups_device_id ON location_groups(device_id);
                CREATE INDEX IF NOT EXISTS idx_locations_group_id ON locations(group_id);
                CREATE INDEX IF NOT EXISTS idx_locations_order ON locations(group_id, order_index);
            `;

            this.db.exec(createTablesSQL, (err) => {
                if (err) {
                    console.error('Error creating tables:', err);
                    reject(err);
                } else {
                    console.log('Database tables created successfully');
                    resolve();
                }
            });
        });
    }

    // Register a new device or update last seen
    async registerDevice(deviceId) {
        return new Promise((resolve, reject) => {
            const sql = `
                INSERT OR REPLACE INTO devices (device_id, last_seen)
                VALUES (?, CURRENT_TIMESTAMP)
            `;

            this.db.run(sql, [deviceId], function(err) {
                if (err) {
                    console.error('Error registering device:', err);
                    reject(err);
                } else {
                    resolve(deviceId);
                }
            });
        });
    }

    // Get all location groups for a specific device
    async getLocationGroups(deviceId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT lg.*,
                       COUNT(l.id) as location_count
                FROM location_groups lg
                LEFT JOIN locations l ON lg.id = l.group_id
                WHERE lg.device_id = ?
                GROUP BY lg.id, lg.device_id, lg.name, lg.created_at, lg.updated_at
                ORDER BY lg.created_at DESC
            `;

            this.db.all(sql, [deviceId], async (err, rows) => {
                if (err) {
                    console.error('Error fetching location groups:', err);
                    reject(err);
                    return;
                }

                try {
                    // Get locations for each group
                    const groupsWithLocations = await Promise.all(
                        rows.map(async (group) => {
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

                    resolve(groupsWithLocations);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    // Get a specific location group by ID (with device verification)
    async getLocationGroup(groupId, deviceId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT * FROM location_groups
                WHERE id = ? AND device_id = ?
            `;

            this.db.get(sql, [groupId, deviceId], async (err, row) => {
                if (err) {
                    console.error('Error fetching location group:', err);
                    reject(err);
                    return;
                }

                if (!row) {
                    resolve(null);
                    return;
                }

                try {
                    const locations = await this.getLocationsForGroup(groupId);
                    resolve({
                        id: row.id,
                        name: row.name,
                        locations: locations,
                        createdAt: row.created_at,
                        updatedAt: row.updated_at
                    });
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    // Create a new location group
    async createLocationGroup(deviceId, name, locations = []) {
        return new Promise((resolve, reject) => {
            const groupId = uuidv4();
            const now = new Date().toISOString();
            const db = this.db; // Store reference to avoid context issues

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // Insert location group
                const insertGroupSQL = `
                    INSERT INTO location_groups (id, device_id, name, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                `;

                db.run(insertGroupSQL, [groupId, deviceId, name, now, now], async (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                        return;
                    }

                    try {
                        // Add locations if provided
                        if (locations.length > 0) {
                            await this.addLocationsToGroup(groupId, locations);
                        }

                        db.run('COMMIT', (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve({
                                    id: groupId,
                                    name: name,
                                    locations: locations,
                                    createdAt: now,
                                    updatedAt: now
                                });
                            }
                        });
                    } catch (error) {
                        db.run('ROLLBACK');
                        reject(error);
                    }
                });
            });
        });
    }

    // Update a location group
    async updateLocationGroup(groupId, deviceId, updates) {
        return new Promise((resolve, reject) => {
            const now = new Date().toISOString();
            let sql = 'UPDATE location_groups SET updated_at = ?';
            let params = [now];

            if (updates.name !== undefined) {
                sql += ', name = ?';
                params.push(updates.name);
            }

            sql += ' WHERE id = ? AND device_id = ?';
            params.push(groupId, deviceId);

            this.db.run(sql, params, async (err) => {
                if (err) {
                    console.error('Error updating location group:', err);
                    reject(err);
                    return;
                }

                if (this.changes === 0) {
                    reject(new Error('Location group not found or access denied'));
                    return;
                }

                try {
                    // Update locations if provided
                    if (updates.locations !== undefined) {
                        await this.replaceLocationsInGroup(groupId, updates.locations);
                    }

                    // Return updated group
                    const updatedGroup = await this.getLocationGroup(groupId, deviceId);
                    resolve(updatedGroup);
                } catch (error) {
                    reject(error);
                }
            });
        });
    }

    // Delete a location group
    async deleteLocationGroup(groupId, deviceId) {
        return new Promise((resolve, reject) => {
            const db = this.db; // Store reference to avoid context issues

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // Delete locations first
                db.run('DELETE FROM locations WHERE group_id = ?', [groupId], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                        return;
                    }

                    // Delete group
                    db.run(
                        'DELETE FROM location_groups WHERE id = ? AND device_id = ?',
                        [groupId, deviceId],
                        function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                reject(err);
                                return;
                            }

                            if (this.changes === 0) {
                                db.run('ROLLBACK');
                                reject(new Error('Location group not found or access denied'));
                                return;
                            }

                            db.run('COMMIT', (err) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    resolve(true);
                                }
                            });
                        }
                    );
                });
            });
        });
    }

    // Get locations for a specific group
    async getLocationsForGroup(groupId) {
        return new Promise((resolve, reject) => {
            const sql = `
                SELECT * FROM locations
                WHERE group_id = ?
                ORDER BY order_index ASC, created_at ASC
            `;

            this.db.all(sql, [groupId], (err, rows) => {
                if (err) {
                    console.error('Error fetching locations:', err);
                    reject(err);
                } else {
                    const locations = rows.map(row => ({
                        id: row.id,
                        lat: row.lat,
                        lng: row.lng,
                        title: row.title,
                        color: row.color
                    }));
                    resolve(locations);
                }
            });
        });
    }

    // Add a single location to a group
    async addLocationToGroup(groupId, deviceId, locationData) {
        return new Promise((resolve, reject) => {
            // First verify the group belongs to the device
            this.db.get(
                'SELECT id FROM location_groups WHERE id = ? AND device_id = ?',
                [groupId, deviceId],
                (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!row) {
                        reject(new Error('Location group not found or access denied'));
                        return;
                    }

                    // Add the location
                    const locationId = uuidv4();
                    const now = new Date().toISOString();

                    const insertSQL = `
                        INSERT INTO locations (id, group_id, lat, lng, title, color, order_index, created_at)
                        VALUES (?, ?, ?, ?, ?, ?,
                                (SELECT COALESCE(MAX(order_index), 0) + 1 FROM locations WHERE group_id = ?),
                                ?)
                    `;

                    this.db.run(insertSQL, [
                        locationId, groupId, locationData.lat, locationData.lng,
                        locationData.title, locationData.color || '#3B82F6', groupId, now
                    ], (err) => {
                        if (err) {
                            console.error('Error adding location:', err);
                            reject(err);
                        } else {
                            // Update group timestamp - use arrow function to preserve 'this' context
                            this.db.run(
                                'UPDATE location_groups SET updated_at = ? WHERE id = ?',
                                [now, groupId]
                            );

                            resolve({
                                id: locationId,
                                lat: locationData.lat,
                                lng: locationData.lng,
                                title: locationData.title,
                                color: locationData.color || '#3B82F6'
                            });
                        }
                    });
                }
            );
        });
    }

    // Add multiple locations to a group
    async addLocationsToGroup(groupId, locations) {
        return new Promise((resolve, reject) => {
            if (!locations || locations.length === 0) {
                resolve([]);
                return;
            }

            const db = this.db; // Store reference to avoid context issues

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                let completedCount = 0;
                const results = [];
                let hasError = false;

                locations.forEach((location, index) => {
                    const locationId = uuidv4();
                    const now = new Date().toISOString();

                    const insertSQL = `
                        INSERT INTO locations (id, group_id, lat, lng, title, color, order_index, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    db.run(insertSQL, [
                        locationId, groupId, location.lat, location.lng,
                        location.title, location.color || '#3B82F6', index, now
                    ], function(err) {
                        if (err && !hasError) {
                            hasError = true;
                            db.run('ROLLBACK');
                            reject(err);
                            return;
                        }

                        if (!hasError) {
                            results.push({
                                id: locationId,
                                lat: location.lat,
                                lng: location.lng,
                                title: location.title,
                                color: location.color || '#3B82F6'
                            });

                            completedCount++;
                            if (completedCount === locations.length) {
                                db.run('COMMIT', (err) => {
                                    if (err) {
                                        reject(err);
                                    } else {
                                        resolve(results);
                                    }
                                });
                            }
                        }
                    });
                });
            });
        });
    }

    // Replace all locations in a group
    async replaceLocationsInGroup(groupId, locations) {
        return new Promise((resolve, reject) => {
            const db = this.db; // Store reference to avoid context issues

            db.serialize(() => {
                db.run('BEGIN TRANSACTION');

                // Delete existing locations
                db.run('DELETE FROM locations WHERE group_id = ?', [groupId], async (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                        return;
                    }

                    try {
                        // Add new locations
                        const results = await this.addLocationsToGroup(groupId, locations);

                        db.run('COMMIT', (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                resolve(results);
                            }
                        });
                    } catch (error) {
                        db.run('ROLLBACK');
                        reject(error);
                    }
                });
            });
        });
    }

    // Reorder locations in a group
    async reorderLocations(groupId, deviceId, locationIds) {
        return new Promise((resolve, reject) => {
            // First verify the group belongs to the device
            this.db.get(
                'SELECT id FROM location_groups WHERE id = ? AND device_id = ?',
                [groupId, deviceId],
                (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!row) {
                        reject(new Error('Location group not found or access denied'));
                        return;
                    }

                    const db = this.db; // Store reference to avoid context issues

                    db.serialize(() => {
                        db.run('BEGIN TRANSACTION');

                        let completedCount = 0;
                        let hasError = false;

                        locationIds.forEach((locationId, index) => {
                            db.run(
                                'UPDATE locations SET order_index = ? WHERE id = ? AND group_id = ?',
                                [index, locationId, groupId],
                                function(err) {
                                    if (err && !hasError) {
                                        hasError = true;
                                        db.run('ROLLBACK');
                                        reject(err);
                                        return;
                                    }

                                    if (!hasError) {
                                        completedCount++;
                                        if (completedCount === locationIds.length) {
                                            // Update group timestamp
                                            db.run(
                                                'UPDATE location_groups SET updated_at = ? WHERE id = ?',
                                                [new Date().toISOString(), groupId],
                                                (err) => {
                                                    if (err) {
                                                        db.run('ROLLBACK');
                                                        reject(err);
                                                    } else {
                                                        db.run('COMMIT', (err) => {
                                                            if (err) {
                                                                reject(err);
                                                            } else {
                                                                resolve(true);
                                                            }
                                                        });
                                                    }
                                                }
                                            );
                                        }
                                    }
                                }
                            );
                        });
                    });
                }
            );
        });
    }

    // Delete a specific location
    async deleteLocation(groupId, locationId, deviceId) {
        return new Promise((resolve, reject) => {
            // First verify the group belongs to the device
            this.db.get(
                'SELECT id FROM location_groups WHERE id = ? AND device_id = ?',
                [groupId, deviceId],
                (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!row) {
                        reject(new Error('Location group not found or access denied'));
                        return;
                    }

                    // Delete the location
                    const db = this.db; // Store reference to avoid context issues
                    db.run(
                        'DELETE FROM locations WHERE id = ? AND group_id = ?',
                        [locationId, groupId],
                        function(err) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            if (this.changes === 0) {
                                reject(new Error('Location not found'));
                                return;
                            }

                            // Update group timestamp
                            db.run(
                                'UPDATE location_groups SET updated_at = ? WHERE id = ?',
                                [new Date().toISOString(), groupId]
                            );

                            resolve(true);
                        }
                    );
                }
            );
        });
    }

    // Update a specific location
    async updateLocation(groupId, locationId, deviceId, updates) {
        return new Promise((resolve, reject) => {
            // First verify the group belongs to the device
            this.db.get(
                'SELECT id FROM location_groups WHERE id = ? AND device_id = ?',
                [groupId, deviceId],
                (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    if (!row) {
                        reject(new Error('Location group not found or access denied'));
                        return;
                    }

                    // Build update query
                    let sql = 'UPDATE locations SET ';
                    let params = [];
                    let setClauses = [];

                    if (updates.color !== undefined) {
                        setClauses.push('color = ?');
                        params.push(updates.color);
                    }

                    if (setClauses.length === 0) {
                        reject(new Error('No valid updates provided'));
                        return;
                    }

                    sql += setClauses.join(', ');
                    sql += ' WHERE id = ? AND group_id = ?';
                    params.push(locationId, groupId);

                    const db = this.db; // Store reference to avoid context issues
                    db.run(sql, params, function(err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        if (this.changes === 0) {
                            reject(new Error('Location not found'));
                            return;
                        }

                        // Update group timestamp
                        db.run(
                            'UPDATE location_groups SET updated_at = ? WHERE id = ?',
                            [new Date().toISOString(), groupId]
                        );

                        // Return updated location
                        db.get(
                            'SELECT * FROM locations WHERE id = ?',
                            [locationId],
                            (err, row) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    resolve({
                                        id: row.id,
                                        lat: row.lat,
                                        lng: row.lng,
                                        title: row.title,
                                        color: row.color
                                    });
                                }
                            }
                        );
                    });
                }
            );
        });
    }

    // Close database connection
    close() {
        if (this.db) {
            this.db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err.message);
                } else {
                    console.log('Database connection closed');
                }
            });
        }
    }

    // Health check
    isHealthy() {
        return this.isInitialized && this.db;
    }
}

module.exports = DatabaseService;