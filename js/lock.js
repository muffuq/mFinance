'use strict';
/* mFinance — uygulama kilidi
 * - PIN, PBKDF2-SHA256 ile tuzlanıp hash'lenerek yalnızca bu cihazda saklanır (senkronlanmaz).
 * - Face ID / Touch ID / Windows Hello: WebAuthn platform doğrulayıcısı ile "kullanıcı doğrulaması".
 * - Arka plana geçince (ayara göre hemen ya da birkaç dakika sonra) yeniden kilitlenir.
 * - Hatalı denemelerde artan bekleme süresi.
 * Not: Bu bir gizlilik kilididir; telefonunu eline alan birinin verilerini görmesini engeller.
 */
(function () {
  const KEY = 'mfinance:lock';
  const ITER = 150000;
  const enc = new TextEncoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const rand = (n) => crypto.getRandomValues(new Uint8Array(n));

  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
  const write = (v) => { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); };

  const supported = () => !!(window.isSecureContext && crypto?.subtle);

  async function hashPin(pin, saltB64) {
    const keyMat = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(saltB64), iterations: ITER }, keyMat, 256);
    return b64(bits);
  }
  function timingSafeEqual(a, b) {
    if (a.length !== b.length) return false;
    let r = 0;
    for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
  }

  // ---------------- Biyometri (WebAuthn) ----------------
  async function bioAvailable() {
    try {
      return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
    } catch { return false; }
  }
  async function bioEnroll() {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: rand(32),
        rp: { name: 'mFinance', id: location.hostname },
        user: { id: rand(16), name: 'mfinance', displayName: 'mFinance' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
        timeout: 60000,
      },
    });
    if (!cred) throw new Error('İptal edildi');
    return b64(cred.rawId);
  }
  async function bioVerify(credId) {
    const res = await navigator.credentials.get({
      publicKey: {
        challenge: rand(32),
        allowCredentials: [{ type: 'public-key', id: unb64(credId), transports: ['internal'] }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return !!res;
  }
  const bioName = () => (/iPhone|iPad|Mac/.test(navigator.userAgent) ? (/(iPhone|iPad)/.test(navigator.userAgent) ? 'Face ID' : 'Touch ID') : 'Windows Hello');

  // ---------------- Arayüz ----------------
  const root = document.createElement('div');
  root.id = 'lock';
  root.className = 'lock';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `
    <div class="lock-inner">
      <img class="lock-logo" src="assets/logo.svg" alt="" width="56" height="56">
      <h2 class="lock-title"></h2>
      <p class="lock-sub"></p>
      <div class="pin-dots" aria-hidden="true"></div>
      <p class="lock-err" role="alert"></p>
      <div class="keypad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" data-k="${n}">${n}</button>`).join('')}
        <button type="button" data-k="bio" class="k-bio" aria-label="Biyometrik ile aç">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 9v1.5M15 9v1.5M12 9v4.5h-1M9.5 16.2c1.5 1 3.5 1 5 0"/></svg>
        </button>
        <button type="button" data-k="0">0</button>
        <button type="button" data-k="del" aria-label="Sil">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 5H9l-6 7 6 7h12zM16 9.5l-5 5M11 9.5l5 5"/></svg>
        </button>
      </div>
      <div class="lock-foot">
        <button type="button" class="link" data-k="alt"></button>
        <button type="button" class="link" data-k="cancel">Vazgeç</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const $ = (s) => root.querySelector(s);
  let mode = null; // { kind: 'unlock' | 'prompt', length, resolve, ... }
  let entry = '';
  let busy = false;

  function paintDots() {
    const len = mode?.length || 4;
    $('.pin-dots').innerHTML = Array.from({ length: len }, (_, i) => `<i class="${i < entry.length ? 'on' : ''}"></i>`).join('');
  }
  function setError(msg) {
    $('.lock-err').textContent = msg || '';
    if (msg) { root.classList.remove('shake'); void root.offsetWidth; root.classList.add('shake'); }
  }
  function open() {
    root.hidden = false;
    document.documentElement.classList.add('is-locked');
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    (document.activeElement || {}).blur?.();
  }
  function close() {
    root.hidden = true;
    document.documentElement.classList.remove('is-locked');
    mode = null; entry = '';
  }

  // Hatalı deneme sınırı
  function lockoutLeft() {
    const s = read();
    return s?.until && s.until > Date.now() ? Math.ceil((s.until - Date.now()) / 1000) : 0;
  }
  function registerFail() {
    const s = read(); if (!s) return;
    s.fails = (s.fails || 0) + 1;
    if (s.fails >= 5) s.until = Date.now() + Math.min(300, 30 * 2 ** (s.fails - 5)) * 1000;
    write(s);
  }
  function resetFails() { const s = read(); if (s) { s.fails = 0; s.until = 0; write(s); } }

  async function press(k) {
    if (!mode || busy) return;
    if (k === 'cancel') { const r = mode.resolve; close(); r?.(null); return; }
    if (k === 'alt') { mode.onAlt?.(); return; }
    if (k === 'bio') { tryBio(true); return; }
    if (k === 'del') { entry = entry.slice(0, -1); paintDots(); return; }
    if (!/^\d$/.test(k) || entry.length >= mode.length) return;
    const wait = mode.kind === 'unlock' ? lockoutLeft() : 0;
    if (wait) { setError(`Çok fazla hatalı deneme. ${wait} sn bekle.`); return; }
    entry += k; setError(''); paintDots();
    if (entry.length === mode.length) {
      busy = true;
      await new Promise((r) => setTimeout(r, 90)); // son nokta görünsün
      try { await mode.submit(entry); } finally { busy = false; }
    }
  }
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) press(b.dataset.k); });
  document.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('del'); }
    else if (e.key === 'Escape' && mode?.kind === 'prompt') press('cancel');
  }, true);

  async function tryBio(userInitiated) {
    const s = read();
    if (!s?.bio || !mode || mode.kind !== 'unlock') return;
    try {
      if (await bioVerify(s.bio)) { resetFails(); const done = mode.onUnlock; close(); done?.(); }
    } catch (e) {
      if (userInitiated) setError(`${bioName()} doğrulanamadı. PIN'ini gir.`);
    }
  }

  function showUnlock(onUnlock, onForgot) {
    const s = read();
    mode = {
      kind: 'unlock', length: s.length || 4, onUnlock,
      onAlt: onForgot,
      submit: async (pin) => {
        const ok = timingSafeEqual(await hashPin(pin, s.salt), s.hash);
        if (ok) { resetFails(); close(); onUnlock?.(); return; }
        registerFail();
        entry = ''; paintDots();
        const wait = lockoutLeft();
        setError(wait ? `Çok fazla hatalı deneme. ${wait} sn bekle.` : 'PIN yanlış.');
      },
    };
    entry = '';
    $('.lock-title').textContent = 'mFinance kilitli';
    $('.lock-sub').textContent = s.bio ? `PIN'ini gir ya da ${bioName()} kullan` : "Devam etmek için PIN'ini gir";
    $('[data-k="alt"]').textContent = "PIN'i unuttum";
    $('[data-k="alt"]').hidden = !onForgot;
    $('[data-k="cancel"]').hidden = true;
    $('.k-bio').style.visibility = s.bio ? 'visible' : 'hidden';
    setError(''); paintDots(); open();
    if (s.bio) setTimeout(() => tryBio(false), 250);
  }

  /** PIN giriş ekranını "soru" olarak açar; girilen PIN'i ya da vazgeçilirse null döndürür. */
  function promptPin({ title, sub, length = 4, allowLengthSwitch = false }) {
    return new Promise((resolve) => {
      mode = { kind: 'prompt', length, resolve, submit: async (pin) => { close(); resolve(pin); } };
      if (allowLengthSwitch) {
        mode.onAlt = () => {
          mode.length = mode.length === 4 ? 6 : 4; entry = ''; paintDots();
          $('[data-k="alt"]').textContent = mode.length === 4 ? '6 haneli PIN kullan' : '4 haneli PIN kullan';
        };
      }
      entry = '';
      $('.lock-title').textContent = title;
      $('.lock-sub').textContent = sub || '';
      $('[data-k="alt"]').hidden = !allowLengthSwitch;
      $('[data-k="alt"]').textContent = '6 haneli PIN kullan';
      $('[data-k="cancel"]').hidden = false;
      $('.k-bio').style.visibility = 'hidden';
      setError(''); paintDots(); open();
    });
  }

  async function verifyCurrent(title) {
    const s = read();
    if (!s) return true;
    for (;;) {
      if (lockoutLeft()) { alert(`Çok fazla hatalı deneme. ${lockoutLeft()} sn sonra tekrar dene.`); return false; }
      const pin = await promptPin({ title, sub: 'Mevcut PIN', length: s.length || 4 });
      if (pin == null) return false;
      if (timingSafeEqual(await hashPin(pin, s.salt), s.hash)) { resetFails(); return true; }
      registerFail();
    }
  }

  async function chooseNewPin() {
    let length = 4;
    for (;;) {
      const first = await promptPin({ title: 'Yeni PIN', sub: 'Uygulamayı açarken soracağım', length, allowLengthSwitch: true });
      if (first == null) return null;
      length = first.length;
      const second = await promptPin({ title: 'PIN tekrar', sub: 'Aynı PIN\'i bir daha gir', length });
      if (second == null) return null;
      if (first === second) return first;
      alert('PIN\'ler eşleşmedi, baştan dene.');
    }
  }

  // ---------------- Otomatik kilit ----------------
  let hiddenAt = 0;
  let paused = false;
  let onUnlockCb = null, onForgotCb = null;
  document.addEventListener('visibilitychange', () => {
    const s = read();
    if (!s) return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      // "Hemen" ise uygulama değiştiricideki önizleme de kilit ekranını göstersin
      if (!(s.delay > 0) && !paused) api.lockNow();
    } else if (hiddenAt && Date.now() - hiddenAt >= (s.delay || 0) * 1000) {
      api.lockNow();
    }
  });

  const api = {
    supported,
    isEnabled: () => !!read(),
    settings: () => { const s = read(); return s ? { length: s.length, bio: !!s.bio, delay: s.delay || 0 } : null; },
    bioAvailable,
    bioName,

    /** Uygulama açılışında çağrılır. Kilit varsa ekranı gösterir. */
    init({ onUnlock, onForgot, skipInitial = false } = {}) {
      onUnlockCb = onUnlock; onForgotCb = onForgot;
      paused = skipInitial;
      if (read() && !skipInitial) showUnlock(onUnlockCb, onForgotCb);
      else { document.documentElement.classList.remove('is-locked'); if (!skipInitial) onUnlock?.(); }
    },
    /** Giriş ekranı açıkken otomatik kilidi durdur / girişten sonra devam ettir */
    pause(v) { paused = v; },
    lockNow() {
      if (paused || !read() || (mode && mode.kind === 'unlock')) return;
      if (mode) { const r = mode.resolve; mode = null; r?.(null); }
      showUnlock(onUnlockCb, onForgotCb);
    },
    async enable() {
      if (!supported()) throw new Error('insecure');
      const pin = await chooseNewPin();
      if (!pin) return false;
      const salt = b64(rand(16));
      write({ salt, hash: await hashPin(pin, salt), length: pin.length, delay: 0, fails: 0 });
      return true;
    },
    async change() {
      if (!(await verifyCurrent("PIN'i değiştir"))) return false;
      const pin = await chooseNewPin();
      if (!pin) return false;
      const s = read();
      s.salt = b64(rand(16)); s.hash = await hashPin(pin, s.salt); s.length = pin.length;
      write(s);
      return true;
    },
    async disable() {
      if (!(await verifyCurrent('Kilidi kapat'))) return false;
      write(null);
      return true;
    },
    async enableBio() {
      const id = await bioEnroll();
      const s = read(); s.bio = id; write(s);
    },
    disableBio() { const s = read(); if (s) { delete s.bio; write(s); } },
    setDelay(sec) { const s = read(); if (s) { s.delay = sec; write(s); } },
    /** "PIN'i unuttum" sonrası: kilidi tamamen kaldırır (çağıran taraf verileri temizler). */
    reset() { write(null); close(); },
  };
  window.MFLock = api;
})();
