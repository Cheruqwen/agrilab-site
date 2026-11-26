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
    'moisture', 'protein', 'fat', 'fibre', 'ash', 'starch', 'afb1', 'aft', 'afm1', 'fum', 'don', 'zea', 'ota', 'updatedAt', 'updatedBy',
    // Added later: kept at the end so existing sheets keep their columns in place.
    'county', 'landmark', 'sampleState', 'grinding', 'packaging', 'batch', 'consult', 'consultFee', 'quoted',
    'disposeBy', 'disposedAt', 'disposedBy', 'consultDoneAt', 'clientId', 'element', 'subscriptionId'],
  Stock: ['id', 'item', 'lot', 'testsLeft', 'reorderAt', 'expiry', 'addedAt', 'updatedAt', 'updatedBy'],
  QC: ['date', 'nir', 'elisa', 'fridgeMin', 'fridgeMax', 'notes', 'by', 'at'],
  Staff: ['id', 'name', 'role', 'pin', 'active'],
  Visitors: ['id', 'at', 'name', 'phone', 'email', 'county', 'landmark', 'purpose', 'notes', 'source', 'by'],
  Clients: ['id', 'name', 'phone', 'email', 'type', 'segment', 'county', 'landmark', 'pin', 'portal', 'since', 'createdAt', 'updatedAt', 'updatedBy'],
  Settings: ['key', 'value', 'updatedAt', 'updatedBy'],
  Subscriptions: ['id', 'clientId', 'plan', 'fee', 'quota', 'extraDiscount', 'status', 'start', 'paidThrough', 'notes', 'createdAt', 'updatedAt', 'updatedBy'],
  SubPayments: ['id', 'subscriptionId', 'clientId', 'month', 'amount', 'mpesa', 'at', 'by']
};
var RESULT_FIELDS = ['moisture', 'protein', 'fat', 'fibre', 'ash', 'starch', 'afb1', 'aft', 'afm1', 'fum', 'don', 'zea', 'ota'];
var TEST_CODES = ['NS-01', 'PR-01', 'OL-01', 'WC-01', 'SM-01', 'AF-01', 'AF-02', 'AM-01', 'FS-01', 'MY-01', 'MY-02', 'MY-03', 'MY-04', 'MP-01'];
var STATUSES = ['received', 'analysis', 'review', 'ready', 'reported'];
// Role titles are placeholders; the keys stay fixed. client_desk is the receptionist; field_officer is the rider.
var ROLES = ['director', 'lab_manager', 'lab_technician', 'analyst', 'client_desk', 'nutritionist', 'sales_marketing', 'field_officer'];
var SIGNERS = ['director', 'lab_manager'];
// Who can do what. The staff page (ops/index.html) shows the same table; keep the two in step.
// The lab technician covers reception and the bench until dedicated receptionists and analysts are hired.
var PERMS = {
  logSample: ['director', 'lab_manager', 'lab_technician', 'client_desk', 'field_officer'],
  payment: ['director', 'lab_manager', 'lab_technician', 'client_desk'],
  batch: ['director', 'lab_manager', 'lab_technician', 'analyst'],
  results: ['director', 'lab_manager', 'lab_technician', 'analyst'],
  signOff: ['director', 'lab_manager'],
  sendReport: ['director', 'lab_manager', 'lab_technician', 'client_desk'],
  consult: ['director', 'lab_manager', 'lab_technician', 'nutritionist'],
  dispose: ['director', 'lab_manager', 'lab_technician', 'analyst'],
  stock: ['director', 'lab_manager', 'lab_technician', 'analyst'],
  qc: ['director', 'lab_manager', 'lab_technician', 'analyst'],
  closeout: ['director', 'lab_manager', 'lab_technician', 'client_desk'],
  visitors: ['director', 'lab_manager', 'lab_technician', 'analyst', 'client_desk', 'nutritionist', 'sales_marketing', 'field_officer'],
  bigDiscount: ['director'],
  clients: ['director', 'lab_manager', 'lab_technician', 'client_desk', 'sales_marketing'],
  loyalty: ['director'],
  subscriptions: ['director', 'sales_marketing'],
  marketing: ['director', 'sales_marketing']
};
var PERM_TEXT = {
  logSample: 'log samples', payment: 'record payments', batch: 'start test batches', results: 'enter results',
  signOff: 'sign off or return results', sendReport: 'send reports', consult: 'mark consultations done', dispose: 'mark samples disposed',
  stock: 'change kit stock', qc: 'log QC', visitors: 'sign in visitors', bigDiscount: 'approve discounts of 50% or more', clients: 'manage client accounts', loyalty: 'change loyalty discounts', subscriptions: 'set up subscriptions', closeout: 'run the close-out', marketing: 'see marketing figures'
};
function need_(me, perm) {
  if ((PERMS[perm] || []).indexOf(me.role) < 0) fail_('forbidden', 'Your role can’t ' + PERM_TEXT[perm] + '.');
}
var BOOL = ['express', 'paid', 'consent', 'active', 'grinding', 'consult', 'portal'];
var NUM = ['discount', 'price', 'testsLeft', 'reorderAt', 'fridgeMin', 'fridgeMax', 'consultFee', 'quoted', 'fee', 'quota', 'extraDiscount', 'amount'].concat(RESULT_FIELDS);
var TZ = 'Africa/Nairobi';
var SESSION_SECONDS = 21600; // 6 hours, the longest the script cache keeps a value
var MAX_TRIES = 5;
var BATCH_MAX = 96;         // one microplate
var KEEP_DAYS = 14;         // samples are disposed of no later than two weeks after they arrive
// Client groups: each sees a portal page built for its work.
var SEGMENTS = ['farmer', 'aggregator', 'consumer', 'trade'];
var SEGMENT_OF_TYPE = {
  'Dairy farmer': 'farmer', 'Poultry, pig or fish farmer': 'farmer',
  'Milk co-operative': 'aggregator', 'Dairy co-operative': 'aggregator', 'Feed miller': 'aggregator', 'Feed distributor': 'aggregator',
  'Agrovet': 'aggregator', 'Grain trader or posho mill': 'aggregator',
  'Children’s home': 'consumer', 'School': 'consumer', 'Restaurant or caterer': 'consumer', 'Institution or researcher': 'consumer',
  'Peanut butter manufacturer or importer': 'trade', 'Importer': 'trade', 'Exporter': 'trade'
};
// Loyalty tiers until the Director sets their own: spend over the period is the main measure; tests and months as a client are optional extras.
var DEFAULT_TIERS = [
  { name: 'Standard', minSpend: 0, minTests: 0, minMonths: 0, discount: 0 },
  { name: 'Silver', minSpend: 20000, minTests: 0, minMonths: 0, discount: 5 },
  { name: 'Gold', minSpend: 60000, minTests: 10, minMonths: 0, discount: 10 },
  { name: 'Platinum', minSpend: 150000, minTests: 0, minMonths: 12, discount: 15 }
];
var VISITOR_PURPOSES = ['Bringing a sample', 'Collecting results', 'Nutritional consultation', 'Enquiry', 'Delivery', 'Partnership or business', 'Other'];

