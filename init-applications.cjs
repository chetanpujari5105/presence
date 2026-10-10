// Run once (safe to re-run): node init-applications.cjs
const fs = require('node:fs');
const { neon } = require('@neondatabase/serverless');
if (fs.existsSync('.env.local')) process.loadEnvFile('.env.local');
const sql = neon(process.env.DATABASE_URL);

async function main() {
  await sql.transaction([
    sql.query(`CREATE TABLE IF NOT EXISTS model_applications (
      id SERIAL PRIMARY KEY,
      ref TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL,
      age INTEGER NOT NULL CHECK (age >= 18),
      city TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      portfolio_url TEXT NOT NULL DEFAULT '',
      experience TEXT NOT NULL DEFAULT '',
      services TEXT[] NOT NULL DEFAULT '{}',
      languages TEXT NOT NULL DEFAULT '',
      availability TEXT NOT NULL DEFAULT '',
      expected_rate INTEGER,
      boundaries TEXT NOT NULL DEFAULT '',
      about TEXT NOT NULL DEFAULT '',
      consent_version TEXT NOT NULL,
      consented_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'submitted'
        CHECK (status IN ('submitted','reviewing','interview','approved','not_selected')),
      admin_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'))`),
    sql.query(`CREATE UNIQUE INDEX IF NOT EXISTS one_open_application_per_email
      ON model_applications (lower(email)) WHERE status IN ('submitted','reviewing','interview')`),
  ]);
  console.log('model_applications table ready.');
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
