require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const shapefile = require('shapefile');
const crypto = require('crypto');

// Import database and middleware
const DatabaseService = require('./db/database');
const DeviceIdMiddleware = require('./middleware/deviceId');

// ZIP code data cache (loaded on startup)
let zipcodeData = null;
let zipcodeDataLoaded = false;

// Load ZIP code shapefile data into memory
async function loadZipcodeData() {
    try {
        console.log('📂 Loading ZIP code boundary data...');
        const startTime = Date.now();

        const shapefileDir = path.join(__dirname, 'MapZipCodes', 'tl_2020_us_zcta520');
        const shpPath = path.join(shapefileDir, 'tl_2020_us_zcta520.shp');

        console.log('🔄 Parsing shapefile data...');

        // Create lookup index for fast access
        zipcodeData = {};
        let count = 0;

        // Read shapefile feature by feature
        const source = await shapefile.open(shpPath);
        let result = await source.read();

        while (!result.done) {
            const feature = result.value;
            const zipCode = feature.properties.ZCTA5CE20;
            if (zipCode) {
                zipcodeData[zipCode] = feature.geometry;
                count++;
            }
            result = await source.read();
        }

        zipcodeDataLoaded = true;
        const loadTime = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`✅ Loaded ${count} ZIP codes in ${loadTime} seconds`);
    } catch (error) {
        console.error('❌ Error loading ZIP code data:', error);
        console.error('ZIP code lookups will not be available');
        zipcodeDataLoaded = false;
    }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Security: Configure CORS with specific origins
const corsOptions = {
    origin: process.env.NODE_ENV === 'production'
        ? ['https://yourdomain.com'] // Replace with your actual domain
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    optionsSuccessStatus: 200
};

// Security: Use helmet for security headers
app.use(helmet({
    contentSecurityPolicy: false, // Disable for Google Maps
    crossOriginEmbedderPolicy: false
}));

app.use(cors(corsOptions));

// Cookie parser middleware
app.use(cookieParser());

// Security: Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', limiter);

// Security: Limit JSON payload size
app.use(bodyParser.json({ limit: '10mb' }));

// Validation error handler middleware
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

app.use(express.static(path.join(__dirname)));

// In-memory session store: sessionId -> { userId, username }
const sessions = new Map();

function createSession(userId, username) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    sessions.set(sessionId, { userId, username });
    return sessionId;
}

function getSession(sessionId) {
    return sessionId ? sessions.get(sessionId) : null;
}

function destroySession(sessionId) {
    sessions.delete(sessionId);
}

// Auth middleware — protects API routes and HTML pages
function requireAuth(req, res, next) {
    const sessionId = req.cookies['sessionId'];
    const session = getSession(sessionId);
    if (!session) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Not authenticated' });
        }
        return res.redirect('/login.html');
    }
    req.deviceId = session.userId;
    req.username = session.username;
    next();
}

// Initialize database and device ID middleware
let db;

async function initializeDatabase() {
    try {
        db = new DatabaseService();
        await db.initialize();

        // Define routes after db is ready
        defineRoutes();

        console.log('Database and middleware initialized successfully');
    } catch (error) {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    }
}

