require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const cron = require('node-cron');
const path = require('path');
const crypto = require('crypto');

const { db, logActivity, getSetting, setSetting } = require('./db');
const seerr = require('./seerr');
const admins = require('./admins');

const app = express();
const PORT = process.env.PORT || 3000;

function getOrCreateSessionSecret() {
  // .env-variabele heeft voorrang (bv. als je 'm bewust wilt vastzetten,
  // zodat sessies een herstart/redeploy overleven zonder de db-volume).
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;

  const existing = getSetting('session_secret');
  if (existing) return existing;

  const generated = crypto.randomBytes(32).toString('hex');
  setSetting('session_secret', generated);
  console.log('[info] Geen SESSION_SECRET ingesteld - automatisch een gegenereerd en opgeslagen in de database.');
  return generated;
}

admins.migrateLegacyPasswordHash();

function paymentPeriodDays() {
  return Number(getSetting('payment_period_days', process.env.PAYMENT_PERIOD_DAYS || '30'));
}

function autoRevokeEnabled() {
  return (getSetting('auto_revoke', process.env.AUTO_REVOKE || 'false') || 'false') === 'true';
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(
  session({
    secret: getOrCreateSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }, // 8 uur
  })
);

// Zolang er nog geen enkel admin-account bestaat, sturen we alles (behalve
// de setup-route zelf en statische bestanden) naar /setup.
app.use((req, res, next) => {
  if (req.path === '/setup' || req.path.startsWith('/style.css')) return next();
  if (admins.adminCount() === 0 && req.path !== '/setup') {
    return res.redirect('/setup');
  }
  next();
});

function requireAuth(req, res, next) {
  if (req.session.adminId) return next();
  return res.redirect('/login');
}

app.use((req, res, next) => {
  res.locals.seerrConfigured = seerr.isConfigured();
  next();
});

// ---------- Eerste-keer setup ----------

app.get('/setup', (req, res) => {
  if (admins.adminCount() > 0) {
    return res.redirect('/login');
  }
  res.render('setup', { error: null });
});

app.post('/setup', async (req, res) => {
  if (admins.adminCount() > 0) {
    return res.redirect('/login');
  }
  const { username, password, password_confirm } = req.body;

  if (!username || !username.trim()) {
    return res.render('setup', { error: 'Vul een gebruikersnaam in.' });
  }
  if (!password || password.length < 8) {
    return res.render('setup', { error: 'Wachtwoord moet minimaal 8 tekens
