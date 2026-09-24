(() => {
  const canvas = document.getElementById('scene');
  let renderer;
  try {
    if (!window.THREE) throw 0;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) {
    document.documentElement.classList.add('no3d');
    document.getElementById('noWebgl').hidden = false;
    initClockUI(() => {});
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 400);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  // lon/lat -> scene x/z (equirectangular, corrected at 50.5°N). North = -z.
  const K = 10, CX = Math.cos(50.5 * Math.PI / 180);
  const P = (lon, lat) => [(lon - 4.47) * K * CX, -(lat - 50.5) * K];
  const LAND = 0.5; // extruded height of Belgium
  let wx = null, skyKey = ''; // latest weather, last sky colour set

  // --- lights
  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.7);
  const sun = new THREE.DirectionalLight(0xffffff, 0.8);
  scene.add(hemi, sun);

  // --- themed materials
  const M = {
    land: new THREE.MeshStandardMaterial({ roughness: 0.95 }),
    sea: new THREE.MeshStandardMaterial({ roughness: 0.6 }),
    volt: new THREE.MeshBasicMaterial(),
    dist: new THREE.MeshBasicMaterial(),
    nuc: new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide }),
    gas: new THREE.MeshStandardMaterial({ roughness: 0.7 }),
    wind: new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.5 }),
    solar: new THREE.MeshStandardMaterial({ color: 0x5E9FD4, roughness: 0.25, metalness: 0.3 }),
    water: new THREE.MeshStandardMaterial({ roughness: 0.3 }),
    city: new THREE.MeshStandardMaterial({ roughness: 0.9, emissive: 0xffb347, emissiveIntensity: 0 }),
    steam: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }),
  };

  // owner colours (tokens --own-*): who owns the big plants and offshore parks
  const OWNERS = ['engie', 'luminus', 'total', 'parkwind', 'otary', 'norther', 'cpower'];
  const OWN = Object.fromEntries(OWNERS.map(o => [o, new THREE.MeshStandardMaterial({ roughness: 0.55 })]));

  // --- Belgium (approximate outline, lon/lat)
  const outline = [[2.54,51.09],[3.37,51.37],[3.85,51.21],[4.24,51.36],[4.38,51.44],[4.54,51.48],[4.78,51.50],[5.04,51.47],[5.24,51.31],[5.49,51.29],[5.84,51.16],[5.64,50.85],[5.70,50.76],[6.02,50.75],[6.27,50.62],[6.18,50.52],[6.40,50.33],[6.13,50.13],[5.97,50.17],[5.75,49.86],[5.90,49.66],[5.82,49.55],[5.47,49.50],[5.30,49.66],[4.87,49.80],[4.85,50.15],[4.70,50.10],[4.43,49.94],[4.15,49.98],[4.22,50.26],[3.66,50.36],[3.29,50.53],[3.16,50.79],[2.86,50.72],[2.61,50.82]];
  const shape = new THREE.Shape();
  outline.forEach(([lo, la], i) => { const [x, z] = P(lo, la); i ? shape.lineTo(x, -z) : shape.moveTo(x, -z); });
  const land = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: LAND, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.06, bevelSegments: 2 }), M.land);
  land.rotation.x = -Math.PI / 2; land.userData.noEdges = true;
  scene.add(land);
  // blueprint look: thin outline of Belgium + faint perspective grid under the map
  const wireMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });
  const landEdges = new THREE.LineSegments(new THREE.EdgesGeometry(land.geometry, 20), wireMat);
  landEdges.rotation.x = -Math.PI / 2; scene.add(landEdges);
  const grid = new THREE.GridHelper(120, 40);
  grid.material.transparent = true; grid.material.opacity = 0.22; grid.position.y = -0.03;
  scene.add(grid);

  const seaShape = new THREE.Shape();
  [[0.5,50.95],[2.54,51.09],[3.37,51.37],[3.6,51.45],[4.1,51.9],[4.4,52.6],[0.5,52.6]].forEach(([lo, la], i) => { const [x, z] = P(lo, la); i ? seaShape.lineTo(x, -z) : seaShape.moveTo(x, -z); });
  const sea = new THREE.Mesh(new THREE.ShapeGeometry(seaShape), M.sea);
  sea.rotation.x = -Math.PI / 2; sea.position.y = 0.01; sea.userData.noEdges = true;
  scene.add(sea);

  // --- labels (canvas sprites, redrawn on theme change)
  const labels = [];
  function drawLabel(l) {
    const c = l.canvas, g = c.getContext('2d');
    const font = l.big ? '400 40px "IBM Plex Mono", monospace' : '500 34px "IBM Plex Mono", monospace';
    const text = l.big ? l.text.toUpperCase().split('').join('\u2009') : l.text; // letter-spaced country names
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 28;
    c.width = w; c.height = 64;
    g.font = font; g.textBaseline = 'middle'; g.textAlign = 'center';
    if (!l.big) { g.fillStyle = css('--sheet'); g.fillRect(0, 8, w, 50); } // highlight box, like the page text
    g.fillStyle = l.big ? css('--muted') : css('--ink');
    g.fillText(text, w / 2, 34);
    l.sprite.material.map.needsUpdate = true;
    const h = l.big ? 0.9 : 0.55;
    l.sprite.scale.set(h * w / 64, h, 1);
  }
  function label(text, lon, lat, y, big) {
    const canvas = document.createElement('canvas');
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false, opacity: big ? 0.8 : 1 }));
    const [x, z] = P(lon, lat);
    sprite.position.set(x, y, z);
    const l = { text, big, canvas, sprite };
    labels.push(l); scene.add(sprite);
    return l;
  }
  [['FRANCE',3.6,49.9],['PAYS-BAS',5.2,51.75],['ALLEMAGNE',6.75,50.55],['LUXEMBOURG',6.25,49.72],['MER DU NORD',2.1,51.75],['ROYAUME-UNI',1.1,52.35]]
    .forEach(([t, lo, la]) => label(t, lo, la, 0.4, true));

  // --- groups by theme, each gets a focus ring
  const groups = {};
  const rings = [];
  const grp = name => {
    if (!groups[name]) { groups[name] = new THREE.Group(); scene.add(groups[name]); }
    return groups[name];
  };
  function ring(name, lon, lat, y, r) {
    const [x, z] = P(lon, lat);
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.86, r, 48), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.02, z);
    m.userData.name = name;
    rings.push(m); scene.add(m);
  }
  const at = (obj, lon, lat, y = LAND) => { const [x, z] = P(lon, lat); obj.position.set(x, y, z); return obj; };

  // Nuclear: cooling towers + reactor dome + steam
  const steam = [];
  const towerGeo = new THREE.LatheGeometry([[0.5,0],[0.36,0.45],[0.3,0.8],[0.34,1.2]].map(([a, b]) => new THREE.Vector2(a, b)), 24);
  function nuclear(name, lon, lat, own) {
    const g = new THREE.Group();
    [[-0.45, 0], [0.45, 0.2]].forEach(([dx, dz]) => {
      const t = new THREE.Mesh(towerGeo, M.nuc); t.position.set(dx, 0, dz); g.add(t);
      for (let i = 0; i < 5; i++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), M.steam.clone());
        s.userData = { base: new THREE.Vector3(dx, 1.2, dz), phase: i / 5 };
        g.add(s); steam.push(s);
      }
    });
    const dome = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.45, 20), OWN[own]); dome.position.set(0, 0.22, -0.6); g.add(dome);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), OWN[own]); cap.position.set(0, 0.45, -0.6); g.add(cap);
    grp('nuc').add(at(g, lon, lat));
    label(name, lon, lat - 0.12, LAND + 1.9);
    ring('nuc', lon, lat, LAND, 1.4);
  }
  nuclear('Doel', 4.26, 51.32, 'engie');
  nuclear('Tihange', 5.27, 50.53, 'engie');

  // Wind turbines and solar parks, in real numbers: installed capacity from Elia open data (ods086/ods087, sept. 2026).
  // Positions are random inside the right region/province: the count is real, the exact spots are not.
  const inBelgium = (lon, lat) => { // ray casting on the outline
    let inside = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [xi, yi] = outline[i], [xj, yj] = outline[j];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  let seed3 = 42; const r3 = () => (seed3 = (seed3 * 16807) % 2147483647) / 2147483647;
  // province: [centre lon, lat, spread (deg), MW solaire, région]
  const PROV = {
    'Anvers': [4.65, 51.2, 0.22, 2029, 'VL'], 'Flandre-Orientale': [3.82, 51.0, 0.22, 2040, 'VL'],
    'Flandre-Occidentale': [3.05, 51.0, 0.24, 1912, 'VL'], 'Brabant flamand': [4.62, 50.88, 0.2, 1168, 'VL'],
    'Limbourg': [5.4, 51.0, 0.2, 1565, 'VL'], 'Bruxelles': [4.37, 50.84, 0.05, 331, 'BR'],
    'Brabant wallon': [4.6, 50.67, 0.12, 358, 'WAL'], 'Hainaut': [4.0, 50.45, 0.28, 1058, 'WAL'],
    'Namur': [4.85, 50.28, 0.25, 445, 'WAL'], 'Liège': [5.72, 50.5, 0.24, 854, 'WAL'], 'Luxembourg': [5.5, 49.95, 0.25, 368, 'WAL'],
  };
  // micro scenes (see below) keep a clear area around them: [lon, lat, radius in deg]
  const CLEAR = [[3.95, 51.12, 0.07], [5.25, 51.02, 0.08], [4.82, 50.44, 0.07], [4.52, 50.93, 0.07], [3.8, 51.09, 0.06],
    [4.34, 51.27, 0.07], [3.25, 51.27, 0.06], ...[0, 1, 2, 3, 4].map(i => [4.6 + i * 0.0875, 50.8 - i * 0.035, 0.05])];
  const clear = (lon, lat) => CLEAR.every(([a, b, r]) => Math.hypot((lon - a) * CX, lat - b) > r);
  function spot(lon, lat, spread) { // random point near a centre, inside Belgium
    for (let k = 0; k < 50; k++) {
      const a = r3() * 6.283, d = Math.sqrt(r3()) * spread;
      const lo = lon + Math.cos(a) * d / CX, la = lat + Math.sin(a) * d;
      if (inBelgium(lo, la) && clear(lo, la)) return [lo, la];
    }
    return [lon, lat];
  }
  const dummy = new THREE.Object3D();

  // turbines: one instanced mast + one instanced 3-blade rotor
  const MW_PER_TURBINE = { land: 2.7 }; // average onshore size (assumption): ≈ 1 400 onshore turbines
  const WIND_MW = { VL: 2057, WAL: 1672 };
  const turbines = []; // [x, y, z, phase]
  // offshore: the 9 Belgian park sites with their real turbine counts (399), coloured by main owner; positions approximate
  const PARKS = [ // [park, lon, lat, turbines, owner]
    ['Norther', 3.02, 51.53, 44, 'norther'], ['C-Power', 2.93, 51.545, 54, 'cpower'], ['Rentel', 2.95, 51.59, 42, 'otary'],
    ['Northwind', 2.90, 51.62, 72, 'parkwind'], ['SeaMade (Seastar)', 2.86, 51.635, 30, 'otary'], ['Nobelwind', 2.83, 51.655, 50, 'parkwind'],
    ['Belwind', 2.79, 51.675, 56, 'parkwind'], ['Northwester 2', 2.75, 51.695, 23, 'parkwind'], ['SeaMade (Mermaid)', 2.71, 51.715, 28, 'otary'],
  ];
  PARKS.forEach(([, lon, lat, n, own]) => {
    const cols = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) {
      const [x, z] = P(lon + ((i % cols) - cols / 2) * 0.007, lat + (Math.floor(i / cols) - cols / 2) * 0.0045);
      turbines.push([x, 0, z, r3() * 6.28, own]);
    }
  });
  const nSea = turbines.length;
  ['VL', 'WAL'].forEach(reg => {
    const provs = Object.values(PROV).filter(p => p[4] === reg);
    const area = provs.reduce((s, p) => s + p[2] * p[2], 0);
    provs.forEach(([lo, la, sp]) => {
      const n = Math.round(WIND_MW[reg] / MW_PER_TURBINE.land * sp * sp / area);
      for (let i = 0; i < n; i++) { const [a, b] = spot(lo, la, sp); const [x, z] = P(a, b); turbines.push([x, LAND, z, r3() * 6.28]); }
    });
  });
  // Luminus is the largest onshore wind producer: 314 turbines (847 MW). Which ones is not modelled: 314 picked at random.
  for (let k = 0; k < 314; k++) {
    let i; do { i = nSea + Math.floor(r3() * (turbines.length - nSea)); } while (turbines[i][4]);
    turbines[i][4] = 'luminus';
  }
  const H = 0.34; // hub height in scene units (not to scale, or they would be invisible)
  const mastGeo = new THREE.CylinderGeometry(0.008, 0.014, H, 5); mastGeo.translate(0, H / 2, 0);
  const rotorGeo = (() => { // three blades merged into one geometry
    const blades = [0, 1, 2].map(i => { const g = new THREE.BoxGeometry(0.018, 0.2, 0.004).toNonIndexed(); g.translate(0, 0.1, 0); g.rotateZ(i * Math.PI * 2 / 3); return g; });
    const merged = new THREE.BufferGeometry();
    ['position', 'normal'].forEach(k => merged.setAttribute(k, new THREE.Float32BufferAttribute(blades.flatMap(g => [...g.attributes[k].array]), 3)));
    return merged;
  })();
  const masts = new THREE.InstancedMesh(mastGeo, M.wind, turbines.length);
  const rotorsIM = new THREE.InstancedMesh(rotorGeo, M.wind, turbines.length);
  const white = new THREE.Color(0xffffff);
  turbines.forEach(([x, y, z, , own], i) => {
    dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.updateMatrix(); masts.setMatrixAt(i, dummy.matrix);
    const c = own ? new THREE.Color(css('--own-' + own)) : new THREE.Color(css('--muted'));
    masts.setColorAt(i, c); rotorsIM.setColorAt(i, c);
  });
  grp('wind').add(masts, rotorsIM);
  function spinTurbines(t, windFromDeg, kt) { // rotors face the wind, spin faster when it blows harder
    const yaw = Math.PI - windFromDeg * Math.PI / 180, w = 0.6 + Math.min(kt, 30) * 0.15;
    turbines.forEach(([x, y, z, ph], i) => {
      dummy.position.set(x, y + H, z); dummy.rotation.set(0, yaw, ph + t * w); dummy.updateMatrix();
      rotorsIM.setMatrixAt(i, dummy.matrix);
    });
    rotorsIM.instanceMatrix.needsUpdate = true;
  }
  label('Parcs éoliens en mer', 2.95, 51.8, 1.6);
  ring('wind', 2.95, 51.64, 0, 2.4);
  // energy island
  const island = at(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.2, 0.4), M.gas), 2.55, 51.66, 0.1);
  grp('wind').add(island);
  label('Île Princesse Elisabeth', 2.4, 51.62, 1.1);

  // solar: one tile ≈ 25 MW, spread by province according to its installed capacity
  const MW_PER_TILE = 25;
  const tiles = [];
  Object.values(PROV).forEach(([lo, la, sp, mw]) => {
    for (let i = 0; i < Math.round(mw / MW_PER_TILE); i++) tiles.push(spot(lo, la, sp));
  });
  const solarIM = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.015, 0.13), M.solar, tiles.length);
  tiles.forEach(([lo, la], i) => {
    const [x, z] = P(lo, la);
    dummy.position.set(x, LAND + 0.1, z); dummy.rotation.set(-0.35, r3() * 0.6 - 0.3, 0); dummy.updateMatrix();
    solarIM.setMatrixAt(i, dummy.matrix);
  });
  grp('solar').add(solarIM);
  window.mapCounts = { turbines: turbines.length, offshore: nSea, tiles: tiles.length };

  // Gas plants
  function gasPlant(name, lon, lat, own) {
    const g = new THREE.Group();
    const hall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.45), OWN[own]); hall.position.y = 0.17; g.add(hall);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 10), OWN[own]); stack.position.set(0.25, 0.55, 0); g.add(stack);
    grp('gas').add(at(g, lon, lat)); // no label: they sit next to city names
    ring('gas', lon, lat, LAND, 0.9);
  }
  gasPlant('Drogenbos', 4.31, 50.79, 'engie');
  gasPlant('Amercœur', 4.43, 50.42, 'engie');
  gasPlant('Seraing', 5.48, 50.6, 'luminus');
  gasPlant('Ringvaart', 3.70, 51.02, 'luminus');
  // Hydro plants (list: fr.wikipedia « Liste des centrales électriques en Belgique »), small dam markers in owner colour
  const HYDRO = [ // [nom, lon, lat, MW, propriétaire]
    ['Lixhe', 5.68, 50.76, 20, 'luminus'], ['Monsin', 5.63, 50.67, 18, 'luminus'], ['Ivoz-Ramet', 5.44, 50.58, 10, 'luminus'],
    ['Ampsin-Neuville', 5.28, 50.54, 10, 'luminus'], ['Andenne', 5.09, 50.49, 9, 'luminus'], ['Grands-Malades', 4.88, 50.48, 5, 'luminus'],
    ['Floriffoux', 4.77, 50.45, 1, 'luminus'],
    ['Bévercé', 6.03, 50.44, 9.2, 'engie'], ['Bütgenbach', 6.2, 50.43, 1.8, 'engie'], ['Heid-de-Goreux', 5.68, 50.47, 8.1, 'engie'], ['La Vierre', 5.4, 49.74, 1.9, 'engie'],
  ];
  HYDRO.forEach(([, lo, la, mw, own]) => {
    const w = 0.18 + Math.sqrt(mw) * 0.05;
    grp('coo').add(at(new THREE.Mesh(new THREE.BoxGeometry(w, 0.16, 0.12), OWN[own]), lo, la, LAND + 0.08));
    ring('coo', lo, la, LAND, w * 0.9);
  });
  label('Centrales au fil de la Meuse', 5.3, 50.47, LAND + 0.7);
  // Plate-Taille: pumped storage at the Eau d'Heure lakes (143 MW)
  {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.35, 24), OWN.total); base.position.y = 0.17; g.add(base);
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.03, 24), M.water); w.position.y = 0.36; g.add(w);
    grp('coo').add(at(g, 4.40, 50.18));
    label('Plate-Taille', 4.40, 50.12, LAND + 1.0);
    ring('coo', 4.40, 50.18, LAND, 0.8);
  }

  // Solar fields (and rooftops)
  const solarGeo = new THREE.BoxGeometry(0.32, 0.02, 0.2);
  [[5.35,51.0],[3.9,50.8],[4.9,50.3],[3.3,50.6],[5.5,49.8],[4.6,51.1]].forEach(([lo, la]) => {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const p = new THREE.Mesh(solarGeo, M.solar);
      p.position.set(i * 0.36 - 0.36, 0.08, j * 0.3); p.rotation.x = -0.45; g.add(p);
    }
    grp('solar').add(at(g, lo, la));
    ring('solar', lo, la + 0.01, LAND, 0.7);
  });

  // Coo pumped storage: two upper basins + lower lake
  {
    const g = new THREE.Group();
    [[0, 0], [0.9, -0.3]].forEach(([dx, dz]) => {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 0.6, 28), OWN.engie); base.position.set(dx, 0.3, dz); g.add(base);
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.03, 28), M.water); w.position.set(dx, 0.61, dz); g.add(w);
    });
    const low = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.03, 28), M.water); low.position.set(-0.4, 0.02, 1.1); g.add(low);
    grp('coo').add(at(g, 5.87, 50.39));
    label('Coo-Trois-Ponts', 5.9, 50.33, LAND + 1.6);
    ring('coo', 5.89, 50.38, LAND, 1.6);
  }

  // Cities: small building clusters that light up at night
  const cities = [['Bruxelles',4.35,50.85,1.3],['Anvers',4.40,51.22,1],['Gand',3.72,51.05,0.8],['Liège',5.57,50.63,0.8],['Charleroi',4.44,50.41,0.7],['Namur',4.87,50.47,0.5],['Bruges',3.22,51.21,0.5]];
  const bGeo = new THREE.BoxGeometry(0.12, 1, 0.12); bGeo.translate(0, 0.5, 0);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  cities.forEach(([name, lo, la, s]) => {
    const g = new THREE.Group();
    for (let i = 0; i < Math.round(18 * s); i++) {
      const b = new THREE.Mesh(bGeo, M.city);
      const r = Math.sqrt(rnd()) * 0.45 * s, a = rnd() * 6.28;
      b.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      b.scale.y = 0.1 + (1 - r / (0.45 * s + 0.01)) * 0.5 * s * (0.5 + rnd());
      g.add(b);
    }
    grp('city').add(at(g, lo, la));
    label(name, lo, la - 0.04, LAND + 1.1 * s + 0.4);
    ring('city', lo, la, LAND, 0.7 * s + 0.2);
  });

  // --- network (approximate 380/220 kV backbone + interconnectors)
  const N = {
    doel:[4.26,51.32], zandvliet:[4.33,51.52], mercator:[4.30,51.15], horta:[3.72,51.0], stevin:[3.2,51.32], uk:[1.8,51.95],
    island:[2.55,51.66], avelgem:[3.45,50.78], avelin:[3.1,50.52], bruegel:[4.33,50.93], gramme:[5.27,50.55], lixhe:[5.68,50.75],
    vaneyck:[5.62,51.05], maas:[5.95,51.3], oberzier:[6.55,50.85], courcelles:[4.38,50.47], chooz:[4.8,49.98], achene:[5.05,50.27],
    aubange:[5.8,49.57], lux:[6.15,49.55], coo:[5.87,50.39], drogenbos:[4.31,50.79], ringvaart:[3.70,51.02], seraing:[5.48,50.6], amercoeur:[4.43,50.42]
  };
  const backbone = [['doel','mercator'],['mercator','horta'],['horta','stevin'],['stevin','island'],['horta','avelgem'],['mercator','bruegel'],
    ['gramme','bruegel'],['gramme','lixhe'],['lixhe','vaneyck'],['gramme','courcelles'],['courcelles','avelgem'],['bruegel','courcelles'],
    ['gramme','achene'],['achene','aubange'],['coo','lixhe'],['coo','gramme'],['drogenbos','bruegel'],['ringvaart','horta'],['seraing','lixhe'],['amercoeur','courcelles']];
  const inter = [['stevin','uk'],['doel','zandvliet'],['vaneyck','maas'],['lixhe','oberzier'],['avelgem','avelin'],['courcelles','chooz'],['aubange','lux']];
  const inBE = k => !['uk','zandvliet','maas','oberzier','avelin','chooz','lux','island'].includes(k);
  const nodePos = k => { const [x, z] = P(...N[k]); return new THREE.Vector3(x, inBE(k) ? LAND + 0.05 : 0.05, z); };

  const lines = []; // {curve, len, kind, mat}
  function wire(a, b, kind, mat, lift, radius) {
    const A = nodePos(a), B = nodePos(b);
    const len = A.distanceTo(B);
    const mid = A.clone().lerp(B, 0.5); mid.y = Math.max(A.y, B.y) + lift + len * 0.08;
    const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
    const m = mat.clone(); m.transparent = true;
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, radius, 5), m);
    scene.add(mesh);
    lines.push({ curve, len, kind, mesh, rev: kind === 'inter' && lines.length % 2 === 0 });
  }
  // voltage of each link (for colour): main axes and borders 380 kV, plant spurs 150 kV, offshore export 220 kV
  const SPUR = ['drogenbos', 'ringvaart', 'seraing', 'amercoeur', 'coo'];
  backbone.forEach(([a, b]) => {
    wire(a, b, 'grid', M.volt, 0.5, 0.03);
    lines[lines.length - 1].kv = b === 'island' ? '--kv220' : SPUR.includes(a) || SPUR.includes(b) ? '--kv150' : '--kv380';
  });
  inter.forEach(([a, b]) => { wire(a, b, 'inter', M.volt, 0.5, 0.035); lines[lines.length - 1].kv = '--kv380'; });
  // substations
  Object.keys(N).filter(inBE).forEach(k => {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.18), M.gas);
    s.position.copy(nodePos(k)); s.position.y += 0.02; scene.add(s);
  });
  // distribution: substation -> city
  const distLinks = [['bruegel',4.35,50.85],['mercator',4.40,51.22],['horta',3.72,51.05],['lixhe',5.57,50.63],['courcelles',4.44,50.41],['achene',4.87,50.47],['stevin',3.22,51.21],['drogenbos',4.33,50.83]];
  distLinks.forEach(([k, lo, la], i) => {
    N['c' + i] = [lo, la];
    wire(k, 'c' + i, 'dist', M.dist, 0.1, 0.02); lines[lines.length - 1].kv = '--kv15';
  });

  // --- current particles
  const dotTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.9)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const parts = [];
  lines.forEach((l, li) => { const n = Math.max(2, Math.round(l.len * 0.9)); for (let i = 0; i < n; i++) parts.push({ li, o: i / n }); });
  const pPos = new Float32Array(parts.length * 3);
  const pCol = new Float32Array(parts.length * 3);
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.42, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  scene.add(points);


  // ===================== Micro scenes: detailed minimalist models reached by zooming in =====================
  // Each sits at its real place on the map; the scroll camera (SHOTS below) dives into it. Animations: anim[] each frame.
  const anim = [];
  M.part = new THREE.MeshStandardMaterial();                  // white drafting fill
  M.accent = new THREE.MeshStandardMaterial();                // yellow details
  M.heat = new THREE.MeshStandardMaterial();                  // heat pipes
  const mk = (geo, mat = M.part) => new THREE.Mesh(geo, mat);
  const B = (w, h, d, mat) => mk(new THREE.BoxGeometry(w, h, d), mat);
  const C = (rt, rb, h, seg = 16, mat) => mk(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  const put = (o, x, y, z) => { o.position.set(x, y, z); return o; };
  const site = (lon, lat, y = LAND + 0.06) => { const g = new THREE.Group(), [x, z] = P(lon, lat); g.position.set(x, y, z); scene.add(g); return g; };
  const lineMat = new THREE.LineBasicMaterial();
  // particles running along curves (air, current, water, heat); curves are in the parent's local space
  function flow(parent, curves, n, speed, color, size = 0.012) {
    const pos = new Float32Array(n * 3), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size, color, transparent: true, depthWrite: false }));
    parent.add(pts);
    const seeds = Array.from({ length: n }, (_, i) => [i % curves.length, (i * 0.618) % 1]);
    anim.push(t => {
      const sp = typeof speed === 'function' ? speed() : speed;
      seeds.forEach(([c, o], i) => { const p = curves[c].getPoint(((o + t * sp) % 1 + 1) % 1); pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; });
      g.attributes.position.needsUpdate = true;
    });
  }
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const seg3 = (a, b) => new THREE.LineCurve3(a, b);
  const YELLOW = 0xF2B705, AIR = 0x8A8F96, WATER = 0x3B6FB4, HEAT = 0xD2372E;

  // detailed turbine (same size as the generic ones): tower, nacelle, hub, tapered blades
  function heroTurbine(parent, y0 = 0) {
    const g = new THREE.Group(); g.position.y = y0; parent.add(g);
    g.add(put(C(0.006, 0.012, 0.34, 12), 0, 0.17, 0));
    g.add(put(B(0.022, 0.02, 0.05), 0, 0.35, -0.008));
    const rotor = new THREE.Group(); rotor.position.set(0, 0.35, 0.02); g.add(rotor);
    const hub = mk(new THREE.ConeGeometry(0.009, 0.02, 12)); hub.rotation.x = Math.PI / 2; rotor.add(hub);
    const blade = new THREE.Shape(); blade.moveTo(-0.006, 0); blade.lineTo(0.008, 0.012); blade.lineTo(0.003, 0.19); blade.lineTo(-0.002, 0.19); blade.closePath();
    const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.002, bevelEnabled: false });
    for (let i = 0; i < 3; i++) { const b = mk(bladeGeo); b.rotation.z = i * Math.PI * 2 / 3; rotor.add(b); }
    anim.push((t, dt) => { rotor.rotation.z -= dt * (0.6 + Math.min(windKt || 8, 30) * 0.12) * (reduced ? 0 : 1); g.rotation.y = Math.PI - windFrom * Math.PI / 180; });
    // air flowing through the rotor, along the wind
    const air = [0.28, 0.35, 0.42].flatMap(h => [-0.06, 0.06].map(x => seg3(V3(x, h, 0.5), V3(x, h, -0.5))));
    flow(g, air, 36, () => 0.05 + (windKt || 8) * 0.012, AIR, 0.008);
    return g;
  }

  // 1. onshore wind, Flanders
  heroTurbine(site(3.95, 51.12, LAND));
  // 2. offshore: monopile, yellow transition piece, turbine, offshore substation, waves
  {
    const g = site(3.12, 51.48, 0);
    g.add(put(C(0.01, 0.01, 0.08, 12), 0, -0.02, 0));
    g.add(put(C(0.013, 0.013, 0.03, 12, M.accent), 0, 0.03, 0));
    heroTurbine(g, 0.045);
    const sub = new THREE.Group(); sub.position.set(0.3, 0, 0.1); g.add(sub);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) => sub.add(put(C(0.004, 0.004, 0.08, 6), a * 0.04, 0.02, b * 0.03)));
    sub.add(put(B(0.11, 0.05, 0.08), 0, 0.085, 0));
    sub.add(put(B(0.03, 0.02, 0.03, M.accent), 0.02, 0.12, 0));
    for (let k = 0; k < 5; k++) { // waves
      const pts = Array.from({ length: 60 }, (_, i) => V3(-0.6 + i * 0.02, 0, -0.3 + k * 0.15));
      const geo = new THREE.BufferGeometry().setFromPoints(pts), wave = new THREE.Line(geo, lineMat); g.add(wave);
      anim.push(t => { const a = geo.attributes.position; for (let i = 0; i < a.count; i++) a.setY(i, 0.006 * Math.sin(i * 0.5 + t * 1.5 + k)); a.needsUpdate = true; });
    }
    flow(g, [new THREE.CatmullRomCurve3([V3(0.3, 0.06, 0.1), V3(0.3, -0.03, 0.2), V3(0.3, -0.03, 1.2)])], 12, 0.15, YELLOW, 0.01);
  }
  // 3. solar: house with rooftop panels + a ground-mounted field that tracks the sun, sun rays
  {
    const g = site(5.25, 51.02);
    g.add(put(B(0.1, 0.06, 0.07), 0, 0.03, 0));
    const roofS = put(B(0.104, 0.004, 0.05), 0, 0.078, 0.018); roofS.rotation.x = 0.7; g.add(roofS);
    const roofN = put(B(0.104, 0.004, 0.05), 0, 0.078, -0.018); roofN.rotation.x = -0.7; g.add(roofN);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const pnl = put(B(0.026, 0.002, 0.018, M.solar), -0.03 + i * 0.03, 0.004, -0.01 + j * 0.021); roofS.add(pnl);
    }
    const field = new THREE.Group(); field.position.set(0.22, 0, 0.05); g.add(field);
    for (let r = 0; r < 3; r++) {
      const row = new THREE.Group(); row.position.set(0, 0.018, r * 0.06); field.add(row);
      for (let i = 0; i < 5; i++) { row.add(put(B(0.028, 0.002, 0.03, M.solar), -0.06 + i * 0.03, 0, 0)); field.add(put(C(0.002, 0.002, 0.018, 6), -0.06 + i * 0.03, 0.009, r * 0.06)); }
      anim.push(t => { const a = (hour - 12) / 12 * Math.PI; row.rotation.x = -0.45; row.rotation.z = reduced ? 0 : Math.max(-0.8, Math.min(0.8, a)) * 0.6; });
    }
    const rays = Array.from({ length: 8 }, (_, i) => seg3(V3(0.5 + i * 0.02, 0.6, -0.4), V3(-0.05 + (i % 4) * 0.09, 0.03, (i < 4 ? 0.02 : 0.12))));
    flow(g, rays, 40, 0.25, YELLOW, 0.009);
  }
  // 4. high-voltage line: lattice pylons, sagging conductors, current pulses
  {
    const A = P(4.6, 50.8), Bp = P(4.95, 50.66), n = 5, H = 0.25;
    const verts = [], cables = [[], []];
    for (let k = 0; k < n; k++) {
      const x = A[0] + (Bp[0] - A[0]) * k / (n - 1), z = A[1] + (Bp[1] - A[1]) * k / (n - 1), y = LAND + 0.06;
      const w = (h) => 0.022 * (1 - h / H) + 0.006; // half-width tapering with height
      const L = h => [[-w(h), -w(h)], [w(h), -w(h)], [w(h), w(h)], [-w(h), w(h)]];
      for (let lv = 0; lv < 5; lv++) {
        const h0 = lv * H / 5, h1 = (lv + 1) * H / 5, a = L(h0), b = L(h1);
        for (let c = 0; c < 4; c++) {
          verts.push(x + a[c][0], y + h0, z + a[c][1], x + b[c][0], y + h1, z + b[c][1]);                 // legs
          const d = (c + 1) % 4;
          verts.push(x + a[c][0], y + h0, z + a[c][1], x + b[d][0], y + h1, z + b[d][1]);                 // bracing
          verts.push(x + b[c][0], y + h1, z + b[c][1], x + b[d][0], y + h1, z + b[d][1]);                 // ring
        }
      }
      [[0.8, 0.07], [0.95, 0.05]].forEach(([f, arm], i) => {                                               // crossarms
        verts.push(x - arm, y + H * f, z, x + arm, y + H * f, z);
        cables[i].push(V3(x - arm, y + H * f - 0.01, z), V3(x + arm, y + H * f - 0.01, z));
      });
    }
    const pylons = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat);
    pylons.geometry.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); scene.add(pylons);
    const curves = [];
    cables.forEach(tips => [0, 1].forEach(side => {                                                        // one conductor per arm tip
      const pts = [];
      for (let k = 0; k < n - 1; k++) {
        const p0 = tips[k * 2 + side], p1 = tips[(k + 1) * 2 + side];
        for (let s2 = 0; s2 < 8; s2++) { const u = s2 / 8; pts.push(p0.clone().lerp(p1, u).add(V3(0, -0.035 * Math.sin(Math.PI * u), 0))); }
      }
      pts.push(tips[(n - 1) * 2 + side]);
      const c = new THREE.CatmullRomCurve3(pts); curves.push(c);
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(c.getPoints(120)), lineMat));
    }));
    flow(scene, curves, 48, 0.05, YELLOW, 0.012);
  }
  // 5. local distribution: substation cabin (transformer symbol) feeding a street through underground cables
  {
    const g = site(4.82, 50.44);
    g.add(put(B(0.05, 0.04, 0.035), 0, 0.02, 0));
    [-0.006, 0.006].forEach(dx => { const r = mk(new THREE.TorusGeometry(0.008, 0.0015, 8, 24), M.accent); r.position.set(dx, 0.022, 0.018); g.add(r); });
    const lines = [];
    for (let i = 0; i < 6; i++) {
      const hx = -0.15 + i * 0.06, hz = 0.12;
      g.add(put(B(0.035, 0.03, 0.03), hx, 0.015, hz));
      const rf = put(B(0.037, 0.003, 0.022), hx, 0.036, hz + 0.008); rf.rotation.x = 0.6; g.add(rf);
      const rb = put(B(0.037, 0.003, 0.022), hx, 0.036, hz - 0.008); rb.rotation.x = -0.6; g.add(rb);
      lines.push(new THREE.CatmullRomCurve3([V3(0, 0.005, 0.02), V3(0, -0.01, 0.07), V3(hx, -0.01, 0.07), V3(hx, 0.005, hz - 0.015)]));
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(lines[i].getPoints(20)), lineMat));
    }
    flow(g, lines, 36, 0.3, YELLOW, 0.008);
  }
  // 6. house cutaway: meter counting kWh, fridge, washing machine with spinning drum, TV
  {
    const g = site(4.52, 50.93);
    g.add(put(B(0.2, 0.004, 0.14), 0, 0, 0));
    g.add(put(B(0.2, 0.1, 0.004), 0, 0.05, -0.07));
    g.add(put(B(0.004, 0.1, 0.14), -0.1, 0.05, 0));
    g.add(put(B(0.025, 0.05, 0.022), -0.07, 0.027, -0.05));                 // fridge
    g.add(put(B(0.026, 0.028, 0.026), -0.035, 0.016, -0.05));              // washing machine
    const drum = mk(new THREE.TorusGeometry(0.008, 0.0015, 8, 20), M.accent); drum.position.set(-0.035, 0.017, -0.036); g.add(drum);
    anim.push((t, dt) => { drum.rotation.z += dt * 6 * (reduced ? 0 : 1); });
    g.add(put(B(0.045, 0.028, 0.003), 0.04, 0.045, -0.067));                // TV
    g.add(put(B(0.02, 0.03, 0.006), 0.085, 0.06, -0.066));                  // meter box
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
    const disp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthWrite: false }));
    disp.position.set(0.085, 0.1, -0.06); disp.scale.set(0.06, 0.015, 1); g.add(disp);
    let kwh = 3412.6, last = -1;
    anim.push(t => {
      if (Math.floor(t * 2) === last) return; last = Math.floor(t * 2); kwh += 0.1;
      const c = cv.getContext('2d'); c.fillStyle = css('--sheet'); c.fillRect(0, 0, 256, 64); c.strokeStyle = css('--ink'); c.lineWidth = 3; c.strokeRect(2, 2, 252, 60);
      c.fillStyle = css('--ink'); c.font = '500 34px "IBM Plex Mono", monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(kwh.toFixed(1).padStart(7, '0') + ' kWh', 128, 34); disp.material.map.needsUpdate = true;
    });
    const wires = [[-0.07, 0.05], [-0.035, 0.03], [0.04, 0.045]].map(([x, h]) => new THREE.CatmullRomCurve3([V3(0.085, 0.05, -0.064), V3(0.085, 0.004, -0.064), V3(x, 0.004, -0.064), V3(x, h, -0.064)], false, 'catmullrom', 0));
    wires.push(new THREE.CatmullRomCurve3([V3(0.3, 0.004, -0.064), V3(0.085, 0.004, -0.064), V3(0.085, 0.05, -0.064)], false, 'catmullrom', 0));
    flow(g, wires, 30, 0.35, YELLOW, 0.006);
  }
  // 7. Port of Antwerp: tank farm, distillation columns, flare with flame
  {
    const g = site(4.34, 51.27);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) g.add(put(C(0.03, 0.03, 0.035, 20), -0.1 + i * 0.075, 0.0175, 0.06 + j * 0.075));
    [0, 0.03, 0.06].forEach((dx, i) => g.add(put(C(0.007, 0.007, 0.12 + i * 0.02, 12), 0.15 + dx, 0.06 + i * 0.01, -0.02)));
    g.add(put(B(0.08, 0.03, 0.05), 0.18, 0.015, 0.06));
    g.add(put(C(0.003, 0.004, 0.2, 8), -0.08, 0.1, -0.08));
    const flame = mk(new THREE.ConeGeometry(0.008, 0.03, 8), M.accent); flame.position.set(-0.08, 0.215, -0.08); flame.userData.noEdges = true; g.add(flame);
    anim.push(t => { flame.scale.set(1, 0.8 + 0.3 * Math.abs(Math.sin(t * 7) * Math.sin(t * 3.1)), 1); });
  }
  // 8. Zeebrugge LNG terminal: tanks on land, an LNG carrier gently rolling, gas flowing to the tanks
  {
    const g = site(3.25, 51.27);
    for (let i = 0; i < 4; i++) { g.add(put(C(0.035, 0.035, 0.04, 24), -0.12 + i * 0.08, 0.02, 0)); g.add(put(mk(new THREE.SphereGeometry(0.035, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2)), -0.12 + i * 0.08, 0.04, 0)); }
    const [sx, sz] = P(3.19, 51.34);
    const ship = new THREE.Group(); ship.position.set(sx - g.position.x, -g.position.y, sz - g.position.z); g.add(ship);
    ship.add(put(B(0.3, 0.03, 0.055), 0, 0.012, 0));
    for (let i = 0; i < 4; i++) ship.add(put(mk(new THREE.SphereGeometry(0.02, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), -0.09 + i * 0.055, 0.027, 0));
    ship.add(put(B(0.03, 0.03, 0.04), 0.13, 0.04, 0));
    anim.push(t => { ship.rotation.x = reduced ? 0 : Math.sin(t * 0.8) * 0.04; ship.position.y = -g.position.y + Math.sin(t * 0.6) * 0.003; });
    flow(g, [new THREE.CatmullRomCurve3([ship.position.clone().add(V3(0, 0.03, 0)), V3(ship.position.x * 0.5, 0.02, ship.position.z * 0.5), V3(0, 0.03, 0.03)])], 20, 0.2, WATER, 0.01);
  }
  // 9. heat network: incinerator feeding buildings through red pipes, warm water circulating
  {
    const g = site(3.8, 51.09);
    g.add(put(B(0.08, 0.05, 0.05), 0, 0.025, 0));
    g.add(put(C(0.007, 0.01, 0.13, 10), 0.03, 0.065, -0.015));
    const pipes = [];
    [[-0.18, 0.1], [-0.08, 0.16], [0.06, 0.15], [0.16, 0.08]].forEach(([bx, bz]) => {
      g.add(put(B(0.05, 0.06 + Math.abs(bx) * 0.2, 0.04), bx, 0.03 + Math.abs(bx) * 0.1, bz));
      const c = new THREE.CatmullRomCurve3([V3(0, 0.006, 0.026), V3(0, 0.006, 0.06), V3(bx, 0.006, 0.06), V3(bx, 0.006, bz - 0.02)], false, 'catmullrom', 0);
      pipes.push(c); const tube = mk(new THREE.TubeGeometry(c, 30, 0.003, 6), M.heat); g.add(tube);
    });
    flow(g, pipes, 32, 0.3, HEAT, 0.008);
  }
  // 10. Coo: water goes up to the basins at night (pumping), down through the turbines by day
  {
    const [x, z] = P(5.87, 50.39), top = V3(x, LAND + 0.61, z), low = V3(x - 0.4, LAND + 0.03, z + 1.1);
    const pen = new THREE.CatmullRomCurve3([top, top.clone().lerp(low, 0.5).add(V3(0.1, 0.05, 0)), low]);
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pen.getPoints(40)), lineMat));
    flow(scene, [pen], 30, () => (hour >= 7 && hour < 22 ? 0.2 : -0.2), WATER, 0.03);
  }

  // --- drafting outlines: every solid gets its edges drawn in ink (like a CAD hidden-line view)
  const edgeMat = new THREE.LineBasicMaterial();
  scene.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.material.transparent) return;
    const t = o.geometry.type;
    if (o.userData.noEdges || t === 'TubeGeometry' || t === 'RingGeometry') return;
    o.add(new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry, 25), edgeMat));
  });
  // Electricity Maps-like carbon colour: green (low) → yellow → brown (high), 0–400 g/kWh
  let co2 = null;
  const co2Color = g => {
    const t = Math.max(0, Math.min(1, g / 400)), c = n => new THREE.Color(css(n));
    return t < 0.5 ? c('--co2-low').lerp(c('--co2-mid'), t * 2) : c('--co2-mid').lerp(c('--co2-high'), (t - 0.5) * 2);
  };
  addEventListener('co2', e => { co2 = e.detail; applyTheme(); });

  // --- theme
  function applyTheme() {
    const col = n => new THREE.Color(css(n));
    // drafting look: flat fills (colour through emissive, no shading) outlined in ink
    const flat = (m, c) => { m.color.setRGB(0, 0, 0); m.emissive = c; m.emissiveIntensity = 1; m.metalness = 0; };
    flat(M.land, co2 == null ? col('--land') : col('--land').lerp(co2Color(co2), 0.25));
    flat(M.sea, col('--sea')); flat(M.nuc, col('--land')); flat(M.gas, col('--land')); flat(M.city, col('--land'));
    flat(M.water, col('--sea')); flat(M.solar, col('--ink'));
    flat(M.part, col('--land')); flat(M.accent, col('--volt')); flat(M.heat, col('--kv220')); lineMat.color = col('--ink');
    wireMat.color = col('--wire'); edgeMat.color = col('--ink');
    grid.material.color = col('--wire'); grid.material.vertexColors = false; grid.material.opacity = 0.12; grid.material.needsUpdate = true;
    M.volt.color = col('--volt'); M.dist.color = col('--kv15');
    // power lines coloured by voltage, like grid maps
    lines.forEach(l => l.mesh.material.color = col(l.kv || '--kv380'));
    rings.forEach(r => r.material.color = col('--ink'));
    OWNERS.forEach(o => flat(OWN[o], col('--own-' + o)));
    setBarbPattern(); skyKey = ''; // re-tint pattern + sky for the new theme
    const dark = new THREE.Color(css('--paper')).getHSL({}).l < 0.4;
    points.material.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    parts.forEach((p, i) => M.volt.color.toArray(pCol, i * 3));
    pGeo.attributes.color.needsUpdate = true;
    labels.forEach(drawLabel);
  }
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  applyTheme();
  document.fonts && document.fonts.ready.then(() => labels.forEach(drawLabel));

  // --- camera shots: what each chapter looks at, from macro (all Belgium) to micro (one installation)
  const v = (lon, lat, y = 0) => { const [x, z] = P(lon, lat); return new THREE.Vector3(x, y, z); };
  const shot = (lon, lat, y, dist, el, az) => ({ look: v(lon, lat, y), dist, el: el * Math.PI / 180, az: az * Math.PI / 180 });
  const SHOTS = { // lon, lat, target height, distance, elevation °, azimuth ° (0 = seen from the south)
    hero: shot(4.4, 50.6, 0, 36, 40, -30),       overview: shot(4.3, 50.7, 0, 34, 55, 0),
    wide: shot(4.2, 50.8, 0, 46, 55, 0),         plan: shot(4.45, 50.6, 0, 34, 86, 0),
    grid: shot(4.5, 50.75, 0, 30, 60, 10),       city: shot(4.35, 50.86, LAND, 5, 40, -15),
    nuclear: shot(4.26, 51.32, LAND + 0.4, 3.5, 25, -25), coo: shot(5.87, 50.39, LAND + 0.3, 3.8, 28, 35),
    wind: shot(3.95, 51.12, LAND + 0.26, 1.35, 14, 30),     offshore: shot(3.14, 51.48, 0.12, 1.3, 16, 20),
    solar: shot(5.3, 51.02, LAND + 0.06, 0.85, 30, 20),   pylons: shot(4.775, 50.73, LAND + 0.18, 2.2, 14, 30),
    dist: shot(4.82, 50.44, LAND + 0.08, 0.6, 32, 15),    house: shot(4.52, 50.93, LAND + 0.1, 0.45, 25, 25),
    port: shot(4.34, 51.27, LAND + 0.1, 0.8, 30, -20),    lng: shot(3.22, 51.305, 0.25, 2.6, 30, -20),
    heat: shot(3.8, 51.09, LAND + 0.08, 0.7, 35, 15),
  };
  const shotPos = (sh, out = new THREE.Vector3()) => out.set(
    sh.look.x + sh.dist * Math.cos(sh.el) * Math.sin(sh.az), sh.look.y + sh.dist * Math.sin(sh.el), sh.look.z + sh.dist * Math.cos(sh.el) * Math.cos(sh.az));
  const mixShot = (a, b, t) => ({
    look: a.look.clone().lerp(b.look, t), dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * t),
    el: a.el + (b.el - a.el) * t, az: a.az + (b.az - a.az) * t,
  });
  const camPos = shotPos(SHOTS.hero), camLook = SHOTS.hero.look.clone();
  let active = null, focus = new Set();

  const sections = [...document.querySelectorAll('.chapter')];
  function pickChapter() {
    const mid = innerHeight * 0.5;
    let best = sections[0], d = Infinity;
    sections.forEach(s => { const r = s.getBoundingClientRect(); const dd = Math.abs((r.top + r.bottom) / 2 - mid); if (dd < d) { d = dd; best = s; } });
    if (best !== active) {
      active = best;
      focus = new Set(best.dataset.focus.split(' ').filter(Boolean));
    }
  }
  addEventListener('scroll', pickChapter, { passive: true });
  pickChapter();

  // the camera is scrubbed by the scroll: it holds each chapter's shot while it is read,
  // and between two far-apart shots it pulls back (macro) before diving in again (micro)
  const shotOf = el => SHOTS[el.dataset.cam] || SHOTS.overview;
  function scrollShot() {
    const mid = innerHeight / 2;
    let prev = null, next = null;
    for (const s of sections) {
      const r = s.getBoundingClientRect(); if (!r.height) continue;
      const c = (r.top + r.bottom) / 2;
      if (c <= mid) prev = [s, c]; else { next = [s, c]; break; }
    }
    if (!prev) return mixShot(shotOf(next[0]), shotOf(next[0]), 0);
    if (!next) return mixShot(shotOf(prev[0]), shotOf(prev[0]), 0);
    let t = (mid - prev[1]) / (next[1] - prev[1]);
    t = Math.min(1, Math.max(0, (t - 0.3) / 0.4)); t = t * t * (3 - 2 * t);
    const a = shotOf(prev[0]), b = shotOf(next[0]), m = mixShot(a, b, t);
    m.dist += Math.sin(Math.PI * t) * a.look.distanceTo(b.look) * 0.6;
    return m;
  }

  let mx = 0, my = 0;
  addEventListener('pointermove', e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });

  // --- weather (data.js fires 'weather'): clouds over the map, wind barbs as a background pattern
  const cloudGroup = new THREE.Group();
  scene.add(cloudGroup);
  cloudGroup.visible = false; // clouds don't belong on a technical drawing; cloud cover stays in the text
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 1, transparent: true, opacity: 0.7, depthWrite: false });
  const puffGeo = new THREE.SphereGeometry(1, 12, 8);

  // Standard wind barb as SVG, drawn pointing north then rotated: staff points to where the wind comes FROM,
  // barbs on the clockwise side (N hemisphere); 50 kt pennant, 10 kt barb, 5 kt half barb, circle = calm.
  function barbSvg(fromDeg, kt, color) {
    const k = Math.round(kt / 5) * 5;
    let body = '';
    if (k < 5) body = `<circle r="8" fill="none" stroke="${color}" stroke-width="2"/>`;
    else {
      let rest = k, y = -34, parts = '';
      while (rest >= 50) { parts += `<path d="M0 ${y}L15 ${y - 5}L0 ${y + 8}Z" fill="${color}"/>`; y += 10; rest -= 50; }
      while (rest >= 10) { parts += `<path d="M0 ${y}L15 ${y - 6}"/>`; y += 6; rest -= 10; }
      if (rest >= 5) { if (y === -34) y += 6; parts += `<path d="M0 ${y}L8 ${y - 3}"/>`; }
      body = `<g stroke="${color}" stroke-width="2" stroke-linecap="round"><path d="M0 0V-34"/>${parts}</g>`;
    }
    const one = (x, y) => `<g transform="translate(${x} ${y}) rotate(${fromDeg.toFixed(0)})">${body}<circle r="2.5" fill="${color}"/></g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" opacity="0.18">${one(40, 40)}${one(120, 120)}</svg>`;
  }
  function setBarbPattern() {
    if (!wx) return;
    // mean wind over all points (vector average for the direction)
    let vx = 0, vy = 0, sp = 0;
    wx.winds.forEach(([d, k]) => { vx += Math.sin(d * Math.PI / 180) * k; vy += Math.cos(d * Math.PI / 180) * k; sp += k; });
    const from = (Math.atan2(vx, vy) * 180 / Math.PI + 360) % 360;
    windFrom = from; windKt = sp / wx.winds.length;
    document.documentElement.style.setProperty('--barbs',
      `url("data:image/svg+xml,${encodeURIComponent(barbSvg(from, sp / wx.winds.length, css('--accent')))}")`);
  }

  function buildWeather(w) {
    wx = w;
    cloudGroup.clear();
    let seed2 = 11; const r2 = () => (seed2 = (seed2 * 16807) % 2147483647) / 2147483647;
    w.stations.forEach(([lon, lat], i) => {
      const [x, z] = P(lon, lat);
      for (let c = 0; c < Math.round(w.clouds[i] / 34); c++) { // 0..3 clouds per station
        const cl = new THREE.Group();
        for (let j = 0; j < 5; j++) {
          const puff = new THREE.Mesh(puffGeo, cloudMat);
          puff.scale.set(0.5 + r2() * 0.4, 0.3 + r2() * 0.2, 0.45 + r2() * 0.3);
          puff.position.set((j - 2) * 0.45, r2() * 0.2, (r2() - 0.5) * 0.5);
          cl.add(puff);
        }
        cl.userData = { ox: x + (r2() - 0.5) * 2, oz: z + (r2() - 0.5) * 2, y: 4.3 + r2() * 1.2, phase: r2(), wind: w.winds[i] };
        cloudGroup.add(cl);
      }
    });
    setBarbPattern(); skyKey = '';
  }
  addEventListener('weather', e => buildWeather(e.detail));
  if (window.weather) buildWeather(window.weather);

  // --- time of day: follows the clock until the visitor moves the slider
  let hour = 12, touched = false;
  initClockUI((h, byUser) => { hour = h; touched = touched || byUser; });
  // Sky colour: night → dark, overcast → grey/white, sun → yellow, strong sun → orange (tokens per theme)
  // Sky: blue when clear, white when overcast, blended when partly cloudy; dark at night.
  // The sun adds a yellow → orange glow whose strength follows its intensity.
  function setSky(S, day) {
    const cover = wx ? wx.clouds.reduce((s, c) => s + c, 0) / wx.clouds.length / 100 : 0.3;
    const key = S.toFixed(2) + day.toFixed(2) + cover.toFixed(2);
    if (key === skyKey) return;
    skyKey = key;
    const c = n => new THREE.Color(css(n));
    const lit = c('--sky-clear').lerp(c('--sky-cloud'), cover);
    const top = c('--sky-night').lerp(lit, Math.min(1, day * 4)); // dusk/dawn transition
    const bottom = top.clone().lerp(c('--ground'), 0.5);
    const glow = c('--sun-weak').lerp(c('--sun-strong'), S);
    const root = document.documentElement.style;
    root.setProperty('--sky-top', '#' + top.getHexString());
    root.setProperty('--sky-bottom', '#' + bottom.getHexString());
    root.setProperty('--sun-glow', `rgba(${glow.toArray().map(v => Math.round(v * 255)).join(',')},${(S * 0.9).toFixed(2)})`);
  }

  // Wind barbs drift downwind in real time: the pattern layer slides, speed ∝ mean wind.
  const windLayer = document.getElementById('wind');
  let windFrom = 0, windKt = 0, wox = 0, woy = 0;
  function sunIntensity(day) {
    if (!wx) return day;
    if (wx.radiation != null && !touched) return Math.min(1, wx.radiation / 800);
    const cover = wx.clouds.reduce((s, c) => s + c, 0) / wx.clouds.length / 100;
    return day * (1 - 0.6 * cover);
  }

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w < 640 ? 52 : 38; // phones: wider lens so Belgium fits
    // wide screens: shift the map right, away from the text column on the left
    if (w > 900) camera.setViewOffset(w, h, -w * 0.12, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  addEventListener('resize', resize); resize();

  // --- Explore mode: orbit/zoom freely around the map, with shortcuts to each installation
  const controls = THREE.OrbitControls ? new THREE.OrbitControls(camera, renderer.domElement) : null;
  let exploring = false, fly = null;
  if (controls) {
    Object.assign(controls, { enabled: false, enableDamping: true, dampingFactor: 0.08, minDistance: 1.2, maxDistance: 70, maxPolarAngle: 1.4, screenSpacePanning: false });
    const SPOTS = {
      'Toute la Belgique': 'overview', 'Doel': 'nuclear', 'Coo': 'coo', 'Éolienne': 'wind', 'Éolien en mer': 'offshore',
      'Solaire': 'solar', 'Ligne 380 kV': 'pylons', 'Cabine de quartier': 'dist', 'Maison': 'house',
      "Port d'Anvers": 'port', 'Zeebrugge (gaz)': 'lng', 'Réseau de chaleur': 'heat', 'Bruxelles': 'city',
    };
    const bar = document.getElementById('exploreBar');
    bar.querySelector('.spots').innerHTML = Object.keys(SPOTS).map(n => `<button type="button">${n}</button>`).join('');
    bar.querySelector('.spots').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const sh = SHOTS[SPOTS[b.textContent]];
      fly = { look: sh.look.clone(), pos: shotPos(sh) };
    });
    function setExplore(on) {
      exploring = on; controls.enabled = on; fly = null;
      document.documentElement.classList.toggle('exploring', on);
      if (on) { controls.target.copy(camLook); camera.position.copy(camPos); controls.update(); }
      else { camPos.copy(camera.position); camLook.copy(controls.target); } // ease back into the story camera
    }
    document.getElementById('explore').addEventListener('click', () => setExplore(true));
    document.getElementById('exploreClose').addEventListener('click', () => setExplore(false));
    addEventListener('keydown', e => { if (e.key === 'Escape' && exploring) setExplore(false); });
  } else document.getElementById('explore').hidden = true;

  let wasNear = null;
  const clock = new THREE.Clock();
  const tmp = new THREE.Vector3();
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    const k = reduced ? 1 : 1 - Math.exp(-dt * 2.2);
    if (exploring) { // free navigation; a fly-to target eases the camera toward an installation
      if (fly) {
        controls.target.lerp(fly.look, k); camera.position.lerp(fly.pos, k);
        if (camera.position.distanceTo(fly.pos) < 0.05) fly = null;
      }
      controls.update();
    } else {
      const sh = scrollShot();
      if (active.dataset.cam === 'hero' && !reduced) sh.az += Math.sin(t * 0.08) * 0.35;
      shotPos(sh, tmp);
      const kk = reduced ? 1 : 1 - Math.exp(-dt * 5);
      camPos.lerp(tmp, kk); camLook.lerp(sh.look, kk);
      const par = 0.04 * sh.dist; // parallax proportional to the zoom level
      camera.position.set(camPos.x + mx * par, camPos.y - my * par * 0.6, camPos.z);
      camera.lookAt(camLook);
    }

    // daylight
    const a = (hour - 6) / 12 * Math.PI, day = Math.max(0, Math.sin(a));
    const speed = reduced ? 0 : 1;
    const S = sunIntensity(day); // 0 = nuit/ciel noir, 1 = plein soleil
    sun.position.set(Math.cos(a) * 30, Math.max(2, Math.sin(a) * 30), 12);
    sun.intensity = 0.15 + S * 0.5;
    hemi.intensity = 0.38 + S * 0.27;
    // (the page background is plain paper now: no sky tint)
    if (windLayer && speed) { // downwind on screen: north up, y down
      const th = windFrom * Math.PI / 180, v = windKt * 3; // px per second
      wox = (wox - Math.sin(th) * v * dt) % 160; woy = (woy + Math.cos(th) * v * dt) % 160;
      windLayer.style.transform = `translate(${wox.toFixed(1)}px, ${woy.toFixed(1)}px)`;
    }

    // clouds drift downwind, looping over ~2 units around their origin
    cloudGroup.children.forEach(c => {
      const { ox, oz, y, phase, wind: [from, kt] } = c.userData, th = from * Math.PI / 180;
      const u = ((phase + t * 0.004 * (2 + kt) * speed) % 1) - 0.5;
      c.position.set(ox - Math.sin(th) * u * 2, y, oz + Math.cos(th) * u * 2);
    });

    spinTurbines(reduced ? 0 : t, windFrom, wx ? windKt : 8);
    anim.forEach(f => f(reduced ? 0 : t, dt));
    // micro views: the map-scale turbines and solar tiles would look giant next to a detailed model, so hide them
    const near = camera.position.distanceTo(exploring ? controls.target : camLook) < 2.6;
    if (near !== wasNear) { // swap between map scale and model scale
      wasNear = near;
      [grp('wind'), grp('solar'), grp('city'), grp('gas'), grp('nuc'), grp('coo'), points, ...lines.map(l => l.mesh), ...labels.map(l => l.sprite), ...rings]
        .forEach(o => { o.visible = !near; });
    }
    steam.forEach(s => {
      const p = (s.userData.phase + t * 0.12 * speed) % 1;
      s.position.copy(s.userData.base); s.position.y += p * 1.4; s.position.x += p * 0.4;
      s.scale.setScalar(0.6 + p * 1.4); s.material.opacity = 0.4 * (1 - p);
    });

    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    rings.forEach(r => {
      const on = focus.has(r.userData.name);
      r.material.opacity += ((on ? 0.45 + pulse * 0.45 : 0) - r.material.opacity) * Math.min(1, dt * 6);
      r.scale.setScalar(on ? 1 + pulse * 0.08 : 1);
    });
    const any = focus.size > 0;
    lines.forEach(l => {
      const on = !any || focus.has(l.kind) || (l.kind === 'grid' && focus.has('inter'));
      const target = on ? 1 : 0.25;
      l.mesh.material.opacity += (target - l.mesh.material.opacity) * Math.min(1, dt * 4);
    });

    parts.forEach((p, i) => {
      const l = lines[p.li];
      let u = (p.o + t * speed * 1.2 / l.len) % 1;
      if (l.rev) u = 1 - u;
      l.curve.getPoint(u, tmp);
      pPos[i * 3] = tmp.x; pPos[i * 3 + 1] = tmp.y + 0.02; pPos[i * 3 + 2] = tmp.z;
    });
    pGeo.attributes.position.needsUpdate = true;

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

})();

