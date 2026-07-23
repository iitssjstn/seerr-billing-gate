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
    return res.render('setup', { error: 'Wachtwoord moet minimaal 8 tekens zijn.' });
  }
  if (password !== password_confirm) {
    return res.render('setup', { error: 'Wachtwoorden komen niet overeen.' });
  }

  const admin = await admins.createAdmin(username, password);
  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  res.redirect('/');
});

// ---------- Auth ----------

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const admin = admins.findByUsername(username || '');
  if (!admin) {
    return res.render('login', { error: 'Onjuiste gebruikersnaam of wachtwoord.' });
  }
  const ok = await admins.verifyPassword(admin, password);
  if (!ok) {
    return res.render('login', { error: 'Onjuiste gebruikersnaam of wachtwoord.' });
  }
  req.session.adminId = admin.id;
  req.session.adminUsername = admin.username;
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---------- Dashboard ----------

app.get('/', requireAuth, (req, res) => {
  const members = db
    .prepare('SELECT * FROM members ORDER BY name COLLATE NOCASE ASC')
    .all();
  res.render('dashboard', {
    members,
    today: new Date().toISOString().slice(0, 10),
    error: req.query.error || null,
    message: req.query.message || null,
  });
});

// ---------- Instellingen ----------

app.get('/settings', requireAuth, (req, res) => {
  const { url, apiKey } = seerr.getConfig();
  res.render('settings', {
    seerrUrl: url,
    hasApiKey: Boolean(apiKey),
    paymentPeriodDays: paymentPeriodDays(),
    autoRevoke: autoRevokeEnabled(),
    adminUsername: req.session.adminUsername,
    error: req.query.error || null,
    message: req.query.message || null,
  });
});

app.post('/settings', requireAuth, (req, res) => {
  const { seerr_url, seerr_api_key, payment_period_days, auto_revoke } = req.body;

  if (!seerr_url || !seerr_url.trim()) {
    return res.redirect('/settings?error=' + encodeURIComponent('Vul een Seerr-URL in.'));
  }

  setSetting('seerr_url', seerr_url.trim().replace(/\/+$/, ''));

  if (seerr_api_key && seerr_api_key.trim()) {
    setSetting('seerr_api_key', seerr_api_key.trim());
  }

  setSetting('payment_period_days', String(Number(payment_period_days) || 30));
  setSetting('auto_revoke', auto_revoke === 'on' ? 'true' : 'false');

  res.redirect('/settings?message=' + encodeURIComponent('Instellingen opgeslagen'));
});

app.post('/settings/test', requireAuth, async (req, res) => {
  try {
    await seerr.testConnection();
    res.redirect('/settings?message=' + encodeURIComponent('Verbinding met Seerr gelukt!'));
  } catch (e) {
    const detail = e.response?.data?.message || e.message;
    res.redirect('/settings?error=' + encodeURIComponent('Verbinding mislukt: ' + detail));
  }
});

// ---------- Eigen account (gebruikersnaam/wachtwoord wijzigen) ----------

app.post('/account', requireAuth, async (req, res) => {
  const { current_password, new_username, new_password, new_password_confirm } = req.body;

  const admin = admins.findById(req.session.adminId);
  if (!admin) return res.redirect('/login');

  const ok = await admins.verifyPassword(admin, current_password);
  if (!ok) {
    return res.redirect('/settings?error=' + encodeURIComponent('Huidig wachtwoord is onjuist.'));
  }

  if (new_username && new_username.trim() && new_username.trim().toLowerCase() !== admin.username) {
    const existing = admins.findByUsername(new_username);
    if (existing) {
      return res.redirect('/settings?error=' + encodeURIComponent('Die gebruikersnaam is al in gebruik.'));
    }
    admins.updateUsername(admin.id, new_username);
    req.session.adminUsername = new_username.trim().toLowerCase();
  }

  if (new_password && new_password.trim()) {
    if (new_password.length < 8) {
      return res.redirect('/settings?error=' + encodeURIComponent('Nieuw wachtwoord moet minimaal 8 tekens zijn.'));
    }
    if (new_password !== new_password_confirm) {
      return res.redirect('/settings?error=' + encodeURIComponent('Nieuwe wachtwoorden komen niet overeen.'));
    }
    await admins.updatePassword(admin.id, new_password);
  }

  res.redirect('/settings?message=' + encodeURIComponent('Account bijgewerkt'));
});

// ---------- Leden beheren ----------

