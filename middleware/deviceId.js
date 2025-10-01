const { v4: uuidv4 } = require('uuid');

// Device ID middleware for automatic device identification
class DeviceIdMiddleware {
    constructor(databaseService) {
        this.db = databaseService;
        this.cookieName = 'deviceId';
        this.cookieOptions = {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 365 * 24 * 60 * 60 * 1000 // 1 year
        };
    }

    // Main middleware function
    middleware() {
        return async (req, res, next) => {
            try {
                let deviceId = req.cookies[this.cookieName];
                console.log('Device ID middleware - Cookie value:', deviceId);

                // Generate new device ID if none exists
                if (!deviceId) {
                    deviceId = uuidv4();
                    console.log('Generated new device ID:', deviceId);

                    // Set cookie with new device ID
                    res.cookie(this.cookieName, deviceId, this.cookieOptions);
                }

                // Register/update device in database
                if (this.db && this.db.isHealthy()) {
                    try {
                        await this.db.registerDevice(deviceId);
                        console.log('Successfully registered device:', deviceId);
                    } catch (dbError) {
                        console.error('Error registering device in database:', dbError);
                        // Continue without failing the request
                    }
                } else {
                    console.error('Database not healthy or not available');
                }

                // Add device ID to request object for use in route handlers
                req.deviceId = deviceId;
                console.log('Set req.deviceId to:', req.deviceId);

                next();
            } catch (error) {
                console.error('Error in device ID middleware:', error);
                // Generate temporary device ID to prevent request failure
                req.deviceId = uuidv4();
                console.log('Error fallback - Set req.deviceId to:', req.deviceId);
                next();
            }
        };
    }

    // Utility function to validate device ID format
    isValidDeviceId(deviceId) {
        if (!deviceId || typeof deviceId !== 'string') {
            return false;
        }

        // Check if it's a valid UUID v4 format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuidRegex.test(deviceId);
    }

    // Get device ID from request (with validation)
    getDeviceId(req) {
        const deviceId = req.deviceId || req.cookies[this.cookieName];

        if (!this.isValidDeviceId(deviceId)) {
            console.warn('Invalid device ID detected:', deviceId);
            return null;
        }

        return deviceId;
    }

    // Force regenerate device ID (useful for testing or user request)
    regenerateDeviceId(req, res) {
        const newDeviceId = uuidv4();
        res.cookie(this.cookieName, newDeviceId, this.cookieOptions);
        req.deviceId = newDeviceId;

        console.log('Regenerated device ID:', newDeviceId);
        return newDeviceId;
    }

    // Clear device ID (logout equivalent)
    clearDeviceId(req, res) {
        res.clearCookie(this.cookieName);
        req.deviceId = null;
        console.log('Cleared device ID');
    }

    // Get device statistics (for debugging/admin purposes)
    async getDeviceStats() {
        if (!this.db || !this.db.isHealthy()) {
            return null;
        }

        return new Promise((resolve, reject) => {
            const sql = `
                SELECT
                    COUNT(DISTINCT d.device_id) as total_devices,
                    COUNT(DISTINCT CASE WHEN d.last_seen > datetime('now', '-24 hours') THEN d.device_id END) as active_24h,
                    COUNT(DISTINCT CASE WHEN d.last_seen > datetime('now', '-7 days') THEN d.device_id END) as active_7d,
                    COUNT(lg.id) as total_groups,
                    COUNT(l.id) as total_locations
                FROM devices d
                LEFT JOIN location_groups lg ON d.device_id = lg.device_id
                LEFT JOIN locations l ON lg.id = l.group_id
            `;

            this.db.db.get(sql, [], (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    // Cleanup old inactive devices (maintenance function)
    async cleanupOldDevices(daysInactive = 90) {
        if (!this.db || !this.db.isHealthy()) {
            return 0;
        }

        return new Promise((resolve, reject) => {
            const sql = `
                DELETE FROM devices
                WHERE last_seen < datetime('now', '-${daysInactive} days')
                AND device_id NOT IN (
                    SELECT DISTINCT device_id FROM location_groups
                )
            `;

            this.db.db.run(sql, [], function(err) {
                if (err) {
                    reject(err);
                } else {
                    console.log(`Cleaned up ${this.changes} inactive devices`);
                    resolve(this.changes);
                }
            });
        });
    }
}

module.exports = DeviceIdMiddleware;