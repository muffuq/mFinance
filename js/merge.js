'use strict';
/* mFinance — cihazlar arası birleştirme (saf fonksiyonlar, DOM yok)
 *
 * Her kayıt (işlem, düzenli ödeme, kategori) bir `updatedAt` zaman damgası taşır.
 * Silinen kayıtlar `deleted: { [id]: silinmeZamanı }` haritasında tutulur (tombstone).
 * İki kopya birleşirken:
 *   - aynı id'li kayıtlardan updatedAt'i yeni olan kazanır,
 *   - silinme zamanı, kaydın updatedAt'inden yeni ya da eşitse kayıt silinmiş sayılır,
 *   - ayarlar tek parça olarak updatedAt'e göre seçilir.
 * Böylece iki cihazda çevrimdışı yapılan farklı değişiklikler birbirini ezmez.
 */
(function (root) {
  const TOMBSTONE_TTL = 120 * 864e5; // 120 gün sonra silinme izleri temizlenir

  function mergeDeleted(a = {}, b = {}) {
    const out = { ...a };
    for (const [id, t] of Object.entries(b)) if (!(out[id] >= t)) out[id] = t;
    return out;
  }

  function mergeList(local = [], remote = [], deleted = {}) {
    const map = new Map();
    const order = [];
    for (const x of local) { if (x && x.id != null && !map.has(x.id)) { map.set(x.id, x); order.push(x.id); } }
    for (const x of remote) {
      if (!x || x.id == null) continue;
      const cur = map.get(x.id);
      if (!cur) { map.set(x.id, x); order.push(x.id); }
      else if ((x.updatedAt || 0) > (cur.updatedAt || 0)) map.set(x.id, x);
    }
    return order.map((id) => map.get(id)).filter((x) => !(deleted[x.id] >= (x.updatedAt || 0)));
  }

  function pruneDeleted(deleted, now = Date.now()) {
    const out = {};
    for (const [id, t] of Object.entries(deleted || {})) if (now - t < TOMBSTONE_TTL) out[id] = t;
    return out;
  }

  /** Yerel ve uzak durumu birleştirir. Yerel-only alanlar (rates, owner) yerelden alınır. */
  function mergeStates(local, remote) {
    if (!remote) return local;
    const deleted = mergeDeleted(local.deleted, remote.deleted);
    const ls = local.settings || {}, rs = remote.settings || {};
    return {
      ...local,
      settings: (rs.updatedAt || 0) > (ls.updatedAt || 0) ? { ...rs } : { ...ls },
      transactions: mergeList(local.transactions, remote.transactions, deleted),
      recurring: mergeList(local.recurring, remote.recurring, deleted),
      debts: mergeList(local.debts, remote.debts, deleted),
      templates: mergeList(local.templates, remote.templates, deleted),
      categories: {
        expense: mergeList(local.categories?.expense, remote.categories?.expense, deleted),
        income: mergeList(local.categories?.income, remote.categories?.income, deleted),
      },
      deleted: pruneDeleted(deleted),
    };
  }

  /** Anahtar sırasından bağımsız JSON (Postgres jsonb anahtarları yeniden sıralar). */
  function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
  }

  /** Buluta gidecek kısım: kurlar, kilit ve sahip bilgisi cihaza özeldir. */
  function cloudPayload(state) {
    return {
      version: state.version,
      settings: state.settings,
      transactions: state.transactions,
      recurring: state.recurring,
      debts: state.debts || [],
      templates: state.templates || [],
      categories: state.categories,
      deleted: state.deleted || {},
    };
  }

  const api = { mergeStates, mergeList, mergeDeleted, pruneDeleted, canonical, cloudPayload };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MFMerge = api;
})(typeof window !== 'undefined' ? window : globalThis);