// Fields the website may set when it logs a sample, and fields it may change later.
var CREATE_FIELDS = ['clientName', 'clientPhone', 'clientType', 'clientArea', 'sampleType', 'description', 'sampledOn', 'tests',
  'express', 'channel', 'agrovet', 'heardVia', 'discount', 'price', 'paid', 'mpesa', 'consent', 'dueAt', 'notes',
  'county', 'landmark', 'sampleState', 'grinding', 'packaging', 'consult', 'consultFee', 'quoted'];
var UPDATE_FIELDS = ['status', 'price', 'paid', 'mpesa', 'notes', 'sampleState', 'grinding', 'packaging'].concat(RESULT_FIELDS);

/* ------------------------------------------------------------------ setup */

/** Run once from the Apps Script editor: creates the tabs and the first staff row.
 *  Safe to run again after updating this script: it adds any new columns and tabs and keeps the data. */
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
  if (first && ss.getSheets().length > Object.keys(SHEETS).length) ss.deleteSheet(first);
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
    case 'startBatch': return startBatch_(req);
    case 'markDisposed': return markDisposed_(req);
    case 'signVisitor': return signVisitor_(req);
    case 'saveClient': return saveClient_(req);
    case 'setClientPin': return setClientPin_(req);
    case 'saveSettings': return saveSettings_(req);
    case 'clientLogin': return clientLogin_(req);
    case 'clientLogout': return clientLogout_(req);
    case 'clientData': return clientData_(req);
    case 'saveSubscription': return saveSubscription_(req);
    case 'paySubscription': return paySubscription_(req);
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
  var visitors = [];
  try { visitors = readRows_('Visitors'); } catch (x) { /* tab not created yet: run setup() again */ }
  visitors.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
  var clients = [];
  try { clients = readRows_('Clients').map(publicClient_); } catch (x) { /* run setup() again */ }
  return { me: me, samples: samples.slice(0, 2000), stock: readRows_('Stock'), qc: qc.slice(0, 90), staff: staff,
    visitors: visitors.slice(0, 500), clients: clients, settings: settings_(), subscriptions: safeRows_('Subscriptions'), subPayments: safeRows_('SubPayments'),
    serverTime: new Date().toISOString() };
}

