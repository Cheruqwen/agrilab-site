/*
 * AgriLab offline demo backend.
 *
 * The demo build (demo/build-demo.js) puts this file, followed by apps-script/Code.gs, into the demo's ops/config.js.
 * It stands in for Google Sheets, CacheService and friends so the real Apps Script code runs inside the browser,
 * with every record kept in this browser's localStorage. Nothing leaves the computer.
 */
(function () {
  var DB_KEY = 'agrilab-demo-db', CACHE_KEY = 'agrilab-demo-cache';
  // Demo clients with portal access: one for each kind of portal page.
  var PORTAL_CLIENTS = [
    { name: 'Kandara Dairy Farmer', phone: '0711 100 001', pin: '1234', segment: 'farmer' },
    { name: 'Githunguri Milk Co-operative', phone: '0711 100 002', pin: '2345', segment: 'aggregator' },
    { name: 'Kenol Primary School', phone: '0711 100 003', pin: '3456', segment: 'consumer' },
    { name: 'Sunrise Peanut Butter Ltd', phone: '0711 100 004', pin: '4567', segment: 'trade' }
  ];
  // Demo team. Titles are placeholders. "now" is today's team; "later" are planned hires.
  var USERS = [
    { id: 'S1', name: 'Lawrence Maina', role: 'director', pin: '1111', team: 'now' },
    { id: 'S2', name: 'Mwangi', role: 'lab_manager', pin: '2222', team: 'now' },
    { id: 'S3', name: 'Fidelia', role: 'lab_technician', pin: '3333', team: 'now' },
    { id: 'S4', name: 'Alfred', role: 'sales_marketing', pin: '6666', team: 'now' },
    { id: 'S5', name: 'Grace Wanjiru', role: 'nutritionist', pin: '8888', team: 'now' },
    { id: 'S6', name: 'Brian Otieno', role: 'field_officer', pin: '5555', team: 'now' },
    { id: 'S7', name: 'Mary Njeri', role: 'client_desk', pin: '4444', team: 'later' },
    { id: 'S8', name: 'Peter Kamau', role: 'analyst', pin: '7777', team: 'later' }
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
    var clientIds = {}, clientCount = 0;
    function clientFor(o, recIso) {
      if (clientIds[o.client]) return clientIds[o.client];
      var pc = PORTAL_CLIENTS.filter(function (c) { return c.name === o.client; })[0];
      var id = 'C' + (++clientCount);
      var c = { id: id, name: o.client, phone: pc ? pc.phone : '0712 200 ' + ('00' + clientCount).slice(-3), email: '', type: o.ctype, segment: segmentOf_(o.ctype),
        county: o.county, landmark: o.landmark, pin: pc ? hashPin_(pc.pin, id) : '', portal: !!pc, since: recIso, createdAt: recIso, updatedAt: recIso, updatedBy: 'S3' };
      sheet_('Clients').appendRow(toRow_('Clients', c));
      clientIds[o.client] = { id: id, phone: c.phone };
      return clientIds[o.client];
    }
    // Farm elements for the portal clients' samples that don't name one.
    function defaultElement(o) {
      if (o.client === 'Kandara Dairy Farmer') return o.stype === 'Silage' ? 'Silage pit 1' : 'Dairy meal – Brand A';
      if (o.client === 'Githunguri Milk Co-operative') return o.stype === 'Raw milk' ? 'Bulk cooler' : 'Supplier: Thika Feeds dairy meal';
      if (o.client === 'Kenol Primary School') return o.stype === 'Flour' ? 'Maize flour – Supplier A' : 'Maize grain – Supplier B';
      if (o.client === 'Sunrise Peanut Butter Ltd') return o.stype === 'Peanut butter' ? 'Own product – peanut butter' : 'Lot MW-2611-03';
      return '';
    }
    // Feed or food for each demo sample, and which animal the feed is for.
    function useOf(o) {
      var food = ['Flour', 'Peanuts (groundnuts)', 'Peanut butter', 'Raw milk', 'Processed milk', 'Milk powder'].indexOf(o.stype) >= 0
        || ['School', 'Restaurant or caterer', 'Children’s home', 'Peanut butter manufacturer or importer'].indexOf(o.ctype) >= 0;
      if (food) return { purpose: 'food', animal: '' };
      var byType = { 'Dairy meal or concentrate': 'Dairy cattle', 'Poultry feed': 'Poultry', 'Pig feed': 'Pigs', 'Fish feed': 'Fish', 'Silage': 'Dairy cattle', 'Hay or fodder': 'Dairy cattle' };
      var byClient = { 'Dairy farmer': 'Dairy cattle', 'Milk co-operative': 'Dairy cattle', 'Poultry, pig or fish farmer': o.stype === 'Fish feed' ? 'Fish' : 'Poultry', 'Feed miller': 'Dairy cattle', 'Agrovet': 'Poultry' };
      return { purpose: 'feed', animal: byType[o.stype] || byClient[o.ctype] || 'Dairy cattle' };
    }
    function sample(o) {
      var rec = new Date(t - o.ago * H), day = ymd(rec);
      serial[day] = (serial[day] || 0) + 1;
      var row = {
        id: 'AGL-' + day + '-' + ('00' + serial[day]).slice(-3), receivedAt: rec.toISOString(), status: o.status,
        clientName: o.client, clientPhone: '', clientType: o.ctype, clientArea: o.county, element: o.element || defaultElement(o),
        county: o.county, landmark: o.landmark, sampleType: o.stype, description: o.desc || '', sampledOn: '',
        tests: o.tests, express: false, channel: o.channel || 'Walk-in', agrovet: '', heardVia: o.heard || 'Agrovet', discount: 0,
        price: o.price, quoted: o.quoted || null, paid: !!o.paid, mpesa: o.paid ? 'DEMO' + serial[day] + day : '', consent: true,
        purpose: useOf(o).purpose, animal: useOf(o).animal,
        sampleState: o.wet ? 'wet' : 'dry', grinding: !!o.grind, packaging: o.pack || 'Brown khaki paper bag',
        consult: !!o.consult, consultFee: o.consult ? 500 : null,
        dueAt: new Date(rec.getTime() + (o.hours || 48) * H).toISOString(),
        disposeBy: new Date(rec.getTime() + 14 * 24 * H).toISOString(),
        createdBy: o.by || 'S3', notes: '', updatedBy: 'S3'
      };
      var cl = clientFor(o, rec.toISOString()); row.clientId = cl.id; row.clientPhone = cl.phone;
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
    sample({ ago: 1, status: 'received', element: 'Dairy meal – Brand A', client: 'Kandara Dairy Farmer', ctype: 'Dairy farmer', county: 'Murang’a', landmark: 'Near Kandara market', stype: 'Dairy meal or concentrate', tests: ['FS-01'], price: 5000, paid: false, grind: true, consult: true });
    sample({ ago: 1.5, status: 'received', element: 'Lot MW-2611-03', client: 'Sunrise Peanut Butter Ltd', ctype: 'Peanut butter manufacturer or importer', county: 'Imported (outside Kenya)', landmark: 'Consignment at Thika warehouse', stype: 'Peanuts (groundnuts)', tests: ['OL-01', 'AF-01'], price: 4000, paid: true, grind: true, channel: 'Courier', heard: 'Google' });
    sample({ ago: 2, status: 'received', client: 'St. Mary’s Children’s Home', ctype: 'Children’s home', county: 'Kiambu', landmark: 'Opposite Gatundu hospital', stype: 'Flour', tests: ['AF-01'], price: 3000, paid: true, heard: 'Friend or neighbour' });
    sample({ ago: 3, status: 'received', client: 'Gakoe Silage Farmer', ctype: 'Dairy farmer', county: 'Kiambu', landmark: 'Gakoe tea centre', stype: 'Silage', tests: ['SM-01'], price: 800, quoted: 800, paid: true, wet: true, grind: true, pack: 'Sealed plastic bag', hours: 48, by: 'S6', channel: 'Pickup' });
    sample({ ago: 4, status: 'received', element: 'Maize grain – Supplier B', client: 'Kenol Primary School', ctype: 'School', county: 'Murang’a', landmark: 'Kenol town, behind the stage', stype: 'Maize or other grain', tests: ['AF-01'], price: 3000, paid: false, grind: true, by: 'S6', channel: 'Pickup' });
    sample({ ago: 5, element: 'Bulk cooler', status: 'analysis', batch: b(4), client: 'Githunguri Milk Co-operative', ctype: 'Milk co-operative', county: 'Kiambu', landmark: 'Githunguri cooler', stype: 'Raw milk', tests: ['AM-01'], price: 3000, paid: true, wet: true, pack: 'Bottle', channel: 'Pickup', heard: 'Co-operative' });
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

    // Older, reported history for the four portal clients, so each portal page has trends to show.
    var seedN = 7; var rnd = function () { seedN = (seedN * 16807) % 2147483647; return (seedN - 1) / 2147483646; };
    var r1 = function (a, b) { return Math.round((a + rnd() * (b - a)) * 10) / 10; };
    var r2 = function (a, b) { return Math.round((a + rnd() * (b - a)) * 100) / 100; };
    var hist = function (o) { o.status = 'reported'; o.paid = true; o.disposed = true; o.batch = b(o.ago - 1); sample(o); };
    var FARM = { client: 'Kandara Dairy Farmer', ctype: 'Dairy farmer', county: 'Murang’a', landmark: 'Near Kandara market' };
    for (var w = 0; w < 8; w++) {
      var ago = (240 - w * 30) * 24 + 5;
      hist(Object.assign({}, FARM, { ago: ago, element: 'Dairy meal – Brand A', stype: 'Dairy meal or concentrate', tests: ['FS-01'], price: 5000, grind: true,
        results: { moisture: r1(11.5, 14.2), protein: r1(12.8, 15.5), fat: r1(4.5, 7.8), fibre: r1(8, 11), ash: r1(6, 8), starch: r1(25, 32), afb1: r1(1, 6.5) } }));
      if (w % 2 === 0) hist(Object.assign({}, FARM, { ago: ago - 30, element: 'Dairy meal – Brand B', stype: 'Dairy meal or concentrate', tests: ['FS-01'], price: 5000, grind: true,
        results: { moisture: r1(10.5, 12.5), protein: r1(16, 17.8), fat: r1(3, 4.5), fibre: r1(7, 9), ash: r1(6, 7.5), starch: r1(27, 31), afb1: r1(0.5, 3) } }));
      if (w % 2 === 1) hist(Object.assign({}, FARM, { ago: ago - 50, element: 'Silage pit 1', stype: 'Silage', tests: ['SM-01'], price: 800, quoted: 800, wet: true, grind: true, pack: 'Sealed plastic bag',
        results: { moisture: r1(62, 80) } }));
    }
    var COOP = { client: 'Githunguri Milk Co-operative', ctype: 'Milk co-operative', county: 'Kiambu', landmark: 'Githunguri cooler' };
    var members = [['Member 104 – Kamau', 0.03, 0.25], ['Member 117 – Wairimu', 0.02, 0.18], ['Member 131 – Njoroge', 0.2, 0.75], ['Bulk cooler', 0.05, 0.35]];
    for (var mth = 0; mth < 6; mth++) {
      members.forEach(function (m, i) {
        hist(Object.assign({}, COOP, { ago: (180 - mth * 30 - i * 3) * 24 + 4, element: m[0], stype: 'Raw milk', tests: ['AM-01'], price: 3000, wet: true, pack: 'Bottle', results: { afm1: r2(m[1], m[2]) } }));
      });
      hist(Object.assign({}, COOP, { ago: (170 - mth * 30) * 24 + 6, element: 'Supplier: Thika Feeds dairy meal', stype: 'Dairy meal or concentrate', tests: ['FS-01'], price: 5000, grind: true,
        results: { moisture: r1(10.5, 13.8), protein: r1(14.5, 17.5), fat: r1(3, 5), fibre: r1(7, 10), ash: r1(6, 8), starch: r1(26, 31), afb1: r1(1, 5.8) } }));
    }
    var SCHOOL = { client: 'Kenol Primary School', ctype: 'School', county: 'Murang’a', landmark: 'Kenol town, behind the stage' };
    for (var q = 0; q < 6; q++) {
      hist(Object.assign({}, SCHOOL, { ago: (200 - q * 30) * 24 + 3, element: 'Maize flour – Supplier A', stype: 'Flour', tests: ['AF-01'], price: 3000, results: { aft: r1(1, 6) } }));
      hist(Object.assign({}, SCHOOL, { ago: (215 - q * 30) * 24 + 3, element: 'Maize grain – Supplier B', stype: 'Maize or other grain', tests: ['AF-01'], price: 3000, grind: true, results: { aft: r1(2, 8.5) } }));
      if (q % 2 === 0) hist(Object.assign({}, SCHOOL, { ago: (190 - q * 30) * 24 + 3, element: 'Groundnuts – Kenol market', stype: 'Peanuts (groundnuts)', tests: ['AF-01'], price: 3000, grind: true, results: { aft: q === 4 ? 14.6 : r1(3, 8) } }));
    }
    hist(Object.assign({}, SCHOOL, { ago: 45 * 24, element: 'Milk – Kenol Dairies', stype: 'Processed milk', tests: ['AM-01'], price: 3000, wet: true, pack: 'Bottle', results: { afm1: 0.06 } }));
    var TRADE = { client: 'Sunrise Peanut Butter Ltd', ctype: 'Peanut butter manufacturer or importer', county: 'Imported (outside Kenya)', landmark: 'Thika warehouse' };
    var lots = [['Lot MW-2604-01', 1.2, 2.9], ['Lot TZ-2605-02', 3.4, 6.8], ['Lot MW-2606-01', 0.8, 1.9], ['Lot TZ-2607-01', 6.1, 12.4], ['Lot MW-2608-02', 1.5, 3.1], ['Lot ZM-2609-01', 2.6, 5.2], ['Lot MW-2610-01', 1.1, 2.4], ['Lot TZ-2611-01', 4.4, 8.9]];
    lots.forEach(function (l, i) {
      hist(Object.assign({}, TRADE, { ago: (230 - i * 28) * 24 + 2, element: l[0], stype: 'Peanuts (groundnuts)', tests: ['AF-02', 'OL-01'], price: 5000, grind: true, results: { afb1: l[1], aft: l[2], fat: r1(46, 51) } }));
    });

    // A miller who used to test regularly and stopped: shows on the Marketing win-back list.
    var MILL = { client: 'Maragua Feed Millers', ctype: 'Feed miller', county: 'Murang’a', landmark: 'Maragua town', heard: 'Radio' };
    [190, 160, 130, 100].forEach(function (d) { hist(Object.assign({}, MILL, { ago: d * 24, element: 'Incoming maize', stype: 'Maize or other grain', tests: ['FS-01'], price: 5000, grind: true, results: { moisture: r1(12, 14.5), protein: r1(8, 9.5), fat: r1(3.5, 4.5), fibre: r1(2, 3), ash: r1(1.2, 1.8), starch: r1(60, 68), afb1: r1(1, 6) } })); });

    var now = new Date().toISOString();
    var ym = function (monthsAgo) { var d = new Date(t); d.setUTCDate(15); d.setUTCMonth(d.getUTCMonth() - monthsAgo); return Utilities.formatDate(d, '', 'yyyy-MM'); };
    var plan = function (id, client, name, fee, quota, extra, monthsAgo, paidMonths) {
      var cid = clientIds[client].id;
      sheet_('Subscriptions').appendRow(toRow_('Subscriptions', { id: id, clientId: cid, plan: name, fee: fee, quota: quota, extraDiscount: extra, status: 'active',
        start: ym(monthsAgo) + '-01', paidThrough: paidMonths.length ? ym(paidMonths[paidMonths.length - 1]) : '', notes: '', createdAt: iso(monthsAgo * 730), updatedAt: now, updatedBy: 'S4' }));
      paidMonths.forEach(function (m, i) { sheet_('SubPayments').appendRow(toRow_('SubPayments', { id: id + '-' + i, subscriptionId: id, clientId: cid, month: ym(m), amount: fee, mpesa: 'DEMOPLAN' + i, at: iso(m * 730 + 48), by: 'S3' })); });
    };
    plan('P1', 'Githunguri Milk Co-operative', 'Standard', 45000, 20, 5, 3, [3, 2, 1, 0]);
    plan('P2', 'Sunrise Peanut Butter Ltd', 'Starter', 25000, 10, 0, 2, [2, 1]);
    // The co-op's samples this month were covered by its plan.
    var H_ = SHEETS.Samples, ci = H_.indexOf('clientId'), ri = H_.indexOf('receivedAt'), si = H_.indexOf('subscriptionId'), pi = H_.indexOf('price'), mi = H_.indexOf('mpesa');
    db.sheets.Samples.slice(1).forEach(function (r) { if (r[ci] === clientIds['Githunguri Milk Co-operative'].id && Utilities.formatDate(new Date(r[ri]), '', 'yyyy-MM') === ym(0)) { r[si] = 'P1'; r[pi] = '0'; r[mi] = 'PLAN'; } });
    [['K1', 'Aflatoxin B1 ELISA kit', 'AFB1-2611', 62, 40, 120], ['K2', 'Total aflatoxin ELISA kit', 'AFT-2610', 30, 40, 90], ['K3', 'Aflatoxin M1 ELISA kit', 'AFM1-2609', 80, 40, 20]]
      .forEach(function (k) { sheet_('Stock').appendRow(toRow_('Stock', { id: k[0], item: k[1], lot: k[2], testsLeft: k[3], reorderAt: k[4], expiry: Utilities.formatDate(new Date(t + k[5] * 24 * H), '', 'yyyy-MM-dd'), addedAt: now, updatedAt: now, updatedBy: 'S2' })); });
    var yday = Utilities.formatDate(new Date(t - 24 * H), '', 'yyyy-MM-dd');
    sheet_('QC').appendRow(toRow_('QC', { date: yday, nir: 'pass', elisa: 'pass', fridgeMin: 3.1, fridgeMax: 6.2, notes: '', by: 'S2', at: iso(24) }));
    [[1, 'Kandara Dairy Farmer', 'Murang’a', 'Near Kandara market', 'Bringing a sample', 'Reception'],
     [3, 'Gakoe Silage Farmer', 'Kiambu', 'Gakoe tea centre', 'Nutritional consultation', 'Online'],
     [26, 'Sunrise Peanut Butter Ltd', 'Imported (outside Kenya)', 'Consignment at Thika warehouse', 'Enquiry', 'Reception']]
      .forEach(function (v, i) { sheet_('Visitors').appendRow(toRow_('Visitors', { id: 'V' + (i + 1), at: iso(v[0]), name: v[1], phone: clientIds[v[1]] ? clientIds[v[1]].phone : '0712 000 10' + i, email: '', county: v[2], landmark: v[3], purpose: v[4], notes: '', source: v[5], by: v[5] === 'Reception' ? 'S3' : '' })); });
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
    users: USERS.map(function (u) { return { name: u.name, role: u.role, pin: u.pin, team: u.team }; }),
    clients: PORTAL_CLIENTS.map(function (c) { return { name: c.name, phone: c.phone, pin: c.pin, segment: c.segment }; }),
    reset: function () { try { localStorage.removeItem(DB_KEY); localStorage.removeItem(CACHE_KEY); localStorage.removeItem('agrilab-ops-session'); localStorage.removeItem('agrilab-portal-session'); } catch (e) {} }
  };
  window.AGRILAB_CONFIG = { apiUrl: 'offline-demo' };
})();
