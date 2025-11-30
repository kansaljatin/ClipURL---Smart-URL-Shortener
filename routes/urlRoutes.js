const express = require('express');
const { createShortUrl, redirectToLongUrl } = require('../controllers/urlController');

const router = express.Router();

// API route to create a short URL
router.post('/api/shorten', createShortUrl);

// Redirect route for short URLs
router.get('/:code', redirectToLongUrl);

module.exports = router;
