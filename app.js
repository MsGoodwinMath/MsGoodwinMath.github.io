/* Interactive Notebook: starts the app.
   1. Connects to Firebase (keys in firebase-config.js)
   2. Checks whether the teacher is signed in (students never sign in)
   3. Reads notebook-config.json (periods, units, SLOs, pages)
   4. Loads the notebook engine */
(function () {
  'use strict';
  var NB = window.NB = window.NB || {};
  var app = document.getElementById('app');

  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function problem(title, text) {
    app.innerHTML = '<main class="landing"><div class="landing-inner"><header class="land-head"><span class="eyebrow">Interactive notebook</span>' +
      '<h1 style="font-size:32px">' + esc(title) + '</h1><p>' + text + '</p></header></div></main>';
  }
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); };
      document.body.appendChild(s);
    });
  }

  var firstPage = function (id) { var n = parseInt(String(id), 10); return isNaN(n) ? 99999 : n; };
  /* Applies teacher-hub changes ({id: {label, title, file, obj, src:'db'} or {hidden:true}}) to a notebook config. */
  NB.mergeContent = function (c, extra) {
    c = JSON.parse(JSON.stringify(c || {}));
    c.spreads = c.spreads || []; c.objectives = c.objectives || [];
    Object.keys(extra || {}).forEach(function (id) {
      var e = extra[id] || {};
      c.objectives.forEach(function (o) {
        if (e.hidden || (e.obj && o.id !== e.obj)) o.spreads = (o.spreads || []).filter(function (x) { return x !== id; });
      });
      if (e.hidden) { c.spreads = c.spreads.filter(function (s) { return s.id !== id; }); return; }
      var cur = c.spreads.filter(function (s) { return s.id === id; })[0];
      if (!cur) { cur = { id: id }; c.spreads.push(cur); }
      if (e.label) cur.label = e.label;
      if (e.title) cur.title = e.title;
      if (Array.isArray(e.videos)) cur.videos = e.videos; else if (e.videos === 'none') cur.videos = [];
      if (e.src === 'db') { cur.src = 'db'; cur.file = e.file || cur.file || id; }
      if (e.obj) {
        var o = c.objectives.filter(function (x) { return x.id === e.obj; })[0];
        if (o) {
          o.spreads = o.spreads || [];
          if (o.spreads.indexOf(id) < 0) o.spreads.push(id);
          var key = function (id) { var sp = c.spreads.filter(function (x) { return x.id === id; })[0]; return sp && sp.sort != null ? +sp.sort : firstPage(id); };
          o.spreads.sort(function (a, b) { return key(a) - key(b); });
        }
      }
    });
    return c;
  };

  var cfg = window.NB_FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || /PASTE/.test(cfg.apiKey)) {
    problem('Almost there', 'Paste your Firebase web app keys into <b>firebase-config.js</b>, then deploy again.');
    return;
  }
  firebase.initializeApp(cfg);
  var auth = firebase.auth();
  var teachers = (window.NB_TEACHER_EMAILS || []).map(function (e) { return String(e).toLowerCase(); });

  var firstUser = new Promise(function (res) { var off = auth.onAuthStateChanged(function (u) { off(); res(u); }); });
  var config = fetch('notebook-config.json', { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('notebook-config.json is missing.');
    return r.text();
  }).then(function (t) {
    try { return JSON.parse(t.replace(/^﻿/, '')); }
    catch (e) { throw new Error('notebook-config.json has a typo: ' + e.message); }
  });

  /* Pages added or changed in the teacher hub (/teacher/) live in the database under content/spreads.
     They are merged over notebook-config.json here. */
  var extras = firebase.database().ref('content/spreads').once('value')
    .then(function (s) { return s.val() || {}; }, function () { return {}; });
  var extrasOrNothing = Promise.race([extras, new Promise(function (r) { setTimeout(function () { r({}); }, 6000); })]);

  /* Lesson videos for the hub: the built-in list plus lessons added in the teacher hub. */
  var lessonsP = Promise.all([
    fetch('/lessons/lessons.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; }),
    Promise.race([firebase.database().ref('content/lessons').once('value').then(function (s) { return s.val() || {}; }, function () { return {}; }),
      new Promise(function (r) { setTimeout(function () { r({}); }, 6000); })])
  ]).then(function (r) {
    var list = (r[0] || []).map(function (l) { return { slug: l.slug, title: l.title, group: l.group, pages: l.pages }; }), extra = r[1] || {};
    Object.keys(extra).forEach(function (slug) {
      var e = extra[slug] || {};
      list = list.filter(function (l) { return l.slug !== slug; });
      if (!e.hidden && e.title) list.push({ slug: slug, title: e.title, group: e.group || '', pages: e.pages || '' });
      else if (e.hidden) list = list.filter(function (l) { return l.slug !== slug; });
    });
    return list;
  });

  Promise.all([firstUser, config, extrasOrNothing, lessonsP]).then(function (r) {
    var user = r[0], c = NB.mergeContent(r[1], r[2]);
    var email = user && user.email ? user.email.toLowerCase() : '';
    var teacher = !!email && teachers.indexOf(email) >= 0;
    var q = new URLSearchParams(location.search);
    window.NB_BOOT = {
      role: teacher ? 'teacher' : 'student',
      email: teacher ? email : '',
      key: '',
      appUrl: location.origin + location.pathname,
      params: { period: q.get('period') || '', obj: q.get('obj') || '', spread: q.get('spread') || '' },
      config: {
        title: c.title || 'Class Notebook', hubTitle: c.hubTitle || '',
        periods: c.periods || [], units: c.units || [], objectives: c.objectives || [],
        spreads: (c.spreads || []).map(function (s) { return { id: s.id, label: s.label, title: s.title, file: s.file, src: s.src || '', sort: s.sort, videos: s.videos || [] }; }),
        pollMs: c.pollMs || 1500
      },
      lessons: r[3] || [],
      lessonBase: '/lessons/?lesson=',
      signedInNotTeacher: !!email && !teacher ? email : ''
    };
    document.title = window.NB_BOOT.config.title;
    return loadScript('engine.js');
  }).then(function () {
    var fonts = document.fonts ? document.fonts.ready : Promise.resolve();
    return Promise.race([fonts, new Promise(function (r) { setTimeout(r, 2500); })]);
  }).then(function () {
    NB.start();
  }).catch(function (err) {
    problem('The notebook could not open', esc(err && err.message || err) + '<br><br>Check your internet connection, then refresh the page.');
  });

  /* ---------- the bottom of the start page: teacher sign-in / sign-out / bring over old ink ---------- */
  var LESSONS_LINK = '<a class="lessons-link" href="/lessons/"><span class="ll-ic" aria-hidden="true">▶</span>' +
    '<span><b>Lesson videos</b><small>Watch a lesson again at your own pace</small></span></a>';
  (function () {
    var css = document.createElement('style');
    css.textContent = '.lessons-link{display:flex;align-items:center;gap:12px;margin:16px 0 4px;padding:12px 16px;border:1.5px solid var(--line,#d9dee8);' +
      'border-radius:14px;background:var(--card,#fff);color:var(--ink,#1d2433);text-decoration:none;max-width:420px}' +
      '.lessons-link:hover{border-color:var(--ink,#1d2433)}.lessons-link:focus-visible{outline:3px solid #6a4fc0;outline-offset:2px}' +
      '.lessons-link .ll-ic{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:#e8dffb;color:#4b3592;font-size:14px}' +
      '.lessons-link b{display:block;font-size:15px}.lessons-link small{display:block;font-size:13px;color:var(--muted,#596377)}';
    document.head.appendChild(css);
  })();

  /* Google sign-in (pop-up, or a full-page redirect if the pop-up is blocked). Resolves true when signed in. */
  NB.googleSignIn = function (auth) {
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ hd: 'yumaunion.org', prompt: 'select_account' });
    return auth.signInWithPopup(provider).then(function () { return true; }, function (x) {
      var code = (x && x.code) || '';
      if (/popup-blocked|operation-not-supported|web-storage-unsupported/.test(code)) return auth.signInWithRedirect(provider).then(function () { return false; });
      if (/popup-closed|cancelled-popup/.test(code)) return false;
      throw /operation-not-allowed/.test(code) ? 'Google sign-in isn\'t turned on yet. In the Firebase console: Authentication, Sign-in method, Google.'
        : /unauthorized-domain/.test(code) ? 'This address isn\'t allowed for Google sign-in yet. In the Firebase console: Authentication, Settings, Authorized domains.'
        : /network/.test(code) ? 'Couldn\'t reach Google. The school network may be blocking the sign-in window. Use your password instead.'
        : 'Google sign-in didn\'t work (' + (code || x) + '). Use your password instead.';
    });
  };
  (function () {
    var css = document.createElement('style');
    css.textContent = '.signin-google{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;font:inherit;font-weight:600;font-size:15px;' +
      'padding:10px 14px;border-radius:10px;border:1.5px solid var(--line,#d9dee8);background:#fff;color:#1f1f1f;cursor:pointer;margin-top:4px}' +
      '.signin-google:hover{border-color:#1f1f1f}.signin-google:focus-visible{outline:3px solid var(--focus,#6aa1f0);outline-offset:2px}' +
      '.signin-or{display:flex;align-items:center;gap:10px;margin:14px 0 2px;font-size:12px;color:var(--muted,#596377)}' +
      '.signin-or::before,.signin-or::after{content:"";flex:1;height:1px;background:var(--line,#d9dee8)}';
    document.head.appendChild(css);
  })();

  NB.onLanding = function (slot, role) {
    if (!slot) return;
    var B = window.NB_BOOT || {};
    if (role === 'teacher') {
      slot.innerHTML = '<div class="teacher-bar"><span>Signed in as <b>' + esc(B.email) + '</b></span>' +
        '<a class="linkbtn" href="/teacher/">Teacher hub: add or replace lessons and pages</a>' +
        '<button type="button" class="linkbtn" id="nbImport" hidden>Bring over ink from the old notebook</button>' +
        '<button type="button" class="linkbtn" id="nbSignOut">Sign out</button></div><p class="import-status" id="nbImportStatus" hidden></p>';
      slot.querySelector('#nbSignOut').addEventListener('click', function () { auth.signOut().then(function () { location.reload(); }); });
      offerImport(slot);
    } else {
      slot.innerHTML = '<div class="teacher-bar">' +
        (B.signedInNotTeacher ? '<span>Signed in as ' + esc(B.signedInNotTeacher) + ', which is not a teacher account.</span><button type="button" class="linkbtn" id="nbSignOut">Sign out</button>'
          : '<button type="button" class="linkbtn" id="nbSignIn">Teacher sign-in</button>') + '</div>';
      var so = slot.querySelector('#nbSignOut');
      if (so) so.addEventListener('click', function () { auth.signOut().then(function () { location.reload(); }); });
      var si = slot.querySelector('#nbSignIn');
      if (si) si.addEventListener('click', openSignIn);
    }
  };

  function openSignIn() {
    var old = document.querySelector('.signin-wrap'); if (old) old.remove();
    var wrap = document.createElement('div');
    wrap.className = 'signin-wrap';
    wrap.innerHTML = '<form class="signin" novalidate>' +
      '<h2>Teacher sign-in</h2>' +
      '<button type="button" class="signin-google" id="nbGoogle"><svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.2l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.8l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/></svg>Sign in with Google</button>' +
      '<p class="signin-or"><span>or use your notebook password</span></p>' +
      '<label for="nbEmail">Email</label><input id="nbEmail" type="email" autocomplete="username" required>' +
      '<label for="nbPass">Password</label><input id="nbPass" type="password" autocomplete="current-password" required>' +
      '<p class="signin-err" id="nbErr" role="alert" hidden></p>' +
      '<div class="signin-row"><button type="button" class="linkbtn" id="nbCancel">Cancel</button><button type="submit" class="signin-go" id="nbGo">Sign in</button></div>' +
      '</form>';
    document.body.appendChild(wrap);
    var form = wrap.querySelector('form'), err = wrap.querySelector('#nbErr'), go = wrap.querySelector('#nbGo');
    wrap.querySelector('#nbGoogle').focus();
    wrap.querySelector('#nbGoogle').addEventListener('click', function () {
      err.hidden = true;
      NB.googleSignIn(auth).then(function (ok) { if (ok) location.reload(); }, function (msg) { err.textContent = msg; err.hidden = false; });
    });
    wrap.querySelector('#nbCancel').addEventListener('click', function () { wrap.remove(); });
    wrap.addEventListener('click', function (e) { if (e.target === wrap) wrap.remove(); });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var em = wrap.querySelector('#nbEmail').value.trim(), pw = wrap.querySelector('#nbPass').value;
      if (!em || !pw) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
      go.disabled = true; go.textContent = 'Signing in…'; err.hidden = true;
      auth.signInWithEmailAndPassword(em, pw).then(function () { location.reload(); }, function (x) {
        go.disabled = false; go.textContent = 'Sign in';
        var code = (x && x.code) || '';
        err.textContent = /network/.test(code) ? 'Could not reach the sign-in server. Check the internet connection and try again.'
          : /too-many/.test(code) ? 'Too many tries. Wait a few minutes, then try again.'
          : 'That email and password did not match. Try again.';
        err.hidden = false;
      });
    });
  }

  /* One-time copy of the ink saved by the Google Apps Script notebook (files in legacy/). */
  function offerImport(slot) {
    var btn = slot.querySelector('#nbImport'), status = slot.querySelector('#nbImportStatus');
    var db = firebase.database();
    Promise.all([
      fetch('legacy/index.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      db.ref('meta/legacyImported').once('value').then(function (s) { return s.val(); })
    ]).then(function (r) {
      var list = r[0];
      if (!list || !list.length || r[1]) return;
      btn.hidden = false;
      btn.addEventListener('click', function () {
        btn.disabled = true; status.hidden = false;
        var done = 0, copied = 0;
        var chain = Promise.resolve();
        list.forEach(function (name) {
          chain = chain.then(function () {
            var m = /^nb_(.+?)_(.+)\.json$/.exec(name); if (!m) return;
            var ref = db.ref('boards/' + NB.fbBoardKey(m[1], m[2]));
            return ref.child('strokes').limitToFirst(1).once('value').then(function (snap) {
              if (snap.exists()) return;                       // already has ink: leave it alone
              return fetch('legacy/' + name, { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (doc) {
                var strokes = {};
                (doc.strokes || []).forEach(function (st, i) { st.o = i + 1; strokes[st.id] = NB.fbEncodeStroke(st); });
                var writes = [];
                if (Object.keys(strokes).length) writes.push(ref.child('strokes').update(strokes));
                if (doc.flaps && Object.keys(doc.flaps).length) writes.push(ref.child('flaps').update(doc.flaps));
                copied += (doc.strokes || []).length;
                return Promise.all(writes);
              });
            });
          }).then(function () { done++; status.textContent = 'Copying ink… ' + done + ' of ' + list.length + ' pages'; });
        });
        chain.then(function () {
          return db.ref('meta/legacyImported').set(true);
        }).then(function () {
          btn.hidden = true;
          status.textContent = 'Done. Copied ' + copied.toLocaleString() + ' strokes from the old notebook.';
        }).catch(function (e) {
          btn.disabled = false;
          status.textContent = 'The copy stopped: ' + ((e && e.message) || e) + ' Select the button to try again. Pages already copied are skipped.';
        });
      });
    });
  }
})();
