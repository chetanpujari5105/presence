/* =====================================================================
   Presence. — the backend
   ---------------------------------------------------------------------
   This one file is the whole "server". When you run `npm start`, it:

     1. shows your website (everything inside the /public folder)
     2. saves bookings + waitlist entries in a small database file
        (data/presence.db — it is created automatically)
     3. tells the website which hours are free / taken
     4. sends YOU a message (Telegram and/or email) for every booking
     5. gives you a private admin page at  /admin
     6. (optional) takes a deposit with Razorpay

   All your settings live in the file called  .env  (next to this file).
   ===================================================================== */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const express = require('express');

/* ---------------------------------------------------------------------
   0 · settings (read from the .env file)
--------------------------------------------------------------------- */
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
const LOCAL_ENV_FILE = path.join(__dirname, '.env.local');
if (fs.existsSync(LOCAL_ENV_FILE)) process.loadEnvFile(LOCAL_ENV_FILE);

const env = (key, fallback = '') => (process.env[key] ?? fallback).toString().trim();

const PORT = Number(env('PORT', '3000'));
const TIMEZONE = env('TIMEZONE', 'Asia/Kolkata');
const ADMIN_PASSWORD = env('ADMIN_PASSWORD');
const PRICE_RUPEES = Number(env('PRICE_RUPEES', '10000'));
const DAYS_AHEAD_LIMIT = Number(env('DAYS_AHEAD_LIMIT', '60'));

const TELEGRAM_BOT_TOKEN = env('TELEGRAM_BOT_TOKEN');
const TELEGRAM_CHAT_ID = env('TELEGRAM_CHAT_ID');

const SMTP_HOST = env('SMTP_HOST');
const SMTP_PORT = Number(env('SMTP_PORT', '465'));
const SMTP_USER = env('SMTP_USER');
const SMTP_PASS = env('SMTP_PASS');
const NOTIFY_EMAIL = env('NOTIFY_EMAIL');

const RAZORPAY_KEY_ID = env('RAZORPAY_KEY_ID');
const RAZORPAY_KEY_SECRET = env('RAZORPAY_KEY_SECRET');
const DEPOSIT_RUPEES = Number(env('DEPOSIT_RUPEES', '0'));
const PAYMENTS_ON = Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && DEPOSIT_RUPEES > 0);

const ADMIN_ON = ADMIN_PASSWORD.length >= 8 && ADMIN_PASSWORD !== 'change-me-please';

/* ---------------------------------------------------------------------
   1 · what you sell, and when (change these lists if you like —
       but keep them matching the <option>s in public/index.html)
--------------------------------------------------------------------- */
const SLOTS = [
  { time: '07:30', name: 'morning flow',    note: 'the good light · gentle pace' },
  { time: '10:00', name: 'brunch escort',   note: 'eggs · strong opinions' },
  { time: '16:00', name: 'the golden hour', note: 'photogenic decisions' },
  { time: '19:00', name: 'evening yin',     note: 'slow · deep · honest' },
];
const SLOT_TIMES = SLOTS.map(s => s.time);
const FLEXIBLE = 'flexible';

const PRACTICES = [
  'The Plus-One',
  'The Carrier',
  'Deep Yin Listening',
  'Vent Work',
  'The Silence',
  'Flat-Pack Rescue',
  'Surprise me — a curated mystery',
];

const CLOSED_WEEKDAYS = [0]; // 0 = Sunday (rest day). 6 = Saturday, etc.

/* ---------------------------------------------------------------------
   2 · the database
--------------------------------------------------------------------- */
const sql = neon(env('DATABASE_URL'));