/* ------------------------------------------------------------------ samples */

function createSample_(req) {
  var me = session_(req);
  need_(me, 'logSample');
  var s = req.sample || {};
  if (s.paid && !s.subscriptionId) need_(me, 'payment');
  if (Number(s.discount) >= 50) need_(me, 'bigDiscount');
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
    row.clientId = linkClient_(s, me, now);
    row.element = clean_('element', s.element || '');
    if (s.subscriptionId) {
      // Covered by a monthly plan: free within the month's quota, so it counts as paid in full.
      var cov = coverage_(String(s.subscriptionId), row.clientId, now);
      if (!cov.ok) fail_('invalid', cov.why);
      row.subscriptionId = cov.sub.id; row.price = 0; row.discount = 0; row.paid = true; row.mpesa = 'PLAN';
    }
    row.disposeBy = new Date(now.getTime() + KEEP_DAYS * 864e5).toISOString();
    if (['dry', 'wet'].indexOf(row.sampleState) < 0) row.sampleState = '';
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
    if (touchesResults) need_(me, 'results');
    var touchesPay = (patch.paid !== undefined && !!patch.paid !== !!cur.paid) || (patch.mpesa !== undefined && String(patch.mpesa) !== String(cur.mpesa || '')) || (patch.price !== undefined && Number(patch.price) !== Number(cur.price));
    if (touchesPay) need_(me, 'payment');
    if (patch.consultDone === true) need_(me, 'consult');
    UPDATE_FIELDS.forEach(function (f) { if (patch[f] !== undefined && f !== 'status') next[f] = clean_(f, patch[f]); });
    if (patch.consultDone === true && cur.consult && !cur.consultDoneAt) next.consultDoneAt = now;
    if (cur.startedAt && cur.paid && patch.paid === false) fail_('locked', 'This sample is already being tested, so its payment can’t be undone.');

    if (patch.status !== undefined && patch.status !== cur.status) {
      var to = patch.status, from = cur.status;
      if (STATUSES.indexOf(to) < 0) fail_('invalid', 'Unknown status.');
      if (to === 'analysis' && from === 'received') fail_('invalid', 'Start testing by adding the sample to a batch.');
      else if (to === 'analysis' && from === 'review') { need_(me, 'signOff'); /* returned to the analyst */ }
      else if (to === 'review' && from === 'analysis') {
        var any = RESULT_FIELDS.some(function (f) { return next[f] !== null && next[f] !== '' && next[f] !== undefined; });
        if (!any) fail_('invalid', 'Enter the results before sending for review.');
        need_(me, 'results');
        next.analystId = me.id; next.analysedAt = now;
      } else if (to === 'ready' && from === 'review') {
        if (SIGNERS.indexOf(me.role) < 0) fail_('forbidden', 'Only the lab manager or the Director can sign off results.');
        if (cur.analystId && cur.analystId === me.id) fail_('forbidden', 'You entered these results, so a second person must sign them off.');
        next.reviewerId = me.id; next.signedAt = now;
      } else if (to === 'reported' && from === 'ready') { need_(me, 'sendReport'); next.reportedAt = now; }
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

/* ------------------------------------------------------------------ clients and loyalty */

/** Kenyan numbers in one form, so 0712…, +254712… and 254712… match. */
function normPhone_(p) {
  var d = String(p || '').replace(/\D/g, '');
  if (d.length === 10 && d.charAt(0) === '0') return '254' + d.slice(1);
  if (d.length === 9 && /^[17]/.test(d)) return '254' + d;
  return d;
}
function segmentOf_(type) { return SEGMENT_OF_TYPE[type] || 'farmer'; }
function publicClient_(c) {
  return { id: c.id, name: c.name, phone: c.phone, email: c.email, type: c.type, segment: c.segment || segmentOf_(c.type),
    county: c.county, landmark: c.landmark, portal: !!c.portal, since: c.since, createdAt: c.createdAt };
}

/** Finds the client for a new sample by phone (or by name when there is no phone), creating the account if it is new. */
function linkClient_(s, me, now) {
  var rows; try { rows = readRows_('Clients'); } catch (x) { return ''; }
  var phone = normPhone_(s.clientPhone), name = String(s.clientName || '').trim().toLowerCase();
  var found = null;
  for (var i = 0; i < rows.length; i++) {
    if ((phone && normPhone_(rows[i].phone) === phone) || (!phone && String(rows[i].name).trim().toLowerCase() === name)) { found = rows[i]; break; }
  }
  if (found) return found.id;
  var used = {}; rows.forEach(function (r) { used[r.id] = true; });
  var n = rows.length + 1; while (used['C' + n]) n++;
  var c = { id: 'C' + n, name: String(s.clientName).trim().slice(0, 120), phone: String(s.clientPhone || '').slice(0, 40), email: '',
    type: String(s.clientType || ''), segment: segmentOf_(s.clientType), county: String(s.county || ''), landmark: String(s.landmark || '').slice(0, 160),
    pin: '', portal: false, since: now.toISOString(), createdAt: now.toISOString(), updatedAt: now.toISOString(), updatedBy: me.id };
  sheet_('Clients').appendRow(toRow_('Clients', c));
  return c.id;
}

function saveClient_(req) {
  var me = session_(req); need_(me, 'clients');
  var c = req.client || {};
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var idx = findIndex_('Clients', 'id', String(c.id || ''));
    if (idx < 0) fail_('not_found', 'That client was not found.');
    var cur = readRowAt_('Clients', idx);
    ['name', 'phone', 'email', 'type', 'county', 'landmark'].forEach(function (f) { if (c[f] !== undefined) cur[f] = String(c[f]).slice(0, 160); });
    if (c.segment !== undefined) { if (SEGMENTS.indexOf(c.segment) < 0) fail_('invalid', 'Unknown client group.'); cur.segment = c.segment; }
    if (!String(cur.name).trim()) fail_('invalid', 'Enter the client’s name.');
    cur.updatedAt = new Date().toISOString(); cur.updatedBy = me.id;
    writeRowAt_('Clients', idx, cur);
    return { client: publicClient_(cur) };
  } finally { lock.releaseLock(); }
}

/** Gives a client a new 4-digit portal PIN. The PIN is returned once, for staff to pass on; the sheet keeps only a hash. */
function setClientPin_(req) {
  var me = session_(req); need_(me, 'clients');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var idx = findIndex_('Clients', 'id', String(req.id || ''));
    if (idx < 0) fail_('not_found', 'That client was not found.');
    var cur = readRowAt_('Clients', idx);
    if (!normPhone_(cur.phone)) fail_('invalid', 'Add the client’s phone number first: it is their portal sign-in.');
    var pin = String(1000 + Math.floor(Math.random() * 9000));
    cur.pin = hashPin_(pin, cur.id); cur.portal = true; cur.updatedAt = new Date().toISOString(); cur.updatedBy = me.id;
    writeRowAt_('Clients', idx, cur);
    return { client: publicClient_(cur), pin: pin };
  } finally { lock.releaseLock(); }
}

