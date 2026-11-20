'use strict';
/* Günlük görev (Vercel Cron, her sabah ~09:00 TR):
 *  1) Supabase'i uyanık tutar (ücretsiz plan 1 hafta hareketsiz kalınca duraklıyor)
 *  2) Bildirim açmış kullanıcılara günün hatırlatmalarını tek bildirim olarak gönderir
 */
const { compute, compose } = require('./_lib/reminders');
const { sb, pushToSubs, missingConfig, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = require('./_lib/server');

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const out = { keepalive: null, users: 0, notified: 0, devices: 0, errors: [] };

  // 1) Uyku önleme: herkese açık anahtarla küçük bir veritabanı sorgusu
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/user_state?select=user_id&limit=1`, { headers: { apikey: SUPABASE_PUBLISHABLE_KEY } });
    out.keepalive = r.status;
  } catch (e) {
    out.keepalive = String(e.message || e);
  }

  // 2) Bildirimler
  const missing = missingConfig();
  if (missing.length) return res.status(200).json({ ...out, skipped: `Eksik ortam değişkenleri: ${missing.join(', ')}` });

  try {
    const subs = await sb('push_subscriptions?select=id,user_id,endpoint,p256dh,auth');
    const byUser = new Map();
    for (const s of subs) { if (!byUser.has(s.user_id)) byUser.set(s.user_id, []); byUser.get(s.user_id).push(s); }
    if (!byUser.size) return res.status(200).json(out);

    const states = await sb(`user_state?select=user_id,data&user_id=in.(${[...byUser.keys()].join(',')})`);
    for (const st of states) {
      out.users++;
      try {
        const { items } = compute(st.data);
        if (!items.length) continue;
        // Daha önce gönderilmemiş olanları ayıkla (yeni eklenen satırlar geri döner)
        const inserted = await sb('notify_log', {
          method: 'POST', prefer: 'resolution=ignore-duplicates,return=representation',
          body: items.map((i) => ({ user_id: st.user_id, key: i.key })),
        });
        const fresh = items.filter((i) => inserted.some((r) => r.key === i.key));
        const msg = compose(fresh);
        if (!msg) continue;
        const r = await pushToSubs(byUser.get(st.user_id), { ...msg, url: '/#dashboard', tag: 'mfinance-daily' });
        out.notified++; out.devices += r.sent;
        if (r.errors.length) out.errors.push(...r.errors);
      } catch (e) {
        out.errors.push(String(e.message || e).slice(0, 200));
      }
    }
    // 90 günden eski gönderim kayıtlarını temizle
    await sb(`notify_log?sent_at=lt.${new Date(Date.now() - 90 * 864e5).toISOString()}`, { method: 'DELETE' }).catch(() => {});
  } catch (e) {
    out.errors.push(String(e.message || e).slice(0, 300));
  }
  return res.status(200).json(out);
};