function defineRoutes() {
    // Auth routes (no auth required)
    app.post('/api/auth/register', [
        body('username').isString().trim().isLength({ min: 1, max: 50 }).escape(),
        body('password').isString().isLength({ min: 1 }),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const hasUsers = await db.hasUsers();
            if (hasUsers) {
                return res.status(403).json({ error: 'Registration is closed' });
            }
            const { username, password } = req.body;
            const user = await db.createUser(username, password);
            const sessionId = createSession(user.id, user.username);
            res.cookie('sessionId', sessionId, { httpOnly: true, sameSite: 'lax', maxAge: 365 * 24 * 60 * 60 * 1000 });
            res.json({ username: user.username });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    app.post('/api/auth/login', [
        body('username').isString().trim().isLength({ min: 1 }).escape(),
        body('password').isString().isLength({ min: 1 }),
        handleValidationErrors
    ], async (req, res) => {
        try {
            const { username, password } = req.body;
            const user = await db.verifyUser(username, password);
            if (!user) return res.status(401).json({ error: 'Invalid username or password' });
            const sessionId = createSession(user.id, user.username);
            res.cookie('sessionId', sessionId, { httpOnly: true, sameSite: 'lax', maxAge: 365 * 24 * 60 * 60 * 1000 });
            res.json({ username: user.username });
        } catch (err) {
            res.status(500).json({ error: 'Login failed' });
        }
    });

    app.post('/api/auth/logout', (req, res) => {
        const sessionId = req.cookies['sessionId'];
        destroySession(sessionId);
        res.clearCookie('sessionId');
        res.json({ ok: true });
    });

    app.get('/api/auth/me', (req, res) => {
        const session = getSession(req.cookies['sessionId']);
        if (!session) return res.status(401).json({ error: 'Not authenticated' });
        res.json({ username: session.username });
    });

    app.get('/api/auth/has-users', async (req, res) => {
        const hasUsers = await db.hasUsers();
        res.json({ hasUsers });
    });

    // Protect map pages
    app.get('/', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
    app.get('/index.html', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
    app.get('/zipcodes.html', requireAuth, (req, res) => res.sendFile(path.join(__dirname, 'zipcodes.html')));

    // Apply auth to all data API routes
    app.use('/api/config', requireAuth);
    app.use('/api/zipcodes', requireAuth);
    app.use('/api/locations', requireAuth);

    app.get('/api/config', (req, res) => {
        res.json({
            googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY
        });
    });

// Zip code boundary lookup endpoint (using Census ZCTA data)
app.post('/api/zipcodes/lookup', [
    body('zipCode')
        .isString()
        .trim()
        .matches(/^\d{5}$/)
        .withMessage('ZIP code must be exactly 5 digits'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { zipCode } = req.body;

        // Check if zipcode data is loaded
        if (!zipcodeDataLoaded || !zipcodeData) {
            return res.status(503).json({
                error: 'ZIP code data not available. Server may still be loading.',
                zipCode: zipCode
            });
        }

        // Lookup ZIP code geometry from in-memory cache
        const geometry = zipcodeData[zipCode];

        if (!geometry) {
            return res.status(404).json({
                error: 'ZIP code not found',
                zipCode: zipCode
            });
        }

        // Calculate center point from geometry bounds
        let centerLat = 0;
        let centerLng = 0;
        let pointCount = 0;

        if (geometry.type === 'Polygon') {
            geometry.coordinates[0].forEach(coord => {
                centerLng += coord[0];
                centerLat += coord[1];
                pointCount++;
            });
        } else if (geometry.type === 'MultiPolygon') {
            geometry.coordinates.forEach(polygon => {
                polygon[0].forEach(coord => {
                    centerLng += coord[0];
                    centerLat += coord[1];
                    pointCount++;
                });
            });
        }

        centerLat /= pointCount;
        centerLng /= pointCount;

        // Return response with accurate boundary geometry
        const responseData = {
            zipCode: zipCode,
            title: `ZIP ${zipCode}`,
            center: {
                lat: centerLat,
                lng: centerLng
            },
            formattedAddress: `ZIP Code ${zipCode}, USA`,
            geometry: JSON.stringify(geometry)
        };

        res.json(responseData);
    } catch (error) {
        console.error('Error looking up ZIP code:', error);
        res.status(500).json({ error: 'Failed to lookup ZIP code' });
    }
});

app.get('/api/:groupType(locations|zipcodes)/groups', async (req, res) => {
    try {
        const deviceId = req.deviceId;
        const { groupType } = req.params;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        const groups = await db.getLocationGroups(deviceId, groupType);
        res.json(groups);
    } catch (error) {
        console.error('Error fetching location groups:', error);
        res.status(500).json({ error: 'Failed to fetch location groups' });
    }
});

app.get('/api/:groupType(locations|zipcodes)/groups/:id', [
    param('id').isUUID().withMessage('Invalid group ID'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { id, groupType } = req.params;
        const deviceId = req.deviceId;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        const group = await db.getLocationGroup(id, deviceId, groupType);

        if (!group) {
            return res.status(404).json({ error: 'Location group not found' });
        }

        res.json(group);
    } catch (error) {
        console.error('Error fetching location group:', error);
        res.status(500).json({ error: 'Failed to fetch location group' });
    }
});

app.post('/api/:groupType(locations|zipcodes)/groups', [
    body('name')
        .isString()
        .trim()
        .isLength({ min: 1, max: 100 })
        .escape()
        .withMessage('Group name must be between 1-100 characters'),
    body('locations')
        .optional()
        .isArray()
        .withMessage('Locations must be an array'),
    body('locations.*.lat')
        .optional()
        .isFloat({ min: -90, max: 90 })
        .withMessage('Latitude must be between -90 and 90'),
    body('locations.*.lng')
        .optional()
        .isFloat({ min: -180, max: 180 })
        .withMessage('Longitude must be between -180 and 180'),
    body('locations.*.title')
        .optional()
        .isString()
        .trim()
        .isLength({ max: 200 })
        .escape()
        .withMessage('Title must be less than 200 characters'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { name, locations } = req.body;
        const { groupType } = req.params;
        const deviceId = req.deviceId;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        const group = await db.createLocationGroup(deviceId, name, locations || [], groupType);
        res.status(201).json(group);
    } catch (error) {
        console.error('Error creating location group:', error);
        res.status(500).json({ error: 'Failed to create location group' });
    }
});

app.put('/api/:groupType(locations|zipcodes)/groups/:id', [
    param('id').isUUID().withMessage('Invalid group ID'),
    body('name')
        .optional()
        .isString()
        .trim()
        .isLength({ min: 1, max: 100 })
        .escape()
        .withMessage('Group name must be between 1-100 characters'),
    body('locations')
        .optional()
        .isArray()
        .withMessage('Locations must be an array'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { id, groupType } = req.params;
        const { name, locations } = req.body;
        const deviceId = req.deviceId;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (locations !== undefined) updates.locations = locations;

        const updatedGroup = await db.updateLocationGroup(id, deviceId, updates, groupType);

        if (!updatedGroup) {
            return res.status(404).json({ error: 'Location group not found' });
        }

        res.json(updatedGroup);
    } catch (error) {
        console.error('Error updating location group:', error);
        if (error.message.includes('not found') || error.message.includes('access denied')) {
            res.status(404).json({ error: 'Location group not found' });
        } else {
            res.status(500).json({ error: 'Failed to update location group' });
        }
    }
});

app.delete('/api/:groupType(locations|zipcodes)/groups/:id', [
    param('id').isUUID().withMessage('Invalid group ID'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { id, groupType } = req.params;
        const deviceId = req.deviceId;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        await db.deleteLocationGroup(id, deviceId, groupType);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting location group:', error);
        if (error.message.includes('not found') || error.message.includes('access denied')) {
            res.status(404).json({ error: 'Location group not found' });
        } else {
            res.status(500).json({ error: 'Failed to delete location group' });
        }
    }
});

app.post('/api/:groupType(locations|zipcodes)/groups/:id/locations', [
    param('id').isUUID().withMessage('Invalid group ID'),
    body('lat')
        .isFloat({ min: -90, max: 90 })
        .withMessage('Latitude must be between -90 and 90'),
    body('lng')
        .isFloat({ min: -180, max: 180 })
        .withMessage('Longitude must be between -180 and 180'),
    body('title')
        .isString()
        .trim()
        .isLength({ min: 1, max: 200 })
        .escape()
        .withMessage('Title must be between 1-200 characters'),
    body('color')
        .optional()
        .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
        .withMessage('Color must be a valid hex color'),
    body('geometry')
        .optional()
        .isString()
        .withMessage('Geometry must be a string (GeoJSON)'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { id, groupType } = req.params;
        const { lat, lng, title, color, geometry } = req.body;
        const deviceId = req.deviceId;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        const locationData = {
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            title,
            color: color || '#3B82F6'
        };

        // Include geometry if provided
        if (geometry) {
            locationData.geometry = geometry;
        }

        const location = await db.addLocationToGroup(id, deviceId, locationData);
        res.status(201).json(location);
    } catch (error) {
        console.error('Error adding location:', error);
        if (error.message.includes('not found') || error.message.includes('access denied')) {
            res.status(404).json({ error: 'Location group not found' });
        } else {
            res.status(500).json({ error: 'Failed to add location' });
        }
    }
});

app.put('/api/:groupType(locations|zipcodes)/groups/:groupId/locations/:locationId', [
    param('groupId').isUUID().withMessage('Invalid group ID'),
    param('locationId').isUUID().withMessage('Invalid location ID'),
    body('color')
        .optional()
        .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
        .withMessage('Color must be a valid hex color'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { groupId, locationId, groupType } = req.params;
        const { color } = req.body;
        const deviceId = req.deviceId;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        const updates = {};
        if (color !== undefined) updates.color = color;

        const location = await db.updateLocation(groupId, locationId, deviceId, updates);
        res.json(location);
    } catch (error) {
        console.error('Error updating location:', error);
        if (error.message.includes('not found') || error.message.includes('access denied')) {
            res.status(404).json({ error: 'Location or group not found' });
        } else {
            res.status(500).json({ error: 'Failed to update location' });
        }
    }
});

app.put('/api/:groupType(locations|zipcodes)/groups/:groupId/locations/reorder', [
    param('groupId').isUUID().withMessage('Invalid group ID'),
    body('locationIds')
        .isArray()
        .withMessage('locationIds must be an array')
        .custom((value) => {
            if (value.length > 1000) {
                throw new Error('Too many location IDs');
            }
            return value.every(id => typeof id === 'string');
        }),
    handleValidationErrors
], async (req, res) => {
    try {
        const { groupId, groupType } = req.params;
        const { locationIds } = req.body;
        const deviceId = req.deviceId;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        await db.reorderLocations(groupId, deviceId, locationIds);

        // Get updated locations to return
        const locations = await db.getLocationsForGroup(groupId);
        res.json({ success: true, locations });
    } catch (error) {
        console.error('Error reordering locations:', error);
        if (error.message.includes('not found') || error.message.includes('access denied')) {
            res.status(404).json({ error: 'Location group not found' });
        } else {
            res.status(500).json({ error: 'Failed to reorder locations' });
        }
    }
});

app.delete('/api/:groupType(locations|zipcodes)/groups/:groupId/locations/:locationId', [
    param('groupId').isUUID().withMessage('Invalid group ID'),
    param('locationId').isUUID().withMessage('Invalid location ID'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { groupId, locationId, groupType } = req.params;
        const deviceId = req.deviceId;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        await db.deleteLocation(groupId, locationId, deviceId);
        res.status(204).send();
    } catch (error) {
        console.error('Error deleting location:', error);
        if (error.message.includes('not found') || error.message.includes('access denied')) {
            res.status(404).json({ error: 'Location or group not found' });
        } else {
            res.status(500).json({ error: 'Failed to delete location' });
        }
    }
});
}


// Initialize database and start server
async function startServer() {
    try {
        // Load ZIP code data and initialize database in parallel
        await Promise.all([
            loadZipcodeData(),
            initializeDatabase()
        ]);

        app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
            console.log('Database persistence enabled');
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    if (db) {
        db.close();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    if (db) {
        db.close();
    }
    process.exit(0);
});

startServer();