app.post('/members', requireAuth, (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) {
    return res.redirect('/?error=Naam en e-mail zijn verplicht');
  }
  try {
    db.prepare(
      'INSERT INTO members (name, email, status) VALUES (?, ?, ?)'
    ).run(name.trim(), email.trim().toLowerCase(), 'inactive');
    res.redirect('/?message=Lid toegevoegd');
  } catch (e) {
    res.redirect('/?error=Kon lid niet toevoegen (bestaat het e-mailadres al?)');
  }
});

app.post('/members/:id/mark-paid', requireAuth, async (req, res) => {
  if (!seerr.isConfigured()) {
    return res.redirect('/?error=' + encodeURIComponent('Koppel eerst Seerr bij Instellingen voor je leden kan activeren.'));
  }

  const member = db
    .prepare('SELECT * FROM members WHERE id = ?')
    .get(req.params.id);
  if (!member) return res.redirect('/?error=Lid niet gevonden');

  try {
    const seerrUser = await seerr.ensureUser({
      email: member.email,
      username: member.name,
    });

    const paidUntil = new Date();
    paidUntil.setDate(paidUntil.getDate() + paymentPeriodDays());

    db.prepare(
      `UPDATE members
       SET status = 'active', seerr_user_id = ?, paid_until = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(seerrUser.id, paidUntil.toISOString().slice(0, 10), member.id);

    logActivity(member.id, 'mark_paid', `paid_until=${paidUntil.toISOString().slice(0, 10)}`);
    res.redirect('/?message=' + encodeURIComponent(`${member.name} is actief tot ${paidUntil.toISOString().slice(0, 10)}`));
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.redirect('/?error=' + encodeURIComponent('Kon Seerr-account niet aanmaken/koppelen: ' + (e.response?.data?.message || e.message)));
  }
});

app.post('/members/:id/revoke', requireAuth, async (req, res) => {
  const member = db
    .prepare('SELECT * FROM members WHERE id = ?')
    .get(req.params.id);
  if (!member) return res.redirect('/?error=Lid niet gevonden');

  try {
    if (member.seerr_user_id) {
      await seerr.deleteUser(member.seerr_user_id);
    }
    db.prepare(
      `UPDATE members
       SET status = 'inactive', seerr_user_id = NULL, updated_at = datetime('now')
       WHERE id = ?`
    ).run(member.id);

    logActivity(member.id, 'revoke');
    res.redirect('/?message=' + encodeURIComponent(`Toegang van ${member.name} ingetrokken`));
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.redirect('/?error=' + encodeURIComponent('Kon Seerr-account niet verwijderen: ' + (e.response?.data?.message || e.message)));
  }
});

app.post('/members/:id/delete', requireAuth, async (req, res) => {
  const member = db
    .prepare('SELECT * FROM members WHERE id = ?')
    .get(req.params.id);
  if (!member) return res.redirect('/?error=Lid niet gevonden');

  try {
    if (member.seerr_user_id) {
      await seerr.deleteUser(member.seerr_user_id).catch(() => {});
    }
    db.prepare('DELETE FROM members WHERE id = ?').run(member.id);
    res.redirect('/?message=Lid verwijderd');
  } catch (e) {
    res.redirect('/?error=Kon lid niet verwijderen');
  }
});

// ---------- Dagelijkse check: vervallen betalingen automatisch intrekken ----------

async function runExpiryCheck() {
  if (!autoRevokeEnabled() || !seerr.isConfigured()) return;
  const today = new Date().toISOString().slice(0, 10);
  const expired = db
    .prepare(
      "SELECT * FROM members WHERE status = 'active' AND paid_until IS NOT NULL AND paid_until < ?"
    )
    .all(today);

  for (const member of expired) {
    try {
      if (member.seerr_user_id) {
        await seerr.deleteUser(member.seerr_user_id);
      }
      db.prepare(
        `UPDATE members SET status = 'inactive', seerr_user_id = NULL, updated_at = datetime('now') WHERE id = ?`
      ).run(member.id);
      logActivity(member.id, 'auto_revoke', 'paid_until verstreken');
      console.log(`[cron] Toegang ingetrokken voor ${member.email} (contributie verlopen)`);
    } catch (e) {
      console.error(`[cron] Kon toegang van ${member.email} niet intrekken:`, e.message);
    }
  }
}

// elke dag om 04:00
cron.schedule('0 4 * * *', runExpiryCheck);

app.listen(PORT, () => {
  console.log(`seerr-billing-gate draait op poort ${PORT}`);
  console.log(
    admins.adminCount() === 0
      ? 'Nog geen admin-account - ga naar /setup om er een aan te maken'
      : 'Admin-account: aanwezig'
  );
  console.log(
    seerr.isConfigured()
      ? 'Seerr-koppeling: actief'
      : 'Seerr-koppeling: nog niet ingesteld - ga naar /settings'
  );
});
