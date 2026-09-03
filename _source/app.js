/* <floor-3d> — Polished Three.js 3D model of the EGN CONNECT X floor plan.
   Reads window.EGN_DATA. Booths are rendered as real expo shell-scheme stands
   (carpet + white walls + zone-colored fascia + furniture) via instancing.
   Attributes: booth-height, auto-rotate, show-labels, show-people, show-structure.
   Methods: focusBooth(id), clearSelection(), setZoneFilter(z|null), setView('top'|'3d'), resetView().
   Events: 'booth-select' (detail = booth data or null). */
(function () {
  const THREE_URL = (window.__resources && window.__resources.threeJs) || 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

  const ZONE = {
    A: { color: 0xd9862c, name: 'Zone A · Premium Exhibitors' },
    B: { color: 0x3e7bc4, name: 'Zone B · Standard Booths' },
    C: { color: 0x3f9b6e, name: 'Zone C · Exhibition Clusters' },
    D: { color: 0x8b6bc7, name: 'Zone D · Mid-sized Blocks' },
    E: { color: 0xc75b72, name: 'Zone E · Sponsor & Feature' },
    M: { color: 0x3aa6a6, name: 'Meeting Zone' },
  };
  const PEOPLE_COLORS = ['#5b6b7e', '#8f6b6b', '#6b8f77', '#8f866b', '#7d6b8f', '#46525e', '#a08770', '#748ba3'];
  // Booth-ID label LOD: fully visible once the camera orbit radius drops below
  // LABEL_LOD_NEAR, fully hidden above LABEL_LOD_FAR, fading in between — keeps
  // the full-floor overview clean while labels are still there the moment you
  // start zooming into a zone. Zone/gate/facility signage is unaffected (always
  // visible — those are the "FAR tier" wayfinding, separate objects).
  const LABEL_LOD_NEAR = 55, LABEL_LOD_FAR = 120;

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class Floor3D extends HTMLElement {
    static get observedAttributes() { return ['booth-height', 'auto-rotate', 'show-labels', 'show-people', 'show-structure']; }

    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML =
        '<style>:host{display:block;position:relative;overflow:hidden;outline:none}' +
        'canvas{display:block;outline:none}' +
        ':host(:focus-visible){box-shadow:inset 0 0 0 3px rgba(20,83,188,0.55)}' +
        '#tip{position:absolute;pointer-events:none;background:rgba(24,22,19,0.94);color:#f5f3ef;' +
        'font:12px/1.5 Helvetica,Arial,sans-serif;padding:8px 11px;border-radius:8px;white-space:nowrap;' +
        'transform:translate(14px,14px);display:none;z-index:5;box-shadow:0 4px 14px rgba(0,0,0,0.25)}' +
        '#tip b{font-size:13px}#tip .dim{opacity:0.65}' +
        '#compass{position:absolute;top:12px;right:12px;width:46px;height:46px;z-index:6;cursor:pointer;' +
        'filter:drop-shadow(0 2px 6px rgba(0,0,0,0.35));-webkit-tap-highlight-color:transparent}' +
        '#compass:focus-visible{outline:2px solid #fff;outline-offset:2px;border-radius:50%}' +
        '#compass .ring{fill:rgba(24,22,19,0.88);stroke:#8a847a;stroke-width:1.5}' +
        '#compass .needleN{fill:#D51024}#compass .needleS{fill:#cfc9be}' +
        '#compass .lbl{font:700 9.5px Helvetica,Arial,sans-serif;fill:#f5f3ef;text-anchor:middle}' +
        '#compass .lbl.sub{fill:#a8a196;font-size:8px}</style>' +
        '<div id="tip"></div>' +
        '<div id="compass" role="button" tabindex="0" aria-label="Face north" title="Click to face north">' +
        '<svg viewBox="0 0 44 44" width="46" height="46">' +
        '<circle class="ring" cx="22" cy="22" r="20"/>' +
        '<g id="compassDial">' +
        '<polygon class="needleN" points="22,5 26,22 22,18.5 18,22"/>' +
        '<polygon class="needleS" points="22,39 26,22 22,25.5 18,22"/>' +
        '<text class="lbl" x="22" y="12">N</text>' +
        '<text class="lbl sub" x="22" y="36.5">S</text>' +
        '<text class="lbl sub" x="8.5" y="25.5">W</text>' +
        '<text class="lbl sub" x="35.5" y="25.5">E</text>' +
        '</g></svg></div>';
      this.tip = this.shadowRoot.getElementById('tip');
      this.compassEl = this.shadowRoot.getElementById('compass');
      this.compassDial = this.shadowRoot.getElementById('compassDial');
      this._boothH = 3;
      this._autoRotate = false;
      this._showLabels = true;
      this._showPeople = true;
      this._showStructure = true;
      this._labelCache = new Map();
      this._time = 0;
      this._zoneFilter = null;
      this._selected = null;
      // camera feel: gentle release-inertia + smoothed zoom (see _bindControls/_updateCamera)
      this._vel = { theta: 0, phi: 0 };
      this._targetR = null;
      this._lodOpacity = 1;
      this._reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.tabIndex = this.hasAttribute('tabindex') ? this.tabIndex : 0; // keyboard-operable camera
    }

    attributeChangedCallback(name, _old, val) {
      if (name === 'booth-height') this._boothH = parseFloat(val) || 3;
      if (name === 'auto-rotate') this._autoRotate = String(val) === 'true';
      if (name === 'show-labels') { this._showLabels = String(val) !== 'false'; if (this.labelGroup) this._applyLabelOpacity(); }
      if (name === 'show-people') { this._showPeople = String(val) !== 'false'; if (this.peopleGroup) this.peopleGroup.visible = this._showPeople; }
      if (name === 'show-structure') { this._showStructure = String(val) !== 'false'; if (this.structureGroup) this.structureGroup.visible = this._showStructure; }
    }

    connectedCallback() { if (!this._started) { this._started = true; this._init(); } }
    disconnectedCallback() { this._dead = true; if (this._ro) this._ro.disconnect(); }

    _wallHeightFor(b) {
      // Every booth a uniform 9 ft (2.7432 m) stand per spec; booth-height attr scales about the 3 m default.
      void b;
      return 2.7432 * (this._boothH / 3);
    }

    // Resolve overlapping/oversized booth footprints so every stand tiles cleanly
    // (matches the source floor plan: booths in a block sit together, no clipping).
    // Chooses the orientation that fits the neighbour spacing, then clamps any
    // residual to leave a thin aisle. Sets b.rw / b.rd (render footprint) while
    // b.w / b.d (nominal, true SQM) stay untouched for tooltips.
    _resolveFootprints(data) {
      const AISLE = 0.45, MIN = 1.6, bs = data.booths;
      bs.forEach(b => {
        let sx = Infinity, sz = Infinity;
        bs.forEach(n => {
          if (n === b) return;
          const dx = Math.abs(b.x - n.x), dz = Math.abs(b.z - n.z);
          if (dz < Math.min(b.d, n.d) * 0.6 && dx > 0.5) sx = Math.min(sx, dx);
          if (dx < Math.min(b.w, n.w) * 0.6 && dz > 0.5) sz = Math.min(sz, dz);
        });
        const lo = Math.min(b.w, b.d), hi = Math.max(b.w, b.d);
        const over = (xd, zd) => Math.max(0, xd - (isFinite(sx) ? sx : xd)) + Math.max(0, zd - (isFinite(sz) ? sz : zd));
        const oP = over(lo, hi), oL = over(hi, lo);
        if (Math.abs(oP - oL) < 0.05) { b.ow = b.w; b.od2 = b.d; }
        else if (oP < oL) { b.ow = lo; b.od2 = hi; }
        else { b.ow = hi; b.od2 = lo; }
      });
      bs.forEach(b => { b.rw = b.ow; b.rd = b.od2; });
      bs.forEach(b => {
        let halfW = b.ow / 2, halfD = b.od2 / 2;
        bs.forEach(n => {
          if (n === b) return;
          const zO = Math.abs(b.z - n.z) < (b.od2 + n.od2) / 2 - 0.1;
          const xO = Math.abs(b.x - n.x) < (b.ow + n.ow) / 2 - 0.1;
          if (zO && Math.abs(n.x - b.x) > 0.1) halfW = Math.min(halfW, Math.abs(n.x - b.x) / 2 - AISLE / 2);
          if (xO && Math.abs(n.z - b.z) > 0.1) halfD = Math.min(halfD, Math.abs(n.z - b.z) / 2 - AISLE / 2);
        });
        b.rw = Math.max(MIN, halfW * 2);
        b.rd = Math.max(MIN, halfD * 2);
      });
    }

    async _init() {
      const THREE = this.THREE = await import(THREE_URL);
      const data = window.EGN_DATA;
      if (!data || this._dead) return;
      const FW = data.floor.w, FD = data.floor.d;

      const scene = this.scene = new THREE.Scene();
      scene.background = new THREE.Color(0xf1eee8);
      scene.fog = new THREE.Fog(0xf1eee8, 480, 1050);

      const camera = this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 1600);
      // A capped pixel ratio + AA only on non-hidpi screens keeps fill-rate in check —
      // hidpi panels already supersample the jaggies away, so native MSAA there is wasted cost.
      const dpr = Math.min(devicePixelRatio || 1, 1.5);
      const renderer = this.renderer = new THREE.WebGLRenderer({
        antialias: (devicePixelRatio || 1) < 1.5,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(dpr);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.domElement.style.cursor = 'grab';
      this.shadowRoot.appendChild(renderer.domElement);

      // ---- lights ----
      scene.add(new THREE.HemisphereLight(0xffffff, 0xc9c2b6, 0.9));
      const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
      sun.position.set(FW / 2 - 110, 150, FD / 2 + 80);
      sun.target.position.set(FW / 2, 0, FD / 2);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1536, 1536);
      const sc = sun.shadow.camera;
      sc.left = -160; sc.right = 160; sc.top = 120; sc.bottom = -120; sc.far = 500;
      sc.near = 10;
      scene.add(sun, sun.target);
      const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
      fill.position.set(FW / 2 + 90, 80, FD / 2 - 100);
      scene.add(fill);

      // ---- floor with procedural concrete + grid texture ----
      const floorTex = this._concreteTexture();
      floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
      floorTex.repeat.set((FW + 30) / 12, (FD + 30) / 12);
      floorTex.anisotropy = 8;
      floorTex.colorSpace = THREE.SRGBColorSpace;
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(FW + 30, FD + 30),
        new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.93 })
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(FW / 2, 0, FD / 2);
      floor.receiveShadow = true;
      scene.add(floor);

      // apron slab under everything
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(FW + 34, 0.6, FD + 34),
        new THREE.MeshStandardMaterial({ color: 0xd8d3c9, roughness: 0.9 })
      );
      slab.position.set(FW / 2, -0.32, FD / 2);
      slab.receiveShadow = true;
      scene.add(slab);

      // ---- perimeter wall (left wall split by gates) ----
      const wallMat = new THREE.MeshStandardMaterial({ color: 0xcfc9be, roughness: 0.85 });
      const perim = (w, d, x, z) => {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), wallMat);
        m.position.set(x, 0.6, z); m.castShadow = true; m.receiveShadow = true; scene.add(m);
      };
      perim(FW + 4, 0.6, FW / 2, -2);
      perim(FW + 4, 0.6, FW / 2, FD + 2);
      perim(0.6, FD + 4, FW + 2, FD / 2);
      const gz = data.gates.map(g => g.z).sort((a, b) => a - b);
      const gw = 7;
      [[-2, gz[0] - gw / 2], [gz[0] + gw / 2, gz[1] - gw / 2], [gz[1] + gw / 2, FD + 2]]
        .forEach(([a, b]) => { if (b - a > 0.5) perim(0.6, b - a, -2, (a + b) / 2); });

      // ---- structure: columns + roof trusses ----
      const structure = this.structureGroup = new THREE.Group();
      const colMat = new THREE.MeshStandardMaterial({ color: 0xb7b1a5, roughness: 0.7, metalness: 0.25 });
      const beamMat = new THREE.MeshStandardMaterial({ color: 0xc3bdb1, roughness: 0.65, metalness: 0.3 });
      const nCol = Math.max(2, Math.round(FW / 26));
      for (let i = 0; i <= nCol; i++) {
        const x = (FW / nCol) * i;
        for (const z of [-2, FD + 2]) {
          const c = new THREE.Mesh(new THREE.BoxGeometry(0.55, 10.5, 0.55), colMat);
          c.position.set(x, 5.25, z); c.castShadow = true;
          structure.add(c);
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.55, FD + 8), beamMat);
        beam.position.set(x, 10.2, FD / 2);
        structure.add(beam);
      }
      for (const z of [-2, FD + 2]) {
        const edge = new THREE.Mesh(new THREE.BoxGeometry(FW + 4, 0.45, 0.4), beamMat);
        edge.position.set(FW / 2, 10.2, z);
        structure.add(edge);
      }
      structure.visible = this._showStructure;
      scene.add(structure);

      // ---- gates: branded portals + entry carpets ----
      data.gates.forEach((g, gi) => {
        const grp = new THREE.Group();
        const postMat = new THREE.MeshStandardMaterial({ color: 0x26221e, roughness: 0.55 });
        for (const s of [-1, 1]) {
          const p = new THREE.Mesh(new THREE.BoxGeometry(0.75, 5.4, 0.75), postMat);
          p.position.set(0, 2.7, s * gw / 2);
          p.castShadow = true;
          grp.add(p);
        }
        const lintel = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 1.15, gw + 1.5),
          new THREE.MeshBasicMaterial({ map: this._gradientTexture() })
        );
        lintel.position.y = 5.85;
        grp.add(lintel);
        grp.position.set(-2, 0, g.z);
        scene.add(grp);

        const carpet = new THREE.Mesh(
          new THREE.BoxGeometry(7, 0.05, gw - 0.8),
          new THREE.MeshStandardMaterial({ color: 0xa93b4b, roughness: 0.95 })
        );
        carpet.position.set(1.5, 0.03, g.z);
        carpet.receiveShadow = true;
        scene.add(carpet);

        // EGN CONNECT X branded banner over the arch (entry / exit branding) —
        // width is capped to the gap to the nearest neighbouring gate so two
        // close-together gates never collide into each other's signage.
        const idx = gz.indexOf(g.z);
        const gapPrev = idx > 0 ? g.z - gz[idx - 1] : Infinity;
        const gapNext = idx < gz.length - 1 ? gz[idx + 1] - g.z : Infinity;
        const maxSpan = Math.min(gapPrev, gapNext, gw + 5);
        const bw = Math.max(5.5, Math.min(11, maxSpan - 1.4));
        const bh = bw * (520 / 1024);
        const banner = this._brandSprite('ENTRY  ·  EXIT   —   ' + g.id);
        banner.position.set(-2, 6.8 + bh / 2, g.z);
        banner.scale.set(bw, bh, 1);
        scene.add(banner);
        void gi;
      });

      // ---- booths (instanced shell-scheme stands) ----
      this._buildBooths(data, FW, FD);

      // ---- conference halls ----
      this.pickMeshes = this.pickMeshes.concat(this._buildHalls(data));

      // ---- coffee lounge ----
      this._buildLounge(data.lounge);

      // ---- entrance concourse: circular EGN branding drum + service counters ----
      const gMidZ = data.gates.reduce((s, g) => s + g.z, 0) / data.gates.length;
      this._buildEntryFeature(10.5, gMidZ);
      this._buildServiceCounters();

      // ---- zone banners (wayfinding) ----
      for (const z of ['A', 'B', 'C', 'D', 'E']) {
        const bs = data.booths.filter(b => b.zone === z);
        if (!bs.length) continue;
        const cx = bs.reduce((s, b) => s + b.x, 0) / bs.length;
        const cz = bs.reduce((s, b) => s + b.z, 0) / bs.length;
        const hex = '#' + ZONE[z].color.toString(16).padStart(6, '0');
        const sp = this._textSprite('ZONE ' + z, { bg: hex, fg: '#ffffff', pad: 26 });
        sp.position.set(cx, 9.2, cz);
        sp.scale.set(11, 3.4, 1);
        scene.add(sp);
        const wire = new THREE.Mesh(
          new THREE.CylinderGeometry(0.03, 0.03, 10.2 - 9.2 + 1.5),
          new THREE.MeshBasicMaterial({ color: 0x8a847a })
        );
        wire.position.set(cx, 10, cz);
        scene.add(wire);
      }

      // ---- compass: N/S/E/W wayfinding signage ----
      // The source floor plan carries no compass rose, so this follows the
      // standard convention for an unmarked plan: "up" on the printed page is
      // North. Cross-checked against the plan — Gate 1 sits above Gate 2 on
      // the page and has the lower z here, and the conference halls (drawn on
      // the page's right) sit at high x — so North/South are the long walls
      // (z = -2 / z = FD+2) and West/East are the short walls (x = -2, gates
      // side / x = FW+2, halls side).
      this._buildCompass(FW, FD);

      // ---- people (instanced) ----
      this._buildPeople(data, FW, FD);

      // ---- selection beacon ----
      const beaconMat = this._beaconMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const beacon = this._beacon = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 9, 20, 1, true), beaconMat);
      shaft.position.y = 4.5;
      const ring = this._beaconRing = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.14, 10, 40), beaconMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.14;
      beacon.add(shaft, ring);
      beacon.visible = false;
      scene.add(beacon);

      // ---- hover highlight: a crisp outline box, distinct from the selection
      // beacon above, sized to whatever pickable object (booth/hall/lounge/
      // service counter/brand plaza) the pointer is currently over ----
      const hoverBox = this._hoverBox = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false })
      );
      hoverBox.renderOrder = 999;
      hoverBox.visible = false;
      scene.add(hoverBox);
      this._hoveredObj = null;

      // ---- camera + controls ----
      this._target = new THREE.Vector3(FW / 2, 0, FD / 2);
      // Brought in ~12% from a pure "fit everything" distance so the hall reads
      // less like a distant scale model on arrival, while still showing the
      // whole footprint — see _bindControls/_updateCamera for the rest of the
      // "explore in, not just look at" navigation feel.
      this._home = { r: Math.max(FW, FD) * 0.84, theta: -0.5, phi: 0.98, tx: FW / 2, tz: FD / 2 };
      this._sph = { r: this._home.r * 1.7, theta: -1.35, phi: 0.45 };
      this._bindControls(renderer.domElement);
      this._fly(this._home, this._reducedMotion ? 1 : 1800); // intro sweep

      // Compass badge: click (or Enter/Space via keyboard) to snap the view to
      // face north; the needle rotates every frame to always show true north
      // relative to the current camera angle (see _updateCamera's rotation math).
      const faceNorth = () => {
        this._fly({ r: this._sph.r, theta: 0, phi: this._sph.phi, tx: this._target.x, tz: this._target.z }, this._reducedMotion ? 1 : 700);
      };
      this.compassEl.addEventListener('click', faceNorth);
      this.compassEl.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); faceNorth(); }
      });

      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this);
      this._resize();

      const clock = new THREE.Clock();
      const loop = () => {
        if (this._dead) return;
        requestAnimationFrame(loop);
        const dt = clock.getDelta();
        this._time += dt;
        if (this._autoRotate && !this._anim && !this._dragging) this._sph.theta += dt * 0.1;
        this._stepFly();
        // Brief release-inertia: while dragging, orbit is direct 1:1 (see
        // _bindControls); once released it coasts a few frames and decays,
        // rather than stopping dead — the one "Google Earth" cue that costs
        // nothing in precision since it only ever runs after input has stopped.
        if (!this._dragging && !this._anim && !this._autoRotate && !this._reducedMotion) {
          if (Math.abs(this._vel.theta) > 0.00003 || Math.abs(this._vel.phi) > 0.00003) {
            this._sph.theta += this._vel.theta;
            this._sph.phi = Math.min(1.5, Math.max(0.04, this._sph.phi + this._vel.phi));
            this._vel.theta *= 0.9; this._vel.phi *= 0.9;
          }
        }
        // Smoothed scroll/pinch zoom: wheel/pinch set a target radius, this
        // eases toward it every frame so a burst of wheel ticks reads as one
        // continuous zoom instead of discrete jumps — still lands exactly on
        // the requested distance, just not on the first frame.
        if (this._targetR != null) {
          const k = this._reducedMotion ? 1 : 0.28;
          this._sph.r += (this._targetR - this._sph.r) * k;
          if (Math.abs(this._targetR - this._sph.r) < 0.01) { this._sph.r = this._targetR; this._targetR = null; }
        }
        if (this._beacon.visible) {
          this._beaconMat.opacity = 0.24 + 0.13 * Math.sin(this._time * 3.6);
          this._beaconRing.scale.setScalar(1 + 0.07 * Math.sin(this._time * 3.6));
        }
        // Hover outline fade + distance-aware booth-label visibility (LOD) —
        // both cheap per-frame passes, see _applyLabelOpacity.
        const hb = this._hoverBox;
        const hoverTarget = this._hoveredObj ? 0.85 : 0;
        if (hoverTarget > 0) hb.visible = true;
        hb.material.opacity += (hoverTarget - hb.material.opacity) * 0.25;
        if (hoverTarget === 0 && hb.material.opacity < 0.01) hb.visible = false;
        if (this._showLabels) {
          const r = this._sph.r;
          let lod = 1;
          if (r > LABEL_LOD_FAR) lod = 0;
          else if (r > LABEL_LOD_NEAR) lod = 1 - (r - LABEL_LOD_NEAR) / (LABEL_LOD_FAR - LABEL_LOD_NEAR);
          if (Math.abs(lod - this._lodOpacity) > 0.01) { this._lodOpacity = lod; this._applyLabelOpacity(); }
        }
        this._updateCamera();
        this.compassDial.setAttribute('transform', 'rotate(' + (this._sph.theta * 180 / Math.PI) + ' 22 22)');
        renderer.render(scene, camera);
      };
      loop();

      this._bindPicking(renderer.domElement);
      this.dispatchEvent(new CustomEvent('floor-ready'));
    }

    // ================= booths =================
    _buildBooths(data, FW, FD) {
      const THREE = this.THREE;
      const t = 0.09; // wall thickness
      this._resolveFootprints(data); // clean, non-overlapping stands that match the plan

      // blocker rects for open-front detection (booths + halls + lounge)
      const rects = data.booths.map(b => ({ x1: b.x - b.w / 2, x2: b.x + b.w / 2, z1: b.z - b.d / 2, z2: b.z + b.d / 2 }));
      data.halls.forEach(h => rects.push({ x1: h.x - h.w / 2, x2: h.x + h.w / 2, z1: h.z - h.d / 2, z2: h.z + h.d / 2 }));
      const lg = data.lounge;
      rects.push({ x1: lg.x - lg.w / 2, x2: lg.x + lg.w / 2, z1: lg.z - lg.d / 2, z2: lg.z + lg.d / 2 });

      const clearance = (b, i, dx, dz) => {
        const half = dx !== 0 ? b.w / 2 : b.d / 2;
        for (const s of [0.6, 1.2, 2, 3, 4.5, 6, 8]) {
          const px = b.x + dx * (half + s), pz = b.z + dz * (half + s);
          if (px < -1 || px > FW + 1 || pz < -1 || pz > FD + 1) return s;
          for (let j = 0; j < rects.length; j++) {
            if (j === i) continue;
            const r = rects[j];
            if (px > r.x1 - 0.2 && px < r.x2 + 0.2 && pz > r.z1 - 0.2 && pz < r.z2 + 0.2) return s;
          }
        }
        return 10;
      };

      // per-zone materials (so zones can be dimmed independently)
      this._zoneMats = {};
      const zoneBooths = {};
      for (const z of Object.keys(ZONE)) {
        const c = new THREE.Color(ZONE[z].color);
        this._zoneMats[z] = {
          carpet: new THREE.MeshStandardMaterial({ color: c.clone().lerp(new THREE.Color(0xffffff), 0.12), roughness: 0.92 }),
          wall: new THREE.MeshStandardMaterial({ color: 0xf6f4ef, roughness: 0.6 }),
          fascia: new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.05 }),
          counter: new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.55 }),
          table: new THREE.MeshStandardMaterial({ color: 0xf3efe8, roughness: 0.5 }),
        };
        zoneBooths[z] = { carpets: [], walls: [], fascias: [], counters: [], tables: [], stools: [] };
      }

      const IDQ = new THREE.Quaternion();
      const gm = new THREE.Matrix4(), lm = new THREE.Matrix4(), wm = new THREE.Matrix4();
      const v = new THREE.Vector3(), sv = new THREE.Vector3();
      const push = (arr, groupM, lx, ly, lz, sx, sy, sz) => {
        lm.compose(v.set(lx, ly, lz), IDQ, sv.set(sx, sy, sz));
        wm.multiplyMatrices(groupM, lm);
        arr.push(wm.clone());
      };

      this.pickMeshes = [];
      this.labelGroup = new THREE.Group();

      data.booths.forEach((b, i) => {
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        let best = dirs[0], bestScore = -1;
        for (const [dx, dz] of dirs) {
          const s = clearance(b, i, dx, dz) + (dz !== 0 ? 0.01 : 0);
          if (s > bestScore) { bestScore = s; best = [dx, dz]; }
        }
        const [fx, fz] = best;
        b.front = best;
        const W = fz !== 0 ? b.rw : b.rd;   // width across the open front (render footprint)
        const D = fz !== 0 ? b.rd : b.rw;   // depth toward the back wall (render footprint)
        const rot = Math.atan2(fx, fz);
        const wallH = this._wallHeightFor(b);
        gm.makeRotationY(rot).setPosition(b.x, 0, b.z);

        const g = zoneBooths[b.zone];
        // carpet (world-aligned, symmetric)
        const cm = new THREE.Matrix4().compose(new THREE.Vector3(b.x, 0.035, b.z), IDQ, new THREE.Vector3(b.rw, 0.07, b.rd));
        g.carpets.push(cm);
        // back wall + 2 side walls + 2 front posts
        push(g.walls, gm, 0, wallH / 2, -(D / 2 - t / 2), W, wallH, t);
        push(g.walls, gm, -(W / 2 - t / 2), wallH / 2, -0.22, t, wallH, D - 0.55);
        push(g.walls, gm, (W / 2 - t / 2), wallH / 2, -0.22, t, wallH, D - 0.55);
        push(g.walls, gm, -(W / 2 - t / 2), wallH / 2, D / 2 - t / 2, t, wallH, t);
        push(g.walls, gm, (W / 2 - t / 2), wallH / 2, D / 2 - t / 2, t, wallH, t);
        // fascia across the open front
        push(g.fascias, gm, 0, wallH - 0.16, D / 2 - 0.08, W, 0.46, 0.15);
        // furniture
        if (Math.min(W, D) >= 2.6) push(g.counters, gm, W * 0.2, 0.52, D / 2 - 0.95, 1.45, 1.04, 0.55);
        if (b.sqm >= 18) {
          push(g.tables, gm, -W * 0.18, 0.37, -D * 0.12, 1, 0.74, 1);
          push(g.stools, gm, -W * 0.18 - 0.85, 0.23, -D * 0.12, 1, 0.46, 1);
          push(g.stools, gm, -W * 0.18 + 0.85, 0.23, -D * 0.12 + 0.3, 1, 0.46, 1);
        }

        // invisible pick volume
        const pick = new THREE.Mesh(new THREE.BoxGeometry(b.rw, wallH, b.rd));
        pick.position.set(b.x, wallH / 2, b.z);
        pick.visible = false;
        pick.userData = b;
        this.scene.add(pick);
        this.pickMeshes.push(pick);

        // ID label
        const s = this._textSprite(b.id, { bg: 'rgba(255,255,255,0.93)', fg: '#2e2a25', pad: 10, small: true });
        s.position.set(b.x, wallH + 0.95, b.z);
        const lw = Math.max(2.3, Math.min(b.rw, b.rd) * 0.72);
        s.scale.set(lw, lw * 0.5, 1);
        s.userData = b;
        this.labelGroup.add(s);
      });

      // build the instanced meshes
      const unitBox = new THREE.BoxGeometry(1, 1, 1);
      const tableGeo = new THREE.CylinderGeometry(0.52, 0.52, 1, 20);
      const stoolGeo = new THREE.CylinderGeometry(0.2, 0.2, 1, 12);
      this._zoneIMs = {};
      for (const z of Object.keys(ZONE)) {
        const g = zoneBooths[z], m = this._zoneMats[z];
        const ims = this._zoneIMs[z] = [];
        const mk = (geo, mat, mats, shadow) => {
          if (!mats.length) return;
          const im = new THREE.InstancedMesh(geo, mat, mats.length);
          mats.forEach((mx, k) => im.setMatrixAt(k, mx));
          im.castShadow = shadow; im.receiveShadow = true;
          this.scene.add(im);
          ims.push(im);
        };
        mk(unitBox, m.carpet, g.carpets, false);
        mk(unitBox, m.wall, g.walls, true);
        mk(unitBox, m.fascia, g.fascias, true);
        mk(unitBox, m.counter, g.counters, true);
        mk(tableGeo, m.table, g.tables, true);
        mk(stoolGeo, m.counter, g.stools, false);
      }

      this.labelGroup.visible = this._showLabels;
      this.scene.add(this.labelGroup);
    }

    // ================= halls =================
    _buildHalls(data) {
      const THREE = this.THREE;
      const picks = [];
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x5b6b7e, roughness: 0.7 });
      const roofMat = new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.8 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x27313d, roughness: 0.15, metalness: 0.4 });
      data.halls.forEach(hh => {
        const grp = new THREE.Group();
        const H = 6.4;
        const body = new THREE.Mesh(new THREE.BoxGeometry(hh.w, H, hh.d), bodyMat);
        body.position.y = H / 2;
        body.castShadow = true; body.receiveShadow = true;
        grp.add(body);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(hh.w + 0.7, 0.4, hh.d + 0.7), roofMat);
        roof.position.y = H + 0.2;
        roof.castShadow = true;
        grp.add(roof);
        // glass entrance on the side facing the exhibition floor (-x)
        const door = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.6, Math.min(hh.d * 0.45, 7)), glassMat);
        door.position.set(-hh.w / 2 - 0.05, 1.8, 0);
        grp.add(door);
        grp.position.set(hh.x, 0, hh.z);
        this.scene.add(grp);

        body.userData = { id: hh.id, zone: 'HALL', sub: hh.sub };
        picks.push(body);

        const label = this._textSprite(hh.id.replace('Conference ', '') + ' · ' + hh.sub, { bg: '#3d4a59', fg: '#f5f3ef', pad: 16 });
        label.position.set(hh.x, H + 2.2, hh.z);
        label.scale.set(Math.min(4 + hh.sub.length * 0.55, 26), 2.6, 1);
        this.scene.add(label);
      });
      return picks;
    }

    // ================= lounge =================
    _buildLounge(lg) {
      const THREE = this.THREE;
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(lg.w / 2, lg.w / 2, 0.18, 44),
        new THREE.MeshStandardMaterial({ color: 0x8a6d4f, roughness: 0.85 })
      );
      pad.scale.z = lg.d / lg.w;
      pad.position.set(lg.x, 0.09, lg.z);
      pad.receiveShadow = true;
      pad.userData = { id: lg.id, zone: 'LOUNGE' };
      this.scene.add(pad);
      this.pickMeshes.push(pad);

      const tblMat = new THREE.MeshStandardMaterial({ color: 0xf3efe8, roughness: 0.5 });
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b543c, roughness: 0.6 });
      const umbMat = new THREE.MeshStandardMaterial({ color: 0xd9862c, roughness: 0.7 });
      const rnd = mulberry32(7);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.5;
        const px = lg.x + Math.cos(a) * lg.w * 0.28;
        const pz = lg.z + Math.sin(a) * lg.d * 0.28;
        const tbl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.75, 16), tblMat);
        tbl.position.set(px, 0.55, pz); tbl.castShadow = true;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 8), poleMat);
        pole.position.set(px, 1.4, pz);
        const umb = new THREE.Mesh(new THREE.ConeGeometry(1.35, 0.65, 10), umbMat);
        umb.position.set(px, 2.75, pz); umb.castShadow = true;
        this.scene.add(tbl, pole, umb);
        void rnd;
      }

      const ls = this._textSprite('COFFEE LOUNGE 2', { bg: '#8a6d4f', fg: '#fdfaf5', pad: 16 });
      ls.position.set(lg.x, 4.9, lg.z);
      ls.scale.set(12, 2.6, 1);
      this.scene.add(ls);
    }

    // ================= people =================
    _buildPeople(data, FW, FD) {
      const THREE = this.THREE;
      const N = 130;
      const rnd = mulberry32(42);
      const rects = data.booths.map(b => ({ x1: b.x - b.w / 2 - 0.4, x2: b.x + b.w / 2 + 0.4, z1: b.z - b.d / 2 - 0.4, z2: b.z + b.d / 2 + 0.4 }));
      data.halls.forEach(h => rects.push({ x1: h.x - h.w / 2, x2: h.x + h.w / 2, z1: h.z - h.d / 2, z2: h.z + h.d / 2 }));
      const spots = [];
      let guard = 0;
      while (spots.length < N && guard++ < 4000) {
        const x = 2 + rnd() * (FW - 4), z = 2 + rnd() * (FD - 4);
        if (rects.some(r => x > r.x1 && x < r.x2 && z > r.z1 && z < r.z2)) continue;
        spots.push([x, z, rnd()]);
      }
      const grp = this.peopleGroup = new THREE.Group();
      const bodyGeo = new THREE.CapsuleGeometry(0.17, 0.62, 3, 8);
      const headGeo = new THREE.SphereGeometry(0.14, 10, 8);
      const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.8 }), spots.length);
      const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xd9b38c, roughness: 0.7 }), spots.length);
      const m = new THREE.Matrix4();
      const col = new THREE.Color();
      spots.forEach(([x, z, c], i) => {
        m.makeTranslation(x, 0.85, z);
        bodies.setMatrixAt(i, m);
        bodies.setColorAt(i, col.set(PEOPLE_COLORS[Math.floor(c * PEOPLE_COLORS.length)]));
        m.makeTranslation(x, 1.58, z);
        heads.setMatrixAt(i, m);
      });
      bodies.castShadow = true;
      grp.add(bodies, heads);
      grp.visible = this._showPeople;
      this.scene.add(grp);
    }

    // ================= public API =================
    focusBooth(id) {
      const data = window.EGN_DATA;
      const q = String(id).trim().toUpperCase().replace(/\s+/g, '');
      const b = data.booths.find(x => x.id.toUpperCase() === q);
      if (!b) return false;
      this._select(b);
      this._fly({ r: Math.max(20, Math.max(b.w, b.d) * 5), theta: this._sph.theta, phi: 0.78, tx: b.x, tz: b.z }, this._reducedMotion ? 1 : 1000);
      return true;
    }

    clearSelection() {
      this._selected = null;
      this._beacon.visible = false;
      this.dispatchEvent(new CustomEvent('booth-select', { detail: null }));
    }

    // zone !== null also flies the camera in to frame it (see _focusZone) —
    // clearing back to "All" only restores brightness in place, since forcing
    // the camera to jump home on every filter change would be the disorienting
    // movement the navigation is otherwise built to avoid.
    setZoneFilter(zone) {
      this._zoneFilter = zone || null;
      for (const z of Object.keys(ZONE)) {
        const dim = this._zoneFilter && z !== this._zoneFilter;
        for (const key of ['carpet', 'wall', 'fascia', 'counter', 'table']) {
          const mat = this._zoneMats[z][key];
          mat.transparent = !!dim;
          mat.opacity = dim ? 0.13 : 1;
          mat.depthWrite = !dim;
          mat.needsUpdate = true;
        }
      }
      this.labelGroup.children.forEach(s => { s.userData._dim = !!(this._zoneFilter && s.userData.zone !== this._zoneFilter); });
      this._applyLabelOpacity();
      if (this._zoneFilter) this._focusZone(this._zoneFilter);
    }

    // Frames the given zone's booths with padding, keeping the current heading
    // (theta) but settling to a consistent 3/4 viewing angle (phi) — enough
    // context around the zone survives that it still reads as part of the hall.
    _focusZone(zone) {
      const bs = window.EGN_DATA.booths.filter(b => b.zone === zone);
      if (!bs.length) return;
      const minX = Math.min(...bs.map(b => b.x - b.w / 2)), maxX = Math.max(...bs.map(b => b.x + b.w / 2));
      const minZ = Math.min(...bs.map(b => b.z - b.d / 2)), maxZ = Math.max(...bs.map(b => b.z + b.d / 2));
      const phi = 0.82, pad = 1.35;
      const a = Math.max(0.5, (this.clientWidth || 800) / (this.clientHeight || 500));
      const f = Math.tan((22.5 * Math.PI) / 180);
      const r = Math.max(
        24,
        ((maxZ - minZ) * pad) / (2 * f) / Math.sin(phi),
        ((maxX - minX) * pad) / (2 * f * a) / Math.sin(phi)
      );
      this._fly({ r, theta: this._sph.theta, phi, tx: (minX + maxX) / 2, tz: (minZ + maxZ) / 2 }, this._reducedMotion ? 1 : 1100);
    }

    // Composes zoom-driven LOD fade with per-zone dimming so neither one clobbers
    // the other; called whenever either input changes (see the render loop and
    // setZoneFilter/attributeChangedCallback).
    _applyLabelOpacity() {
      const lod = this._lodOpacity;
      this.labelGroup.children.forEach(s => { s.material.opacity = lod * (s.userData._dim ? 0.12 : 1); });
      this.labelGroup.visible = this._showLabels && lod > 0.02;
    }

    // Live "as you type" search suggestions (prefix matches first, then
    // substring matches), used by the shell's suggestion dropdown — exact/no
    // match handling for Enter/Find still goes through focusBooth().
    searchBooths(query) {
      const q = String(query).trim().toUpperCase().replace(/\s+/g, '');
      if (!q) return [];
      const data = window.EGN_DATA;
      if (!data) return [];
      const starts = [], contains = [];
      for (const b of data.booths) {
        const id = b.id.toUpperCase();
        if (id.startsWith(q)) starts.push(b.id);
        else if (id.includes(q)) contains.push(b.id);
      }
      return starts.sort().concat(contains.sort()).slice(0, 8);
    }

    setView(mode) {
      const d = window.EGN_DATA;
      const dur = this._reducedMotion ? 1 : 1100;
      if (mode === 'top') {
        const a = Math.max(0.5, (this.clientWidth || 800) / (this.clientHeight || 500));
        const f = Math.tan((22.5 * Math.PI) / 180);
        const r = Math.max((d.floor.d + 34) / (2 * f), (d.floor.w + 34) / (2 * f * a));
        this._fly({ r, theta: 0, phi: 0.06, tx: d.floor.w / 2, tz: d.floor.d / 2 }, dur);
      } else {
        this._fly(this._home, dur);
      }
    }

    resetView() { this.clearSelection(); this.setZoneFilter(null); this._fly(this._home, this._reducedMotion ? 1 : 900); }

    // ================= selection =================
    _select(b) {
      this._selected = b;
      const wallH = this._wallHeightFor(b);
      this._beacon.position.set(b.x, 0, b.z);
      this._beaconRing.geometry.dispose();
      this._beaconRing.geometry = new this.THREE.TorusGeometry(Math.hypot(b.w, b.d) / 2 + 0.5, 0.14, 10, 44);
      this._beaconMat.color.set(ZONE[b.zone] ? ZONE[b.zone].color : 0xffffff);
      this._beacon.visible = true;
      void wallH;
      this.dispatchEvent(new CustomEvent('booth-select', { detail: b }));
    }

    // ================= internals =================
    _concreteTexture() {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#e9e5de';
      ctx.fillRect(0, 0, 512, 512);
      const rnd = mulberry32(11);
      for (let i = 0; i < 2600; i++) {
        const g = 200 + Math.floor(rnd() * 40);
        ctx.fillStyle = 'rgba(' + g + ',' + (g - 4) + ',' + (g - 10) + ',0.28)';
        ctx.fillRect(rnd() * 512, rnd() * 512, 1.6, 1.6);
      }
      ctx.strokeStyle = 'rgba(160,152,138,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, 512, 512);
      return new this.THREE.CanvasTexture(c);
    }

    _gradientTexture() {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 32;
      const ctx = c.getContext('2d');
      const gr = ctx.createLinearGradient(0, 0, 256, 0);
      gr.addColorStop(0, '#1453BC');
      gr.addColorStop(0.5, '#822966');
      gr.addColorStop(1, '#D51024');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, 256, 32);
      const tex = new this.THREE.CanvasTexture(c);
      tex.colorSpace = this.THREE.SRGBColorSpace;
      return tex;
    }

    // ================= EGN CONNECT X branding =================
    _roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    _fillSpaced(ctx, text, x, y, width) {
      let raw = 0;
      for (const ch of text) raw += ctx.measureText(ch).width;
      const gap = text.length > 1 ? Math.max(0, width - raw) / (text.length - 1) : 0;
      let cx = x;
      for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + gap; }
    }

    // Draws the EGN CONNECT X wordmark lockup centred at (cx, cy), scaled by s.
    _drawEGNLogo(ctx, cx, cy, s, dark) {
      const ink = dark ? '#f5f3ef' : '#1c1a17';
      const red = '#D51024';
      const fMain = 92 * s;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.font = '800 ' + fMain + 'px Arial, Helvetica, sans-serif';
      const wCon = ctx.measureText('CONNECT').width;
      const wX = ctx.measureText('X').width;
      const gapCX = 8 * s;
      const wEGN = ctx.measureText('EGN').width;
      const blockW = Math.max(wCon + gapCX + wX, wEGN);
      const left = cx - blockW / 2;
      const lineH = fMain * 1.0;
      const top = cy - (lineH * 2 + 34 * s) / 2;
      const egnBase = top + fMain;
      const conBase = egnBase + lineH;
      // EGN
      ctx.fillStyle = ink;
      ctx.fillText('EGN', left, egnBase);
      // CONNECT + red X
      ctx.fillText('CONNECT', left, conBase);
      const xLeft = left + wCon + gapCX;
      ctx.fillStyle = red;
      ctx.fillText('X', xLeft, conBase);
      // rising-arrow motif over the X
      const xTop = conBase - fMain * 0.70;
      const armX0 = xLeft + wX * 0.58, armY0 = conBase - fMain * 0.40;
      const armX1 = xLeft + wX + wX * 0.34, armY1 = xTop - fMain * 0.08;
      ctx.strokeStyle = red;
      ctx.lineWidth = fMain * 0.12;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(armX0, armY0); ctx.lineTo(armX1, armY1); ctx.stroke();
      const dx = armX1 - armX0, dy = armY1 - armY0, L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L, px = -uy, py = ux, hs = fMain * 0.26;
      ctx.beginPath();
      ctx.moveTo(armX1 + ux * hs * 0.5, armY1 + uy * hs * 0.5);
      ctx.lineTo(armX1 - ux * hs * 0.3 + px * hs * 0.5, armY1 - uy * hs * 0.3 + py * hs * 0.5);
      ctx.lineTo(armX1 - ux * hs * 0.3 - px * hs * 0.5, armY1 - uy * hs * 0.3 - py * hs * 0.5);
      ctx.closePath(); ctx.fill();
      // tagline
      ctx.fillStyle = dark ? 'rgba(245,243,239,0.72)' : '#6b6b6b';
      ctx.font = '700 ' + (22 * s) + 'px Arial, Helvetica, sans-serif';
      this._fillSpaced(ctx, 'EDUCATION GROWTH NETWORK', left, conBase + 34 * s, blockW);
    }

    _brandSprite(label) {
      const tex = this._logoPanelTexture(label);
      return new this.THREE.Sprite(new this.THREE.SpriteMaterial({ map: tex, transparent: true }));
    }

    // White signage panel: EGN CONNECT X logo above an optional dark label bar.
    _logoPanelTexture(label) {
      const c = document.createElement('canvas');
      c.width = 1024; c.height = 520;
      const ctx = c.getContext('2d');
      const pad = 16;
      this._roundRect(ctx, pad, pad, c.width - 2 * pad, c.height - 2 * pad, 26);
      ctx.fillStyle = '#faf8f4'; ctx.fill();
      ctx.lineWidth = 6; ctx.strokeStyle = '#1d1a17'; ctx.stroke();
      this._drawEGNLogo(ctx, c.width / 2, label ? 205 : 255, 1.15, false);
      if (label) {
        const barY = 356, barH = 132;
        this._roundRect(ctx, pad + 10, barY, c.width - 2 * pad - 20, barH, 18);
        ctx.fillStyle = '#1d1a17'; ctx.fill();
        const gr = ctx.createLinearGradient(pad, 0, c.width - pad, 0);
        gr.addColorStop(0, '#1453BC'); gr.addColorStop(0.5, '#822966'); gr.addColorStop(1, '#D51024');
        ctx.fillStyle = gr; ctx.fillRect(pad + 34, barY + barH - 15, c.width - 2 * pad - 68, 5);
        ctx.fillStyle = '#f5f3ef'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '800 50px Arial, Helvetica, sans-serif';
        ctx.fillText(label, c.width / 2, barY + barH / 2 - 5);
      }
      const tex = new this.THREE.CanvasTexture(c);
      tex.colorSpace = this.THREE.SRGBColorSpace; tex.anisotropy = 4;
      return tex;
    }

    // Circular logo medallion for the top of the branding drum (read from above).
    _logoDiscTexture() {
      const c = document.createElement('canvas');
      c.width = c.height = 1024;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(512, 512, 60, 512, 512, 512);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.72, '#f3efe8'); g.addColorStop(1, '#e6e0d6');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(512, 512, 510, 0, 7); ctx.fill();
      ctx.lineWidth = 26; ctx.strokeStyle = '#1d1a17'; ctx.beginPath(); ctx.arc(512, 512, 470, 0, 7); ctx.stroke();
      const gr = ctx.createLinearGradient(60, 0, 964, 0);
      gr.addColorStop(0, '#1453BC'); gr.addColorStop(0.5, '#822966'); gr.addColorStop(1, '#D51024');
      ctx.lineWidth = 12; ctx.strokeStyle = gr; ctx.beginPath(); ctx.arc(512, 512, 442, 0, 7); ctx.stroke();
      this._drawEGNLogo(ctx, 512, 500, 1.75, false);
      const tex = new this.THREE.CanvasTexture(c);
      tex.colorSpace = this.THREE.SRGBColorSpace; tex.anisotropy = 4;
      return tex;
    }

    // Dark wrap band with the wordmark repeated, for the drum side.
    _bandTexture() {
      const c = document.createElement('canvas');
      c.width = 2048; c.height = 256;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#1d1a17'; ctx.fillRect(0, 0, 2048, 256);
      const gr = ctx.createLinearGradient(0, 0, 2048, 0);
      gr.addColorStop(0, '#3b82f6'); gr.addColorStop(0.5, '#8b5cf6'); gr.addColorStop(1, '#e11d2f');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, 2048, 10); ctx.fillRect(0, 246, 2048, 10);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      for (let k = 0; k < 2; k++) {
        let x = k * 1024 + 90; const y = 132;
        ctx.font = '800 96px Arial, Helvetica, sans-serif';
        ctx.fillStyle = '#f5f3ef'; ctx.fillText('EGN', x, y); x += ctx.measureText('EGN ').width;
        ctx.fillText('CONNECT', x, y); x += ctx.measureText('CONNECT').width + 8;
        ctx.fillStyle = '#D51024'; ctx.fillText('X', x, y);
      }
      const tex = new this.THREE.CanvasTexture(c);
      tex.wrapS = this.THREE.RepeatWrapping; tex.wrapT = this.THREE.ClampToEdgeWrapping;
      tex.repeat.set(3, 1); tex.colorSpace = this.THREE.SRGBColorSpace; tex.anisotropy = 4;
      return tex;
    }

    _counterSign(name, accent) {
      const c = document.createElement('canvas');
      c.width = 1024; c.height = 270;
      const ctx = c.getContext('2d');
      this._roundRect(ctx, 6, 6, 1012, 258, 26); ctx.fillStyle = '#1d1a17'; ctx.fill();
      ctx.fillStyle = '#' + accent.toString(16).padStart(6, '0');
      this._roundRect(ctx, 22, 30, 26, 210, 10); ctx.fill();
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = '800 34px Arial, Helvetica, sans-serif'; ctx.fillStyle = '#f5f3ef';
      ctx.fillText('EGN ', 72, 68); let wx = 72 + ctx.measureText('EGN ').width;
      ctx.fillText('CONNECT', wx, 68); wx += ctx.measureText('CONNECT').width + 4;
      ctx.fillStyle = '#D51024'; ctx.fillText('X', wx, 68);
      let fs = 92; ctx.font = '800 ' + fs + 'px Arial, Helvetica, sans-serif';
      while (ctx.measureText(name).width > 900 && fs > 46) { fs -= 4; ctx.font = '800 ' + fs + 'px Arial, Helvetica, sans-serif'; }
      ctx.fillStyle = '#f8f6f2'; ctx.textBaseline = 'middle'; ctx.fillText(name, 72, 178);
      const tex = new this.THREE.CanvasTexture(c);
      tex.colorSpace = this.THREE.SRGBColorSpace; tex.anisotropy = 4;
      return new this.THREE.Sprite(new this.THREE.SpriteMaterial({ map: tex, transparent: true }));
    }

    // Circular compass badge for the four wayfinding signs (N/S/E/W).
    _compassSprite(letter, word) {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const ctx = c.getContext('2d');
      const cx = 256, cy = 256, R = 236;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = '#1d1a17'; ctx.fill();
      const gr = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
      gr.addColorStop(0, '#1453BC'); gr.addColorStop(0.5, '#822966'); gr.addColorStop(1, '#D51024');
      ctx.lineWidth = 12; ctx.strokeStyle = gr;
      ctx.beginPath(); ctx.arc(cx, cy, R - 6, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#f5f3ef'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 220px Arial, Helvetica, sans-serif';
      ctx.fillText(letter, cx, cy - 28);
      ctx.font = '700 46px Arial, Helvetica, sans-serif';
      ctx.fillStyle = 'rgba(245,243,239,0.78)';
      ctx.fillText(word, cx, cy + 158);
      const tex = new this.THREE.CanvasTexture(c);
      tex.colorSpace = this.THREE.SRGBColorSpace; tex.anisotropy = 4;
      return new this.THREE.Sprite(new this.THREE.SpriteMaterial({ map: tex, transparent: true }));
    }

    // ================= entrance: circular branding drum =================
    _buildEntryFeature(cx, cz) {
      const THREE = this.THREE;
      const R = 4.5, H = 1.8288; // 9 m diameter, 6 ft tall
      const grp = new THREE.Group();
      const plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(R + 0.35, R + 0.6, 0.24, 64),
        new THREE.MeshStandardMaterial({ color: 0x26221e, roughness: 0.7 })
      );
      plinth.position.y = 0.12; plinth.receiveShadow = true; grp.add(plinth);
      const side = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R, H, 64, 1, true),
        new THREE.MeshStandardMaterial({ map: this._bandTexture(), roughness: 0.5, metalness: 0.1, side: THREE.DoubleSide })
      );
      side.position.y = 0.24 + H / 2; side.castShadow = true; grp.add(side);
      const top = new THREE.Mesh(
        new THREE.CircleGeometry(R, 64),
        new THREE.MeshStandardMaterial({ map: this._logoDiscTexture(), roughness: 0.6 })
      );
      top.rotation.x = -Math.PI / 2; top.position.y = 0.24 + H + 0.002; top.receiveShadow = true; grp.add(top);
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(R, 0.1, 14, 64),
        new THREE.MeshBasicMaterial({ map: this._gradientTexture() })
      );
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.24 + H; grp.add(ring);
      grp.position.set(cx, 0, cz);
      this.scene.add(grp);

      const pick = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 20));
      pick.position.set(cx, 0.24 + H / 2, cz); pick.visible = false;
      pick.userData = { id: 'EGN CONNECT X', zone: 'BRAND', desc: 'Welcome & branding plaza', diam: 9 };
      this.scene.add(pick); this.pickMeshes.push(pick);
    }

    // ================= wayfinding: N/S/E/W compass signs =================
    // Floated well above the roofline on posts just outside each perimeter
    // wall, so they stay visible over booths/halls from most camera angles.
    _buildCompass(FW, FD) {
      const THREE = this.THREE;
      const Y = 13, M = 3;
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x6b645b, roughness: 0.6, metalness: 0.15 });
      const points = [
        { letter: 'N', word: 'NORTH', x: FW / 2, z: -2 - M },
        { letter: 'S', word: 'SOUTH', x: FW / 2, z: FD + 2 + M },
        { letter: 'W', word: 'WEST', x: -2 - M, z: FD / 2 },
        { letter: 'E', word: 'EAST', x: FW + 2 + M, z: FD / 2 },
      ];
      points.forEach(p => {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, Y, 8), poleMat);
        pole.position.set(p.x, Y / 2, p.z); pole.castShadow = true;
        this.scene.add(pole);
        const sp = this._compassSprite(p.letter, p.word);
        sp.position.set(p.x, Y, p.z);
        sp.scale.set(7, 7, 1);
        this.scene.add(sp);
      });
    }

    // ================= entrance: service counters =================
    // These live OUTSIDE the main hall frame, on the exterior apron beyond the
    // west perimeter wall (wall sits at x ≈ -2) — a proper outer lobby row
    // visitors pass through before entering via the gates, rather than
    // furniture crowded into the interior gate concourse.
    _buildServiceCounters() {
      const counters = [
        { name: 'Registration Counter', cx: -7, cz: 21, W: 5, L: 10, H: 2.7432, accent: 0xD51024, desc: 'Badge collection & visitor registration', flip: true },
        { name: 'Travel Desk',          cx: -7, cz: 9,  W: 4, L: 6,  H: 2.4,    accent: 0x3b82f6, desc: 'Cabs, transfers & travel assistance', flip: true },
        { name: 'Lost & Found',         cx: -7, cz: 52, W: 4, L: 6,  H: 2.4,    accent: 0x3f9b6e, desc: 'Report or recover lost items', flip: true },
        { name: 'Baggage & Deposit',    cx: -7, cz: 63, W: 4, L: 8,  H: 2.4,    accent: 0xd9862c, desc: 'Cloakroom & baggage deposit', flip: true },
      ];
      counters.forEach(c => this._buildCounter(c));
    }

    _buildCounter(c) {
      const THREE = this.THREE;
      const { W, L, H } = c;
      // flip=true mirrors the whole desk left/right so the open (customer-facing)
      // side points away from the hall, toward visitors arriving from outside.
      const s = c.flip ? -1 : 1;
      const grp = new THREE.Group();
      const plat = new THREE.Mesh(
        new THREE.BoxGeometry(W, 0.08, L),
        new THREE.MeshStandardMaterial({ color: 0xe7e3da, roughness: 0.9 })
      );
      plat.position.y = 0.04; plat.receiveShadow = true; grp.add(plat);
      // branded back wall (header), on the side facing away from visitors
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, H, L),
        new THREE.MeshStandardMaterial({ color: 0xf4f1ec, roughness: 0.6 })
      );
      wall.position.set(-s * (W / 2 - 0.125), H / 2, 0); wall.castShadow = true; wall.receiveShadow = true; grp.add(wall);
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, H * 0.2, L),
        new THREE.MeshStandardMaterial({ color: c.accent, roughness: 0.5 })
      );
      strip.position.set(-s * (W / 2 - 0.125), H - H * 0.1, 0); grp.add(strip);
      // counter desk facing the open (visitor-facing) side
      const deskH = 1.05;
      const desk = new THREE.Mesh(
        new THREE.BoxGeometry(W * 0.42, deskH, L * 0.9),
        new THREE.MeshStandardMaterial({ color: 0xe8e4dc, roughness: 0.55 })
      );
      desk.position.set(s * W * 0.12, deskH / 2, 0); desk.castShadow = true; desk.receiveShadow = true; grp.add(desk);
      const deskTop = new THREE.Mesh(
        new THREE.BoxGeometry(W * 0.5, 0.08, L * 0.94),
        new THREE.MeshStandardMaterial({ color: 0x2e2a25, roughness: 0.5 })
      );
      deskTop.position.set(s * W * 0.12, deskH + 0.04, 0); deskTop.castShadow = true; grp.add(deskTop);
      grp.position.set(c.cx, 0, c.cz);
      this.scene.add(grp);
      // name sign (always-readable sprite) on the header
      const sign = this._counterSign(c.name, c.accent);
      sign.position.set(c.cx - s * (W / 2 - 0.3), H + 0.8, c.cz);
      const sw = Math.min(L * 0.9, 10);
      sign.scale.set(sw, sw * 0.26, 1);
      this.scene.add(sign);
      // a couple of staff behind the desk
      this._addStaff(c.cx - s * W * 0.12, c.cz, L);
      // pick volume
      const pick = new THREE.Mesh(new THREE.BoxGeometry(W, H, L));
      pick.position.set(c.cx, H / 2, c.cz); pick.visible = false;
      pick.userData = { id: c.name, zone: 'SERVICE', desc: c.desc, w: W, d: L };
      this.scene.add(pick); this.pickMeshes.push(pick);
    }

    _addStaff(x, z, L) {
      const THREE = this.THREE;
      const n = L > 7 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const pz = n === 1 ? z : z + (i ? L * 0.22 : -L * 0.22);
        const body = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.17, 0.6, 3, 8),
          new THREE.MeshStandardMaterial({ color: 0x46525e, roughness: 0.8 })
        );
        body.position.set(x, 0.85, pz); body.castShadow = true;
        const head = new THREE.Mesh(
          new THREE.SphereGeometry(0.13, 10, 8),
          new THREE.MeshStandardMaterial({ color: 0xd9b38c, roughness: 0.7 })
        );
        head.position.set(x, 1.55, pz);
        this.scene.add(body, head);
      }
    }

    _textSprite(text, opt) {
      const THREE = this.THREE;
      const key = text + '|' + JSON.stringify(opt);
      let tex = this._labelCache.get(key);
      if (!tex) {
        const c = document.createElement('canvas');
        const ctx = c.getContext('2d');
        const fs = opt.small ? 44 : 52;
        ctx.font = '700 ' + fs + 'px Helvetica, Arial, sans-serif';
        const tw = ctx.measureText(text).width;
        c.width = Math.ceil(tw + opt.pad * 2);
        c.height = Math.ceil(fs * 1.5);
        const r = 14;
        ctx.beginPath();
        ctx.roundRect(0, 0, c.width, c.height, r);
        ctx.fillStyle = opt.bg;
        ctx.fill();
        ctx.font = '700 ' + fs + 'px Helvetica, Arial, sans-serif';
        ctx.fillStyle = opt.fg;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, c.width / 2, c.height / 2 + 2);
        tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        this._labelCache.set(key, tex);
      }
      return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    }

    _fly(to, dur) {
      const s = this._sph, t = this._target;
      this._targetR = null; // an explicit fly-to always supersedes an in-flight wheel/pinch zoom
      this._vel.theta = 0; this._vel.phi = 0; // ...and any coasting inertia
      this._anim = {
        from: { r: s.r, theta: s.theta, phi: s.phi, tx: t.x, tz: t.z },
        to, t0: performance.now(), dur: dur || 900,
      };
    }

    _stepFly() {
      if (!this._anim) return;
      const a = this._anim;
      let p = (performance.now() - a.t0) / a.dur;
      if (p >= 1) p = 1;
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      const L = (x, y) => x + (y - x) * e;
      this._sph.r = L(a.from.r, a.to.r);
      this._sph.theta = L(a.from.theta, a.to.theta);
      this._sph.phi = L(a.from.phi, a.to.phi);
      this._target.x = L(a.from.tx, a.to.tx);
      this._target.z = L(a.from.tz, a.to.tz);
      if (p === 1) this._anim = null;
    }

    _updateCamera() {
      const { r, theta, phi } = this._sph;
      const t = this._target;
      this.camera.position.set(
        t.x + r * Math.sin(phi) * Math.sin(theta),
        t.y + r * Math.cos(phi),
        t.z + r * Math.sin(phi) * Math.cos(theta)
      );
      this.camera.lookAt(t);
    }

    // Orbit/pan stay direct 1:1 while a pointer is down — this is a reference
    // tool people use to pick out a specific booth, so the camera must track
    // the drag exactly, not drift past it. On release it gets a brief, quickly
    // decaying coast (see the render loop) and the wheel/pinch zoom is eased
    // toward its target rather than jumping — both purely cosmetic smoothing
    // that never changes where an interaction ultimately settles.
    _bindControls(el) {
      let px = 0, py = 0, btn = -1;
      const ROTATE_SPEED = 0.0075; // was 0.005 (too stiff) — a drag now covers noticeably more orbit
      const PAN_SPEED = 800;
      const pointers = new Map(); // active touches, for pinch-zoom / two-finger pan
      let pinchDist = null, pinchMidX = 0, pinchMidY = 0;
      el.style.touchAction = 'none';

      const zoomBy = factor => {
        const base = this._targetR != null ? this._targetR : this._sph.r;
        this._targetR = Math.min(600, Math.max(10, base * factor));
      };
      const panBy = (dx, dy) => {
        const s = this._sph.r / PAN_SPEED, th = this._sph.theta;
        this._target.x -= (dx * Math.cos(th) - dy * Math.sin(th) * Math.cos(this._sph.phi)) * s;
        this._target.z -= (-dx * Math.sin(th) - dy * Math.cos(th) * Math.cos(this._sph.phi)) * s;
      };

      el.addEventListener('pointerdown', e => {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        btn = e.button; px = e.clientX; py = e.clientY;
        this._downAt = { x: e.clientX, y: e.clientY };
        this._dragging = true;
        this._anim = null;
        this._vel.theta = 0; this._vel.phi = 0;
        el.setPointerCapture(e.pointerId);
        el.style.cursor = 'grabbing';
        if (pointers.size === 2) {
          const pts = Array.from(pointers.values());
          pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          pinchMidX = (pts[0].x + pts[1].x) / 2; pinchMidY = (pts[0].y + pts[1].y) / 2;
          this._downAt = null; // a pinch gesture is never resolved as a booth click
        }
      });
      const release = e => {
        pointers.delete(e.pointerId);
        if (pointers.size < 2) pinchDist = null;
        if (pointers.size === 1) {
          const p = pointers.values().next().value;
          px = p.x; py = p.y; btn = 0;
        } else if (pointers.size === 0) {
          btn = -1; this._dragging = false;
        }
        try { el.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
        el.style.cursor = 'grab';
      };
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointermove', e => {
        if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (pointers.size === 2) {
          // pinch-to-zoom + two-finger pan
          const pts = Array.from(pointers.values());
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          const midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2;
          if (pinchDist != null) {
            this._anim = null;
            zoomBy(pinchDist / dist);
            panBy(midX - pinchMidX, midY - pinchMidY);
          }
          pinchDist = dist; pinchMidX = midX; pinchMidY = midY;
          return;
        }
        if (btn === -1) return;
        const dx = e.clientX - px, dy = e.clientY - py;
        px = e.clientX; py = e.clientY;
        if (btn === 2 || e.shiftKey) {
          panBy(dx, dy);
        } else {
          const dTheta = -dx * ROTATE_SPEED;
          const dPhi = Math.min(1.5, Math.max(0.04, this._sph.phi - dy * ROTATE_SPEED)) - this._sph.phi;
          this._sph.theta += dTheta;
          this._sph.phi += dPhi;
          this._vel.theta = dTheta; this._vel.phi = dPhi; // seed the release-inertia
        }
      });
      el.addEventListener('wheel', e => {
        e.preventDefault();
        this._anim = null;
        zoomBy(1 + Math.sign(e.deltaY) * 0.08);
      }, { passive: false });
      el.addEventListener('contextmenu', e => e.preventDefault());
      el.addEventListener('dblclick', () => this.resetView());

      // Keyboard: arrow keys orbit, +/- zoom, Home/0 resets (host element is
      // tabindex=0 — see the constructor — with a visible focus ring in the
      // shadow-DOM stylesheet).
      this.addEventListener('keydown', e => {
        const ORBIT_STEP = 0.09;
        switch (e.key) {
          case 'ArrowLeft': this._anim = null; this._sph.theta -= ORBIT_STEP; break;
          case 'ArrowRight': this._anim = null; this._sph.theta += ORBIT_STEP; break;
          case 'ArrowUp': this._anim = null; this._sph.phi = Math.max(0.04, this._sph.phi - ORBIT_STEP); break;
          case 'ArrowDown': this._anim = null; this._sph.phi = Math.min(1.5, this._sph.phi + ORBIT_STEP); break;
          case '+': case '=': zoomBy(0.88); break;
          case '-': case '_': zoomBy(1.14); break;
          case 'Home': case '0': this.resetView(); break;
          default: return;
        }
        e.preventDefault();
      });
    }

    _bindPicking(el) {
      const THREE = this.THREE;
      const ray = new THREE.Raycaster();
      const ptr = new THREE.Vector2();
      const box3 = new THREE.Box3();
      const size = new THREE.Vector3(), center = new THREE.Vector3();
      const cast = e => {
        const r = el.getBoundingClientRect();
        ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        ray.setFromCamera(ptr, this.camera);
        return ray.intersectObjects(this.pickMeshes, false)[0] || null;
      };
      el.addEventListener('pointermove', e => {
        if (this._dragging) { this.tip.style.display = 'none'; this._hoveredObj = null; this._hoverBox.visible = false; return; }
        const hit = cast(e);
        const u = hit ? hit.object.userData : null;
        if (u) {
          let html;
          if (u.zone === 'HALL') html = '<b>' + u.id + '</b><br>' + u.sub;
          else if (u.zone === 'LOUNGE') html = '<b>' + u.id + '</b><br>Networking &amp; refreshments';
          else if (u.zone === 'SERVICE') html = '<b>' + u.id + '</b><br>' + u.desc +
            '<br><span class="dim">' + u.w + ' m × ' + u.d + ' m · service counter</span>';
          else if (u.zone === 'BRAND') html = '<b>EGN CONNECT X</b><br>' + u.desc +
            '<br><span class="dim">' + u.diam + ' m ⌀ · welcome plaza</span>';
          else html = '<b>Booth ' + u.id + '</b> · ' + u.sqm + ' SQM<br>' + ZONE[u.zone].name +
            '<br><span class="dim">' + u.w + 'm × ' + u.d + 'm · click for details</span>';
          this.tip.innerHTML = html;
          this.tip.style.display = 'block';
          const r = el.getBoundingClientRect();
          this.tip.style.left = (e.clientX - r.left) + 'px';
          this.tip.style.top = (e.clientY - r.top) + 'px';
          el.style.cursor = 'pointer';
          // Hover outline: a crisp box around whatever was hit, sized straight
          // from its own world-space bounds — works uniformly for booths,
          // halls, the lounge pad, service counters and the brand plaza
          // without needing per-type dimension bookkeeping.
          if (this._hoveredObj !== hit.object) {
            this._hoveredObj = hit.object;
            box3.setFromObject(hit.object);
            box3.getSize(size); box3.getCenter(center);
            this._hoverBox.position.copy(center);
            this._hoverBox.scale.set(size.x + 0.08, size.y + 0.08, size.z + 0.08);
            this._hoverBox.visible = true;
          }
        } else {
          this.tip.style.display = 'none';
          el.style.cursor = 'grab';
          this._hoveredObj = null;
        }
      });
      el.addEventListener('pointerleave', () => { this.tip.style.display = 'none'; this._hoveredObj = null; });
      el.addEventListener('pointerup', e => {
        if (!this._downAt) return;
        const moved = Math.hypot(e.clientX - this._downAt.x, e.clientY - this._downAt.y);
        this._downAt = null;
        if (moved > 6 || e.button === 2) return;
        const hit = cast(e);
        const u = hit ? hit.object.userData : null;
        if (u && u.sqm) {
          this._select(u);
        } else if (u && (u.zone === 'HALL' || u.zone === 'LOUNGE' || u.zone === 'SERVICE' || u.zone === 'BRAND')) {
          // facilities have no footprint beacon of their own, but must still
          // clear any beacon left over from a previously-selected booth
          this._selected = null;
          this._beacon.visible = false;
          this.dispatchEvent(new CustomEvent('booth-select', { detail: u }));
        } else {
          this.clearSelection();
        }
      });
    }

    _resize() {
      if (!this.renderer) return;
      const w = this.clientWidth || 800, h = this.clientHeight || 500;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  customElements.define('floor-3d', Floor3D);
})();
