'use strict';
/* Günlük hatırlatma hesapları (sunucu tarafı).
 * Girdi: buluttaki user_state.data (uygulamadaki state'in aynısı). Tarihler Türkiye saatine göre.
 * Her hatırlatmanın benzersiz bir `key`'i var; notify_log'a yazılarak aynısının iki kez gitmesi önlenir.
 */
const TZ = 'Europe/Istanbul';
const NEUTRAL = new Set(['alacak-ver', 'alacak-tahsil']);

const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

function todayParts(now = new Date()) {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const [y, m, d] = iso.split('-').map(Number);
  return { iso, y, m, d, key: iso.slice(0, 7) };
}

function money(minor, cur = 'TRY') {
  const v = Math.round(minor) / 100;
  try {
    return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: cur, minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v);
  } catch {
    return `${v} ${cur}`;
  }
}
const whenText = (days) => (days < 0 ? `${-days} gün gecikti` : days === 0 ? 'bugün' : days === 1 ? 'yarın' : `${days} gün sonra`);

function compute(data, now = new Date()) {
  const T = todayParts(now);
  const base = data?.settings?.currency || 'TRY';
  const txs = Array.isArray(data?.transactions) ? data.transactions : [];
  const items = [];

  // 1) Düzenli ödemeler: bugün ve yarın, bu ay ödenmemişse
  for (const r of data?.recurring || []) {
    for (const off of [0, 1]) {
      const dt = new Date(Date.UTC(T.y, T.m - 1, T.d + off));
      const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
      if (Math.min(r.day, daysIn(y, m)) !== d) continue;
      const key = `${y}-${pad(m)}`;
      if (txs.some((t) => t.recurringId === r.id && String(t.date).startsWith(key))) continue;
      items.push({ key: `rec:${r.id}:${key}`, text: `${r.name} ${whenText(off)} · ${money(r.amount, r.currency || base)}`, pri: off });
    }
  }

  // 2) Borçlar (taksit dahil) ve alacaklar
  for (const dbt of data?.debts || []) {
    const recv = dbt.kind === 'receivable';
    const cur = dbt.currency || base;
    const paid = txs
      .filter((t) => t.debtId === dbt.id && t.type === (recv ? 'income' : 'expense'))
      .reduce((s, t) => s + (t.origCurrency === cur ? t.origAmount : (cur === base && !t.origCurrency ? t.amount : (t.origAmount || t.amount))), 0);
    const left = dbt.total - paid;
    if (left <= 0) continue;

    let dueIso = dbt.due;
    let label = recv ? `${dbt.name}: alacak tarihi` : `${dbt.name}: son ödeme`;
    let amount = left;
    if (dbt.plan && !recv) {
      const p = dbt.plan;
      const paidCount = Math.min(p.count, Math.floor(paid / p.amount + 1e-9));
      const k = addMonths(p.start, paidCount);
      const [ky, km] = k.split('-').map(Number);
      dueIso = `${k}-${pad(Math.min(p.day, daysIn(ky, km)))}`;
      label = `${dbt.name}: ${paidCount + 1}. taksit`;
      amount = Math.min(p.amount, left);
    }
    if (!dueIso) continue;
    const days = daysBetween(T.iso, dueIso);
    const notifyOn = recv ? [0, -1] : [3, 1, 0, -1, -3, -7];
    if (!notifyOn.includes(days)) continue;
    items.push({ key: `debt:${dbt.id}:${dueIso}:${days}`, text: `${label} ${whenText(days)} · ${money(amount, cur)}`, pri: days < 0 ? -1 : days });
  }

  // 3) Aylık bütçe: %80 ve %100 (ayda birer kez)
  const budget = data?.settings?.monthlyBudget || 0;
  if (budget > 0) {
    const spent = txs
      .filter((t) => t.type === 'expense' && !NEUTRAL.has(t.category) && String(t.date).startsWith(T.key))
      .reduce((s, t) => s + t.amount, 0);
    const pct = spent / budget;
    if (pct >= 1) items.push({ key: `budget100:${T.key}`, text: `Bu ayın bütçesini aştın: ${money(spent, base)} / ${money(budget, base)}`, pri: -2 });
    else if (pct >= 0.8) items.push({ key: `budget80:${T.key}`, text: `Bütçenin %${Math.floor(pct * 100)} kadarını harcadın; kalan ${money(budget - spent, base)}`, pri: 5 });
  }

  items.sort((a, b) => a.pri - b.pri);
  return { today: T.iso, items };
}

function compose(items) {
  if (!items.length) return null;
  if (items.length === 1) return { title: 'mFinance hatırlatma', body: items[0].text };
  const lines = items.slice(0, 4).map((i) => `• ${i.text}`);
  if (items.length > 4) lines.push(`+${items.length - 4} hatırlatma daha`);
  return { title: `mFinance · ${items.length} hatırlatma`, body: lines.join('\n') };
}

module.exports = { compute, compose, todayParts };
