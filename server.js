require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { body, param, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

// Import database and middleware
const DatabaseService = require('./db/database');
const DeviceIdMiddleware = require('./middleware/deviceId');

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

// Initialize database and device ID middleware
let db;
let deviceIdMiddleware;

async function initializeDatabase() {
    try {
        db = new DatabaseService();
        await db.initialize();

        deviceIdMiddleware = new DeviceIdMiddleware(db);

        // Apply device ID middleware to all API routes
        app.use('/api/', deviceIdMiddleware.middleware());

        // Define routes after middleware is set up
        defineRoutes();

        console.log('Database and middleware initialized successfully');
    } catch (error) {
        console.error('Failed to initialize database:', error);
        process.exit(1);
    }
}

function defineRoutes() {
    // Security: Simple referrer check for API key endpoint
    app.get('/api/config', (req, res) => {
    const referrer = req.get('Referrer') || req.get('Referer');
    const allowedReferrers = process.env.NODE_ENV === 'production'
        ? ['https://yourdomain.com'] // Replace with your actual domain
        : ['http://localhost:3000', 'http://127.0.0.1:3000'];

    // Check if request is from allowed referrer or no referrer (for direct file access)
    if (referrer && !allowedReferrers.some(allowed => referrer.startsWith(allowed))) {
        return res.status(403).json({ error: 'Forbidden' });
    }

    res.json({
        googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY
    });
});

app.get('/api/location-groups', async (req, res) => {
    try {
        const deviceId = req.deviceId;
        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        const groups = await db.getLocationGroups(deviceId);
        res.json(groups);
    } catch (error) {
        console.error('Error fetching location groups:', error);
        res.status(500).json({ error: 'Failed to fetch location groups' });
    }
});

app.get('/api/location-groups/:id', [
    param('id').isUUID().withMessage('Invalid group ID'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { id } = req.params;
        const deviceId = req.deviceId;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        const group = await db.getLocationGroup(id, deviceId);

        if (!group) {
            return res.status(404).json({ error: 'Location group not found' });
        }

        res.json(group);
    } catch (error) {
        console.error('Error fetching location group:', error);
        res.status(500).json({ error: 'Failed to fetch location group' });
    }
});

app.post('/api/location-groups', [
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
        const deviceId = req.deviceId;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        const group = await db.createLocationGroup(deviceId, name, locations || []);
        res.status(201).json(group);
    } catch (error) {
        console.error('Error creating location group:', error);
        res.status(500).json({ error: 'Failed to create location group' });
    }
});

app.put('/api/location-groups/:id', [
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
        const { id } = req.params;
        const { name, locations } = req.body;
        const deviceId = req.deviceId;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        const updates = {};
        if (name !== undefined) updates.name = name;
        if (locations !== undefined) updates.locations = locations;

        const updatedGroup = await db.updateLocationGroup(id, deviceId, updates);

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

app.delete('/api/location-groups/:id', [
    param('id').isUUID().withMessage('Invalid group ID'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { id } = req.params;
        const deviceId = req.deviceId;

        if (!deviceId) {
            return res.status(400).json({ error: 'Device ID not found' });
        }

        await db.deleteLocationGroup(id, deviceId);
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

app.post('/api/location-groups/:id/locations', [
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
    handleValidationErrors
], async (req, res) => {
    try {
        const { id } = req.params;
        const { lat, lng, title, color } = req.body;
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

app.put('/api/location-groups/:groupId/locations/:locationId', [
    param('groupId').isUUID().withMessage('Invalid group ID'),
    param('locationId').isUUID().withMessage('Invalid location ID'),
    body('color')
        .optional()
        .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
        .withMessage('Color must be a valid hex color'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { groupId, locationId } = req.params;
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

app.put('/api/location-groups/:groupId/locations/reorder', [
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
        const { groupId } = req.params;
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

app.delete('/api/location-groups/:groupId/locations/:locationId', [
    param('groupId').isUUID().withMessage('Invalid group ID'),
    param('locationId').isUUID().withMessage('Invalid location ID'),
    handleValidationErrors
], async (req, res) => {
    try {
        const { groupId, locationId } = req.params;
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

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Initialize database and start server
async function startServer() {
    try {
        await initializeDatabase();

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