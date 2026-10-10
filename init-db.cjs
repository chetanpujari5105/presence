// Run once: node init-db.cjs --import-sqlite
const fs = require('node:fs');
const { neon } = require('@neondatabase/serverless');
if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY, ref TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      contact TEXT NOT NULL, date TEXT NOT NULL, time TEXT NOT NULL,
      practice TEXT NOT NULL, request TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', payment_status TEXT NOT NULL DEFAULT 'none',
      payment_order TEXT, payment_id TEXT,
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))`,
    `CREATE UNIQUE INDEX IF NOT EXISTS one_person_per_hour ON bookings(date, time)
      WHERE status IN ('pending', 'confirmed') AND time <> 'flexible'`,
    `CREATE TABLE IF NOT EXISTS waitlist (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, contact TEXT NOT NULL,
      date TEXT NOT NULL, time TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))`,
    `CREATE TABLE IF NOT EXISTS blocks (
      id SERIAL PRIMARY KEY, date TEXT NOT NULL, time TEXT, reason TEXT NOT NULL DEFAULT '')`,
    `CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, hits BIGINT[] NOT NULL, updated_at BIGINT NOT NULL)`,
  ];
  await sql.transaction(statements.map(query => sql.query(query)));
  if (process.argv.includes('--import-sqlite')) {
    const { DatabaseSync } = require('node:sqlite');
    const source = new DatabaseSync('data/presence.db', { readOnly: true });
    const queries = [];
    for (const table of ['bookings', 'waitlist', 'blocks']) {
      const rows = source.prepare(`SELECT * FROM ${table}`).all();
      for (const row of rows) {
        const columns = Object.keys(row);
        queries.push(sql.query(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(row)));
      }
      queries.push(sql.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`));
      console.log(`${table}: importing ${rows.length} rows`);
    }
    await sql.transaction(queries);
    source.close();
  }
  console.log('Neon database ready.');
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });