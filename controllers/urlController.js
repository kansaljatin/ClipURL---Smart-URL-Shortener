const Url = require('../models/Url');
const { generateShortCode } = require('../utils/shortCode');
const { getRedisClient } = require('../config/redis');

const SHORT_CODE_LENGTH = process.env.SHORT_CODE_LENGTH || 7;

function getTtlSeconds(expiresAt) {
  if (!expiresAt) return null;
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return null;
  return Math.ceil(ms / 1000);
}

async function cacheUrlDoc(urlDoc) {
  const redis = getRedisClient();
  if (!redis) {
    console.log('[cacheUrlDoc] Redis client not initialised, skipping cache write');
    throw new Error('[cacheUrlDoc] Redis client not initialised, skipping cache write')
  }

  const key = `url:${urlDoc.code}`;
  const payload = JSON.stringify({
    longUrl: urlDoc.longUrl,
    expiresAt: urlDoc.expiresAt ? urlDoc.expiresAt.toISOString() : null,
  });

  const ttl = getTtlSeconds(urlDoc.expiresAt);

  console.log('[cacheUrlDoc] Writing key', key, 'ttlSeconds =', ttl ?? 'none');

  if (ttl) {
    await redis.set(key, payload, { EX: ttl });
  } else {
    await redis.set(key, payload);
  }
}