function settings_() {
  var o = {};
  try { readRows_('Settings').forEach(function (r) { o[r.key] = r.value; }); } catch (x) {}
  var tiers = null;
  try { tiers = JSON.parse(o.tiers || 'null'); } catch (x) { tiers = null; }
  if (!Array.isArray(tiers) || !tiers.length) tiers = DEFAULT_TIERS;
  return { tiers: tiers, period: o.period === 'all' ? 'all' : '12m', retestDays: Number(o.retestDays) || 30 };
}

function saveSettings_(req) {
  var me = session_(req); need_(me, 'loyalty');
  var t = req.settings || {};
  var tiers = Array.isArray(t.tiers) ? t.tiers : [];
  if (!tiers.length || tiers.length > 8) fail_('invalid', 'Set between one and eight tiers.');
  tiers = tiers.map(function (x) {
    var name = String(x.name || '').trim().slice(0, 30);
    var d = Number(x.discount), sp = Number(x.minSpend), te = Number(x.minTests || 0), mo = Number(x.minMonths || 0);
    if (!name) fail_('invalid', 'Every tier needs a name.');
    if (!(d >= 0 && d <= 50)) fail_('invalid', 'Tier discounts must be between 0% and 50%.');
    if (!(sp >= 0) || !(te >= 0) || !(mo >= 0)) fail_('invalid', 'Spend, tests and months can’t be negative.');
    return { name: name, minSpend: Math.round(sp), minTests: Math.round(te), minMonths: Math.round(mo), discount: Math.round(d * 10) / 10 };
  }).sort(function (a, b) { return a.minSpend - b.minSpend; });
  var period = t.period === 'all' ? 'all' : '12m';
  var retest = Math.min(365, Math.max(7, Math.round(Number(t.retestDays) || 30)));
  var now = new Date().toISOString();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    [['tiers', JSON.stringify(tiers)], ['period', period], ['retestDays', String(retest)]].forEach(function (kv) {
      var row = { key: kv[0], value: kv[1], updatedAt: now, updatedBy: me.id };
      var idx = findIndex_('Settings', 'key', kv[0]);
      if (idx < 0) sheet_('Settings').appendRow(toRow_('Settings', row)); else writeRowAt_('Settings', idx, row);
    });
  } finally { lock.releaseLock(); }
  return { settings: settings_() };
}