function initClockUI(onChange) {
  const input = document.getElementById('heure'), txt = document.getElementById('heureTxt'), out = document.getElementById('statut');
  const notes = [
    [5,  'Nuit. La demande est au plus bas. Le nucléaire et l\'éolien tournent ; Coo en profite pour remonter l\'eau dans ses bassins.'],
    [8,  'Matin. Tout le pays se réveille, la demande grimpe vite. Les centrales au gaz et les importations prennent le relais.'],
    [16, 'Journée. Le soleil produit à plein. Aux heures les plus ensoleillées, le prix de gros peut même devenir négatif.'],
    [21, 'Pointe du soir. Le soleil s\'est couché, on cuisine, on recharge. C\'est le moment le plus tendu pour le réseau.'],
    [24, 'Soirée. La demande redescend. Les villes restent éclairées, le réseau se détend.'],
  ];
  const now = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour12: false, hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
  const get = t => +now.find(x => x.type === t).value;
  input.value = Math.round(((get('hour') % 24) + get('minute') / 60) * 4) / 4;
  function update(e) {
    const h = +input.value;
    txt.textContent = String(Math.floor(h) % 24).padStart(2, '0') + ':' + String(Math.round((h % 1) * 60)).padStart(2, '0');
    out.textContent = notes.find(([end]) => h < end || end === 24)[1];
    onChange(h, !!e);
  }
  input.addEventListener('input', update);
  update();
}