/* ---------------------------------------------------------------------
   3 · small date helpers (everything is in YOUR timezone, not the
       server's — hosting computers usually run on UTC)
--------------------------------------------------------------------- */
function nowHere() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map(p => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}
function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function addDays(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
function weekday(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
const toMinutes = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/* ---------------------------------------------------------------------
   4 · availability — "is this hour free?"
--------------------------------------------------------------------- */
async function getSchedule(startDate, days) {
  const endDate = addDays(startDate, days - 1);
  const now = nowHere();

  const taken = new Set(
    (await sql.query(`SELECT date, time FROM bookings
                WHERE date BETWEEN $1 AND $2 AND status IN ('pending','confirmed')`, [startDate, endDate])).map(r => `${r.date} ${r.time}`),
  );
  const blocks = (await sql.query(`SELECT date, time, reason FROM blocks WHERE date BETWEEN $1 AND $2`, [startDate, endDate]));
  const dayBlocks = new Map(blocks.filter(b => !b.time).map(b => [b.date, b.reason]));
  const slotBlocks = new Set(blocks.filter(b => b.time).map(b => `${b.date} ${b.time}`));

  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const isPastDay = date < now.date;
    const closedReason = CLOSED_WEEKDAYS.includes(weekday(date))
      ? 'rest day'
      : dayBlocks.has(date) ? (dayBlocks.get(date) || 'unavailable') : null;

    out.push({
      date,
      weekday: weekday(date),
      closed: Boolean(closedReason) || isPastDay,
      closedReason: isPastDay ? 'in the past' : closedReason,
      slots: closedReason || isPastDay ? [] : SLOTS.map(s => {
        const key = `${date} ${s.time}`;
        let status = 'open';
        if (date === now.date && toMinutes(s.time) <= now.minutes) status = 'past';
        else if (taken.has(key) || slotBlocks.has(key)) status = 'held';
        return { ...s, status };
      }),
    });
  }
  return out;
}

/* ---------------------------------------------------------------------
   5 · notifications — you get a message for each booking
       (Telegram and/or email; if neither is set up, it is just
       printed in the black terminal window)
--------------------------------------------------------------------- */
let mailer = null;
if (SMTP_HOST && SMTP_USER && SMTP_PASS && NOTIFY_EMAIL) {
  const nodemailer = require('nodemailer');
  mailer = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

async function notify(subject, lines) {
  const text = [subject, '', ...lines].join('\n');
  console.log('\n🔔 ' + text.replace(/\n/g, '\n   ') + '\n');

  const jobs = [];
  if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
    jobs.push(
      fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
      }).then(async r => { if (!r.ok) throw new Error('Telegram said: ' + (await r.text())); }),
    );
  }
  if (mailer) {
    jobs.push(mailer.sendMail({ from: SMTP_USER, to: NOTIFY_EMAIL, subject, text }));
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === 'rejected') console.error('⚠️  notification failed:', r.reason?.message || r.reason);
}

/* ---------------------------------------------------------------------
   6 · Razorpay (only used if you fill in the RAZORPAY_ keys in .env)
--------------------------------------------------------------------- */
async function createRazorpayOrder(ref) {
  const auth = Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ amount: Math.round(DEPOSIT_RUPEES * 100), currency: 'INR', receipt: ref }),
  });
  if (!r.ok) throw new Error('Razorpay order failed: ' + (await r.text()));
  return r.json(); // { id, amount, currency, ... }
}
function razorpaySignatureOk(orderId, paymentId, signature) {
  const expected = crypto.createHmac('sha256', RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, String(signature || ''));
}

/* ---------------------------------------------------------------------
   7 · safety helpers
--------------------------------------------------------------------- */
function safeEqual(a, b) {
  const A = crypto.createHash('sha256').update(String(a)).digest();
  const B = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(A, B);
}

// "rate limit": one visitor can only do something N times per window
function rateLimit(max, windowMs, message) {
  return async (req, res, next) => {
    const key = crypto.createHash('sha256').update(`${message}:${req.ip}`).digest('hex');
    const now = Date.now();
    const cutoff = now - windowMs;
    await sql`DELETE FROM rate_limits WHERE updated_at < ${now - 86400000}`;
    const [row] = await sql`
      INSERT INTO rate_limits (key, hits, updated_at) VALUES (${key}, ARRAY[${now}::bigint], ${now})
      ON CONFLICT (key) DO UPDATE SET
        hits = ARRAY(SELECT hit FROM unnest(rate_limits.hits) AS hit WHERE hit > ${cutoff}) || ${now}::bigint,
        updated_at = ${now}
      WHERE (SELECT count(*) FROM unnest(rate_limits.hits) AS hit WHERE hit > ${cutoff}) < ${max}
      RETURNING cardinality(hits) AS count`;
    if (!row || row.count > max) return res.status(429).json({ error: message });
    next();
  };
}

