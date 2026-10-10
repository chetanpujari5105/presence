# Deploy Presence to Vercel (step by step)

Vercel detects `server.js` (exports the Express app) automatically; files in `public/` are served from its CDN.
`applications.js` is already wired into `server.js` in this version.

## 1. Database (one time, against a STAGING Neon branch first)
```
vercel env pull .env.local
node init-db.cjs
node init-applications.cjs
```
Run the same two commands against production only after testing.

## 2. Vercel project -> Settings -> Environment Variables
Required: `DATABASE_URL` (add the Neon integration under Storage), `ADMIN_PASSWORD` (8+ chars, not the example value), `TIMEZONE=Asia/Kolkata`
Optional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SMTP_*`, `NOTIFY_EMAIL`, `PRICE_RUPEES`, `DAYS_AHEAD_LIMIT`
Leave `RAZORPAY_*` empty for now.

## 3. Test after redeploying
- `/` loads and the calendar shows slots
- Make a test booking -> appears in `/admin`
- `/apply` -> submit a test application -> appears in `/admin/applications`
Delete test rows afterwards.
