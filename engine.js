/* Interactive Notebook engine.
   - Teacher: draws with the palette, flips flaps; every change is sent to the server.
   - Student: sees the teacher's ink and flaps live (polling), can peek under flaps locally.
   Spread files call NB.registerSpread({...}) — see Spread_56_57.html for the format. */
(function () {
  'use strict';
  var NB = window.NB = window.NB || {};
  NB.spreads = NB.spreads || {};
  NB.spreadOrder = NB.spreadOrder || [];
  NB.registerSpread = function (def) { if (!NB.spreads[def.id]) NB.spreadOrder.push(def.id); NB.spreads[def.id] = def; };

  /* ---------------- geometry helpers for spread authors ---------------- */
  function f1(n) { return Math.round(n * 10) / 10; }
  var G = NB.geom = {
    polar: function (cx, cy, r, deg) { var a = deg * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; },
    /* closed polygon for an annular sector (angles in degrees, clockwise from 3 o'clock) */
    sectorPoly: function (cx, cy, r0, r1, a0, a1, step) {
      step = step || 3; var n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step)), pts = [], i;
      for (i = 0; i <= n; i++) pts.push(G.polar(cx, cy, r1, a0 + (a1 - a0) * i / n));
      for (i = n; i >= 0; i--) pts.push(G.polar(cx, cy, r0, a0 + (a1 - a0) * i / n));
      return pts.map(function (p) { return [f1(p[0]), f1(p[1])]; });
    },
    arc: function (cx, cy, r, a0, a1) {
      var p0 = G.polar(cx, cy, r, a0), p1 = G.polar(cx, cy, r, a1), large = (a1 - a0) > 180 ? 1 : 0;
      return 'M' + f1(p0[0]) + ' ' + f1(p0[1]) + ' A' + r + ' ' + r + ' 0 ' + large + ' 1 ' + f1(p1[0]) + ' ' + f1(p1[1]);
    },
    ray: function (cx, cy, r0, r1, a) {
      var p = G.polar(cx, cy, r0, a), q = G.polar(cx, cy, r1, a);
      return 'M' + f1(p[0]) + ' ' + f1(p[1]) + ' L' + f1(q[0]) + ' ' + f1(q[1]);
    },
    bbox: function (pts) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      pts.forEach(function (p) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); });
      return { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - Math.floor(x0)), h: Math.ceil(y1 - Math.floor(y0)) };
    },
    esc: function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  };

  /* ---------------- boot / config ---------------- */
  var BOOT = window.NB_BOOT || {};
  var CFG = BOOT.config || {};
  var PALETTE = CFG.palette || {
    pens: ['#1b1d24', '#1f5fbf', '#d1342f', '#1e8a4c', '#7a3fb8', '#e07b10'],
    highlighters: ['#ffe14d', '#7de86b', '#ff8ad8', '#79d4ff'],
    sizes: [3, 5, 9], highlighterWidth: 24, eraserWidth: 30
  };
  var RES = 2;              // canvas pixels per notebook unit (high enough to stay sharp when zoomed in)
  var LIFT_PERSPECTIVE = 1500;

  var S = {
    role: BOOT.role === 'teacher' ? 'teacher' : 'student',
    period: null, objective: null, spreadId: null,
    tool: 'pen', penColor: PALETTE.pens[0], hlColor: PALETTE.highlighters[0], size: PALETTE.sizes[1],
    view: 'both',
    def: null, byId: {}, faces: {}, flapEls: {},
    doc: { seq: -1, strokes: [], flaps: {} },
    local: {},                 // student's own peeks: flapId -> bool
    mine: {},                  // op ids this tab sent (skip their echo)
    queue: [], inflight: null, gen: 0,
    lastOk: 0, stroke: null, ptr: null, padTop: 0,
    zoom: 1, pan: { x: 0, y: 0 }, focus: null, focusId: null, prevOpen: {}, space: false,
    scale: 1, baseScale: 1, cx: 0, cy: 0,
    autoFocus: store('nb.autofocus') !== '0',
    slidesOn: store('nb.slides') !== '0', slideIdx: 0,
    els: {}
  };

  /* ---------------- server API ---------------- */
  var api = (function () {
    if (NB.firebaseApi) return NB.firebaseApi(BOOT);
    var run = window.google && google.script && google.script.run;
    if (run) {
      return {
        live: true,
        call: function (fn) {
          var args = Array.prototype.slice.call(arguments, 1);
          return new Promise(function (res, rej) {
            var r = google.script.run.withSuccessHandler(res).withFailureHandler(rej);
            r[fn].apply(r, args);
          });
        }
      };
    }
    if (NB.mockApi) return NB.mockApi();
    return { live: false, call: function () { return Promise.reject(new Error('No server')); } };
  })();

  /* ---------------- small utils ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function h(tag, attrs, html) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k === 'style') el.setAttribute('style', attrs[k]);
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) el.setAttribute(k, attrs[k]);
    });
    if (html != null) el.innerHTML = html;
    return el;
  }
  var esc = G.esc;
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var toastTimer;
  function toast(msg, selectable) {
    var t = S.els.toast || (S.els.toast = document.body.appendChild(h('div', { class: 'toast', role: 'status' })));
    t.textContent = msg; t.classList.toggle('sel', !!selectable); t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, selectable ? 9000 : 2600);
  }

  /* ---------------- config lookups ---------------- */
  function periods() { return CFG.periods || []; }
  function objectives() {
    return (CFG.objectives || []).filter(function (o) { return S.role === 'teacher' || !o.teacherOnly; });
  }
  function objById(id) { return objectives().filter(function (o) { return o.id === id; })[0]; }
  /* numbered objectives (1.1, 3.2 …) are SLOs; others (syllabus, tables of contents) are just pages */
  function pagesLabel(m) { var l = String(m.label == null ? '' : m.label); return /^\d/.test(l) ? (/[–-]/.test(l) ? 'pp. ' : 'p. ') + l : l; }
  function isSlo(o) { return !!(o && o.unit && /^\d+(\.\d+)*$/.test(String(o.id))); }
  function periodById(id) { return periods().filter(function (p) { return p.id === id; })[0]; }
  function spreadMeta(id) { return (CFG.spreads || []).filter(function (s) { return s.id === id; })[0] || { id: id, label: id }; }

  function setUrl() {
    var p = {};
    if (S.period) p.period = S.period;
    if (S.objective) p.obj = S.objective;
    if (S.spreadId) p.spread = S.spreadId;
    try {
      if (window.google && google.script && google.script.history) google.script.history.replace(null, p);
      else if (window.history && history.replaceState && /^https?:/.test(location.protocol)) {
        var q = Object.keys(p).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(p[k]); }).join('&');
        history.replaceState(null, '', location.pathname + (q ? '?' + q : ''));
      }
    } catch (e) {}
  }

  /* =====================================================================
     LANDING: pick period, then objective
     ===================================================================== */
  function stopLive() { if (S.unsub) { try { S.unsub(); } catch (e) {} S.unsub = null; } }
  /* ---------------- Class Hub: a notebook with unit tabs ----------------
     Cover (title + class period) -> unit contents (SLOs) -> SLO page (page sets with Video and Live notes). */
  function renderLanding() {
    S.gen++; stopLive();
    var app = $('#app');
    var teacher = S.role === 'teacher';
    var lessons = BOOT.lessons || [];
    var lessonBase = BOOT.lessonBase || '';
    var rangeOf = function (t) { var m = String(t || '').match(/(\d+)(?:\s*[–-]\s*(\d+))?/); return m ? [+m[1], +(m[2] || m[1])] : null; };
    var overlaps = function (a, b) { return a && b && a[0] <= b[1] && b[0] <= a[1]; };
    var pinned = function (l) { return l.spread && (CFG.spreads || []).some(function (x) { return x.id === l.spread; }); };
    var objs = objectives();

    // Tabs: every unit in the settings, plus "More" when some objectives have no unit.
    var units = (CFG.units || []).slice();
    if (objs.some(function (o) { return !o.unit; })) units.push({ id: '', name: teacher ? 'Teacher only' : 'More', short: '★' });
    var unitObjs = function (u) { return objs.filter(function (o) { return (o.unit || '') === u.id; }); };
    var unitById = function (id) { return units.filter(function (u) { return u.id === id; })[0]; };
    var tabLabel = function (u) { return u.short || (/^\d+$/.test(String(u.id)) ? 'Unit ' + u.id : String(u.name || '').replace(/^Unit\s*/i, '').split(/\s+/)[0]); };
    var unitTitle = function (u) { return String(u.name || '').replace(/^Unit\s*\d+\s*[-–:·]\s*/i, ''); };

    function rowsFor(o) {
      var sp = o.spreads || [], used = {};
      var own = lessons.filter(function (l) { return String(l.group || '').indexOf(o.id + ' ') === 0 && !pinned(l); });
      var rows = sp.map(function (sid) {
        var m = spreadMeta(sid), r = rangeOf(m.label || sid);
        var l = lessons.filter(function (x) { return x.spread === sid; })[0] ||
          lessons.filter(function (x) { return !used[x.slug] && !pinned(x) && overlaps(rangeOf(x.pages), r); })[0];
        if (l) used[l.slug] = 1;
        return { sid: sid, m: m, lesson: l };
      });
      own.forEach(function (l) { if (!used[l.slug]) rows.push({ lesson: l, m: { label: l.pages, title: l.title } }); });
      var at = function (r) { return r.m.sort != null ? +r.m.sort : (rangeOf(r.m.label) || [9999])[0]; };
      rows.sort(function (a, b) { return at(a) - at(b); });
      return rows;
    }
    var ready = function (o) { return rowsFor(o).length > 0; };

    // Where to open: the remembered unit/SLO, else the newest unit that has anything in it.
    if (S.hubUnit != null && !unitById(S.hubUnit)) S.hubUnit = null;
    if (S.hubUnit == null && S.hubOpen) {
      var latest = null;
      units.forEach(function (u) { if (/^\d+$/.test(String(u.id)) && unitObjs(u).some(ready)) latest = u; });
      S.hubUnit = latest ? latest.id : (units[0] && units[0].id);
    }

    var periodBtns = function (cls) {
      return periods().map(function (p) {
        return '<button type="button" class="' + cls + '" data-period="' + esc(p.id) + '" aria-pressed="' + (S.period === p.id) + '">' +
          '<span class="big">' + esc(p.short || p.name) + '</span>' + (cls === 'cv-pbtn' ? '<span class="small">' + esc(p.name) + '</span>' : '') + '</button>';
      }).join('');
    };
    var tabsHtml = function (current) {
      return '<nav class="nbtabs" aria-label="Units">' + units.map(function (u) {
        var any = unitObjs(u).some(ready);
        return '<button type="button" class="nbtab' + (any ? '' : ' empty') + '" data-unit="' + esc(u.id) + '" style="--u:' + esc(u.color || '#e9edf3') + '"' +
          (current === u.id ? ' aria-current="page"' : '') + ' title="' + esc(u.name) + '"><span>' + esc(tabLabel(u)) + '</span></button>';
      }).join('') + '</nav>';
    };
    var footer = (api.demo ? '<div class="demo-bar"><span>Preview mode. Try both sides:</span><div class="seg" id="roleSeg">' +
        '<button data-role="teacher" aria-pressed="' + teacher + '">Teacher</button><button data-role="student" aria-pressed="' + !teacher + '">Student</button></div></div>' : '') +
      '<div id="landingFooter"></div>';
    var pendingNote = function () {
      return S.pending ? '<p class="pending-note" id="pendingNote">Pick your class period to open the live notes for <b>' + esc(pagesLabel(spreadMeta(S.pending.sid))) + '</b>.</p>' : '';
    };

    /* ---------- the cover ---------- */
    if (!S.hubOpen) {
      app.innerHTML = '<main class="nbhub"><div class="nbhub-inner">' +
        '<div class="nbbook cover-book">' +
          '<section class="nbcover">' +
            '<div class="cv-label">' +
              '<span class="cv-eyebrow">' + esc(CFG.teacherName || 'Ms. Goodwin') + '</span>' +
              '<h1>' + esc(CFG.courseName || 'Algebra 3/4') + '</h1>' +
              '<p class="cv-sub">Interactive Notebook</p>' +
            '</div>' +
            '<div class="cv-period" id="hubPeriod"><h2 id="periodLbl">' + (teacher ? 'Class I\'m teaching' : 'My class period') + '</h2>' +
              '<div class="cv-periods" role="group" aria-labelledby="periodLbl">' + periodBtns('cv-pbtn') + '</div>' + pendingNote() + '</div>' +
            '<button type="button" class="cv-open" id="cvOpen">Open the notebook <span aria-hidden="true">→</span></button>' +
            (teacher ? '<p class="cv-who"><b>Teacher view</b>' + (BOOT.email ? ' · ' + esc(BOOT.email) : '') + '</p>' : '') +
          '</section>' + tabsHtml(null) +
        '</div>' + footer + '</div></main>';
    } else {
      /* ---------- the open notebook: unit contents + SLO page ---------- */
      var u = unitById(S.hubUnit) || units[0];
      var list = unitObjs(u);
      if (S.hubObj && !list.some(function (o) { return o.id === S.hubObj; })) S.hubObj = null;
      var narrow = window.matchMedia && window.matchMedia('(max-width: 820px)').matches;
      if (!S.hubObj && !narrow) { var firstReady = list.filter(ready)[0]; S.hubObj = firstReady ? firstReady.id : null; }
      var cur = list.filter(function (o) { return o.id === S.hubObj; })[0];

      var toc = '<header class="pg-head"><span class="pg-eyebrow">' + esc(tabLabel(u)) + '</span><h2>' + esc(unitTitle(u) || u.name) + '</h2></header>';
      if (!list.length) toc += '<p class="pg-empty">Coming soon. Nothing in this unit yet.</p>';
      else toc += '<ol class="toc">' + list.map(function (o) {
        var n = rowsFor(o).length;
        return '<li><button type="button" class="toc-row' + (n ? '' : ' is-empty') + '" data-obj="' + esc(o.id) + '"' + (cur && cur.id === o.id ? ' aria-current="true"' : '') + '>' +
          (isSlo(o) ? '<span class="toc-num">' + esc(o.id) + '</span>' : '') + '<span class="toc-name">' + esc(o.name) + '</span>' +
          '<span class="toc-dots" aria-hidden="true"></span><span class="toc-count">' + (n ? n + (n === 1 ? ' set' : ' sets') : 'soon') + '</span></button></li>';
      }).join('') + '</ol>';

      var page = '';
      if (cur) {
        var rows = rowsFor(cur);
        page = '<header class="pg-head"><button type="button" class="pg-back" id="pgBack">‹ ' + esc(tabLabel(u)) + ' contents</button>' +
          '<span class="pg-eyebrow">' + (isSlo(cur) ? 'SLO ' + esc(cur.id) : esc(tabLabel(u))) + (cur.teacherOnly ? ' · teacher only' : '') + '</span>' +
          '<h2>' + esc(cur.name) + '</h2></header>';
        if (!rows.length) page += '<p class="pg-empty">Nothing here yet.</p>';
        else page += '<ul class="sets">' + rows.map(function (row, i) {
          var label = row.m.label ? pagesLabel(row.m) : '';
          var title = String(row.m.title || (row.lesson && row.lesson.title) || '').split(' · ');
          var vids = (row.m.videos || []).filter(function (v) { return v && /^https:\/\//.test(v.url || ''); });
          var btns = '';
          if (row.lesson && lessonBase) btns += '<a class="set-btn video" href="' + esc(lessonBase + encodeURIComponent(row.lesson.slug)) + '"><span class="ic" aria-hidden="true">▶</span>Video / Slides</a>';
          vids.forEach(function (v) {
            btns += '<a class="set-btn video" href="' + esc(v.url) + '" target="_blank" rel="noopener" title="Opens YouTube"><span class="ic" aria-hidden="true">▶</span>' +
              esc(vids.length > 1 ? 'Video ' + (v.label || '') : 'Video') + '</a>';
          });
          if (!btns && lessonBase) btns += '<span class="set-btn none">No video yet</span>';
          if (row.sid) btns += '<button type="button" class="set-btn notes" data-sid="' + esc(row.sid) + '">' +
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M12 16v4M8 20h8M7 11l3-3 2 2 4-4"/></svg>Live notes</button>';
          return '<li class="set"><div class="set-what">' + (label ? '<span class="set-pg">' + esc(label) + '</span>' : '') +
            '<span class="set-t">' + esc(title[0]) + (title.length > 1 ? ' <span class="set-sub">· ' + esc(title.slice(1).join(' · ')) + '</span>' : '') + '</span></div>' +
            '<div class="set-btns">' + btns + '</div></li>';
        }).join('') + '</ul>';
      } else {
        page = '<p class="pg-empty pg-hint">' + (list.length ? 'Pick an SLO from the contents.' : '') + '</p>';
      }

      app.innerHTML = '<main class="nbhub open"><div class="nbhub-inner">' +
        '<div class="nbbar">' +
          '<button type="button" class="nbbar-cover" id="toCover" title="Back to the cover"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z"/><path d="M8 3v18"/></svg><span>' + esc(CFG.courseName || 'Algebra 3/4') + '</span></button>' +
          '<div class="nbbar-period" id="hubPeriod"><span class="lbl" id="periodLbl">' + (teacher ? 'Teaching' : 'Period') + '</span>' +
            '<div class="nb-periods" role="group" aria-labelledby="periodLbl">' + periodBtns('nb-pbtn') + '</div></div>' +
        '</div>' + pendingNote() +
        '<div class="nbbook open-book' + (cur ? ' has-slo' : '') + '" style="--u:' + esc(u.color || '#e9edf3') + '">' +
          '<div class="spread-pages">' +
            '<section class="nbpage toc-page" aria-label="' + esc(tabLabel(u)) + ' contents">' + toc + '</section>' +
            '<section class="nbpage slo-page" aria-live="polite">' + page + '</section>' +
          '</div>' + tabsHtml(u.id) +
        '</div>' + footer + '</div></main>';
    }

    /* ---------- wiring ---------- */
    function pickPeriod(id) {
      S.period = id; store('nb.period', id);
      if (S.pending) { var go = S.pending; S.pending = null; openNotebook(S.period, go.oid, go.sid); return; }
      app.querySelectorAll('[data-period]').forEach(function (x) { x.setAttribute('aria-pressed', String(x.getAttribute('data-period') === id)); });
    }
    app.querySelectorAll('[data-period]').forEach(function (b) { b.addEventListener('click', function () { pickPeriod(b.getAttribute('data-period')); }); });
    app.querySelectorAll('.nbtab').forEach(function (b) {
      b.addEventListener('click', function () {
        S.hubOpen = true; S.hubUnit = b.getAttribute('data-unit'); S.hubObj = null;
        store('nb.hubUnit', S.hubUnit); renderLanding(); window.scrollTo(0, 0);
      });
    });
    var openBtn = $('#cvOpen');
    if (openBtn) openBtn.addEventListener('click', function () {
      S.hubOpen = true; if (S.hubUnit == null) S.hubUnit = store('nb.hubUnit');
      renderLanding(); window.scrollTo(0, 0);
    });
    var toCover = $('#toCover');
    if (toCover) toCover.addEventListener('click', function () { S.hubOpen = false; S.pending = null; renderLanding(); window.scrollTo(0, 0); });
    app.querySelectorAll('.toc-row').forEach(function (b) {
      b.addEventListener('click', function () {
        S.hubObj = b.getAttribute('data-obj'); renderLanding();
        var pg = $('.slo-page'); if (pg && window.matchMedia('(max-width: 820px)').matches) window.scrollTo(0, 0);
      });
    });
    var back = $('#pgBack');
    if (back) back.addEventListener('click', function () { S.hubObj = null; renderLanding(); });
    app.querySelectorAll('.set-btn.notes').forEach(function (b) {
      b.addEventListener('click', function () {
        var sid = b.getAttribute('data-sid');
        if (S.period) { openNotebook(S.period, S.hubObj, sid); return; }
        S.pending = { oid: S.hubObj, sid: sid };
        renderLanding();
        var sec = $('#hubPeriod'); if (sec) { sec.classList.add('nudge'); sec.scrollIntoView({ behavior: 'smooth', block: 'center' }); var f = sec.querySelector('button'); if (f) f.focus({ preventScroll: true }); }
      });
    });
    var seg = $('#roleSeg');
    if (seg) seg.addEventListener('click', function (e) {
      var r = e.target.closest('button'); if (!r) return;
      S.role = r.getAttribute('data-role'); renderLanding();
    });
    if (S.pending) setTimeout(function () { var f = app.querySelector('[data-period]'); if (f) f.focus(); }, 50);
    if (NB.onLanding) { try { NB.onLanding($('#landingFooter'), S.role); } catch (e) {} }
  }

  /* =====================================================================
     NOTEBOOK VIEW
     ===================================================================== */
  var ICONS = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 20l1.2-4.6L16.5 4.1a2 2 0 0 1 2.8 0l.6.6a2 2 0 0 1 0 2.8L8.6 18.8z"/><path d="M14.5 6l3.5 3.5"/></svg>',
    hl: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M9 14l-3 3v3h3l3-3"/><path d="M8.5 12.5l8.8-8.8a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5l-8.8 8.8z"/><path d="M3 21h8" stroke-width="2.6" stroke-linecap="round"/></svg>',
    er: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M8 20l-4.3-4.3a1.6 1.6 0 0 1 0-2.3l9.6-9.6a1.6 1.6 0 0 1 2.3 0l4.6 4.6a1.6 1.6 0 0 1 0 2.3L12 20z"/><path d="M8 20h12M9 10.3l6.7 6.7"/></svg>',
    hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V4a1.5 1.5 0 0 1 3 0v6.5"/><path d="M14 10.5V6a1.5 1.5 0 0 1 3 0v7"/><path d="M8 11V9a1.5 1.5 0 0 0-3 0v4.5c0 4 2.7 7 6.5 7h1c3.3 0 5.5-2.6 5.5-6V12"/></svg>',
    flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M4 9h16v11H4z"/><path d="M4 9l3-5h10l3 5"/><path d="M10 14h4"/></svg>',
    line: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.6" fill="currentColor"/><circle cx="19" cy="5" r="1.6" fill="currentColor"/></svg>',
    graph: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M5 5v14M9 5v14M15 5v14M19 5v14M5 5h14M5 9h14M5 15h14M5 19h14" stroke-width="1" stroke-opacity=".45"/><path d="M3 12h18M12 3v18" stroke-width="2"/></svg>',
    prot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17a9 9 0 0 1 18 0z"/><path d="M12 17l4.5-6M7 13.5l1 1M12 9v1.5M17 13.5l-1 1"/></svg>',
    side: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h15M15 4l4 4-4 4"/><path d="M20 16H5M9 12l-4 4 4 4"/></svg>',
    undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M4 12h16v8H4z"/><path d="M4 12l3-3h10l3 3"/><path d="M12 3v5M9.5 5.5L12 8l2.5-2.5"/></svg>',
    clear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>'
  };

  function openNotebook(periodId, objId, spreadId) {
    S.period = periodId; S.objective = objId;
    var teacher = S.role === 'teacher';
    var app = $('#app');
    app.innerHTML = '';
    var root = h('div', { class: 'nb' });
    var top = h('header', { class: 'topbar' });
    var back = h('button', { class: 'homebtn', title: 'Back to the Class Hub', 'aria-label': 'Class Hub' },
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/></svg><span>Hub</span>');
    back.addEventListener('click', function () { flushNow(); if (S.objective) { S.hubOpen = true; S.hubObj = S.objective; var ob = objectives().filter(function (o) { return o.id === S.objective; })[0]; if (ob) S.hubUnit = ob.unit || ''; } S.spreadId = null; S.objective = null; setUrl(); renderLanding(); window.scrollTo(0, 0); });
    top.appendChild(back);

    var ctx = h('div', { class: 'ctx' });
    var pLine = h('div', { class: 'p' });
    if (teacher) {
      var sel = h('select', { 'aria-label': 'Class period' });
      periods().forEach(function (p) { var o = h('option', { value: p.id }, esc(p.name)); if (p.id === S.period) o.selected = true; sel.appendChild(o); });
      sel.addEventListener('change', function () { flushNow(); S.period = sel.value; store('nb.period', S.period); loadSpread(S.spreadId); });
      pLine.appendChild(sel);
    } else {
      pLine.textContent = (periodById(S.period) || {}).name || '';
    }
    ctx.appendChild(pLine);
    var ob = objById(objId) || {}, olabel = (isSlo(ob) ? 'SLO ' + ob.id + ' · ' : '') + (ob.name || '');
    var unit = (CFG.units || []).filter(function (u) { return u.id === ob.unit; })[0];
    if (unit && unit.color) root.style.setProperty('--unit', unit.color);
    ctx.appendChild(h('div', { class: 'o', title: olabel }, (isSlo(ob) ? '<span class="slo-pill">SLO ' + esc(ob.id) + '</span>' : '') + esc(ob.name || '')));
    top.appendChild(ctx);

    var tabs = h('div', { class: 'tabs' });
    S.els.tabs = tabs;
    top.appendChild(tabs);

    if (!teacher) {
      var peek = h('div', { class: 'peekbar' }, '<span>Tap a flap to peek under it.</span>');
      var match = h('button', { hidden: true }, 'Match teacher');
      match.addEventListener('click', function () { S.local = {}; updateFlaps(); });
      peek.appendChild(match); S.els.match = match;
      top.appendChild(peek);
    }
    var vs = h('div', { class: 'viewseg', role: 'group', 'aria-label': 'Page' });
    S.els.viewseg = vs;
    top.appendChild(vs);
    var zg = h('div', { class: 'zoomgrp', role: 'group', 'aria-label': 'Zoom' });
    var zOut = h('button', { title: 'Zoom out (Ctrl −)', 'aria-label': 'Zoom out' }, '−');
    var zPct = h('button', { class: 'pct', title: 'Fit to screen (Ctrl 0)', 'aria-label': 'Fit to screen' }, '100%');
    var zIn = h('button', { title: 'Zoom in (Ctrl +)', 'aria-label': 'Zoom in' }, '+');
    zOut.addEventListener('click', function () { zoomAt(0.8, null, null, true); });
    zIn.addEventListener('click', function () { zoomAt(1.25, null, null, true); });
    zPct.addEventListener('click', resetView);
    zg.appendChild(zOut); zg.appendChild(zPct); zg.appendChild(zIn);
    S.els.zoomPct = zPct;
    top.appendChild(zg);
    var sl = h('button', { class: 'togglebtn', 'aria-pressed': String(S.slidesOn), title: 'Show one 16:9 section of the page at a time' }, '<span class="tick"></span><span class="lbl">16:9 </span>slides');
    sl.addEventListener('click', function () {
      S.slidesOn = !S.slidesOn; store('nb.slides', S.slidesOn ? '1' : '0');
      sl.setAttribute('aria-pressed', String(S.slidesOn));
      S.slideIdx = 0; S.focus = null; S.focusId = null; S.zoom = 1; S.pan = { x: 0, y: 0 };
      renderTabs(); fit(true);
    });
    top.appendChild(sl);
    var af = h('button', { class: 'togglebtn', 'aria-pressed': String(S.autoFocus), title: 'When a flap opens, zoom in on it' }, '<span class="tick"></span><span class="lbl">Zoom to </span>flaps');
    af.addEventListener('click', function () {
      S.autoFocus = !S.autoFocus; store('nb.autofocus', S.autoFocus ? '1' : '0');
      af.setAttribute('aria-pressed', String(S.autoFocus));
      if (!S.autoFocus && S.focus) clearFocus();
    });
    top.appendChild(af);
    if (teacher) {
      var share = h('button', { class: 'iconbtn', title: 'Copy student link for this period and spread', 'aria-label': 'Copy student link' }, ICONS.link);
      share.addEventListener('click', copyStudentLink);
      top.appendChild(share);
    }
    var status = h('div', { class: 'status', 'aria-live': 'polite' }, '<span class="dot"></span><span class="t">Connecting…</span>');
    S.els.status = status;
    top.appendChild(status);
    root.appendChild(top);

    var body = h('div', { class: 'nb-body' });
    if (teacher) body.appendChild(buildRail());
    S.els.body = body;
    body.classList.toggle('rail-right', store('nb.railSide') === 'right');
    var vp = h('div', { class: 'viewport' });
    var stage = h('div', { class: 'stage' });
    var cap = h('div', { class: 'capture' + (teacher ? '' : ' student'), 'aria-label': 'Notebook spread' });
    vp.appendChild(stage); vp.appendChild(cap);
    var backBtn = h('button', { class: 'backpage', hidden: true }, ICONS.back + '<span>Whole page</span>');
    backBtn.addEventListener('click', clearFocus);
    var navPrev = h('button', { class: 'pagenav prev', 'aria-label': 'Previous page', title: 'Previous page (←)' }, ICONS.back);
    var navNext = h('button', { class: 'pagenav next', 'aria-label': 'Next page', title: 'Next page (→)' }, ICONS.back);
    navPrev.addEventListener('click', function () { goPage(-1); });
    navNext.addEventListener('click', function () { goPage(1); });
    vp.appendChild(backBtn); vp.appendChild(navPrev); vp.appendChild(navNext);
    S.els.backBtn = backBtn; S.els.navPrev = navPrev; S.els.navNext = navNext;
    body.appendChild(vp);
    root.appendChild(body);
    app.appendChild(root);
    var overlay = h('div', { class: 'stage overlay' }); vp.appendChild(overlay);
    S.els.viewport = vp; S.els.stage = stage; S.els.capture = cap; S.els.overlay = overlay; S.prot = null;
    bindPointer(cap);
    loadSpread(spreadId);
  }

  function renderTabs() {
    var o = objById(S.objective) || { spreads: [S.spreadId] };
    var tabs = S.els.tabs; tabs.innerHTML = '';
    var pick = h('select', { class: 'spreadpick', 'aria-label': 'Notebook pages' });
    (o.spreads || []).forEach(function (sid) {
      var m = spreadMeta(sid);
      var opt = h('option', { value: sid }, esc(pagesLabel(m) + (m.title ? ' · ' + m.title : '')));
      if (sid === S.spreadId) opt.selected = true;
      pick.appendChild(opt);
    });
    pick.addEventListener('change', function () { if (pick.value !== S.spreadId) { flushNow(); loadSpread(pick.value); } pick.blur(); });
    tabs.appendChild(pick);
    var vs = S.els.viewseg; vs.innerHTML = '';
    var def = S.def;
    var opts = [];
    if (def) def.pages.forEach(function (p) { opts.push([p.side, typeof p.num === 'number' ? 'p. ' + p.num : String(p.num)]); });
    if (def && def.pages.length > 1) opts.push(['both', 'Both']);
    opts.forEach(function (op) {
      var label = op[1];
      if (S.slidesOn && op[0] === S.view && op[0] !== 'both') { var n = pageSlides(op[0]).length; if (n > 1) label += ' <span class="slidepos">' + (S.slideIdx + 1) + '/' + n + '</span>'; }
      var b = h('button', { 'aria-pressed': String(S.view === op[0]) }, label);
      b.addEventListener('click', function () { showPage(op[0]); });
      vs.appendChild(b);
    });
  }

  function buildRail() {
    var rail = h('aside', { class: 'rail', 'aria-label': 'Drawing tools' });
    function tool(id, label, key) {
      var b = h('button', { class: 'tool', 'data-tool': id, title: label + ' (' + key + ')', 'aria-label': label }, ICONS[id] + '<span class="k">' + key + '</span>');
      b.addEventListener('click', function () { setTool(id); });
      return b;
    }
    var g1 = h('div', { class: 'rail-group' }, '<span class="rail-label">Tools</span>');
    var t1 = h('div', { class: 'toolgrid' });
    t1.appendChild(tool('pen', 'Pen', 'P')); t1.appendChild(tool('hl', 'Highlighter', 'H'));
    t1.appendChild(tool('er', 'Eraser', 'E')); t1.appendChild(tool('hand', 'Move the page', 'M'));
    t1.appendChild(tool('flip', 'Flip flaps', 'F'));
    g1.appendChild(t1); rail.appendChild(g1);
    var gm = h('div', { class: 'rail-group' }, '<span class="rail-label">Math</span>');
    var t2 = h('div', { class: 'toolgrid' });
    t2.appendChild(tool('line', 'Straight line (hold Shift for 15° steps)', 'L'));
    var gb = h('button', { class: 'tool', 'data-tool': 'graph', title: 'Graph: coordinate plane, Quadrant I, or number line (G)', 'aria-label': 'Graph' }, ICONS.graph + '<span class="k">G</span>');
    gb.addEventListener('click', function (e) { openGraphMenu(e.currentTarget); });
    t2.appendChild(gb);
    var pb = h('button', { class: 'tool', 'data-prot': '1', title: 'Protractor (R) — shows on your screen and the projector', 'aria-label': 'Protractor' }, ICONS.prot + '<span class="k">R</span>');
    pb.addEventListener('click', toggleProtractor);
    t2.appendChild(pb);
    gm.appendChild(t2); rail.appendChild(gm); rail.appendChild(h('hr'));

    var g2 = h('div', { class: 'rail-group' }, '<span class="rail-label">Pens</span>');
    var sw = h('div', { class: 'swatches' });
    PALETTE.pens.forEach(function (c) {
      var b = h('button', { class: 'sw', style: '--c:' + c, 'data-pen': c, 'aria-label': 'Pen color ' + c });
      b.addEventListener('click', function () { S.penColor = c; setTool('pen'); });
      sw.appendChild(b);
    });
    g2.appendChild(sw); rail.appendChild(g2);

    var g3 = h('div', { class: 'rail-group' }, '<span class="rail-label">Highlight</span>');
    var sw2 = h('div', { class: 'swatches' });
    PALETTE.highlighters.forEach(function (c) {
      var b = h('button', { class: 'sw hl', style: '--c:' + c, 'data-hl': c, 'aria-label': 'Highlighter ' + c });
      b.addEventListener('click', function () { S.hlColor = c; setTool('hl'); });
      sw2.appendChild(b);
    });
    g3.appendChild(sw2); rail.appendChild(g3);

    var g4 = h('div', { class: 'rail-group' }, '<span class="rail-label">Size</span>');
    var sz = h('div', { class: 'sizes' });
    PALETTE.sizes.forEach(function (w, i) {
      var d = 5 + i * 4;
      var b = h('button', { class: 'size', 'data-size': w, 'aria-label': ['Thin', 'Medium', 'Thick'][i] || ('Size ' + w) }, '<i style="width:' + d + 'px;height:' + d + 'px"></i>');
      b.addEventListener('click', function () { S.size = w; if (S.tool !== 'pen') setTool('pen'); else syncRail(); });
      sz.appendChild(b);
    });
    g4.appendChild(sz); rail.appendChild(g4); rail.appendChild(h('hr'));

    var g5 = h('div', { class: 'rail-group' });
    var undo = h('button', { class: 'tool', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo' }, ICONS.undo);
    undo.addEventListener('click', doUndo);
    var closeAll = h('button', { class: 'tool', title: 'Close all flaps', 'aria-label': 'Close all flaps' }, ICONS.close);
    closeAll.addEventListener('click', function () { queueOp({ k: 'flapsReset' }); });
    var clear = h('button', { class: 'tool', title: 'Clear ink…', 'aria-label': 'Clear ink' }, ICONS.clear);
    clear.addEventListener('click', function (e) { openClearMenu(e.currentTarget); });
    g5.appendChild(undo); g5.appendChild(closeAll); g5.appendChild(clear);
    var flipSide = h('button', { class: 'tool side', title: 'Move the tools to the other side', 'aria-label': 'Move the tools to the other side' }, ICONS.side);
    flipSide.addEventListener('click', function () {
      var right = !S.els.body.classList.contains('rail-right');
      S.els.body.classList.toggle('rail-right', right);
      store('nb.railSide', right ? 'right' : 'left');
      fit(false);
    });
    g5.appendChild(flipSide);
    rail.appendChild(g5);
    S.els.rail = rail;
    setTimeout(syncRail, 0);
    return rail;
  }

  function setTool(t) { S.tool = t; syncRail(); }
  function syncRail() {
    var rail = S.els.rail; if (!rail) return;
    rail.querySelectorAll('[data-tool]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tool') === S.tool)); });
    rail.querySelectorAll('[data-pen]').forEach(function (b) { b.setAttribute('aria-pressed', String(S.tool === 'pen' && b.getAttribute('data-pen') === S.penColor)); });
    rail.querySelectorAll('[data-hl]').forEach(function (b) { b.setAttribute('aria-pressed', String(S.tool === 'hl' && b.getAttribute('data-hl') === S.hlColor)); });
    rail.querySelectorAll('[data-size]').forEach(function (b) { b.setAttribute('aria-pressed', String(+b.getAttribute('data-size') === S.size)); });
    rail.querySelectorAll('[data-prot]').forEach(function (b) { b.setAttribute('aria-pressed', String(!!S.prot)); });
    if (S.els.capture) { S.els.capture.classList.toggle('flip', S.tool === 'flip'); S.els.capture.classList.toggle('hand', S.tool === 'hand'); }
  }

  function openClearMenu(anchor) {
    var old = $('.clearmenu'); if (old) { old.remove(); return; }
    var r = anchor.getBoundingClientRect();
    var m = h('div', { class: 'clearmenu', role: 'dialog', 'aria-label': 'Clear ink' }, '<p>Clear your ink for ' + esc((periodById(S.period) || {}).name || 'this period') + '. Flaps stay as they are.</p>');
    function opt(label, side, danger) {
      var b = h('button', { class: danger ? 'danger' : '' }, label);
      b.addEventListener('click', function () {
        m.remove();
        if (side === null) return;
        var ids = S.def.surfaces.filter(function (s) { return side === 'all' || s.page === side; }).map(function (s) { return s.id; });
        queueOp({ k: 'clear', ids: side === 'all' ? null : ids });
        toast('Ink cleared');
      });
      m.appendChild(b);
    }
    S.def.pages.forEach(function (p) { opt('Clear page ' + p.num, p.side); });
    opt('Clear the whole spread', 'all', true);
    opt('Cancel', null);
    document.body.appendChild(m);
    var top = Math.min(r.top, window.innerHeight - m.offsetHeight - 12);
    var left = (S.els.body && S.els.body.classList.contains('rail-right')) ? r.left - m.offsetWidth - 10 : r.right + 10;
    if (left + m.offsetWidth > window.innerWidth - 12) { left = Math.max(12, r.left); top = r.top - m.offsetHeight - 10; }
    m.style.left = left + 'px'; m.style.top = Math.max(12, top) + 'px';
    setTimeout(function () {
      document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); } document.removeEventListener('pointerdown', off, true); }, true);
    }, 0);
  }

  function copyStudentLink() {
    if (!BOOT.appUrl) { toast('The student link works after you deploy the web app.'); return; }
    var url = BOOT.appUrl + '?period=' + encodeURIComponent(S.period) + '&obj=' + encodeURIComponent(S.objective) + '&spread=' + encodeURIComponent(S.spreadId);
    var done = function () { toast('Student link copied for ' + ((periodById(S.period) || {}).name || 'this period')); };
    try {
      navigator.clipboard.writeText(url).then(done, function () { toast(url, true); });
    } catch (e) { toast(url, true); }
  }

  /* =====================================================================
     SPREAD BUILDING
     ===================================================================== */
  /* Spread files live in Drive; fetch one the first time it is opened, then keep it. */
  var spreadLoads = {};
  function fetchSpread(id) {
    if (NB.spreads[id]) return Promise.resolve();
    if (!api.live) return Promise.reject(new Error('Pages ' + id + ' are not available in this preview.'));
    if (!spreadLoads[id]) {
      spreadLoads[id] = api.call('nbGetSpread', id).then(function (html) {
        var code = String(html || '').replace(/<\/?script[^>]*>/gi, '');
        var el = document.createElement('script'); el.text = code; document.head.appendChild(el);
        if (!NB.spreads[id]) throw new Error('The file for pages ' + id + ' loaded, but its id does not match notebook-config.json.');
      });
      spreadLoads[id].catch(function () { delete spreadLoads[id]; });
    }
    return spreadLoads[id];
  }
  function prefetchNext() {
    var list = ((objById(S.objective) || {}).spreads || []), j = list.indexOf(S.spreadId);
    if (list[j + 1]) fetchSpread(list[j + 1]).catch(function () {});
  }

  function loadSpread(spreadId, side) {
    var token = S.loadTok = (S.loadTok || 0) + 1;
    if (spreadId && !NB.spreads[spreadId] && api.live) {
      S.gen++; S.spreadId = spreadId; S.def = null; S.view = 'both';
      setUrl(); renderTabs();
      S.els.stage.innerHTML = '';
      S.els.stage.style.transform = 'none';
      S.els.stage.appendChild(h('div', { class: 'ghost-label', style: 'left:24px;top:24px' }, 'Loading pages ' + esc(spreadMeta(spreadId).label) + '…'));
      setStatus('busy', 'Loading pages…');
      fetchSpread(spreadId).then(function () {
        if (token === S.loadTok) loadSpread(spreadId, side);
      }, function (err) {
        if (token !== S.loadTok) return;
        S.els.stage.innerHTML = '';
        S.els.stage.appendChild(h('div', { class: 'ghost-label', style: 'left:24px;top:24px;max-width:420px' }, 'These pages could not load. ' + esc(err && err.message || err)));
        setStatus('bad', 'Pages not loaded');
      });
      return;
    }
    var def = NB.spreads[spreadId];
    S.spreadId = spreadId; S.def = def;
    S.view = def ? (side === 'last' ? def.pages[def.pages.length - 1].side : (side || def.pages[0].side)) : 'both';
    S.slideIdx = (def && side === 'last') ? pageSlides(S.view).length - 1 : 0;
    S.zoom = 1; S.pan = { x: 0, y: 0 }; S.focus = null; S.focusId = null; S.prevOpen = {};
    S.doc = { seq: -1, strokes: [], flaps: {} }; S.local = {}; S.faces = {}; S.flapEls = {}; S.byId = {};
    setUrl();
    renderTabs();
    var stage = S.els.stage;
    stage.innerHTML = '';
    if (!def) { stage.innerHTML = '<div class="ghost-label" style="left:20px;top:20px">This spread has no file yet (' + esc(spreadId) + ').</div>'; return; }
    prepareDef(def);
    var W = def.pageW * def.pages.length, H = def.pageH + S.padTop;
    stage.style.width = W + 'px'; stage.style.height = H + 'px';
    def.pages.forEach(function (p, i) {
      stage.appendChild(h('div', { class: 'sheet-shadow', 'data-page': p.side, style: 'left:' + (i * def.pageW) + 'px;top:' + S.padTop + 'px;width:' + def.pageW + 'px;height:' + def.pageH + 'px' }));
    });
    def.surfaces.forEach(function (s, i) { stage.appendChild(buildSurface(s, i)); });
    if (def.pages.length === 2) stage.appendChild(h('div', { class: 'spine', style: 'left:' + def.pageW + 'px;top:' + S.padTop + 'px;height:' + def.pageH + 'px;z-index:400' }));
    var wet = h('canvas', { class: 'wet', hidden: true });
    stage.appendChild(wet); S.els.wet = wet;
    var spot = h('div', { class: 'spot', hidden: true }); stage.appendChild(spot); S.els.spot = spot;
    updateFlaps(true);
    fit(false); void stage.offsetWidth; stage.classList.remove('no-anim');
    startSync();
  }

  function prepareDef(def) {
    if (def._prepared) { S.padTop = def._padTop; def.surfaces.forEach(function (s) { S.byId[s.id] = s; }); return; }
    var pad = 0;
    def.surfaces.forEach(function (s, i) {
      s._i = i;
      if (s.shape && (s.x == null)) { var bb = G.bbox(s.shape); s.x = bb.x; s.y = bb.y; s.w = bb.w; s.h = bb.h; }
      if (!s.page) s.page = (s.x + s.w / 2) < def.pageW ? 'L' : 'R';
      if (s.kind === 'flap') {
        var hg = s.hinge; var len = Math.hypot(hg.dx, hg.dy) || 1;
        s._d = [hg.dx / len, hg.dy / len];
        s._u = [s._d[1], -s._d[0]];
        if (s.mode === 'flip') {
          var c = [s.x + s.w / 2, s.y + s.h / 2];
          var k = -2 * ((c[0] - hg.x) * s._d[0] + (c[1] - hg.y) * s._d[1]);
          s._T = [k * s._d[0], k * s._d[1]];
          s._back = { x: s.x + s._T[0], y: s.y + s._T[1], w: s.w, h: s.h };
          pad = Math.max(pad, -s._back.y + 12);
        }
      }
    });
    def._padTop = Math.ceil(pad); def._prepared = true;
    S.padTop = def._padTop;
    def.surfaces.forEach(function (s) { S.byId[s.id] = s; });
  }

  function buildFace(s, back) {
    var r = back ? s._back : s;
    var face = h('div', { class: 'face' + (back ? ' back' : ' front') });
    var art = back ? (s.back && s.back.art) : s.art;
    face.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + r.x + ' ' + r.y + ' ' + r.w + ' ' + r.h + '" preserveAspectRatio="none">' + (art || '') + '</svg>';
    var cv = h('canvas', { width: Math.round(r.w * RES), height: Math.round(r.h * RES) });
    face.appendChild(cv);
    if (!back && s.shape) face.style.clipPath = polyCss(s.shape, s.x, s.y);
    if (back) face.style.transform = 'rotate3d(' + s._u[0] + ',' + s._u[1] + ',0,180deg)';
    var ctx = cv.getContext('2d');
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    S.faces[s.id + '|' + (back ? 1 : 0)] = { el: face, cv: cv, ctx: ctx, r: r, s: s, back: back };
    return face;
  }

  function polyCss(pts, ox, oy) {
    return 'polygon(' + pts.map(function (p) { return f1(p[0] - ox) + 'px ' + f1(p[1] - oy) + 'px'; }).join(',') + ')';
  }

  function buildSurface(s, i) {
    var el = h('div', { class: 'surf ' + (s.kind || 'page'), 'data-id': s.id, 'data-page': s.page,
      style: 'left:' + s.x + 'px;top:' + (s.y + S.padTop) + 'px;width:' + s.w + 'px;height:' + s.h + 'px;z-index:' + (10 + i) });
    el.appendChild(buildFace(s, false));
    if (s.kind === 'flap') {
      el.classList.add('flap');
      if (s.mode === 'flip') { el.classList.add('flipmode'); el.appendChild(buildFace(s, true)); }
      else S.faces[s.id + '|0'].el.appendChild(h('div', { class: 'shade' }));
      el.style.transformOrigin = f1(s.hinge.x - s.x) + 'px ' + f1(s.hinge.y - s.y) + 'px';
      S.flapEls[s.id] = el;
    }
    return el;
  }

  /* ---------------- flaps ---------------- */
  function ownOpen(id) { if (Object.prototype.hasOwnProperty.call(S.local, id)) return S.local[id]; return !!S.doc.flaps[id]; }
  function effOpen(s) { return ownOpen(s.id) || (s.rides ? effOpen(S.byId[s.rides]) : false); }

  function updateFlaps(instant) {
    if (!S.def) return;
    var changedFlip = false, newly = [];
    S.def.surfaces.forEach(function (s) {
      if (s.kind !== 'flap') return;
      var el = S.flapEls[s.id], open = effOpen(s);
      var ang = open ? (s.mode === 'flip' ? 180 : (s.angle || 78)) : 0;
      el.style.transform = 'perspective(' + Math.max(LIFT_PERSPECTIVE, Math.round(3 * Math.hypot(s.w, s.h))) + 'px) rotate3d(' + s._u[0] + ',' + s._u[1] + ',0,' + ang + 'deg)';
      el.style.zIndex = open ? (s.mode === 'flip' ? 900 : 300) + s._i : 10 + s._i;
      if (el.classList.contains('is-open') !== open && s.mode === 'flip') changedFlip = true;
      el.classList.toggle('is-open', open);
      if (open && !S.prevOpen[s.id]) newly.push(s);
      S.prevOpen[s.id] = open;
    });
    if (S.els.match) S.els.match.hidden = !Object.keys(S.local).length;
    if (instant) return;
    if (S.focusId && !effOpen(S.byId[S.focusId])) { clearFocus(); return; }
    if (newly.length) {
      var roots = newly.filter(function (s) { return !(s.rides && newly.indexOf(S.byId[s.rides]) >= 0); });
      if (roots.length && S.autoFocus) { focusOn(roots[roots.length - 1]); return; }
    }
    if (changedFlip) fit(true);
  }

  function setFlap(id, open) {
    if (S.role === 'teacher') queueOp({ k: 'flap', id: id, open: open });
    else {
      if (open === !!S.doc.flaps[id]) delete S.local[id]; else S.local[id] = open;
      updateFlaps();
    }
  }

  /* ---------------- view: page, zoom, pan, flap focus ---------------- */
  function union(a, b) {
    if (!a) return { x: b.x, y: b.y, w: b.w, h: b.h };
    var x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
  }
  function footRect(s) { return s.shape ? G.bbox(s.shape) : { x: s.x, y: s.y, w: s.w, h: s.h }; }
  /* zoom the view onto a flap and everything it sits on */
  function focusOn(s) {
    var r = null, t = s;
    while (t) { r = union(r, footRect(t)); if (t.mode === 'flip') r = union(r, t._back); t = t.rides ? S.byId[t.rides] : null; }
    // include a strip beyond the hinge so the glued edge (e.g. a "Big Idea" header) stays in view
    var hs = s; while (hs.rides && S.byId[hs.rides]) hs = S.byId[hs.rides];
    if (hs.hinge && !hs.shape) { var hx = hs.hinge.x - 140 * hs._d[0], hy = hs.hinge.y - 140 * hs._d[1]; r = union(r, { x: hx, y: hy, w: 0, h: 0 }); }
    var pad = 40, MIN = 600;
    r = { x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad };
    if (r.w < MIN) { r.x -= (MIN - r.w) / 2; r.w = MIN; }
    if (r.h < MIN) { r.y -= (MIN - r.h) / 2; r.h = MIN; }
    S.focus = r;
    if (S.view !== 'both' && s.page && S.view !== s.page) { S.view = s.page; renderTabs(); }
    S.focusId = s.id; S.zoom = 1; S.pan = { x: 0, y: 0 };
    fit(true);
  }
  function clearFocus() {
    S.focus = null; S.focusId = null; S.zoom = 1; S.pan = { x: 0, y: 0 };
    fit(true);
  }
  /* 16:9 slides: each page is cut into sections. A spread file can list them (slides: { L: [[top, bottom], ...] });
     otherwise the page is cut into equal parts. */
  function pageSlides(side) {
    var def = S.def; if (!def) return [];
    var given = def.slides && def.slides[side];
    if (given && given.length) return given;
    var H = def.pageW * 9 / 16 * 1.15, n = Math.max(1, Math.ceil(def.pageH / H)), step = def.pageH / n, out = [];
    for (var i = 0; i < n; i++) out.push([Math.round(i * step), Math.round((i + 1) * step)]);
    return out;
  }
  function slideRect() {
    if (!S.slidesOn || !S.def || S.view === 'both') return null;
    var list = pageSlides(S.view), k = Math.max(0, Math.min(list.length - 1, S.slideIdx)), sl = list[k];
    var idx = Math.max(0, S.def.pages.map(function (p) { return p.side; }).indexOf(S.view));
    return { x: idx * S.def.pageW, y: sl[0], w: S.def.pageW, h: sl[1] - sl[0] };
  }
  function pageRect() {
    var def = S.def, pw = def.pageW, ph = def.pageH, rect;
    var sr = slideRect(); if (sr) return sr;
    if (S.view === 'both') rect = { x: 0, y: 0, w: pw * def.pages.length, h: ph };
    else { var idx = Math.max(0, def.pages.map(function (p) { return p.side; }).indexOf(S.view)); rect = { x: idx * pw, y: 0, w: pw, h: ph }; }
    def.surfaces.forEach(function (s) {
      if (s.kind === 'flap' && s.mode === 'flip' && effOpen(s) && s._back.x < rect.x + rect.w && s._back.x + s._back.w > rect.x) {
        var y0 = Math.min(rect.y, s._back.y); rect.h += rect.y - y0; rect.y = y0;
      }
    });
    return rect;
  }
  function fit(animate) {
    var def = S.def, vp = S.els.viewport, stage = S.els.stage; if (!def || !vp) return;
    var rect = S.focus || pageRect();
    var m = 18, vw = vp.clientWidth, vh = vp.clientHeight;
    var base = Math.min((vw - 2 * m) / rect.w, (vh - 2 * m) / rect.h);
    var sc = base * S.zoom;
    var cx = rect.x + rect.w / 2 + S.pan.x, cy = rect.y + rect.h / 2 + S.pan.y;
    // keep some of the notebook on screen
    cx = Math.max(-S.padTop, Math.min(def.pageW * def.pages.length, cx));
    cy = Math.max(-S.padTop, Math.min(def.pageH, cy));
    S.pan.x = cx - (rect.x + rect.w / 2); S.pan.y = cy - (rect.y + rect.h / 2);
    var tx = vw / 2 - cx * sc, ty = vh / 2 - (cy + S.padTop) * sc;
    stage.classList.toggle('no-anim', !animate);
    stage.style.transform = 'translate(' + f1(tx) + 'px,' + f1(ty) + 'px) scale(' + sc.toFixed(4) + ')';
    if (S.els.overlay) { S.els.overlay.style.transform = stage.style.transform; S.els.overlay.classList.toggle('no-anim', !animate); }
    stage.setAttribute('data-show', S.view);
    var spot = S.els.spot, sr = !S.focus && slideRect();
    if (spot) {
      spot.hidden = !sr;
      if (sr) { spot.style.left = sr.x + 'px'; spot.style.top = (sr.y + S.padTop) + 'px'; spot.style.width = sr.w + 'px'; spot.style.height = sr.h + 'px'; }
    }
    S.scale = sc; S.baseScale = base; S.cx = cx; S.cy = cy;
    syncViewUi();
  }
  function zoomAt(factor, clientX, clientY, animate) {
    var vp = S.els.viewport; if (!vp || !S.def) return;
    var r = vp.getBoundingClientRect();
    if (clientX == null) { clientX = r.left + r.width / 2; clientY = r.top + r.height / 2; }
    var sx = clientX - r.left - r.width / 2, sy = clientY - r.top - r.height / 2;
    var px = S.cx + sx / S.scale, py = S.cy + sy / S.scale;      // notebook point under the cursor
    S.zoom = Math.max(0.5, Math.min(8, S.zoom * factor));
    var sc = S.baseScale * S.zoom, rect = S.focus || pageRect();
    S.pan.x = (px - sx / sc) - (rect.x + rect.w / 2);
    S.pan.y = (py - sy / sc) - (rect.y + rect.h / 2);
    fit(!!animate);
  }
  function panBy(dx, dy) { S.pan.x -= dx / S.scale; S.pan.y -= dy / S.scale; fit(false); }
  function resetView() { S.zoom = 1; S.pan = { x: 0, y: 0 }; fit(true); }

  function showPage(side, slide) {
    S.slideIdx = slide === 'last' ? pageSlides(side).length - 1 : (slide || 0);
    S.view = side; S.focus = null; S.focusId = null; S.zoom = 1; S.pan = { x: 0, y: 0 };
    renderTabs(); fit(true);
  }
  /* step through pages; past the last page of a spread, go to the next spread in this objective */
  function goPage(dir) {
    if (!S.def) return;
    var sides = S.def.pages.map(function (p) { return p.side; });
    var i = S.view === 'both' ? (dir > 0 ? sides.length - 1 : 0) : sides.indexOf(S.view);
    if (S.slidesOn && S.view !== 'both') {
      var k = S.slideIdx + dir;
      if (k >= 0 && k < pageSlides(S.view).length) { showPage(S.view, k); return; }
    }
    if (S.view !== 'both' && sides[i + dir]) { showPage(sides[i + dir], dir > 0 ? 0 : 'last'); return; }
    var list = ((objById(S.objective) || {}).spreads || []), j = list.indexOf(S.spreadId) + dir;
    if (j < 0 || j >= list.length) { toast(dir > 0 ? 'This is the last page for this objective' : 'This is the first page'); return; }
    flushNow(); loadSpread(list[j], dir > 0 ? null : 'last');
  }

  function syncViewUi() {
    if (S.els.zoomPct) S.els.zoomPct.textContent = Math.round(S.zoom * 100) + '%';
    if (S.els.backBtn) S.els.backBtn.hidden = !S.focus;
    if (S.els.navPrev) {
      var sides = S.def ? S.def.pages.map(function (p) { return p.side; }) : [];
      var list = ((objById(S.objective) || {}).spreads || []), j = list.indexOf(S.spreadId);
      var moreSlides = S.slidesOn && S.view !== 'both', nS = moreSlides ? pageSlides(S.view).length : 1;
      S.els.navPrev.disabled = !(j > 0 || (S.view !== 'both' && sides.indexOf(S.view) > 0) || (moreSlides && S.slideIdx > 0));
      S.els.navNext.disabled = !(j < list.length - 1 || (S.view !== 'both' && sides.indexOf(S.view) < sides.length - 1) || (moreSlides && S.slideIdx < nS - 1));
    }
  }
  window.addEventListener('resize', function () { if (S.els.stage && document.body.contains(S.els.stage)) fit(false); });

  /* ---------------- hit testing ---------------- */
  function inPoly(pts, x, y) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function inRect(r, x, y) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
  function footprint(s, x, y) { return s.shape ? inPoly(s.shape, x, y) : inRect(s, x, y); }
  function zOrder() {
    return S.def.surfaces.slice().sort(function (a, b) {
      var za = (a.kind === 'flap' && a.mode === 'flip' && effOpen(a)) ? 1000 + a._i : a._i;
      var zb = (b.kind === 'flap' && b.mode === 'flip' && effOpen(b)) ? 1000 + b._i : b._i;
      return zb - za;
    });
  }
  /* which face would a pen touch at (x,y)? */
  function hitDraw(x, y) {
    var list = zOrder();
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.drawable === false) { if (footprint(s, x, y)) return null; continue; }
      if (s.kind === 'flap' && effOpen(s)) {
        if (s.mode === 'flip' && inRect(s._back, x, y)) return S.faces[s.id + '|1'];
        continue;
      }
      if (footprint(s, x, y)) return S.faces[s.id + '|0'];
    }
    return null;
  }
  function handleTap(x, y) {
    var flaps = zOrder().filter(function (s) { return s.kind === 'flap'; });
    for (var i = 0; i < flaps.length; i++) {
      var s = flaps[i];
      if (s.mode === 'flip' && effOpen(s) && inRect(s._back, x, y)) { setFlap(s.id, false); return true; }
    }
    var under = flaps.filter(function (s) { return footprint(s, x, y); });
    if (!under.length) return false;
    for (var k = 0; k < under.length; k++) if (!effOpen(under[k])) { setFlap(under[k].id, true); return true; }
    under.forEach(function (s) { if (ownOpen(s.id)) setFlap(s.id, false); });
    return true;
  }

  /* ---------------- pointer input ---------------- */
  function toLogical(e) {
    var r = S.els.stage.getBoundingClientRect(), sc = r.width / S.els.stage.offsetWidth;
    return { x: (e.clientX - r.left) / sc, y: (e.clientY - r.top) / sc - S.padTop };
  }
  function drawTool() { return S.role === 'teacher' && S.tool !== 'flip' && S.tool !== 'hand'; }

  function bindPointer(cap) {
    var pts = {}, gesture = null;
    function two() { var k = Object.keys(pts); return [pts[k[0]], pts[k[1]]]; }
    cap.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button === 2) return;
      try { cap.setPointerCapture(e.pointerId); } catch (er) {}
      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var n = Object.keys(pts).length;
      e.preventDefault();
      if (n === 2 && e.pointerType !== 'mouse') {            // two fingers: pinch to zoom / drag to move
        if (S.stroke) cancelStroke();
        cancelShape();
        S.ptr = null;
        var a = two(), vr = S.els.viewport.getBoundingClientRect();
        var c = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 };
        gesture = { d0: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1, zoom0: S.zoom,
          px: S.cx + (c.x - vr.left - vr.width / 2) / S.scale, py: S.cy + (c.y - vr.top - vr.height / 2) / S.scale };
        return;
      }
      if (n > 1 || S.ptr) return;
      var pan = e.button === 1 || S.space || !drawTool();
      S.ptr = { id: e.pointerId, cx: e.clientX, cy: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, pan: pan, mid: e.button === 1 };
      if (!pan) { var p = toLogical(e), face = hitDraw(p.x, p.y); if (face) { if (S.tool === 'line' || S.tool === 'graph') startShape(face, p); else startStroke(face, p); } }
    });
    cap.addEventListener('pointermove', function (e) {
      if (pts[e.pointerId]) pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (gesture) {
        if (Object.keys(pts).length < 2) return;
        var a = two(), vr = S.els.viewport.getBoundingClientRect();
        var c = { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 };
        S.zoom = Math.max(0.5, Math.min(8, gesture.zoom0 * Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) / gesture.d0));
        var sc = S.baseScale * S.zoom, rect = S.focus || pageRect();
        S.pan.x = gesture.px - (c.x - vr.left - vr.width / 2) / sc - (rect.x + rect.w / 2);
        S.pan.y = gesture.py - (c.y - vr.top - vr.height / 2) / sc - (rect.y + rect.h / 2);
        fit(false);
        return;
      }
      if (!S.ptr || S.ptr.id !== e.pointerId) return;
      if (Math.hypot(e.clientX - S.ptr.cx, e.clientY - S.ptr.cy) > 6) S.ptr.moved = true;
      if (S.ptr.pan) {
        if (S.ptr.moved) { panBy(e.clientX - S.ptr.lx, e.clientY - S.ptr.ly); S.ptr.lx = e.clientX; S.ptr.ly = e.clientY; cap.classList.add('panning'); }
        return;
      }
      if (S.shape) { updateShape(toLogical(e), e.shiftKey); return; }
      if (!S.stroke) return;
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (!evs.length) evs = [e];
      evs.forEach(function (ev) { addPoint(toLogical(ev)); });
      paintWet();
    });
    function end(e) {
      delete pts[e.pointerId];
      if (gesture) { if (Object.keys(pts).length === 0) gesture = null; return; }
      if (!S.ptr || S.ptr.id !== e.pointerId) return;
      var ptr = S.ptr; S.ptr = null;
      cap.classList.remove('panning');
      if (S.shape) { endShape(); return; }
      if (S.stroke) { endStroke(); return; }
      if (!ptr.moved && ptr.pan && !ptr.mid && !S.space && !(S.role === 'teacher' && S.tool === 'hand')) { var p = toLogical(e); handleTap(p.x, p.y); }
    }
    cap.addEventListener('pointerup', end);
    cap.addEventListener('pointercancel', function (e) {
      delete pts[e.pointerId];
      cancelShape();
      if (S.stroke) endStroke();
      if (Object.keys(pts).length === 0) gesture = null;
      S.ptr = null; cap.classList.remove('panning');
    });
    S.els.viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
      else panBy(-e.deltaX, -e.deltaY);
    }, { passive: false });
  }

  function inNotebook() { return S.def && S.els.stage && document.body.contains(S.els.stage); }
  document.addEventListener('keydown', function (e) {
    if (!inNotebook()) return;
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    var k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    // our zoom instead of the browser's (browser zoom only resizes the toolbars)
    if (mod && (k === '=' || k === '+')) { e.preventDefault(); zoomAt(1.25, null, null, true); return; }
    if (mod && (k === '-' || k === '_')) { e.preventDefault(); zoomAt(0.8, null, null, true); return; }
    if (mod && k === '0') { e.preventDefault(); resetView(); return; }
    if (S.role === 'teacher' && mod && k === 'z') { e.preventDefault(); doUndo(); return; }
    if (mod || e.altKey) return;
    if (k === 'arrowright' || k === 'pagedown') { e.preventDefault(); goPage(1); return; }
    if (k === 'arrowleft' || k === 'pageup') { e.preventDefault(); goPage(-1); return; }
    if (k === 'escape') { if (S.focus) clearFocus(); else resetView(); return; }
    if (k === ' ') { e.preventDefault(); S.space = true; return; }
    if (S.role !== 'teacher') return;
    if (k === 'p') setTool('pen'); else if (k === 'h') setTool('hl'); else if (k === 'e') setTool('er'); else if (k === 'f') setTool('flip'); else if (k === 'm') setTool('hand'); else if (k === 'l') setTool('line'); else if (k === 'g') setTool('graph'); else if (k === 'r') toggleProtractor();
  });
  document.addEventListener('keyup', function (e) { if (e.key === ' ') S.space = false; });

  /* =====================================================================
     MATH TOOLS
     - Line: straight pen line (snaps to flat/upright; hold Shift for 15° steps)
     - Graph: stamps a coordinate plane, Quadrant I, or number line as ordinary ink,
       so students see it live and Undo removes the whole graph at once
     - Protractor: a see-through protractor you drag and rotate (your screen only)
     ===================================================================== */
  var GRAPH_KINDS = [
    { id: 'q4', label: 'Coordinate plane', sub: '4 quadrants' },
    { id: 'q1', label: 'Quadrant I', sub: 'first quadrant only' },
    { id: 'nl', label: 'Number line', sub: 'with tick marks' }
  ];
  S.graph = { kind: 'q4', n: 10 };
  try { var gsaved = JSON.parse(store('nb.graph') || 'null'); if (gsaved && gsaved.kind) S.graph = gsaved; } catch (e) {}

  function prepWet(face) {
    var wet = S.els.wet, r = face.r;
    wet.width = Math.round(r.w * RES); wet.height = Math.round(r.h * RES);
    wet.style.left = r.x + 'px'; wet.style.top = (r.y + S.padTop) + 'px';
    wet.style.width = r.w + 'px'; wet.style.height = r.h + 'px';
    wet.style.clipPath = (!face.back && face.s.shape) ? polyCss(face.s.shape, r.x, r.y) : 'none';
    wet.hidden = false;
    var ctx = wet.getContext('2d');
    return ctx;
  }
  function clearWet(ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.setTransform(RES, 0, 0, RES, 0, 0); }

  function startShape(face, p) {
    var x = p.x - face.r.x, y = p.y - face.r.y;
    S.shape = { face: face, kind: S.tool, x0: x, y0: y, x1: x, y1: y, wctx: prepWet(face), list: [] };
    paintShape();
  }
  function updateShape(p, shift) {
    var sh = S.shape; sh.x1 = p.x - sh.face.r.x; sh.y1 = p.y - sh.face.r.y; sh.shift = shift;
    paintShape();
  }
  function shapeStrokes() {
    var sh = S.shape, r = sh.face.r;
    if (sh.kind === 'line') {
      var dx = sh.x1 - sh.x0, dy = sh.y1 - sh.y0, len = Math.hypot(dx, dy);
      if (len < 3) return [];
      var ang = Math.atan2(dy, dx), deg = ang * 180 / Math.PI;
      var step = sh.shift ? 15 : 90, snapped = Math.round(deg / step) * step;
      if (sh.shift || Math.abs(deg - snapped) < 4) { ang = snapped * Math.PI / 180; dx = len * Math.cos(ang); dy = len * Math.sin(ang); }
      return [{ t: 'pen', c: S.penColor, w: S.size, p: [sh.x0, sh.y0, sh.x0 + dx, sh.y0 + dy] }];
    }
    return graphStrokes(sh, r);
  }
  /* Build a graph in face-local units from the drag. Squares stay square. */
  function graphStrokes(sh, r) {
    var kind = S.graph.kind, n = S.graph.n;
    var dx = sh.x1 - sh.x0, dy = sh.y1 - sh.y0;
    var drag = kind === 'nl' ? Math.abs(dx) : Math.max(Math.abs(dx), Math.abs(dy));
    var size = drag < 40 ? (kind === 'nl' ? 520 : 360) : drag;
    var cell = size / n, out = [];
    var grid = '#a9b1c0', ink = '#1b1d24', gw = 1.5, aw = 3, arm = Math.max(10, Math.min(22, cell * 0.5));
    function seg(c, w, a, b, x2, y2) { out.push({ t: 'pen', c: c, w: w, p: [a, b, x2, y2] }); }
    function arrow(tx, ty, ux, uy) {             // tip at (tx,ty) pointing along (ux,uy)
      var px = -uy, py = ux;
      seg(ink, aw, tx, ty, tx - ux * arm + px * arm * 0.55, ty - uy * arm + py * arm * 0.55);
      seg(ink, aw, tx, ty, tx - ux * arm - px * arm * 0.55, ty - uy * arm - py * arm * 0.55);
    }
    function letterX(cx, cy, s) { seg(ink, 2.5, cx - s, cy - s, cx + s, cy + s); seg(ink, 2.5, cx + s, cy - s, cx - s, cy + s); }
    function letterY(cx, cy, s) { seg(ink, 2.5, cx - s, cy - s, cx, cy); seg(ink, 2.5, cx + s, cy - s, cx, cy); seg(ink, 2.5, cx, cy, cx, cy + s); }
    var lx = 12;                                  // letter half-size
    if (kind === 'nl') {
      var sx = dx < 0 && drag >= 40 ? sh.x0 - size : sh.x0, y = sh.y0;
      sx = Math.max(arm + 6, Math.min(r.w - size - arm - 6, sx));
      var ext = Math.max(arm + 6, cell * 0.6);
      seg(ink, aw, sx - ext, y, sx + size + ext, y);
      arrow(sx - ext, y, -1, 0); arrow(sx + size + ext, y, 1, 0);
      var tick = Math.max(8, Math.min(16, cell * 0.3));
      for (var i = 0; i <= n; i++) { var t = i === n / 2 ? tick * 1.6 : tick; seg(ink, 2.5, sx + i * cell, y - t, sx + i * cell, y + t); }
      return out;
    }
    // square box anchored at the drag start, growing toward the drag
    var bx = dx < 0 && drag >= 40 ? sh.x0 - size : sh.x0, by = dy < 0 && drag >= 40 ? sh.y0 - size : sh.y0;
    if (drag < 40) { bx = sh.x0 - size / 2; by = sh.y0 - size / 2; }
    var margin = arm + 30;
    bx = Math.max(margin, Math.min(r.w - size - margin, bx));
    by = Math.max(margin, Math.min(r.h - size - margin, by));
    for (var k = 0; k <= n; k++) {
      seg(grid, gw, bx + k * cell, by, bx + k * cell, by + size);
      seg(grid, gw, bx, by + k * cell, bx + size, by + k * cell);
    }
    var e2 = Math.max(arm + 8, cell * 0.7);
    if (kind === 'q4') {
      var ax = bx + size / 2, ay = by + size / 2;
      seg(ink, aw, bx - e2, ay, bx + size + e2, ay); arrow(bx - e2, ay, -1, 0); arrow(bx + size + e2, ay, 1, 0);
      seg(ink, aw, ax, by - e2, ax, by + size + e2); arrow(ax, by - e2, 0, -1); arrow(ax, by + size + e2, 0, 1);
      letterX(bx + size + e2 + lx + 6, ay + lx + 8, lx * 0.7);
      letterY(ax + lx + 10, by - e2 - 4, lx * 0.7);
    } else {
      var ox = bx, oy = by + size;
      seg(ink, aw, ox, oy, bx + size + e2, oy); arrow(bx + size + e2, oy, 1, 0);
      seg(ink, aw, ox, oy, ox, by - e2); arrow(ox, by - e2, 0, -1);
      letterX(bx + size + e2 + lx + 6, oy + lx + 8, lx * 0.7);
      letterY(ox + lx + 10, by - e2 - 4, lx * 0.7);
    }
    return out;
  }
  function paintShape() {
    var sh = S.shape; if (!sh) return;
    clearWet(sh.wctx);
    sh.list = shapeStrokes();
    sh.list.forEach(function (st) { drawStroke(sh.wctx, st); });
  }
  function endShape() {
    var sh = S.shape; S.shape = null; S.els.wet.hidden = true;
    var list = sh.list; if (!list.length) return;
    var group = list.length > 1 ? 'g' + uid() + '-' : null;
    list.forEach(function (st, i) {
      st.id = group ? group + i : uid(); st.s = sh.face.s.id; st.b = sh.face.back ? 1 : 0;
      st.p = st.p.map(function (v) { return Math.round(v); });
      queueOp({ k: 'add', st: st });
    });
  }
  function cancelShape() { if (S.shape) { S.shape = null; S.els.wet.hidden = true; } }

  function openGraphMenu(anchor) {
    var old = $('.graphmenu'); if (old) { old.remove(); return; }
    var r = anchor.getBoundingClientRect();
    var m = h('div', { class: 'clearmenu graphmenu', role: 'dialog', 'aria-label': 'Graph' }, '<p>Pick a graph, then drag on the page to size it. A click places a standard size.</p>');
    var seg = h('div', { class: 'gsize' }, '<span>Squares across</span>');
    [10, 20].forEach(function (n) {
      var b = h('button', { 'aria-pressed': String(S.graph.n === n) }, String(n));
      b.addEventListener('click', function () {
        S.graph.n = n; store('nb.graph', JSON.stringify(S.graph));
        seg.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      });
      seg.appendChild(b);
    });
    m.appendChild(seg);
    GRAPH_KINDS.forEach(function (k) {
      var b = h('button', { class: 'gopt', 'aria-pressed': String(S.graph.kind === k.id) }, graphIcon(k.id) + '<span><b>' + k.label + '</b><small>' + k.sub + '</small></span>');
      b.addEventListener('click', function () { S.graph.kind = k.id; store('nb.graph', JSON.stringify(S.graph)); m.remove(); setTool('graph'); });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    var right = S.els.body && S.els.body.classList.contains('rail-right');
    var left = right ? r.left - m.offsetWidth - 10 : r.right + 10;
    m.style.left = Math.max(8, left) + 'px'; m.style.top = Math.max(12, Math.min(r.top, window.innerHeight - m.offsetHeight - 12)) + 'px';
    setTimeout(function () {
      document.addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) m.remove(); document.removeEventListener('pointerdown', off, true); }, true);
    }, 0);
  }
  function graphIcon(kind) {
    var g = '<svg viewBox="0 0 32 32" width="32" height="32" fill="none" stroke-linecap="round">';
    if (kind === 'nl') return g + '<path d="M3 16h26" stroke="currentColor" stroke-width="2"/><path d="M8 12v8M13 12v8M18 12v8M23 12v8" stroke="currentColor" stroke-width="1.5"/></svg>';
    var grid = '<path d="M6 6v20M11 6v20M16 6v20M21 6v20M26 6v20M6 6h20M6 11h20M6 16h20M6 21h20M6 26h20" stroke="currentColor" stroke-opacity=".35" stroke-width="1"/>';
    if (kind === 'q1') return g + grid + '<path d="M6 26h22M6 26V4" stroke="currentColor" stroke-width="2.2"/></svg>';
    return g + grid + '<path d="M3 16h26M16 3v26" stroke="currentColor" stroke-width="2.2"/></svg>';
  }

  /* ---------------- protractor (on your screen only) ---------------- */
  var PROT_R = 300;
  function protractorSvg() {
    var R = PROT_R, s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + (-R - 6) + ' ' + (-R - 6) + ' ' + (2 * R + 12) + ' ' + (R + 46) + '">';
    s += '<path d="M' + (-R) + ' 0 A' + R + ' ' + R + ' 0 0 1 ' + R + ' 0 L' + R + ' 34 L' + (-R) + ' 34 Z" fill="rgba(120,170,255,.16)" stroke="#2f5fa8" stroke-width="2"/>';
    for (var d = 0; d <= 180; d++) {
      var a = Math.PI - d * Math.PI / 180, L = d % 10 === 0 ? 30 : d % 5 === 0 ? 20 : 11;
      var c = Math.cos(a), sn = -Math.sin(a);
      s += '<line x1="' + f1(R * c) + '" y1="' + f1(R * sn) + '" x2="' + f1((R - L) * c) + '" y2="' + f1((R - L) * sn) + '" stroke="#2f5fa8" stroke-width="' + (d % 10 === 0 ? 1.8 : 1) + '"/>';
      if (d % 10 === 0) {
        var t1 = R - 46, t2 = R - 76, rot = 90 - d;
        s += '<text x="' + f1(t1 * c) + '" y="' + f1(t1 * sn) + '" font-size="15" text-anchor="middle" dominant-baseline="middle" fill="#1f3f73" transform="rotate(' + (-rot) + ' ' + f1(t1 * c) + ' ' + f1(t1 * sn) + ')">' + d + '</text>';
        if (d > 0 && d < 180) s += '<text x="' + f1(t2 * c) + '" y="' + f1(t2 * sn) + '" font-size="12" text-anchor="middle" dominant-baseline="middle" fill="#a8434a" transform="rotate(' + (-rot) + ' ' + f1(t2 * c) + ' ' + f1(t2 * sn) + ')">' + (180 - d) + '</text>';
      }
    }
    s += '<line x1="' + (-R + 10) + '" y1="0" x2="' + (R - 10) + '" y2="0" stroke="#2f5fa8" stroke-width="1.5"/>';
    s += '<circle cx="0" cy="0" r="5" fill="none" stroke="#a8434a" stroke-width="2"/><line x1="0" y1="-12" x2="0" y2="12" stroke="#a8434a" stroke-width="1.5"/>';
    s += '</svg>';
    return s;
  }
  function toggleProtractor() {
    var ov = S.els.overlay; if (!ov) return;
    if (S.prot) { S.prot.el.remove(); S.prot = null; syncRail(); return; }
    var sr = S.focus || pageRect();
    var el = h('div', { class: 'protractor', role: 'group', 'aria-label': 'Protractor' }, protractorSvg() +
      '<button class="prot-rot" title="Drag to rotate" aria-label="Rotate protractor"></button><button class="prot-x" title="Put the protractor away" aria-label="Put the protractor away">×</button>');
    ov.appendChild(el);
    S.prot = { el: el, x: sr.x + sr.w / 2, y: sr.y + sr.h * 0.65, a: 0 };
    placeProt();
    el.querySelector('.prot-x').addEventListener('click', toggleProtractor);
    function drag(mode) {
      return function (e) {
        e.preventDefault(); e.stopPropagation();
        var startP = toLogical(e), start = { x: S.prot.x, y: S.prot.y, a: S.prot.a };
        var a0 = Math.atan2(startP.y - S.prot.y, startP.x - S.prot.x);
        function mv(ev) {
          var p = toLogical(ev);
          if (mode === 'move') { S.prot.x = start.x + p.x - startP.x; S.prot.y = start.y + p.y - startP.y; }
          else {
            var a = start.a + (Math.atan2(p.y - S.prot.y, p.x - S.prot.x) - a0) * 180 / Math.PI;
            var snap = Math.round(a / 15) * 15; S.prot.a = Math.abs(a - snap) < 2.5 ? snap : a;
          }
          placeProt();
        }
        function up() { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); }
        window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
      };
    }
    el.querySelector('svg').addEventListener('pointerdown', drag('move'));
    el.querySelector('.prot-rot').addEventListener('pointerdown', drag('rotate'));
    syncRail();
  }
  function placeProt() {
    var P = S.prot; if (!P) return;
    P.el.style.left = (P.x - PROT_R - 6) + 'px'; P.el.style.top = (P.y - PROT_R - 6 + S.padTop) + 'px';
    P.el.style.transformOrigin = (PROT_R + 6) + 'px ' + (PROT_R + 6) + 'px';
    P.el.style.transform = 'rotate(' + P.a.toFixed(2) + 'deg)';
  }

  /* ---------------- strokes ---------------- */
  function startStroke(face, p) {
    var w = S.tool === 'hl' ? PALETTE.highlighterWidth : S.tool === 'er' ? PALETTE.eraserWidth : S.size;
    var c = S.tool === 'hl' ? S.hlColor : S.tool === 'er' ? '' : S.penColor;
    var lx = Math.round(p.x - face.r.x), ly = Math.round(p.y - face.r.y);
    S.stroke = { face: face, st: { id: uid(), s: face.s.id, b: face.back ? 1 : 0, t: S.tool, c: c, w: w, p: [lx, ly] } };
    if (S.tool !== 'er') {
      var wet = S.els.wet, r = face.r;
      wet.width = Math.round(r.w * RES); wet.height = Math.round(r.h * RES);
      wet.style.left = r.x + 'px'; wet.style.top = (r.y + S.padTop) + 'px';
      wet.style.width = r.w + 'px'; wet.style.height = r.h + 'px';
      wet.style.clipPath = (!face.back && face.s.shape) ? polyCss(face.s.shape, r.x, r.y) : 'none';
      wet.hidden = false;
      S.stroke.wctx = wet.getContext('2d');
    }
    paintWet();
  }
  function addPoint(p) {
    var st = S.stroke.st, r = S.stroke.face.r;
    var x = Math.round(p.x - r.x), y = Math.round(p.y - r.y);
    var n = st.p.length, lx = st.p[n - 2], ly = st.p[n - 1];
    if (Math.hypot(x - lx, y - ly) < 1.6) return;
    if (st.t === 'er') { // erase as we go
      var ctx = S.stroke.face.ctx;
      ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.lineCap = 'round'; ctx.lineWidth = st.w;
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(x, y); ctx.stroke(); ctx.restore();
    }
    st.p.push(x, y);
  }
  function paintWet() {
    var sk = S.stroke; if (!sk) return;
    if (sk.st.t === 'er') {
      if (sk.st.p.length === 2) { var c = sk.face.ctx; c.save(); c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(sk.st.p[0], sk.st.p[1], sk.st.w / 2, 0, 7); c.fill(); c.restore(); }
      return;
    }
    var w = sk.wctx; w.setTransform(1, 0, 0, 1, 0, 0); w.clearRect(0, 0, w.canvas.width, w.canvas.height);
    w.setTransform(RES, 0, 0, RES, 0, 0);
    drawStroke(w, sk.st);
  }
  function cancelStroke() {             // a second finger landed: this was a pinch, not a stroke
    var sk = S.stroke; if (!sk) return;
    if (sk.st.t === 'er') { endStroke(); return; }
    S.stroke = null; S.els.wet.hidden = true;
  }
  function endStroke() {
    var sk = S.stroke; S.stroke = null;
    if (sk.st.t !== 'er') { drawStroke(sk.face.ctx, sk.st); S.els.wet.hidden = true; }
    queueOp({ k: 'add', st: sk.st }, true);
  }
  function drawStroke(ctx, st) {
    var p = st.p; if (!p || p.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = st.w;
    if (st.t === 'er') { ctx.globalCompositeOperation = 'destination-out'; ctx.strokeStyle = ctx.fillStyle = '#000'; }
    else { ctx.strokeStyle = ctx.fillStyle = st.c; if (st.t === 'hl') ctx.globalAlpha = 0.4; }
    if (p.length === 2) { ctx.beginPath(); ctx.arc(p[0], p[1], st.w / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    for (var i = 2; i < p.length - 2; i += 2) {
      var mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
      ctx.quadraticCurveTo(p[i], p[i + 1], mx, my);
    }
    ctx.lineTo(p[p.length - 2], p[p.length - 1]);
    ctx.stroke(); ctx.restore();
  }
  function faceOf(st) { return S.faces[st.s + '|' + (st.b ? 1 : 0)]; }
  function redrawFace(face) {
    if (!face) return;
    var ctx = face.ctx; ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, face.cv.width, face.cv.height); ctx.restore();
    S.doc.strokes.forEach(function (st) { if (faceOf(st) === face) drawStroke(ctx, st); });
  }
  function redrawAll() { Object.keys(S.faces).forEach(function (k) { redrawFace(S.faces[k]); }); }

  /* ---------------- ops (same rules as the server) ---------------- */
  function applyOp(op, render) {
    var d = S.doc;
    if (op.k === 'add') {
      for (var i = 0; i < d.strokes.length; i++) if (d.strokes[i].id === op.st.id) return;
      var last = d.strokes[d.strokes.length - 1];
      if (op.st.o != null && last && last.o != null && op.st.o < last.o) {
        var at = d.strokes.length;
        while (at > 0 && d.strokes[at - 1].o != null && d.strokes[at - 1].o > op.st.o) at--;
        d.strokes.splice(at, 0, op.st);
        if (render) redrawFace(faceOf(op.st));
        return;
      }
      d.strokes.push(op.st);
      if (render) { var f = faceOf(op.st); if (f) drawStroke(f.ctx, op.st); }
    } else if (op.k === 'undo') {
      var hit = null;
      d.strokes = d.strokes.filter(function (s) { if (s.id === op.id) { hit = s; return false; } return true; });
      if (hit && render) redrawFace(faceOf(hit));
    } else if (op.k === 'clear') {
      var ids = op.ids ? op.ids.reduce(function (m, id) { m[id] = 1; return m; }, {}) : null;
      var touched = {};
      d.strokes = d.strokes.filter(function (s) { if (!ids || ids[s.s]) { touched[s.s + '|' + (s.b ? 1 : 0)] = 1; return false; } return true; });
      if (render) Object.keys(touched).forEach(function (k) { redrawFace(S.faces[k]); });
    } else if (op.k === 'flap') {
      d.flaps[op.id] = !!op.open;
      if (S.role !== 'teacher') delete S.local[op.id];
      if (render) updateFlaps();
    } else if (op.k === 'flapsReset') {
      d.flaps = {}; S.local = {};
      if (render) updateFlaps();
    }
  }

  var orderSeq = 0;
  function queueOp(op, alreadyDrawn) {
    op.oid = uid(); S.mine[op.oid] = 1;
    op._ctx = S.period + '|' + S.spreadId;
    if (op.k === 'add' && op.st && op.st.o == null) op.st.o = Date.now() * 1000 + (orderSeq++ % 1000);
    if (op.k === 'clear') {
      var cids = op.ids ? op.ids.reduce(function (m, id) { m[id] = 1; return m; }, {}) : null;
      op.del = S.doc.strokes.filter(function (st) { return !cids || cids[st.s]; }).map(function (st) { return st.id; });
    }
    applyOp(op, !alreadyDrawn);
    if (alreadyDrawn && op.k === 'add') { /* stroke already on canvas */ }
    S.queue.push(op);
    flushSoon();
  }
  function doUndo() {
    var last = S.doc.strokes[S.doc.strokes.length - 1];
    if (!last) { toast('Nothing to undo'); return; }
    var g = /^(g[a-z0-9]+-)\d+$/.exec(last.id);
    if (g) { S.doc.strokes.filter(function (st) { return st.id.indexOf(g[1]) === 0; }).reverse().forEach(function (st) { queueOp({ k: 'undo', id: st.id }); }); return; }
    queueOp({ k: 'undo', id: last.id });
  }

  var flushTimer = null;
  function flushSoon() { if (!flushTimer) flushTimer = setTimeout(function () { flushTimer = null; flush(); }, 250); }
  function flushNow() { clearTimeout(flushTimer); flushTimer = null; flush(); }
  function flush() {
    if (S.inflight || !S.queue.length) return;
    var ctx = S.queue[0]._ctx, batch = [];
    while (S.queue.length && S.queue[0]._ctx === ctx && batch.length < 40) batch.push(S.queue.shift());
    var parts = ctx.split('|');
    var clean = batch.map(function (o) { var c = {}; Object.keys(o).forEach(function (k) { if (k !== '_ctx') c[k] = o[k]; }); return c; });
    S.inflight = batch; setStatus('busy', 'Saving…');
    api.call('nbSubmit', parts[0], parts[1], clean, BOOT.key || '').then(function () {
      S.inflight = null; S.lastOk = Date.now();
      if (S.queue.length) flush(); else setStatus('ok', 'Saved · live');
    }, function (err) {
      S.inflight = null; S.queue = batch.concat(S.queue);
      setStatus('bad', 'Not saved yet · retrying');
      if (err && /teacher/i.test(String(err.message || err))) { toast('Only the teacher account can write on the notebook.'); S.queue = []; return; }
      setTimeout(flush, 3000);
    });
  }

  function setStatus(kind, text) {
    var el = S.els.status; if (!el) return;
    el.className = 'status ' + kind; el.querySelector('.t').textContent = text; el.title = text;
  }

  /* ---------------- live sync (polling) ---------------- */
  function startSync() {
    prefetchNext();
    if (api.subscribe) { startLive(); return; }
    var gen = ++S.gen, period = S.period, spread = S.spreadId, first = true, misses = 0;
    setStatus('busy', 'Connecting…');
    (function loop() {
      if (gen !== S.gen) return;
      api.call('nbPoll', period, spread, S.doc.seq).then(function (r) {
        if (gen !== S.gen) return;
        misses = 0; S.lastOk = Date.now();
        receive(r);
        if (first) { first = false; }
        if (!S.inflight && !S.queue.length) setStatus('ok', S.role === 'teacher' ? 'Saved · live' : 'Live');
      }, function () {
        if (gen !== S.gen) return;
        misses++; if (misses > 1) setStatus('bad', 'Reconnecting…');
      }).then(function () {
        if (gen !== S.gen) return;
        var hidden = document.visibilityState === 'hidden';
        var ms = S.role === 'teacher' ? 5000 : (hidden ? 6000 : (CFG.pollMs || 1500));
        setTimeout(loop, ms);
      });
    })();
  }

  function idleStatus() { if (!S.inflight && !S.queue.length) setStatus('ok', S.role === 'teacher' ? 'Saved · live' : 'Live'); }
  function startLive() {
    var gen = ++S.gen, period = S.period, spread = S.spreadId, ready = false, online = true;
    stopLive();
    setStatus('busy', 'Connecting…');
    S.unsub = api.subscribe(period, spread, {
      full: function (strokes, flaps) {
        if (gen !== S.gen) return;
        ready = true; S.lastOk = Date.now();
        receive({ seq: 0, full: { strokes: strokes, flaps: flaps } });
        if (online) idleStatus();
      },
      add: function (st) { if (gen === S.gen && ready) applyOp({ k: 'add', st: st }, true); },
      remove: function (id) { if (gen === S.gen && ready) applyOp({ k: 'undo', id: id }, true); },
      flaps: function (f) {
        if (gen !== S.gen || !ready) return;
        var old = S.doc.flaps || {};
        if (S.role !== 'teacher') Object.keys(S.local).forEach(function (k) { if (!!old[k] !== !!f[k]) delete S.local[k]; });
        S.doc.flaps = f; updateFlaps();
      },
      connected: function (yes) {
        if (gen !== S.gen) return;
        online = yes;
        if (!yes) setStatus('bad', 'Reconnecting…'); else if (ready) idleStatus();
      },
      error: function (err) {
        if (gen !== S.gen) return;
        setStatus('bad', 'Not connected');
        toast('The notebook lost its connection. Refresh the page to try again.');
      }
    });
  }

  function receive(r) {
    if (!r) return;
    if (r.full) {
      S.doc = { seq: r.seq, strokes: r.full.strokes || [], flaps: r.full.flaps || {} };
      // re-apply anything we have not finished sending
      (S.inflight || []).concat(S.queue).forEach(function (op) { if (op._ctx === S.period + '|' + S.spreadId) applyOp(op, false); });
      if (S.role !== 'teacher') S.local = {};
      redrawAll(); updateFlaps(true); fit(false);
      return;
    }
    (r.ops || []).forEach(function (o) {
      if (o.o.oid && S.mine[o.o.oid]) return;
      applyOp(o.o, true);
    });
    S.doc.seq = r.seq;
  }

  /* =====================================================================
     START
     ===================================================================== */
  NB.start = function () {
    var prm = BOOT.params || {};
    var pid = prm.period && periodById(prm.period) ? prm.period : (store('nb.period') && periodById(store('nb.period')) ? store('nb.period') : null);
    S.period = pid;
    var sid = prm.spread && (CFG.spreads || []).some(function (x) { return x.id === prm.spread; }) ? prm.spread : null;
    var oid = prm.obj && objById(prm.obj) ? prm.obj : null;
    if (sid && !oid) { objectives().some(function (o) { if ((o.spreads || []).indexOf(sid) >= 0) { oid = o.id; return true; } }); }
    if (oid && !sid) sid = (objById(oid).spreads || [])[0];
    if (S.period && oid && sid) openNotebook(S.period, oid, sid);
    else { if (oid && sid) S.pending = { oid: oid, sid: sid }; renderLanding(); }
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flushNow(); });
  };
})();
