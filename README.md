# Presence. — your website, now with a real backend

> **Note (Oct 2026):** the live version runs on **Vercel + Neon Postgres** — see `DEPLOY-VERCEL.md`.
> The steps below describe running it on your own computer; the "data/presence.db" file mentioned
> in older notes is no longer used (bookings live in Neon via `DATABASE_URL`).

You don't need to understand code to use this. Just follow the steps in order.

---

## What's in this folder?

| Thing | What it is | Do I touch it? |
|---|---|---|
| `START.bat` | **Double-click this to turn the website on.** | Yes, every time |
| `.env` | Your settings and password. Open it with Notepad. | Sometimes |
| `public/index.html` | Your website (the same design as before) | Only to change words or pictures |
| `public/admin.html` | Your private admin page | No |
| `public/apply.html` | Model application form | Only to change words |
| `public/admin-applications.html` | Review model applications | No |
| `server.js` | The "brain" that saves bookings | No |
| `applications.js` | Model application endpoints | No |
| `node_modules/` | Downloaded helper code | Never. You can ignore it. |

---

## 1. Turn it on (on your own computer)

1. Open the project folder
2. **Double-click `START.bat`**
3. A black window opens and your browser opens at **http://localhost:3000**
4. **Leave the black window open.** If you close it, the website turns off.

> "localhost" means "this computer". Only **you** can see it right now.

You need a `DATABASE_URL` (Neon Postgres connection string) in `.env` or `.env.local`.
Create the tables once with `node init-db.cjs` and `node init-applications.cjs`.

---

## 2. See your bookings (the admin page)

1. With the black window open, go to **http://localhost:3000/admin**
2. Type your password. It's in the `.env` file on the line `ADMIN_PASSWORD=`

On the admin page you can:

- **confirm** a booking. Then click her phone number: WhatsApp opens with a confirmation message already typed for you.
- **cancel** a booking. That hour becomes free again on the website.
- see the **waitlist** (people who wanted an hour that was taken)
- **block out time** (holidays, busy days) so nobody can book it
- open **model applications** to review people who applied to join

### Change your password
1. Right-click `.env` → **Open with** → **Notepad**
2. Change the text after `ADMIN_PASSWORD=` (at least 8 characters, no spaces)
3. Save (Ctrl + S)
4. Close the black window and double-click `START.bat` again

**Any time you change `.env`, restart by closing the black window and double-clicking START.bat again.**

---

## 3. Get booking alerts on your phone (Telegram, free, about 5 minutes)

1. Install **Telegram** on your phone and open it.
2. Search for **@BotFather** (it has a blue tick) and press **Start**.
3. Send it: `/newbot`
4. It asks for a name. Type anything, e.g. `Presence Bookings`
5. It asks for a username ending in `bot`.
6. It replies with a **token**. Copy it.
7. Open `.env` in Notepad and paste it after `TELEGRAM_BOT_TOKEN=`
8. Back in Telegram, open **your new bot** and send it any message (like "hi").
9. In your browser, go to `https://api.telegram.org/botTOKEN/getUpdates` (replace `TOKEN` with your token).
10. Look for `"chat":{"id":` followed by a number. Copy that number.
11. Paste it in `.env` after `TELEGRAM_CHAT_ID=`
12. Save `.env`, restart.

---

## 4. Email alerts (optional)

With Gmail: turn on 2-Step Verification, create an app password at https://myaccount.google.com/apppasswords, then in `.env`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=youraddress@gmail.com
SMTP_PASS=the16letterpassword
NOTIFY_EMAIL=youraddress@gmail.com
```

---

## 5. Put it on the internet

Use Vercel — follow `DEPLOY-VERCEL.md`.

---

## 6. Taking a deposit with Razorpay (optional, and only when you're ready)

1. Sign up at https://razorpay.com and finish their business verification (KYC).
2. Dashboard → **Account & Settings → API Keys → Generate Key**.
3. In `.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxx
   RAZORPAY_KEY_SECRET=xxxxx
   DEPOSIT_RUPEES=1000
   ```
   (Use `rzp_test_` keys first to try it without real money.)
4. Restart. Leave these empty and payments stay switched off.

---

## 7. Changing things

- **Hours on offer** (07:30, 10:00, 16:00, 19:00): change `SLOTS` near the top of `server.js` **and** the matching `<option>` lines in `public/index.html` (search for `07:30`). They must match.
- **Practices**: change `PRACTICES` in `server.js` **and** the `<option>` lines in `public/index.html` (search for `The Plus-One`).
- **Closed days**: `CLOSED_WEEKDAYS = [0]` in `server.js` (0 = Sunday, 6 = Saturday).
- Restart after any change.