/** Spend (paid samples), number of paid samples and months as a client, and the tier they earn. */
function loyalty_(client, samples, st, subPays) {
  var now = Date.now(), from = st.period === 'all' ? 0 : now - 365 * 864e5;
  var paid = samples.filter(function (x) { return x.paid && new Date(x.receivedAt).getTime() >= from; });
  var spend = paid.reduce(function (a, x) { return a + (Number(x.price) || 0); }, 0)
    + (subPays || []).filter(function (x) { return x.clientId === client.id && new Date(x.at).getTime() >= from; }).reduce(function (a, x) { return a + (Number(x.amount) || 0); }, 0);
  var first = samples.reduce(function (m, x) { return x.receivedAt && x.receivedAt < m ? x.receivedAt : m; }, client.since || new Date().toISOString());
  var months = Math.max(0, Math.floor((now - new Date(first).getTime()) / (30.44 * 864e5)));
  var tiers = st.tiers.slice().sort(function (a, b) { return a.minSpend - b.minSpend; });
  var ok = function (t) { return spend >= t.minSpend && paid.length >= (t.minTests || 0) && months >= (t.minMonths || 0); };
  var tier = null; tiers.forEach(function (t) { if (ok(t)) tier = t; });
  var next = null; tiers.forEach(function (t) { if (!next && !ok(t) && (!tier || t.minSpend > tier.minSpend)) next = t; });
  return { spend: spend, tests: paid.length, months: months, since: first, period: st.period, tier: tier, next: next };
}

/* ------------------------------------------------------------------ subscriptions */

function safeRows_(name) { try { return readRows_(name); } catch (x) { return []; } }
function monthOf_(iso) { return iso ? Utilities.formatDate(new Date(iso), TZ, 'yyyy-MM') : ''; }
function addMonth_(ym) { var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); m++; if (m > 12) { m = 1; y++; } return y + '-' + (m < 10 ? '0' : '') + m; }

/** Whether a plan can cover one more sample this month: active, paid for this month, and quota left. */
function coverage_(subId, clientId, now) {
  var sub = safeRows_('Subscriptions').filter(function (x) { return x.id === subId; })[0];
  if (!sub) return { ok: false, why: 'That subscription was not found.' };
  if (clientId && sub.clientId !== clientId) return { ok: false, why: 'That subscription belongs to another client.' };
  if (sub.status !== 'active') return { ok: false, why: 'That subscription is ' + sub.status + '.' };
  var month = Utilities.formatDate(now, TZ, 'yyyy-MM');
  if (!sub.paidThrough || sub.paidThrough < month) return { ok: false, why: 'This month’s subscription fee has not been paid yet.' };
  var used = safeRows_('Samples').filter(function (x) { return x.subscriptionId === sub.id && monthOf_(x.receivedAt) === month; }).length;
  if (used >= Number(sub.quota || 0)) return { ok: false, why: 'This month’s ' + sub.quota + ' included samples are used up.' };
  return { ok: true, sub: sub };
}

