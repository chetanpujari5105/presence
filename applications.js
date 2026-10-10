/* Model applications — public form endpoint + protected review endpoints.
   Mounted from server.js (already wired in this version). */
const crypto = require('node:crypto');

const GENDERS = ['Male', 'Female', 'Other', 'Prefer not to say'];
const SERVICES = ['The Plus-One', 'The Carrier', 'Deep Yin Listening', 'Vent Work', 'The Silence', 'Flat-Pack Rescue'];
const EXPERIENCE = ['New to this', 'Under 1 year', '1-3 years', '3+ years'];
const STATUSES = ['submitted', 'reviewing', 'interview', 'approved', 'not_selected'];
const CONSENT_VERSION = '2026-10-v1';

module.exports = function mountApplications(app, { sql, rateLimit, clean, cleanMultiline, Oops, notify }) {
  const isEmail = v => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(v);
  const isUrl = v => { try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };

  async function newRef() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (;;) {
      let ref = 'APP-';
      for (const b of crypto.randomBytes(6)) ref += letters[b % letters.length];
      if (!(await sql.query('SELECT 1 FROM model_applications WHERE ref = $1', [ref]))[0]) return ref;
    }
  }

  app.post('/api/model-applications',
    rateLimit(5, 60 * 60 * 1000, 'too many applications from this connection — please try again later'),
    async (req, res) => {
      const b = req.body || {};
      if (b.website) return res.status(400).json({ error: 'something went wrong' });

      const name = clean(b.name, 100);
      const displayName = clean(b.displayName, 60);
      const gender = clean(b.gender, 30);
      const age = Number.parseInt(b.age, 10);
      const city = clean(b.city, 80);
      const phone = clean(b.phone, 30);
      const email = clean(b.email, 200).toLowerCase();
      const portfolio = clean(b.portfolioUrl, 300);
      const experience = clean(b.experience, 30);
      const languages = clean(b.languages, 150);
      const availability = clean(b.availability, 300);
      const boundaries = cleanMultiline(b.boundaries, 1000);
      const about = cleanMultiline(b.about, 1500);
      const rate = b.expectedRate === '' || b.expectedRate == null ? null : Number.parseInt(b.expectedRate, 10);
      const services = (Array.isArray(b.services) ? b.services : []).filter(s => SERVICES.includes(s)).slice(0, SERVICES.length);

      if (name.length < 2) throw new Oops(400, 'please enter your full name', 'name');
      if (!GENDERS.includes(gender)) throw new Oops(400, 'please choose an option', 'gender');
      if (!Number.isInteger(age) || age < 18 || age > 80) throw new Oops(400, 'applicants must be 18 or older', 'age');
      if (city.length < 2) throw new Oops(400, 'please enter your city', 'city');
      const digits = phone.replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15 || !/^[+\d\s()-]+$/.test(phone)) throw new Oops(400, 'that phone number does not look right', 'phone');
      if (!isEmail(email)) throw new Oops(400, 'that email does not look right', 'email');
      if (portfolio && !isUrl(portfolio)) throw new Oops(400, 'please enter a full link starting with https://', 'portfolioUrl');
      if (experience && !EXPERIENCE.includes(experience)) throw new Oops(400, 'please choose an option', 'experience');
      if (rate !== null && (!Number.isInteger(rate) || rate < 0 || rate > 1000000)) throw new Oops(400, 'please enter a valid amount', 'expectedRate');
      if (!services.length) throw new Oops(400, 'choose at least one service you are comfortable with', 'services');
      if (b.consent !== true) throw new Oops(400, 'please accept to continue', 'consent');

      const ref = await newRef();
      try {
        await sql.query(
          `INSERT INTO model_applications
            (ref, name, display_name, gender, age, city, phone, email, portfolio_url, experience, services,
             languages, availability, expected_rate, boundaries, about, consent_version, consented_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [ref, name, displayName, gender, age, city, phone, email, portfolio, experience, services,
           languages, availability, rate, boundaries, about, CONSENT_VERSION, new Date().toISOString()]);
      } catch (err) {
        if (err.code === '23505') throw new Oops(409, 'we already have an application open for this email', 'email');
        throw err;
      }

      // Keep personal details out of alerts/logs: reference + first name + city only.
      await notify(`New model application ${ref}`, [`${name.split(' ')[0]} · ${city}`, 'Open the admin applications page to review.']);
      res.status(201).json({ ref });
    });

  app.get('/api/admin/applications', async (req, res) => {
    const rows = await sql.query('SELECT * FROM model_applications ORDER BY id DESC LIMIT 500', []);
    res.json({ applications: rows, statuses: STATUSES });
  });

  app.patch('/api/admin/applications/:id', async (req, res) => {
    const id = Number(req.params.id);
    const status = req.body?.status === undefined ? null : String(req.body.status);
    const notes = req.body?.notes === undefined ? null : cleanMultiline(req.body.notes, 2000);
    if (status !== null && !STATUSES.includes(status)) throw new Oops(400, 'unknown status');
    const [row] = await sql.query(
      `UPDATE model_applications SET status = COALESCE($1, status), admin_notes = COALESCE($2, admin_notes)
       WHERE id = $3 RETURNING id`, [status, notes, id]);
    if (!row) throw new Oops(404, 'application not found');
    res.json({ ok: true });
  });
};