const clean = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const cleanMultiline = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function newRef() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion
  for (;;) {
    let ref = 'PRS-';
    for (const b of crypto.randomBytes(6)) ref += letters[b % letters.length];
    if (!(await sql.query('SELECT 1 FROM bookings WHERE ref = $1', [ref]))[0]) return ref;
  }
}

class Oops extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}

// checks a date + time can actually be booked; throws a friendly error if not
async function assertBookable(date, time, { allowHeld = false } = {}) {
  if (!isRealDate(date)) throw new Oops(400, 'that date does not look right', 'f-date');
  const now = nowHere();
  if (date < now.date) throw new Oops(400, 'that date has already happened', 'f-date');
  if (daysBetween(now.date, date) > DAYS_AHEAD_LIMIT)
    throw new Oops(400, `bookings open ${DAYS_AHEAD_LIMIT} days ahead — a little closer, please`, 'f-date');

  const [day] = await getSchedule(date, 1);
  if (day.closed) throw new Oops(409, `that day is closed (${day.closedReason})`, 'f-date');

  if (time === FLEXIBLE) return;
  if (!SLOT_TIMES.includes(time)) throw new Oops(400, 'please choose one of the listed hours', 'f-time');
  const slot = day.slots.find(s => s.time === time);
  if (slot.status === 'past') throw new Oops(409, 'that hour has already passed today', 'f-time');
  if (slot.status === 'held' && !allowHeld) throw new Oops(409, 'that hour has just been held by someone else — pick another', 'f-time');
}

/* ---------------------------------------------------------------------
   8 · the web server
--------------------------------------------------------------------- */
const app = express();
if (env('TRUST_PROXY') === '1' || env('VERCEL') === '1') app.set('trust proxy', 1); // needed on Render/Railway etc.
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});
app.use(express.json({ limit: '20kb' }));

/* ---- public API (used by the website) ---- */

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.get('/api/config', async (req, res) => {
  res.json({
    timezone: TIMEZONE,
    today: nowHere().date,
    priceRupees: PRICE_RUPEES,
    maxDaysAhead: DAYS_AHEAD_LIMIT,
    payments: PAYMENTS_ON ? { provider: 'razorpay', keyId: RAZORPAY_KEY_ID, depositRupees: DEPOSIT_RUPEES } : null,
  });
});

// GET /api/slots               -> the next 7 days
// GET /api/slots?start=2026-10-09&days=1  -> one specific day
app.get('/api/slots', async (req, res) => {
  const today = nowHere().date;
  let start = typeof req.query.start === 'string' && isRealDate(req.query.start) ? req.query.start : today;
  if (start < today) start = today;
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 14);
  res.json({ today, days: await getSchedule(start, days) });
});

