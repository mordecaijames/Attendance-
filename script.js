'use strict';

/* =====================================================================
   SETTINGS  (change these)
   ===================================================================== */
const CONFIG = {
  // Paste your Google Apps Script web app link (the one ending in /exec).
  // Leave it empty to run in DEMO mode (nothing is saved) for previewing.
  API_URL: 'https://script.google.com/macros/s/AKfycbxn7xq0JnGZqH7XKUgW-rNzzBiaOo34cYHQkAcs8dhhC410P9hskSEsGtS-6L1iMBJX5A/exec',

  CHURCH_NAME: 'Templebreed International',
  TAGLINE: '',               // optional extra line under the logo (the logo already has the motto, so keep empty)
  LOGO: 'logo.png',   // replace the file in the images folder, or change this path
  REQUIRE_EMAIL: false,      // true = email becomes compulsory
  SITE_URL: '',              // optional: the public link of this website (used for the QR code)
  HOME_URL: '',              // optional: your church website. If set, "Back to home" goes there.
  SPLASH_MS: 2500,           // how long the welcome page shows (tap it to skip)
  POLL_MS: 15000,            // how often the big screen refreshes the count
};

/* =====================================================================
   HELPERS
   ===================================================================== */
const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

const params = new URLSearchParams(location.search);
const MODE = params.get('view') === 'display' ? 'display' : 'attend';
const DEMO = !CONFIG.API_URL;
const SITE_URL = CONFIG.SITE_URL || location.href.split('?')[0].split('#')[0];

const VIEWS = ['loadingView', 'errorView', 'formView', 'closedView', 'thanksView'];
function setView(name) {
  VIEWS.forEach(hide);
  show(name);
  window.scrollTo(0, 0);
}

/* =====================================================================
   API  (talks to Google Apps Script, or the built-in demo)
   ===================================================================== */
async function request(url, options) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, Object.assign({ signal: ctrl.signal }, options || {}));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function liveApi() {
  const base = CONFIG.API_URL;
  const sep = base.indexOf('?') === -1 ? '?' : '&';
  return {
    status: () => request(base + sep + 'action=status&t=' + Date.now()),
    mark: (payload) => request(base, {
      method: 'POST',
      // text/plain avoids a CORS preflight, which Apps Script cannot answer
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: 'mark' }, payload)),
    }),
  };
}

/* Demo backend: lets you preview every screen in VS Code with no setup.
   Add ?closed=1 to the address to preview the "closed" screen. */
