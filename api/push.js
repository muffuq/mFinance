'use strict';
/* "Test bildirimi gönder": giriş yapmış kullanıcının cihazlarına hemen bir bildirim yollar
 * ve bugünün hatırlatmalarını önizler. Oturum jetonu Supabase'e doğrulatılır. */
const { compute } = require('./_lib/reminders');
const { sb, userFromToken, pushToSubs, missingConfig } = require('./_lib/server');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Yalnızca POST' });
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await userFromToken(token).catch(() => null);
  if (!user?.id) return res.status(401).json({ error: 'Oturum doğrulanamadı; çıkış yapıp tekrar giriş yap.' });

  const missing = missingConfig();
  if (missing.length) return res.status(503).json({ error: 'Sunucuda bildirim ayarları henüz tamamlanmadı.' });

  try {
    const subs = await sb(`push_subscriptions?select=id,endpoint,p256dh,auth&user_id=eq.${user.id}`);
    if (!subs.length) return res.status(404).json({ error: 'Bu hesap için bildirim açılmış cihaz yok.' });
    const [st] = await sb(`user_state?select=data&user_id=eq.${user.id}`);
    const items = st ? compute(st.data).items : [];
    const body = items.length
      ? `Bugün için ${items.length} hatırlatma:\n${items.slice(0, 3).map((i) => `• ${i.text}`).join('\n')}`
      : 'Bir ödeme yaklaştığında her sabah 09:00 civarı haber vereceğim.';
    const r = await pushToSubs(subs, { title: 'Bildirimler çalışıyor', body, url: '/#dashboard', tag: 'mfinance-test' });
    if (!r.sent) return res.status(502).json({ error: 'Bildirim gönderilemedi.', detail: r.errors });
    return res.status(200).json({ sent: r.sent, devices: subs.length, reminders: items.length });
  } catch (e) {
    return res.status(500).json({ error: 'Sunucu hatası', detail: String(e.message || e).slice(0, 200) });
  }
};
