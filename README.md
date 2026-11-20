# mFinance

A personal finance ledger for people with irregular income. It runs as an installable web app (PWA) on phone and desktop, works offline, and can sync between devices.

No framework and no build step: plain HTML, CSS and JavaScript. The interface is in Turkish.

## Features

- **Ledger:** income and expenses in TRY, USD, EUR and GBP with hourly exchange rates, recurring payments, categories and a monthly budget.
- **Offline first:** all data lives on the device; a service worker caches the app.
- **Sync across devices (optional):** Supabase stores one row per user, protected by row-level security. Devices merge with a last-write-wins strategy that keeps tombstones for deleted records, so a delete on one device is not undone by another (`js/merge.js`).
- **App lock:** PIN lock with PBKDF2 key derivation and AES-GCM encryption through the WebCrypto API, plus optional biometric unlock through WebAuthn (`js/lock.js`).
- **Reminders:** web push notifications for upcoming payments, sent by a daily serverless cron job (`api/daily.js`, `api/push.js`).
- **Demo mode:** generates six months of sample data so you can try the app without an account.

## Structure

| Path | Purpose |
| --- | --- |
| `index.html`, `css/`, `js/app.js` | The app |
| `js/lock.js` | PIN and biometric lock |
| `js/merge.js` | Sync merge logic |
| `js/config.js` | Supabase URL, publishable key and public VAPID key (left empty here) |
| `sw.js` | Service worker: offline cache and push handling |
| `api/` | Vercel serverless functions for push and the daily job |
| `supabase/` | Database schema and row-level security policies |

## Run locally

```bash
python -m http.server 5510
```

Open `http://127.0.0.1:5510`. With `js/config.js` left empty the app runs on this device only, without sync.

## Sync and notifications

Setup takes about 15 minutes on the free tiers of Supabase and Vercel. The step-by-step guide is in [KURULUM.md](KURULUM.md) (Turkish). The server needs these environment variables:

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Public key, same as in `js/config.js` |
| `SUPABASE_SECRET_KEY` | Secret key, server only |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Web push keys |
| `CRON_SECRET` | Lets only the scheduler call the daily job |
| `SITE_URL` | Public address of the app |

## Licence

MIT, see [LICENSE](LICENSE). Category icons are Microsoft Fluent Emoji (MIT).
