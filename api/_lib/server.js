'use strict';
/* Sunucu yardımcıları: Supabase REST (gizli anahtarla) ve Web Push gönderimi.
 * Ortam değişkenleri (Vercel → Settings → Environment Variables):
 *   SUPABASE_SECRET_KEY   Supabase gizli anahtarı (sb_secret_...) — yalnızca sunucuda
 *   VAPID_PUBLIC_KEY      Web Push genel anahtarı (js/config.js'teki ile aynı)
 *   VAPID_PRIVATE_KEY     Web Push özel anahtarı
 *   CRON_SECRET           Günlük görevi yalnızca Vercel'in çağırabilmesi için
 */
const webpush = require('web-push');

// Herkese açık değerler (js/config.js ile aynı)
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const SITE_URL = process.env.SITE_URL || '';

const missingConfig = () => ['SUPABASE_SECRET_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'].filter((k) => !process.env[k]);

async function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: process.env.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** Kullanıcının oturum jetonunu Supabase'e doğrulatır; geçerliyse kullanıcıyı döner. */
async function userFromToken(token) {
  if (!token) return null;
  const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${token}` } });
  return res.ok ? res.json() : null;
}

let vapidReady = false;
function initVapid() {
  if (vapidReady) return;
  webpush.setVapidDetails(SITE_URL, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  vapidReady = true;
}

/** Bildirimi kullanıcının tüm cihazlarına gönderir; artık geçersiz olan cihaz kayıtlarını siler. */
async function pushToSubs(subs, payload) {
  initVapid();
  let sent = 0;
  const gone = [];
  const errors = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 12 * 3600, urgency: 'normal' });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) gone.push(s.id);
      else errors.push(`${e.statusCode || ''} ${String(e.body || e.message).slice(0, 120)}`);
    }
  }));
  if (gone.length) await sb(`push_subscriptions?id=in.(${gone.join(',')})`, { method: 'DELETE' }).catch(() => {});
  return { sent, gone: gone.length, errors };
}

module.exports = { sb, userFromToken, pushToSubs, missingConfig, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SITE_URL };
