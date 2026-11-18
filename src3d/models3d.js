// Modelos de los packs (src3d/models/*.js, preparados desde assets/modelos): árboles, arbustos, autos,
// casas y el alfabeto 3D de los carteles de ciudad. Cada modelo se carga UNA vez: las copias en el
// mundo comparten geometría y material (árboles y casas, además, con InstancedMesh desde game3d.js).
// Si un archivo no está, el juego usa los modelos simples de world3d.js.
const Models3D = (() => {
  const parts = {};      // clave -> [{ geo, mat }] en metros, base en y = 0, centrado en x/z
  const sizes = {};      // clave -> THREE.Vector3 (tamaño)
  const glyphs = {};     // letra -> { parts: [{ geo, rim }], w, h }
  let ready = false;

  // Escala y giro de cada modelo para que quede a la medida del juego (frente de los autos hacia -Z).
  const FIT = {
    tree1: { s: 1.15 }, tree2: { s: 1.2 }, tree3: { s: 1.35 },
    pine1: { s: 1.1 }, pine2: { s: 1.0 }, pine3: { s: 1.15 },
    bush1: { s: 1.0 }, bush2: { s: 1.0 },
    house1: { s: 6.5 }, house2: { s: 6.5 }, house3: { s: 6 }, house4: { s: 6 }, house5: { s: 6 },
    sedan: { rot: Math.PI }, hatch: { rot: Math.PI }, suv: { rot: Math.PI }, sport: { rot: Math.PI }, sport2: { rot: Math.PI }, taxi: { rot: Math.PI }
  };
  // Colores de casa de balneario por modelo: [paredes, techo].
  const HOUSE_COLORS = {
    house1: [0xf2ede4, 0xb4532a], house2: [0xe9d8b4, 0x7d5236], house3: [0xfafafa, 0x5f6366],
    house4: [0xf3d9c8, 0xa04428], house5: [0xd9e6ee, 0x8a3b26]
  };

  // Atributos cuantizados (enteros) -> float, para poder hornear la transformación en la geometría.
  function toFloat(geo) {
    for (const name of Object.keys(geo.attributes)) {
      const a = geo.attributes[name];
      if (a.array instanceof Float32Array && !a.isInterleavedBufferAttribute) continue;
      const out = new Float32Array(a.count * a.itemSize);
      for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
      geo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
    }
    return geo;
  }

  function fixMaterial(m) {
    const leaves = m.map && /leaf|leaves|flower/i.test(m.name + ' ' + (m.map.name || ''));
    if (leaves || m.transparent) {
      m.transparent = false;
      m.alphaTest = 0.45;              // hojas recortadas (más barato y sin problemas de orden)
      m.side = THREE.DoubleSide;
    }
    if (m.metalness !== undefined) { m.metalness = 0; m.roughness = Math.max(m.roughness, 0.7); }
    return m;
  }

  // Hornea un nodo raíz (un modelo) a una lista de partes en el espacio del modelo, normalizado.
  function bake(node, fit) {
    node.updateMatrixWorld(true);
    const list = [];
    node.traverse((o) => {
      if (!o.isMesh) return;
      const geo = toFloat(o.geometry.clone());
      geo.applyMatrix4(o.matrixWorld);
      list.push({ geo, mat: fixMaterial(o.material), name: o.material.name || '' });
    });
    const box = new THREE.Box3();
    list.forEach((p) => { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); });
    const c = box.getCenter(new THREE.Vector3());
    const m = new THREE.Matrix4();
    if (fit && fit.rot) m.makeRotationY(fit.rot);
    m.multiply(new THREE.Matrix4().makeScale(fit ? fit.s || 1 : 1, fit ? fit.s || 1 : 1, fit ? fit.s || 1 : 1));
    m.multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
    const out = new THREE.Box3();
    list.forEach((p) => { p.geo.applyMatrix4(m); p.geo.computeBoundingBox(); p.geo.computeBoundingSphere(); out.union(p.geo.boundingBox); });
    return { list, size: out.getSize(new THREE.Vector3()) };
  }

  function parse(b64) {
    return new Promise((resolve) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      new THREE.GLTFLoader().parse(bytes.buffer, '', resolve, () => resolve(null));
    });
  }

  // El alfabeto viene en una grilla (A-I, J-R, S-Z y signos), visto desde atrás: se da vuelta y se
  // reconoce cada letra por su lugar.
  function buildGlyphs(root) {
    const holder = root.getObjectByName('alphabet') || root;
    holder.rotation.y += Math.PI;               // el frente de las letras queda hacia +Z
    holder.updateMatrixWorld(true);
    // Las dos piezas de cada letra (cuerpo y borde) tienen la misma caja: se agrupan por posición.
    const groups = new Map();
    holder.traverse((o) => {
      if (!o.isMesh) return;
      const box = new THREE.Box3().setFromObject(o);
      const key = [box.min.x, box.min.y, box.max.x, box.max.y].map((v) => v.toFixed(2)).join(',');
      if (!groups.has(key)) groups.set(key, { meshes: [], box, cx: (box.min.x + box.max.x) / 2, cy: (box.min.y + box.max.y) / 2, h: box.max.y - box.min.y });
      groups.get(key).meshes.push(o);
    });
    const uniq = [...groups.values()];
    uniq.sort((a, b) => b.cy - a.cy);
    const rows = [];
    uniq.forEach((n) => {
      const row = rows.find((r) => Math.abs(r[0].cy - n.cy) < 0.45);
      if (row) row.push(n); else rows.push([n]);
    });
    rows.sort((a, b) => b[0].cy - a[0].cy);
    const names = ['ABCDEFGHI', 'JKLMNOPQR', 'STUVWXYZ'];
    rows.slice(0, 3).forEach((row, i) => {
      const tall = Math.max(...row.map((n) => n.h));
      const letters = row.filter((n) => n.h > tall * 0.6).sort((a, b) => a.cx - b.cx);
      [...names[i]].forEach((ch, k) => {
        const n = letters[k];
        if (!n) return;
        const list = [];
        n.meshes.forEach((o) => {
          const geo = toFloat(o.geometry.clone());
          geo.applyMatrix4(o.matrixWorld);
          list.push({ geo, rim: (o.material.color && o.material.color.r > 0.5) });
        });
        const box = new THREE.Box3();
        list.forEach((p) => { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); });
        const t = new THREE.Matrix4().makeTranslation(-box.min.x, -box.min.y, -(box.min.z + box.max.z) / 2);
        list.forEach((p) => { p.geo.applyMatrix4(t); p.geo.computeVertexNormals(); p.geo.computeBoundingSphere(); });
        glyphs[ch] = { parts: list, w: box.max.x - box.min.x, h: box.max.y - box.min.y };
      });
    });
  }

  function load() {
    const src = window.MODELS3D || {};
    const jobs = Object.keys(src).map((cat) => parse(src[cat]).then((gltf) => {
      if (!gltf) return;
      if (cat === 'letters') { buildGlyphs(gltf.scene); return; }
      gltf.scene.children.forEach((node) => {
        if (!node.name) return;
        const b = bake(node, FIT[node.name]);
        if (HOUSE_COLORS[node.name]) {
          // Los materiales del pack son compartidos: cada casa lleva su copia con sus colores.
          const [wall, roof] = HOUSE_COLORS[node.name];
          b.list.forEach((p) => {
            if (/defaultMat/i.test(p.name)) { p.mat = p.mat.clone(); p.mat.color.set(wall); }
            else if (/roof/i.test(p.name)) { p.mat = p.mat.clone(); p.mat.color.set(roof); }
          });
        }
        parts[node.name] = b.list;
        sizes[node.name] = b.size;
      });
    }));
    return Promise.all(jobs).then(() => { makeBuildings(); ready = true; });
  }

  // ---------- Edificios y comercios de las ciudades (hechos por código) ----------
  // Cada edificio es UNA geometría con UN material (colores por vértice + textura de ventanas), así
  // que con InstancedMesh cada modelo es un solo dibujo, liviano para celulares de gama media.
  // El frente mira a +Z (game3d.js lo gira hacia la ruta). Las fachadas repiten una ventana por cada
  // "módulo" de BAY × FLOOR metros; las piezas lisas (marquesinas, carteles, balcones) leen la
  // esquina de la textura, que es pared blanca.
  const BAY = 3, FLOOR = 3;
  // La textura tiene 4 × 4 ventanas (256 px, potencia de 2: repite bien también en WebGL 1).
  // De noche, `lit` marca qué ventanas tienen la luz prendida (mapa de emisión, cálido y variado).
  const CELLS = 4;
  let facadeTex = null, litTex = null, buildingMat = null;
  function windowTexture(lit) {
    const c = document.createElement('canvas');
    c.width = c.height = 64 * CELLS;
    const g = c.getContext('2d');
    g.fillStyle = lit ? '#000000' : '#ffffff';
    g.fillRect(0, 0, c.width, c.height);
    let seed = 3;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < CELLS; i++) for (let j = 0; j < CELLS; j++) {
      const x = i * 64, y = j * 64;
      if (lit) {
        const r = rnd();
        if (r < 0.45) continue;                       // apagada
        g.fillStyle = r < 0.6 ? '#9fb7ff' : r < 0.8 ? '#ffd27a' : '#ffb85c';   // tele (azulada) o lámpara
        g.fillRect(x + 18, y + 18, 28, 32);
        g.fillStyle = 'rgba(0,0,0,0.5)';
        g.fillRect(x + 31, y + 18, 2, 32);
        continue;
      }
      g.fillStyle = '#d9d4cc'; g.fillRect(x + 14, y + 50, 36, 4); // alféizar
      g.fillStyle = '#2b3946'; g.fillRect(x + 18, y + 18, 28, 32); // vidrio
      g.fillStyle = '#5d7488'; g.fillRect(x + 18, y + 18, 28, 9);  // reflejo del cielo
      g.fillStyle = '#e8e4dc'; g.fillRect(x + 31, y + 18, 2, 32);  // parante
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 2;
    return t;
  }

  // Arma la geometría de a pedazos: cajas lisas (con color) y fachadas con ventanas.
  function geoBuilder() {
    const pos = [], nrm = [], uv = [], col = [];
    const tmp = new THREE.Color();
    const quad = (p0, p1, p2, p3, n, uvs, color) => {
      tmp.set(color);
      [[p0, uvs[0]], [p1, uvs[1]], [p2, uvs[2]], [p0, uvs[0]], [p2, uvs[2]], [p3, uvs[3]]].forEach(([p, t]) => {
        pos.push(p[0], p[1], p[2]); nrm.push(n[0], n[1], n[2]); uv.push(t[0], t[1]); col.push(tmp.r, tmp.g, tmp.b);
      });
    };
    const FLAT = [[0.03, 0.03], [0.03, 0.03], [0.03, 0.03], [0.03, 0.03]];
    // Caja lisa con centro en x/z y base en y. noBottom: sin la cara de abajo (no se ve nunca).
    function box(w, h, d, x, y, z, color) {
      const a = x - w / 2, b = x + w / 2, y0 = y, y1 = y + h, f = z + d / 2, k = z - d / 2;
      quad([a, y0, f], [b, y0, f], [b, y1, f], [a, y1, f], [0, 0, 1], FLAT, color);
      quad([b, y0, k], [a, y0, k], [a, y1, k], [b, y1, k], [0, 0, -1], FLAT, color);
      quad([b, y0, f], [b, y0, k], [b, y1, k], [b, y1, f], [1, 0, 0], FLAT, color);
      quad([a, y0, k], [a, y0, f], [a, y1, f], [a, y1, k], [-1, 0, 0], FLAT, color);
      quad([a, y1, f], [b, y1, f], [b, y1, k], [a, y1, k], [0, 1, 0], FLAT, color);
    }
    // Paredes con ventanas (4 lados), de y a y + floors pisos. sides: qué lados llevan ventanas.
    function facade(w, d, x, y, z, floors, color, sides = { f: 1, b: 1, l: 1, r: 1 }) {
      const a = x - w / 2, b = x + w / 2, y0 = y, y1 = y + floors * FLOOR, f = z + d / 2, k = z - d / 2;
      const uw = (len, on) => (on ? Math.max(1, Math.round(len / BAY)) / CELLS : 0.03);
      const vv = on => (on ? floors / CELLS : 0.03);
      const U = (len, on) => { const u = uw(len, on), v = vv(on); return on ? [[0, 0], [u, 0], [u, v], [0, v]] : FLAT; };
      quad([a, y0, f], [b, y0, f], [b, y1, f], [a, y1, f], [0, 0, 1], U(w, sides.f), color);
      quad([b, y0, k], [a, y0, k], [a, y1, k], [b, y1, k], [0, 0, -1], U(w, sides.b), color);
      quad([b, y0, f], [b, y0, k], [b, y1, k], [b, y1, f], [1, 0, 0], U(d, sides.r), color);
      quad([a, y0, k], [a, y0, f], [a, y1, f], [a, y1, k], [-1, 0, 0], U(d, sides.l), color);
    }
    function build() {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      return geo;
    }
    return { box, facade, build };
  }

  // Planta baja de comercio: pared, vidriera, puerta, marquesina y cartel con el color del local.
  function shopFront(B, w, d, wall, brand, awning, h = 3.4) {
    B.box(w, h, d, 0, 0, 0, wall);
    B.box(w * 0.62, 2.3, 0.08, -w * 0.12, 0.35, d / 2 + 0.04, 0x2b3946);     // vidriera
    B.box(1.1, 2.3, 0.08, w * 0.34, 0, d / 2 + 0.04, 0x4a3324);              // puerta
    B.box(w + 0.2, 0.12, 1.5, 0, 2.75, d / 2 + 0.75, awning);                // marquesina
    B.box(w + 0.2, 0.35, 0.08, 0, 2.5, d / 2 + 1.5, awning);                 // faldón
    B.box(w * 0.8, 0.55, 0.1, 0, 2.95, d / 2 + 0.05, brand);                 // cartel
  }

  function makeBuildings() {
    facadeTex = facadeTex || windowTexture(false);
    litTex = litTex || windowTexture(true);
    const mat = new THREE.MeshStandardMaterial({
      map: facadeTex, vertexColors: true, roughness: 0.9, metalness: 0,
      emissive: 0xffffff, emissiveMap: litTex, emissiveIntensity: 1.4      // ventanas con luz (de noche)
    });
    buildingMat = mat;
    const add = (key, fn) => {
      const B = geoBuilder();
      fn(B);
      const geo = B.build();
      parts[key] = [{ geo, mat, name: key }];
      sizes[key] = geo.boundingBox.getSize(new THREE.Vector3());
    };
    // Almacenes y comercios de una planta, techo plano con pretil.
    [['shopA', 0xf2c27b, 0xc62828, 0x2e7d32], ['shopB', 0x9ccbe0, 0x1565c0, 0xf9a825],
     ['shopC', 0xe8a48a, 0x6a1b9a, 0xd84315], ['shopD', 0xffffff, 0x00897b, 0x37474f]].forEach(([key, wall, brand, awning], i) => {
      add(key, (B) => {
        const w = 8 + i, d = 10;
        shopFront(B, w, d, wall, brand, awning);
        B.box(w, 0.6, d, 0, 3.4, 0, wall);                                      // pretil
        B.box(w - 0.6, 0.05, d - 0.6, 0, 3.42, 0, 0x8d8d8d);                    // azotea
      });
    });
    // Dos plantas: comercio abajo y vivienda arriba con balcón.
    [['bldg2a', 0xe6b98f, 0xd32f2f, 0x455a64], ['bldg2b', 0xbfd8b8, 0x283593, 0xef6c00]].forEach(([key, wall, brand, awning]) => {
      add(key, (B) => {
        const w = 9, d = 11;
        shopFront(B, w, d, wall, brand, awning);
        B.facade(w, d, 0, 3.4, 0, 1, wall);
        B.box(w * 0.6, 0.15, 1.1, 0, 3.4, d / 2 + 0.55, 0xcfcfcf);              // balcón
        B.box(w * 0.6, 0.9, 0.06, 0, 3.55, d / 2 + 1.07, 0x37474f);             // baranda
        B.box(w, 0.7, d, 0, 6.4, 0, wall);                                      // pretil
      });
    });
    // Edificios de apartamentos de 3 y 5 pisos (frentes de las avenidas y centros).
    [['bldg3', 3, 0xe8e0d0, 12, 12], ['bldg5', 5, 0xd6dde3, 13, 14], ['bldg4', 4, 0xd99a7a, 11, 12]].forEach(([key, floors, wall, w, d]) => {
      add(key, (B) => {
        B.facade(w, d, 0, 0, 0, floors, wall);
        B.box(2.2, 2.6, 0.1, 0, 0, d / 2 + 0.05, 0x3e2f24);                     // entrada
        for (let f = 1; f < floors; f++) {
          B.box(w - 1, 0.15, 1.2, 0, f * FLOOR, d / 2 + 0.6, 0xe0e0e0);         // balcón corrido
          B.box(w - 1, 0.95, 0.06, 0, f * FLOOR + 0.15, d / 2 + 1.17, 0x90a4ae); // baranda de vidrio
        }
        B.box(w, 0.5, d, 0, floors * FLOOR, 0, wall);                           // pretil
        B.box(3, 1.6, 2.2, w * 0.2, floors * FLOOR + 0.5, -d * 0.15, 0xbdbdbd); // sala de máquinas / tanque
      });
    });
  }

  const has = (key) => ready && !!parts[key];

  // Copia de un modelo como grupo de mallas (comparten geometría y material).
  function instance(key) {
    const g = new THREE.Group();
    parts[key].forEach((p) => { const m = new THREE.Mesh(p.geo, p.mat); m.castShadow = true; g.add(m); });
    return g;
  }

  // ---------- Autos ----------
  const CAR_KEYS = ['sedan', 'sedan', 'hatch', 'suv', 'suv', 'sport', 'sport2', 'taxi'];
  const PAINTABLE = /^(blue|lightblue|white|orange|yellow|red|green|black)$/i;
  const paintCache = {};
  function car(color) {
    const keys = CAR_KEYS.filter(has);
    if (!keys.length) return null;
    const key = keys[Math.floor(Math.random() * keys.length)];
    const g = new THREE.Group();
    let painted = false;
    parts[key].forEach((p) => {
      let mat = p.mat;
      // La primera pintura de la carrocería toma el color pedido (el taxi queda amarillo).
      if (key !== 'taxi' && !painted && PAINTABLE.test(p.name)) {
        const ck = p.mat.uuid + color;
        mat = paintCache[ck] || (paintCache[ck] = Object.assign(p.mat.clone(), {}));
        mat.color.set(color);
        mat.metalness = 0.4;
        mat.roughness = 0.35;
        painted = true;
      }
      const m = new THREE.Mesh(p.geo, mat);
      m.castShadow = true;
      g.add(m);
    });
    const s = sizes[key];
    g.userData = { hw: s.x / 2, hl: s.z / 2, model: key };
    return g;
  }

  // ---------- Carteles de ciudad con letras 3D ----------
  const PALETTE = [0xe53935, 0xfb8c00, 0xfdd835, 0x43a047, 0x1e88e5, 0x8e24aa];
  const bodyMats = PALETTE.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.05 }));
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
  const hasLetters = () => ready && !!glyphs.A;

  function letters(text, height = 2.6) {
    const clean = text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
    const ref = glyphs.H ? glyphs.H.h : 1;
    const k = height / ref;
    const g = new THREE.Group();
    let x = 0, n = 0;
    for (const ch of clean) {
      const gl = glyphs[ch];
      if (!gl) { x += height * 0.5; continue; }
      const body = bodyMats[n++ % bodyMats.length];
      gl.parts.forEach((p) => {
        const m = new THREE.Mesh(p.geo, p.rim ? rimMat : body);
        m.scale.setScalar(k);
        m.position.x = x;
        m.castShadow = true;
        g.add(m);
      });
      x += gl.w * k + height * 0.12;
    }
    const w = x - height * 0.12;
    g.children.forEach((m) => { m.position.x -= w / 2; });     // centrado
    g.userData.width = w;
    return g;
  }

  // Ventanas encendidas según la hora (0 de día, 1 de noche).
  const setNight = (k) => { if (buildingMat) buildingMat.emissiveIntensity = 1.4 * k; };

  return { load, has, setNight, parts: (k) => parts[k], size: (k) => sizes[k], instance, car, letters, hasLetters, get ready() { return ready; } };
})();
