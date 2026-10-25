/**
 * AgriLab Ops backend: a Google Apps Script web app that stores the lab's records in this Google Sheet.
 *
 * Tabs: Samples, Stock, QC, Staff. Run setup() once, add staff to the Staff tab, then deploy as a web app
 * (Execute as: Me, Who has access: Anyone). The website talks to it with staff name + PIN logins.
 * Full steps: SETUP.md in the repository.
 */

var SHEETS = {
  Samples: ['id', 'receivedAt', 'status', 'clientName', 'clientPhone', 'clientType', 'clientArea', 'sampleType', 'description',
    'sampledOn', 'tests', 'express', 'channel', 'agrovet', 'heardVia', 'discount', 'price', 'paid', 'mpesa', 'paidAt', 'consent',
    'dueAt', 'startedAt', 'analystId', 'analysedAt', 'reviewerId', 'signedAt', 'reportedAt', 'createdBy', 'notes',
    'moisture', 'protein', 'fat', 'fibre', 'ash', 'starch', 'afb1', 'aft', 'afm1', 'fum', 'don', 'zea', 'ota', 'updatedAt', 'updatedBy'],
  Stock: ['id', 'item', 'lot', 'testsLeft', 'reorderAt', 'expiry', 'addedAt', 'updatedAt', 'updatedBy'],
  QC: ['date', 'nir', 'elisa', 'fridgeMin', 'fridgeMax', 'notes', 'by', 'at'],
  Staff: ['id', 'name', 'role', 'pin', 'active']
};
var RESULT_FIELDS = ['moisture', 'protein', 'fat', 'fibre', 'ash', 'starch', 'afb1', 'aft', 'afm1', 'fum', 'don', 'zea', 'ota'];
var TEST_CODES = ['NS-01', 'AF-01', 'AF-02', 'AM-01', 'FS-01', 'MY-01', 'MY-02', 'MY-03', 'MY-04', 'MP-01'];
var STATUSES = ['received', 'analysis', 'review', 'ready', 'reported'];
var ROLES = ['director', 'lab_manager', 'analyst', 'client_desk', 'field_officer'];
var SIGNERS = ['director', 'lab_manager'];
var BOOL = ['express', 'paid', 'consent', 'active'];
var NUM = ['discount', 'price', 'testsLeft', 'reorderAt', 'fridgeMin', 'fridgeMax'].concat(RESULT_FIELDS);
var TZ = 'Africa/Nairobi';
var SESSION_SECONDS = 21600; // 6 hours, the longest the script cache keeps a value
var MAX_TRIES = 5;

// Fields the website may set when it logs a sample, and fields it may change later.
var CREATE_FIELDS = ['clientName', 'clientPhone', 'clientType', 'clientArea', 'sampleType', 'description', 'sampledOn', 'tests',
  'express', 'channel', 'agrovet', 'heardVia', 'discount', 'price', 'paid', 'mpesa', 'consent', 'dueAt', 'notes'];
var UPDATE_FIELDS = ['status', 'price', 'paid', 'mpesa', 'notes'].concat(RESULT_FIELDS);

/* ------------------------------------------------------------------ setup */

/** Run once from the Apps Script editor: creates the four tabs and the first staff row. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var head = SHEETS[name];
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), head.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
  var staff = ss.getSheetByName('Staff');
  if (staff.getLastRow() < 2) {
    staff.appendRow(['S1', 'Lawrence Maina', 'director', 'change-me-2468', 'yes']);
  }
  var first = ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 4) ss.deleteSheet(first);
  return 'AgriLab Ops sheet is ready. Edit the Staff tab, then deploy the web app.';
}

/* ------------------------------------------------------------------ web app entry points */

function doGet() {
  return json_({ ok: true, service: 'AgriLab Ops', time: new Date().toISOString() });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e && e.postData ? e.postData.contents : '{}'); }
  catch (x) { return json_({ ok: false, error: 'bad_request', message: 'The request could not be read.' }); }
  try {
    var out = route_(req) || {};
    out.ok = true;
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: (err && err.code) || 'server_error', message: String((err && err.message) || err) });
  }
}

