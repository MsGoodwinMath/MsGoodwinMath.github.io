/* Interactive Notebook: Firebase Realtime Database connection.
   Data lives at boards/<period>_<pages>/strokes/<id> and boards/<period>_<pages>/flaps/<flapId>.
   Everyone can read; only the teacher account can write (see database.rules.json). */
(function () {
  'use strict';
  var NB = window.NB = window.NB || {};

  function boardKey(period, spread) { return (String(period) + '_' + String(spread)).replace(/[.#$\[\]\/]/g, '_'); }
  function enc(st) { return { s: st.s, b: st.b ? 1 : 0, t: st.t, c: st.c || '', w: st.w, p: (st.p || []).join(','), o: st.o || 0 }; }
  function dec(id, v) {
    v = v || {};
    return { id: id, s: v.s, b: v.b ? 1 : 0, t: v.t, c: v.c || '', w: v.w, o: v.o || 0,
      p: String(v.p || '').split(',').filter(function (x) { return x !== ''; }).map(Number) };
  }
  NB.fbEncodeStroke = enc;
  NB.fbBoardKey = boardKey;

  NB.firebaseApi = function (BOOT) {
    var db = firebase.database();
    var files = {}, fromDb = {};
    ((BOOT.config || {}).spreads || []).forEach(function (s) { files[s.id] = s.file || s.id; if (s.src === 'db') fromDb[s.id] = 1; });

    function submit(period, spread, ops) {
      var ref = db.ref('boards/' + boardKey(period, spread));
      var writes = [];
      ops.forEach(function (op) {
        if (op.k === 'add') writes.push(ref.child('strokes/' + op.st.id).set(enc(op.st)));
        else if (op.k === 'undo') writes.push(ref.child('strokes/' + op.id).remove());
        else if (op.k === 'clear') {
          var gone = {};
          (op.del || []).forEach(function (id) { gone[id] = null; });
          if (Object.keys(gone).length) writes.push(ref.child('strokes').update(gone));
        }
        else if (op.k === 'flap') writes.push(ref.child('flaps/' + op.id).set(!!op.open));
        else if (op.k === 'flapsReset') writes.push(ref.child('flaps').remove());
      });
      return Promise.all(writes).then(function () { return { ok: true }; }, function (err) {
        var msg = String((err && err.message) || err);
        if (/permission/i.test(msg)) throw new Error('Only the teacher account can write on the notebook.');
        throw err;
      });
    }

    function getSpread(id) {
      var file = files[id] || id;
      if (fromDb[id]) {
        return db.ref('content/files/' + file.replace(/[.#$\[\]\/]/g, '_')).once('value').then(function (snap) {
          if (!snap.exists()) throw new Error('Pages ' + id + ' were not found. Upload them again in the teacher hub.');
          return String(snap.val());
        });
      }
      return fetch('spreads/' + encodeURIComponent(file) + '.js', { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('The file spreads/' + file + '.js is missing from the site.');
        return r.text();
      });
    }

    return {
      live: true,
      call: function (fn) {
        var a = Array.prototype.slice.call(arguments, 1);
        try {
          if (fn === 'nbSubmit') return submit(a[0], a[1], a[2]);
          if (fn === 'nbGetSpread') return getSpread(a[0]);
        } catch (e) { return Promise.reject(e); }
        return Promise.reject(new Error('Unknown call ' + fn));
      },
      /* Live updates. Calls h.full once with everything, then h.add / h.remove / h.flaps as things change. */
      subscribe: function (period, spread, h) {
        var ref = db.ref('boards/' + boardKey(period, spread));
        var strokesRef = ref.child('strokes'), q = strokesRef.orderByChild('o'), flapsRef = ref.child('flaps');
        var ready = false, gotStrokes = false, flaps = null, initial = [], initialIdx = {};
        function maybeFull() {
          if (ready || !gotStrokes || flaps === null) return;
          ready = true;
          h.full(initial.filter(function (st) { return initialIdx[st.id]; }), flaps);
        }
        function fail(err) { if (h.error) h.error(err); }
        var onAdd = q.on('child_added', function (snap) {
          var st = dec(snap.key, snap.val());
          if (!ready) { initial.push(st); initialIdx[st.id] = 1; } else h.add(st);
        }, fail);
        var onRemove = strokesRef.on('child_removed', function (snap) {
          if (!ready) delete initialIdx[snap.key]; else h.remove(snap.key);
        }, fail);
        q.once('value', function () { gotStrokes = true; maybeFull(); }, fail);
        var onFlaps = flapsRef.on('value', function (snap) {
          var f = snap.val() || {};
          if (!ready) { flaps = f; maybeFull(); } else h.flaps(f);
        }, fail);
        var connRef = db.ref('.info/connected');
        var onConn = connRef.on('value', function (snap) { if (h.connected) h.connected(!!snap.val()); });
        return function () {
          q.off('child_added', onAdd); strokesRef.off('child_removed', onRemove);
          flapsRef.off('value', onFlaps); connRef.off('value', onConn);
        };
      }
    };
  };
})();