function demoApi() {
  const rows = [];
  const forceClosed = params.get('closed') === '1';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmt = (d, o) => d.toLocaleDateString('en-GB', o).replace(/^(\w+) /, '$1, ');
  const long = { weekday: 'long', day: 'numeric', month: 'long' };

  function info() {
    const s = new Date();
    s.setDate(s.getDate() + ((7 - s.getDay()) % 7));
    const n = new Date(s);
    n.setDate(n.getDate() + 7);
    return {
      label: fmt(s, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
      nextLabel: fmt(n, long),
      closedMsg: 'Attendance is only open on Sundays, from 3:00 AM to 9:00 PM. It opens next on ' +
        fmt(s, long) + ' at 3:00 AM.',
    };
  }

  return {
    async status() {
      await wait(300);
      const i = info();
      return { open: !forceClosed, label: i.label, count: rows.length, closedMsg: i.closedMsg };
    },
    async mark(p) {
      await wait(600);
      const i = info();
      if (forceClosed) return { ok: false, closed: true, error: i.closedMsg };
      const name = String(p.name || '').trim().replace(/\s+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      const phone = String(p.phone || '').replace(/\D/g, '');
      const email = String(p.email || '').trim().toLowerCase();
      const dup = rows.find((r) => r.phone === phone || (email && r.email === email));
      if (dup) return { ok: true, already: true, name: dup.name, label: i.label, nextLabel: i.nextLabel, today: true };
      rows.push({ name, phone, email });
      return { ok: true, already: false, name, label: i.label, nextLabel: i.nextLabel, today: true };
    },
  };
}

const api = DEMO ? demoApi() : liveApi();

/* =====================================================================
   PAGE SETUP
   ===================================================================== */
$('church').textContent = CONFIG.CHURCH_NAME;
$('tagline').textContent = CONFIG.TAGLINE;
document.title = CONFIG.CHURCH_NAME + ' | Sunday Attendance';
$('logo').alt = CONFIG.CHURCH_NAME + ' logo';
document.querySelectorAll('img.logo').forEach((img) => {
  img.addEventListener('error', () => {
    // If the logo file is missing, hide its box and show the church name as text instead.
    img.closest('.logo-tile').classList.add('hidden');
    $('church').classList.remove('sr-only');
  });
  img.src = CONFIG.LOGO;
});

/* Welcome / preload page */
const splashStart = Date.now();
function closeSplash() {
  const el = $('splash');
  if (el.dataset.closed) return;
  el.dataset.closed = '1';
  el.classList.add('leaving');
  setTimeout(() => el.classList.add('hidden'), 500);
}
window.addEventListener('load', () => {
  setTimeout(closeSplash, Math.max(0, CONFIG.SPLASH_MS - (Date.now() - splashStart)));
});
setTimeout(closeSplash, CONFIG.SPLASH_MS + 6000); // safety: never get stuck
$('splash').addEventListener('click', closeSplash);
function openSplash() {
  const el = $('splash');
  delete el.dataset.closed;
  el.classList.remove('hidden', 'leaving');
  setTimeout(closeSplash, CONFIG.SPLASH_MS);
}

if (MODE === 'display') {
  startDisplay();
} else {
  startAttend();
}

/* =====================================================================
   ATTENDANCE PAGE
   ===================================================================== */
function startAttend() {
  show('attend');
  if (CONFIG.REQUIRE_EMAIL) hide('optional');

  $('form').addEventListener('submit', onSubmit);
  $('retry').addEventListener('click', loadStatus);
  $('home').addEventListener('click', goHome);
  ['name', 'phone', 'email'].forEach((id) =>
    $(id).addEventListener('input', () => { $(id).classList.remove('invalid'); $('error').textContent = ''; })
  );

  loadStatus();
}

function goHome() {
  if (CONFIG.HOME_URL) { location.href = CONFIG.HOME_URL; return; }
  // Back to the welcome page with a clean form (nothing left on screen for the next person).
  $('form').reset();
  $('error').textContent = '';
  ['name', 'phone', 'email'].forEach((id) => $(id).classList.remove('invalid'));
  openSplash();
  loadStatus();
}

async function loadStatus() {
  setView('loadingView');
  try {
    const s = await api.status();
    if (!s.open) return showClosed(s.closedMsg);
    $('date').textContent = s.label;
    setView('formView');
  } catch (err) {
    setView('errorView');
  }
}

function showClosed(msg) {
  $('closedMsg').textContent = msg;
  setView('closedView');
}

function fail(msg, fieldId) {
  $('error').textContent = msg;
  if (fieldId) { $(fieldId).classList.add('invalid'); $(fieldId).focus(); }
}

async function onSubmit(e) {
  e.preventDefault();
  const name = $('name').value.trim();
  const phone = $('phone').value.trim();
  const email = $('email').value.trim();
  const btn = $('go');

  $('error').textContent = '';
  if (name.length < 2) return fail('Please enter your name.', 'name');
  if (phone.replace(/\D/g, '').length < 7) return fail('Please enter a valid phone number.', 'phone');
  if (CONFIG.REQUIRE_EMAIL && !email) return fail('Please enter your email address.', 'email');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Please enter a valid email address.', 'email');

  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    const r = await api.mark({ name, phone, email });
    if (!r.ok) {
      if (r.closed) return showClosed(r.error);
      return fail(r.error || 'Something went wrong. Please try again.');
    }
    showThanks(r, phone, email);
  } catch (err) {
    fail('Could not reach the server. Check your network and try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Mark me present';
  }
}

function showThanks(r, phone, email) {
  const first = String(r.name).split(' ')[0];
  if (r.already) {
    $('thanksTitle').textContent = 'Welcome, ' + first;
    $('thanksSaved').textContent = 'You were already marked present for this service.';
    $('thanksMsg').textContent = 'No need to sign in again. We are glad you are with us.';
  } else {
    $('thanksTitle').textContent = 'Thank you, ' + first;
    $('thanksSaved').textContent = 'Your attendance has been saved successfully.';
    $('thanksMsg').textContent = r.today
      ? 'Thank you for coming to ' + CONFIG.CHURCH_NAME + ' today. We are blessed to have you worship with us.'
      : 'Thank you for worshipping with us this Sunday. We are blessed to have you.';
  }
  $('rName').textContent = r.name;
  $('rPhone').textContent = phone;
  $('rDate').textContent = r.label;
  if (email) { $('rEmail').textContent = email; show('rEmailRow'); } else { hide('rEmailRow'); }
  $('thanksNext').textContent = 'We look forward to seeing you next Sunday, ' + r.nextLabel + '.';
  setView('thanksView');
}

/* =====================================================================
   BIG-SCREEN PAGE
   ===================================================================== */
function startDisplay() {
  document.body.classList.add('display');
  show('display');
  $('dUrl').textContent = SITE_URL;

  if (typeof QRCode !== 'undefined') {
    new QRCode($('qr'), { text: SITE_URL, width: 360, height: 360, correctLevel: QRCode.CorrectLevel.M });
  } else {
    $('qr').textContent = 'QR code could not load. Use the link below.';
  }

  async function refresh() {
    try {
      const s = await api.status();
      $('dDate').textContent = s.label;
      $('count').textContent = s.count + ' present';
      $('dStatus').textContent = s.open ? 'Attendance is open now' : s.closedMsg;
    } catch (err) {
      $('dStatus').textContent = 'Cannot reach the server. Retrying…';
    }
  }
  refresh();
  setInterval(refresh, CONFIG.POLL_MS);
}