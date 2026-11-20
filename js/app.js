'use strict';

(() => {
  // =====================================================================
  //  Sabitler & yardımcılar
  // =====================================================================
  const STORAGE_KEY = 'mfinance:v1';
  const TABS = ['dashboard', 'transactions', 'recurring', 'debts', 'settings'];
  const TITLES = { dashboard: 'Özet', transactions: 'Kayıtlar', recurring: 'Düzenli ödemeler', debts: 'Borç & alacak', settings: 'Ayarlar' };
  const RATE_TTL = 60 * 60 * 1000; // kurlar saatte bir yenilenir

  const CURRENCIES = {
    TRY: { sym: '₺', name: 'Türk lirası' },
    USD: { sym: '$', name: 'ABD doları' },
    EUR: { sym: '€', name: 'Euro' },
    GBP: { sym: '£', name: 'Sterlin' },
  };

  // Microsoft Fluent 3D ikonları (MIT) — assets/icons/<ad>.png
  const ICONS = ['cart', 'burger', 'coffee', 'pizza', 'bus', 'car', 'fuel', 'plane', 'house', 'bulb', 'tv', 'music',
    'phone', 'laptop', 'desktop', 'cloud', 'pill', 'game', 'shirt', 'books', 'paw', 'tools', 'gift', 'gem', 'card',
    'bank', 'briefcase', 'bags', 'moneybag', 'banknote', 'wings', 'coin', 'chart', 'piggy', 'shield', 'lock',
    'receipt', 'calendar', 'spiral', 'bell', 'globe', 'sparkles', 'package'];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  let uidSeq = 0;
  const uid = () => Date.now().toString(36) + (uidSeq++).toString(36) + Math.random().toString(36).slice(2, 6);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const sum = (arr) => arr.reduce((s, x) => s + x, 0);
  const avg = (arr) => (arr.length ? sum(arr) / arr.length : 0);
  const iconSrc = (name) => `assets/icons/${ICONS.includes(name) ? name : 'package'}.png`;
  const img = (name, cls = '', size = 34) => `<img class="${cls}" src="${iconSrc(name)}" alt="" width="${size}" height="${size}">`;
  const CHEVRON = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l4 4 4-4"/></svg>';
  const TICK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';

  // ---- Tarih ----
  const pad = (n) => String(n).padStart(2, '0');
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => toISO(new Date());
  const currentMonth = () => today().slice(0, 7);
  const parseKey = (key) => key.split('-').map(Number);
  function addMonths(key, n) {
    const [y, m] = parseKey(key);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  }
  function daysInMonth(key) { const [y, m] = parseKey(key); return new Date(y, m, 0).getDate(); }
  const cap = (s) => s.charAt(0).toLocaleUpperCase('tr-TR') + s.slice(1);
  function monthLabel(key, opts = { month: 'long', year: 'numeric' }) {
    const [y, m] = parseKey(key);
    return cap(new Date(y, m - 1, 1).toLocaleDateString('tr-TR', opts).replace('.', ''));
  }
  function dayLabel(iso, withWeekday = false) {
    if (iso === today()) return 'Bugün';
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (iso === toISO(y)) return 'Dün';
    const [yy, mm, dd] = iso.split('-').map(Number);
    const opts = { day: 'numeric', month: 'long' };
    if (withWeekday) opts.weekday = 'long';
    if (yy !== new Date().getFullYear()) opts.year = 'numeric';
    return new Date(yy, mm - 1, dd).toLocaleDateString('tr-TR', opts);
  }
  const timeLabel = (iso) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  // ---- Para (tüm tutarlar en küçük birim — kuruş/cent — cinsinden tamsayı) ----
  const fmtCache = {};
  function formatter(currency, decimals) {
    const k = currency + decimals;
    return fmtCache[k] || (fmtCache[k] = new Intl.NumberFormat('tr-TR', {
      style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    }));
  }
  const base = () => state.settings.currency;
  function fmt(minor, cur = base()) {
    const v = Math.round(minor) / 100;
    return formatter(cur, Number.isInteger(v) ? 0 : 2).format(v);
  }
  const fmtSigned = (k) => (k > 0 ? '+' : '') + fmt(k);
  const fmtCompact = (minor) => new Intl.NumberFormat('tr-TR', { notation: 'compact', maximumFractionDigits: 1 }).format(minor / 100);
  const fmtRate = (r) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: base(), maximumFractionDigits: r < 1 ? 4 : 2 }).format(r);
  const sym = (cur) => CURRENCIES[cur]?.sym || cur;

  // "1.250,50" · "1250.5" · "1250" · "1.250" hepsini anlar → en küçük birim
  function parseAmount(str, { allowZero = false } = {}) {
    let s = String(str ?? '').trim().replace(/[\s₺$€£]|TL/gi, '');
    if (!s) return allowZero ? 0 : NaN;
    const hasDot = s.includes('.'), hasComma = s.includes(',');
    if (hasDot && hasComma) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (hasComma) {
      s = /^\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (hasDot && /^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    const n = Math.round(parseFloat(s) * 100);
    if (!Number.isFinite(n) || n < 0 || (!allowZero && n === 0)) return NaN;
    return n;
  }
  const toInputAmount = (minor) => (minor ? (minor / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 }) : '');
  function roundDownNice(minor) {
    const v = minor / 100;
    if (v < 10) return Math.floor(v) * 100;
    const step = Math.pow(10, Math.floor(Math.log10(v)) - 1);
    return Math.floor(v / step) * step * 100;
  }

  // =====================================================================
  //  Veri
  // =====================================================================
  const DEFAULT_CATEGORIES = {
    expense: [
      { id: 'market', name: 'Market', icon: 'cart' },
      { id: 'yemek', name: 'Yemek & kafe', icon: 'burger' },
      { id: 'ulasim', name: 'Ulaşım', icon: 'bus' },
      { id: 'kira', name: 'Kira', icon: 'house' },
      { id: 'fatura', name: 'Faturalar', icon: 'bulb' },
      { id: 'abonelik', name: 'Abonelikler', icon: 'tv' },
      { id: 'saglik', name: 'Sağlık', icon: 'pill' },
      { id: 'eglence', name: 'Eğlence', icon: 'game' },
      { id: 'giyim', name: 'Giyim', icon: 'shirt' },
      { id: 'egitim', name: 'Eğitim', icon: 'books' },
      { id: 'teknoloji', name: 'Teknoloji', icon: 'laptop' },
      { id: 'borc', name: 'Borç ödemesi', icon: 'card' },
      { id: 'alacak-ver', name: 'Borç verdim', icon: 'wings' },
      { id: 'diger', name: 'Diğer', icon: 'package' },
    ],
    income: [
      { id: 'proje', name: 'Proje / freelance', icon: 'briefcase' },
      { id: 'satis', name: 'Satış', icon: 'bags' },
      { id: 'ucret', name: 'Ücret / maaş', icon: 'moneybag' },
      { id: 'yatirim', name: 'Yatırım getirisi', icon: 'chart' },
      { id: 'hediye', name: 'Hediye / harçlık', icon: 'gift' },
      { id: 'alacak-tahsil', name: 'Alacak tahsilatı', icon: 'banknote' },
      { id: 'diger-gelir', name: 'Diğer', icon: 'coin' },
    ],
  };
  const FALLBACK_CAT = { expense: 'diger', income: 'diger-gelir' };
  const DEBT_CAT = 'borc';
  const LEND_CAT = 'alacak-ver';      // birine borç verince (gider yönü)
  const COLLECT_CAT = 'alacak-tahsil'; // alacağı geri alınca (gelir yönü)
  const PROTECTED_CATS = new Set(['diger', 'diger-gelir', DEBT_CAT, LEND_CAT, COLLECT_CAT]); // silinemez
  // Nötr kategoriler bakiyeyi değiştirir ama gelir/gider istatistiklerine girmez
  // (borç verdiğin ay "çok harcadın", geri aldığın ay "çok kazandın" denmesin diye)
  const NEUTRAL_CATS = new Set([LEND_CAT, COLLECT_CAT]);
  const isNeutral = (t) => NEUTRAL_CATS.has(t.category);
  const DEFAULT_ICON = Object.fromEntries([...DEFAULT_CATEGORIES.expense, ...DEFAULT_CATEGORIES.income].map((c) => [c.id, c.icon]));

  function defaultState() {
    return {
      version: 2,
      // { id, type, amount (ana para birimi, minor), category, date, note, recurringId?, created,
      //   origAmount?, origCurrency?, rate? }  ← dövizli kayıtlarda orijinal tutar ve kullanılan kur
      transactions: [],
      // { id, name, amount (kendi para biriminde, minor), currency, category, day }
      recurring: [],
      // { id, kind: 'debt'|'receivable', name, icon, total (kendi para biriminde, minor), currency,
      //   due 'YYYY-MM-DD'|'', note, created, plan?: { count, amount, day, start 'YYYY-MM' } }  ← taksitli ise
      // Ödemeler ayrı tutulmaz: debtId taşıyan gider kayıtlarıdır (bakiye ve giderler doğru kalsın diye)
      debts: [],
      // Hızlı ekleme şablonları: { id, type, amount (kendi para biriminde), currency, category, note }
      templates: [],
      categories: clone(DEFAULT_CATEGORIES),
      settings: { currency: 'TRY', startBalance: 0, monthlyBudget: 0, emergencyMonths: 3, theme: 'auto', lastBackup: null, updatedAt: 0 },
      deleted: {},  // senkron için silinme izleri: { [id]: silinmeZamanı }
      owner: null,  // bu cihazdaki verinin ait olduğu hesap (Supabase kullanıcı id)
      rates: null,  // { base, rates: { USD: 0.029, ... } (1 ana birim = x döviz), fetchedAt, source } — yalnızca bu cihaz
    };
  }

  const validTx = (t) =>
    t && (t.type === 'income' || t.type === 'expense') && Number.isFinite(t.amount) && t.amount > 0 &&
    typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date);

  function normalize(d) {
    const b = defaultState();
    if (!d || typeof d !== 'object') return b;
    const settings = { ...b.settings, ...(d.settings || {}) };
    if (!CURRENCIES[settings.currency]) settings.currency = 'TRY';
    const cats = (type) => {
      const list = Array.isArray(d.categories?.[type]) && d.categories[type].length ? d.categories[type] : b.categories[type];
      // Eski sürümdeki emoji ikonlarını 3D ikonlara taşı
      const out = list.map((c) => ({
        id: String(c.id), name: String(c.name), icon: ICONS.includes(c.icon) ? c.icon : DEFAULT_ICON[c.id] || 'package', updatedAt: c.updatedAt || 0,
      }));
      if (!out.some((c) => c.id === FALLBACK_CAT[type])) out.push(b.categories[type].find((c) => c.id === FALLBACK_CAT[type]));
      // Eski verilere sonradan eklenen sistem kategorilerini ekle ("Diğer"in hemen önüne)
      for (const sys of b.categories[type].filter((c) => PROTECTED_CATS.has(c.id) && c.id !== FALLBACK_CAT[type])) {
        if (out.some((c) => c.id === sys.id)) continue;
        const i = out.findIndex((c) => c.id === FALLBACK_CAT[type]);
        out.splice(i < 0 ? out.length : i, 0, { ...sys, updatedAt: 0 });
      }
      return out;
    };
    return {
      version: 2,
      settings,
      categories: { expense: cats('expense'), income: cats('income') },
      transactions: (Array.isArray(d.transactions) ? d.transactions : []).filter(validTx).map((t) => {
        const o = {
          id: String(t.id || uid()), type: t.type, amount: Math.round(t.amount), category: String(t.category || ''),
          date: t.date, note: String(t.note || ''), created: t.created || 0, updatedAt: t.updatedAt || t.created || 0,
        };
        if (t.recurringId) o.recurringId = String(t.recurringId);
        if (t.debtId) o.debtId = String(t.debtId);
        if (t.lendId) o.lendId = String(t.lendId);
        if (t.origCurrency && CURRENCIES[t.origCurrency] && t.origAmount > 0 && t.rate > 0) {
          Object.assign(o, { origAmount: Math.round(t.origAmount), origCurrency: t.origCurrency, rate: Number(t.rate) });
        }
        return o;
      }),
      recurring: (Array.isArray(d.recurring) ? d.recurring : [])
        .filter((r) => r && Number.isFinite(r.amount) && r.amount > 0)
        .map((r) => ({
          id: String(r.id || uid()), name: String(r.name || 'Düzenli ödeme'), amount: Math.round(r.amount),
          currency: CURRENCIES[r.currency] ? r.currency : settings.currency,
          category: r.category || 'diger', day: Math.min(31, Math.max(1, r.day | 0 || 1)), updatedAt: r.updatedAt || 0,
        })),
      debts: (Array.isArray(d.debts) ? d.debts : [])
        .filter((x) => x && Number.isFinite(x.total) && x.total > 0)
        .map((x) => ({
          id: String(x.id || uid()), name: String(x.name || 'Borç'), icon: ICONS.includes(x.icon) ? x.icon : 'card',
          total: Math.round(x.total), currency: CURRENCIES[x.currency] ? x.currency : settings.currency,
          due: /^\d{4}-\d{2}-\d{2}$/.test(x.due || '') ? x.due : '', note: String(x.note || ''),
          created: x.created || 0, updatedAt: x.updatedAt || 0,
          kind: x.kind === 'receivable' ? 'receivable' : 'debt',
          plan: x.plan && x.plan.count > 0 && x.plan.amount > 0 && /^\d{4}-\d{2}$/.test(x.plan.start || '')
            ? { count: x.plan.count | 0, amount: Math.round(x.plan.amount), day: Math.min(31, Math.max(1, x.plan.day | 0 || 1)), start: x.plan.start }
            : null,
        })),
      templates: (Array.isArray(d.templates) ? d.templates : [])
        .filter((x) => x && (x.type === 'income' || x.type === 'expense') && Number.isFinite(x.amount) && x.amount > 0)
        .map((x) => ({
          id: String(x.id || uid()), type: x.type, amount: Math.round(x.amount),
          currency: CURRENCIES[x.currency] ? x.currency : settings.currency,
          category: String(x.category || ''), note: String(x.note || ''), updatedAt: x.updatedAt || 0,
        })),
      deleted: d.deleted && typeof d.deleted === 'object' ? { ...d.deleted } : {},
      owner: d.owner || null,
      rates: d.rates && d.rates.rates && d.rates.base ? d.rates : null,
    };
  }

  // ---- Senkron için değişiklik damgaları ----
  const touch = (o) => { o.updatedAt = Date.now(); return o; };
  const touchSettings = () => touch(state.settings);
  const tombstone = (id) => { state.deleted[id] = Date.now(); };
  const allRecords = (s) => [...s.transactions, ...s.recurring, ...(s.debts || []), ...(s.templates || []), ...s.categories.expense, ...s.categories.income];

  /** Durumu toptan değiştirir (içe aktarma, örnek veri, sıfırlama) — diğer cihazlara da yansısın diye
   *  eski kayıtlara silinme izi bırakır, yenilerini "şimdi değişti" olarak damgalar. */
  function replaceState(next) {
    const t = Date.now();
    const keep = new Set(allRecords(next).map((x) => x.id));
    const deleted = { ...(state.deleted || {}) };
    for (const x of allRecords(state)) if (!keep.has(x.id)) deleted[x.id] = t;
    for (const x of allRecords(next)) { x.updatedAt = t; delete deleted[x.id]; }
    next.settings.updatedAt = t;
    next.deleted = deleted;
    next.owner = state.owner;
    next.rates = next.rates || state.rates;
    state = next;
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? normalize(JSON.parse(raw)) : defaultState();
    } catch (e) {
      console.error('[mFinance] Veri okunamadı', e);
      return defaultState();
    }
  }
  function saveLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { console.error('[mFinance] Kaydedilemedi', e); toast('Kaydedilemedi: tarayıcı depolaması dolu ya da kapalı.'); }
  }
  function save() { saveLocal(); scheduleSync(); }

  let state = load();
  const ui = {
    tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard',
    month: currentMonth(),
    txType: 'all', txCat: 'all', txQuery: '', txAllMonths: false, debtKind: 'debt',
    ratesLoading: false, ratesError: false,
  };

  // =====================================================================
  //  Döviz kurları
  // =====================================================================
  // 1 birim `cur` kaç ana para birimi eder? (ör. 1 USD = 34,52 TRY) — kur yoksa null
  function rateOf(cur) {
    if (!cur || cur === base()) return 1;
    const r = state.rates;
    if (!r || r.base !== base() || !(r.rates[cur] > 0)) return null;
    return 1 / r.rates[cur];
  }
  function toBase(minor, cur) {
    const k = rateOf(cur);
    return k == null ? null : Math.round(minor * k);
  }
  const ratesStale = () => {
    const r = state.rates;
    return !r || r.base !== base() || Date.now() - new Date(r.fetchedAt).getTime() > RATE_TTL;
  };

  async function fetchJSON(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  async function fetchRates(force = false) {
    if (ui.ratesLoading || (!force && !ratesStale())) return;
    ui.ratesLoading = true; renderRates();
    const b = base();
    const wanted = Object.keys(CURRENCIES);
    try {
      let rates = null, source = '';
      try {
        const j = await fetchJSON(`https://open.er-api.com/v6/latest/${b}`);
        if (j.result === 'success' && j.rates) { rates = j.rates; source = 'open.er-api.com'; }
      } catch (e) { console.warn('[mFinance] open.er-api başarısız', e); }
      if (!rates) {
        const j = await fetchJSON(`https://api.frankfurter.app/latest?from=${b}`);
        if (j.rates) { rates = j.rates; source = 'frankfurter.app'; }
      }
      if (!rates) throw new Error('Kur verisi yok');
      state.rates = { base: b, rates: Object.fromEntries(wanted.filter((c) => rates[c] > 0).map((c) => [c, rates[c]])), fetchedAt: new Date().toISOString(), source };
      ui.ratesError = false;
      saveLocal(); // kurlar cihaza özel, buluta gitmez
      if (force) toast('Kurlar güncellendi');
    } catch (e) {
      console.warn('[mFinance] Kurlar alınamadı', e);
      ui.ratesError = true;
      if (force) toast('Kurlar alınamadı. İnternet bağlantını kontrol et.');
    } finally {
      ui.ratesLoading = false;
      render();
    }
  }

  // =====================================================================
  //  Hesaplamalar
  // =====================================================================
  function category(type, id) {
    return state.categories[type].find((c) => c.id === id) ||
      state.categories[type === 'income' ? 'expense' : 'income'].find((c) => c.id === id) ||
      { id, name: 'Kategorisiz', icon: 'package' };
  }
  const txInMonth = (key) => state.transactions.filter((t) => t.date.startsWith(key));
  // İstatistik için: nötr (borç verme / alacak tahsilatı) kayıtlar hariç
  const statTxInMonth = (key) => txInMonth(key).filter((t) => !isNeutral(t));
  function totals(list) {
    let income = 0, expense = 0;
    for (const t of list) t.type === 'income' ? (income += t.amount) : (expense += t.amount);
    return { income, expense, net: income - expense };
  }
  const monthTotals = (key) => totals(statTxInMonth(key));
  const balance = () => state.settings.startBalance + totals(state.transactions).net; // nötrler dahil
  const recBase = (r) => toBase(r.amount, r.currency);
  // Aylık zorunlu çıkış: düzenli ödemeler + açık taksitli borçların aylık taksiti
  const planMonthly = () => sum(state.debts.filter((d) => d.kind === 'debt' && d.plan && !debtInfo(d).closed)
    .map((d) => toBase(d.plan.amount, d.currency) || 0));
  const fixedTotal = () => sum(state.recurring.map((r) => recBase(r) || 0));
  const missingRates = () => state.recurring.some((r) => recBase(r) == null);
  function firstMonth() {
    let min = null;
    for (const t of state.transactions) { const k = t.date.slice(0, 7); if (!min || k < min) min = k; }
    return min;
  }
  const sortTx = (a, b) => (a.date === b.date ? (b.created || 0) - (a.created || 0) : a.date < b.date ? 1 : -1);

  // Düzensiz gelir analizi: bu aydan önceki son 6 tam ay (kullanmaya başladığın aydan itibaren)
  function rhythm() {
    const cur = currentMonth(), first = firstMonth();
    if (!first) return null;
    const keys = [];
    for (let i = 1; i <= 6; i++) { const k = addMonths(cur, -i); if (k >= first) keys.push(k); }
    const partial = keys.length === 0;
    if (partial) keys.push(cur);
    const rows = keys.map(monthTotals);
    const inc = rows.map((r) => r.income), exp = rows.map((r) => r.expense);
    const sorted = [...inc].sort((a, b) => a - b);
    const weakHalf = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
    return {
      months: keys.length, partial, avgIncome: avg(inc), avgExpense: avg(exp),
      minIncome: sorted[0], maxIncome: sorted[sorted.length - 1], suggested: roundDownNice(avg(weakHalf)),
    };
  }
  function runway() {
    const r = rhythm();
    const need = Math.max(r?.avgExpense || 0, fixedTotal() + planMonthly());
    if (need <= 0) return null;
    return { months: Math.max(0, balance()) / need, need };
  }
  function recurringStatus(r, key) {
    const tx = state.transactions.find((t) => t.recurringId === r.id && t.date.startsWith(key));
    if (tx) return { code: 'paid', label: 'Ödendi', tx };
    const cur = currentMonth();
    const day = Math.min(r.day, daysInMonth(key));
    if (key < cur) return { code: 'late', label: 'Ödenmedi' };
    if (key > cur) return { code: 'pending', label: `Ayın ${day}.` };
    const td = new Date().getDate();
    if (day < td) return { code: 'late', label: 'Gecikti' };
    if (day === td) return { code: 'due', label: 'Bugün' };
    return { code: 'pending', label: `${day - td} gün` };
  }

  // ---- Borçlar & alacaklar ----
  const isRecv = (d) => d.kind === 'receivable';
  // Borçta ödemeler gider, alacakta tahsilatlar gelir kaydıdır
  const debtPayments = (d) => state.transactions.filter((t) => t.debtId === d.id && t.type === (isRecv(d) ? 'income' : 'expense')).sort(sortTx);
  const monthDiff = (a, b) => { const [ay, am] = parseKey(a), [by, bm] = parseKey(b); return (by - ay) * 12 + (bm - am); };
  // Taksit planı: sıradaki ödenmemiş taksit ve geride kalan taksit sayısı
  function planState(d, paid) {
    const p = d.plan;
    const paidCount = Math.min(p.count, Math.floor(paid / p.amount + 1e-9));
    const nextKey = addMonths(p.start, paidCount);
    const nextDate = `${nextKey}-${pad(Math.min(p.day, daysInMonth(nextKey)))}`;
    const dueByNow = Math.max(0, Math.min(p.count, monthDiff(p.start, currentMonth()) + (new Date().getDate() >= p.day ? 1 : 0)));
    return { paidCount, no: Math.min(p.count, paidCount + 1), nextDate, behind: Math.max(0, dueByNow - paidCount) };
  }
  // Bir ödemenin borcun kendi para birimindeki karşılığı
  function payInDebtCur(t, d) {
    if (t.origCurrency === d.currency) return t.origAmount;
    if (d.currency === base() && !t.origCurrency) return t.amount;
    const k = rateOf(d.currency);
    return k ? Math.round(t.amount / k) : t.origAmount || t.amount;
  }
  function debtInfo(d) {
    const paid = sum(debtPayments(d).map((t) => payInDebtCur(t, d)));
    const left = Math.max(0, d.total - paid);
    const info = { paid, left, pct: Math.min(100, (paid / d.total) * 100), closed: left <= 0, leftBase: toBase(left, d.currency), due: null, plan: null };
    if (d.plan && !info.closed) info.plan = planState(d, paid);
    const dueDate = info.plan ? info.plan.nextDate : d.due;
    if (dueDate && !info.closed) {
      const [y, m, dd] = dueDate.split('-').map(Number);
      const days = Math.round((new Date(y, m - 1, dd) - new Date(new Date().toDateString())) / 864e5);
      const what = info.plan ? `${info.plan.no}. taksit` : 'Son gün';
      info.due = days < 0 ? { code: 'late', label: info.plan && info.plan.behind > 1 ? `${info.plan.behind} taksit gecikti` : `${-days} gün gecikti`, days }
        : days === 0 ? { code: 'due', label: `${what} bugün`, days }
          : days <= 7 ? { code: 'due', label: `${what}: ${days} gün kaldı`, days }
            : { code: 'pending', label: info.plan ? `${what} · ${dayLabel(dueDate)}` : dayLabel(dueDate), days };
    }
    return info;
  }
  function debtTotals(kind = 'debt') {
    let left = 0, missing = false, active = 0;
    for (const d of state.debts.filter((x) => (x.kind || 'debt') === kind)) {
      const i = debtInfo(d);
      if (i.closed) continue;
      active++;
      if (i.leftBase == null) missing = true; else left += i.leftBase;
    }
    return { left, missing, active };
  }
  const sortDebts = (a, b) => {
    const ia = debtInfo(a), ib = debtInfo(b);
    if (ia.closed !== ib.closed) return ia.closed ? 1 : -1;
    const da = ia.due ? ia.due.days : Infinity, db = ib.due ? ib.due.days : Infinity;
    return da !== db ? da - db : (ib.leftBase || 0) - (ia.leftBase || 0);
  };

  function insights(key) {
    const out = [];
    const t = monthTotals(key);
    const r = rhythm();
    const isCur = key === currentMonth();

    if (t.income > 0 && t.expense > t.income) {
      out.push({ tone: 'bad', text: `Bu ay giderlerin gelirini <b>${fmt(t.expense - t.income)}</b> aştı; aradaki fark birikimden çıkıyor.` });
    } else if (t.income > 0) {
      const rate = Math.round((t.net / t.income) * 100);
      out.push({ tone: rate >= 20 ? 'good' : '', text: `Bu ayki tasarruf oranın <b>%${rate}</b>. ${rate >= 20 ? 'İyi gidiyorsun.' : 'Hedef olarak en az %20 iyi bir başlangıç.'}` });
    } else if (t.expense > 0 && !isCur) {
      out.push({ tone: 'warn', text: 'Bu ay hiç gelir kaydı yok; tüm giderler birikimden çıktı.' });
    }

    const byCat = new Map();
    for (const x of statTxInMonth(key)) if (x.type === 'expense') byCat.set(x.category, (byCat.get(x.category) || 0) + x.amount);
    if (t.expense > 0 && byCat.size > 1) {
      const [topId, topVal] = [...byCat].sort((a, b) => b[1] - a[1])[0];
      out.push({ tone: '', text: `En büyük harcama kalemin <b>${esc(category('expense', topId).name)}</b>; giderlerin %${Math.round((topVal / t.expense) * 100)} kadarı.` });
    }

    if (isCur && r && !r.partial && r.avgExpense > 0 && t.expense > 0) {
      // Düzenli ödemeler ayda bir kez çıkar; yalnızca değişken harcamaların hızını ay sonuna yansıt
      const day = new Date().getDate();
      const variable = sum(statTxInMonth(key).filter((x) => x.type === 'expense' && !x.recurringId).map((x) => x.amount));
      const projected = (variable / day) * daysInMonth(key) + Math.max(fixedTotal(), t.expense - variable);
      if (day >= 5 && projected > r.avgExpense * 1.15) {
        out.push({ tone: 'warn', text: `Bu hızla ay sonunda yaklaşık <b>${fmt(projected)}</b> harcamış olacaksın; ortalamanın %${Math.round((projected / r.avgExpense - 1) * 100)} üstü.` });
      }
    }

    const rw = runway();
    if (rw && rw.months < 3) {
      out.push({ tone: rw.months < 1 ? 'bad' : 'warn', text: `Birikimin yaklaşık <b>${rw.months.toFixed(1).replace('.', ',')} ay</b> yetiyor. Düzensiz gelirde 3–6 aylık tampon önerilir.` });
    }

    for (const d of state.debts) {
      const i = debtInfo(d);
      if (!i.due || i.due.days > 7) continue;
      const when = i.due.days < 0 ? `${-i.due.days} gün önce geçti` : i.due.days === 0 ? 'bugün' : `${i.due.days} gün sonra`;
      if (isRecv(d)) {
        out.push({ tone: i.due.days < 0 ? 'warn' : '', text: `<b>${esc(d.name)}</b> alacağının tarihi ${when}; kalan ${fmt(i.left, d.currency)}. <button class="link" data-action="pay-debt" data-id="${d.id}">Tahsil et</button>` });
      } else {
        const what = i.plan ? `${i.plan.no}. taksit (${fmt(Math.min(d.plan.amount, i.left), d.currency)})` : `son ödeme (kalan ${fmt(i.left, d.currency)})`;
        out.push({ tone: i.due.days < 0 ? 'bad' : 'warn', text: `<b>${esc(d.name)}</b>: ${what} ${when}. <button class="link" data-action="pay-debt" data-id="${d.id}">Ödeme yap</button>` });
      }
    }

    const late = state.recurring.filter((x) => recurringStatus(x, key).code === 'late');
    if (late.length) out.push({ tone: 'warn', text: `Ödenmemiş görünen düzenli ödemeler: ${late.map((x) => `<b>${esc(x.name)}</b>`).join(', ')}` });

    if (state.transactions.length >= 10) {
      const lb = state.settings.lastBackup;
      const days = lb ? Math.floor((Date.now() - new Date(lb).getTime()) / 864e5) : Infinity;
      if (days > 30) out.push({ tone: 'warn', text: `${lb ? `Son yedeğin ${days} gün önce.` : 'Henüz hiç yedek almadın.'} <button class="link" data-action="export-json">Şimdi yedek indir</button>` });
    }

    if (window.MFLock?.supported() && !window.MFLock.isEnabled()) {
      out.push({ tone: 'warn', text: 'Uygulama kilidi kapalı; telefonunu eline alan herkes verilerini görebilir. <button class="link" data-action="lock-enable">PIN belirle</button>' });
    }

    if (!out.length) out.push({ tone: '', text: 'Kayıt ekledikçe burada sana özel notlar göreceksin.' });
    return out;
  }

  // =====================================================================
  //  Şablon parçaları
  // =====================================================================
  const icoBox = (name) => `<span class="ico-wrap">${img(name, 'ico')}</span>`;

  function txRow(t, showDate = true) {
    const c = category(t.type, t.category);
    const parts = [];
    if (t.note) parts.push(esc(c.name));
    if (showDate) parts.push(dayLabel(t.date));
    if (t.origCurrency) parts.push(`1 ${sym(t.origCurrency)} = ${fmtRate(t.rate)}`);
    const sign = t.type === 'income' ? '+' : '−';
    return `<button class="tx" data-action="edit-tx" data-id="${t.id}">
      ${icoBox(c.icon)}
      <span class="tx-main"><span class="tx-title">${esc(t.note || c.name)}</span>${parts.length ? `<span class="tx-sub">${parts.join(' · ')}</span>` : ''}</span>
      <span class="tx-amt ${t.type}">${sign}${fmt(t.amount)}${t.origCurrency ? `<small>${sign}${fmt(t.origAmount, t.origCurrency)}</small>` : ''}</span></button>`;
  }

  function recRow(r, s) {
    const c = category('expense', r.category);
    const foreign = r.currency !== base();
    const conv = recBase(r);
    let amt;
    if (s.code === 'paid') {
      amt = `${fmt(s.tx.amount)}${foreign ? `<small>${fmt(r.amount, r.currency)} ödendi</small>` : ''}`;
    } else if (foreign) {
      amt = `${conv == null ? '<span class="muted">kur yok</span>' : `≈ ${fmt(conv)}`}<small>${fmt(r.amount, r.currency)}</small>`;
    } else {
      amt = fmt(r.amount);
    }
    const action = s.code === 'paid'
      ? `<button class="link" data-action="unpay-rec" data-id="${r.id}" title="Ödeme kaydını sil">Geri al</button>`
      : `<button class="btn line sm" data-action="pay-rec" data-id="${r.id}">Ödedim</button>`;
    return `<div class="rec-row">
      ${icoBox(c.icon)}
      <span class="tx-main" data-action="edit-rec" data-id="${r.id}" title="Düzenle">
        <span class="tx-title">${esc(r.name)}${foreign ? `<span class="badge cur">${r.currency}</span>` : ''}</span>
        <span class="tx-sub">Her ayın ${r.day}. günü · ${esc(c.name)}</span></span>
      <span class="rec-side"><span class="tx-amt">${amt}</span><span class="badge ${s.code}">${s.label}</span><span class="rec-action">${action}</span></span></div>`;
  }

  function debtRow(d) {
    const i = debtInfo(d);
    const recv = isRecv(d);
    const foreign = d.currency !== base();
    const planTxt = d.plan ? `${d.plan.count} × ${fmt(d.plan.amount, d.currency)} taksit` : '';
    const sub = [d.note ? esc(d.note) : '', planTxt || `Toplam ${fmt(d.total, d.currency)}`].filter(Boolean).join(' · ');
    const badge = i.closed ? `<span class="badge paid">${recv ? 'Tamamı alındı' : 'Tamamı ödendi'}</span>`
      : i.due ? `<span class="badge ${i.due.code}">${i.due.label}</span>` : '';
    const progress = d.plan && !i.closed ? `${i.plan.paidCount}/${d.plan.count} taksit` : `%${Math.floor(i.pct)}`;
    const quickAmt = d.plan && !i.closed ? Math.min(d.plan.amount, i.left) : 0;
    return `<div class="debt${i.closed ? ' closed' : ''}">
      ${icoBox(d.icon)}
      <div class="debt-main" data-action="edit-debt" data-id="${d.id}" title="Ayrıntılar ve düzenle">
        <div class="debt-name">${esc(d.name)}${foreign ? `<span class="badge cur">${d.currency}</span>` : ''}${badge}</div>
        <div class="debt-sub">${sub}</div>
      </div>
      <div class="debt-left">
        <div class="k">${i.closed ? 'Kapandı' : recv ? 'Alacak' : 'Kalan'}</div>
        <div class="v">${i.closed ? fmt(d.total, d.currency) : fmt(i.left, d.currency)}${foreign && !i.closed && i.leftBase != null ? `<small>≈ ${fmt(i.leftBase)}</small>` : ''}</div>
      </div>
      <div class="debt-track">
        <div class="meter good"><i style="width:${i.pct}%"></i></div>
        <span class="meta">${progress} · ${fmt(i.paid, d.currency)} ${recv ? 'alındı' : 'ödendi'}</span>
        ${i.closed ? '' : quickAmt
          ? `<button class="btn line sm" data-action="pay-installment" data-id="${d.id}" title="${fmt(quickAmt, d.currency)} taksiti öde">Taksiti öde</button>`
          : `<button class="btn line sm" data-action="pay-debt" data-id="${d.id}">${recv ? 'Tahsil et' : 'Ödeme yap'}</button>`}
      </div>
    </div>`;
  }

  const emptyBox = (icon, text, btn = '') => `<div class="empty">${img(icon, '', 64)}${text}${btn ? `<br>${btn}` : ''}</div>`;

  // ---- Hızlı ekleme şablonları ----
  const tplLabel = (t) => t.note || category(t.type, t.category).name;
  function templatesStrip() {
    if (!state.templates.length) return '';
    return `<section class="quick-strip" aria-label="Hızlı ekle">
      <span class="quick-title">Hızlı ekle</span>
      <div class="quick-list">${state.templates.map((t) => `
        <button class="quick ${t.type}" data-action="use-template" data-id="${t.id}" title="Bugüne ekle: ${esc(tplLabel(t))}">
          ${img(category(t.type, t.category).icon, '', 22)}<span>${esc(tplLabel(t))}</span><b>${t.type === 'income' ? '+' : ''}${fmt(t.amount, t.currency)}</b>
        </button>`).join('')}</div>
    </section>`;
  }
  function useTemplate(t) {
    const rate = rateOf(t.currency);
    if (rate == null) { toast(`${t.currency} kuru alınamadı. İnternete bağlanıp tekrar dene.`); return; }
    const tx = touch({ id: uid(), type: t.type, amount: Math.round(t.amount * rate), category: t.category, date: today(), note: t.note, created: Date.now() });
    if (t.currency !== base()) Object.assign(tx, { origAmount: t.amount, origCurrency: t.currency, rate });
    state.transactions.push(tx);
    save(); render();
    toast(`Eklendi: ${tplLabel(t)} · ${fmt(tx.amount)}`, {
      label: 'Geri al',
      fn: () => { state.transactions = state.transactions.filter((x) => x.id !== tx.id); tombstone(tx.id); save(); render(); },
    });
  }

  // =====================================================================
  //  Görünüm: Özet
  // =====================================================================
  function welcomeHTML() {
    return `
    <div class="welcome">
      <div>
        <div class="eyebrow">Kişisel finans defteri</div>
        <h2>Gelirin düzensiz,<br><i>planın düzenli</i> olsun.</h2>
        <p class="lead">Gelir ve giderlerini yaz; mFinance ortalama gelirini, her ay güvenle harcayabileceğin tutarı ve birikiminin kaç ay yeteceğini hesaplasın.</p>
        <label class="field"><span>Şu an elinde toplam ne kadar para var?</span>
          <input id="welcomeStart" inputmode="decimal" autocomplete="off" placeholder="Örn. 25.000" value="${toInputAmount(state.settings.startBalance)}">
          <small>Nakit ve banka hesapların toplamı. Sonradan Ayarlar'dan değiştirebilirsin.</small></label>
        <div class="welcome-actions">
          <button class="btn ink" data-action="add-tx" data-type="income">İlk gelirini ekle</button>
          <button class="btn line" data-action="add-tx" data-type="expense">Gider ekle</button>
          ${syncConfigured() ? '' : '<button class="btn line" data-action="load-demo">Örnek verilerle dene</button>'}
        </div>
      </div>
      <ol class="steps">
        <li>${img('receipt', '', 48)}<div><b>Her şeyi yaz</b><span>Para geldiğinde ve harcadığında birkaç saniyede kaydet. Takip edilmeyen para yönetilemez.</span></div></li>
        <li>${img('wings', '', 48)}<div><b>Kendine maaş belirle</b><span>Gelirin ne olursa olsun her ay sabit bir tutar harca. İyi aylarda fazlası kenara kalır, zayıf aylarda oradan tamamlarsın.</span></div></li>
        <li>${img('shield', '', 48)}<div><b>Tampon biriktir</b><span>3–6 aylık gider kadar bir acil durum fonu, gelir gecikse bile seni rahat ettirir.</span></div></li>
      </ol>
    </div>`;
  }

  function budgetCell(key, isCur, t) {
    const b = state.settings.monthlyBudget;
    const head = (aside = '') => `<div class="cell-head">${img('wings', '', 30)}<h2>Aylık bütçe</h2>${aside}</div>`;
    if (!b) {
      return `<div class="cell">${head()}
        <p>Düzensiz gelirde en işe yarayan yöntem: kendine sabit bir “maaş” belirle ve ay içinde yalnızca onu harca. Fazlası birikime kalır.</p>
        <button class="btn ink sm" data-action="set-budget">Bütçe belirle</button></div>`;
    }
    const spent = t.expense, left = b - spent, pct = Math.min(100, (spent / b) * 100);
    let extra = '';
    if (left < 0) extra = `<div class="callout bad">Bütçeyi <b>${fmt(-left)}</b> aştın.</div>`;
    else if (isCur) {
      const dLeft = daysInMonth(key) - new Date().getDate() + 1;
      extra = `<div class="callout">Bugünden itibaren günde <b>${fmt(Math.floor(left / dLeft))}</b> harcayabilirsin. <span class="muted">${dLeft} gün kaldı.</span></div>`;
    }
    return `<div class="cell">${head('<button class="link aside" data-action="set-budget">Düzenle</button>')}
      <div class="figure-l">${fmt(left)}<small>kaldı</small></div>
      <div class="meter ${pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''}"><i style="width:${pct}%"></i></div>
      <div class="row-between"><span class="muted">${fmt(spent)} harcandı</span><span class="num">${fmt(b)}</span></div>
      ${extra}</div>`;
  }

  function rhythmCell(r) {
    const head = (aside = '') => `<div class="cell-head">${img('chart', '', 30)}<h2>Gelir ritmin</h2>${aside}</div>`;
    if (!r) return `<div class="cell">${head()}<p>Gelir ekledikçe aylık ortalaman burada görünecek.</p></div>`;
    const canApply = r.suggested > 0 && r.suggested !== state.settings.monthlyBudget;
    return `<div class="cell">${head(`<span class="aside">${r.partial ? 'Yalnızca bu ay' : `Son ${r.months} ay`}</span>`)}
      <div class="figure-l">${fmt(r.avgIncome)}<small>/ ay</small></div>
      <div class="range">En düşük <b>${fmt(r.minIncome)}</b> · en yüksek <b>${fmt(r.maxIncome)}</b></div>
      <div class="suggest"><div><div class="lbl">Önerilen aylık bütçe</div><div class="val">${fmt(r.suggested)}</div>
        <small>${r.partial ? 'Geçmiş aylar oluştukça daha isabetli olur.' : 'Zayıf aylarının ortalamasına göre, temkinli.'}</small></div>
        ${canApply ? `<button class="btn mark sm" data-action="apply-suggest" data-v="${r.suggested}">Uygula</button>` : ''}</div></div>`;
  }

  function safetyCell() {
    const rw = runway(), bal = balance(), months = state.settings.emergencyMonths || 3;
    const head = `<div class="cell-head">${img('shield', '', 30)}<h2>Dayanıklılık</h2></div>`;
    if (!rw) return `<div class="cell">${head}<p>Gider ya da düzenli ödeme ekledikçe birikiminin kaç ay yeteceğini burada göreceksin.</p></div>`;
    const target = rw.need * months;
    const pct = target > 0 ? Math.min(100, (Math.max(0, bal) / target) * 100) : 0;
    const mText = rw.months >= 36 ? '36+' : rw.months.toFixed(1).replace('.', ',');
    return `<div class="cell">${head}
      <div class="figure-l ${rw.months < 1 ? 'neg' : ''}">${mText} ay<small>idare eder</small></div>
      <p style="margin-top:8px">Hiç gelir gelmezse, ayda ~${fmt(rw.need)} harcamayla birikimin bu kadar yeter.</p>
      <div class="meter good"><i style="width:${pct}%"></i></div>
      <div class="row-between"><span class="muted">Acil durum fonu · ${months} ay</span><span class="num">%${Math.round(pct)}</span></div></div>`;
  }

  function barChart(endKey) {
    const keys = [];
    for (let i = 5; i >= 0; i--) keys.push(addMonths(endKey, -i));
    const data = keys.map((k) => ({ k, ...monthTotals(k) }));
    const max = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
    const W = 600, H = 240, top = 22, bottom = 30, side = 2;
    const ch = H - top - bottom, cw = (W - side * 2) / keys.length, bw = Math.min(18, cw * 0.2);
    let g = '';
    for (const f of [0.5, 1]) g += `<line class="grid" x1="${side}" x2="${W - side}" y1="${top + ch * (1 - f)}" y2="${top + ch * (1 - f)}"/>`;
    g += `<text x="${side}" y="${top - 8}">${fmtCompact(max)}</text>`;
    data.forEach((d, i) => {
      const cx = side + cw * i + cw / 2;
      const hi = d.income ? Math.max(2, (d.income / max) * ch) : 0;
      const he = d.expense ? Math.max(2, (d.expense / max) * ch) : 0;
      g += `<g class="col${d.k === ui.month ? ' sel' : ''}" data-action="goto-month" data-month="${d.k}">
        <title>${monthLabel(d.k)}&#10;Gelir: ${fmt(d.income)}&#10;Gider: ${fmt(d.expense)}&#10;Net: ${fmtSigned(d.income - d.expense)}</title>
        <rect class="hit" x="${cx - cw / 2 + 3}" y="4" width="${cw - 6}" height="${H - 8}" rx="8"/>
        <rect class="b-inc" x="${cx - bw - 2}" y="${top + ch - hi}" width="${bw}" height="${hi}" rx="2"/>
        <rect class="b-exp" x="${cx + 2}" y="${top + ch - he}" width="${bw}" height="${he}" rx="2"/>
        <text class="lbl" x="${cx}" y="${H - 9}">${monthLabel(d.k, { month: 'short' })}</text></g>`;
    });
    g += `<line class="base" x1="${side}" x2="${W - side}" y1="${top + ch + 0.5}" y2="${top + ch + 0.5}"/>`;
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Son 6 ayın gelir ve giderleri">${g}</svg>`;
  }

  function categoryBreakdown(key) {
    const map = new Map();
    let total = 0;
    for (const t of statTxInMonth(key)) if (t.type === 'expense') { map.set(t.category, (map.get(t.category) || 0) + t.amount); total += t.amount; }
    if (!total) return emptyBox('receipt', 'Bu ay henüz gider yok.');
    return `<div class="cat-bars">${[...map].sort((a, b) => b[1] - a[1]).map(([id, v]) => {
      const c = category('expense', id), p = (v / total) * 100;
      return `<button class="cat-row" data-action="filter-cat" data-id="${esc(id)}" title="Bu kategorinin kayıtlarını göster">
        ${img(c.icon, '', 26)}<span class="nm">${esc(c.name)}</span><span class="vl">${fmt(v)}<small>%${Math.round(p)}</small></span>
        <span class="cbar"><i style="width:${p}%"></i></span></button>`;
    }).join('')}</div>`;
  }

  function fixedSection(key) {
    if (!state.recurring.length) {
      return emptyBox('calendar', 'Kira, fatura, abonelik gibi her ay tekrar eden ödemelerini ekle; ödeyip ödemediğini buradan takip et.',
        '<button class="btn line" data-action="add-rec">+ Düzenli ödeme ekle</button>');
    }
    return [...state.recurring].sort((a, b) => a.day - b.day).map((r) => recRow(r, recurringStatus(r, key))).join('');
  }

  function renderDashboard() {
    const el = $('#view-dashboard');
    if (!state.transactions.length && !state.recurring.length && !state.debts.length) { el.innerHTML = welcomeHTML(); return; }
    const key = ui.month, isCur = key === currentMonth();
    const list = statTxInMonth(key);
    const t = totals(list), bal = balance();
    const recent = [...txInMonth(key)].sort(sortTx).slice(0, 6);
    const ml = monthLabel(key);
    const rateTxt = t.net < 0 ? 'Fark birikimden' : t.income > 0 ? `Tasarruf %${Math.round((t.net / t.income) * 100)}` : '';
    let paid = 0;
    for (const r of state.recurring) { const s = recurringStatus(r, key); if (s.code === 'paid') paid += s.tx.amount; }

    const dt = debtTotals('debt');
    const rt = debtTotals('receivable');
    const net = bal - dt.left + rt.left;
    const activeDebts = [...state.debts].sort(sortDebts).filter((d) => !debtInfo(d).closed);
    const netWhat = dt.active && rt.active ? 'Borç ve alacaklarla' : dt.active ? 'Borçlar düşülünce' : 'Alacaklar eklenince';

    el.innerHTML = `
      ${templatesStrip()}
      <section class="hero">
        <div>
          <div class="eyebrow">Toplam bakiye</div>
          <div class="figure-xl ${bal < 0 ? 'neg' : ''}">${fmt(bal)}</div>
          <div class="hero-note">${dt.active || rt.active
            ? `${netWhat} net varlığın <b class="num ${net < 0 ? 'neg' : ''}">${fmt(net)}</b>${dt.missing || rt.missing ? ' (bazı kurlar alınamadı)' : ''}`
            : 'Başlangıç bakiyesi ve tüm kayıtlar dahil'}</div>
        </div>
        <dl class="hero-stats">
          <div><dt>${ml} geliri</dt><dd class="pos">${fmt(t.income)}</dd><span class="sub">${list.filter((x) => x.type === 'income').length} kayıt</span></div>
          <div><dt>Gideri</dt><dd class="neg">${fmt(t.expense)}</dd><span class="sub">${list.filter((x) => x.type === 'expense').length} kayıt</span></div>
          <div><dt>Net</dt><dd>${fmtSigned(t.net)}</dd><span class="sub">${rateTxt || '&nbsp;'}</span></div>
        </dl>
      </section>

      <section class="strip">${budgetCell(key, isCur, t)}${rhythmCell(rhythm())}${safetyCell()}</section>

      <section class="split">
        <div class="block"><header class="block-head"><h2>Son 6 ay</h2>
          <div class="legend"><span><i style="background:var(--income)"></i>Gelir</span><span><i style="background:var(--expense)"></i>Gider</span></div></header>
          ${barChart(key)}</div>
        <div class="block"><header class="block-head"><h2>Harcama dağılımı</h2><span class="aside">${ml}</span></header>${categoryBreakdown(key)}</div>
      </section>

      <section class="split even">
        <div class="block"><header class="block-head"><h2>Son kayıtlar</h2><button class="link" data-action="see-all">Tümünü gör</button></header>
          ${recent.length ? recent.map((x) => txRow(x)).join('') : emptyBox('receipt', `${ml} için kayıt yok.`, '<button class="btn line" data-action="add-tx">+ Kayıt ekle</button>')}</div>
        <div class="block"><header class="block-head"><h2>Notlar</h2></header>
          <ol class="notes">${insights(key).map((i) => `<li class="${i.tone}"><span>${i.text}</span></li>`).join('')}</ol></div>
      </section>

      ${activeDebts.length ? `<section class="section block">
        <header class="block-head"><h2>${rt.active && dt.active ? 'Borçlar & alacaklar' : rt.active ? 'Alacaklar' : 'Borçlar'}</h2>
          <span class="aside">${dt.active ? `Borç <b class="num">${fmt(dt.left)}</b>` : ''}${dt.active && rt.active ? ' · ' : ''}${rt.active ? `Alacak <b class="num">${fmt(rt.left)}</b>` : ''} · <button class="link" data-tab="debts">Tümü</button></span></header>
        ${activeDebts.slice(0, 3).map(debtRow).join('')}
      </section>` : ''}

      <section class="section block">
        <header class="block-head"><h2>Düzenli ödemeler</h2>
          ${state.recurring.length ? `<span class="aside num">${fmt(paid)} / ${fmt(fixedTotal())}${missingRates() ? ' + kuru alınamayanlar' : ''}</span>` : ''}</header>
        ${fixedSection(key)}
      </section>`;
  }

  // =====================================================================
  //  Görünüm: Kayıtlar
  // =====================================================================
  function renderTransactions() {
    $$('#fType [data-ftype]').forEach((b) => b.classList.toggle('active', b.dataset.ftype === ui.txType));
    $('#fAll').checked = ui.txAllMonths;
    if (document.activeElement !== $('#fQ')) $('#fQ').value = ui.txQuery;

    const types = ui.txType === 'all' ? ['expense', 'income'] : [ui.txType];
    const all = types.flatMap((tp) => state.categories[tp]);
    if (ui.txCat !== 'all' && !all.some((c) => c.id === ui.txCat)) ui.txCat = 'all';
    const opt = (c) => `<option value="${esc(c.id)}" data-icon="${c.icon}"${c.id === ui.txCat ? ' selected' : ''}>${esc(c.name)}</option>`;
    $('#fCat').innerHTML = `<option value="all">Tüm kategoriler</option>` + (types.length > 1
      ? `<optgroup label="Gider">${state.categories.expense.map(opt).join('')}</optgroup><optgroup label="Gelir">${state.categories.income.map(opt).join('')}</optgroup>`
      : all.map(opt).join(''));

    let list = ui.txAllMonths ? [...state.transactions] : txInMonth(ui.month);
    if (ui.txType !== 'all') list = list.filter((t) => t.type === ui.txType);
    if (ui.txCat !== 'all') list = list.filter((t) => t.category === ui.txCat);
    const q = ui.txQuery.trim().toLocaleLowerCase('tr-TR');
    if (q) list = list.filter((t) => `${t.note} ${category(t.type, t.category).name}`.toLocaleLowerCase('tr-TR').includes(q));
    list.sort(sortTx);

    const tt = totals(list);
    $('#txSummary').innerHTML = `<span>${ui.txAllMonths ? 'Tüm aylar' : monthLabel(ui.month)}</span><span>Kayıt<b>${list.length}</b></span>` +
      `<span>Gelir<b class="pos">${fmt(tt.income)}</b></span><span>Gider<b class="neg">${fmt(tt.expense)}</b></span><span>Net<b>${fmtSigned(tt.net)}</b></span>`;

    if (!list.length) {
      const filtered = ui.txType !== 'all' || ui.txCat !== 'all' || q;
      $('#txList').innerHTML = emptyBox('receipt',
        filtered ? 'Filtrelere uyan kayıt yok.' : `${ui.txAllMonths ? 'Henüz' : monthLabel(ui.month) + ' için'} kayıt yok.`,
        '<button class="btn line" data-action="add-tx">+ Kayıt ekle</button>');
      return;
    }
    const groups = new Map();
    for (const t of list) { if (!groups.has(t.date)) groups.set(t.date, []); groups.get(t.date).push(t); }
    $('#txList').innerHTML = [...groups].map(([date, items]) => {
      const n = totals(items).net;
      return `<div class="day"><div class="day-head"><span class="d">${cap(dayLabel(date, true))}</span><span class="n ${n >= 0 ? 'pos' : ''}">${fmtSigned(n)}</span></div>
        ${items.map((t) => txRow(t, false)).join('')}</div>`;
    }).join('');
  }

  // =====================================================================
  //  Görünüm: Düzenli ödemeler
  // =====================================================================
  function renderRecurring() {
    const key = ui.month;
    const list = [...state.recurring].sort((a, b) => a.day - b.day);
    let paid = 0, paidCount = 0, late = false;
    const statuses = list.map((r) => {
      const s = recurringStatus(r, key);
      if (s.code === 'paid') { paid += s.tx.amount; paidCount++; }
      if (s.code === 'late') late = true;
      return s;
    });
    const total = fixedTotal();
    const remaining = sum(list.map((r, i) => (statuses[i].code === 'paid' ? 0 : recBase(r) || 0)));
    const r = rhythm();
    const foreign = list.some((x) => x.currency !== base());
    const share = r && r.avgIncome > 0 ? `Ortalama gelirinin %${Math.round((total / r.avgIncome) * 100)} kadarı` : 'Her ay en az bu kadar lazım';
    $('#recSummary').innerHTML = `
      <div><div class="k">Aylık toplam${foreign ? ' · güncel kurla' : ''}</div><div class="v">${fmt(total)}</div><div class="s">${missingRates() ? 'Bazı kurlar alınamadı' : share}</div></div>
      <div><div class="k">${monthLabel(key)} ödenen</div><div class="v pos">${fmt(paid)}</div><div class="s">${paidCount} / ${list.length} ödeme</div></div>
      <div><div class="k">Kalan</div><div class="v ${remaining > 0 ? 'neg' : ''}">${fmt(remaining)}</div><div class="s">${late ? 'Geciken ödeme var' : '&nbsp;'}</div></div>`;
    $('#recList').innerHTML = list.length
      ? list.map((x, i) => recRow(x, statuses[i])).join('')
      : emptyBox('calendar', 'Henüz düzenli ödeme yok.', '<button class="btn line" data-action="add-rec">+ Düzenli ödeme ekle</button>');
  }

  // =====================================================================
  //  Görünüm: Borçlar
  // =====================================================================
  function renderDebts() {
    const recv = ui.debtKind === 'receivable';
    $$('#debtTabs [data-debt-tab]').forEach((b) => b.classList.toggle('active', b.dataset.debtTab === ui.debtKind));
    $('#debtAddBtn').textContent = recv ? '+ Alacak ekle' : '+ Borç ekle';
    $('#debtAddBtn').dataset.kind = ui.debtKind;
    $('#debtIntro').textContent = recv
      ? 'Birine verdiğin borçları yaz. Geri ödedikçe “Tahsil et” de; kalan otomatik düşer. Borç verme ve tahsilat bakiyeni değiştirir ama gelir/gider istatistiklerine sayılmaz.'
      : 'Ödemen gereken borçları yaz: kredi kartı, taksitler, birine olan borcun. Taksitli borçlarda ayın taksitini tek dokunuşla ödersin. Ödemeler gider olarak da kaydedilir, bakiyen güncel kalır.';

    const list = state.debts.filter((d) => (d.kind || 'debt') === ui.debtKind).sort(sortDebts);
    const active = list.filter((d) => !debtInfo(d).closed);
    const closed = list.filter((d) => debtInfo(d).closed);
    const dt = debtTotals(ui.debtKind);
    const key = currentMonth();
    const ids = new Set(list.map((d) => d.id));
    const movedThisMonth = sum(state.transactions.filter((t) => ids.has(t.debtId) && t.date.startsWith(key)).map((t) => t.amount));
    const next = active.find((d) => debtInfo(d).due);
    const monthly = recv ? 0 : planMonthly();
    $('#debtSummary').innerHTML = `
      <div><div class="k">${recv ? 'Toplam alacak' : 'Toplam kalan borç'}</div><div class="v ${dt.left > 0 ? (recv ? 'pos' : 'neg') : ''}">${fmt(dt.left)}</div>
        <div class="s">${dt.active} açık ${recv ? 'alacak' : 'borç'}${dt.missing ? ' · bazı kurlar alınamadı' : ''}</div></div>
      <div><div class="k">${monthLabel(key)} ${recv ? 'tahsil edilen' : 'ödenen'}</div><div class="v ${recv ? 'pos' : ''}">${fmt(movedThisMonth)}</div>
        <div class="s">${monthly ? `Aylık taksit yükü ${fmt(monthly)}` : recv ? 'Geri alınan' : 'Borç ödemeleri'}</div></div>
      <div><div class="k">${recv ? 'En yakın tarih' : 'En yakın ödeme'}</div><div class="v">${next ? esc(next.name) : '—'}</div><div class="s">${next ? debtInfo(next).due.label : 'Tarihli kayıt yok'}</div></div>`;
    $('#debtList').innerHTML = !list.length
      ? emptyBox(recv ? 'banknote' : 'card', recv
        ? 'Henüz alacak eklemedin. Birine borç verdiysen ekle; geri ödedikçe kalanı takip et.'
        : 'Henüz borç eklemedin. Ödemen gereken bir borç varsa ekle; her ödemede kalanı takip et.',
      `<button class="btn line" data-action="add-debt" data-kind="${ui.debtKind}">${recv ? '+ Alacak ekle' : '+ Borç ekle'}</button>`)
      : `${active.length ? active.map(debtRow).join('') : emptyBox('sparkles', recv ? 'Açık alacağın yok.' : 'Açık borcun yok. Tebrikler!')}
        ${closed.length ? `<header class="block-head closed-head"><h2>${recv ? 'Kapanan alacaklar' : 'Kapanan borçlar'}</h2><span class="aside">${closed.length}</span></header>${closed.map(debtRow).join('')}` : ''}`;
  }

  // =====================================================================
  //  Görünüm: Ayarlar
  // =====================================================================
  function renderSettings() {
    const s = state.settings;
    const setVal = (id, v) => { const el = $(id); if (document.activeElement !== el) el.value = v; };
    setVal('#sStart', s.startBalance ? toInputAmount(s.startBalance) : '');
    setVal('#sBudget', s.monthlyBudget ? toInputAmount(s.monthlyBudget) : '');
    setVal('#sEmergency', s.emergencyMonths);
    $('#sCurrency').value = s.currency;
    $('#sTheme').value = s.theme;

    for (const type of ['expense', 'income']) {
      const counts = {};
      for (const t of state.transactions) if (t.type === type) counts[t.category] = (counts[t.category] || 0) + 1;
      $(type === 'expense' ? '#catExpense' : '#catIncome').innerHTML = state.categories[type].map((c) => `
        <div class="cat-item">${img(c.icon, '', 24)}<span>${esc(c.name)}</span><small>${counts[c.id] || ''}</small>
        ${PROTECTED_CATS.has(c.id) ? '' : `<button class="del" data-action="del-cat" data-type="${type}" data-id="${esc(c.id)}" aria-label="${esc(c.name)} kategorisini sil" title="Sil">×</button>`}</div>`).join('');
    }

    const others = Object.keys(CURRENCIES).filter((c) => c !== base());
    const r = state.rates;
    $('#rateInfo').innerHTML = others.map((c) => {
      const k = rateOf(c);
      return `<div class="rate-row"><span>1 ${c}</span><span>${k == null ? '—' : fmtRate(k)}</span></div>`;
    }).join('') + `<p class="muted small">${ui.ratesLoading ? 'Kurlar güncelleniyor…'
      : r && r.base === base() ? `Son güncelleme ${dayLabel(r.fetchedAt.slice(0, 10)).toLocaleLowerCase('tr-TR')} ${timeLabel(r.fetchedAt)} · kaynak ${esc(r.source)}. Saatte bir otomatik yenilenir.`
        : 'Kurlar henüz alınamadı.'}</p>
      <button class="btn line sm" data-action="refresh-rates"${ui.ratesLoading ? ' disabled' : ''}>Şimdi yenile</button>`;

    renderLockBox();
    renderNotifyBox();

    $('#tplList').innerHTML = state.templates.length
      ? state.templates.map((t) => `<div class="cat-item">${img(category(t.type, t.category).icon, '', 24)}<span>${esc(tplLabel(t))}</span>
          <small>${t.type === 'income' ? '+' : ''}${fmt(t.amount, t.currency)}</small>
          <button class="del" data-action="del-template" data-id="${t.id}" aria-label="${esc(tplLabel(t))} şablonunu sil" title="Sil">×</button></div>`).join('')
      : '<p class="muted small">Yeni kayıt eklerken “Hızlı ekleme şablonu olarak da kaydet”i işaretle; Özet\'in en üstünde tek dokunuşla eklenen bir düğme olur.</p>';

    const lb = s.lastBackup;
    $('#backupInfo').innerHTML = `${state.transactions.length} kayıt · ${state.recurring.length} düzenli ödeme<br>` +
      (lb ? `Son yedek: <b>${new Date(lb).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</b>` : '<span class="neg">Henüz yedek alınmadı.</span>');
  }

  function renderRates() {
    const others = Object.keys(CURRENCIES).filter((c) => c !== base());
    const r = state.rates;
    $('#rateTicker').innerHTML = `<div class="rates-title">Güncel kur</div>` +
      others.map((c) => { const k = rateOf(c); return `<div class="rate-row"><span>${c}</span><span>${k == null ? '—' : fmtRate(k)}</span></div>`; }).join('') +
      `<div class="rates-foot"><span>${ui.ratesLoading ? 'güncelleniyor…' : ui.ratesError && !r ? 'alınamadı' : r ? timeLabel(r.fetchedAt) : ''}</span>
        <button class="link" data-action="refresh-rates"${ui.ratesLoading ? ' disabled' : ''}>yenile</button></div>`;
  }

  // =====================================================================
  //  Genel çizim
  // =====================================================================
  function render() {
    const ml = $('#monthLabel');
    ml.textContent = monthLabel(ui.month);
    ml.classList.toggle('not-current', ui.month !== currentMonth());
    ml.title = ui.month !== currentMonth() ? 'Bu aya dön' : '';
    $('#viewTitle').textContent = TITLES[ui.tab];
    document.title = `${TITLES[ui.tab]} · mFinance`;
    document.body.dataset.view = ui.tab;
    $$('button[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${ui.tab}`));
    ({ dashboard: renderDashboard, transactions: renderTransactions, recurring: renderRecurring, debts: renderDebts, settings: renderSettings })[ui.tab]();
    renderRates();
    if (txDlg.open) updateTxConv();
    if (recDlg.open) updateRecConv();
    syncSelects();
  }

  function setTab(tab) {
    if (!TABS.includes(tab)) return;
    const changed = ui.tab !== tab;
    ui.tab = tab;
    history.replaceState(null, '', `#${tab}`);
    render();
    if (changed) window.scrollTo(0, 0);
  }

  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }

  let toastTimer;
  function toast(msg, action) {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn">${esc(action.label)}</button>` : ''}`;
    if (action) el.querySelector('button').onclick = () => { action.fn(); el.classList.remove('show'); };
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2600);
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // =====================================================================
  //  Bulut senkronu (Supabase)
  //  Tek satır = bir kullanıcının tüm defteri (jsonb). Çakışmalar kayıt bazında birleştirilir
  //  (js/merge.js), yazma ise "version" alanıyla iyimser kilitle yapılır: araya başka cihaz
  //  yazdıysa tekrar çekilir, birleştirilir, yeniden denenir.
  // =====================================================================
  const CFG = window.MFINANCE_CONFIG || {};
  const M = window.MFMerge;
  const sync = { client: null, session: null, status: 'off', lastAt: 0, error: '', running: false, again: false, timer: null, channel: null };
  const syncConfigured = () => !!(CFG.supabaseUrl && CFG.supabaseAnonKey && window.supabase?.createClient);
  const uidOf = () => sync.session?.user?.id || null;

  function setSyncStatus(status, error = '') {
    sync.status = status; sync.error = error;
    const text = {
      off: syncConfigured() ? 'Senkron kapalı' : 'Yalnızca bu cihaz',
      busy: 'Eşitleniyor…', ok: 'Eşitlendi', err: 'Senkron hatası', offline: 'Çevrimdışı',
    }[status];
    $$('[data-sync-pill]').forEach((p) => {
      p.className = `sync-pill ${status}`;
      p.querySelector('span').textContent = text;
      p.title = error || text;
    });
    const info = $('#syncInfo');
    if (info) {
      info.innerHTML = status === 'err' ? `<span class="neg">${esc(error || 'Eşitlenemedi')}</span>`
        : status === 'offline' ? 'İnternet yok. Değişiklikler bağlanınca gönderilecek.'
          : sync.lastAt ? `Son eşitleme: ${timeLabel(new Date(sync.lastAt).toISOString())}` : 'Eşitleniyor…';
    }
  }

  function scheduleSync(delay = 800) {
    if (!sync.session) return;
    clearTimeout(sync.timer);
    sync.timer = setTimeout(syncNow, delay);
  }

  async function syncNow() {
    if (!sync.client || !sync.session) return;
    if (sync.running) { sync.again = true; return; }
    if (!navigator.onLine) { setSyncStatus('offline'); return; }
    sync.running = true;
    setSyncStatus('busy');
    const uid = uidOf();
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const { data: row, error } = await sync.client.from('user_state').select('data, version').eq('user_id', uid).maybeSingle();
        if (error) throw error;

        // 1) Uzaktakini yerelle birleştir
        if (row?.data) {
          const before = M.canonical(M.cloudPayload(state));
          const merged = normalize(M.mergeStates(state, normalize(row.data)));
          merged.owner = state.owner; merged.rates = state.rates;
          if (M.canonical(M.cloudPayload(merged)) !== before) {
            const themeBefore = state.settings.theme;
            state = merged;
            saveLocal();
            if (state.settings.theme !== themeBefore) applyTheme();
            render();
          }
        }

        // 2) Uzakta eksik ne varsa gönder
        const payload = M.cloudPayload(state);
        if (row?.data && M.canonical(payload) === M.canonical(row.data)) break;
        const res = row
          ? await sync.client.from('user_state')
            .update({ data: payload, version: row.version + 1, updated_at: new Date().toISOString() })
            .eq('user_id', uid).eq('version', row.version).select('version')
          : await sync.client.from('user_state').insert({ user_id: uid, data: payload, version: 1 }).select('version');
        if (res.error) {
          if (!row && res.error.code === '23505') continue; // başka cihaz aynı anda ilk satırı yazdı
          throw res.error;
        }
        if (res.data?.length) break; // yazıldı
        // version uyuşmadı: araya başka cihaz yazdı → baştan çek ve birleştir
      }
      sync.lastAt = Date.now();
      setSyncStatus('ok');
    } catch (e) {
      console.warn('[mFinance] Senkron hatası', e);
      setSyncStatus(navigator.onLine ? 'err' : 'offline', e?.message || String(e));
    } finally {
      sync.running = false;
      if (sync.again) { sync.again = false; scheduleSync(200); }
    }
  }

  function startRealtime() {
    stopRealtime();
    const uid = uidOf();
    sync.channel = sync.client.channel(`mf-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_state', filter: `user_id=eq.${uid}` }, () => scheduleSync(250))
      .subscribe();
  }
  function stopRealtime() {
    if (sync.channel) { sync.client.removeChannel(sync.channel); sync.channel = null; }
  }

  function resetLocalData() {
    const rates = state.rates;
    state = defaultState();
    state.rates = rates;
    saveLocal();
    applyTheme();
  }

  // ---- Kullanıcı adıyla giriş ----
  // Supabase hesapları e-postayla tanır. Kullanıcı adını, hiçbir zaman e-posta gönderilmeyen sabit bir
  // adrese çeviriyoruz (kullanici@mfinance.local). Bu yüzden Supabase'de "Confirm email" KAPALI olmalı.
  const USER_DOMAIN = CFG.userDomain || 'mfinance.local';
  const TR_MAP = { ı: 'i', ğ: 'g', ü: 'u', ş: 's', ö: 'o', ç: 'c' };
  const normUser = (u) => String(u || '').trim().toLocaleLowerCase('tr-TR').replace(/[ığüşöç]/g, (c) => TR_MAP[c]);
  const userEmail = (u) => `${u}@${USER_DOMAIN}`;
  const usernameOf = (user) => user?.user_metadata?.username || String(user?.email || '').split('@')[0];
  let booted = false;

  function onSignedIn() {
    const uid = uidOf();
    const localCount = state.transactions.length + state.recurring.length + state.debts.length;
    if (state.owner && state.owner !== uid) {
      resetLocalData(); // bu cihazda başka hesabın verisi var → karışmasın
    } else if (!state.owner && localCount) {
      const keep = confirm(`Bu cihazda hiçbir hesaba bağlı olmayan ${localCount} kayıt var.\n\n"Tamam": bu kayıtlar ${usernameOf(sync.session.user)} hesabına aktarılır.\n"İptal": bu cihazdan silinir, yalnızca hesabındaki veriler gelir.`);
      if (!keep) resetLocalData();
    }
    state.owner = uid;
    saveLocal();
    hideAuth();
    startRealtime();
    syncNow();
    renderAccount();
    render();
  }

  function handleSignedOut() {
    stopRealtime();
    sync.session = null; sync.lastAt = 0;
    resetLocalData();
    window.MFLock?.reset(); // PIN hesaba özel: sonraki kullanıcı kendi PIN'ini belirler
    setSyncStatus('off');
    renderAccount();
    setTab('dashboard');
    showAuth();
  }

  function initClient() {
    sync.client = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'mfinance:auth' },
    });
    sync.client.auth.onAuthStateChange((event, session) => {
      const prev = uidOf();
      sync.session = session;
      // Supabase bu geri çağrının içinde istek atılmasını önermiyor → bir sonraki tura bırak
      setTimeout(() => {
        if (!booted) return; // açılıştaki ilk kararı boot() veriyor
        if (session && session.user.id !== prev) onSignedIn();
        else if (!session && prev && !sync.signingOut) handleSignedOut();
        else renderAccount();
      }, 0);
    });
  }

  const authMsg = (e) => {
    const m = e?.message || String(e);
    if (/Invalid login credentials/i.test(m)) return 'Kullanıcı adı ya da şifre yanlış.';
    if (/already registered|already exists/i.test(m)) return 'Bu kullanıcı adı alınmış, başka bir tane dene.';
    if (/confirm-required|not confirmed|sending confirmation|Error sending/i.test(m)) {
      return 'Kayıt tamamlanamadı: Supabase\'de "Confirm email" ayarı açık. Kapatılınca kayıt çalışır.';
    }
    if (/Signups not allowed|signup.*disabled/i.test(m)) return 'Yeni kayıtlar kapalı.';
    if (/Password should|weak/i.test(m)) return 'Şifre çok zayıf; daha uzun bir şifre dene.';
    if (/rate limit|too many/i.test(m)) return 'Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.';
    if (/fetch|network|Failed to/i.test(m)) return 'Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.';
    return m;
  };

  // ---- Giriş / kayıt ekranı ----
  const gate = { mode: 'in' };
  function setAuthMode(mode) {
    gate.mode = mode;
    const up = mode === 'up';
    $$('[data-auth-mode]').forEach((b) => b.classList.toggle('active', b.dataset.authMode === mode));
    $('#agPass2Wrap').hidden = !up;
    $('#agUserHint').hidden = !up;
    $('#agPass').autocomplete = up ? 'new-password' : 'current-password';
    $('#agPass').placeholder = up ? 'En az 8 karakter' : '';
    $('#agSubmit').textContent = up ? 'Hesap oluştur' : 'Giriş yap';
    $('#agError').textContent = '';
    $('#agFoot').textContent = up
      ? 'Her hesabın verisi ayrı tutulur; başka biri seninkini göremez. Şifreni unutma: e-posta olmadığı için sıfırlama bağlantısı gönderilemez.'
      : 'Hesabın yoksa “Kayıt ol”a geç. Her kullanıcı kendi kullanıcı adıyla girer; veriler birbirinden tamamen ayrıdır.';
  }
  function showAuth() {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    document.documentElement.classList.remove('is-locked');
    document.documentElement.classList.add('needs-auth');
    window.MFLock?.pause?.(true);
    $('#auth').hidden = false;
    setAuthMode(gate.mode);
    setTimeout(() => $('#agUser').focus(), 60);
  }
  function hideAuth() {
    document.documentElement.classList.remove('needs-auth');
    window.MFLock?.pause?.(false);
    $('#auth').hidden = true;
    $('#agPass').value = ''; $('#agPass2').value = ''; $('#agError').textContent = '';
  }
  $('#auth').addEventListener('click', (e) => {
    const b = e.target.closest('[data-auth-mode]');
    if (b) { setAuthMode(b.dataset.authMode); $('#agUser').focus(); }
  });
  $('#authGateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = (m) => { $('#agError').textContent = m; };
    const up = gate.mode === 'up';
    const username = normUser($('#agUser').value);
    const password = $('#agPass').value;
    if (!/^[a-z0-9._-]{3,24}$/.test(username)) return err('Kullanıcı adı 3–24 karakter olmalı: harf, rakam, nokta, alt çizgi ya da tire. Boşluk olamaz.');
    if (!password) return err('Şifreni gir.');
    if (up && password.length < 8) return err('Şifre en az 8 karakter olmalı.');
    if (up && password !== $('#agPass2').value) return err('Şifreler eşleşmiyor.');
    if (!navigator.onLine) return err('İnternet bağlantısı yok.');
    const btn = $('#agSubmit');
    btn.disabled = true; err('');
    try {
      if (up) {
        const { data, error } = await sync.client.auth.signUp({ email: userEmail(username), password, options: { data: { username } } });
        if (error) throw error;
        if (!data.session) throw new Error('confirm-required');
        toast(`Hoş geldin, ${username}!`);
      } else {
        const { error } = await sync.client.auth.signInWithPassword({ email: userEmail(username), password });
        if (error) throw error;
        toast(`Tekrar hoş geldin, ${username}`);
      }
    } catch (ex) {
      console.warn('[mFinance] Giriş', ex);
      err(authMsg(ex));
    } finally {
      btn.disabled = false;
    }
  });

  // ---- Ayarlar → Hesap ----
  function renderAccount() {
    const box = $('#accountBox');
    const mini = $('#whoMini');
    if (!syncConfigured()) {
      if (box) box.innerHTML = '<p class="muted small">Senkron kurulmadı; veriler yalnızca bu cihazda.</p>';
      if (mini) mini.textContent = '';
      return;
    }
    if (!sync.session) { if (box) box.innerHTML = ''; if (mini) mini.textContent = ''; return; }
    const name = usernameOf(sync.session.user);
    if (mini) mini.textContent = name;
    if (!box) return;
    box.innerHTML = `
      <div class="who-line"><span class="avatar">${esc(name.charAt(0))}</span>
        <div><div class="who">${esc(name)}</div><div class="muted small">Bu hesabın verileri yalnızca sana görünür</div></div></div>
      <div class="small" id="syncInfo"></div>
      <div class="btn-row">
        <button class="btn line sm" data-action="sync-now">Şimdi eşitle</button>
        <button class="btn line sm" data-action="change-pass">Şifre değiştir</button>
        <button class="btn line sm danger" data-action="sign-out">Çıkış yap</button>
      </div>`;
    setSyncStatus(sync.status === 'off' ? 'busy' : sync.status, sync.error);
  }

  function openPassForm() {
    if ($('#passForm')) return;
    $('#accountBox').insertAdjacentHTML('beforeend', `
      <form id="passForm" novalidate style="margin-top:6px">
        <label class="field"><span>Yeni şifre</span><input id="np1" type="password" autocomplete="new-password" placeholder="En az 8 karakter" maxlength="72"></label>
        <label class="field"><span>Yeni şifre tekrar</span><input id="np2" type="password" autocomplete="new-password" maxlength="72"></label>
        <p class="form-error" id="npErr" role="alert"></p>
        <div class="btn-row"><button class="btn ink sm" type="submit">Şifreyi kaydet</button><button class="btn line sm" type="button" id="npCancel">Vazgeç</button></div>
      </form>`);
    $('#np1').focus();
    $('#npCancel').addEventListener('click', () => $('#passForm').remove());
    $('#passForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = (m) => { $('#npErr').textContent = m; };
      const p1 = $('#np1').value;
      if (p1.length < 8) return err('Şifre en az 8 karakter olmalı.');
      if (p1 !== $('#np2').value) return err('Şifreler eşleşmiyor.');
      const { error } = await sync.client.auth.updateUser({ password: p1 });
      if (error) return err(authMsg(error));
      $('#passForm').remove();
      toast('Şifre değiştirildi');
    });
  }

  async function signOut({ silent = false } = {}) {
    if (!silent && !confirm('Çıkış yapılınca bu cihazdaki veriler ve PIN kilidi silinir; verilerin hesabında durur. Tekrar giriş yapınca geri gelir.\n\nDevam edilsin mi?')) return;
    if (!silent) await syncNow(); // son değişiklikler kaybolmasın
    await disablePush({ silent: true }); // bu cihaz bir sonraki kullanıcının bildirimlerini almasın
    sync.signingOut = true;
    stopRealtime();
    try { await sync.client.auth.signOut({ scope: 'local' }); } catch (e) { console.warn(e); }
    sync.signingOut = false;
    handleSignedOut();
    if (!silent) toast('Çıkış yapıldı');
  }

  // =====================================================================
  //  Bildirimler (Web Push)
  //  iPhone'da yalnızca "Ana Ekrana Ekle" ile kurulmuş uygulamada çalışır (iOS 16.4+).
  // =====================================================================
  const PUSH_KEY = CFG.vapidPublicKey || '';
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isStandalone = () => window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function b64urlToBytes(s) {
    const pad = '='.repeat((4 - (s.length % 4)) % 4);
    const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  async function currentPushSub() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg ? reg.pushManager.getSubscription() : null;
  }
  async function enablePush() {
    if (!sync.session) { toast('Önce giriş yap'); return; }
    if (isIOS && !isStandalone()) {
      toast("iPhone'da önce Safari → Paylaş → Ana Ekrana Ekle ile kur, sonra uygulamayı ana ekrandan aç.");
      return;
    }
    if (!pushSupported()) { toast('Bu tarayıcı bildirimleri desteklemiyor'); return; }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Bildirim izni verilmedi'); renderNotifyBox(); return; }
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(PUSH_KEY) });
      const j = sub.toJSON();
      const { error } = await sync.client.from('push_subscriptions').upsert(
        { user_id: uidOf(), endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) },
        { onConflict: 'endpoint' },
      );
      if (error) throw error;
      toast('Bildirimler açıldı');
    } catch (e) {
      console.warn('[mFinance] Bildirim', e);
      toast(`Bildirimler açılamadı: ${e.message || e}`);
    }
    renderNotifyBox();
  }
  async function disablePush({ silent = false } = {}) {
    try {
      const sub = await currentPushSub();
      if (sub) {
        if (sync.client && sync.session) await sync.client.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
        await sub.unsubscribe();
      }
    } catch (e) { console.warn('[mFinance] Bildirim kapatma', e); }
    if (!silent) { toast('Bildirimler kapatıldı'); renderNotifyBox(); }
  }
  async function testPush() {
    try {
      const r = await fetch('/api/push', { method: 'POST', headers: { Authorization: `Bearer ${sync.session?.access_token || ''}` } });
      const j = await r.json().catch(() => ({}));
      toast(r.ok ? `Test bildirimi gönderildi${j.reminders ? ` · bugün ${j.reminders} hatırlatma var` : ''}` : (j.error || 'Gönderilemedi'));
    } catch {
      toast('Sunucuya ulaşılamadı');
    }
  }
  async function renderNotifyBox() {
    const box = $('#notifyBox');
    if (!box) return;
    if (!syncConfigured() || !PUSH_KEY) { box.innerHTML = '<p class="muted small">Bildirimler henüz yapılandırılmadı.</p>'; return; }
    const about = 'Her sabah 09:00 civarı: yaklaşan düzenli ödemeler, taksit ve borç tarihleri, alacak günleri ve bütçenin %80 ile %100\'ü.';
    if (!pushSupported()) {
      box.innerHTML = isIOS
        ? `<p class="small">iPhone'da bildirimler için uygulamayı <b>Safari → Paylaş → Ana Ekrana Ekle</b> ile kur ve ana ekrandaki ikondan aç (iOS 16.4 ve üzeri).</p><p class="muted small">${about}</p>`
        : '<p class="muted small">Bu tarayıcı bildirimleri desteklemiyor.</p>';
      return;
    }
    const sub = await currentPushSub().catch(() => null);
    const perm = Notification.permission;
    if (sub && perm === 'granted') {
      box.innerHTML = `<p class="small">Bu cihazda bildirimler <b class="pos">açık</b>.</p><p class="muted small">${about}</p>
        <div class="btn-row"><button class="btn line sm" data-action="push-test">Test bildirimi gönder</button>
        <button class="btn line sm danger" data-action="push-off">Kapat</button></div>`;
    } else if (perm === 'denied') {
      box.innerHTML = '<p class="small neg">Bildirim izni kapalı.</p><p class="muted small">iPhone: Ayarlar → Bildirimler → mFinance. Bilgisayar: adres çubuğundaki site ayarları → Bildirimler → İzin ver.</p>';
    } else {
      box.innerHTML = `<p class="muted small">${about}</p>
        ${isIOS && !isStandalone() ? '<p class="small">iPhone\'da önce <b>Ana Ekrana Ekle</b> ile kurup uygulamayı oradan açman gerekiyor.</p>' : ''}
        <button class="btn ink sm" data-action="push-on">Bildirimleri aç</button>`;
    }
  }

  // =====================================================================
  //  Uygulama kilidi ayarları
  // =====================================================================
  async function renderLockBox() {
    const box = $('#lockBox');
    const L = window.MFLock;
    const delayRow = $('#lockDelayRow');
    if (!L || !L.supported()) {
      box.innerHTML = '<p class="muted small">Kilit, uygulama güvenli (https) bir adresten açıldığında kullanılabilir.</p>';
      delayRow.hidden = true;
      return;
    }
    const s = L.settings();
    if (!s) {
      box.innerHTML = `<p class="muted small">Uygulama her açıldığında PIN sorsun; telefonun başkasının elindeyken giderlerin ve birikimin görünmesin.</p>
        <button class="btn ink" data-action="lock-enable">PIN belirle</button>`;
      delayRow.hidden = true;
      return;
    }
    const bioOk = await L.bioAvailable();
    box.innerHTML = `
      <div class="toggle-row"><span>PIN açık<small>${s.length} haneli · bu cihaza özel</small></span>
        <button class="btn line sm" data-action="lock-change">Değiştir</button></div>
      ${bioOk ? `<div class="toggle-row"><span>${L.bioName()} ile aç<small>PIN yerine yüzün ya da parmak izinle</small></span>
        <label class="switch"><input type="checkbox" id="bioToggle"${s.bio ? ' checked' : ''} aria-label="${L.bioName()} ile aç"><span></span></label></div>` : ''}`;
    delayRow.hidden = false;
    $('#sLockDelay').value = String(s.delay);
    syncSelects();
    // Kilidi kapat ve şimdi kilitle düğmeleri gecikme satırının altında dursun
    let extra = $('#lockExtra');
    if (!extra) { extra = document.createElement('div'); extra.id = 'lockExtra'; extra.className = 'btn-row'; extra.style.marginTop = '10px'; delayRow.after(extra); }
    extra.innerHTML = `<button class="btn line sm" data-action="lock-now">Şimdi kilitle</button><button class="btn line sm danger" data-action="lock-disable">Kilidi kapat</button>`;
    $('#bioToggle')?.addEventListener('change', async (e) => {
      if (e.target.checked) {
        try { await L.enableBio(); toast(`${L.bioName()} açıldı`); }
        catch (ex) { e.target.checked = false; toast(`${L.bioName()} açılamadı`); console.warn(ex); }
      } else { L.disableBio(); toast(`${L.bioName()} kapatıldı`); }
    });
  }

  async function forgotPin() {
    if (sync.session) {
      if (!confirm("PIN'i sıfırlamak için hesaptan çıkış yapılacak.\nVerilerin hesabında duruyor; kullanıcı adın ve şifrenle tekrar giriş yapınca geri gelir.\n\nDevam edilsin mi?")) return;
      window.MFLock.reset();
      await signOut({ silent: true }); // giriş ekranına döner
      toast('Kilit kaldırıldı. Kullanıcı adın ve şifrenle giriş yap.');
      return;
    }
    if (!confirm("Hesap bağlı olmadığı için PIN'i sıfırlamak bu cihazdaki TÜM verileri siler.\n\nDevam edilsin mi?")) return;
    resetLocalData();
    window.MFLock.reset();
    render();
    toast('Kilit kaldırıldı');
  }

  // =====================================================================
  //  Özel açılır menü (native <select> gizli kalır, değer ve change olayı onda)
  // =====================================================================
  const selects = [];
  let openSelect = null;

  function enhanceSelect(sel, variant = '') {
    const wrap = document.createElement('div');
    wrap.className = `cselect ${variant}`;
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    sel.classList.add('cselect-native');
    sel.tabIndex = -1;
    sel.setAttribute('aria-hidden', 'true');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cselect-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    if (sel.getAttribute('aria-label')) btn.setAttribute('aria-label', sel.getAttribute('aria-label'));
    const list = document.createElement('div');
    list.className = 'cselect-list';
    list.setAttribute('role', 'listbox');
    wrap.append(btn);
    // Liste body'de değil, en yakın dialog ya da body'de durmalı (dialog üst katmanda)
    (sel.closest('dialog') || document.body).appendChild(list);
    const inst = { sel, wrap, btn, list };
    selects.push(inst);

    btn.addEventListener('click', () => (openSelect === inst ? closeSelect() : openSelectList(inst)));
    btn.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openSelectList(inst); }
    });
    list.addEventListener('click', (e) => {
      const o = e.target.closest('.cselect-opt');
      if (o) chooseOption(inst, o.dataset.value);
    });
    list.addEventListener('keydown', (e) => {
      const opts = $$('.cselect-opt', list);
      const i = opts.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); opts[Math.min(opts.length - 1, i + 1)]?.focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); opts[Math.max(0, i - 1)]?.focus(); }
      else if (e.key === 'Home') { e.preventDefault(); opts[0]?.focus(); }
      else if (e.key === 'End') { e.preventDefault(); opts[opts.length - 1]?.focus(); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSelect(true); }
      else if (e.key === 'Tab') closeSelect();
    });
    syncSelect(inst);
    return inst;
  }

  const optLabel = (o) => `${o.dataset.icon ? img(o.dataset.icon, '', 20) : ''}<span class="cselect-val">${esc(o.textContent)}</span>`;

  function syncSelect(inst) {
    const o = inst.sel.selectedOptions[0];
    inst.btn.innerHTML = (o ? optLabel(o) : '<span class="cselect-val"></span>') + CHEVRON;
  }
  function syncSelects() { selects.forEach(syncSelect); }

  function openSelectList(inst) {
    closeSelect();
    const { sel, btn, list, wrap } = inst;
    const opt = (o) => `<button type="button" class="cselect-opt" role="option" data-value="${esc(o.value)}" aria-selected="${o.selected}">${optLabel(o)}<span class="tick">${TICK}</span></button>`;
    list.innerHTML = [...sel.children].map((ch) => ch.tagName === 'OPTGROUP'
      ? `<div class="cselect-group">${esc(ch.label)}</div>${[...ch.children].map(opt).join('')}`
      : opt(ch)).join('');
    const rect = btn.getBoundingClientRect();
    list.style.minWidth = `${Math.max(rect.width, 180)}px`;
    list.classList.add('show');
    const h = list.offsetHeight;
    const below = window.innerHeight - rect.bottom;
    list.style.top = `${below < h + 12 && rect.top > h + 12 ? rect.top - h - 6 : rect.bottom + 6}px`;
    list.style.left = `${Math.min(rect.left, window.innerWidth - list.offsetWidth - 8)}px`;
    wrap.classList.add('open');
    btn.setAttribute('aria-expanded', 'true');
    openSelect = inst;
    ($('.cselect-opt[aria-selected="true"]', list) || $('.cselect-opt', list))?.focus({ preventScroll: true });
  }
  function closeSelect(refocus = false) {
    if (!openSelect) return;
    const { list, wrap, btn } = openSelect;
    list.classList.remove('show');
    wrap.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
    openSelect = null;
    if (refocus) btn.focus();
  }
  function chooseOption(inst, value) {
    closeSelect(true);
    if (inst.sel.value === value) return;
    inst.sel.value = value;
    syncSelect(inst);
    inst.sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  document.addEventListener('pointerdown', (e) => {
    if (openSelect && !openSelect.wrap.contains(e.target) && !openSelect.list.contains(e.target)) closeSelect();
    const pick = e.target.closest('.icon-pick');
    $$('.icon-pick.open').forEach((p) => { if (p !== pick) p.classList.remove('open'); });
  });
  window.addEventListener('resize', () => closeSelect());
  document.addEventListener('scroll', (e) => { if (openSelect && !openSelect.list.contains(e.target)) closeSelect(); }, true);

  // Para birimi seçicilerini doldur
  const currencyOptions = () => Object.entries(CURRENCIES).map(([k, v]) => `<option value="${k}">${v.sym} ${k}</option>`).join('');
  $('#txCurrency').innerHTML = currencyOptions();
  $('#recCurrency').innerHTML = currencyOptions();

  // =====================================================================
  //  Kayıt penceresi
  // =====================================================================
  const txDlg = $('#txDialog');
  const tx = { editingId: null, type: 'expense', cat: null };

  function lastUsedCategory(type) {
    const last = [...state.transactions].filter((t) => t.type === type).sort(sortTx)[0];
    return last && state.categories[type].some((c) => c.id === last.category) ? last.category : null;
  }

  function openTx(existing, preset = {}) {
    tx.editingId = existing?.id || null;
    tx.type = existing?.type || preset.type || 'expense';
    tx.cat = existing?.category || lastUsedCategory(tx.type);
    $('#txTitle').textContent = existing ? 'Kaydı düzenle' : 'Yeni kayıt';
    $('#txCurrency').value = existing?.origCurrency || base();
    $('#txAmount').value = existing ? toInputAmount(existing.origAmount || existing.amount) : '';
    $('#txDate').value = existing?.date || (ui.month === currentMonth() ? today() : `${ui.month}-01`);
    $('#txNote').value = existing?.note || '';
    $('#txDelete').hidden = !existing;
    $('#txTplWrap').hidden = !!existing;
    $('#txSaveTpl').checked = false;
    $('#txError').textContent = '';
    syncTxType();
    updateTxConv();
    syncSelects();
    txDlg.showModal();
    $('#txAmount').focus();
    fetchRates();
  }

  function syncTxType() {
    txDlg.dataset.type = tx.type;
    $$('#txDialog .seg-type button').forEach((b) => b.classList.toggle('active', b.dataset.type === tx.type));
    const cats = state.categories[tx.type];
    if (!cats.some((c) => c.id === tx.cat)) tx.cat = lastUsedCategory(tx.type);
    $('#txCats').innerHTML = cats.map((c) =>
      `<button type="button" class="chip${c.id === tx.cat ? ' active' : ''}" data-cat="${esc(c.id)}">${img(c.icon, '', 22)}${esc(c.name)}</button>`).join('');
  }

  // Dövizli kayıtta: düzenlenen kayıt aynı para birimindeyse eski kuru koru, değilse güncel kuru kullan
  function txRate() {
    const cur = $('#txCurrency').value;
    if (cur === base()) return 1;
    const existing = tx.editingId && state.transactions.find((t) => t.id === tx.editingId);
    if (existing?.origCurrency === cur && existing.rate) return existing.rate;
    return rateOf(cur);
  }
  function convLine(amountStr, cur, rate) {
    if (cur === base()) return '';
    if (rate == null) return ui.ratesLoading ? 'Kur alınıyor…' : 'Kur alınamadı; internete bağlanınca otomatik çekilir.';
    const a = parseAmount(amountStr);
    return `${a > 0 ? `≈ <b>${fmt(Math.round(a * rate))}</b> · ` : ''}1 ${sym(cur)} = ${fmtRate(rate)}`;
  }
  function updateTxConv() { $('#txConv').innerHTML = convLine($('#txAmount').value, $('#txCurrency').value, txRate()); }
  $('#txAmount').addEventListener('input', updateTxConv);
  $('#txCurrency').addEventListener('change', () => { updateTxConv(); $('#txAmount').focus(); });

  txDlg.addEventListener('click', (e) => {
    const typeBtn = e.target.closest('.seg-type button');
    if (typeBtn) { tx.type = typeBtn.dataset.type; syncTxType(); return; }
    const chip = e.target.closest('[data-cat]');
    if (chip) {
      tx.cat = chip.dataset.cat;
      $$('#txCats .chip').forEach((c) => c.classList.toggle('active', c === chip));
      $('#txError').textContent = '';
    }
  });

  $('#txForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = (m) => { $('#txError').textContent = m; };
    const entered = parseAmount($('#txAmount').value);
    if (!(entered > 0)) { $('#txAmount').focus(); return err('Geçerli bir tutar gir (örn. 1.250 ya da 1250,50).'); }
    if (!tx.cat) return err('Bir kategori seç.');
    const date = $('#txDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('Bir tarih seç.');
    const cur = $('#txCurrency').value;
    const rate = txRate();
    if (rate == null) return err('Bu para birimi için kur yok. İnternete bağlanıp tekrar dene.');
    const data = { type: tx.type, amount: Math.round(entered * rate), category: tx.cat, date, note: $('#txNote').value.trim() };
    const existing = tx.editingId && state.transactions.find((t) => t.id === tx.editingId);
    const target = existing || { id: uid(), created: Date.now() };
    Object.assign(target, data);
    touch(target);
    if (cur !== base()) Object.assign(target, { origAmount: entered, origCurrency: cur, rate });
    else { delete target.origAmount; delete target.origCurrency; delete target.rate; }
    if (!existing) state.transactions.push(target);
    let tplSaved = false;
    if (!existing && $('#txSaveTpl').checked) {
      state.templates.push(touch({ id: uid(), type: tx.type, amount: entered, currency: cur, category: tx.cat, note: data.note }));
      tplSaved = true;
    }
    save();
    txDlg.close();
    render();
    toast(existing ? 'Kayıt güncellendi'
      : `${tx.type === 'income' ? 'Gelir' : 'Gider'} eklendi: ${fmt(data.amount)}${tplSaved ? ' · şablon kaydedildi' : ''}`);
  });

  $('#txDelete').addEventListener('click', () => { const id = tx.editingId; txDlg.close(); deleteTx(id); });

  function deleteTx(id) {
    const i = state.transactions.findIndex((t) => t.id === id);
    if (i < 0) return;
    const [removed] = state.transactions.splice(i, 1);
    tombstone(id);
    save(); render();
    toast('Kayıt silindi', {
      label: 'Geri al',
      fn: () => { delete state.deleted[id]; state.transactions.push(touch(removed)); save(); render(); },
    });
  }

  // =====================================================================
  //  Düzenli ödeme penceresi
  // =====================================================================
  const recDlg = $('#recDialog');
  const rec = { editingId: null, cat: 'fatura' };

  function openRec(existing) {
    rec.editingId = existing?.id || null;
    rec.cat = existing?.category || 'fatura';
    if (!state.categories.expense.some((c) => c.id === rec.cat)) rec.cat = FALLBACK_CAT.expense;
    $('#recTitle').textContent = existing ? 'Düzenli ödemeyi düzenle' : 'Yeni düzenli ödeme';
    $('#recName').value = existing?.name || '';
    $('#recAmount').value = existing ? toInputAmount(existing.amount) : '';
    $('#recCurrency').value = existing?.currency || base();
    $('#recDay').value = existing?.day || 1;
    $('#recDelete').hidden = !existing;
    $('#recError').textContent = '';
    renderRecCats();
    updateRecConv();
    syncSelects();
    recDlg.showModal();
    $('#recName').focus();
    fetchRates();
  }
  function renderRecCats() {
    $('#recCats').innerHTML = state.categories.expense.map((c) =>
      `<button type="button" class="chip${c.id === rec.cat ? ' active' : ''}" data-cat="${esc(c.id)}">${img(c.icon, '', 22)}${esc(c.name)}</button>`).join('');
  }
  function updateRecConv() {
    const cur = $('#recCurrency').value;
    const line = convLine($('#recAmount').value, cur, rateOf(cur));
    $('#recConv').innerHTML = line ? `${line}${rateOf(cur) != null ? ' · ödediğin günün kuruyla kaydedilir' : ''}` : '';
  }
  $('#recAmount').addEventListener('input', updateRecConv);
  $('#recCurrency').addEventListener('change', () => { updateRecConv(); $('#recAmount').focus(); });
  recDlg.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-cat]');
    if (chip) { rec.cat = chip.dataset.cat; renderRecCats(); }
  });
  $('#recForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = (m) => { $('#recError').textContent = m; };
    const name = $('#recName').value.trim();
    if (!name) { $('#recName').focus(); return err('Bir ad gir.'); }
    const amount = parseAmount($('#recAmount').value);
    if (!(amount > 0)) { $('#recAmount').focus(); return err('Geçerli bir tutar gir.'); }
    const day = parseInt($('#recDay').value, 10);
    if (!(day >= 1 && day <= 31)) return err('Gün 1 ile 31 arasında olmalı.');
    const data = { name, amount, currency: $('#recCurrency').value, day, category: rec.cat };
    const existing = rec.editingId && state.recurring.find((r) => r.id === rec.editingId);
    if (existing) touch(Object.assign(existing, data));
    else state.recurring.push(touch({ id: uid(), ...data }));
    save(); recDlg.close(); render();
    toast(existing ? 'Düzenli ödeme güncellendi' : 'Düzenli ödeme eklendi');
  });
  $('#recDelete').addEventListener('click', () => {
    const r = state.recurring.find((x) => x.id === rec.editingId);
    if (!r || !confirm(`"${r.name}" düzenli ödemesini silmek istiyor musun?\nGeçmişte yaptığın ödeme kayıtları silinmez.`)) return;
    state.recurring = state.recurring.filter((x) => x.id !== r.id);
    tombstone(r.id);
    save(); recDlg.close(); render();
    toast('Düzenli ödeme silindi');
  });

  // =====================================================================
  //  Borç penceresi
  // =====================================================================
  const debtDlg = $('#debtDialog');
  const debtEdit = { id: null, kind: 'debt' };
  $('#debtCurrency').innerHTML = currencyOptions();

  function setDebtKind(kind) {
    debtEdit.kind = kind;
    const recv = kind === 'receivable';
    const existing = debtEdit.id && state.debts.find((x) => x.id === debtEdit.id);
    $$('#debtKind [data-kind]').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
    $('#debtTitle').textContent = existing ? (recv ? 'Alacağı düzenle' : 'Borcu düzenle') : (recv ? 'Yeni alacak' : 'Yeni borç');
    $('#debtNameLabel').textContent = recv ? 'Kimden alacaklısın?' : 'Ad';
    $('#debtName').placeholder = recv ? 'Ahmet, iş arkadaşım, ev sahibi…' : 'Kredi kartı, telefon taksiti, arkadaşa borç…';
    $('#debtLendWrap').hidden = !recv || !!existing;
    $('#debtPlanWrap').hidden = recv;
    if (recv) $('#debtPlanOn').checked = false;
    $('#debtDueLabel').innerHTML = `${recv ? 'Geri ödeme tarihi' : 'Son ödeme tarihi'} <small class="muted">(isteğe bağlı)</small>`;
    syncPlanBox();
  }
  function syncPlanBox() {
    const on = $('#debtPlanOn').checked && debtEdit.kind === 'debt';
    $('#debtPlanBox').hidden = !on;
    $('#debtDueWrap').hidden = on; // taksitli borçta son tarih taksitlerden hesaplanır
    if (on) updatePlanHint();
  }
  function planFromForm(total) {
    const count = parseInt($('#planCount').value, 10);
    const day = parseInt($('#planDay').value, 10);
    const start = $('#planStart').value;
    let amount = parseAmount($('#planAmount').value);
    if (!(count >= 1 && count <= 120)) return { error: 'Taksit sayısı 1 ile 120 arasında olmalı.' };
    if (!(amount > 0)) amount = Math.ceil(total / count);
    if (!(day >= 1 && day <= 31)) return { error: 'Ödeme günü 1 ile 31 arasında olmalı.' };
    if (!/^\d{4}-\d{2}$/.test(start)) return { error: 'İlk taksit ayını seç.' };
    return { plan: { count, amount, day, start } };
  }
  function updatePlanHint() {
    const total = parseAmount($('#debtTotal').value);
    const cur = $('#debtCurrency').value;
    const count = parseInt($('#planCount').value, 10);
    const manual = parseAmount($('#planAmount').value);
    if (!(total > 0) || !(count >= 1)) { $('#planHint').textContent = 'Toplam tutarı ve taksit sayısını gir.'; $('#planAmount').placeholder = 'Otomatik'; return; }
    const auto = Math.ceil(total / count);
    const amount = manual > 0 ? manual : auto;
    const start = $('#planStart').value;
    const last = /^\d{4}-\d{2}$/.test(start) ? monthLabel(addMonths(start, count - 1)) : '';
    $('#planAmount').placeholder = `Otomatik: ${toInputAmount(auto)}`;
    $('#planHint').textContent = `${count} × ${fmt(amount, cur)} = ${fmt(amount * count, cur)}${last ? ` · son taksit ${last}` : ''}`;
  }
  ['#planCount', '#planAmount', '#planStart', '#planDay', '#debtTotal'].forEach((s) =>
    $(s).addEventListener('input', () => { if (!$('#debtPlanBox').hidden) updatePlanHint(); }));
  $('#debtPlanOn').addEventListener('change', () => { syncPlanBox(); if ($('#debtPlanOn').checked) $('#planCount').focus(); });

  function openDebt(d, kind) {
    debtEdit.id = d?.id || null;
    const k = d?.kind || kind || ui.debtKind || 'debt';
    $('#debtName').value = d?.name || '';
    $('#debtTotal').value = d ? toInputAmount(d.total) : '';
    $('#debtCurrency').value = d?.currency || base();
    $('#debtDue').value = d?.due || '';
    $('#debtNote').value = d?.note || '';
    $('#debtLend').checked = true;
    const p = d?.plan;
    $('#debtPlanOn').checked = !!p;
    $('#planCount').value = p ? p.count : '';
    $('#planAmount').value = p ? toInputAmount(p.amount) : '';
    $('#planDay').value = p ? p.day : new Date().getDate();
    $('#planStart').value = p ? p.start : currentMonth();
    $('#debtIcon').setIcon(d?.icon || (k === 'receivable' ? 'banknote' : 'card'));
    $('#debtKind').hidden = !!d; // kaydedilmiş bir kaydın türü değiştirilemez
    $('#debtDelete').hidden = !d;
    $('#debtError').textContent = '';
    setDebtKind(k);
    renderDebtHistory();
    updateDebtConv();
    syncSelects();
    debtDlg.showModal();
    if (!d) $('#debtName').focus();
  }
  function renderDebtHistory() {
    const d = debtEdit.id && state.debts.find((x) => x.id === debtEdit.id);
    const box = $('#debtHistory');
    if (!d) { box.innerHTML = ''; return; }
    const recv = isRecv(d);
    const pays = debtPayments(d), i = debtInfo(d);
    box.innerHTML = `<div class="history"><h3>${recv ? 'Tahsilatlar' : 'Ödemeler'} · ${fmt(i.paid, d.currency)} / ${fmt(d.total, d.currency)}</h3>
      ${pays.length ? pays.map((t) => `<div class="history-row"><span class="d">${dayLabel(t.date)}</span><span class="n">${esc(t.note)}</span>
        <span class="a">${fmt(payInDebtCur(t, d), d.currency)}</span>
        <button type="button" class="del" data-del-pay="${t.id}" aria-label="Kaydı sil" title="Kaydı sil">×</button></div>`).join('')
        : `<p class="muted small" style="margin:8px 0">Henüz ${recv ? 'tahsilat' : 'ödeme'} yok.</p>`}
      ${i.closed ? '' : `<button type="button" class="btn line sm" style="margin-top:10px" data-pay-from-dialog>${recv ? '+ Tahsil et' : '+ Ödeme yap'}</button>`}</div>`;
  }
  const updateDebtConv = () => { const cur = $('#debtCurrency').value; $('#debtConv').innerHTML = convLine($('#debtTotal').value, cur, rateOf(cur)); };
  $('#debtTotal').addEventListener('input', updateDebtConv);
  $('#debtCurrency').addEventListener('change', () => { updateDebtConv(); if (!$('#debtPlanBox').hidden) updatePlanHint(); $('#debtTotal').focus(); });
  debtDlg.addEventListener('click', (e) => {
    const kindBtn = e.target.closest('#debtKind [data-kind]');
    if (kindBtn) {
      setDebtKind(kindBtn.dataset.kind);
      if (!debtEdit.id) $('#debtIcon').setIcon(kindBtn.dataset.kind === 'receivable' ? 'banknote' : 'card');
      return;
    }
    const del = e.target.closest('[data-del-pay]');
    if (del) { deleteTx(del.dataset.delPay); renderDebtHistory(); return; }
    if (e.target.closest('[data-pay-from-dialog]')) {
      const d = state.debts.find((x) => x.id === debtEdit.id);
      debtDlg.close();
      openPay(d);
    }
  });
  $('#debtForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = (m) => { $('#debtError').textContent = m; };
    const recv = debtEdit.kind === 'receivable';
    const name = $('#debtName').value.trim();
    if (!name) { $('#debtName').focus(); return err('Bir ad gir.'); }
    const total = parseAmount($('#debtTotal').value);
    if (!(total > 0)) { $('#debtTotal').focus(); return err('Geçerli bir tutar gir.'); }
    let plan = null;
    if (!recv && $('#debtPlanOn').checked) {
      const r = planFromForm(total);
      if (r.error) return err(r.error);
      plan = r.plan;
    }
    const due = plan ? '' : $('#debtDue').value;
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return err('Geçerli bir tarih seç.');
    const cur = $('#debtCurrency').value;
    const data = { kind: debtEdit.kind, name, total, currency: cur, due, plan, note: $('#debtNote').value.trim(), icon: $('#debtIcon input').value || (recv ? 'banknote' : 'card') };
    const existing = debtEdit.id && state.debts.find((x) => x.id === debtEdit.id);
    if (existing) {
      touch(Object.assign(existing, data));
    } else {
      const d = touch({ id: uid(), created: Date.now(), ...data });
      if (recv && $('#debtLend').checked) {
        // Parayı verdiysen bakiyeden düş (nötr kayıt: gider istatistiğine girmez)
        const rate = rateOf(cur);
        if (rate == null) return err('Bu para birimi için kur yok. İnternete bağlanıp tekrar dene.');
        const t = touch({ id: uid(), type: 'expense', amount: Math.round(total * rate), category: LEND_CAT, date: today(), note: `${name} (borç verildi)`, lendId: d.id, created: Date.now() });
        if (cur !== base()) Object.assign(t, { origAmount: total, origCurrency: cur, rate });
        state.transactions.push(t);
      }
      state.debts.push(d);
    }
    ui.debtKind = debtEdit.kind;
    save(); debtDlg.close(); render();
    toast(existing ? (recv ? 'Alacak güncellendi' : 'Borç güncellendi') : (recv ? 'Alacak eklendi' : plan ? `Taksitli borç eklendi · ${plan.count} × ${fmt(plan.amount, cur)}` : 'Borç eklendi'));
  });
  $('#debtDelete').addEventListener('click', () => {
    const d = state.debts.find((x) => x.id === debtEdit.id);
    if (!d) return;
    const recv = isRecv(d);
    const n = debtPayments(d).length;
    if (!confirm(`"${d.name}" ${recv ? 'alacağı' : 'borcu'} silinsin mi?${n ? `\n\n${n} ${recv ? 'tahsilat' : 'ödeme'} kaydı kayıtlarda kalır.` : ''}`)) return;
    state.debts = state.debts.filter((x) => x.id !== d.id);
    tombstone(d.id);
    save(); debtDlg.close(); render();
    toast(recv ? 'Alacak silindi' : 'Borç silindi');
  });

  // =====================================================================
  //  Ödeme / tahsilat penceresi
  // =====================================================================
  const payDlg = $('#payDialog');
  const pay = { debtId: null };

  /** Borca ödeme ya da alacağa tahsilat kaydeder. Hata metni ya da kayıt döner. */
  function recordDebtMove(d, amount, date, note) {
    const recv = isRecv(d);
    const i = debtInfo(d);
    if (!(amount > 0)) return { error: 'Geçerli bir tutar gir.' };
    if (amount > i.left) return { error: `Kalan ${recv ? 'alacak' : 'borç'} ${fmt(i.left, d.currency)}; daha fazlası girilemez.` };
    const rate = rateOf(d.currency);
    if (rate == null) return { error: 'Bu para birimi için kur yok. İnternete bağlanıp tekrar dene.' };
    const t = touch({
      id: uid(), type: recv ? 'income' : 'expense', amount: Math.round(amount * rate), category: recv ? COLLECT_CAT : DEBT_CAT,
      date, note: note || `${d.name} ${recv ? 'tahsilatı' : 'ödemesi'}`, debtId: d.id, created: Date.now(),
    });
    if (d.currency !== base()) Object.assign(t, { origAmount: amount, origCurrency: d.currency, rate });
    state.transactions.push(t);
    return { t };
  }
  function moveToast(d, amount, t) {
    const recv = isRecv(d);
    const after = debtInfo(d);
    const msg = after.closed ? `${d.name} ${recv ? 'alacağı tamamen tahsil edildi' : 'borcu tamamen kapandı'}`
      : `${recv ? 'Tahsil edildi' : 'Ödendi'}: ${fmt(amount, d.currency)} · kalan ${fmt(after.left, d.currency)}`;
    toast(msg, { label: 'Geri al', fn: () => { state.transactions = state.transactions.filter((x) => x.id !== t.id); tombstone(t.id); save(); render(); } });
  }

  function openPay(d) {
    if (!d) return;
    pay.debtId = d.id;
    const recv = isRecv(d);
    const i = debtInfo(d);
    const half = Math.round(i.left / 2);
    $('#payTitle').textContent = d.name;
    $('#payLeft').innerHTML = `<span class="k">${recv ? 'Kalan alacak' : 'Kalan borç'}</span><span class="v">${fmt(i.left, d.currency)}</span>`;
    $('#payAmountLabel').textContent = recv ? 'Geri aldığın tutar' : 'Ödediğin tutar';
    $('#paySubmit').textContent = recv ? 'Tahsilatı kaydet' : 'Ödemeyi kaydet';
    $('#payInfo').textContent = recv
      ? 'Bu tutar bakiyene eklenir; gelir istatistiklerine sayılmaz.'
      : 'Bu ödeme “Borç ödemesi” gideri olarak da kaydedilir ve bakiyenden düşer.';
    $('#payCur').textContent = `${sym(d.currency)} ${d.currency}`;
    $('#payAmount').value = '';
    $('#payDate').value = today();
    $('#payNote').value = '';
    $('#payError').textContent = '';
    const chips = [];
    if (d.plan && i.plan) {
      const inst = Math.min(d.plan.amount, i.left);
      chips.push(`<button type="button" class="chip" data-quick="${inst}">${i.plan.no}. taksit · ${fmt(inst, d.currency)}</button>`);
    }
    chips.push(`<button type="button" class="chip" data-quick="${i.left}">Kalanın tamamı · ${fmt(i.left, d.currency)}</button>`);
    if (!d.plan && half >= 100 && half < i.left) chips.push(`<button type="button" class="chip" data-quick="${half}">Yarısı · ${fmt(half, d.currency)}</button>`);
    $('#payQuick').innerHTML = chips.join('');
    updatePayConv();
    payDlg.showModal();
    $('#payAmount').focus();
    fetchRates();
  }
  function updatePayConv() {
    const d = state.debts.find((x) => x.id === pay.debtId);
    if (!d) return;
    const i = debtInfo(d);
    const a = parseAmount($('#payAmount').value);
    const parts = [];
    if (d.currency !== base()) parts.push(convLine($('#payAmount').value, d.currency, rateOf(d.currency)));
    if (a > 0 && a <= i.left) parts.push(a === i.left ? `<b>${isRecv(d) ? 'alacak' : 'borç'} kapanacak</b>` : `sonra kalan <b>${fmt(i.left - a, d.currency)}</b>`);
    $('#payConv').innerHTML = parts.filter(Boolean).join(' · ');
  }
  $('#payAmount').addEventListener('input', updatePayConv);
  payDlg.addEventListener('click', (e) => {
    const q = e.target.closest('[data-quick]');
    if (q) { $('#payAmount').value = toInputAmount(Number(q.dataset.quick)); updatePayConv(); $('#payError').textContent = ''; }
  });
  $('#payForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = (m) => { $('#payError').textContent = m; };
    const d = state.debts.find((x) => x.id === pay.debtId);
    if (!d) { payDlg.close(); return; }
    const amount = parseAmount($('#payAmount').value);
    const date = $('#payDate').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('Bir tarih seç.');
    const r = recordDebtMove(d, amount, date, $('#payNote').value.trim());
    if (r.error) { $('#payAmount').focus(); return err(r.error); }
    save(); payDlg.close(); render();
    moveToast(d, amount, r.t);
  });

  /** Taksitli borçta "Taksiti öde": bu ayın taksitini tek dokunuşla öder */
  function payInstallment(d) {
    const i = debtInfo(d);
    if (!d.plan || i.closed) return;
    const amount = Math.min(d.plan.amount, i.left);
    const r = recordDebtMove(d, amount, today(), `${d.name} · ${i.plan.no}/${d.plan.count}. taksit`);
    if (r.error) { toast(r.error); return; }
    save(); render();
    moveToast(d, amount, r.t);
  }

  for (const d of [txDlg, recDlg, debtDlg, payDlg]) {
    d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
    d.addEventListener('close', () => closeSelect());
  }

  // =====================================================================
  //  İkon seçici (kategori ekleme)
  // =====================================================================
  $$('.icon-pick').forEach((pick) => {
    const def = pick.dataset.default || 'package';
    pick.innerHTML = `<button type="button" aria-label="İkon seç" title="İkon seç">${img(def, '', 26)}</button>
      <div class="icon-grid">${ICONS.map((n) => `<button type="button" data-icon="${n}" class="${n === def ? 'active' : ''}">${img(n, '', 30)}</button>`).join('')}</div>
      <input type="hidden" name="icon" value="${def}">`;
    pick.querySelector(':scope > button').addEventListener('click', () => pick.classList.toggle('open'));
    pick.setIcon = (name) => {
      pick.querySelector('input').value = name;
      pick.querySelector(':scope > button').innerHTML = img(name, '', 26);
      $$('.icon-grid [data-icon]', pick).forEach((x) => x.classList.toggle('active', x.dataset.icon === name));
    };
    pick.querySelector('.icon-grid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-icon]');
      if (!b) return;
      pick.setIcon(b.dataset.icon);
      pick.classList.remove('open');
    });
  });

  // =====================================================================
  //  Örnek veri
  // =====================================================================
  async function loadDemo() {
    toast('Örnek veriler hazırlanıyor…');
    await fetchRates();
    const s = defaultState();
    s.settings = { ...state.settings, startBalance: 2000000, monthlyBudget: 0 };
    s.rates = state.rates;
    const cur = currentMonth();
    const rnd = (a, b) => Math.round((a + Math.random() * (b - a)) / 50) * 50 * 100;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const recs = [
      { id: uid(), name: 'Kira', amount: 1500000, currency: 'TRY', category: 'kira', day: 1 },
      { id: uid(), name: 'Sunucu kiralama', amount: 1200, currency: 'USD', category: 'teknoloji', day: 5 },
      { id: uid(), name: 'İnternet', amount: 44900, currency: 'TRY', category: 'fatura', day: 10 },
      { id: uid(), name: 'Yapay zekâ aboneliği', amount: 2000, currency: 'USD', category: 'abonelik', day: 12 },
      { id: uid(), name: 'Elektrik & su', amount: 120000, currency: 'TRY', category: 'fatura', day: 14 },
      { id: uid(), name: 'Telefon hattı', amount: 35000, currency: 'TRY', category: 'fatura', day: 18 },
    ];
    const jobs = ['Logo tasarımı', 'Web sitesi projesi', 'Script satışı', 'Danışmanlık', 'Mobil uygulama', 'Bakım ücreti', 'Mod siparişi'];
    const list = [];
    let created = 1;
    const add = (type, category, amount, date, note, extra = {}) => list.push({ id: uid(), type, category, amount, date, note, created: created++, ...extra });
    const usd = s.rates && s.rates.base === s.settings.currency && s.rates.rates.USD ? 1 / s.rates.rates.USD : null;

    for (let i = 5; i >= 0; i--) {
      const key = addMonths(cur, -i);
      const last = i === 0 ? new Date().getDate() : daysInMonth(key);
      const day = () => `${key}-${pad(1 + Math.floor(Math.random() * last))}`;
      const incomeCount = i === 0 ? 1 : 1 + Math.floor(Math.random() * 3);
      for (let j = 0; j < incomeCount; j++) add('income', pick(['proje', 'proje', 'satis']), rnd(7000, 30000), day(), pick(jobs));
      for (const r of recs) {
        if (r.day > last) continue;
        const date = `${key}-${pad(r.day)}`;
        if (r.currency === s.settings.currency) add('expense', r.category, r.amount, date, r.name, { recurringId: r.id });
        else if (usd) {
          const rate = usd * (1 - i * 0.012); // geçmiş aylarda kur biraz daha düşüktü
          add('expense', r.category, Math.round(r.amount * rate), date, r.name, { recurringId: r.id, origAmount: r.amount, origCurrency: r.currency, rate: Math.round(rate * 10000) / 10000 });
        }
      }
      const n = (x) => Math.max(1, Math.round((x * last) / 30));
      for (let j = 0; j < n(4); j++) add('expense', 'market', rnd(700, 2200), day(), pick(['Haftalık market', 'Market', 'Manav']));
      for (let j = 0; j < n(7); j++) add('expense', 'yemek', rnd(150, 700), day(), pick(['Kahve', 'Öğle yemeği', 'Akşam yemeği', 'Sipariş']));
      for (let j = 0; j < n(3); j++) add('expense', 'ulasim', rnd(200, 700), day(), pick(['Toplu taşıma', 'Taksi', 'Benzin']));
      if (Math.random() < 0.6) add('expense', pick(['eglence', 'giyim', 'teknoloji', 'saglik']), rnd(400, 3500), day(), '');
    }
    const card = { id: uid(), name: 'Kredi kartı borcu', icon: 'card', total: 1850000, currency: 'TRY', due: toISO(new Date(Date.now() + 6 * 864e5)), note: 'Ekim ekstresi', created: 1 };
    const laptop = { id: uid(), name: 'Laptop taksiti', icon: 'laptop', total: 60000, currency: 'USD', due: '', note: 'Kalan taksitler', created: 2 };
    add('expense', DEBT_CAT, 500000, `${cur}-01`, 'Kredi kartı borcu ödemesi', { debtId: card.id });
    if (usd) add('expense', DEBT_CAT, Math.round(20000 * usd), `${addMonths(cur, -1)}-15`, 'Laptop taksiti ödemesi', { debtId: laptop.id, origAmount: 20000, origCurrency: 'USD', rate: usd });
    s.debts = [card, laptop];
    s.transactions = list;
    s.recurring = recs;
    replaceState(s);
    save(); render();
    toast('Örnek veriler yüklendi. Silmek için: Ayarlar → Tüm verileri sil');
  }

  // =====================================================================
  //  Eylemler
  // =====================================================================
  const actions = {
    'add-tx': (el) => openTx(null, { type: el.dataset.type }),
    'edit-tx': (el) => { const t = state.transactions.find((x) => x.id === el.dataset.id); if (t) openTx(t); },
    'add-rec': () => openRec(null),
    'add-debt': (el) => openDebt(null, el.dataset.kind),
    'pay-installment': (el) => { const d = state.debts.find((x) => x.id === el.dataset.id); if (d) payInstallment(d); },
    'use-template': (el) => { const t = state.templates.find((x) => x.id === el.dataset.id); if (t) useTemplate(t); },
    'del-template': (el) => {
      const t = state.templates.find((x) => x.id === el.dataset.id);
      if (!t) return;
      state.templates = state.templates.filter((x) => x.id !== t.id);
      tombstone(t.id);
      save(); render();
      toast('Şablon silindi', { label: 'Geri al', fn: () => { delete state.deleted[t.id]; state.templates.push(touch(t)); save(); render(); } });
    },
    'edit-debt': (el) => openDebt(state.debts.find((x) => x.id === el.dataset.id)),
    'pay-debt': (el) => openPay(state.debts.find((x) => x.id === el.dataset.id)),
    'edit-rec': (el) => { const r = state.recurring.find((x) => x.id === el.dataset.id); if (r) openRec(r); },
    'pay-rec': (el) => {
      const r = state.recurring.find((x) => x.id === el.dataset.id);
      if (!r) return;
      const rate = rateOf(r.currency);
      if (rate == null) { toast(`${r.currency} kuru alınamadı. İnternete bağlanıp tekrar dene.`); fetchRates(true); return; }
      const key = ui.month;
      const date = key === currentMonth() ? today() : `${key}-${pad(Math.min(r.day, daysInMonth(key)))}`;
      const t = touch({ id: uid(), type: 'expense', amount: Math.round(r.amount * rate), category: r.category, date, note: r.name, recurringId: r.id, created: Date.now() });
      if (r.currency !== base()) Object.assign(t, { origAmount: r.amount, origCurrency: r.currency, rate });
      state.transactions.push(t);
      save(); render();
      toast(r.currency !== base() ? `Ödendi: ${r.name} · ${fmt(r.amount, r.currency)} → ${fmt(t.amount)}` : `Ödendi: ${r.name} · ${fmt(t.amount)}`);
    },
    'unpay-rec': (el) => {
      const t = state.transactions.find((x) => x.recurringId === el.dataset.id && x.date.startsWith(ui.month));
      if (t) deleteTx(t.id);
    },
    'set-budget': () => { setTab('settings'); setTimeout(() => $('#sBudget').focus(), 50); },
    'apply-suggest': (el) => {
      state.settings.monthlyBudget = Number(el.dataset.v);
      touchSettings(); save(); render();
      toast(`Aylık bütçe ${fmt(state.settings.monthlyBudget)} olarak ayarlandı`);
    },
    'goto-month': (el) => { ui.month = el.dataset.month; render(); },
    'filter-cat': (el) => { Object.assign(ui, { txType: 'expense', txCat: el.dataset.id, txQuery: '', txAllMonths: false }); setTab('transactions'); },
    'see-all': () => { Object.assign(ui, { txType: 'all', txCat: 'all', txQuery: '' }); setTab('transactions'); },
    'load-demo': () => loadDemo(),
    'goto-account': () => { setTab('settings'); setTimeout(() => $('#accountBox')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); },
    'sync-now': () => syncNow(),
    'sign-out': () => signOut(),
    'change-pass': () => openPassForm(),
    'push-on': () => enablePush(),
    'push-off': () => disablePush(),
    'push-test': () => testPush(),
    'lock-enable': async () => {
      try {
        if (await window.MFLock.enable()) { renderLockBox(); toast('Uygulama kilidi açıldı'); }
      } catch { toast('Kilit bu adreste kullanılamıyor (https gerekli)'); }
    },
    'lock-change': async () => { if (await window.MFLock.change()) toast('PIN değiştirildi'); renderLockBox(); },
    'lock-disable': async () => {
      if (await window.MFLock.disable()) { $('#lockExtra')?.remove(); toast('Uygulama kilidi kapatıldı'); }
      renderLockBox();
    },
    'lock-now': () => window.MFLock.lockNow(),
    'refresh-rates': () => fetchRates(true),
    'export-json': () => {
      state.settings.lastBackup = new Date().toISOString();
      touchSettings(); save();
      download(`mfinance-yedek-${today()}.json`, JSON.stringify(state, null, 2), 'application/json');
      render();
      toast('Yedek indirildi');
    },
    'import-json': () => $('#importFile').click(),
    'export-csv': () => {
      const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const num = (m) => (m / 100).toFixed(2).replace('.', ',');
      const rows = [...state.transactions].sort((a, b) => (a.date < b.date ? -1 : 1)).map((t) => {
        const sign = t.type === 'income' ? 1 : -1;
        return [t.date, t.type === 'income' ? 'Gelir' : 'Gider', category(t.type, t.category).name, num(sign * t.amount), t.note,
          t.origCurrency ? num(sign * t.origAmount) : '', t.origCurrency || '', t.rate ? String(t.rate).replace('.', ',') : ''].map(q).join(';');
      });
      download(`mfinance-kayitlar-${today()}.csv`,
        '﻿' + [`Tarih;Tür;Kategori;Tutar (${base()});Not;Döviz tutarı;Döviz;Kur`, ...rows].join('\r\n'), 'text/csv;charset=utf-8');
    },
    'wipe': () => {
      if (!confirm('Tüm kayıtlar, düzenli ödemeler ve ayarlar silinecek. Bu geri alınamaz.\n\nÖnce yedek almadıysan "İptal"e bas.')) return;
      const next = defaultState();
      next.settings.theme = state.settings.theme;
      replaceState(next); // diğer cihazlarda da silinsin
      save(); setTab('dashboard');
      toast('Tüm veriler silindi');
    },
    'del-cat': (el) => {
      const { type, id } = el.dataset;
      const c = category(type, id);
      const used = state.transactions.filter((t) => t.type === type && t.category === id).length +
        (type === 'expense' ? state.recurring.filter((r) => r.category === id).length : 0);
      if (used && !confirm(`"${c.name}" kategorisinde ${used} kayıt var. Bunlar "Diğer" kategorisine taşınacak. Devam edilsin mi?`)) return;
      const fb = FALLBACK_CAT[type];
      state.transactions.forEach((t) => { if (t.type === type && t.category === id) touch(Object.assign(t, { category: fb })); });
      if (type === 'expense') state.recurring.forEach((r) => { if (r.category === id) touch(Object.assign(r, { category: fb })); });
      state.categories[type] = state.categories[type].filter((x) => x.id !== id);
      tombstone(id);
      save(); render();
      toast('Kategori silindi');
    },
  };

  document.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('[data-close]');
    if (closeBtn) { closeBtn.closest('dialog').close(); return; }
    const tabBtn = e.target.closest('button[data-tab]');
    if (tabBtn) { setTab(tabBtn.dataset.tab); return; }
    const ftype = e.target.closest('[data-ftype]');
    if (ftype) { ui.txType = ftype.dataset.ftype; render(); return; }
    const dtab = e.target.closest('[data-debt-tab]');
    if (dtab) { ui.debtKind = dtab.dataset.debtTab; render(); return; }
    const a = e.target.closest('[data-action]');
    if (a && actions[a.dataset.action] && !a.disabled) actions[a.dataset.action](a, e);
  });

  $('#prevMonth').addEventListener('click', () => { ui.month = addMonths(ui.month, -1); render(); });
  $('#nextMonth').addEventListener('click', () => { ui.month = addMonths(ui.month, 1); render(); });
  $('#monthLabel').addEventListener('click', () => { ui.month = currentMonth(); render(); });

  $('#fCat').addEventListener('change', (e) => { ui.txCat = e.target.value; render(); });
  $('#fQ').addEventListener('input', (e) => { ui.txQuery = e.target.value; render(); });
  $('#fAll').addEventListener('change', (e) => { ui.txAllMonths = e.target.checked; render(); });

  function moneySetting(id, key, label) {
    $(id).addEventListener('change', (e) => {
      const v = parseAmount(e.target.value, { allowZero: true });
      if (Number.isNaN(v)) { toast(`${label}: geçerli bir tutar gir`); e.target.value = toInputAmount(state.settings[key]); return; }
      state.settings[key] = v;
      touchSettings(); save(); render();
      toast(`${label} kaydedildi`);
    });
  }
  moneySetting('#sStart', 'startBalance', 'Başlangıç bakiyesi');
  moneySetting('#sBudget', 'monthlyBudget', 'Aylık bütçe');
  $('#sEmergency').addEventListener('change', (e) => {
    state.settings.emergencyMonths = Math.min(24, Math.max(1, parseInt(e.target.value, 10) || 3));
    touchSettings(); save(); render();
  });
  $('#sCurrency').addEventListener('change', (e) => {
    state.settings.currency = e.target.value;
    touchSettings(); save(); render();
    fetchRates(true);
  });
  $('#sTheme').addEventListener('change', (e) => { state.settings.theme = e.target.value; touchSettings(); save(); applyTheme(); });

  $$('.cat-add').forEach((form) => form.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = form.dataset.type;
    const name = form.elements.name.value.trim();
    if (!name) { form.elements.name.focus(); return; }
    if (state.categories[type].some((c) => c.name.toLocaleLowerCase('tr-TR') === name.toLocaleLowerCase('tr-TR'))) {
      toast('Bu isimde bir kategori zaten var'); return;
    }
    const icon = form.elements.icon.value || 'package';
    const list = state.categories[type];
    const fbIndex = list.findIndex((c) => c.id === FALLBACK_CAT[type]); // "Diğer" en sonda kalsın
    list.splice(fbIndex < 0 ? list.length : fbIndex, 0, touch({ id: uid(), name, icon }));
    form.elements.name.value = '';
    save(); render();
    toast('Kategori eklendi');
  }));

  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.transactions)) throw new Error('format');
      if (!confirm(`Yedekte ${data.transactions.length} kayıt var.\nŞu anki verilerin bu yedekle DEĞİŞTİRİLECEK. Devam edilsin mi?`)) return;
      replaceState(normalize(data));
      save(); applyTheme(); render();
      fetchRates();
      toast('Yedek geri yüklendi');
    } catch (err) {
      console.error(err);
      toast('Bu dosya geçerli bir mFinance yedeği değil');
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.id !== 'welcomeStart') return;
    const v = parseAmount(e.target.value, { allowZero: true });
    if (Number.isNaN(v)) { toast('Geçerli bir tutar gir'); return; }
    state.settings.startBalance = v;
    touchSettings(); save();
    toast(`Başlangıç bakiyesi: ${fmt(v)}`);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/is-locked|needs-auth|booting/.test(document.documentElement.className) || document.querySelector('dialog[open]') || openSelect || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    e.preventDefault();
    openTx(null);
  });

  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY) { state = load(); applyTheme(); render(); } });
  window.addEventListener('hashchange', () => setTab(location.hash.slice(1)));
  window.addEventListener('focus', () => fetchRates());
  window.addEventListener('online', () => fetchRates());
  setInterval(() => fetchRates(), 10 * 60 * 1000);

  // Açılır menüleri özelleştir
  enhanceSelect($('#fCat'));
  enhanceSelect($('#sCurrency'));
  enhanceSelect($('#sTheme'));
  enhanceSelect($('#txCurrency'), 'bare');
  enhanceSelect($('#recCurrency'), 'bare');
  enhanceSelect($('#debtCurrency'), 'bare');
  enhanceSelect($('#sLockDelay'));
  $('#sLockDelay').addEventListener('change', (e) => { window.MFLock?.setDelay(Number(e.target.value)); toast('Otomatik kilit ayarlandı'); });

  // Senkron tetikleyicileri: uygulamaya dönünce, internet gelince ve dakikada bir
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') scheduleSync(100); });
  window.addEventListener('online', () => scheduleSync(100));
  window.addEventListener('offline', () => { if (sync.session) setSyncStatus('offline'); });
  setInterval(() => scheduleSync(0), 60 * 1000);

  // Çevrimdışı çalışma ve "Ana Ekrana Ekle" için service worker
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[mFinance] SW', e)));
  }

  // =====================================================================
  //  Açılış: önce hesap, sonra PIN, sonra uygulama
  // =====================================================================
  async function boot() {
    applyTheme();
    render();
    fetchRates();
    let signedIn = true;
    if (syncConfigured()) {
      initClient();
      try { sync.session = (await sync.client.auth.getSession()).data.session; } catch (e) { console.warn('[mFinance] Oturum', e); }
      if (sync.session) onSignedIn();
      else { signedIn = false; showAuth(); }
    } else {
      setSyncStatus('off');
    }
    renderAccount();
    booted = true;
    document.documentElement.classList.remove('booting');
    window.MFLock.init({
      skipInitial: !signedIn, // giriş ekranındayken PIN sorma
      onForgot: forgotPin,
      onUnlock: () => {
        // Ana ekran kısayolu: "Yeni kayıt"
        if (location.hash === '#new') { history.replaceState(null, '', '#dashboard'); openTx(null); }
      },
    });
  }
  boot().catch((e) => { console.error('[mFinance] Açılış hatası', e); document.documentElement.classList.remove('booting'); });
})();