function saveSubscription_(req) {
  var me = session_(req); need_(me, 'subscriptions');
  var x = req.subscription || {};
  var now = new Date().toISOString();
  var plan = String(x.plan || '').trim().slice(0, 60), fee = Number(x.fee), quota = Math.round(Number(x.quota)), extra = Number(x.extraDiscount || 0);
  if (!plan) fail_('invalid', 'Name the plan.');
  if (!(fee > 0)) fail_('invalid', 'Enter the monthly fee.');
  if (!(quota >= 1)) fail_('invalid', 'Enter how many samples a month the plan includes.');
  if (!(extra >= 0 && extra <= 30)) fail_('invalid', 'The discount on extra samples must be between 0% and 30%.');
  var status = ['active', 'paused', 'cancelled'].indexOf(x.status) >= 0 ? x.status : 'active';
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    if (x.id) {
      var idx = findIndex_('Subscriptions', 'id', String(x.id));
      if (idx < 0) fail_('not_found', 'That subscription was not found.');
      var cur = readRowAt_('Subscriptions', idx);
      cur.plan = plan; cur.fee = fee; cur.quota = quota; cur.extraDiscount = extra; cur.status = status; cur.notes = String(x.notes || '').slice(0, 300);
      cur.updatedAt = now; cur.updatedBy = me.id;
      writeRowAt_('Subscriptions', idx, cur);
      return { subscription: roundTrip_('Subscriptions', cur) };
    }
    var clientId = String(x.clientId || '');
    if (!safeRows_('Clients').some(function (c) { return c.id === clientId; })) fail_('invalid', 'Choose the client.');
    if (safeRows_('Subscriptions').some(function (o) { return o.clientId === clientId && o.status !== 'cancelled'; })) fail_('invalid', 'This client already has a subscription. Edit that one instead.');
    var row = { id: 'P' + new Date().getTime(), clientId: clientId, plan: plan, fee: fee, quota: quota, extraDiscount: extra, status: status,
      start: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'), paidThrough: '', notes: String(x.notes || '').slice(0, 300), createdAt: now, updatedAt: now, updatedBy: me.id };
    sheet_('Subscriptions').appendRow(toRow_('Subscriptions', row));
    return { subscription: roundTrip_('Subscriptions', row) };
  } finally { lock.releaseLock(); }
}

/** Records one month's fee: the plan is then paid through the next unpaid month. */
function paySubscription_(req) {
  var me = session_(req);
  if (PERMS.payment.indexOf(me.role) < 0 && PERMS.subscriptions.indexOf(me.role) < 0) fail_('forbidden', 'Your role can’t record payments.');
  var mpesa = String(req.mpesa || '').trim().toUpperCase();
  if (!mpesa) fail_('invalid', 'Enter the M-Pesa code.');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var idx = findIndex_('Subscriptions', 'id', String(req.id || ''));
    if (idx < 0) fail_('not_found', 'That subscription was not found.');
    var cur = readRowAt_('Subscriptions', idx);
    var month = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
    var next = !cur.paidThrough || cur.paidThrough < month ? month : addMonth_(cur.paidThrough);
    var amount = req.amount != null && req.amount !== '' ? Number(req.amount) : Number(cur.fee);
    var pay = { id: 'SP' + new Date().getTime(), subscriptionId: cur.id, clientId: cur.clientId, month: next, amount: amount, mpesa: mpesa.slice(0, 40), at: new Date().toISOString(), by: me.id };
    sheet_('SubPayments').appendRow(toRow_('SubPayments', pay));
    cur.paidThrough = next; cur.updatedAt = pay.at; cur.updatedBy = me.id;
    writeRowAt_('Subscriptions', idx, cur);
    return { subscription: roundTrip_('Subscriptions', cur), payment: roundTrip_('SubPayments', pay) };
  } finally { lock.releaseLock(); }
}

/* ------------------------------------------------------------------ client portal */