function route_(req) {
  switch (req.action) {
    case 'login': return login_(req);
    case 'logout': return logout_(req);
    case 'data': return data_(req);
    case 'createSample': return createSample_(req);
    case 'updateSample': return updateSample_(req);
    case 'addStock': return addStock_(req);
    case 'updateStock': return updateStock_(req);
    case 'saveQC': return saveQC_(req);
    default: fail_('bad_request', 'Unknown action.');
  }
}

/* ------------------------------------------------------------------ sign-in */

function login_(req) {
  var name = String(req.name || '').trim();
  var pin = String(req.pin || '').trim();
  if (!name || !pin) fail_('bad_login', 'Enter your name and PIN.');
  var cache = CacheService.getScriptCache();
  var failKey = 'fail:' + name.toLowerCase();
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_TRIES) fail_('locked', 'Too many wrong PINs. Wait 15 minutes or ask the Director to check the Staff tab.');
  ensureStaffIds_();
  var rows = readRows_('Staff');
  var idx = -1;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].name).trim().toLowerCase() === name.toLowerCase() && rows[i].active) { idx = i; break; }
  }
  if (idx < 0 || !pinMatches_(rows[idx], pin)) {
    cache.put(failKey, String(fails + 1), 900);
    fail_('bad_login', 'Name or PIN not recognised.');
  }
  cache.remove(failKey);
  var r = rows[idx];
  if (String(r.pin).indexOf('sha256:') !== 0) writeCell_('Staff', idx, 'pin', hashPin_(pin, r.id));
  var role = ROLES.indexOf(r.role) >= 0 ? r.role : 'client_desk';
  var sess = { id: r.id, name: r.name, role: role };
  var token = Utilities.getUuid();
  cache.put('s:' + token, JSON.stringify(sess), SESSION_SECONDS);
  return { token: token, staff: sess };
}

function logout_(req) {
  CacheService.getScriptCache().remove('s:' + String(req.token || ''));
  return {};
}

function session_(req) {
  var v = CacheService.getScriptCache().get('s:' + String(req.token || ''));
  if (!v) fail_('unauthorized', 'Please sign in again.');
  return JSON.parse(v);
}

function hashPin_(pin, salt) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ':' + pin, Utilities.Charset.UTF_8);
  return 'sha256:' + raw.map(function (b) { var h = ((b + 256) % 256).toString(16); return h.length === 1 ? '0' + h : h; }).join('');
}

function pinMatches_(row, pin) {
  var stored = String(row.pin);
  return stored.indexOf('sha256:') === 0 ? stored === hashPin_(pin, row.id) : stored === pin;
}

function ensureStaffIds_() {
  var rows = readRows_('Staff');
  var used = {};
  rows.forEach(function (r) { if (r.id) used[r.id] = true; });
  var n = rows.length;
  rows.forEach(function (r, i) {
    if (!r.id) {
      while (used['S' + n]) n++;
      used['S' + n] = true;
      writeCell_('Staff', i, 'id', 'S' + n);
    }
  });
}

/* ------------------------------------------------------------------ reads */

function data_(req) {
  var me = session_(req);
  var samples = readRows_('Samples');
  samples.sort(function (a, b) { return String(b.receivedAt).localeCompare(String(a.receivedAt)); });
  var qc = readRows_('QC');
  qc.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  var staff = readRows_('Staff').map(function (s) { return { id: s.id, name: s.name, role: s.role, active: s.active }; });
  return { me: me, samples: samples.slice(0, 2000), stock: readRows_('Stock'), qc: qc.slice(0, 90), staff: staff, serverTime: new Date().toISOString() };
}

/* ------------------------------------------------------------------ samples */

function createSample_(req) {
  var me = session_(req);
  var s = req.sample || {};
  if (!String(s.clientName || '').trim()) fail_('invalid', 'Enter the client’s name.');
  var tests = Array.isArray(s.tests) ? s.tests : [];
  if (!tests.length || tests.some(function (t) { return TEST_CODES.indexOf(t) < 0; })) fail_('invalid', 'Choose at least one valid test.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var now = new Date();
    var prefix = 'AGL-' + Utilities.formatDate(now, TZ, 'yyMMdd') + '-';
    var max = 0;
    readColumn_('Samples', 'id').forEach(function (id) {
      if (String(id).indexOf(prefix) === 0) max = Math.max(max, parseInt(String(id).slice(prefix.length), 10) || 0);
    });
    var row = {};
    CREATE_FIELDS.forEach(function (f) { if (s[f] !== undefined) row[f] = clean_(f, s[f]); });
    row.tests = tests;
    row.id = prefix + ('00' + (max + 1)).slice(-3);
    row.receivedAt = now.toISOString();
    row.status = 'received';
    row.createdBy = me.id;
    if (row.paid) row.paidAt = row.receivedAt;
    row.updatedAt = row.receivedAt;
    row.updatedBy = me.id;
    sheet_('Samples').appendRow(toRow_('Samples', row));
    return { sample: roundTrip_('Samples', row) };
  } finally {
    lock.releaseLock();
  }
}

