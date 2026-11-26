/*
 * AgriLab offline demo backend.
 *
 * The demo build (demo/build-demo.js) puts this file, followed by apps-script/Code.gs, into the demo's ops/config.js.
 * It stands in for Google Sheets, CacheService and friends so the real Apps Script code runs inside the browser,
 * with every record kept in this browser's localStorage. Nothing leaves the computer.
 */
(function () {
  var DB_KEY = 'agrilab-demo-db', CACHE_KEY = 'agrilab-demo-cache';
  var USERS = [
    { id: 'S1', name: 'Lawrence Maina', role: 'director', pin: '1111' },
    { id: 'S2', name: 'Grace Wanjiru', role: 'lab_manager', pin: '2222' },
    { id: 'S3', name: 'Peter Kamau', role: 'analyst', pin: '3333' },
    { id: 'S4', name: 'Mary Njeri', role: 'client_desk', pin: '4444' },
    { id: 'S5', name: 'John Mwangi', role: 'field_officer', pin: '5555' }
  ];

  // ---------- storage ----------
  var db = null, cache = null;
  function load() {
    try { db = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch (e) { db = null; }
    try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { cache = {}; }
  }
  function save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (e) {}
  }

  // ---------- Google services, in memory ----------
  function sheetObj(name) {
    var rows = db.sheets[name];
    return {
      getName: function () { return name; },
      getLastRow: function () { return rows.length; },
      getMaxRows: function () { return Math.max(rows.length, 1000); },
      appendRow: function (r) { rows.push(r.map(function (x) { return String(x); })); },
      setFrozenRows: function () {},
      getRange: function (r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        function ensure() { while (rows.length < r + nr - 1) rows.push([]); }
        return {
          setNumberFormat: function () { return this; }, setFontWeight: function () { return this; },
          setValues: function (v) { ensure(); v.forEach(function (row, i) { row.forEach(function (x, j) { rows[r - 1 + i][c - 1 + j] = String(x); }); }); return this; },
          setValue: function (x) { ensure(); rows[r - 1][c - 1] = String(x); return this; },
          getDisplayValues: function () {
            var out = [];
            for (var i = 0; i < nr; i++) { var row = rows[r - 1 + i] || [], o = []; for (var j = 0; j < nc; j++) o.push(row[c - 1 + j] == null ? '' : row[c - 1 + j]); out.push(o); }
            return out;
          }
        };
      }
    };
  }
  var ss = {
    getSheetByName: function (n) { return db.sheets[n] ? sheetObj(n) : null; },
    insertSheet: function (n) { db.sheets[n] = []; return sheetObj(n); },
    getSheets: function () { return Object.keys(db.sheets).map(sheetObj); },
    deleteSheet: function (s) { delete db.sheets[s.getName()]; }
  };
  window.SpreadsheetApp = { getActiveSpreadsheet: function () { return ss; } };
  window.CacheService = { getScriptCache: function () { return {
    get: function (k) { var v = cache[k]; return v && v.exp > Date.now() ? v.val : null; },
    put: function (k, val, secs) { cache[k] = { val: String(val), exp: Date.now() + (secs || 600) * 1000 }; },
    remove: function (k) { delete cache[k]; }
  }; } };
  window.LockService = { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } };
  window.ContentService = { createTextOutput: function (t) { return { setMimeType: function () { return t; } }; }, MimeType: { JSON: 'json' } };
  window.Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    formatDate: function (d, tz, f) {
      var e = new Date(d.getTime() + 3 * 3600e3), p = function (n) { return (n < 10 ? '0' : '') + n; };
      return f.replace('yyyy', e.getUTCFullYear()).replace('yy', String(e.getUTCFullYear()).slice(2))
        .replace('MM', p(e.getUTCMonth() + 1)).replace('dd', p(e.getUTCDate())).replace('HH', p(e.getUTCHours()));
    },
    getUuid: function () { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); },
    computeDigest: function (alg, text) { return sha256(text).map(function (b) { return b > 127 ? b - 256 : b; }); }
  };
  // Small synchronous SHA-256 over UTF-8 text, returning bytes; enough for PIN hashing in the demo.
  function sha256(str) {
    var bytes = unescape(encodeURIComponent(str)).split('').map(function (c) { return c.charCodeAt(0); });
    var K = [], H = [], isP = function (n) { for (var f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
    for (var n = 2, k = 0; k < 64; n++) if (isP(n)) { if (k < 8) H[k] = (Math.pow(n, 1 / 2) * 4294967296) | 0; K[k++] = (Math.pow(n, 1 / 3) * 4294967296) | 0; }
    var l = bytes.length * 8; bytes.push(0x80); while (bytes.length % 64 !== 56) bytes.push(0);
    for (var s = 56; s >= 0; s -= 8) bytes.push(s >= 32 ? 0 : (l >>> s) & 255);
    var rot = function (x, n) { return (x >>> n) | (x << (32 - n)); };
    for (var i = 0; i < bytes.length; i += 64) {
      var w = [], a = H.slice();
      for (var t = 0; t < 64; t++) {
        if (t < 16) w[t] = (bytes[i + 4 * t] << 24) | (bytes[i + 4 * t + 1] << 16) | (bytes[i + 4 * t + 2] << 8) | bytes[i + 4 * t + 3];
        else { var x = w[t - 15], y = w[t - 2]; w[t] = (w[t - 16] + (rot(x, 7) ^ rot(x, 18) ^ (x >>> 3)) + w[t - 7] + (rot(y, 17) ^ rot(y, 19) ^ (y >>> 10))) | 0; }
        var t1 = (a[7] + (rot(a[4], 6) ^ rot(a[4], 11) ^ rot(a[4], 25)) + ((a[4] & a[5]) ^ (~a[4] & a[6])) + K[t] + w[t]) | 0;
        var t2 = ((rot(a[0], 2) ^ rot(a[0], 13) ^ rot(a[0], 22)) + ((a[0] & a[1]) ^ (a[0] & a[2]) ^ (a[1] & a[2]))) | 0;
        a = [(t1 + t2) | 0].concat(a.slice(0, 7)); a[4] = (a[4] + t1) | 0;
      }
      for (var j = 0; j < 8; j++) H[j] = (H[j] + a[j]) | 0;
    }
    var out = []; H.forEach(function (h) { out.push((h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255); });
    return out;
  }

  // ---------- starting records ----------
  // Built with the real sheet helpers (toRow_ and friends from Code.gs), dated relative to the first time the demo opens.
  function seed() {
    db = { sheets: {}, seededAt: new Date().toISOString() };
    cache = {};
    setup();
    var staff = db.sheets.Staff; staff.length = 1;
    USERS.forEach(function (u) { staff.push([u.id, u.name, u.role, u.pin, 'yes']); });

    var t = Date.now(), H = 3600e3, serial = {};
    var iso = function (hoursAgo) { return new Date(t - hoursAgo * H).toISOString(); };
    var ymd = function (d) { return Utilities.formatDate(d, 'Africa/Nairobi', 'yyMMdd'); };
    var NS = { moisture: 11.8, protein: 16.2, fat: 3.9, fibre: 8.4, ash: 7.1, starch: 28.5 };
    function sample(o) {
      var rec = new Date(t - o.ago * H), day = ymd(rec);
      serial[day] = (serial[day] || 0) + 1;
      var row = {
        id: 'AGL-' + day + '-' + ('00' + serial[day]).slice(-3), receivedAt: rec.toISOString(), status: o.status,
        clientName: o.client, clientPhone: '0712 000 ' + ('00' + serial[day]).slice(-3), clientType: o.ctype, clientArea: o.county,
        county: o.county, landmark: o.landmark, sampleType: o.stype, description: o.desc || '', sampledOn: '',
        tests: o.tests, express: false, channel: o.channel || 'Walk-in', agrovet: '', heardVia: o.heard || 'Agrovet', discount: 0,
        price: o.price, quoted: o.quoted || null, paid: !!o.paid, mpesa: o.paid ? 'DEMO' + serial[day] + day : '', consent: true,
        sampleState: o.wet ? 'wet' : 'dry', grinding: !!o.grind, packaging: o.pack || 'Brown khaki paper bag',
        consult: !!o.consult, consultFee: o.consult ? 500 : null,
        dueAt: new Date(rec.getTime() + (o.hours || 48) * H).toISOString(),
        disposeBy: new Date(rec.getTime() + 14 * 24 * H).toISOString(),
        createdBy: o.by || 'S4', notes: '', updatedBy: 'S4'
      };
      if (o.paid) row.paidAt = iso(o.ago - 0.3);
      var st = ['received', 'analysis', 'review', 'ready', 'reported'].indexOf(o.status);
      if (st >= 1) { row.startedAt = iso(o.ago - 1); row.batch = o.batch; }
      if (st >= 2) { row.analystId = 'S3'; row.analysedAt = iso(o.ago - 5); Object.keys(o.results || {}).forEach(function (k) { row[k] = o.results[k]; }); }
      if (st >= 3) { row.reviewerId = 'S2'; row.signedAt = iso(o.ago - 6); }
      if (st >= 4) { row.reportedAt = iso(Math.max(o.ago - 8, 0.5)); }
      if (o.consultDone) row.consultDoneAt = iso(Math.max(o.ago - 9, 0.4));
      if (o.disposed) { row.disposedAt = iso(o.ago - 13 * 24); row.disposedBy = 'S3'; }
      row.updatedAt = row.reportedAt || row.signedAt || row.analysedAt || row.startedAt || row.paidAt || row.receivedAt;
      sheet_('Samples').appendRow(toRow_('Samples', row));
    }
    var b = function (hoursAgo) { return 'B-' + ymd(new Date(t - hoursAgo * H)) + '-01'; };
    // Today and yesterday: work in progress for every role.
    sample({ ago: 1, status: 'received', client: 'Kandara Dairy Farmer', ctype: 'Dairy farmer', county: 'Murang’a', landmark: 'Near Kandara market', stype: 'Dairy meal or concentrate', tests: ['FS-01'], price: 5000, paid: false, grind: true, consult: true });
    sample({ ago: 1.5, status: 'received', client: 'Sunrise Peanut Butter Ltd', ctype: 'Peanut butter manufacturer or importer', county: 'Imported (outside Kenya)', landmark: 'Consignment at Thika warehouse', stype: 'Peanuts (groundnuts)', tests: ['OL-01', 'AF-01'], price: 4000, paid: true, grind: true, channel: 'Courier', heard: 'Google' });
    sample({ ago: 2, status: 'received', client: 'St. Mary’s Children’s Home', ctype: 'Children’s home', county: 'Kiambu', landmark: 'Opposite Gatundu hospital', stype: 'Flour', tests: ['AF-01'], price: 3000, paid: true, heard: 'Friend or neighbour' });
    sample({ ago: 3, status: 'received', client: 'Gakoe Silage Farmer', ctype: 'Dairy farmer', county: 'Kiambu', landmark: 'Gakoe tea centre', stype: 'Silage', tests: ['SM-01'], price: 800, quoted: 800, paid: true, wet: true, grind: true, pack: 'Sealed plastic bag', hours: 48, by: 'S5', channel: 'Pickup' });
    sample({ ago: 4, status: 'received', client: 'Kenol Primary School', ctype: 'School', county: 'Murang’a', landmark: 'Kenol town, behind the stage', stype: 'Maize or other grain', tests: ['AF-01'], price: 3000, paid: false, grind: true, by: 'S5', channel: 'Pickup' });
    sample({ ago: 5, status: 'analysis', batch: b(4), client: 'Githunguri Milk Co-operative', ctype: 'Milk co-operative', county: 'Kiambu', landmark: 'Githunguri cooler', stype: 'Raw milk', tests: ['AM-01'], price: 3000, paid: true, wet: true, pack: 'Bottle', channel: 'Pickup', heard: 'Co-operative' });
    sample({ ago: 6, status: 'analysis', batch: b(4), client: 'Thika Feeds Ltd', ctype: 'Feed miller', county: 'Kiambu', landmark: 'Thika industrial area', stype: 'Feed ingredient (bran, seed cake, soya, fishmeal)', tests: ['NS-01'], price: 2000, paid: true, grind: true, heard: 'Returning client' });
    sample({ ago: 20, status: 'review', batch: b(19), client: 'Mama Oliech Restaurant', ctype: 'Restaurant or caterer', county: 'Nairobi', landmark: 'Kilimani, Ring Road', stype: 'Maize or other grain', tests: ['AF-01'], price: 3000, paid: true, grind: true, results: { afb1: 7.4 }, heard: 'Facebook or TikTok' });
    sample({ ago: 22, status: 'review', batch: b(19), client: 'Kangema Poultry Farmer', ctype: 'Poultry, pig or fish farmer', county: 'Murang’a', landmark: 'Kangema stage', stype: 'Poultry feed', tests: ['PR-01'], price: 500, paid: true, grind: true, results: { protein: 14.1 }, consult: true });
    sample({ ago: 28, status: 'ready', batch: b(27), client: 'Kirinyaga Dairy Farmer', ctype: 'Dairy farmer', county: 'Kirinyaga', landmark: 'Kerugoya, near the church', stype: 'Dairy meal or concentrate', tests: ['FS-01'], price: 5000, paid: true, grind: true, results: Object.assign({}, NS, { afb1: 3.9 }), consult: true });
    // Earlier this month: reported, some due for disposal.
    sample({ ago: 52, status: 'reported', batch: b(51), client: 'Makuyu Agrovet', ctype: 'Agrovet', county: 'Murang’a', landmark: 'Makuyu town', stype: 'Poultry feed', tests: ['NS-01'], price: 2000, paid: true, grind: true, results: { moisture: 12.4, protein: 18.9, fat: 4.2, fibre: 5.1, ash: 6.3, starch: 35.0 } });
    sample({ ago: 75, status: 'reported', batch: b(74), client: 'Githunguri Milk Co-operative', ctype: 'Milk co-operative', county: 'Kiambu', landmark: 'Githunguri cooler', stype: 'Raw milk', tests: ['AM-01'], price: 3000, paid: true, wet: true, pack: 'Bottle', results: { afm1: 0.08 }, heard: 'Co-operative' });
    sample({ ago: 120, status: 'reported', batch: b(119), client: 'Thika Feeds Ltd', ctype: 'Feed miller', county: 'Kiambu', landmark: 'Thika industrial area', stype: 'Feed ingredient (bran, seed cake, soya, fishmeal)', tests: ['WC-01'], price: 4500, quoted: 4500, hours: 72, paid: true, grind: true, results: { moisture: 10.1, protein: 34.5, fat: 1.9, fibre: 12.0, ash: 6.6, starch: 4.2 } });
    sample({ ago: 190, status: 'reported', batch: b(189), client: 'Sagana Fish Farm', ctype: 'Poultry, pig or fish farmer', county: 'Kirinyaga', landmark: 'Sagana bridge', stype: 'Fish feed', tests: ['NS-01'], price: 2000, paid: true, grind: true, results: { moisture: 9.5, protein: 30.2, fat: 6.1, fibre: 4.0, ash: 9.8, starch: 18.0 }, consult: true, consultDone: true });
    sample({ ago: 300, status: 'reported', batch: b(299), client: 'Kenol Primary School', ctype: 'School', county: 'Murang’a', landmark: 'Kenol town, behind the stage', stype: 'Flour', tests: ['AF-01'], price: 3000, paid: true, results: { aft: 2.4 } });
    sample({ ago: 330, status: 'reported', batch: b(329), client: 'Kandara Dairy Farmer', ctype: 'Dairy farmer', county: 'Murang’a', landmark: 'Near Kandara market', stype: 'Dairy meal or concentrate', tests: ['FS-01'], price: 5000, paid: true, grind: true, results: Object.assign({}, NS, { afb1: 7.6 }) });
    sample({ ago: 400, status: 'reported', batch: b(399), client: 'Sunrise Peanut Butter Ltd', ctype: 'Peanut butter manufacturer or importer', county: 'Imported (outside Kenya)', landmark: 'Consignment at Thika warehouse', stype: 'Peanut butter', tests: ['AF-01'], price: 3000, paid: true, pack: 'Jar or tin', wet: true, results: { aft: 4.1 }, disposed: true });

    var now = new Date().toISOString();
    [['K1', 'Aflatoxin B1 ELISA kit', 'AFB1-2611', 62, 40, 120], ['K2', 'Total aflatoxin ELISA kit', 'AFT-2610', 30, 40, 90], ['K3', 'Aflatoxin M1 ELISA kit', 'AFM1-2609', 80, 40, 20]]
      .forEach(function (k) { sheet_('Stock').appendRow(toRow_('Stock', { id: k[0], item: k[1], lot: k[2], testsLeft: k[3], reorderAt: k[4], expiry: Utilities.formatDate(new Date(t + k[5] * 24 * H), '', 'yyyy-MM-dd'), addedAt: now, updatedAt: now, updatedBy: 'S2' })); });
    var yday = Utilities.formatDate(new Date(t - 24 * H), '', 'yyyy-MM-dd');
    sheet_('QC').appendRow(toRow_('QC', { date: yday, nir: 'pass', elisa: 'pass', fridgeMin: 3.1, fridgeMax: 6.2, notes: '', by: 'S2', at: iso(24) }));
    [[1, 'Kandara Dairy Farmer', 'Murang’a', 'Near Kandara market', 'Bringing a sample', 'Reception'],
     [3, 'Gakoe Silage Farmer', 'Kiambu', 'Gakoe tea centre', 'Nutritional consultation', 'Online'],
     [26, 'Sunrise Peanut Butter Ltd', 'Imported (outside Kenya)', 'Consignment at Thika warehouse', 'Enquiry', 'Reception']]
      .forEach(function (v, i) { sheet_('Visitors').appendRow(toRow_('Visitors', { id: 'V' + (i + 1), at: iso(v[0]), name: v[1], phone: '0712 000 10' + i, email: '', county: v[2], landmark: v[3], purpose: v[4], notes: '', source: v[5], by: v[5] === 'Reception' ? 'S4' : '' })); });
    save();
  }

  window.AGRILAB_LOCAL = function (req) {
    load();
    if (!db) seed();
    var out;
    try { out = JSON.parse(doPost({ postData: { contents: JSON.stringify(req) } })); }
    catch (e) { out = { ok: false, error: 'server_error', message: String(e && e.message || e) }; }
    save();
    return out;
  };
  window.AGRILAB_DEMO = {
    users: USERS.map(function (u) { return { name: u.name, role: u.role, pin: u.pin }; }),
    reset: function () { try { localStorage.removeItem(DB_KEY); localStorage.removeItem(CACHE_KEY); localStorage.removeItem('agrilab-ops-session'); } catch (e) {} }
  };
  window.AGRILAB_CONFIG = { apiUrl: 'offline-demo' };
})();
