/* TEMPLATE: copy this file to make a new spread (e.g. Spread_58_59), change the id, page numbers and art,
   then add it to SPREADS and an objective in Code.gs.

   Easiest way to bring in a Canva page: export the page as PNG, upload it to Drive, set sharing to
   "Anyone with the link", and use its file id in DRIVE_IMG below. Or paste a data: URL.
   Each half-page is 792 × 1224 units. Left page x 0–792, right page x 792–1584. */
(function () {
  function pageArt(x, num, imageUrl) {
    return '<rect x="' + x + '" y="0" width="792" height="1224" fill="#fff"/>' +
      (imageUrl ? '<image href="' + imageUrl + '" x="' + x + '" y="0" width="792" height="1224" preserveAspectRatio="xMidYMid meet"/>'
        : '<text class="t-body t-note" x="' + (x + 396) + '" y="612" font-size="30" text-anchor="middle">Blank page</text>') +
      '<text class="t-body" x="' + (x + 714) + '" y="1169" font-size="25">' + num + '</text>';
  }
  // function DRIVE_IMG(id) { return 'https://lh3.googleusercontent.com/d/' + id; }

  NB.registerSpread({
    id: 'blank',
    pageW: 792, pageH: 1224,
    pages: [{ num: 'Left', side: 'L' }, { num: 'Right', side: 'R' }],
    surfaces: [
      { id: 'pL', kind: 'page', page: 'L', x: 0, y: 0, w: 792, h: 1224, art: pageArt(0, '', null) },
      { id: 'pR', kind: 'page', page: 'R', x: 792, y: 0, w: 792, h: 1224, art: pageArt(792, '', null) },
      /* A simple half-page flap that lifts up from its top edge:
      { id: 'flapA', kind: 'flap', mode: 'flip', page: 'R', x: 800, y: 400, w: 776, h: 300,
        hinge: { x: 1188, y: 400, dx: 0, dy: 1 },
        art: '<rect x="803" y="400" width="770" height="297" fill="#fff" stroke="#111" stroke-width="6"/>',
        back: { art: '<rect x="803" y="103" width="770" height="297" fill="#fff" stroke="#111" stroke-width="6"/>' } }, */
    ]
  });
})();