// Voltmeter: log scale 100 V .. 400 kV, follows the chapter nearest the viewport centre.
(() => {
  const meter = document.querySelector('.meter'), out = document.getElementById('volt'), what = document.getElementById('voltWhat');
  const sections = [...document.querySelectorAll('.chapter')];
  const pos = v => (Math.log10(v) - 2) / (Math.log10(4e5) - 2);
  const fmt = v => v >= 1000 ? (v / 1000).toLocaleString('fr-BE') + ' kV' : v + ' V';
  let current;
  function update() {
    const mid = innerHeight / 2;
    const s = sections.reduce((a, b) => {
      const d = el => { const r = el.getBoundingClientRect(); return Math.abs((r.top + r.bottom) / 2 - mid); };
      return d(b) < d(a) ? b : a;
    });
    if (s === current) return;
    current = s;
    meter.classList.toggle('off', !s.dataset.v); // the voltmeter only belongs to the electricity part
    // title block: plate number + title of the part this chapter belongs to
    let part = s.previousElementSibling;
    while (part && !part.classList.contains('part')) part = part.previousElementSibling;
    document.getElementById('cartTitle').textContent = part
      ? part.querySelector('.part-n').textContent.replace('Planche ', '') + ' · ' + part.querySelector('.part-t').textContent
      : 'Introduction';
    if (!s.dataset.v) return;
    const [lo, hi = lo] = s.dataset.v.split(',').map(Number);
    meter.style.setProperty('--lo', pos(lo));
    meter.style.setProperty('--hi', pos(hi));
    out.textContent = lo === hi ? fmt(lo) : fmt(lo) + '–' + fmt(hi);
    what.textContent = s.dataset.what;
  }
  addEventListener('scroll', update, { passive: true });
  update();
})();
