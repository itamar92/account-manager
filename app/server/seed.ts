import { db, uuid, hashPassword, getSetting, setSetting } from './db.js';

/**
 * The built-in default is a convenience for a laptop, not for a host on the public internet.
 * In production the seed refuses to run rather than create an owner account whose password is
 * published in this repository.
 */
function seedPassword(envVar: 'SEED_OWNER_PASSWORD', fallback: string): string {
  const value = process.env[envVar];
  if (value) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `${envVar} must be set on first run in production — refusing to seed the default password.`
    );
  }
  return fallback;
}

/** What the first-run owner account is called and logs in with. */
export const SEED_OWNER = {
  email: () => process.env.SEED_OWNER_EMAIL?.trim() || 'owner@example.com',
  name: () => process.env.SEED_OWNER_NAME?.trim() || 'בעל/ת העסק',
};

/**
 * Creates the one account a fresh database needs: the owner. Everything else — band members,
 * suppliers, clients, shows — is entered in the app or pulled in by the integrations (Morning
 * for invoices and expenses, Google Calendar for shows), so a new install starts empty rather
 * than with somebody else's books.
 */
export function runSeed() {
  if (getSetting('seeded', '') === 'true') return;

  const tx = db.transaction(() => {
    setSetting('vat_percent', '18');
    setSetting('app_name', 'Account Manager');

    const ownerPassword = seedPassword('SEED_OWNER_PASSWORD', 'changeme123');
    db.prepare('INSERT INTO users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .run(uuid(), SEED_OWNER.email(), SEED_OWNER.name(), hashPassword(ownerPassword), 'owner');

    setSetting('seeded', 'true');
  });

  tx();
  console.log(`[seed] database seeded (owner: ${SEED_OWNER.email()})`);
}
