const bcrypt = require('bcryptjs');
const { db } = require('./db');

function adminCount() {
  return db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
}

function findByUsername(username) {
  return db
    .prepare('SELECT * FROM admins WHERE username = ?')
    .get((username || '').trim().toLowerCase());
}

function findById(id) {
  return db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
}

async function createAdmin(username, password) {
  const hash = await bcrypt.hash(password, 12);
  const info = db
    .prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
    .run(username.trim().toLowerCase(), hash);
  return findById(info.lastInsertRowid);
}

async function verifyPassword(admin, password) {
  return bcrypt.compare(password || '', admin.password_hash);
}

async function updatePassword(id, newPassword) {
  const hash = await bcrypt.hash(newPassword, 12);
  db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(hash, id);
}

function updateUsername(id, newUsername) {
  db.prepare('UPDATE admins SET username = ? WHERE id = ?').run(
    newUsername.trim().toLowerCase(),
    id
  );
}

/**
 * Compatibiliteit met oudere installaties die nog met een
 * ADMIN_PASSWORD_HASH env-variabele werkten: als er nog geen enkel
 * account bestaat maar wel die env-var, zetten we 'm automatisch om naar
 * een echt account met gebruikersnaam "admin", zodat je niet opnieuw
 * hoeft in te loggen na de update.
 */
function migrateLegacyPasswordHash() {
  if (adminCount() > 0) return;
  const legacyHash = process.env.ADMIN_PASSWORD_HASH;
  if (!legacyHash) return;
  db.prepare(
    'INSERT INTO admins (username, password_hash) VALUES (?, ?)'
  ).run('admin', legacyHash);
  console.log(
    '[migratie] Bestaand ADMIN_PASSWORD_HASH omgezet naar account "admin". Je kan hiermee inloggen en het wachtwoord/gebruikersnaam daarna wijzigen bij Instellingen.'
  );
}

module.exports = {
  adminCount,
  findByUsername,
  findById,
  createAdmin,
  verifyPassword,
  updatePassword,
  updateUsername,
  migrateLegacyPasswordHash,
};
