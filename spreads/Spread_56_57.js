/* Spread 56–57: Review: Exponent Rules (layered wheel) + Review: Polynomial Multiplication (stacked flaps).
   Coordinates are notebook units: each half-page is 792 × 1224 (2 units per printed point).
   Left page x 0–792, right page x 792–1584. y = 0 is the top edge of the pages.

   Surface kinds:
     page   – the printed page (drawable)
     static – something glued flat on top (here: the wheel's center hub)
     flap   – something that lifts or flips. mode "lift" tilts up from its hinge to reveal what is under it;
              mode "flip" turns all the way over so its back side (back.art) can be read and written on. */
(function () {
  var G = NB.geom, esc = G.esc;
  var CX = 395, CY = 748;                 // wheel center on page 56
  var PAGE = { out: 371, inner: 323, hub: 61 };   // printed wheel (Example ring)
  var RULE = { out: 327, inner: 277, hub: 62 };   // middle layer (Rule ring)
  var NAME = { out: 280, hub: 62 };               // top layer (rule names)
  var N = 7, STEP = 360 / N;
  var DASH = 'stroke-dasharray="15 9"';
  var NAMES = [
    ['Power of', 'a Quotient', 'Rule'],
    ['Product', 'Rule'],
    ['Quotient', 'Rule'],
    ['Zero', 'Exponent', 'Rule'],
    ['Negative', 'Exponents', 'Rule'],
    ['Power', 'Rule'],
    ['Power of', 'a Product', 'Rule']
  ];
  function b(k) { return -90 + k * STEP; }          // boundary angle
  function mid(k) { return b(k) + STEP / 2; }
  function pt(r, a) { var p = G.polar(CX, CY, r, a); return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]; }
  function sectorPath(r0, r1, a0, a1) {
    var p = pt(r1, a0), q = pt(r1, a1), s = pt(r0, a1), t = pt(r0, a0);
    return 'M' + p + ' A' + r1 + ' ' + r1 + ' 0 0 1 ' + q + ' L' + s + ' A' + r0 + ' ' + r0 + ' 0 0 0 ' + t + ' Z';
  }
  /* curved label along a ring, kept upright on the bottom half so it reads on the board */
  function ringLabel(id, text, a0, a1, rTop, rBottom, size) {
    var m = (a0 + a1) / 2, lower = (((m % 360) + 360) % 360) > 0 && (((m % 360) + 360) % 360) < 180, d;
    if (lower) { var p = pt(rBottom, a1), q = pt(rBottom, a0); d = 'M' + p + ' A' + rBottom + ' ' + rBottom + ' 0 0 0 ' + q; }
    else { var p2 = pt(rTop, a0), q2 = pt(rTop, a1); d = 'M' + p2 + ' A' + rTop + ' ' + rTop + ' 0 0 1 ' + q2; }
    return '<path id="' + id + '" d="' + d + '" fill="none"/>' +
      '<text class="t-hand" font-size="' + size + '"><textPath href="#' + id + '" startOffset="50%" text-anchor="middle">' + esc(text) + '</textPath></text>';
  }

  /* ---------- page 56 ---------- */
  var p56 = '<rect x="0" y="0" width="792" height="1224" fill="#fff"/>' +
    '<text class="t-title" x="396" y="60" font-size="64" text-anchor="middle" textLength="680" lengthAdjust="spacingAndGlyphs">Review: Exponent Rules</text>' +
    '<text class="t-math" x="326" y="254" font-size="124"><tspan class="v">a</tspan></text>' +
    '<text class="t-math" x="398" y="209" font-size="88"><tspan class="v">m</tspan></text>' +
    '<rect x="0" y="290" width="792" height="6" fill="#111"/>' +
    '<circle cx="' + CX + '" cy="' + CY + '" r="' + PAGE.out + '" fill="none" stroke="#111" stroke-width="6" ' + DASH + '/>' +
    '<circle cx="' + CX + '" cy="' + CY + '" r="' + PAGE.inner + '" fill="none" stroke="#111" stroke-width="6"/>';
  for (var k = 0; k < N; k++) {
    p56 += '<path d="' + G.ray(CX, CY, PAGE.hub, PAGE.out, b(k)) + '" stroke="#111" stroke-width="5"/>';
    p56 += ringLabel('nb5657-ex' + k, 'Example', b(k), b(k + 1), 339, 357, 26);
  }
  p56 += '<circle cx="' + CX + '" cy="' + CY + '" r="' + PAGE.hub + '" fill="#fff" stroke="#111" stroke-width="5"/>' +
    '<text class="t-hand" x="' + CX + '" y="' + (CY - 4) + '" font-size="18" text-anchor="middle">Glue</text>' +
    '<text class="t-hand" x="' + CX + '" y="' + (CY + 17) + '" font-size="18" text-anchor="middle">Here</text>' +
    '<text class="t-body t-note" x="395" y="1169" font-size="23" text-anchor="middle">(Additional sheet goes on top)</text>' +
    '<text class="t-body" x="714" y="1169" font-size="25">56</text>';

  /* ---------- page 57 ---------- */
  var X = 792;
  var p57 = '<rect x="' + X + '" y="0" width="792" height="1224" fill="#fff"/>' +
    '<text class="t-title" x="' + (X + 395) + '" y="57" font-size="54" text-anchor="middle" textLength="559" lengthAdjust="spacingAndGlyphs">Review: Polynomial</text>' +
    '<text class="t-title" x="' + (X + 395) + '" y="127" font-size="54" text-anchor="middle" textLength="389" lengthAdjust="spacingAndGlyphs">Multiplication</text>' +
    '<rect x="' + (X + 3) + '" y="215" width="786" height="903" fill="none" stroke="#111" stroke-width="6"/>' +
    '<rect x="' + X + '" y="324" width="792" height="6" fill="#111"/>' +
    '<text class="t-body" x="' + (X + 395) + '" y="287" font-size="54" text-anchor="middle" textLength="229" lengthAdjust="spacingAndGlyphs">Glue Here</text>' +
    '<text class="t-math" x="' + (X + 25) + '" y="394" font-size="60" textLength="437" lengthAdjust="spacingAndGlyphs">(<tspan class="v">a</tspan> + <tspan class="v">b</tspan>)(<tspan class="v">c</tspan> + <tspan class="v">d</tspan>) =</text>' +
    '<text class="t-body" x="' + (X + 395) + '" y="1074" font-size="60" text-anchor="middle" textLength="523" lengthAdjust="spacingAndGlyphs">Binomial × Binomial</text>' +
    '<text class="t-body t-note" x="' + (X + 395) + '" y="1169" font-size="23" text-anchor="middle">(Additional sheet goes on top)</text>' +
    '<text class="t-body" x="' + (X + 714) + '" y="1169" font-size="25">57</text>';

  var surfaces = [
    { id: 'p56', kind: 'page', page: 'L', x: 0, y: 0, w: 792, h: 1224, art: p56 },
    { id: 'p57', kind: 'page', page: 'R', x: 792, y: 0, w: 792, h: 1224, art: p57 }
  ];

  /* ---------- middle layer: Rule wheel (7 flaps hinged at the hub) ---------- */
  for (k = 0; k < N; k++) {
    var a0 = b(k), a1 = b(k + 1), m = mid(k), hp = pt(RULE.hub, m), d = G.polar(0, 0, 1, m);
    var art = '<path d="' + sectorPath(RULE.hub, RULE.out, a0, a1) + '" fill="#fff"/>' +
      '<path d="' + G.arc(CX, CY, RULE.inner, a0, a1) + '" fill="none" stroke="#111" stroke-width="5"/>' +
      '<path d="' + G.arc(CX, CY, RULE.out, a0, a1) + '" fill="none" stroke="#111" stroke-width="5" ' + DASH + '/>' +
      '<path d="' + G.ray(CX, CY, RULE.hub, RULE.out, a0) + '" stroke="#111" stroke-width="5" ' + DASH + '/>' +
      '<path d="' + G.ray(CX, CY, RULE.hub, RULE.out, a1) + '" stroke="#111" stroke-width="5" ' + DASH + '/>' +
      ringLabel('nb5657-ru' + k, 'Rule', a0, a1, 293, 309, 24);
    surfaces.push({
      id: 'ru' + k, kind: 'flap', mode: 'lift', angle: 70, page: 'L',
      label: NAMES[k].join(' ') + ' (rule layer)',
      shape: G.sectorPoly(CX, CY, RULE.hub - 2, RULE.out + 4, a0 - 0.6, a1 + 0.6, 2),
      hinge: { x: hp[0], y: hp[1], dx: d[0], dy: d[1] },
      art: art
    });
  }
  /* ---------- top layer: rule names (7 flaps); each rides along when the rule flap under it lifts ---------- */
  for (k = 0; k < N; k++) {
    a0 = b(k); a1 = b(k + 1); m = mid(k); hp = pt(NAME.hub, m); d = G.polar(0, 0, 1, m);
    var lines = NAMES[k], c = pt(172, m), lh = 37, top = c[1] - (lines.length - 1) * lh / 2 + 11;
    var txt = lines.map(function (ln, i) {
      return '<text class="t-hand" x="' + c[0] + '" y="' + (top + i * lh) + '" font-size="33" text-anchor="middle">' + esc(ln) + '</text>';
    }).join('');
    surfaces.push({
      id: 'nm' + k, kind: 'flap', mode: 'lift', angle: 70, rides: 'ru' + k, page: 'L',
      label: lines.join(' '),
      shape: G.sectorPoly(CX, CY, NAME.hub - 2, NAME.out + 4, a0 - 0.6, a1 + 0.6, 2),
      hinge: { x: hp[0], y: hp[1], dx: d[0], dy: d[1] },
      art: '<path d="' + sectorPath(NAME.hub, NAME.out, a0, a1) + '" fill="#fff"/>' +
        '<path d="' + G.arc(CX, CY, NAME.out, a0, a1) + '" fill="none" stroke="#111" stroke-width="5" ' + DASH + '/>' +
        '<path d="' + G.ray(CX, CY, NAME.hub, NAME.out, a0) + '" stroke="#111" stroke-width="5" ' + DASH + '/>' +
        '<path d="' + G.ray(CX, CY, NAME.hub, NAME.out, a1) + '" stroke="#111" stroke-width="5" ' + DASH + '/>' + txt
    });
  }
  /* ---------- glued hub on top ---------- */
  surfaces.push({
    id: 'hub', kind: 'static', page: 'L', drawable: false,
    shape: G.sectorPoly(CX, CY, 0, 66, 0, 360, 6),
    art: '<circle cx="' + CX + '" cy="' + CY + '" r="' + NAME.hub + '" fill="#fff" stroke="#111" stroke-width="5"/>' +
      '<text class="t-hand" x="' + CX + '" y="' + (CY - 3) + '" font-size="19" text-anchor="middle">Laws of</text>' +
      '<text class="t-hand" x="' + CX + '" y="' + (CY + 19) + '" font-size="19" text-anchor="middle">Exponents</text>'
  });

  /* ---------- page 57: three layers, top to bottom ----------
     Big Idea (its header strip is glued on the Glue Here strip; its body lifts)
     → Monomial × Binomial piece (glued under it; lifts, and carries Big Idea with it)
     → the page's Binomial × Binomial box. Each layer is shorter, so the label of the one under it peeks out. */
  var HY = 212, FY = 331;                   // header top, hinge line (bottom of the glue strip)
  surfaces.push({
    id: 'monoFlap', kind: 'flap', mode: 'lift', angle: 72, page: 'R', label: 'Monomial × Binomial',
    x: X, y: FY, w: 792, h: 668,
    hinge: { x: X + 396, y: FY, dx: 0, dy: 1 },
    art: '<rect x="' + (X + 3) + '" y="' + FY + '" width="786" height="665" fill="#fff" stroke="#111" stroke-width="6"/>' +
      '<text class="t-math" x="' + (X + 22) + '" y="' + (FY + 66) + '" font-size="60" textLength="365" lengthAdjust="spacingAndGlyphs"><tspan class="v">a</tspan>(<tspan class="v">b</tspan> + <tspan class="v">c</tspan>) =</text>' +
      '<text class="t-body" x="' + (X + 395) + '" y="' + (FY + 636) + '" font-size="60" text-anchor="middle" textLength="560" lengthAdjust="spacingAndGlyphs">Monomial × Binomial</text>'
  });
  function blankLine(y, x0, x1) { return '<rect x="' + x0 + '" y="' + (y + 4) + '" width="' + (x1 - x0) + '" height="3" fill="#111"/>'; }
  surfaces.push({
    id: 'bigIdea', kind: 'flap', mode: 'lift', angle: 72, rides: 'monoFlap', page: 'R', label: 'Big Idea',
    x: X, y: FY, w: 792, h: 540,
    hinge: { x: X + 396, y: FY, dx: 0, dy: 1 },
    art: '<rect x="' + (X + 3) + '" y="' + FY + '" width="786" height="537" fill="#fff" stroke="#111" stroke-width="6"/>' +
      blankLine(HY + 268, X + 40, X + 196) +
      '<text class="t-body" x="' + (X + 206) + '" y="' + (HY + 268) + '" font-size="46">in one factor</text>' +
      '<text class="t-body" x="' + (X + 396) + '" y="' + (HY + 372) + '" font-size="46" text-anchor="middle">must be multiplied by</text>' +
      blankLine(HY + 476, X + 30, X + 186) +
      '<text class="t-body" x="' + (X + 196) + '" y="' + (HY + 476) + '" font-size="46">in the other factor</text>'
  });
  surfaces.push({
    id: 'bigIdeaHead', kind: 'static', page: 'R', label: 'Big Idea header',
    x: X, y: HY, w: 792, h: FY - HY,
    art: '<rect x="' + (X + 3) + '" y="' + (HY + 3) + '" width="786" height="' + (FY - HY) + '" fill="#fff" stroke="#111" stroke-width="6"/>' +
      '<text class="t-body" x="' + (X + 396) + '" y="' + (HY + 82) + '" font-size="52" text-anchor="middle">Big Idea</text>'
  });

  NB.registerSpread({
    id: '56-57',
    pageW: 792, pageH: 1224,
    pages: [{ num: 56, side: 'L' }, { num: 57, side: 'R' }],
    slides: { L: [[0, 300], [296, 1224]], R: [[0, 1224]] },   // 16:9 sections; the wheel and the flap stack each stay whole
    surfaces: surfaces
  });
})();
