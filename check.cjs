// Runnable integration check; temporary test rows are removed in finally.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
process.env.TRUST_PROXY = '1';
const app = require('./server');
delete require.cache[require.resolve('./server')];
const secondApp = require('./server');
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const marker = 'Deployment check ' + crypto.randomUUID();
const ip = '192.0.2.99';
const servers = [app.listen(0, '127.0.0.1'), secondApp.listen(0, '127.0.0.1')];
const tokens = [];
const rateMessages = ['that is a lot of booking attempts — please wait 15 minutes and try again', 'please wait a few minutes before joining more waitlists', 'too many attempts — wait 15 minutes'];
const rateKeys = rateMessages.map(message => crypto.createHash('sha256').update(`${message}:${ip}`).digest('hex'));

async function request(path, method = 'GET', body, token, instance = 0) {
  const url = `http://127.0.0.1:${servers[instance].address().port}${path}`;
  const res = await fetch(url, { method, headers: {
    'Content-Type': 'application/json', 'X-Forwarded-For': ip,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json() };
}

async function main() {
  try {
    await sql`DELETE FROM rate_limits WHERE key = ANY(${rateKeys})`;
    assert.equal((await request('/api/admin/bookings')).status, 401);
    const login = await request('/api/admin/login', 'POST', { password: process.env.ADMIN_PASSWORD });
    assert.equal(login.status, 200); const token = login.data.token; tokens.push(token);
    assert.equal((await request('/api/admin/bookings?show=all', 'GET', null, token, 1)).status, 200);
    const config = (await request('/api/config')).data;
    const schedule = (await request(`/api/slots?start=${config.today}&days=14`)).data.days;
    const day = schedule.find(day => day.date > config.today && day.slots.some(slot => slot.status === 'open'));
    assert.ok(day); const time = day.slots.find(slot => slot.status === 'open').time;
    const body = { name: marker, contact: '+919999999999', date: day.date, time, practice: 'The Plus-One', lady: true };
    assert.equal((await request('/api/bookings', 'POST', { ...body, date: 'invalid' })).status, 400);
    const results = await Promise.all([request('/api/bookings', 'POST', body), request('/api/bookings', 'POST', body, null, 1)]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
    assert.equal((await request(`/api/slots?start=${day.date}&days=1`)).data.days[0].slots.find(slot => slot.time === time).status, 'held');
    const [booking] = await sql`SELECT * FROM bookings WHERE name = ${marker}`; assert.ok(booking);
    assert.equal((await request(`/api/admin/bookings/${booking.id}`, 'PATCH', { status: 'confirmed' }, token)).status, 200);
    assert.equal((await request('/api/waitlist', 'POST', body)).status, 201);
    assert.equal((await request('/api/admin/waitlist', 'GET', null, token)).data.waitlist.filter(row => row.name === marker).length, 1);
    assert.equal((await request(`/api/admin/bookings/${booking.id}`, 'PATCH', { status: 'cancelled' }, token)).status, 200);
    assert.equal((await request('/api/admin/blocks', 'POST', { date: day.date, time, reason: marker }, token)).status, 201);
    assert.equal((await request('/api/bookings', 'POST', body)).status, 409);
    const [block] = await sql`SELECT id FROM blocks WHERE reason = ${marker}`;
    assert.equal((await request(`/api/admin/blocks/${block.id}`, 'DELETE', null, token)).status, 200);
    const [wait] = await sql`SELECT id FROM waitlist WHERE name = ${marker}`;
    assert.equal((await request(`/api/admin/waitlist/${wait.id}`, 'DELETE', null, token)).status, 200);
    assert.equal((await request(`/api/admin/bookings/${booking.id}`, 'DELETE', null, token)).status, 200);
    assert.equal((await request('/api/admin/logout', 'POST', {}, token, 1)).status, 200);
    assert.equal((await request('/api/admin/bookings', 'GET', null, token)).status, 401);
    for (let i = 0; i < 9; i++) assert.equal((await request('/api/admin/login', 'POST', { password: 'wrong' }, null, i % 2)).status, 401);
    assert.equal((await request('/api/admin/login', 'POST', { password: 'wrong' })).status, 429);
    console.log('PASS: booking persistence, duplicate prevention, validation, waitlist, blocks, admin across instances, logout, rate limits.');
  } finally {
    await sql.transaction([
      sql`DELETE FROM bookings WHERE name = ${marker}`, sql`DELETE FROM waitlist WHERE name = ${marker}`,
      sql`DELETE FROM blocks WHERE reason = ${marker}`, sql`DELETE FROM rate_limits WHERE key = ANY(${rateKeys})`,
      ...tokens.map(token => sql`DELETE FROM admin_sessions WHERE token_hash = ${crypto.createHash('sha256').update(token).digest('hex')}`),
    ]);
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });