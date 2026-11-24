/* שעת נחת – לוגיקת האתר (ללא שרת). ההגדרות ב-config.js */
(function () {
  'use strict';
  var cfg = window.NACHAT_CONFIG;
  if (!cfg) return;

  var WD = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  var WD_S = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  var DUR = { 1: 'שעה', 2: 'שעתיים', 3: '3 שעות' };
  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var ymd = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var hhmm = function (h) { return pad(h) + ':00'; };
  // עוטף טווח שעות/מספרים כדי שלא יתהפך בטקסט עברי
  var ltr = function (s) { return '\u2066' + s + '\u2069'; };
  var range = function (a, b) { return ltr(hhmm(a) + '–' + hhmm(b)); };
  var waLink = function (text) { return 'https://wa.me/' + cfg.whatsapp + '?text=' + encodeURIComponent(text); };

  /* ---------- schedule: weekly hours + date exceptions ---------- */
  // weekly[0..6] = { open, start, end }; exceptions['YYYY-MM-DD'] = { open, start, end }
  var weekly = [];
  for (var w = 0; w < 7; w++) {
    weekly.push({ open: cfg.openDays.indexOf(w) !== -1, start: cfg.hours.start, end: cfg.hours.end });
  }
  var exceptions = {};
  (cfg.closedDates || []).forEach(function (d) { exceptions[d] = { open: false }; });

  function dayHours(date) {
    var ex = exceptions[ymd(date)];
    if (ex) {
      if (!ex.open) return null;
      var base = weekly[date.getDay()];
      var st = ex.start != null ? ex.start : base.start, en = ex.end != null ? ex.end : base.end;
      return st < en ? { start: st, end: en } : null;
    }
    var wk = weekly[date.getDay()];
    return wk.open && wk.start < wk.end ? { start: wk.start, end: wk.end } : null;
  }

  function slotsFor(date, now) {
    var hrs = dayHours(date);
    if (!hrs) return [];
    var out = [];
    for (var dur = 1; dur <= cfg.maxHours; dur++) {
      for (var h = hrs.start; h + dur <= hrs.end; h++) {
        var startAt = new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, 0, 0);
        if (startAt - now < cfg.minNoticeMinutes * 60000) continue;
        var price = cfg.prices[dur];
        if (price == null) continue;
        out.push({ key: h + '-' + dur, start: h, end: h + dur, dur: dur, price: price });
      }
    }
    return out;
  }

  function openDays(now) {
    var list = [];
    var base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (var i = 0; i < cfg.bookAheadDays; i++) {
      var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
      if (!slotsFor(d, now).length) continue;
      list.push({ date: d, key: ymd(d), offset: i });
    }
    return list;
  }

  function dayRange() {
    var ds = [];
    weekly.forEach(function (wk, i) { if (wk.open) ds.push(i); });
    if (!ds.length) return 'בתיאום מראש';
    var contiguous = ds.every(function (v, i) { return i === 0 || v === ds[i - 1] + 1; });
    if (contiguous && ds.length > 2) return 'ימים ' + WD_S[ds[0]] + '–' + WD_S[ds[ds.length - 1]];
    return 'ימים ' + ds.map(function (d) { return WD_S[d]; }).join(', ');
  }
  function hoursSummary() {
    var open = weekly.filter(function (wk) { return wk.open; });
    if (!open.length) return 'בבקרים';
    var same = open.every(function (wk) { return wk.start === open[0].start && wk.end === open[0].end; });
    return same ? range(open[0].start, open[0].end) : 'שעות משתנות לפי היום';
  }

  /* ---------- Google Sheet (gviz JSONP, no backend) ---------- */
  function gviz(gid) {
    return new Promise(function (resolve, reject) {
      var cb = '__nachat' + gid + '_' + Date.now();
      var s = document.createElement('script');
      var timer = setTimeout(function () { done(); reject(new Error('timeout')); }, 7000);
      function done() { clearTimeout(timer); try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (s.parentNode) s.parentNode.removeChild(s); }
      window[cb] = function (res) { done(); res && res.status !== 'error' ? resolve(res.table) : reject(new Error('sheet')); };
      s.onerror = function () { done(); reject(new Error('load')); };
      s.src = 'https://docs.google.com/spreadsheets/d/' + cfg.scheduleSheetId + '/gviz/tq?gid=' + gid +
        '&headers=1&tqx=' + encodeURIComponent('out:json;responseHandler:' + cb) + '&_=' + Date.now();
      document.head.appendChild(s);
    });
  }
  function cellV(row, i) { var c = row && row.c && row.c[i]; return c ? c.v : null; }
  function toHour(v) {
    if (v == null || v === '') return null;
    if (Array.isArray(v)) return v[0];
    if (typeof v === 'number') return v < 1 ? Math.round(v * 24) : Math.floor(v);
    var m = String(v).match(/(\d{1,2})/);
    return m ? parseInt(m[1], 10) : null;
  }
  function toBool(v) { return v === true || v === 'TRUE' || v === 'true' || v === 'כן' || v === 'V' || v === 'v'; }
  function toYmd(v) {
    if (v == null) return null;
    var m = String(v).match(/Date\((\d+),(\d+),(\d+)/);
    if (m) return m[1] + '-' + pad(+m[2] + 1) + '-' + pad(+m[3]);
    m = String(v).match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
    if (m) return m[3] + '-' + pad(+m[2]) + '-' + pad(+m[1]);
    m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[0] : null;
  }
  function validHours(a, b) { return a != null && b != null && a >= 0 && b <= 24 && a < b; }

  function applySheet(weekTable, exTable) {
    if (weekTable && weekTable.rows && weekTable.rows.length) {
      weekTable.rows.forEach(function (r, i) {
        var name = String(cellV(r, 0) || '').trim();
        var idx = WD.indexOf(name);
        if (idx === -1) idx = i;
        if (idx > 6) return;
        var st = toHour(cellV(r, 2)), en = toHour(cellV(r, 3));
        weekly[idx] = { open: toBool(cellV(r, 1)) && validHours(st, en), start: st, end: en };
      });
    }
    if (exTable && exTable.rows) {
      exTable.rows.forEach(function (r) {
        var key = toYmd(cellV(r, 0));
        if (!key) return;
        var open = toBool(cellV(r, 1));
        var st = toHour(cellV(r, 2)), en = toHour(cellV(r, 3));
        exceptions[key] = open ? { open: true, start: st, end: en } : { open: false };
      });
    }
  }

  /* ---------- static fill ---------- */
  document.querySelectorAll('[data-cfg]').forEach(function (el) {
    var v = cfg[el.getAttribute('data-cfg')];
    if (v != null) el.textContent = v;
  });
  document.querySelectorAll('[data-wa="general"]').forEach(function (a) {
    a.href = waLink('היי ' + cfg.ownerName + ', אשמח לשמוע על ' + cfg.businessName);
  });
  function renderHoursText() {
    $('f-hours').textContent = hoursSummary();
    $('f-days').textContent = dayRange();
    $('foot-hours').textContent = dayRange() + ', ' + hoursSummary();
  }
  renderHoursText();
  $('p1').textContent = cfg.prices[1];
  if (cfg.prices[2]) {
    $('p2').textContent = cfg.prices[2];
    $('p2h').textContent = Math.round(cfg.prices[2] / 2);
  }

  if (cfg.photos && cfg.photos.length) {
    $('gallery-grid').innerHTML = cfg.photos.map(function (p) {
      return '<figure><img src="' + p.src + '" alt="' + p.caption + '" loading="lazy"><figcaption>' + p.caption + '</figcaption></figure>';
    }).join('');
    $('gallery').hidden = false;
  }

  /* ---------- form ---------- */
  var form = $('book-form');
  var daysEl = $('days');
  var slotsEl = $('slots');
  var ageEl = $('age');
  var state = { day: null, slot: null };
  var days = [];

  for (var m = 3; m <= 12; m++) {
    var o = document.createElement('option');
    o.value = m;
    o.textContent = m === 12 ? 'שנה' : m + ' חודשים';
    ageEl.appendChild(o);
  }

  try {
    var saved = JSON.parse(localStorage.getItem('nachat-last') || 'null');
    if (saved) {
      $('parent').value = saved.parent || '';
      $('baby').value = saved.baby || '';
      if (saved.age) ageEl.value = saved.age;
      if (saved.parent) $('first').checked = false;
    }
  } catch (e) { /* storage unavailable */ }

  function dayLabel(d) {
    return 'יום ' + WD[d.date.getDay()] + ' ' + d.date.getDate() + '.' + (d.date.getMonth() + 1);
  }

  function renderDays() {
    days = openDays(new Date());
    if (!days.length) {
      daysEl.innerHTML = '<p class="slots-empty">אין כרגע ימים פתוחים לשריון. כתבו לי בוואטסאפ ונמצא זמן.</p>';
      return;
    }
    daysEl.innerHTML = days.map(function (d, i) {
      var tag = d.offset === 0 ? 'היום' : d.offset === 1 ? 'מחר' : '';
      var id = 'd-' + d.key;
      return '<div class="opt day"><input type="radio" name="day" id="' + id + '" value="' + d.key + '"' + (i === 0 ? ' checked' : '') + '>' +
        '<label for="' + id + '"><span class="wd">' + WD_S[d.date.getDay()] + '</span><span class="dt">' +
        d.date.getDate() + '.' + (d.date.getMonth() + 1) + '</span>' + (tag ? '<span class="tag">' + tag + '</span>' : '') + '</label></div>';
    }).join('');
    state.day = days[0];
    renderSlots();
  }

  function renderSlots() {
    if (!state.day) { slotsEl.innerHTML = ''; return; }
    var list = slotsFor(state.day.date, new Date());
    if (state.slot && !list.some(function (s) { return s.key === state.slot.key; })) state.slot = null;
    slotsEl.innerHTML = list.map(function (s) {
      var id = 's-' + s.key;
      var meta = s.dur === 1 ? DUR[1] : DUR[s.dur] + ' רצופות · ' + Math.round(s.price / s.dur) + ' ₪ לשעה';
      return '<div class="opt slot"><input type="radio" name="slot" id="' + id + '" value="' + s.key + '"' +
        (state.slot && state.slot.key === s.key ? ' checked' : '') + '>' +
        '<label for="' + id + '"><span class="time">' + hhmm(s.start) + '–' + hhmm(s.end) + '</span>' +
        '<span class="meta">' + meta + '</span><span class="price-tag">' + s.price + ' ₪</span></label></div>';
    }).join('');
    slotsEl._list = list;
    updateSummary();
  }

  function updateSummary() {
    if (state.day && state.slot) {
      $('sum-total').textContent = state.slot.price + ' ₪';
      $('sum-detail').textContent = dayLabel(state.day) + ' · ' + range(state.slot.start, state.slot.end);
    } else {
      $('sum-total').textContent = '—';
      $('sum-detail').textContent = state.day ? 'בחרו שעות' : 'בחרו יום ושעות';
    }
  }

  daysEl.addEventListener('change', function (e) {
    state.day = days.filter(function (d) { return d.key === e.target.value; })[0] || null;
    $('err-day').hidden = true;
    renderSlots();
  });
  slotsEl.addEventListener('change', function (e) {
    state.slot = (slotsEl._list || []).filter(function (s) { return s.key === e.target.value; })[0] || null;
    $('err-slot').hidden = true;
    updateSummary();
  });
  ['parent', 'baby', 'age'].forEach(function (id) {
    $(id).addEventListener('input', function () { setInvalid($(id), false); });
  });

  function setInvalid(input, bad) {
    var f = input.closest('.field');
    f.classList.toggle('invalid', bad);
    f.querySelector('.err').hidden = !bad;
  }

  function buildMessage(b) {
    var lines = [
      'היי ' + cfg.ownerName + ', אשמח לשריין מקום ב' + cfg.businessName + ' 💛',
      '📅 ' + dayLabel(b.day),
      '🕙 ' + range(b.slot.start, b.slot.end) + ' (' + DUR[b.slot.dur] + ')',
      '👶 ' + b.baby + ', ' + (b.age === '12' ? 'בן/בת שנה' : 'בן/בת ' + b.age + ' חודשים'),
      '🙋 ' + b.parent,
      '💳 סה״כ ' + b.slot.price + ' ₪'
    ];
    if (b.first) lines.push('✨ זו הפעם הראשונה שלנו');
    if (b.note) lines.push('📝 ' + b.note);
    return lines.join('\n');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var ok = true, firstBad = null;
    if (!state.day) { $('err-day').hidden = false; ok = false; firstBad = firstBad || daysEl; }
    if (!state.slot) { $('err-slot').hidden = false; ok = false; firstBad = firstBad || slotsEl; }
    ['parent', 'baby', 'age'].forEach(function (id) {
      var bad = !$(id).value.trim();
      setInvalid($(id), bad);
      if (bad) { ok = false; firstBad = firstBad || $(id); }
    });
    if (!ok) {
      firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (firstBad.focus) firstBad.focus({ preventScroll: true });
      return;
    }
    var b = {
      day: state.day, slot: state.slot,
      parent: $('parent').value.trim(), baby: $('baby').value.trim(), age: ageEl.value,
      first: $('first').checked, note: $('note').value.trim()
    };
    try { localStorage.setItem('nachat-last', JSON.stringify({ parent: b.parent, baby: b.baby, age: b.age })); } catch (err) { /* ignore */ }
    var url = waLink(buildMessage(b));
    showDone(b, url);
    window.open(url, '_blank', 'noopener');
  });

  function showDone(b, url) {
    $('wa-again').href = url;
    $('done-sum').innerHTML =
      '<strong>' + dayLabel(b.day) + ' · <bdi dir="ltr">' + hhmm(b.slot.start) + '–' + hhmm(b.slot.end) + '</bdi></strong>' +
      '<span>' + esc(b.baby) + ' · ' + DUR[b.slot.dur] + ' · ' + b.slot.price + ' ₪</span>';
    var pay;
    if (b.first) {
      pay = '<h4>ביקור ראשון: משלמים בסוף</h4><p>אין צורך לשלם עכשיו. בסוף הביקור מעבירים <b>' + b.slot.price +
        ' ₪</b> בביט או בפייבוקס למספר <span class="pay-num">' + cfg.phoneDisplay + '</span>.</p>';
    } else {
      pay = '<h4>תשלום אחרי האישור</h4>' +
        '<p>כשאאשר בוואטסאפ, מעבירים בביט או בפייבוקס כדי לשמור את המקום. ביטול ללא חיוב עד ' + cfg.cancelHours + ' שעות לפני.</p>' +
        '<div class="pay-amount">' + b.slot.price + ' ₪</div>' +
        '<p>למספר <span class="pay-num">' + cfg.phoneDisplay + '</span> (' + cfg.ownerName + ')</p>' +
        '<div class="pay-row">' +
        '<button type="button" class="btn btn-teal" data-copy="' + cfg.payPhone + '" data-msg="המספר הועתק. פתחו את ביט או פייבוקס והדביקו">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-copy"></use></svg>העתקת מספר לתשלום</button>' +
        (cfg.payboxLink ? '<a class="btn btn-line" href="' + cfg.payboxLink + '" target="_blank" rel="noopener">תשלום בפייבוקס</a>' : '') +
        '</div>';
    }
    $('pay').innerHTML = pay;
    form.hidden = true;
    $('done').hidden = false;
    $('done').focus({ preventScroll: true });
    $('book').scrollIntoView({ behavior: 'smooth' });
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  $('again').addEventListener('click', function () {
    $('done').hidden = true;
    form.hidden = false;
    state.slot = null;
    renderDays();
    $('book').scrollIntoView({ behavior: 'smooth' });
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-copy]');
    if (!btn) return;
    copy(btn.getAttribute('data-copy')).then(function () { toast(btn.getAttribute('data-msg') || 'הועתק'); });
  });

  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    var t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(t);
  }
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  if (cfg.scheduleSheetId) {
    daysEl.innerHTML = '<p class="slots-empty">טוען ימים פנויים…</p>';
    Promise.all([gviz(0).catch(function () { return null; }), gviz(1).catch(function () { return null; })])
      .then(function (t) { applySheet(t[0], t[1]); })
      .catch(function () { /* fall back to config */ })
      .then(function () { renderHoursText(); renderDays(); });
  } else {
    renderDays();
  }

  /* ---------- mobile dock ---------- */
  var dock = $('dock');
  if ('IntersectionObserver' in window) {
    var heroGone = false, bookVisible = false, footVisible = false;
    var sync = function () { dock.classList.toggle('show', heroGone && !bookVisible && !footVisible); };
    new IntersectionObserver(function (en) { heroGone = !en[0].isIntersecting; sync(); }).observe(document.querySelector('.hero'));
    new IntersectionObserver(function (en) { bookVisible = en[0].isIntersecting; sync(); }, { threshold: 0.05 }).observe($('book'));
    new IntersectionObserver(function (en) { footVisible = en[0].isIntersecting; sync(); }).observe(document.querySelector('.foot'));
  }

  /* ---------- install (PWA) ---------- */
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var deferred = null;
  if (!standalone) {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      $('install').hidden = false;
    });
    if (isIOS) {
      $('install').hidden = false;
      $('install-btn').hidden = true;
      $('install-text').textContent = 'באייפון: כפתור השיתוף בספארי ואז "הוספה למסך הבית".';
    }
  }
  $('install-btn').addEventListener('click', function () {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.finally(function () { deferred = null; $('install').hidden = true; });
  });

  if (/[?&]book=1/.test(location.search) || location.hash === '#book') {
    setTimeout(function () { $('book').scrollIntoView(); }, 60);
  }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  window.__nachat = { slotsFor: slotsFor, openDays: openDays, buildMessage: buildMessage, applySheet: applySheet, weekly: weekly, exceptions: exceptions };
})();