function clientLogin_(req) {
  var phone = normPhone_(req.phone), pin = String(req.pin || '').trim();
  if (!phone || !pin) fail_('bad_login', 'Enter your phone number and PIN.');
  var cache = CacheService.getScriptCache(), failKey = 'cfail:' + phone;
  var fails = Number(cache.get(failKey) || 0);
  if (fails >= MAX_TRIES) fail_('locked', 'Too many wrong PINs. Wait 15 minutes, or call the lab for a new PIN.');
  var rows; try { rows = readRows_('Clients'); } catch (x) { rows = []; }
  var c = null;
  for (var i = 0; i < rows.length; i++) if (normPhone_(rows[i].phone) === phone && rows[i].portal) { c = rows[i]; break; }
  if (!c || String(c.pin) !== hashPin_(pin, c.id)) { cache.put(failKey, String(fails + 1), 900); fail_('bad_login', 'Phone number or PIN not recognised.'); }
  cache.remove(failKey);
  var token = Utilities.getUuid();
  cache.put('cs:' + token, JSON.stringify({ clientId: c.id }), SESSION_SECONDS);
  return { token: token, client: { name: c.name } };
}
function clientLogout_(req) { CacheService.getScriptCache().remove('cs:' + String(req.token || '')); return {}; }

/** Everything a signed-in client may see: their own samples (results only once reported), their loyalty standing and the tiers. */
function clientData_(req) {
  var v = CacheService.getScriptCache().get('cs:' + String(req.token || ''));
  if (!v) fail_('unauthorized', 'Please sign in again.');
  var id = JSON.parse(v).clientId;
  var c = null; readRows_('Clients').forEach(function (r) { if (r.id === id) c = r; });
  if (!c || !c.portal) fail_('unauthorized', 'Your portal access has been switched off. Please call the lab.');
  var mine = readRows_('Samples').filter(function (x) { return x.clientId === id; });
  mine.sort(function (a, b) { return String(b.receivedAt).localeCompare(String(a.receivedAt)); });
  var st = settings_();
  var out = mine.map(function (x) {
    var o = { id: x.id, receivedAt: x.receivedAt, status: x.status, sampleType: x.sampleType, description: x.description, element: x.element,
      tests: x.tests, price: x.price, paid: x.paid, paidAt: x.paidAt, startedAt: x.startedAt, dueAt: x.dueAt, reportedAt: x.reportedAt,
      consult: x.consult, consultDoneAt: x.consultDoneAt, county: x.county, batch: x.batch };
    if (x.status === 'reported') RESULT_FIELDS.forEach(function (f) { o[f] = x[f]; });
    return o;
  });
  var pays = safeRows_('SubPayments');
  var sub = safeRows_('Subscriptions').filter(function (x) { return x.clientId === id && x.status !== 'cancelled'; })[0] || null;
  var subOut = null;
  if (sub) {
    var month = Utilities.formatDate(new Date(), TZ, 'yyyy-MM');
    subOut = { plan: sub.plan, fee: sub.fee, quota: sub.quota, extraDiscount: sub.extraDiscount, status: sub.status, start: sub.start, paidThrough: sub.paidThrough,
      usedThisMonth: mine.filter(function (x) { return x.subscriptionId === sub.id && monthOf_(x.receivedAt) === month; }).length, month: month };
  }
  return { client: publicClient_(c), samples: out, loyalty: loyalty_(c, mine, st, pays), tiers: st.tiers, retestDays: st.retestDays, subscription: subOut };
}

/* ------------------------------------------------------------------ batches and disposal */

