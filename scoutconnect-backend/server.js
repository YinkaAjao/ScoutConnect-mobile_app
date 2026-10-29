// server.js
// Composition root: builds the Express app, mounts the route modules and starts the server.
// The logic lives in routes/ (HTTP endpoints), middleware/ (who may call what), services/ (shared behaviour)
// and lib/ (pure, unit-tested rules).
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { sequelize, Player, ScoutAccessLog } = require('./models');
const { createNotifier } = require('./lib/notify');
const { createPhotoSigner } = require('./lib/photos');
const scouts = require('./lib/scouts');
const { SUPABASE_URL } = require('./config/supabase');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// --- GLOBAL REQUEST LOGGER ---
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] Incoming Request: ${req.method} ${req.url}`);
  next();
});

if (!process.env.JWT_SECRET) console.warn('⚠️ JWT_SECRET is not set: evaluation signatures use a weak fallback secret.');

// Email (Resend). Kept on app.locals so tests can swap in a fake. Without RESEND_API_KEY + MAIL_FROM it quietly does nothing.
app.locals.notifier = createNotifier({ apiKey: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM });
if (!app.locals.notifier.enabled) console.warn('⚠️ Email notifications are off: set RESEND_API_KEY and MAIL_FROM to turn them on.');

// Photos are in a private bucket; the server creates short-lived links for people allowed to see them.
// Without the project's service-role key no photo is shown (safer than falling back to public links).
app.locals.photos = createPhotoSigner({ supabaseUrl: SUPABASE_URL, serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
if (!app.locals.photos.enabled) console.warn('⚠️ Photos are off: set SUPABASE_SERVICE_ROLE_KEY so the server can create private photo links.');

// --- ROUTES (all under /api) ---
app.use('/api', require('./routes/public'));
app.use('/api', require('./routes/sync'));
app.use('/api', require('./routes/reports'));
app.use('/api', require('./routes/players'));
app.use('/api', require('./routes/account'));
app.use('/api', require('./routes/shortlist'));
app.use('/api', require('./routes/club'));
app.use('/api', require('./routes/roster'));
app.use('/api', require('./routes/verification'));
app.use('/api', require('./routes/accreditation'));
app.use('/api', require('./routes/contactRequests'));

// Malformed JSON bodies etc. should answer with JSON, not Express's HTML error page.
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Unexpected server error.' });
});

// Only start listening when run directly, so tests can import the app without a database.
if (require.main === module) {
  const PORT = process.env.PORT || 5000;
  sequelize.sync({ alter: true }).then(async () => {
    console.log('PostgreSQL Database synced.');
    const pruneLog = async () => {
      try {
        const removed = await scouts.pruneAccessLog(ScoutAccessLog);
        if (removed) console.log(`Removed ${removed} scout access log row(s) older than ${scouts.ACCESS_LOG_RETENTION_DAYS} days.`);
      } catch (error) {
        console.error('Could not prune the scout access log:', error.message);
      }
    };
    await pruneLog();
    setInterval(pruneLog, 24 * 60 * 60 * 1000).unref();

    try {
      const covered = await scouts.backfillConsentGrace(Player);
      if (covered) console.log(`Consent grace period started for ${covered} existing athlete(s).`);
    } catch (error) {
      console.error('Could not start the consent grace period:', error.message);
    }
    app.listen(PORT, () => console.log(`ScoutConnect API running on port ${PORT}`));
  });
}

module.exports = app;