async function createShortUrl(req, res) {
  try {
    const { longUrl, customAlias, expiry } = req.body || {};

    console.log('[createShortUrl] Request received', { longUrl, customAlias, expiry });

    if (!longUrl) {
      console.log('[createShortUrl] Missing longUrl');
      return res.status(400).json({ error: 'longUrl is required' });
    }

    // Basic URL validation
    try {
      new URL(longUrl);
    } catch (e) {
      console.log('[createShortUrl] Invalid longUrl');
      return res.status(400).json({ error: 'Invalid longUrl' });
    }

    let code;
    let existing;

    if (customAlias && customAlias.trim() !== '') {
      const alias = String(customAlias).trim();
      console.log('[createShortUrl] Using custom alias', alias);

      // Allow only URL-safe characters for alias
      if (!/^[0-9a-zA-Z_-]{3,50}$/.test(alias)) {
        console.log('[createShortUrl] customAlias validation failed');
        return res.status(400).json({
          error: 'customAlias must be 3-50 characters, letters/numbers/-/_ only',
        });
      }

      existing = await Url.findOne({ code: alias });
      if (existing && existing.longUrl !== longUrl) {
        console.log('[createShortUrl] customAlias already in use for different URL');
        return res.status(409).json({ error: 'customAlias is already in use' });
      }

      code = alias;
    } else {
      let attempt = 0;
      const MAX_ATTEMPTS = 5;

      // Try until we find a unique (or same-URL) code
      while (true) {
        code = generateShortCode(longUrl, attempt, SHORT_CODE_LENGTH);
        console.log('[createShortUrl] Generated code', code, 'attempt', attempt);
        existing = await Url.findOne({ code });

        if (!existing || existing.longUrl === longUrl) {
          break;
        }

        attempt += 1;
        if (attempt > MAX_ATTEMPTS) {
          console.error('[createShortUrl] Failed to generate unique short code after attempts');
          return res.status(500).json({ error: 'Failed to generate unique short code' });
        }
      }
    }

    let expiresAt = null;
    if (expiry) {
      const exp = new Date(expiry);
      if (Number.isNaN(exp.getTime())) {
        console.log('[createShortUrl] Invalid expiry date', expiry);
        return res.status(400).json({ error: 'Invalid expiry date' });
      }
      if (exp.getTime() <= Date.now()) {
        console.log('[createShortUrl] Expiry date is in the past', exp.toISOString());
        return res.status(400).json({ error: 'Expiry must be in the future' });
      }
      expiresAt = exp;
    }

    // First write to the source of truth (MongoDB)
    let urlDoc;
    try {
      if (existing) {
        console.log('[createShortUrl] Updating existing URL document in DB');
        existing.longUrl = longUrl;
        existing.expiresAt = expiresAt;
        urlDoc = await existing.save();
      } else {
        console.log('[createShortUrl] Creating new URL document in DB');
        urlDoc = await Url.create({ code, longUrl, expiresAt });
      }
    } catch (dbErr) {
      // Handle duplicate key specially to keep the operation idempotent across instances
      if (dbErr.code === 11000) {
        console.warn('[createShortUrl] Duplicate key error for code', code, '- checking existing document');

        try {
          const existingDoc = await Url.findOne({ code });

          if (existingDoc && existingDoc.longUrl === longUrl) {
            // Another instance already created the same mapping; treat this as success
            const shortUrlExisting = `${req.protocol}://${req.get('host')}/${existingDoc.code}`;
            console.log(
              '[createShortUrl] Existing document matches longUrl; returning idempotent success with',
              shortUrlExisting
            );

            return res.json({
              shortUrl: shortUrlExisting,
              code: existingDoc.code,
              longUrl: existingDoc.longUrl,
              expiresAt: existingDoc.expiresAt,
            });
          }

          // Conflict: same code but different URL (e.g., custom alias clash)
          console.error('[createShortUrl] Duplicate key for different longUrl');
          return res
            .status(409)
            .json({ error: 'Short code already exists, please try again with another alias' });
        } catch (lookupErr) {
          console.error('[createShortUrl] Failed to look up existing document after 11000 error', lookupErr);
          return res.status(500).json({ error: 'Failed to resolve short URL conflict' });
        }
      }

      console.error('[createShortUrl] DB write failed', dbErr);
      return res.status(500).json({ error: 'Failed to save short URL' });
    }

    // Best-effort cache warmup: failure here does NOT affect the response
    try {
      console.log('[createShortUrl] Warming cache for code', urlDoc.code);
      await cacheUrlDoc(urlDoc);
    } catch (cacheErr) {
      console.warn('[createShortUrl] Failed to warm cache, continuing without cache', cacheErr);
    }

    const shortUrl = `${req.protocol}://${req.get('host')}/${urlDoc.code}`;

    console.log('[createShortUrl] Success, responding with shortUrl', shortUrl);

    return res.json({
      shortUrl,
      code: urlDoc.code,
      longUrl: urlDoc.longUrl,
      expiresAt: urlDoc.expiresAt,
    });
  } catch (err) {
    console.error('[createShortUrl] Unexpected error', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function redirectToLongUrl(req, res, next) {
  try {
    const { code } = req.params;
    console.log('[redirectToLongUrl] Request for code', code);

    // If looks like a static asset or empty, let other middleware handle it
    if (!code || code.includes('.')) {
      console.log('[redirectToLongUrl] Skipping, looks like static asset or empty');
      return next();
    }

    const redis = getRedisClient();
    const cacheKey = `url:${code}`;

    // 1. Try Redis cache first
    if (redis) {
      console.log('[redirectToLongUrl] Checking cache for key', cacheKey);
      const cached = await redis.get(cacheKey);
      if (cached) {
        console.log('[redirectToLongUrl] Cache hit for key', cacheKey);
        try {
          const data = JSON.parse(cached);

          if (data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now()) {
            console.log('[redirectToLongUrl] Cached URL expired, deleting from cache');
            // Expired in cache: remove and respond 410
            await redis.del(cacheKey);
            return res.status(410).send('Short URL has expired');
          }

          console.log('[redirectToLongUrl] Redirecting from cache to', data.longUrl);
          return res.redirect(data.longUrl);
        } catch (e) {
          console.error('[redirectToLongUrl] Failed to parse cached URL data', e);
        }
      } else {
        console.log('[redirectToLongUrl] Cache miss for key', cacheKey);
      }
    } else {
      console.log('[redirectToLongUrl] Redis client not initialised, skipping cache lookup');
    }

    // 2. Fallback to MongoDB
    console.log('[redirectToLongUrl] Querying MongoDB for code', code);
    const urlDoc = await Url.findOne({ code });

    if (!urlDoc) {
      console.log('[redirectToLongUrl] No document found in DB for code', code);
      return res.status(404).send('Short URL not found');
    }

    if (urlDoc.expiresAt && urlDoc.expiresAt.getTime() <= Date.now()) {
      console.log('[redirectToLongUrl] URL expired according to DB');
      return res.status(410).send('Short URL has expired');
    }

    // 3. Populate cache for subsequent reads
    try {
      console.log('[redirectToLongUrl] Populating cache for key', cacheKey);
      await cacheUrlDoc(urlDoc);
    } catch (cacheErr) {
      console.warn('[redirectToLongUrl] Failed in Populating cache for key', cacheKey , cacheErr);
    }

    console.log('[redirectToLongUrl] Redirecting to', urlDoc.longUrl);
    return res.redirect(urlDoc.longUrl);
  } catch (err) {
    console.error('[redirectToLongUrl] Error handling redirect', err);
    return res.status(500).send('Internal server error');
  }
}

module.exports = {
  createShortUrl,
  redirectToLongUrl,
};
