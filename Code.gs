/**
 * Sunday Attendance — Google Apps Script backend (JSON API)
 *
 * The website (index.html, style.css, script.js) lives anywhere you like
 * (VS Code, Vercel, GitHub Pages...) and talks to this script.
 *
 * - Open on Sundays only, between OPEN_HOUR and CLOSE_HOUR (church time).
 * - Each Sunday gets its own tab (named by date, e.g. 2026-11-22).
 * - One attendance per person per Sunday (same phone OR same email).
 * - A "Members" tab keeps a running total per person (matched by phone).
 *
 * Paste this into a Google Sheet's Apps Script (Extensions > Apps Script).
 */

const CONFIG = {
  TIMEZONE: 'Africa/Lagos',
  OPEN_HOUR: 3,            // 24-hour clock. 3 = 3:00 AM  (use 15 for 3:00 PM)
  CLOSE_HOUR: 21,          // 21 = 9:00 PM. Site shuts exactly at this hour.
  REQUIRE_EMAIL: false,
  MEMBERS_SHEET: 'Members',
};

/* ---------- web endpoints ---------- */

function doGet(e) {
  return json_(getStatus());
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_(markAttendance(body.name, body.phone, body.email));
  } catch (err) {
    return json_({ ok: false, error: 'Bad request.' });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------- time / opening hours ---------- */

function fmtHour_(h) {
  const suffix = h >= 12 && h < 24 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + ':00 ' + suffix;
}

function getSunday_() {
  const tz = CONFIG.TIMEZONE;
  const now = new Date();
  const dow = Number(Utilities.formatDate(now, tz, 'u')) % 7; // Sun = 0
  const hour = Number(Utilities.formatDate(now, tz, 'H'));

  const open = dow === 0 && hour >= CONFIG.OPEN_HOUR && hour < CONFIG.CLOSE_HOUR;

  // Service date = today if it is Sunday and not yet closed, otherwise the coming Sunday.
  let daysAhead = (7 - dow) % 7;
  if (dow === 0 && hour >= CONFIG.CLOSE_HOUR) daysAhead = 7;
  const target = new Date(now.getTime() + daysAhead * 86400000);
  const following = new Date(target.getTime() + 7 * 86400000);

  return {
    open: open,
    today: open,
    key: Utilities.formatDate(target, tz, 'yyyy-MM-dd'),
    label: Utilities.formatDate(target, tz, 'EEEE, d MMMM yyyy'),
    nextLabel: Utilities.formatDate(following, tz, 'EEEE, d MMMM'),
    closedMsg: 'Attendance is only open on Sundays, from ' + fmtHour_(CONFIG.OPEN_HOUR) +
      ' to ' + fmtHour_(CONFIG.CLOSE_HOUR) + '. It opens next on ' +
      Utilities.formatDate(target, tz, 'EEEE, d MMMM') + ' at ' + fmtHour_(CONFIG.OPEN_HOUR) + '.',
  };
}

/* ---------- sheet helpers ---------- */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function styleHeader_(range) {
  range.setFontWeight('bold').setBackground('#172033').setFontColor('#ffffff');
}

function getMembersSheet_() {
  const ss = ss_();
  let sh = ss.getSheetByName(CONFIG.MEMBERS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.MEMBERS_SHEET, 0);
    styleHeader_(sh.getRange(1, 1, 1, 6).setValues([
      ['Phone', 'Name', 'Email', 'First attended', 'Last attended', 'Times attended']
    ]));
    sh.getRange('A:A').setNumberFormat('@');
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, 6, 150);
  }
  return sh;
}

function getSundaySheet_(key, create) {
  const ss = ss_();
  let sh = ss.getSheetByName(key);
  if (!sh && create) {
    getMembersSheet_(); // make sure it exists and sits first
    sh = ss.insertSheet(key, 1); // newest Sunday right after Members
    styleHeader_(sh.getRange(1, 1, 1, 4).setValues([['Time', 'Name', 'Phone', 'Email']]));
    sh.getRange('C:C').setNumberFormat('@'); // keep the leading zero in phone numbers
    sh.setFrozenRows(1);
    sh.setColumnWidths(1, 4, 180);
  }
  return sh;
}

