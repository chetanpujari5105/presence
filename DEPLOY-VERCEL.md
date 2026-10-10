# Deploy Presence to Vercel (step by step)

Vercel detects `server.js` (exports the Express app) automatically; files in `public/` are served from its CDN.

## 1. Apply the patch (Rujul)
1. Copy these into the repo root: `vercel.json`, `applications.js`, `init-applications.cjs`.
2. Copy into `public/`: `apply.html`, `admin-applications.html`.
3. Add the single line from `PATCH-server.js.txt` to `server.js`.
4. Commit on a branch `feature/model-applications` and open a pull request.

## 2. Database (one time, against a STAGING Neon branch first)
```
echo DATABASE_URL=postgres://... > .env.local
node init-db.cjs
node init-applications.cjs
```
Only then run the same two commands against production.

## 3. Vercel project settings -> Environment Variables
Required: `DATABASE_URL`, `ADMIN_PASSWORD` (8+ chars, not the example value), `TIMEZONE=Asia/Kolkata`
Optional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SMTP_*`, `NOTIFY_EMAIL`, `PRICE_RUPEES`, `DAYS_AHEAD_LIMIT`
Leave `RAZORPAY_*` empty for now.
Use the Preview environment with a staging DATABASE_URL; use Production only with the production one.

## 4. Test the preview deployment
- `/` loads and the calendar shows slots
- Make a test booking -> appears in `/admin`
- `/apply` -> submit a test application -> appears in `/admin/applications`
- Public visitors get 401 on `/api/admin/applications`
Delete test rows afterwards.

## 5. Go live
Merge the PR, check the production deployment, add the custom domain in Vercel -> Settings -> Domains.