function updateSample_(req) {
  var me = session_(req);
  var patch = req.patch || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var idx = findIndex_('Samples', 'id', String(req.id || ''));
    if (idx < 0) fail_('not_found', 'That sample was not found.');
    var cur = readRowAt_('Samples', idx);
    if (req.expect && cur.updatedAt && req.expect !== cur.updatedAt) fail_('conflict', 'Someone else changed this sample just now. The latest version has been loaded.');
    var now = new Date().toISOString();
    var next = JSON.parse(JSON.stringify(cur));
    var touchesResults = RESULT_FIELDS.some(function (f) { return patch[f] !== undefined; });
    if (touchesResults && cur.status !== 'analysis') fail_('locked', 'Results are locked once a sample leaves analysis.');
    UPDATE_FIELDS.forEach(function (f) { if (patch[f] !== undefined && f !== 'status') next[f] = clean_(f, patch[f]); });

    if (patch.status !== undefined && patch.status !== cur.status) {
      var to = patch.status, from = cur.status;
      if (STATUSES.indexOf(to) < 0) fail_('invalid', 'Unknown status.');
      if (to === 'analysis' && from === 'received') { next.startedAt = now; }
      else if (to === 'analysis' && from === 'review') { /* returned to the analyst */ }
      else if (to === 'review' && from === 'analysis') {
        var any = RESULT_FIELDS.some(function (f) { return next[f] !== null && next[f] !== '' && next[f] !== undefined; });
        if (!any) fail_('invalid', 'Enter the results before sending for review.');
        next.analystId = me.id; next.analysedAt = now;
      } else if (to === 'ready' && from === 'review') {
        if (SIGNERS.indexOf(me.role) < 0) fail_('forbidden', 'Only the lab manager or the Director can sign off results.');
        if (cur.analystId && cur.analystId === me.id) fail_('forbidden', 'You entered these results, so a second person must sign them off.');
        next.reviewerId = me.id; next.signedAt = now;
      } else if (to === 'reported' && from === 'ready') { next.reportedAt = now; }
      else fail_('invalid', 'That step is not allowed from “' + from + '”.');
      next.status = to;
    }
    if (next.paid && !cur.paid) next.paidAt = now;
    if (!next.paid) next.paidAt = '';
    next.updatedAt = now;
    next.updatedBy = me.id;
    writeRowAt_('Samples', idx, next);
    return { sample: roundTrip_('Samples', next) };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ stock and QC */

function addStock_(req) {
  var me = session_(req);
  var k = req.kit || {};
  if (!String(k.item || '').trim() || !String(k.lot || '').trim()) fail_('invalid', 'Enter the kit name and lot number.');
  var now = new Date().toISOString();
  var row = { id: 'K' + new Date().getTime(), item: clean_('item', k.item), lot: clean_('lot', k.lot), testsLeft: num_(k.testsLeft) || 0,
    reorderAt: num_(k.reorderAt) || 0, expiry: clean_('expiry', k.expiry || ''), addedAt: now, updatedAt: now, updatedBy: me.id };
  sheet_('Stock').appendRow(toRow_('Stock', row));
  return { kit: row };
}

function updateStock_(req) {
  var me = session_(req);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var idx = findIndex_('Stock', 'id', String(req.id || ''));
    if (idx < 0) fail_('not_found', 'That kit lot was not found.');
    var cur = readRowAt_('Stock', idx);
    if (req.testsLeft !== undefined) cur.testsLeft = num_(req.testsLeft) || 0;
    cur.updatedAt = new Date().toISOString();
    cur.updatedBy = me.id;
    writeRowAt_('Stock', idx, cur);
    return { kit: cur };
  } finally {
    lock.releaseLock();
  }
}