/** Starts testing for paid samples by putting them in a batch of up to 96: a new one, or one opened earlier. */
function startBatch_(req) {
  var me = session_(req);
  need_(me, 'batch');
  var ids = Array.isArray(req.ids) ? req.ids.map(String) : [];
  if (!ids.length) fail_('invalid', 'Choose at least one sample for the batch.');
  if (ids.length > BATCH_MAX) fail_('invalid', 'A batch holds at most ' + BATCH_MAX + ' samples.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var idCol = readColumn_('Samples', 'id');
    var batchCol = readColumn_('Samples', 'batch');
    var nowD = new Date(), now = nowD.toISOString();
    var batch = String(req.batch || '').trim();
    if (batch) {
      var inBatch = batchCol.filter(function (b) { return b === batch; }).length;
      if (!inBatch) fail_('not_found', 'Batch ' + batch + ' was not found.');
      if (inBatch + ids.length > BATCH_MAX) fail_('invalid', 'Batch ' + batch + ' has room for ' + (BATCH_MAX - inBatch) + ' more samples.');
    } else {
      var prefix = 'B-' + Utilities.formatDate(nowD, TZ, 'yyMMdd') + '-';
      var max = 0;
      batchCol.forEach(function (b) { if (String(b).indexOf(prefix) === 0) max = Math.max(max, parseInt(String(b).slice(prefix.length), 10) || 0); });
      batch = prefix + ('0' + (max + 1)).slice(-2);
    }
    var rows = ids.map(function (id) {
      var idx = idCol.indexOf(id);
      if (idx < 0) fail_('not_found', 'Sample ' + id + ' was not found.');
      var cur = readRowAt_('Samples', idx);
      if (cur.status !== 'received') fail_('invalid', id + ' is already being tested.');
      if (!cur.paid) fail_('unpaid', id + ' is not paid in full. Tests start only after full payment.');
      return { idx: idx, row: cur };
    });
    var out = rows.map(function (x) {
      var next = x.row;
      next.status = 'analysis'; next.startedAt = now; next.batch = batch; next.updatedAt = now; next.updatedBy = me.id;
      writeRowAt_('Samples', x.idx, next);
      return roundTrip_('Samples', next);
    });
    return { batch: batch, samples: out };
  } finally {
    lock.releaseLock();
  }
}

/** Records that samples have been thrown away (at most two weeks after they arrive). */
function markDisposed_(req) {
  var me = session_(req);
  need_(me, 'dispose');
  var ids = Array.isArray(req.ids) ? req.ids.map(String) : [];
  if (!ids.length) fail_('invalid', 'Choose the samples that were disposed of.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var idCol = readColumn_('Samples', 'id');
    var now = new Date().toISOString();
    var out = [];
    ids.forEach(function (id) {
      var idx = idCol.indexOf(id);
      if (idx < 0) return;
      var cur = readRowAt_('Samples', idx);
      if (cur.disposedAt) { out.push(cur); return; }
      cur.disposedAt = now; cur.disposedBy = me.id; cur.updatedAt = now; cur.updatedBy = me.id;
      writeRowAt_('Samples', idx, cur);
      out.push(roundTrip_('Samples', cur));
    });
    return { samples: out };
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ visitors book */

/** Signs the visitors book. Staff at reception send their token; the online book (/visit/) sends none. */
function signVisitor_(req) {
  var me = null;
  if (req.token) { me = session_(req); need_(me, 'visitors'); }
  var v = req.visitor || {};
  if (v.website) return { visitor: null }; // spam trap field, left empty by people
  var name = String(v.name || '').trim();
  var phone = String(v.phone || '').trim();
  if (!name) fail_('invalid', 'Enter your name.');
  if (!phone && !String(v.email || '').trim()) fail_('invalid', 'Enter a phone number or an email address.');
  if (!me) {
    var cache = CacheService.getScriptCache();
    var key = 'visit:' + Utilities.formatDate(new Date(), TZ, 'yyyyMMddHH');
    var n = Number(cache.get(key) || 0);
    if (n >= 60) fail_('busy', 'The online visitors book is busy. Please sign the book at reception.');
    cache.put(key, String(n + 1), 3600);
  }
  var row = {
    id: 'V' + new Date().getTime(), at: new Date().toISOString(),
    name: name.slice(0, 120), phone: phone.slice(0, 40), email: String(v.email || '').trim().slice(0, 120),
    county: String(v.county || '').slice(0, 60), landmark: String(v.landmark || '').slice(0, 160),
    purpose: VISITOR_PURPOSES.indexOf(v.purpose) >= 0 ? v.purpose : 'Other', notes: String(v.notes || '').slice(0, 500),
    source: me ? 'Reception' : 'Online', by: me ? me.id : ''
  };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { sheet_('Visitors').appendRow(toRow_('Visitors', row)); }
  finally { lock.releaseLock(); }
  return { visitor: me ? row : { id: row.id, at: row.at } };
}

/* ------------------------------------------------------------------ stock and QC */

function addStock_(req) {
  var me = session_(req);
  need_(me, 'stock');
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
  need_(me, 'stock');
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
  need_(me, 'qc');
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