app.post('/api/bookings',
  rateLimit(10, 15 * 60 * 1000, 'that is a lot of booking attempts — please wait 15 minutes and try again'),
  async (req, res) => {
    const b = req.body || {};

    // "honeypot": a hidden box real people never fill in. Bots do.
    if (b.website) return res.status(400).json({ error: 'something went wrong' });

    const name = clean(b.name, 80);
    const contact = clean(b.contact, 30);
    const date = clean(b.date, 10);
    const time = clean(b.time, 10);
    const practice = clean(b.practice, 80);
    const request = cleanMultiline(b.request, 1000);

    if (name.length < 2) throw new Oops(400, 'the gentleman needs a name to whisper politely', 'f-name');
    const digits = contact.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15 || !/^[+\d\s()-]+$/.test(contact))
      throw new Oops(400, 'that phone number does not look right', 'f-contact');
    if (!PRACTICES.includes(practice)) throw new Oops(400, 'every hour needs a shape — choose a practice', 'f-practice');
    if (b.lady !== true) throw new Oops(400, 'the ladies-only clause is load-bearing', 'f-lady');
    await assertBookable(date, time);

    const ref = await newRef();
    try {
      await sql.query(`INSERT INTO bookings (ref, name, contact, date, time, practice, request, payment_status)
                  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [ref, name, contact, date, time, practice, request, PAYMENTS_ON ? 'awaiting' : 'none']);
    } catch (err) {
      if (err.code === '23505') throw new Oops(409, 'that hour has just been held by someone else — pick another', 'f-time');
      throw err;
    }

    let payment = null;
    if (PAYMENTS_ON) {
      try {
        const order = await createRazorpayOrder(ref);
        await sql.query('UPDATE bookings SET payment_order = $1 WHERE ref = $2', [order.id, ref]);
        payment = { keyId: RAZORPAY_KEY_ID, orderId: order.id, amount: order.amount, currency: order.currency };
      } catch (err) {
        console.error('⚠️ ', err.message); // booking still stands — you can collect payment manually
      }
    }

    await notify(`New booking ${ref}`, [
      `Name: ${name}`,
      `Phone: ${contact}`,
      `Date: ${date}`,
      `Hour: ${time}`,
      `Practice: ${practice}`,
      `Request: ${request || '—'}`,
      '',
      'Confirm it on the admin page, then message her on WhatsApp.',
    ]);

    res.status(201).json({ ref, name, date, time, practice, request, payment });
  });

app.post('/api/bookings/:ref/payment', async (req, res) => {
  if (!PAYMENTS_ON) throw new Oops(404, 'payments are switched off');
  const booking = (await sql.query('SELECT * FROM bookings WHERE ref = $1', [String(req.params.ref)]))[0];
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!booking || booking.payment_order !== razorpay_order_id || !razorpaySignatureOk(razorpay_order_id, razorpay_payment_id, razorpay_signature))
    throw new Oops(400, 'we could not verify that payment');
  await sql.query(`UPDATE bookings SET payment_status = 'paid', payment_id = $1 WHERE id = $2`, [String(razorpay_payment_id), booking.id]);
  await notify(`Deposit paid for ${booking.ref}`, [`${booking.name} paid ₹${DEPOSIT_RUPEES}.`, `Payment id: ${razorpay_payment_id}`]);
  res.json({ ok: true });
});

app.post('/api/waitlist',
  rateLimit(5, 15 * 60 * 1000, 'please wait a few minutes before joining more waitlists'),
  async (req, res) => {
    const b = req.body || {};
    if (b.website) return res.status(400).json({ error: 'something went wrong' });
    const name = clean(b.name, 80);
    const contact = clean(b.contact, 30);
    const date = clean(b.date, 10);
    const time = clean(b.time, 10);
    if (name.length < 2) throw new Oops(400, 'a name, please');
    const digits = contact.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) throw new Oops(400, 'that phone number does not look right');
    await assertBookable(date, time, { allowHeld: true });

    await sql.query('INSERT INTO waitlist (name, contact, date, time) VALUES ($1, $2, $3, $4)', [name, contact, date, time]);
    await notify('New waitlist entry', [`${name} (${contact}) wants ${date} at ${time} if it frees up.`]);
    res.status(201).json({ ok: true });
  });

/* ---- admin API (password protected) ---- */

const sessionHash = token => crypto.createHash('sha256').update(token).digest('hex');
const SESSION_MS = 12 * 60 * 60 * 1000;

app.post('/api/admin/login',
  rateLimit(10, 15 * 60 * 1000, 'too many attempts — wait 15 minutes'),
  async (req, res) => {
    if (!ADMIN_ON) throw new Oops(503, 'Admin is switched off. Set ADMIN_PASSWORD (at least 8 characters) in the .env file and restart.');
    if (!safeEqual(String(req.body?.password || ''), ADMIN_PASSWORD)) throw new Oops(401, 'wrong password');
    const token = crypto.randomBytes(32).toString('hex');
    await sql`DELETE FROM admin_sessions WHERE expires_at < ${Date.now()}`;
    await sql`INSERT INTO admin_sessions (token_hash, expires_at) VALUES (${sessionHash(token)}, ${Date.now() + SESSION_MS})`;
    res.json({ token });
  });

async function requireAdmin(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [session] = await sql`SELECT expires_at FROM admin_sessions WHERE token_hash = ${sessionHash(token)}`;
  const expiry = session?.expires_at;
  if (!token || !expiry || expiry < Date.now()) {
    await sql`DELETE FROM admin_sessions WHERE token_hash = ${sessionHash(token)}`;
    return res.status(401).json({ error: 'please log in again' });
  }
  next();
}
app.use('/api/admin', requireAdmin);

app.post('/api/admin/logout', async (req, res) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  await sql`DELETE FROM admin_sessions WHERE token_hash = ${sessionHash(token)}`;
  res.json({ ok: true });
});

app.get('/api/admin/bookings', async (req, res) => {
  const show = String(req.query.show || 'upcoming');
  const today = nowHere().date;
  const rows = show === 'all'
    ? (await sql.query('SELECT * FROM bookings ORDER BY date DESC, time DESC', []))
    : (await sql.query(`SELECT * FROM bookings WHERE date >= $1 AND status <> 'cancelled' ORDER BY date, time`, [today]));
  res.json({ bookings: rows });
});

app.patch('/api/admin/bookings/:id', async (req, res) => {
  const status = String(req.body?.status || '');
  if (!['pending', 'confirmed', 'cancelled'].includes(status)) throw new Oops(400, 'unknown status');
  const booking = (await sql.query('SELECT * FROM bookings WHERE id = $1', [Number(req.params.id)]))[0];
  if (!booking) throw new Oops(404, 'booking not found');
  try {
    await sql.query('UPDATE bookings SET status = $1 WHERE id = $2', [status, booking.id]);
  } catch (err) {
    if (err.code === '23505') throw new Oops(409, 'someone else already holds that hour, so this one cannot be re-activated');
    throw err;
  }
  res.json({ ok: true });
});

app.delete('/api/admin/bookings/:id', async (req, res) => {
  await sql.query('DELETE FROM bookings WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

app.get('/api/admin/waitlist', async (req, res) => {
  res.json({ waitlist: (await sql.query('SELECT * FROM waitlist WHERE date >= $1 ORDER BY date, time, id', [nowHere().date])) });
});

app.delete('/api/admin/waitlist/:id', async (req, res) => {
  await sql.query('DELETE FROM waitlist WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

app.get('/api/admin/blocks', async (req, res) => {
  res.json({ blocks: (await sql.query('SELECT * FROM blocks WHERE date >= $1 ORDER BY date, time', [nowHere().date])), slotTimes: SLOT_TIMES });
});

app.post('/api/admin/blocks', async (req, res) => {
  const date = clean(req.body?.date, 10);
  const time = clean(req.body?.time, 10) || null;
  const reason = clean(req.body?.reason, 120);
  if (!isRealDate(date)) throw new Oops(400, 'pick a date');
  if (time && !SLOT_TIMES.includes(time)) throw new Oops(400, 'pick one of the listed hours, or leave it empty for the whole day');
  await sql.query('INSERT INTO blocks (date, time, reason) VALUES ($1, $2, $3)', [date, time, reason]);
  res.status(201).json({ ok: true });
});

app.delete('/api/admin/blocks/:id', async (req, res) => {
  await sql.query('DELETE FROM blocks WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

/* ---- model applications (public form + admin review) ---- */
require('./applications')(app, { sql, rateLimit, clean, cleanMultiline, Oops, notify });

/* ---- pages ---- */
app.get(['/admin', '/admin/'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use('/api', (req, res) => res.status(404).json({ error: 'no such address' }));

/* ---- errors: always answer with a friendly message ---- */
app.use((err, req, res, next) => {
  if (err instanceof Oops) return res.status(err.status).json({ error: err.message, field: err.field });
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large')
    return res.status(400).json({ error: 'that request did not make sense' });
  console.error('💥', err);
  res.status(500).json({ error: 'something broke on our side — please try again' });
});

module.exports = app;

if (require.main === module) app.listen(PORT, () => {
  console.log('');
  console.log('  ✅ Presence is running!');
  console.log(`     website : http://localhost:${PORT}`);
  console.log(`     admin   : http://localhost:${PORT}/admin`);
  console.log('');
  console.log(`     admin login     : ${ADMIN_ON ? 'on' : 'OFF — set ADMIN_PASSWORD in .env'}`);
  console.log(`     telegram alerts : ${TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID ? 'on' : 'off'}`);
  console.log(`     email alerts    : ${mailer ? 'on' : 'off'}`);
  console.log(`     payments        : ${PAYMENTS_ON ? `on (₹${DEPOSIT_RUPEES} deposit)` : 'off'}`);
  console.log('');
  console.log('  Keep this window open. Close it (or press Ctrl + C) to stop the server.');
  console.log('');
});