function normalizePhone_(raw) {
  let p = String(raw || '').replace(/[^\d+]/g, '');
  if (p.indexOf('+234') === 0) p = '0' + p.slice(4);
  else if (p.indexOf('234') === 0 && p.length === 13) p = '0' + p.slice(3);
  p = p.replace(/^\+/, '');
  if (p.length === 10 && /^[789]/.test(p)) p = '0' + p; // 8012345678 -> 08012345678
  return p;
}

function cleanName_(raw) {
  return String(raw || '').replace(/\s+/g, ' ').trim()
    .split(' ').map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
}

function cleanEmail_(raw) {
  return String(raw || '').trim().toLowerCase();
}

/* ---------- core logic ---------- */

function getStatus() {
  const s = getSunday_();
  let count = 0;
  if (s.open) {
    const sh = getSundaySheet_(s.key, false);
    count = sh ? Math.max(sh.getLastRow() - 1, 0) : 0;
  }
  return { open: s.open, label: s.label, count: count, closedMsg: s.closedMsg };
}

function markAttendance(name, phone, email) {
  // 1. Opening hours are enforced here on the server.
  const s = getSunday_();
  if (!s.open) return { ok: false, closed: true, error: s.closedMsg };

  name = cleanName_(name);
  phone = normalizePhone_(phone);
  email = cleanEmail_(email);

  if (name.length < 2) return { ok: false, error: 'Please enter your full name.' };
  if (phone.length < 7 || phone.length > 15) return { ok: false, error: 'Please enter a valid phone number.' };
  if (!email && CONFIG.REQUIRE_EMAIL) return { ok: false, error: 'Please enter your email address.' };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Please enter a valid email address.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // Re-check inside the lock in case the clock passed closing time.
    const s2 = getSunday_();
    if (!s2.open) return { ok: false, closed: true, error: s2.closedMsg };

    const result = { ok: true, already: false, name: name, label: s2.label, nextLabel: s2.nextLabel, today: true };
    const sh = getSundaySheet_(s2.key, true);

    // 2. Only once per Sunday: same phone number OR same email = already marked.
    const last = sh.getLastRow();
    if (last > 1) {
      const rows = sh.getRange(2, 2, last - 1, 3).getValues(); // Name, Phone, Email
      for (let i = 0; i < rows.length; i++) {
        const samePhone = String(rows[i][1]) === phone;
        const sameEmail = email && String(rows[i][2]).toLowerCase() === email;
        if (samePhone || sameEmail) {
          result.already = true;
          result.name = String(rows[i][0]) || name;
          return result;
        }
      }
    }

    const time = Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
    sh.appendRow([time, name, phone, email]);

    // 3. Update running totals on the Members tab.
    const mem = getMembersSheet_();
    const mLast = mem.getLastRow();
    let row = -1;
    if (mLast > 1) {
      const mp = mem.getRange(2, 1, mLast - 1, 1).getValues().map(function (r) { return String(r[0]); });
      const idx = mp.indexOf(phone);
      if (idx !== -1) row = idx + 2;
    }
    if (row === -1) {
      mem.appendRow([phone, name, email, s2.key, s2.key, 1]);
    } else {
      const count = Number(mem.getRange(row, 6).getValue()) || 0;
      mem.getRange(row, 2).setValue(name);
      if (email) mem.getRange(row, 3).setValue(email);
      mem.getRange(row, 5).setValue(s2.key);
      mem.getRange(row, 6).setValue(count + 1);
    }

    SpreadsheetApp.flush(); // make sure it is really written before we say "saved"
    return result;
  } catch (err) {
    return { ok: false, error: 'Something went wrong. Please try again.' };
  } finally {
    lock.releaseLock();
  }
}