function saveQC_(req) {
  var me = session_(req);
  var q = req.qc || {};
  var date = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var ok = ['pass', 'fail', 'not run'];
  var row = { date: date, nir: ok.indexOf(q.nir) >= 0 ? q.nir : 'not run', elisa: ok.indexOf(q.elisa) >= 0 ? q.elisa : 'not run',
    fridgeMin: num_(q.fridgeMin), fridgeMax: num_(q.fridgeMax), notes: clean_('notes', q.notes || ''), by: me.id, at: new Date().toISOString() };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var idx = findIndex_('QC', 'date', date);
    if (idx < 0) sheet_('QC').appendRow(toRow_('QC', row));
    else writeRowAt_('QC', idx, row);
    return { qc: row };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ sheet helpers */

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) fail_('not_set_up', 'The “' + name + '” tab is missing. Run setup() in the Apps Script editor.');
  return sh;
}

function readRows_(name) {
  var sh = sheet_(name);
  var n = sh.getLastRow();
  if (n < 2) return [];
  var vals = sh.getRange(2, 1, n - 1, SHEETS[name].length).getDisplayValues();
  return vals.filter(function (v) { return v.join('') !== ''; }).map(function (v) { return fromRow_(name, v); });
}

function readColumn_(name, field) {
  var sh = sheet_(name);
  var n = sh.getLastRow();
  if (n < 2) return [];
  var col = SHEETS[name].indexOf(field) + 1;
  return sh.getRange(2, col, n - 1, 1).getDisplayValues().map(function (r) { return r[0]; });
}

function findIndex_(name, field, value) {
  var col = readColumn_(name, field);
  for (var i = 0; i < col.length; i++) if (String(col[i]) === value) return i;
  return -1;
}

function readRowAt_(name, idx) {
  var v = sheet_(name).getRange(idx + 2, 1, 1, SHEETS[name].length).getDisplayValues()[0];
  return fromRow_(name, v);
}

function writeRowAt_(name, idx, obj) {
  sheet_(name).getRange(idx + 2, 1, 1, SHEETS[name].length).setValues([toRow_(name, obj)]);
}

function writeCell_(name, idx, field, value) {
  sheet_(name).getRange(idx + 2, SHEETS[name].indexOf(field) + 1).setValue(value);
}

/** What a row reads back as once Sheets has stored it (a leading apostrophe only marks text). */
function roundTrip_(name, obj) {
  return fromRow_(name, toRow_(name, obj).map(function (x) { return x.charAt(0) === "'" ? x.slice(1) : x; }));
}

function fromRow_(name, v) {
  var o = {};
  SHEETS[name].forEach(function (h, i) { o[h] = parse_(h, v[i] === undefined ? '' : String(v[i])); });
  return o;
}

function toRow_(name, o) {
  return SHEETS[name].map(function (h) { return format_(h, o[h]); });
}

function parse_(h, s) {
  if (h === 'active') return s === '' || /^(yes|true|y|1)$/i.test(s);
  if (BOOL.indexOf(h) >= 0) return /^(yes|true|y|1)$/i.test(s);
  if (NUM.indexOf(h) >= 0) return s === '' ? null : Number(s);
  if (h === 'tests') return s ? s.split(',').map(function (x) { return x.trim(); }).filter(String) : [];
  return s;
}

function format_(h, v) {
  if (BOOL.indexOf(h) >= 0) return v ? 'yes' : 'no';
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Array]') return v.join(', ');
  var s = String(v);
  // Keep text that Sheets would treat as a formula as plain text.
  return s.charAt(0) === '=' && NUM.indexOf(h) < 0 ? "'" + s : s;
}

function clean_(f, v) {
  if (BOOL.indexOf(f) >= 0) return !!v;
  if (NUM.indexOf(f) >= 0) return num_(v);
  if (f === 'tests') return v;
  return String(v === null || v === undefined ? '' : v).slice(0, 500);
}

function num_(v) {
  if (v === null || v === undefined || v === '') return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

function fail_(code, message) {
  var e = new Error(message || code);
  e.code = code;
  throw e;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
