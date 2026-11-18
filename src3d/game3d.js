// BUSGAME: misma jugabilidad que la versión 2D, con cámara detrás del ómnibus.
// Unidades en metros. El ómnibus queda en z = 0 y el mundo se mueve hacia +Z.
(() => {
  const { LANE_X } = World3D;
  const LANE_SPEED = [24, 16];          // tránsito por carril (m/s): izquierdo rápido, derecho lento
  const LANES = LANE_X.map((_, i) => i);
  const RIGHT = LANE_X.length - 1;      // carril derecho (paradas)
  const M_PER_KM = 40;                  // ritmo del juego (huecos, avisos): un "km" de juego son 40 m
  const SEG_M = 5200;                   // cada pedazo del viaje (Interbalnearia, Ruta 9 hasta Rocha, Rocha-Chuy)
  // Física de ómnibus: pesado, acelera despacio, frena con distancia y dobla con inercia.
  const MAX_SPEED = 40;
  const ACCEL = 6.5;                    // 0 a 90 km/h en ~6 s
  const BRAKE = 22;                     // de 90 a 0 en ~1,8 s (unos 36 m)
  const LAT_MAX = 3.0;                  // velocidad lateral máxima (m/s): un cambio de carril tarda ~1,5 s
  const LAT_ACC = 4.5;                  // qué tan rápido gira el volante (m/s²)
  const STOP_SPEED = 9;                 // 20 km/h mostrados
  const STOP_OVER = 40;                 // m: hasta dónde se puede frenar pasado de la parada (con queja)
  const KMH = 90 / MAX_SPEED;
  const TARGET_TIME = 540;              // el viaje completo dura unos 9 minutos
  // Plata y gasoil: los pasajes y las encomiendas dan plata; el gasoil se gasta andando y se carga
  // (pagando) en las estaciones de servicio. Sin gasoil, el viaje se termina.
  // Tarifas oficiales de COT a Chuy (cartel de la agencia Chuy, 18/11/2026; incluyen $10 de tasa de
  // embarque). El viaje va hacia Chuy, así que cada pasajero paga el pasaje desde su parada hasta Chuy.
  // Entre dos lugares de la lista, el precio se interpola por km (paradas "km 120", etc.).
  const TARIFAS = [
    { km: 0, name: 'Montevideo', precio: 1147 },
    { km: 94.5, name: 'Pan de Azúcar', precio: 812 },
    { km: 135.5, name: 'San Carlos', precio: 679 },
    { km: 203.8, name: 'Rocha', precio: 478 },
    { km: 260.3, name: 'Castillos', precio: 244 },
    { km: 298, name: 'Punta del Diablo', precio: 177 },
    { km: 304, name: 'Fortaleza', precio: 110 },
    { km: 314, name: 'La Coronilla', precio: 110 }
  ];
  function pasaje(km) {
    const T = TARIFAS;
    if (km <= T[0].km) return T[0].precio;
    for (let i = 1; i < T.length; i++) {
      if (km <= T[i].km) {
        const a = T[i - 1], b = T[i];
        return Math.round(a.precio + (b.precio - a.precio) * (km - a.km) / (b.km - a.km));
      }
    }
    return T[T.length - 1].precio;
  }
  const ENCOMIENDA = 220;               // $ por encomienda (precio fijo)
  const START_MONEY = 1500;            // caja al salir de Tres Cruces
  const START_FUEL = 70;                // % del tanque al salir de Tres Cruces
  const FUEL_PER_M = 100 / 5200;        // un tanque lleno alcanza para un tercio del viaje (~5 estaciones)
  const FUEL_IDLE = 0.05;               // % por segundo con el motor en marcha (aunque esté parado)
  const FUEL_PRICE = 60;                // $ por cada % del tanque (también en el cartel de la estación). Provisorio:
                                        // con las tarifas reales un viaje junta ~$ 44.000 y gasta ~300 % de tanque
  const FUEL_RATE = 22;                 // % por segundo que carga la bomba
  // Arreglos: cada choque cuesta plata según contra qué fue (si no alcanza, se lleva lo que haya).
  const REPAIR = { car: 2500, truck: 4000, moto: 1500, isleta: 3000 };   // provisorio
  const SPAWN_AHEAD = 280;
  // Ruta 9 (un carril por mano): los que van en nuestro sentido van más lento y los de frente
  // aparecen más lejos, porque se acercan rápido.
  const R9_SPEED = { truck: 12, car: 16, moto: 17 };
  const ONCOMING_AHEAD = 340;

  // ---------- Viaje completo Tres Cruces → Chuy (ROUTE_FULL en route3d.js) ----------
  // Cada segmento (Interbalnearia, Ruta 9 hasta Rocha, Rocha → Chuy) se estira a SEG_M metros de juego:
  // los km de los carteles son los oficiales de la ruta (saltan de 97 a 107 en Pan de Azúcar).
  const R = ROUTE_FULL;
  const SEGS = R.segments.map((g, i) => ({ ...g, p0: i * SEG_M, p1: (i + 1) * SEG_M, mPerKm: SEG_M / (g.to - g.from) }));
  const TRIP_M = SEG_M * SEGS.length;
  const segAtPos = (pos) => SEGS[Math.max(0, Math.min(SEGS.length - 1, Math.floor(pos / SEG_M)))];
  const segAtKm = (km) => SEGS.find((g) => km < g.to) || SEGS[SEGS.length - 1];
  const kmAt = (pos) => { const g = segAtPos(pos); return g.from + (pos - g.p0) / g.mPerKm; };
  const posAt = (km) => { const g = segAtKm(km); return g.p0 + Math.max(0, km - g.from) * g.mPerKm; };
  const profileAt = (pos) => segAtPos(pos).profile;
  const roadAt = (pos) => World3D.ROAD_PROFILES[profileAt(pos)];
  // Ruta 9 (un carril por mano) en esa posición; sin argumento, donde está el ómnibus.
  const twoWay = (pos) => profileAt(pos === undefined ? (S ? S.dist : 0) : pos) === 'r9';
  // Carriles por los que puede ir el ómnibus: los nuestros y también los de contramano
  // (Interbalnearia: los dos del otro lado de la doble amarilla; Ruta 9: el izquierdo, que ya es de LANE_X).
  // Estaciones de servicio (landmarks 'estacion'): posición de juego del centro de cada una.
  const STATION = World3D.STATION;
  const STATIONS = R.landmarks.filter((l) => l.type === 'estacion').map((l) => posAt(l.km));
  const stationNear = (pos, margin = STATION.END) => STATIONS.find((c) => Math.abs(pos - c) < margin);
  // El carril del desvío se puede usar mientras tiene ancho para el ómnibus.
  const stationOpen = (pos) => STATIONS.some((c) => World3D.stationOuter(c - pos) > STATION.laneX + 1.4);
  const busLanes = (pos) => {
    const at = pos === undefined ? S.dist : pos;
    const p = World3D.ROAD_PROFILES[profileAt(at)];
    const lanes = p.id === 'ib' ? [...p.ONCOMING_LANES].sort((a, b) => a - b).concat(LANE_X) : LANE_X;
    return stationOpen(at) ? lanes.concat(STATION.laneX) : lanes;
  };
  // ¿El ómnibus va de contramano? (pasó la línea amarilla del centro)
  const contramano = () => S.busX < World3D.ROAD_PROFILES[profileAt(S.dist)].CENTER_X + 0.6;
  // Donde termina la Interbalnearia y empieza Ruta 9 (cambio de perfil de la calzada).
  const PROFILE_CHANGES = SEGS.filter((g, i) => i > 0 && SEGS[i - 1].profile !== g.profile)
    .map((g) => ({ pos: g.p0, behind: SEGS[SEGS.indexOf(g) - 1].profile, ahead: g.profile }));
  const kmText = (km) => String(Math.round(km * 10) / 10).replace('.', ',');

  const $ = (id) => document.getElementById(id);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ---------- Render ----------
  // Calidad por pasos (idea tomada de halloween.dev): si el juego no llega a GFX_TARGET fps, se
  // aplica el siguiente paso, se espera, se vuelve a medir, y así. Se saca primero lo que menos se nota.
  // El paso que funcionó se recuerda en esa PC, así la próxima vez arranca directo ahí.
  const GFX_LEVELS = [
    { name: 'máxima', pr: 1.5, shadow: 2048, normals: true },
    { name: 'resolución 1×', pr: 1, shadow: 2048, normals: true },
    { name: 'sombras 1024', pr: 1, shadow: 1024, normals: true },
    { name: 'resolución 0,85×', pr: 0.85, shadow: 1024, normals: true },
    { name: 'sin sombras reales', pr: 0.85, shadow: 0, normals: true },
    { name: 'sin relieve', pr: 0.85, shadow: 0, normals: false },
    { name: 'distancia corta', pr: 0.75, shadow: 0, normals: false, short: true },
    { name: 'mínima', pr: 0.6, shadow: 0, normals: false, short: true, lambert: true },
    // Para PCs que dibujan sin placa de video (WebGL 1 o por software, p. ej. Windows 7 viejos):
    // menos píxeles, un cuarto de los árboles y casas, sin bosque extra y niebla más cerca.
    { name: 'muy baja', pr: 0.45, shadow: 0, normals: false, short: true, lambert: true, tiny: true },
    { name: 'ultra baja', pr: 0.33, shadow: 0, normals: false, short: true, lambert: true, tiny: true, noEnv: true }
  ];
  const GFX_PRESETS = { high: 0, medium: 4, low: 7, min: 9 };
  const GFX_TARGET = 50;
  const GFX_KEY = 'cot-ruta-3d-gfx';
  // ?q=high|medium|low fuerza un nivel fijo; ?q=reset olvida lo aprendido en esta PC.
  const qParam = (location.search.match(/[?&]q=(low|medium|high|min|reset)/) || [])[1] || (/[?&]low\b/.test(location.search) ? 'low' : null);
  const weak = window.matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 4) <= 4;
  const deviceSig = `${screen.width}x${screen.height}@${window.devicePixelRatio || 1}|${navigator.hardwareConcurrency || 0}`;
  let savedLevel = null;
  try {
    if (qParam === 'reset') localStorage.removeItem(GFX_KEY);
    const saved = JSON.parse(localStorage.getItem(GFX_KEY) || 'null');
    if (saved && saved.sig === deviceSig) savedLevel = saved.level;
  } catch (e) { /* sin almacenamiento: se mide cada vez */ }
  // PC sin WebGL 2 o que dibuja por software: arranca en "muy baja" (después baja más si hace falta).
  const slowGpu = (() => {
    try {
      const c = document.createElement('canvas');
      if (!c.getContext('webgl2')) return true;
      const gl = c.getContext('webgl2');
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
      return /swiftshader|llvmpipe|software|basic render|gdi generic/i.test(name);
    } catch (e) { return false; }
  })();
  const gfx = {
    level: qParam && GFX_PRESETS[qParam] !== undefined ? GFX_PRESETS[qParam]
      : slowGpu ? Math.max(savedLevel ?? 0, GFX_PRESETS.min - 1)
      : savedLevel ?? (weak ? GFX_PRESETS.medium : GFX_PRESETS.high),
    auto: !(qParam && GFX_PRESETS[qParam] !== undefined),
    lock: 0                             // mejor nivel permitido en esta sesión
  };
  let pixelRatio = Math.min(window.devicePixelRatio || 1, GFX_LEVELS[gfx.level].pr);
  const renderer = new THREE.WebGLRenderer({ antialias: !GFX_LEVELS[gfx.level].short, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.localClippingEnabled = true;     // corte de la calzada en el cambio de perfil (Pan de Azúcar)
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('view').appendChild(renderer.domElement);

  // El viaje sale de tarde y llega de noche (updateDayNight): el cielo es una esfera que mezcla la foto
  // del cielo de día, teñida de atardecer, con el cielo de noche (ambiente3d.js). La luz direccional es
  // el sol bajo (atrás: se viaja hacia el este) y después la luna. Los reflejos usan el cielo de día o el
  // de noche. Faros, faroles y ventanas se prenden con el atardecer (manchas aditivas, sin luces reales).
  const scene = new THREE.Scene();
  const FOG_DAY = new THREE.Color(0xc9d8e6), FOG_SUNSET = new THREE.Color(0xd9a27e), FOG_NIGHT = new THREE.Color(0x0c1322);
  scene.fog = new THREE.Fog(FOG_DAY.getHex(), 90, 330);
  const fogBase = { near: 90, far: 330 };    // los pone applyGfx; la lluvia y la niebla los achican
  const envs = { day: null, night: null };   // reflejos del cielo (en "ultra baja" no se usan)
  const nightTex = Ambiente.nightSky();
  {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envs.night = pmrem.fromEquirectangular(nightTex).texture;
    pmrem.dispose();
  }
  const dayTex = new THREE.TextureLoader().load(TEX3D.sky, (t) => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    envs.day = pmrem.fromEquirectangular(t).texture;
    pmrem.dispose();
  });
  dayTex.mapping = THREE.EquirectangularReflectionMapping;
  dayTex.colorSpace = THREE.SRGBColorSpace;
  const sky = Ambiente.makeSky(dayTex, nightTex);
  scene.add(sky);
  const hemi = new THREE.HemisphereLight(0xdfeeff, 0x5a7a3c, 0.6);
  scene.add(hemi);
  // Sol de la tarde: bajo y atrás del ómnibus (al oeste), un poco a la derecha. De noche, la luna (MOON_DIR).
  const SUN_DIR = new THREE.Vector3();
  const SUN_AZ = new THREE.Vector3(0.32, 0, 0.95).normalize();
  const _sunDir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _look = new THREE.Vector3();
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 40, bottom: -40, near: 1, far: 180 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.5, 1200);
  let portrait = false;
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    portrait = w / h < 0.9;
    camera.fov = portrait ? 74 : 58;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const road = World3D.createRoad(scene);
  let bus = null;

  // ---------- Estado ----------
  let mode = 'loading';  // loading | title | play | ending | result
  let paused = false;
  let S = null;          // estado del viaje
  const world = [];      // objetos anclados a una distancia de la ruta
  const decos = [];
  const rows = [];
  const backdrops = [];

  function newRun(attract) {
    return {
      attract, dist: 0, speed: attract ? 22 : 0, elapsed: 0, score: 0, passengers: 0, boxes: 0, crashes: 0,
      latV: 0, roll: 0, pitch: 0, camX: LANE_X[RIGHT] * 0.75, prevSpeed: attract ? 22 : 0,
      money: START_MONEY, repairs: 0, fuel: START_FUEL, fuelPaid: 0, fueling: false, noMoney: 0, fuelWarn: 0,
      weather: { rain: 0, fog: 0, event: null, nextAt: attract ? 1e9 : rand(45, 70), fireAt: rand(1200, 2000), flash: 0 },
      confort: 100, invuln: 0, stunned: 0, lane: RIGHT, targetX: LANE_X[RIGHT], busX: LANE_X[RIGHT], shake: 0,
      cars: [], pickups: [],
      stops: R.stops.map((st) => {
        const km = typeof st === 'number' ? st : st.km;
        const name = typeof st === 'number' ? `Parada km ${kmText(km)}` : `Parada ${st.name}`;
        return { km, name, fare: pasaje(km), pos: posAt(km), spawned: false, done: false, missed: false };
      }),
      nextCarAt: attract ? 40 : 60, nextOncomingAt: 30, nextPickupAt: 150, nextKmSign: Math.floor(R.from / 10) * 10 + 10,
      terminal: false, autoTimer: 2,
      waters: R.landmarks.filter((l) => l.type === 'water').map((w) => ({ ...w, spawned: false })),
      marks: routeMarks()
    };
  }

  // Con sombras reales no hacen falta las sombras falsas (manchas bajo los vehículos).
  function syncBlobs(obj) {
    const shadows = GFX_LEVELS[gfx.level].shadow > 0;
    obj.traverse((o) => { if (o.userData.isBlob) o.visible = !shadows; });
  }

  const HEMI_NIGHT = 2.1;                  // de noche hace falta más luz de cielo para ver la ruta
  let hemiBase = 0.6, hemiLevel = 0.6, hemiNight = HEMI_NIGHT, noEnv = false;
  function applyGfx(level) {
    gfx.level = level;
    const L = GFX_LEVELS[level];
    pixelRatio = Math.min(window.devicePixelRatio || 1, L.pr);
    renderer.setPixelRatio(pixelRatio);
    const shadows = L.shadow > 0;
    if (shadows && sun.shadow.mapSize.x !== L.shadow) {
      sun.shadow.mapSize.set(L.shadow, L.shadow);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    }
    const shadowsChanged = renderer.shadowMap.enabled !== shadows;
    renderer.shadowMap.enabled = shadows;
    sun.castShadow = shadows;
    hemiLevel = L.noEnv ? 2.6 : L.lambert ? 1.8 : 0.6;
    hemiNight = L.lambert ? HEMI_NIGHT * 0.65 : HEMI_NIGHT;
    noEnv = !!L.noEnv;
    road.setQuality(L.lambert ? 'low' : L.normals ? 'high' : 'medium');
    // Distancia de dibujo: más niebla, menos lejos y la mitad de los árboles.
    fogBase.near = scene.fog.near = L.tiny ? 35 : L.short ? 60 : 90;
    fogBase.far = scene.fog.far = L.tiny ? 150 : L.short ? 210 : 330;
    camera.far = L.short ? 700 : 1200;    // lejos solo se ven los cerros (sin niebla); el resto lo tapa la niebla
    decos.forEach((d, k) => { d.visible = d.userData.biomeOK !== false && decoShown(d, k); });
    if (shadowsChanged) {
      scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => { m.needsUpdate = true; }); });
    }
    syncBlobs(scene);
    resize();
  }

  // Cuántos árboles y casas se dibujan según la calidad: todos, la mitad o un cuarto (sin bosque extra).
  function decoShown(d, k = d.userData.idx) {
    const L = GFX_LEVELS[gfx.level];
    if (L.tiny) return !d.userData.forest && k % 4 === 0;
    return !L.short || k % 2 === 0;
  }

  function saveGfx() {
    try { localStorage.setItem(GFX_KEY, JSON.stringify({ sig: deviceSig, level: gfx.level })); } catch (e) { /* no se recuerda */ }
  }

  // Con la ruta curvada (bend3d.js) la posición sin deformar no sirve para descartar lo que no se
  // ve: un objeto "fuera de cuadro" puede quedar a la vista en una curva. Lo lejano lo tapa la niebla.
  const noCull = (obj) => { obj.traverse((o) => { o.frustumCulled = false; }); return obj; };

  function addWorld(obj, pos, extra = {}) {
    obj.userData.pos = pos;
    Object.assign(obj.userData, extra);
    syncBlobs(obj);
    noCull(obj);
    obj.position.z = -(pos - S.dist);
    scene.add(obj);
    world.push(obj);
    return obj;
  }

  function disposeTextures(obj) {
    obj.traverse((o) => {
      if (o.userData.ownTex && o.material && o.material.map) o.material.map.dispose();
    });
  }

  function removeWorld(obj) {
    const i = world.indexOf(obj);
    if (i >= 0) world.splice(i, 1);
    scene.remove(obj);
    obj.userData.dead = true;
  }

  function clearWorld() {
    while (world.length) removeWorld(world[0]);
  }

  // ---------- Decoración reciclada ----------
  // Zona del tramo (route3d.js) para un km dado.
  const biomeAt = (km) => R.biomes.find((b) => km >= b.from && km < b.to) || R.biomes[R.biomes.length - 1];
  // ¿Hay mar o laguna de ese lado (1 = derecha, -1 = izquierda) en ese km?
  const waterAt = (km, side) => R.landmarks.some((l) => l.type === 'water' && l.side === side && km >= l.from - 3 && km <= l.to);

  // Árboles, casas, vacas, etc. del otro lado del alambrado. A la derecha desde x = 13; a la
  // izquierda desde 4,8 m después del borde de la calzada (cambia con el perfil). Cada objeto del
  // grupo se muestra o no según cuánto pesa su tipo en la zona donde cae.
  function placeDeco(d, pos) {
    const t = d.userData.type;
    const km = kmAt(pos);
    const near = t === 'pond' ? 10 : 0;      // los charcos son anchos: más lejos del alambrado
    const left = roadAt(pos).ROAD.l;
    const ranges = {
      1: [13 + near, waterAt(km, 1) ? World3D.WATER_NEAR - 4 : 36 + near],
      [-1]: [-(left - 4.8 - near), waterAt(km, -1) ? World3D.WATER_NEAR - 4 : 45 + near]
    };
    const bio = biomeAt(km);
    const woody = t === 'tree' || t === 'eucalyptus' || t === 'pine' || t === 'umbrellaPine';
    if (bio.monte && woody) {
      // Monte: los árboles arrancan justo detrás del alambrado y no se van lejos.
      ranges[1] = [ranges[1][0] - 0.5, Math.min(ranges[1][1], ranges[1][0] + 16)];
      ranges[-1] = [ranges[-1][0] - 0.5, Math.min(ranges[-1][1], ranges[-1][0] + 16)];
    }
    let side = Math.random() < 0.5 ? 1 : -1;
    if (ranges[side][1] < ranges[side][0]) side = -side;
    // La estación de servicio ocupa el costado derecho: ahí no va decoración.
    if (side === 1 && stationNear(pos, STATION.END + 10)) {
      if (ranges[-1][1] >= ranges[-1][0]) side = -1;
      else { d.userData.pos = pos; d.userData.biomeOK = false; d.visible = false; return; }
    }
    if (d.userData.forest) {
      // Bosque extra: solo fuera de las ciudades, tupido cerca del alambrado y raleando hacia el fondo.
      const dens = bio.lights ? 0 : bio.forest ?? 1;
      const kind = d.userData.model.startsWith('pine') ? (bio.weights.pine || bio.weights.umbrellaPine ? 1 : 0.7) : 1;
      const [a, b] = [ranges[side][0] - 0.5, Math.max(ranges[side][0], Math.min(ranges[side][1], 60))];
      d.userData.pos = pos;
      d.position.x = side * (a + (b - a) * Math.pow(Math.random(), 1.6));
      d.rotation.y = rand(0, Math.PI * 2);
      d.scale.setScalar(rand(0.8, 1.35));
      d.userData.biomeOK = Math.random() < dens * kind && !crossingNear(pos) && b >= a;
      d.visible = d.userData.biomeOK && decoShown(d);
      return;
    }
    // Las calles de los cruces con semáforo quedan libres (ni casas ni árboles encima).
    if (crossingNear(pos)) { d.userData.pos = pos; d.userData.biomeOK = false; d.visible = false; return; }
    // Delante de un cartel de letras (lado derecho) no va nada: que se lea desde el ómnibus.
    if (side === 1 && R.landmarks.some((l) => l.type === 'letters' && (l.side || 1) === 1 && pos > posAt(l.km) - 90 && pos < posAt(l.km) + 25)) {
      if (ranges[-1][1] >= ranges[-1][0]) side = -1;
      else { d.userData.pos = pos; d.userData.biomeOK = false; d.visible = false; return; }
    }
    // Comercios y edificios: sobre la ruta, con el frente hacia el ómnibus, en una franja angosta
    // (como las cuadras que dan a la Interbalnearia o a la Ruta 9 al pasar por los pueblos).
    if (URBAN[t]) {
      const deep = d.userData.model && Models3D.size(d.userData.model) ? Models3D.size(d.userData.model).z : 12;
      const a = ranges[side][0] + deep / 2 - 1, b = Math.min(ranges[side][1], a + 9);
      d.userData.pos = pos;
      d.position.x = side * rand(a, Math.max(a, b));
      d.rotation.y = -side * Math.PI / 2;
      d.scale.setScalar(1);
      d.userData.biomeOK = Math.random() < Math.min(1, (bio.weights[t] || 0) / 4) && b >= a && !clashes(d);
      d.visible = d.userData.biomeOK && decoShown(d);
      return;
    }
    const [a, b] = ranges[side];
    d.userData.pos = pos;
    d.position.x = side * rand(a, Math.max(a, b));
    d.rotation.y = t === 'house' ? pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]) : rand(0, Math.PI * 2);
    d.scale.setScalar(t === 'house' ? 1 : rand(0.8, 1.25));
    const w = bio.monte && woody ? 1 : Math.min(1, (bio.weights[t] || 0) / 4);
    d.userData.biomeOK = Math.random() < w && ranges[side][1] >= ranges[side][0] && !(bio.lights && clashes(d));
    d.visible = d.userData.biomeOK && decoShown(d);
  }

  // En las ciudades nada se pisa con casas, comercios ni edificios: si el lugar está ocupado, no se muestra.
  // footprint: [medio largo a lo largo de la ruta, medio ancho hacia el costado].
  function footprint(d) {
    const s = d.userData.model && Models3D.size(d.userData.model);
    if (!s) return [5, 5];
    const turned = Math.abs(Math.sin(d.rotation.y)) > 0.5;
    return turned ? [s.z / 2, s.x / 2] : [s.x / 2, s.z / 2];
  }
  function clashes(d) {
    // Las casas y los edificios se cuidan entre sí; árboles y demás solo se apartan de los edificios.
    const solid = d.userData.type === 'house' || URBAN[d.userData.type];
    const [l, w] = solid ? footprint(d) : [1.5, 1.5];
    for (const o of decos) {
      if (o === d || !o.userData.biomeOK || o.userData.forest) continue;
      const t = o.userData.type;
      if (!URBAN[t] && !(solid && t === 'house')) continue;
      const [ol, ow] = footprint(o);
      if (Math.abs(o.userData.pos - d.userData.pos) < l + ol + 1 && Math.abs(o.position.x - d.position.x) < w + ow + 1) return true;
    }
    return false;
  }

  // Tipos de decoración que usan modelos del pack (variantes). Se dibujan con InstancedMesh: cada
  // árbol o casa es un objeto liviano (sin malla) y todas las copias de un modelo van en un solo dibujo.
  const DECO_MODELS = {
    tree: ['tree1', 'tree2'], eucalyptus: ['tree3'], pine: ['pine1', 'pine3'],
    house: ['house1', 'house2', 'house3', 'house4', 'house5'],
    // Hechos por código en models3d.js: comercios de una planta y edificios de 2 a 5 pisos.
    shop: ['shopA', 'shopB', 'shopC', 'shopD', 'bldg2a', 'bldg2b'],
    building: ['bldg3', 'bldg4', 'bldg2a', 'bldg5', 'bldg3', 'bldg2b']
  };
  const URBAN = { shop: true, building: true };
  const modelVariants = (t) => (DECO_MODELS[t] || []).filter((k) => Models3D.has(k));
  // Bosque fuera de las ciudades (aparte de la decoración de cada zona). Con "distancia corta" se ve la mitad.
  // Sobre todo el pino liviano (pine1, ~1.600 triángulos); los demás tienen el doble. Sin sombras.
  const FOREST_MODELS = ['pine1', 'tree2', 'pine1', 'tree3', 'tree2', 'pine1'];
  const FOREST_N = 100;
  // Posiciones de juego de los cruces con semáforo (la calle ocupa unos 8 m; se deja margen).
  const CROSSINGS = R.landmarks.filter((l) => l.type === 'semaforo').map((l) => posAt(l.km));
  const crossingNear = (pos) => CROSSINGS.some((c) => Math.abs(pos - c) < 9);
  const decoPools = {};

  function makeDecoItem(t, i) {
    const v = modelVariants(t);
    if (!v.length) return noCull(World3D.makeDeco(t));
    const o = new THREE.Object3D();
    o.userData.model = v[i % v.length];
    return o;
  }

  // Un InstancedMesh por parte de cada modelo usado en el tramo.
  function buildPools(items, shadow = true) {
    const byModel = {};
    items.forEach((d) => { if (d.userData.model) (byModel[d.userData.model] = byModel[d.userData.model] || []).push(d); });
    return Object.entries(byModel).map(([key, proxies]) => ({
      proxies,
      meshes: Models3D.parts(key).map((p) => {
        const im = new THREE.InstancedMesh(p.geo, p.mat, proxies.length);
        im.castShadow = shadow;
        im.frustumCulled = false;
        im.count = 0;
        return im;
      })
    }));
  }

  function updatePools() {
    for (const pool of decoPools[R.id] || []) {
      let n = 0;
      for (const d of pool.proxies) {
        if (!d.visible) continue;
        d.updateMatrix();
        for (const im of pool.meshes) im.setMatrixAt(n, d.matrix);
        n++;
      }
      for (const im of pool.meshes) { im.count = n; im.instanceMatrix.needsUpdate = true; }
    }
  }

  // Decoración de cada tramo: los tipos que usa su paisaje, más copias de los que más pesan.
  // Se arma una vez por tramo y queda guardada (cambiar de tramo en el título no la rehace).
  const decoSets = {};
  function buildDecos() {
    decos.forEach((d) => scene.remove(d));
    decos.length = 0;
    Object.values(decoPools).forEach((list) => list.forEach((p) => p.meshes.forEach((m) => scene.remove(m))));
    if (!decoSets[R.id]) {
      const maxW = {};
      R.biomes.forEach((b) => Object.entries(b.weights).forEach(([t, w]) => { maxW[t] = Math.max(maxW[t] || 0, w); }));
      const types = [];
      Object.entries(maxW).forEach(([t, w]) => { for (let k = 0; k < Math.ceil(w); k++) types.push(t); });
      types.sort(() => Math.random() - 0.5);
      // Unas 4 copias por unidad de peso: la misma densidad en todos los tramos. Los tramos con montes
      // llevan más árboles (con instancing casi no cuesta).
      const extra = R.biomes.some((b) => b.monte) ? 1.8 : 1;
      decoSets[R.id] = Array.from({ length: Math.round(Math.max(90, types.length * 3.75) * extra) }, (_, i) => {
        const t = types[i % types.length];
        const d = makeDecoItem(t, i);
        d.userData.type = t;
        d.userData.idx = i;
        return d;
      });
      const forest = FOREST_MODELS.filter((k) => Models3D.has(k));
      if (forest.length) {
        for (let i = 0; i < FOREST_N; i++) {
          const d = new THREE.Object3D();
          d.userData.model = forest[i % forest.length];
          d.userData.type = 'tree';
          d.userData.forest = true;
          d.userData.idx = i;
          decoSets[R.id].push(d);
        }
      }
    }
    if (!decoPools[R.id]) {
      const set = decoSets[R.id];
      decoPools[R.id] = buildPools(set.filter((d) => !d.userData.forest))
        .concat(buildPools(set.filter((d) => d.userData.forest), false));
    }
    decoSets[R.id].forEach((d) => { if (!d.userData.model) scene.add(d); decos.push(d); });
    decoPools[R.id].forEach((p) => p.meshes.forEach((m) => scene.add(m)));
  }

  // Cerros del fondo (Sierra de las Ánimas, Pan de Azúcar...): se acercan y pasan de costado en su tramo.
  const backdropSets = {};
  function buildBackdrops() {
    backdrops.forEach((b) => scene.remove(b.obj));
    backdrops.length = 0;
    if (!backdropSets[R.id]) {
      backdropSets[R.id] = R.landmarks.filter((l) => l.type === 'backdrop').map((l) => {
        const obj = noCull(World3D.makeMountain(l.model));
        obj.visible = false;
        if (l.model === 'sierra') obj.rotation.y = Math.PI / 2;   // la sierra corre paralela a la ruta
        obj.scale.setScalar(l.model === 'sierra' ? 1.3 : 1.5);
        return { ...l, obj };
      });
    }
    backdropSets[R.id].forEach((b) => { scene.add(b.obj); backdrops.push(b); });
  }

  function createDecos() {
    // Filas repetidas: una InstancedMesh por pieza. `lights` = solo en zonas con alumbrado.
    // `left` = a esa distancia del borde izquierdo de la calzada (depende del perfil de la ruta).
    [
      { type: 'post', x: 5.6, gap: 25, n: 13 },
      { type: 'post', left: -0.4, gap: 25, n: 13 },
      { type: 'lightPole', x: 7.0, gap: 50, n: 8, lights: true },
      { type: 'utePole', x: 10.2, gap: 45, n: 9 },
      { type: 'fence', x: 11.5, gap: 10, n: 33 },
      { type: 'fence', left: -2.8, gap: 10, n: 33 }
    ].forEach((r) => {
      r.meshes = World3D.rowParts(r.type).map((p) => {
        const im = new THREE.InstancedMesh(p.geo, p.mat, r.n * p.offs.length);
        im.castShadow = true;
        im.frustumCulled = false;
        scene.add(im);
        return { im, offs: p.offs };
      });
      rows.push(r);
    });
  }

  function resetDecos() {
    decos.forEach((d) => placeDeco(d, S.dist + rand(-25, 300)));
  }

  // Arma el viaje: paisaje, cerros, curvas y ranking (uno solo, del viaje completo).
  function setupRoute() {
    Ranking.KEY = 'cot-ruta-3d-ranking-completo';
    buildDecos();
    buildBackdrops();
    buildProfile();
    updateRoadProfile();
  }

  // Calzada según dónde está el ómnibus. Cerca de Pan de Azúcar se ven las dos: la Interbalnearia hasta
  // el punto del cambio y Ruta 9 desde ahí (corte con un plano, ver createRoad en world3d.js).
  let curProfile = null;
  function updateRoadProfile() {
    const dist = S ? S.dist : 0;
    const here = profileAt(dist);
    if (here !== curProfile) { curProfile = here; World3D.setProfile(here); }
    const ch = PROFILE_CHANGES.find((c) => c.pos - dist > -120 && c.pos - dist < 900);
    if (ch) road.setSplit(ch.behind, ch.ahead, -(ch.pos - dist));
    else road.setProfile(here);
  }

  // ---------- Curvas y lomas del tramo ----------
  // Salen del trazado real (data/ruta-mvd-chuy.js) como referencia: el pedazo R.real se comprime a
  // TRIP_M metros, así que los giros y las subidas se atenúan y se suavizan para que se puedan
  // manejar (radio mínimo y pendiente máxima). Sin datos, se usan curvas y lomas suaves inventadas.
  const PROF_STEP = 10;                 // una muestra cada 10 m de juego
  const PROF_PRE = 300, PROF_POST = 1200;
  const CURVE_GAIN = 0.55;              // qué parte del giro real se conserva
  const MIN_RADIUS = 350;               // m: la curva más cerrada del juego
  const HILL_GAIN = 0.9;                // qué parte del desnivel real se conserva
  const MAX_GRADE = 0.06;               // pendiente máxima: 6 %
  let profTh = null, profH = null;

  function smooth(arr, win) {
    const out = new Float32Array(arr.length), r = win >> 1;
    for (let i = 0; i < arr.length; i++) {
      let sum = 0, n = 0;
      for (let k = Math.max(0, i - r); k <= Math.min(arr.length - 1, i + r); k++) { sum += arr[k]; n++; }
      out[i] = sum / n;
    }
    return out;
  }

  function buildProfile() {
    const n = Math.ceil((PROF_PRE + TRIP_M + PROF_POST) / PROF_STEP) + 1;
    let turn = new Float32Array(n), rise = new Float32Array(n);
    const maxTurn = PROF_STEP / MIN_RADIUS, maxRise = PROF_STEP * MAX_GRADE;
    const real = typeof RutaReal !== 'undefined' && RutaReal && R.real;
    if (real) {
      // Cada segmento del juego toma su pedazo del trazado real (g.real, en km recorridos).
      const ratioAt = (g) => (g.real[1] - g.real[0]) * 1000 / SEG_M;
      const sAt = (i) => {
        const p = i * PROF_STEP - PROF_PRE, g = segAtPos(p);
        return Math.min(RutaReal.largo, Math.max(0, g.real[0] * 1000 + (p - g.p0) * ratioAt(g)));
      };
      const v = new THREE.Vector3();
      // Rumbo real promediado sobre el pedazo de ruta que representa cada muestra.
      const span = Math.max(30, ratioAt(SEGS[0]) * PROF_STEP);
      const headingAt = (s) => { RutaReal.direccionEn(s, v, span); return Math.atan2(v.x, -v.z); };
      const heightAt = (s) => RutaReal.posicionEn(s, v).y;
      let prevH = headingAt(sAt(0)), prevY = heightAt(sAt(0));
      for (let i = 1; i < n; i++) {
        const s = sAt(i), hd = headingAt(s), y = heightAt(s);
        let dh = hd - prevH;
        dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI;
        turn[i] = Math.max(-maxTurn, Math.min(maxTurn, dh * CURVE_GAIN));
        rise[i] = Math.max(-maxRise, Math.min(maxRise, (y - prevY) * HILL_GAIN));
        prevH = hd;
        prevY = y;
      }
    }
    if (!real || !RutaReal.conAltura) {
      // Lomas suaves inventadas (si todavía no se cargó la altura real).
      for (let i = 1; i < n; i++) rise[i] = maxRise * 0.5 * Math.sin(i / 37) * Math.sin(i / 11.3 + 1);
    }
    if (!real) for (let i = 1; i < n; i++) turn[i] = maxTurn * 0.6 * Math.sin(i / 53) * Math.sin(i / 23 + 2);
    // Suavizado: los giros y las subidas entran y salen de a poco (sin quiebres).
    turn = smooth(smooth(turn, 9), 9);
    rise = smooth(smooth(rise, 7), 7);
    profTh = new Float32Array(n);
    profH = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      profTh[i] = profTh[i - 1] + turn[i];
      profH[i] = profH[i - 1] + rise[i];
    }
  }

  // Rumbo (rad) y altura (m) de la ruta en la posición p del juego.
  function profAt(arr, p) {
    const f = Math.max(0, Math.min(arr.length - 1.001, (p + PROF_PRE) / PROF_STEP));
    const i = Math.floor(f);
    return arr[i] + (arr[i + 1] - arr[i]) * (f - i);
  }
  const headingAt = (p) => profAt(profTh, p);
  const heightAt = (p) => profAt(profH, p);
  // Pendiente (m/m, + = subida) en la posición p.
  const slopeAt = (p) => (heightAt(p + 10) - heightAt(p - 10)) / 20;

  // Las filas no guardan estado: cada copia va a un múltiplo fijo de `gap` metros.
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  function updateRows() {
    for (const r of rows) {
      const base = Math.ceil((S.dist - 30) / r.gap) * r.gap;
      for (const { im, offs } of r.meshes) {
        let k = 0;
        for (let i = 0; i < r.n; i++) {
          const pos = base + i * r.gap;
          const z = -(pos - S.dist);
          const x = r.left !== undefined ? roadAt(pos).ROAD.l + r.left : r.x;
          // Fuera de la zona con alumbrado, la columna se achica a cero (no se dibuja).
          const on = (!r.lights || biomeAt(kmAt(pos)).lights) && (r.type === 'lightPole' || !crossingNear(pos)) &&
            (x < 0 || !stationNear(pos, STATION.END + 8));      // el desvío de la estación va por ahí
          for (const o of offs) {
            _p.set(x + o[0], o[1], z + o[2]);
            if (on) _s.set(o[3], o[4], o[5]); else _s.set(0, 0, 0);
            im.setMatrixAt(k++, _m.compose(_p, _q, _s));
          }
        }
        im.instanceMatrix.needsUpdate = true;
      }
    }
  }

  function updateBackdrops() {
    const km = kmAt(S.dist);
    for (const b of backdrops) {
      const t = (km - b.from) / (b.to - b.from);
      b.obj.visible = !S.attract && t >= 0 && t <= 1;
      if (!b.obj.visible) continue;
      // Lejos al costado: entra por el horizonte y termina atrás, como si lo pasáramos.
      b.obj.position.set(b.side * (b.model === 'sierra' ? 600 : 560), 0, -1100 + t * 1400);
    }
  }

  function updateDecos(dt) {
    updateBackdrops();
    updateRows();
    for (const d of decos) {
      if (d.userData.pos < S.dist - 30) placeDeco(d, S.dist + rand(240, 300));
      d.position.z = -(d.userData.pos - S.dist);
    }
    updatePools();
  }

  // ---------- Spawns ----------
  // Todo vehículo del tránsito va con las luces prendidas (es de noche).
  function pushCar(car) {
    Ambiente.carLights(car);
    S.cars.push(car);
  }
  // Ruta 9: en nuestro carril solo van vehículos lentos (camiones, autos tranquilos, motos).
  function spawnSlowCar() {
    const p = S.dist / TRIP_M;
    const busy = S.cars.some((c) => c.userData.lane === RIGHT && c.position.z < -(SPAWN_AHEAD - 60));
    if (!busy && !S.attract) {
      const r = Math.random();
      const kind = r < 0.45 ? 'truck' : r < 0.6 ? 'moto' : 'car';
      const car = kind === 'truck' ? World3D.makeTruck() : kind === 'moto' ? World3D.makeMoto() : World3D.makeCar(pick(World3D.CAR_COLORS));
      car.position.x = LANE_X[RIGHT];
      addWorld(car, S.dist + SPAWN_AHEAD, { lane: RIGHT, speed: R9_SPEED[kind] * rand(0.9, 1.1) });
      pushCar(car);
    }
    S.nextCarAt = S.dist + (150 + 90 * (1 - p)) * rand(0.75, 1.3);
  }

  // Los que vienen de frente. Ruta 9: por el carril izquierdo, a veces en fila, a veces con un hueco
  // largo para pasar tranquilo. Interbalnearia: por los dos carriles del otro lado de la doble amarilla.
  // En los dos casos se pueden chocar si el ómnibus va de contramano.
  function spawnOncoming() {
    const p = S.dist / TRIP_M;
    const at = S.dist + ONCOMING_AHEAD;
    const ib = !twoWay(at);
    const car = Math.random() < 0.25 ? World3D.makeTruck() : World3D.makeCar(pick(World3D.CAR_COLORS));
    car.rotation.y = Math.PI;
    car.position.x = ib ? pick(World3D.ROAD_PROFILES.ib.ONCOMING_LANES) : LANE_X[0];
    addWorld(car, at, { lane: -1, speed: -rand(19, 24), oncoming: true, ibLane: ib });
    pushCar(car);
    const gap = ib ? rand(70, 170) : Math.random() < 0.3 ? rand(300, 450) : rand(80, 200);
    S.nextOncomingAt = S.dist + gap * (1 - 0.25 * p);
  }

  function spawnCars() {
    if (twoWay(S.dist + SPAWN_AHEAD)) { spawnSlowCar(); return; }
    const p = S.dist / TRIP_M;
    // Con 2 carriles, dos autos a la vez cierran la ruta: pasa poco y obliga a frenar.
    const count = Math.random() < 0.03 + 0.07 * p ? 2 : 1;
    const free = LANES.filter((l) => !S.cars.some((c) => c.userData.lane === l && c.position.z < -(SPAWN_AHEAD - 40)));
    free.sort(() => Math.random() - 0.5);
    for (let i = 0; i < Math.min(count, free.length); i++) {
      const lane = free[i];
      const r = Math.random();
      let car;
      if (r < 0.2 && lane === RIGHT) car = World3D.makeTruck();
      else if (r < 0.3) car = World3D.makeMoto();
      else car = World3D.makeCar(pick(World3D.CAR_COLORS));
      car.position.x = LANE_X[lane];
      addWorld(car, S.dist + SPAWN_AHEAD, { lane, speed: LANE_SPEED[lane] });
      pushCar(car);
    }
    // Huecos más largos que antes: el ómnibus cambia de carril despacio.
    S.nextCarAt = S.dist + (75 + 55 * (1 - p)) * rand(0.75, 1.25) + (S.attract ? 25 : 0);
  }

  // Encomiendas y mates: solo en nuestros carriles, nunca del lado de contramano
  // (en Ruta 9 el carril izquierdo es de contramano, así que van en el derecho).
  function spawnPickup() {
    const ours = twoWay(S.dist + SPAWN_AHEAD) ? [RIGHT] : LANES;
    const free = ours.filter((l) => !S.cars.some((c) => c.userData.lane === l && c.position.z < -(SPAWN_AHEAD - 50)));
    if (free.length) {
      const lane = pick(free);
      const kind = S.confort < 85 && Math.random() < 0.55 ? 'mate' : 'box';
      const it = kind === 'mate' ? World3D.makeMate() : World3D.makeParcel();
      it.position.set(LANE_X[lane], 1.2, 0);
      addWorld(it, S.dist + SPAWN_AHEAD - 10, { kind, spin: true });
      S.pickups.push(it);
    }
    S.nextPickupAt = S.dist + M_PER_KM * rand(2.2, 3.8);
  }

  // Lugares del tramo (route3d.js) para un viaje nuevo, más un cartel amarillo 1 km antes de cada peaje.
  function routeMarks() {
    const marks = [];
    R.landmarks.forEach((l) => {
      if (l.type === 'backdrop' || l.type === 'water') return;
      marks.push({ ...l, pos: posAt(l.km), spawned: false });
      if (l.type === 'peaje') marks.push({ type: 'warning', km: l.km - 1, pos: posAt(l.km - 1), l1: 'PEAJE', l2: 'A 1 km' });
      if (l.type === 'estacion') marks.push({ type: 'warning', km: l.km, pos: posAt(l.km) - 330, l1: 'ESTACIÓN', l2: 'SERVICIO' });
    });
    return marks;
  }

  function spawnMark(m) {
    m.spawned = true;
    let obj;
    if (m.type === 'locality') { obj = World3D.makeLocalitySign(m.text, m.icon); obj.position.x = 7.9; }
    else if (m.type === 'arroyo') { obj = World3D.makeArroyoSign(m.name, m.km, m.shield); obj.position.x = 7.6; }
    else if (m.type === 'semaforo') {
      obj = World3D.makeCrossing(m.profile, m.sides);
      m.light = 'green';
      m.wait = Math.random() < 0.8;      // la mayoría de las veces te agarra en rojo
      m.sideCars = 0;
    }
    else if (m.type === 'warning') { obj = World3D.makeWarningSign(m.l1, m.l2); obj.position.x = 7.4; }
    else if (m.type === 'peaje') { obj = World3D.makePeaje(m.name); }
    else if (m.type === 'estacion') { obj = World3D.makeStation(); }
    else if (m.type === 'fortaleza') { obj = World3D.makeFortaleza(); obj.position.x = 75; obj.rotation.y = 0.3; }
    else if (m.type === 'letters' && Models3D.hasLetters()) {
      // Letras de colores sobre el pasto, giradas hacia la ruta para que se lean desde el ómnibus.
      obj = Models3D.letters(m.text, m.text.length > 12 ? 3.4 : 4.4);
      obj.position.x = (m.side || 1) * (13.5 + obj.userData.width * 0.42);
      obj.rotation.y = (m.side || 1) * -0.6;
    }
    if (obj) m.obj = addWorld(obj, m.pos);
  }

  function spawnStop(stop) {
    stop.spawned = true;
    stop.waiting = 2 + Math.floor(Math.random() * 4);
    stop.zone = addWorld(World3D.makeStopZone(), stop.pos);
    const shelter = World3D.makeShelter(stop.name.replace('Parada ', ''));
    shelter.position.x = 8.3;
    addWorld(shelter, stop.pos);
    stop.people = [];
    for (let i = 0; i < stop.waiting; i++) {
      const person = World3D.makePerson();
      person.position.x = 7.4 + (i % 2) * 0.7;
      person.rotation.y = -Math.PI / 2;
      addWorld(person, stop.pos + 2.4 - i * 1.2);
      stop.people.push(person);
    }
  }

  function spawnStuff() {
    const ahead = S.dist + SPAWN_AHEAD;
    if (!S.attract) {
      // Salto de km en Pan de Azúcar (Interbalnearia km 97 → Ruta 9 km 107): sin mojones en el hueco.
      const gap = SEGS.find((g, i) => i > 0 && S.nextKmSign > SEGS[i - 1].to && S.nextKmSign < g.from);
      if (gap) S.nextKmSign = Math.ceil(gap.from / 10) * 10;
      if (S.nextKmSign < R.to && posAt(S.nextKmSign) < ahead) {
        const sign = World3D.makeKmSign(S.nextKmSign, segAtKm(S.nextKmSign).shield);
        sign.position.x = 7.2;
        addWorld(sign, posAt(S.nextKmSign));
        S.nextKmSign += 10;
      }
      S.stops.forEach((s) => { if (!s.spawned && s.pos < ahead) spawnStop(s); });
      if (!S.terminal && TRIP_M < ahead) {
        S.terminal = true;
        addWorld(World3D.makeTerminal(R.terminal), TRIP_M);
      }
      // Mar o laguna: una sola pieza larga desde donde empieza hasta donde termina (o hasta el final).
      S.waters.forEach((w) => {
        const start = posAt(w.from);
        if (w.spawned || start >= ahead) return;
        w.spawned = true;
        const end = Math.min(posAt(w.to), TRIP_M + 400);
        const len = end - start;
        addWorld(World3D.createWater(len, w.side, w.beach), start + len / 2, { half: len / 2 });
      });
      S.marks.forEach((m) => { if (!m.spawned && m.pos < ahead) spawnMark(m); });
    }
    const nearEnd = S.dist > TRIP_M - 2 * M_PER_KM;
    if (mode !== 'ending' && !nearEnd) {
      if (S.dist >= S.nextCarAt) spawnCars();
      if (S.dist >= S.nextOncomingAt) spawnOncoming();
      if (!S.attract && S.dist >= S.nextPickupAt) spawnPickup();
    }
  }

  // ---------- Animaciones simples ----------
  const anims = [];
  function animate(obj, to, dur, onDone) {
    anims.push({ obj, from: obj.position.clone(), to, scale0: obj.scale.x, t: 0, dur, onDone });
  }
  function updateAnims(dt) {
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      a.obj.position.lerpVectors(a.from, a.to, k);
      a.obj.scale.setScalar(a.scale0 * (1 - 0.7 * k));
      if (k >= 1) { anims.splice(i, 1); if (a.onDone) a.onDone(); }
    }
  }

  // ---------- Bucle ----------
  const keys = new Set();
  let touchBrake = false;
  let last = performance.now();

  function update(dt) {
    if (!S || !bus) return;
    const playing = mode === 'play';

    if (playing) {
      S.elapsed += dt;
      updateSteer(dt);
      if (control === 'tilt') updateTilt(dt);
      const braking = keys.has('ArrowDown') || keys.has('KeyS') || keys.has('Space') || touchBrake;
      if (S.stunned > 0) {
        S.stunned -= dt;
        S.speed = Math.max(0, S.speed - 60 * dt);
      } else if (braking) {
        // Con la calzada mojada el ómnibus frena peor.
        S.speed = Math.max(0, S.speed - BRAKE * (1 - 0.3 * S.weather.rain) * dt);
      } else if (S.fuel <= 0) {
        S.speed = Math.max(0, S.speed - 3 * dt);     // sin gasoil: el motor se apaga y va quedando
      } else {
        // La aceleración cae a medida que sube la velocidad, como un motor cargado.
        S.speed = Math.min(MAX_SPEED, S.speed + ACCEL * (1 - 0.55 * S.speed / MAX_SPEED) * dt);
      }
      bus.userData.setBrake(braking || S.stunned > 0);
      // En las subidas el ómnibus pierde velocidad y en las bajadas gana (sin pasar la máxima).
      S.speed = Math.max(0, Math.min(MAX_SPEED, S.speed - 9.8 * slopeAt(S.dist) * 0.45 * dt));
    } else if (mode === 'ending') {
      S.speed = Math.max(0, S.speed - 12 * dt);
      bus.userData.setBrake(S.speed > 0);
    } else if (S.attract && mode === 'title' && !twoWay()) {
      // Piloto automático para la pantalla de título (en Ruta 9 se queda en su carril).
      S.autoTimer -= dt;
      const danger = S.cars.some((c) => c.userData.lane === S.lane && c.position.z < 0 && c.position.z > -40);
      if (danger || S.autoTimer < 0) {
        const opts = [S.lane - 1, S.lane + 1].filter((l) => l >= 0 && l <= RIGHT &&
          !S.cars.some((c) => c.userData.lane === l && Math.abs(c.position.z) < 25));
        if (opts.length) { S.lane = pick(opts); S.targetX = LANE_X[S.lane]; }
        S.autoTimer = rand(2, 4);
      }
    }

    S.dist += S.speed * dt;
    if (playing) useFuel(dt);
    road.scroll(S.dist);
    updateRoadProfile();
    // Curvas y lomas (bend3d.js).
    Bend.update(S.dist, headingAt, heightAt);
    const slope = slopeAt(S.dist);
    const curve = (headingAt(S.dist + 10) - headingAt(S.dist - 10)) / 20;

    // Dirección con inercia: la velocidad lateral sigue al carril elegido de a poco, sin pasarse.
    // Parado casi no se puede mover de costado (un ómnibus no hace "strafe").
    // Donde la ruta se angosta (fin de la Interbalnearia), el ómnibus vuelve a la calzada.
    // Al terminar el desvío de la estación, vuelve solo a la ruta.
    const lanesNow = busLanes();
    S.targetX = Math.max(lanesNow[0], Math.min(lanesNow[lanesNow.length - 1], S.targetX));
    const err = S.targetX - S.busX;
    const steer = Math.min(1, 0.2 + S.speed / 14);
    const want = Math.max(-LAT_MAX, Math.min(LAT_MAX, err * 1.6)) * steer;
    const prevLat = S.latV;
    S.latV += Math.max(-LAT_ACC * dt, Math.min(LAT_ACC * dt, want - S.latV));
    S.busX += S.latV * dt;
    bus.position.x = S.busX;
    const latAcc = (S.latV - prevLat) / Math.max(dt, 0.001);
    const longAcc = (S.speed - S.prevSpeed) / Math.max(dt, 0.001);
    S.prevSpeed = S.speed;
    // Rumbo según la velocidad lateral; balanceo y cabeceo con resorte (la carrocería se inclina y vuelve).
    bus.rotation.y = -Math.atan2(S.latV, Math.max(S.speed, 6));
    const rollTarget = Math.max(-0.05, Math.min(0.05, S.latV * 0.009 + latAcc * 0.006 + curve * S.speed * S.speed * 0.006));
    const pitchTarget = Math.max(-0.025, Math.min(0.025, longAcc * 0.0012));
    S.roll += (rollTarget - S.roll) * Math.min(1, dt * 2.5);
    S.pitch += (pitchTarget - S.pitch) * Math.min(1, dt * 3);
    bus.rotation.z = S.roll;
    bus.rotation.x = S.pitch + Math.atan(slope);
    bus.position.y = S.speed > 1 ? Math.sin(S.dist * 0.7) * 0.012 : 0;

    if (S.invuln > 0) {
      S.invuln -= dt;
      bus.visible = Math.floor(S.invuln * 11) % 2 === 0;
    } else {
      bus.visible = true;
    }

    spawnStuff();

    for (let i = world.length - 1; i >= 0; i--) {
      const o = world[i];
      const u = o.userData;
      if (u.speed) u.pos += u.speed * dt;
      o.position.z = -(u.pos - S.dist);
      if (u.spin) { o.rotation.y += dt * 2; o.position.y = 1.2 + Math.sin(S.elapsed * 4 + u.pos) * 0.2; }
      const behind = u.half ? o.position.z - u.half > 30 : o.position.z > 30;
      if (behind || (u.speed && o.position.z < -(SPAWN_AHEAD + 80))) {
        disposeTextures(o);
        removeWorld(o);
      }
    }
    S.cars = S.cars.filter((c) => !c.userData.dead);
    S.pickups = S.pickups.filter((c) => !c.userData.dead);
    updateCrossings(dt);
    updateTraffic(dt);
    updateDecos(dt);
    updateAnims(dt);
    updateDayNight();
    updateWeather(dt);
    Ambiente.updateZones(performance.now() / 1000);
    // Faros del ómnibus sobre el asfalto (siguen al ómnibus).
    headPool.position.x = S.busX;
    headPool.rotation.y = bus.rotation.y;
    headPool.visible = (bus.visible || S.invuln > 0) && dayNight.k > 0.02;

    if (playing) {
      checkCars();
      checkPickups();
      checkStops();
      checkPeajes();
      checkCrossings();
      checkStation(dt);
      if (S.fuel <= 0 && S.speed < 0.3) finish(false, 'fuel');
      if (S.dist >= TRIP_M) finish(true);
    }

    // La sombra del sol sigue al ómnibus (cubre solo la zona cercana para que sea nítida).
    // El cielo y el sol giran con el rumbo de la ruta: en una curva el sol cambia de lado de a poco.
    const heading = headingAt(S.dist);
    scene.environmentRotation.y = heading;
    sky.rotation.y = heading;
    _sunDir.copy(SUN_DIR).applyAxisAngle(_up, heading);
    sun.target.position.set(S.busX, 0, -14);
    sun.position.copy(sun.target.position).addScaledVector(_sunDir, 90);

    // Cámara detrás del ómnibus.
    S.shake = Math.max(0, S.shake - dt * 2.5);
    const sh = S.shake * S.shake;
    S.camX += (S.busX * 0.75 - S.camX) * Math.min(1, dt * 2.2);
    // La cámara va sobre la ruta deformada: sigue las curvas y las lomas.
    if (portrait) Bend.at(-20, S.camX + rand(-sh, sh), 10.5 + rand(-sh, sh), camera.position);
    else Bend.at(-18, S.camX + rand(-sh, sh), 8.6 + rand(-sh, sh), camera.position);
    camera.lookAt(Bend.at(portrait ? 18 : 24, S.camX * 1.1, portrait ? -2 : 1, _look));
    sky.position.copy(camera.position);

    if (mode === 'play' || mode === 'ending') updateHud();
  }

  // ---------- Semáforos ----------
  // Cada cruce (landmark 'semaforo') cambia cuando se acerca el ómnibus: amarillo, rojo y verde otra vez.
  // El rojo dura por lo menos RED_MIN segundos y hasta que el ómnibus estuvo parado un rato en la línea.
  // Mientras está en rojo salen autos de las calles: uno dobla hacia nuestro carril derecho y otro cruza.
  const YELLOW_T = 2.6, RED_MIN = 6, RED_STOPPED = 3;
  const STOP_BACK = 6;                   // la línea de detención está 6 m antes del centro del cruce
  const crossings = () => S.marks.filter((m) => m.type === 'semaforo' && m.obj);
  function setLight(m, state) {
    m.light = state;
    m.timer = 0;
    m.obj.userData.setLight(state);
  }

  function updateCrossings(dt) {
    for (const m of crossings()) {
      const d = m.pos - STOP_BACK - S.dist;     // del ómnibus (su centro) a la línea
      m.timer = (m.timer || 0) + dt;
      if (m.light === 'green' && m.wait && !m.cycled && d < 175 && d > 40) setLight(m, 'yellow');
      else if (m.light === 'yellow' && m.timer > YELLOW_T) { setLight(m, 'red'); m.stopped = 0; }
      else if (m.light === 'red') {
        if (S.speed < 1 && d < 110) m.stopped += dt;      // con autos esperando adelante, frena más atrás
        if (m.timer > 1.2 && m.sideCars < 1) spawnSideCar(m, 1);
        if (m.timer > 2.4 && m.sideCars < 2 && m.sides.includes(-1)) spawnSideCar(m, -1);
        if ((m.timer > RED_MIN && m.stopped > RED_STOPPED) || d < -20 || m.timer > 25) { setLight(m, 'green'); m.cycled = true; }
      }
    }
  }

  // Auto que sale de una calle lateral. side 1: dobla desde la derecha y sigue por nuestro carril
  // derecho; side -1: cruza la ruta de izquierda a derecha.
  function spawnSideCar(m, side) {
    m.sideCars++;
    const P = World3D.ROAD_PROFILES[m.profile];
    const car = World3D.makeCar(pick(World3D.CAR_COLORS));
    // Mientras gira o cruza, el auto va de costado: su caja es al revés (hw0/hl0 = la normal).
    const u = { fromSide: true, lane: RIGHT, speed: 0, hw0: car.userData.hw, hl0: car.userData.hl, hw: car.userData.hl, hl: car.userData.hw };
    if (side > 0) {
      const r = P.ROAD.r + 3.5 - LANE_X[RIGHT];
      car.position.x = P.ROAD.r + 26;
      car.rotation.y = Math.PI / 2;
      u.turn = { phase: 0, r, p0: m.pos - 2, x0: LANE_X[RIGHT] + r, v: 7 };
      addWorld(car, m.pos - 2, u);
    } else {
      car.position.x = P.ROAD.l - 26;
      car.rotation.y = -Math.PI / 2;
      u.cross = { v: 8.5, xEnd: P.ROAD.r + 30 };
      addWorld(car, m.pos + 2, u);
    }
    pushCar(car);
  }

  // Tránsito: los autos que salen de las calles, los que van adelante frenan en el semáforo en rojo y
  // detrás del de adelante, y en Pan de Azúcar se acomodan al pasar de dos carriles a uno.
  function updateTraffic(dt) {
    const reds = crossings().filter((m) => m.light !== 'green').map((m) => m.pos - STOP_BACK);
    for (const car of S.cars) {
      const u = car.userData;
      if (u.dead || u.hit) continue;
      if (u.turn) {
        const tr = u.turn;
        if (tr.phase === 0) {            // por la calle hacia la ruta
          car.position.x -= tr.v * dt;
          if (car.position.x <= tr.x0) { car.position.x = tr.x0; tr.phase = 1; tr.a = 0; }
        } else {                         // cuarto de vuelta hasta el carril derecho
          tr.a = Math.min(Math.PI / 2, tr.a + tr.v * dt / tr.r);
          car.position.x = LANE_X[RIGHT] + tr.r * (1 - Math.sin(tr.a));
          u.pos = tr.p0 + tr.r * (1 - Math.cos(tr.a));
          car.rotation.y = Math.PI / 2 - tr.a;
          if (tr.a >= Math.PI / 2) {
            delete u.turn;
            u.hw = u.hw0; u.hl = u.hl0;
            u.speed = 4; u.cruise = 15;
          }
        }
        continue;
      }
      if (u.cross) {
        car.position.x += u.cross.v * dt;
        if (car.position.x > u.cross.xEnd) removeWorld(car);
        continue;
      }
      if (u.oncoming) {
        // Los de frente que llegan a la Interbalnearia pasan a su carril de enfrente (al otro lado de la
        // doble amarilla). Se siguen pudiendo chocar: el ómnibus puede ir de contramano.
        if (profileAt(u.pos) === 'ib' && !u.ibLane) { u.ibLane = true; u.ibX = World3D.ROAD_PROFILES.ib.ONCOMING_LANES[0]; }
        if (u.ibX !== undefined) car.position.x += (u.ibX - car.position.x) * Math.min(1, dt * 1.5);
        continue;
      }
      // Fin de la Interbalnearia: el carril izquierdo se termina y los autos pasan al derecho.
      const ch = PROFILE_CHANGES.find((c) => c.pos - u.pos > 0 && c.pos - u.pos < 160);
      if (ch && ch.ahead === 'r9' && u.lane !== RIGHT) {
        u.lane = RIGHT;
        u.cruise = R9_SPEED.car;
      }
      if (Math.abs(car.position.x - LANE_X[u.lane]) > 0.01) {
        car.position.x += Math.sign(LANE_X[u.lane] - car.position.x) * Math.min(Math.abs(LANE_X[u.lane] - car.position.x), 2 * dt);
      }
      // Velocidad: la de crucero, salvo que haya que frenar (semáforo en rojo o alguien adelante).
      if (u.cruise === undefined) u.cruise = u.speed;
      let limit = Infinity;
      for (const r of reds) if (r > u.pos + u.hl - 1) limit = Math.min(limit, r - u.hl - 1);
      for (const o of S.cars) {
        const v = o.userData;
        if (o === car || v.oncoming || v.dead || v.turn || v.cross) continue;
        if (v.lane === u.lane && v.pos > u.pos) limit = Math.min(limit, v.pos - v.hl - u.hl - 3);
      }
      const gap = limit - u.pos;
      const want = gap === Infinity ? u.cruise : Math.max(0, Math.min(u.cruise, (gap - 2) * 0.9));
      u.speed += Math.max(-9 * dt, Math.min(3 * dt, want - u.speed));
      if (u.speed < 0.05 && want === 0) u.speed = 0;
    }
  }

  // Pasar la línea con el semáforo en rojo resta confort; frenar y esperar el verde suma.
  function checkCrossings() {
    for (const m of crossings()) {
      if (m.judged) continue;
      const front = S.dist + bus.userData.len / 2;
      const line = m.pos - STOP_BACK;
      if (front > line + 1.5) {
        m.judged = true;
        if (m.light !== 'green') learned('semaforo');
        if (m.light === 'red') {
          S.confort = Math.max(0, S.confort - 15);
          S.score = Math.max(0, S.score - 50);
          Sfx.miss();
          flash();
          popup('¡Pasaste en rojo!  -15% confort', '#ff6b5e');
          if (S.confort <= 0) finish(false);
        } else if (m.stopped > RED_STOPPED) {
          S.score += 40;
          Sfx.pickup();
          popup('Esperaste el verde  +40', '#9be37a');
        }
      }
    }
  }

  function busHits(o, hw, hl) {
    return Math.abs(o.position.x - S.busX) < hw + bus.userData.halfW - 0.1 &&
      Math.abs(o.position.z) < hl + bus.userData.len / 2 - 0.3;
  }

  function checkCars() {
    for (const car of S.cars) {
      const u = car.userData;
      if (car.position.z > 10 && !u.passed) {
        u.passed = true;
        // Ruta 9: pasar a uno lento sin chocarlo suma puntos.
        if (twoWay() && !u.oncoming && !u.hit && !u.fromSide) {
          S.score += 20;
          popup('Sobrepaso +20', '#9be37a');
        }
      }
      if (u.passed || u.hit || S.invuln > 0) continue;
      if (busHits(car, u.hw, u.hl)) crash(car);
    }
  }

  function crash(car) {
    if (car) {
      car.userData.hit = true;
      car.userData.speed += Math.sign(car.userData.speed) * 6;   // el auto chocado sigue de largo
    }
    S.crashes++;
    S.confort = Math.max(0, S.confort - 30);
    const u = car && car.userData;
    const cost = !u ? REPAIR.isleta : u.hl > 4 ? REPAIR.truck : u.hw < 0.6 ? REPAIR.moto : REPAIR.car;
    const paid = Math.min(cost, S.money);
    S.money -= paid;
    S.repairs += paid;
    S.speed *= 0.2;
    S.stunned = 0.5;
    S.invuln = 1.8;
    S.shake = 1;
    Sfx.crash();
    flash();
    popup(`¡CHOQUE!  -30% confort · arreglo -$${money(cost)}`, '#ff6b5e');
    if (S.confort <= 0) finish(false);
  }

  function checkPickups() {
    for (const it of S.pickups) {
      if (it.userData.dead || !busHits(it, 0.5, 0.5)) continue;
      removeWorld(it);
      Sfx.pickup();
      if (it.userData.kind === 'mate') {
        S.confort = Math.min(100, S.confort + 15);
        popup('¡Mate! +15% confort', '#9be37a');
      } else {
        S.boxes++;
        S.score += 50;
        S.money += ENCOMIENDA;
        popup(`Encomienda +$${ENCOMIENDA}`, '#ffd36b');
      }
    }
  }

  function checkStops() {
    for (const s of S.stops) {
      if (!s.spawned || s.done || s.missed) continue;
      const dz = S.dist - s.pos;          // + = el ómnibus ya pasó el centro de la parada
      const inLane = Math.abs(S.busX - LANE_X[RIGHT]) < 0.5;
      // Se puede frenar un poco pasado de la parada: suben igual, pero caminan más y se quejan
      // (un poco de confort según cuánto te pasaste). Pasado de STOP_OVER, ya no esperan.
      if (dz > -10 && dz < STOP_OVER && inLane && S.speed <= STOP_SPEED) {
        const over = Math.max(0, dz - 8);
        if (over > 0) {
          const k = Math.min(1, over / (STOP_OVER - 8));
          const pen = Math.round(2 + 6 * k);
          S.confort = Math.max(0, S.confort - pen);
          popup(`Te pasaste ${Math.round(over)} m: caminaron hasta el ómnibus (-${pen}% confort)`, '#ffb347');
        }
        board(s);
        if (S.confort <= 0) finish(false);
      } else if (dz > STOP_OVER) {
        s.missed = true;
        S.confort = Math.max(0, S.confort - 10);
        Sfx.miss();
        popup('¡Se te pasó la parada!', '#ff6b5e');
        drawProgress();
        if (S.confort <= 0) finish(false);
      }
    }
  }

  // Peaje: la isleta del medio se choca si pasás entre carriles, y hay que cruzar a 40 km/h o menos.
  function checkPeajes() {
    for (const m of S.marks) {
      if (m.type !== 'peaje' || !m.obj || m.done) continue;
      const u = m.obj.userData;
      const dz = m.obj.position.z;
      const reach = u.halfLen + bus.userData.len / 2;
      if (!m.hit && S.invuln <= 0 && Math.abs(dz) < reach &&
        u.islands.some((ix) => Math.abs(S.busX - ix) < u.islandHalf + bus.userData.halfW - 0.05)) {
        m.hit = true;
        crash(null);
      }
      if (!m.checked && dz > -1) {          // el ómnibus está pasando por las cabinas
        m.checked = true;
        learned('peaje');
        const kmh = Math.round(S.speed * KMH);
        if (kmh > ROUTE3D_COMMON.peajeMaxKmh + 2) {
          S.confort = Math.max(0, S.confort - 10);
          Sfx.miss();
          popup(`¡Muy rápido en el peaje! (${kmh} km/h)  -10% confort`, '#ff6b5e');
          if (S.confort <= 0) finish(false);
        } else if (!m.hit) {
          S.score += 50;
          Sfx.pickup();
          popup(`Peaje ${m.name} bien pasado  +50`, '#9be37a');
        }
      }
      if (dz > reach + 5) m.done = true;
    }
  }

  function board(s) {
    s.done = true;
    learned('parada');
    S.passengers += s.waiting;
    S.score += s.waiting * 100;
    S.money += s.waiting * s.fare;
    Sfx.board();
    s.people.forEach((p, i) => {
      const i0 = world.indexOf(p);
      if (i0 >= 0) world.splice(i0, 1);
      setTimeout(() => {
        animate(p, new THREE.Vector3(S.busX + 1.4, 0.3, -4.5), 0.45, () => scene.remove(p));
      }, i * 110);
    });
    popup(`+${s.waiting} pasajeros a $${money(s.fare)}  (+$${money(s.waiting * s.fare)})`, '#9be37a');
    drawProgress();
  }

  // ---------- Gasoil y estaciones de servicio ----------
  const money = (n) => Math.round(n).toLocaleString('es-UY');
  function useFuel(dt) {
    if (S.fuel <= 0) return;
    S.fuel = Math.max(0, S.fuel - S.speed * dt * FUEL_PER_M - FUEL_IDLE * dt);
    if (S.fuel <= 0) { Sfx.miss(); popup('¡Sin gasoil!', '#ff6b5e'); }
    else if (S.fuel < 20 && S.fuelWarn < 1) { S.fuelWarn = 1; popup('¡Queda poco gasoil!', '#ffb347'); }
    else if (S.fuel < 10 && S.fuelWarn < 2) { S.fuelWarn = 2; popup('¡Reserva! Cargá en la próxima estación', '#ff6b5e'); }
  }
  // Parado (o casi) junto a las bombas, carga de a poco mientras alcance la plata.
  function checkStation(dt) {
    const c = stationNear(S.dist, STATION.pumpHalf);
    const atPump = c !== undefined && Math.abs(S.busX - STATION.laneX) < 0.9 && S.speed < 1.5;
    const was = S.fueling;
    S.fueling = false;
    if (!atPump || S.fuel >= 99.9) {
      if (was) { popup(`Tanque al ${Math.round(S.fuel)}%  (-$${money(S.fuelPaid)})`, '#9be37a'); learned('estacion'); }
      if (was || !atPump) S.fuelPaid = 0;
      return;
    }
    const add = Math.min(FUEL_RATE * dt, 100 - S.fuel, S.money / FUEL_PRICE);
    if (add <= 0.001) { S.noMoney = 1; return; }
    S.noMoney = 0;
    S.fuel += add;
    S.money = Math.max(0, S.money - add * FUEL_PRICE);
    S.fuelPaid += add * FUEL_PRICE;
    S.fuelWarn = S.fuel < 10 ? 2 : S.fuel < 20 ? 1 : 0;
    S.fueling = true;
  }

  // ---------- Noche y eventos del camino (lluvia, niebla, incendios) ----------
  const headPool = Ambiente.headlightPool();
  scene.add(headPool);
  scene.add(camera);                       // la lluvia va colgada de la cámara
  let rain = null;
  const EVENTS = ['rain', 'fog', 'rain', 'fog'];
  const EVENT_TEXT = {
    rain: ['Empieza a llover', 'Calzada mojada: frená con tiempo'],
    fog: ['Niebla cerrada', 'Se ve poco: bajá la velocidad']
  };
  function updateWeather(dt) {
    const W = S.weather;
    const L = GFX_LEVELS[gfx.level];
    // Eventos: uno por vez, con 40-60 s de duración; entran y salen de a poco.
    if (mode === 'play') {
      if (!W.event && S.elapsed > W.nextAt && S.dist > TRIP_M * 0.12) {
        W.event = { type: pick(EVENTS), t: 0, dur: rand(40, 60) };
        const [a, b] = EVENT_TEXT[W.event.type];
        // La primera vez, con el consejo; después, solo el aviso chico (el HUD dice LLUVIA / NIEBLA).
        if (pista(W.event.type)) { toast(`${a}<br><small>${b}</small>`, '#cfe3ff'); learned(W.event.type); }
        else popup(a, '#cfe3ff');
      }
      if (W.event) {
        W.event.t += dt;
        // Mientras más avanza el viaje, más seguido (cerca de Chuy, casi uno atrás del otro).
        if (W.event.t > W.event.dur) { W.event = null; W.nextAt = S.elapsed + rand(50, 90) * (1 - 0.6 * S.dist / TRIP_M); }
      }
      // Incendios de campo a lo lejos, fuera de las ciudades (no con niebla: no se verían).
      if (S.dist > W.fireAt && !biomeAt(kmAt(S.dist + 400)).lights && !(W.event && W.event.type === 'fog')) {
        W.fireAt = S.dist + rand(1700, 2800);
        const side = Math.random() < 0.5 ? 1 : -1;
        const fire = Ambiente.makeFire(rand(36, 60));
        fire.position.x = side * rand(110, 170);
        addWorld(fire, S.dist + rand(420, 560), { fire: true });
        if (pista('fuego')) { popup(`Incendio de campo a lo lejos, a la ${side > 0 ? 'derecha' : 'izquierda'}`, '#ffb347'); learned('fuego'); }
      }
    }
    const want = (k) => (W.event && W.event.type === k && W.event.t < W.event.dur - 5 ? 1 : 0);
    W.rain += (want('rain') - W.rain) * Math.min(1, dt * 0.5);
    W.fog += (want('fog') - W.fog) * Math.min(1, dt * 0.4);
    if (W.rain < 0.002) W.rain = 0;
    if (W.fog < 0.002) W.fog = 0;
    // Niebla: se ve mucho menos y el color se aclara (la niebla refleja las luces).
    const dark = 1 - 0.25 * dayNight.n;                                  // de noche se ve menos lejos
    scene.fog.near = fogBase.near * dark * (1 - 0.8 * W.fog) * (1 - 0.35 * W.rain);
    scene.fog.far = fogBase.far * dark * (1 - 0.72 * W.fog) * (1 - 0.3 * W.rain);
    scene.fog.color.copy(fogCol).lerp(FOG_FOGGY, W.fog * (0.4 + 0.6 * dayNight.n));
    sky.material.uniforms.uDim.value *= 1 - 0.85 * Math.max(W.fog, W.rain * 0.7);
    // Lluvia: rayitas frente a la cámara (menos gotas en las calidades bajas) y algún relámpago.
    if (W.rain > 0) {
      if (!rain) {
        rain = Ambiente.makeRain(L.tiny ? 500 : L.short ? 1000 : 1800);
        camera.add(rain);
      }
      rain.visible = true;
      rain.userData.update(S.elapsed, 0.42 * W.rain);
      if (W.rain > 0.8 && Math.random() < dt * 0.06) W.flash = 1;
    } else if (rain) rain.visible = false;
    W.flash = Math.max(0, W.flash - dt * 3);
    hemi.intensity = hemiBase * (1 - 0.25 * W.rain) + W.flash * W.flash * 2.5;   // relámpago: un destello corto
    // Incendios: llamas y humo animados.
    for (const o of world) if (o.userData.fire) o.userData.update(S.elapsed);
  }
  const FOG_FOGGY = new THREE.Color(0x3a4352);

  // ---------- De la tarde a la noche ----------
  // Según cuánto del viaje se hizo (p): sale de tarde con el sol bajo, atardece (cielo naranja) hacia
  // la Costa de Oro y es de noche cerrada desde Ruta 9. Mientras más oscuro, más difícil.
  //   n = cuánto es de noche (0-1), ss = cuánto atardecer, k = luces prendidas.
  const smooth01 = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const dayNight = { n: -1, ss: 0, k: 0 };
  const fogCol = new THREE.Color();
  const C_SUN = new THREE.Color(0xfff1dc), C_SUNSET = new THREE.Color(0xff8a4a), C_MOON = new THREE.Color(0xa9bcff);
  const H_DAY = [new THREE.Color(0xdfeeff), new THREE.Color(0x5a7a3c)], H_NIGHT = [new THREE.Color(0x5a6f9e), new THREE.Color(0x1a2230)];
  const H_SUNSET = new THREE.Color(0xffc49a);
  function updateDayNight() {
    const p = Math.max(0, Math.min(1, S.dist / TRIP_M));
    const n = smooth01(0.16, 0.55, p);
    const ss = smooth01(0.02, 0.22, p) * (1 - smooth01(0.38, 0.56, p));
    const k = smooth01(0.22, 0.5, p);
    // Cielo.
    const u = sky.material.uniforms;
    u.uMix.value = n;
    u.uSunset.value = ss;
    u.uDim.value = 1 - 0.55 * smooth01(0.1, 0.5, p);
    const elev = (18 - 22 * smooth01(0, 0.42, p)) * Math.PI / 180;      // el sol baja de 18° a -4°
    SUN_DIR.copy(SUN_AZ).multiplyScalar(Math.cos(elev)).setY(Math.sin(elev));
    u.uSunDir.value.copy(SUN_DIR);
    // Luz principal: sol (cada vez más bajo y naranja) y, pasada la mitad de la noche, la luna.
    if (n < 0.5) {
      sun.color.copy(C_SUN).lerp(C_SUNSET, Math.min(1, ss * 1.4));
      sun.intensity = 2.6 * (1 - 2 * n);
      if (SUN_DIR.y < 0.05) SUN_DIR.setY(0.05).normalize();             // la sombra no se va al infinito
    } else {
      SUN_DIR.copy(Ambiente.MOON_DIR);
      sun.color.copy(C_MOON);
      sun.intensity = 1.2 * (2 * n - 1);
    }
    // Luz de cielo, niebla, exposición y reflejos.
    hemiBase = hemiLevel * (1 + (hemiNight - 1) * n);
    hemi.color.copy(H_DAY[0]).lerp(H_SUNSET, ss * 0.5).lerp(H_NIGHT[0], n);
    hemi.groundColor.copy(H_DAY[1]).lerp(H_NIGHT[1], n);
    fogCol.copy(FOG_DAY).lerp(FOG_SUNSET, ss).lerp(FOG_NIGHT, n);
    renderer.toneMappingExposure = 1 + 0.3 * n;
    const env = noEnv ? null : (n < 0.5 ? envs.day || envs.night : envs.night);
    if (scene.environment !== env) scene.environment = env;
    // Luces: se prenden al atardecer (solo cuando cambian, para no tocar materiales cada cuadro).
    if (Math.abs(k - dayNight.k) > 0.01 || dayNight.n < 0) {
      Ambiente.setNightLights(k);
      Models3D.setNight(k);
      headPool.material.opacity = k;
      headPool.visible = k > 0.02;
      dayNight.k = k;
    }
    dayNight.n = n;
    dayNight.ss = ss;
  }

  function finish(arrived, reason) {
    if (mode !== 'play') return;          // una sola vez por viaje (varias penalidades en el mismo cuadro)
    mode = 'ending';
    touchBrake = false;
    $('banner').classList.add('hidden');
    if (arrived) {
      Sfx.arrive();
      toast(`¡LLEGASTE A ${R.dest.toUpperCase()}!`, '#f2b705');
    } else {
      Sfx.fail();
      toast(reason === 'fuel' ? '¡Te quedaste sin gasoil!<br>Viaje terminado' : 'Los pasajeros se quejaron...<br>Viaje terminado', '#ff6b5e');
    }
    S.endReason = reason || null;
    setTimeout(() => showResult(arrived), 2300);
  }

  function frame(now) {
    const realDt = (now - last) / 1000;
    const dt = Math.min(0.05, realDt);
    last = now;
    if (!paused) update(dt);
    renderer.render(scene, camera);
    adaptGfx(realDt);
  }

  // Mide con el tiempo real entre cuadros. Después de cada cambio espera un momento (para que
  // se acomode) y recién ahí mide; si sigue por debajo del objetivo, aplica el siguiente paso.
  const fpsBox = /[?&]fps\b/.test(location.search) ? $('fps') : null;
  if (fpsBox) fpsBox.classList.remove('hidden');
  const meter = { frames: 0, time: 0, settle: 1, shown: 0, showFrames: 0 };
  function adaptGfx(realDt) {
    if (realDt <= 0 || realDt > 0.5) return;            // pestaña oculta o pausa del navegador
    if (fpsBox) {
      meter.shown += realDt;
      meter.showFrames++;
      if (meter.shown >= 0.5) {
        fpsBox.textContent = `${Math.round(meter.showFrames / meter.shown)} fps · paso ${gfx.level}: ${GFX_LEVELS[gfx.level].name}`;
        meter.shown = 0;
        meter.showFrames = 0;
      }
    }
    if (!gfx.auto || mode !== 'play' || paused) return;
    if (meter.settle > 0) { meter.settle -= realDt; return; }
    meter.frames++;
    meter.time += realDt;
    if (meter.time < 2.5) return;
    const fps = meter.frames / meter.time;
    meter.frames = 0;
    meter.time = 0;
    // Si anda sobrado 30 s seguidos, prueba un paso mejor (sirve si un tirón suelto lo dejó bajo).
    // Nunca sube a un nivel del que ya bajó en esta sesión, para no oscilar.
    meter.good = fps >= 58 ? (meter.good || 0) + 2.5 : 0;
    if (meter.good >= 30 && gfx.level > gfx.lock) {
      applyGfx(gfx.level - 1);
      saveGfx();
      meter.good = 0;
      meter.settle = 1;
      console.info(`[gráficos] ${fps.toFixed(0)} fps de sobra → paso ${gfx.level}: ${GFX_LEVELS[gfx.level].name}`);
      return;
    }
    if (fps >= GFX_TARGET || gfx.level >= GFX_LEVELS.length - 1) return;
    // Muy lejos del objetivo: baja dos pasos de una (en una PC lenta, de a uno tarda demasiado).
    applyGfx(Math.min(GFX_LEVELS.length - 1, gfx.level + (fps < GFX_TARGET * 0.5 ? 2 : 1)));
    gfx.lock = gfx.level;
    saveGfx();
    meter.settle = 1;
    console.info(`[gráficos] ${fps.toFixed(0)} fps < ${GFX_TARGET} → paso ${gfx.level}: ${GFX_LEVELS[gfx.level].name}`);
  }

  // Compila de antemano los shaders de todo lo que puede aparecer (idea de halloween.dev):
  // sin esto, la primera parada o el primer camión producen un tirón mientras se compilan.
  function prewarm() {
    const warm = new THREE.Group();
    if (Models3D.hasLetters()) warm.add(Models3D.letters('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
    const items = [
      World3D.makeCar(0xb3121b, 'sedan'), World3D.makeCar(0x1e5aa8, 'hatch'), World3D.makeCar(0xf2f2f2, 'suv'),
      World3D.makeTruck(), World3D.makeMoto(), World3D.makeStopZone(), World3D.makeShelter('km 0'),
      World3D.makePerson(), World3D.makeMate(), World3D.makeParcel(), World3D.makeKmSign(0),
      World3D.makeTerminal('X'), World3D.createWater(40), World3D.createWater(40, -1, false), World3D.makeArroyoSign("Aº", 1),
      World3D.makeLocalitySign("A"), World3D.makeWarningSign("A", "B"), World3D.makePeaje("x"), World3D.makeMountain("sierra"),
      World3D.makeMountain("panDeAzucar"), World3D.makeFortaleza(), World3D.makeDeco('pond')
    ];
    items.forEach((o, i) => { o.position.set(((i % 5) - 2) * 7, 0, -35 - Math.floor(i / 5) * 18); warm.add(o); });
    syncBlobs(warm);
    scene.add(warm);
    camera.position.set(0, 8, 18);
    camera.lookAt(0, 0, -40);
    const finishWarm = () => {
      renderer.render(scene, camera);      // un cuadro real: también compila las sombras
      scene.remove(warm);
      disposeTextures(warm);
    };
    const compile = renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve();
    return compile.then(finishWarm, finishWarm);
  }

  // ---------- HUD y mensajes ----------
  const hudCache = {};
  function setText(id, text) {
    if (hudCache[id] !== text) { hudCache[id] = text; $(id).textContent = text; }
  }

  function drawProgress() {
    const bar = $('progress');
    bar.querySelectorAll('.dot').forEach((d) => d.remove());
    S.stops.forEach((s) => {
      const d = document.createElement('div');
      d.className = 'dot' + (s.done ? ' done' : s.missed ? ' missed' : '');
      d.style.left = (s.pos / TRIP_M) * 100 + '%';
      bar.appendChild(d);
    });
  }

  function updateHud() {
    const km = Math.min(R.to, kmAt(S.dist));
    setText('hKm', `km ${km.toFixed(1)}`);
    const secs = Math.floor(S.elapsed);
    setText('hTime', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    setText('hSpeed', `${Math.round(S.speed * KMH)} km/h`);
    setText('hPax', `PASAJ. ${S.passengers}`);
    setText('hScore', `${S.score} pts`);
    setText('hMoney', `$ ${money(S.money)}`);
    const W = S.weather;
    setText('hWeather', W.fog > 0.3 ? 'NIEBLA' : W.rain > 0.3 ? 'LLUVIA' : '');
    const f = Math.ceil(S.fuel);
    if (hudCache.fuel !== f) {
      hudCache.fuel = f;
      const fill = $('hFuel');
      fill.style.width = f + '%';
      fill.style.background = f > 35 ? '#3fbf5f' : f > 15 ? '#f2b705' : '#e0453a';
      $('fuel').classList.toggle('low', f <= 15);
    }
    $('hBus').style.left = Math.min(1, S.dist / TRIP_M) * 100 + '%';
    const c = Math.round(S.confort);
    if (hudCache.confort !== c) {
      hudCache.confort = c;
      const fill = $('hConfort');
      fill.style.width = c + '%';
      fill.style.background = c > 60 ? '#3fbf5f' : c > 30 ? '#f2b705' : '#e0453a';
    }

    let msg = '';
    const next = S.stops.find((s) => !s.done && !s.missed);
    const peaje = S.marks.find((m) => m.type === 'peaje' && !m.checked);
    const peajeFirst = peaje && (!next || peaje.pos < next.pos);
    // Metros reales hasta un lugar, redondeados a 10 m (los km del tramo están estirados a TRIP_M).
    const realM = (d) => Math.max(0, Math.round((d / segAtPos(S.dist).mPerKm) * 100) * 10);
    // Semáforo adelante (el más cercano que todavía no pasamos).
    const light = S.marks.find((m) => m.type === 'semaforo' && m.obj && !m.judged && m.pos - S.dist < 220);
    // Fin de la Interbalnearia.
    const merge = PROFILE_CHANGES.find((c) => c.ahead === 'r9' && c.pos - S.dist < 500 && c.pos - S.dist > -40);
    // De contramano: si se acerca alguien por tu carril, es lo primero que se avisa.
    const headOn = contramano() && S.cars.some((c) => c.userData.oncoming && !c.userData.hit &&
      c.position.z < 0 && c.position.z > -200 && Math.abs(c.position.x - S.busX) < 2.6);
    // Estación de servicio: adelante (si falta gasoil), en el desvío y cargando.
    const st = STATIONS.find((c) => c - S.dist > -STATION.FULL && c - S.dist < 420);
    const inStation = st !== undefined && S.busX > 6.5;
    // Pistas aprendidas: volver a tu mano después del aviso, pasar el fin de la Interbalnearia.
    if (S.warnedWrongWay && !contramano()) learned('contramano');
    if (PROFILE_CHANGES.length && S.dist > PROFILE_CHANGES[0].pos + 40) learned('merge');
    if (S.fuel <= 0 && mode === 'play') {
      msg = '¡SIN GASOIL!';
    } else if (inStation && mode === 'play' && S.noMoney && Math.abs(st - S.dist) < STATION.pumpHalf) {
      msg = 'No te alcanza la plata para cargar';
    } else if (inStation && mode === 'play' && st - S.dist > -STATION.pumpHalf && pista('estacion')) {
      const d = st - S.dist;
      if (S.fueling) msg = `Cargando gasoil… ${Math.floor(S.fuel)}%  ·  -$${money(S.fuelPaid)}`;
      else if (S.fuel >= 99.9) msg = 'Tanque lleno · seguí viaje ◀';
      else if (Math.abs(d) < STATION.pumpHalf) msg = S.speed > 1.5 ? '¡FRENÁ en las bombas!' : 'Cargando…';
      else msg = `Bombas en ${realM(d)} m · frená donde brilla el piso`;
    } else if (st !== undefined && !inStation && st - S.dist > 40 && st - S.dist < 330 && S.fuel < 85 && mode === 'play' && !headOn && pista('estacion')) {
      const m = realM(st - S.dist);
      msg = `Estación de servicio a ${m >= 1000 ? kmText(m / 1000) + ' km' : m + ' m'} · ▶ desvío a la derecha`;
    } else if (headOn && mode === 'play') {
      msg = '¡VIENE UNO DE FRENTE!  Volvé a tu carril ▶';
    } else if (contramano() && !twoWay() && mode === 'play' && pista('contramano')) {
      S.warnedWrongWay = true;
      msg = '¡VAS DE CONTRAMANO!  Volvé a tu mano ▶';
    } else if (light && light.light !== 'green' && mode === 'play' && pista('semaforo')) {
      const d = light.pos - 6 - S.dist - bus.userData.len / 2;
      msg = light.light === 'yellow' ? '¡Amarillo! Frená antes de la línea'
        : S.speed < 1 ? 'Semáforo en rojo · esperá el verde' : `¡SEMÁFORO EN ROJO!  Frená (${Math.max(0, Math.round(d))} m)`;
    } else if (merge && S.busX < 0.6 && mode === 'play' && pista('merge')) {
      msg = 'Termina la Interbalnearia: pasá al carril derecho ▶';
    } else if (peajeFirst && mode === 'play' && pista('peaje')) {
      const d = peaje.pos - S.dist;
      const max = ROUTE3D_COMMON.peajeMaxKmh;
      const islands = peaje.obj ? peaje.obj.userData.islands : [];
      if (d < M_PER_KM * 4) {
        if (d < M_PER_KM * 1.5 && islands.some((ix) => Math.abs(S.busX - ix) < 1.3)) msg = '¡Elegí un carril! Hay una isleta en el medio';
        else if (d < M_PER_KM * 1.5 && S.speed * KMH > max) msg = `¡FRENÁ!  Peaje a ${max} km/h`;
        else msg = `Peaje ${peaje.name} en ${realM(d)} m · máx. ${max} km/h`;
      }
    } else if (next && mode === 'play' && pista('parada')) {
      const d = next.pos - S.dist;
      if (d < M_PER_KM * 4) {   // aviso con tiempo: frenar un ómnibus lleva ~40 m
        const inZone = next.zone && Math.abs(next.zone.position.z) < 14;
        if (inZone && Math.abs(S.busX - LANE_X[RIGHT]) >= 0.5) msg = '¡CARRIL DERECHO! ▶';
        else if (inZone && S.speed > STOP_SPEED) msg = '¡FRENÁ donde brilla el piso!  (20 km/h o menos)';
        else msg = `${next.name} en ${realM(d)} m · frená en la luz, carril derecho`;
      }
    }
    if (hudCache.banner !== msg) {
      hudCache.banner = msg;
      $('banner').textContent = msg;
      $('banner').classList.toggle('hidden', !msg);
    }
  }

  // ---------- Pistas para el jugador ----------
  // Los carteles que explican qué hacer (parada, estación, peaje, semáforo, contramano...) salen solo
  // hasta que el jugador lo hizo una vez en esa PC/celular. Los avisos de peligro (viene uno de frente,
  // sin gasoil) salen siempre. ?pistas en la dirección las vuelve a mostrar.
  const HINTS_KEY = 'cot-ruta-3d-pistas';
  let hints = {};
  try { hints = /[?&]pistas\b/.test(location.search) ? {} : JSON.parse(localStorage.getItem(HINTS_KEY) || '{}') || {}; } catch (e) { hints = {}; }
  const pista = (key) => !hints[key];
  function learned(key) {
    if (hints[key]) return;
    hints[key] = 1;
    try { localStorage.setItem(HINTS_KEY, JSON.stringify(hints)); } catch (e) { /* no se recuerda */ }
  }

  function popup(text, color) {
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    el.style.color = color;
    // Si salen varios juntos (choque + encomienda), se apilan en vez de pisarse.
    const n = document.querySelectorAll('.popup').length;
    if (n) el.style.marginTop = `${n * 34}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  let toastTimer = 0;
  function toast(html, color) {
    const el = $('toast');
    el.innerHTML = html;
    el.style.color = color;
    el.style.opacity = 1;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.transition = 'opacity 0.4s'; el.style.opacity = 0; }, 2000);
    el.style.transition = 'none';
  }

  function flash() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;background:rgba(255,80,60,0.45);pointer-events:none;transition:opacity 0.25s';
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = 0; });
    setTimeout(() => el.remove(), 300);
  }

  // ---------- Pantallas ----------
  function show(id, on) { $(id).classList.toggle('hidden', !on); }

  // Muestra el ranking online si ya se descargó (RankingOnline.cache); si no, el de esta PC.
  // highlight: posición en el ranking local, o { id } de un viaje del ranking online.
  function rankTable(el, highlight, max) {
    const online = RankingOnline.cache && RankingOnline.cache.length ? RankingOnline.cache : null;
    const list = online
      ? online.slice(0, max).map((r) => ({ id: r.id, name: r.nombre, company: r.empresa, score: r.puntos }))
      : Ranking.load().slice(0, max);
    el.innerHTML = '';
    if (!list.length) return;
    const cap = el.createCaption();
    cap.textContent = online ? `RANKING ONLINE · ${R.origin} → ${R.dest}`
      : `${max <= 5 ? 'MEJORES VIAJES' : 'RANKING'} · ${R.origin} → ${R.dest}`;
    list.forEach((r, i) => {
      const tr = el.insertRow();
      const me = online ? highlight && highlight.id != null && r.id === highlight.id : i === highlight;
      if (me) tr.className = 'me';
      const c1 = tr.insertCell();
      c1.textContent = `${i + 1}. ${r.name} `;
      const co = COMPANIES.find((c) => c.id === r.company);
      if (co) { const sp = document.createElement('span'); sp.className = 'co'; sp.textContent = co.name; c1.appendChild(sp); }
      tr.insertCell().textContent = r.score;
    });
  }

  function goTitle() {
    mode = 'title';
    paused = false;
    clearWorld();
    S = newRun(true);
    resetDecos();
    show('hud', false); show('touch', false); show('banner', false); show('resultScreen', false); show('pauseScreen', false);
    show('bPause', false);
    renderTitle();
    show('titleScreen', true);
    $('toast').style.opacity = 0;
  }

  const TIPS = [
    'Pasá los peajes a 40 km/h o menos, por tu carril.',
    'En los semáforos de las salidas frená antes de la línea y esperá el verde.',
    'Ruta 9 tiene un carril por mano: para pasar a un camión salí al carril de enfrente cuando no venga nadie.',
    'Los pasajes y las encomiendas dan plata. Con esa plata cargás gasoil: si te quedás sin, se termina el viaje.',
    'Para cargar gasoil, entrá al desvío de la estación de servicio (a la derecha) y frená en las bombas.',
    'Con lluvia el ómnibus frena peor, y con niebla se ve poco: andá más despacio.'
  ];
  let tipIdx = Math.floor(Math.random() * TIPS.length);
  function renderTitle() {
    tipIdx = (tipIdx + 1) % TIPS.length;
    $('titleTip').textContent = TIPS[tipIdx];
    // Textos según cómo se juega: teclado, botones en pantalla o celular como volante.
    $('titleHelp').innerHTML = !touchUI ? '← → tocá para cambiar de carril, mantené para moverte de a poco<br>↓ / ESPACIO frenar'
      : control === 'tilt' ? 'Incliná el celular como un volante para cambiar de carril<br>FRENO para frenar'
      : '◀ ▶ tocá para cambiar de carril, mantené para moverte de a poco<br>FRENO para frenar';
    $('titlePrompt').textContent = touchUI ? 'Tocá el viaje para salir' : 'Apretá ESPACIO para salir';
    $('titleControl').textContent = `CONTROLES: ${control === 'tilt' ? 'INCLINACIÓN' : 'BOTONES'}`;
    $('titleSkin').textContent = skinButtonText();
    show('titleSkin', company().skins.length > 1);
    $('titlePlayer').textContent = player.chosen ? `${player.name} · ${company().name.toUpperCase()} (CAMBIAR)` : 'ELEGÍ NOMBRE Y EMPRESA';
    show('titleControl', touchUI);
    const box = $('tramos');
    box.innerHTML = '';
    // Un solo viaje: tocarlo sale directo (modo kiosco: un solo toque).
    const b = document.createElement('button');
    b.className = 'tramo on';
    b.innerHTML = '<b>Viaje completo</b><span>Tres Cruces → Chuy · Interbalnearia y Ruta 9</span>';
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (mode === 'title') startGame();
    });
    box.appendChild(b);
    rankTable($('titleRank'), -1, 5);
    // Ranking online: se actualiza en cuanto llega (y de paso manda viajes que quedaron pendientes).
    RankingOnline.flush().then(() => RankingOnline.top(10)).then((list) => {
      if (list && mode === 'title') rankTable($('titleRank'), -1, 5);
    });
  }

  function startGame() {
    // En el celular, la primera vez se elige cómo manejar y después se sale.
    if (!player.chosen) { openPlayer(startGame); return; }
    if (touchUI && !controlChosen) { openControls(startGame); return; }
    Sfx.unlock();
    Sfx.click();
    clearWorld();
    S = newRun(false);
    steer.dir = 0;
    resetDecos();
    Object.keys(hudCache).forEach((k) => delete hudCache[k]);
    show('titleScreen', false); show('hud', true); show('touch', touchUI); show('bPause', touchUI);
    $('touch').classList.toggle('tilt', control === 'tilt');
    $('pauseHint').textContent = touchUI ? 'Tocá afuera para seguir' : 'P para seguir · R para reiniciar';
    if (touchUI) goFullscreen();
    if (control === 'tilt') {
      tilt.calib = true;                    // el volante se centra como lo tenga al salir
      tilt.idle = 0;
      setTimeout(checkSensor, 2000);
    }
    drawProgress();
    meter.frames = 0; meter.time = 0; meter.settle = 1.5;
    mode = 'play';
    toast(`¡Buen viaje!<br>Destino: ${R.dest}`, '#ffffff');
  }

  let canLeave = false;
  function showResult(arrived) {
    mode = 'result';
    show('hud', false); show('touch', false); show('banner', false); show('bPause', false);
    const mins = Math.floor(S.elapsed / 60);
    const secs = String(Math.floor(S.elapsed % 60)).padStart(2, '0');
    const stopsDone = S.stops.filter((s) => s.done).length;
    const confort = Math.round(S.confort);
    $('rTitle').textContent = arrived ? '¡LLEGASTE!' : S.endReason === 'fuel' ? 'SIN GASOIL' : 'VIAJE TERMINADO';
    $('rTitle').style.color = arrived ? '#f2b705' : '#ff6b5e';
    // Km recorridos: suma de lo hecho en cada segmento (sin el salto de km de Pan de Azúcar).
    const kmDone = SEGS.reduce((a, g) => a + Math.max(0, Math.min(g.to, kmAt(Math.min(S.dist, g.p1 - 0.01))) - g.from) * (S.dist > g.p0 ? 1 : 0), 0);
    $('rStats').textContent = `${R.origin} → ${R.dest} · ${kmDone.toFixed(1)} km en ${mins}:${secs} · Paradas ${stopsDone}/${S.stops.length} · Choques ${S.crashes}${S.repairs ? ` (arreglos $ ${money(S.repairs)})` : ''}`;
    const rows = [
      [`Pasajeros (${S.passengers} × 100)`, S.passengers * 100],
      [`Encomiendas (${S.boxes} × 50)`, S.boxes * 50]
    ];
    if (arrived) {
      rows.push(['Llegada a destino', 500]);
      rows.push(['Puntualidad', Math.max(0, Math.round((TARGET_TIME - S.elapsed) * 20))]);
      rows.push([`Confort (${confort}% × 5)`, confort * 5]);
      rows.push([`Plata en caja ($ ${money(S.money)} ÷ 10)`, Math.round(S.money / 10)]);
    }
    const total = rows.reduce((a, r) => a + r[1], 0);
    const table = $('rRows');
    table.innerHTML = '';
    rows.forEach(([label, pts]) => {
      const tr = table.insertRow();
      tr.insertCell().textContent = label;
      tr.insertCell().textContent = pts;
    });
    $('rTotal').textContent = `${total} PUNTOS`;
    $('rRank').innerHTML = '';
    show('rPrompt', false);
    show('resultScreen', true);
    canLeave = false;

    const done = (highlight) => {
      rankTable($('rRank'), highlight, 10);
      show('rPrompt', true);
      setTimeout(() => { canLeave = true; }, 700);
      clearTimeout(showResult.timer);
      showResult.timer = setTimeout(() => { if (mode === 'result') leaveResult(); }, 25000);
    };
    if (Ranking.qualifies(total)) done(Ranking.add(player.name || 'JUGADOR', total, player.company));
    else done(-1);
    // Ranking online: se manda el viaje y, cuando vuelve, se muestra el top con este viaje resaltado.
    RankingOnline.add(player.name || 'JUGADOR', player.company, total, kmDone, arrived)
      .then((id) => RankingOnline.top(10).then((list) => {
        if (list && mode === 'result') rankTable($('rRank'), { id }, 10);
      }));
  }

  // Después de cada viaje vuelve al título y pide el próximo jugador (el anterior queda cargado).
  function leaveResult() {
    goTitle();
    openPlayer(null);
  }

  function togglePause() {
    if (mode !== 'play') return;
    paused = !paused;
    show('pauseScreen', paused);
  }

  // Menú de pausa: seguir, reiniciar el viaje (mismo jugador), cambiar nombre/empresa/ómnibus y
  // reiniciar, o salir al título. Reiniciar no anota nada en el ranking.
  function restartTrip() {
    paused = false;
    show('pauseScreen', false);
    mode = 'title';                       // startGame espera venir del título
    startGame();
  }
  function pauseMenu(id, fn) {
    $(id).addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
    $(id).addEventListener('click', (e) => { e.stopPropagation(); if (paused && mode === 'play') { Sfx.click(); fn(); } });
  }
  pauseMenu('pResume', togglePause);
  pauseMenu('pRestart', restartTrip);
  pauseMenu('pPlayer', () => {
    show('pauseScreen', false);
    openPlayer(restartTrip);              // al confirmar, viaje nuevo con el jugador y el ómnibus elegidos
  });
  pauseMenu('pQuit', () => { paused = false; goTitle(); });

  // Dirección: un toque cambia de carril completo; mantener apretado mueve el ómnibus de a poco
  // y al soltar se queda donde está (también entre dos carriles).
  const TAP_TIME = 0.22;                // más que esto apretado ya es "mantener"
  const steer = { dir: 0, held: 0 };
  const clampX = (x) => { const l = busLanes(); return Math.max(l[0], Math.min(l[l.length - 1], x)); };

  function nextLaneX(x, dir) {
    const lanes = busLanes();
    if (dir > 0) return lanes.find((l) => l > x + 0.4) ?? lanes[lanes.length - 1];
    return [...lanes].reverse().find((l) => l < x - 0.4) ?? lanes[0];
  }

  function steerPress(dir) {
    if (mode !== 'play' || paused) return;
    steer.dir = dir;
    steer.held = 0;
    S.targetX = nextLaneX(S.targetX, dir);
  }

  function steerRelease(dir) {
    if (steer.dir !== dir) return;
    if (steer.held > TAP_TIME && mode === 'play') {
      // Se frena el movimiento lateral donde soltó, con un poco de anticipación por la inercia.
      S.targetX = clampX(S.busX + S.latV * 0.35);
    }
    steer.dir = 0;
  }

  function updateSteer(dt) {
    if (!steer.dir) return;
    steer.held += dt;
    if (steer.held > TAP_TIME) S.targetX = clampX(S.busX + steer.dir * 1.2);
  }

  // ---------- Jugador: nombre y empresa ----------
  // Al entrar, el jugador pone su nombre (va al ranking) y elige empresa. La empresa define el ómnibus:
  // si tiene más de una skin, el botón ÓMNIBUS del título alterna entre las suyas.
  const SKINS = World3D.SKINS;
  const COMPANIES = [
    { id: 'cot', name: 'COT', color: '#f26b1d', skins: ['cot_mejorada'] },
    { id: 'rutas_del_sol', name: 'Rutas del Sol', color: '#1f6fd1', skins: ['rutas_del_sol'] },
    { id: 'cynsa', name: 'CYNSA', color: '#e0301e', skins: ['cynsa'] }
  ].map((c) => ({ ...c, skins: c.skins.filter((id) => SKINS.some((s) => s.id === id && s.available)) }))
    .filter((c) => c.skins.length);
  const PLAYER_KEY = 'cot-ruta-3d-player';
  const SKINS_V = 2;   // 2: COT 1° Clase (cot_mejorada) pasa a ser la de COT por defecto
  const player = { name: '', company: COMPANIES[0].id, skin: COMPANIES[0].skins[0], chosen: false };
  try {
    const saved = JSON.parse(localStorage.getItem(PLAYER_KEY) || 'null');
    if (saved) {
      player.name = String(saved.name || '').slice(0, 12);
      if (COMPANIES.some((c) => c.id === saved.company)) player.company = saved.company;
      const co = COMPANIES.find((c) => c.id === player.company);
      // SKINS_V sube cuando cambia el ómnibus por defecto de una empresa: la elección guardada
      // de antes se descarta una vez, así todos ven la skin nueva (después se puede volver con ÓMNIBUS).
      player.skin = saved.v === SKINS_V && co.skins.includes(saved.skin) ? saved.skin : co.skins[0];
    }
  } catch (e) { /* sin almacenamiento: se arranca de cero */ }
  const company = () => COMPANIES.find((c) => c.id === player.company) || COMPANIES[0];
  const savePlayer = () => {
    try { localStorage.setItem(PLAYER_KEY, JSON.stringify({ name: player.name, company: player.company, skin: player.skin, v: SKINS_V })); } catch (e) { /* no se recuerda */ }
  };
  let afterPlayer = null;

  function renderCompanies() {
    const box = $('companies');
    box.innerHTML = '';
    COMPANIES.forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'choice' + (c.id === player.company ? ' on' : '');
      btn.innerHTML = `<b>${c.name}</b><i style="background:${c.color}"></i>`;
      btn.addEventListener('click', () => pickCompany(c.id));
      box.appendChild(btn);
    });
  }
  function pickCompany(id) {
    if (id !== player.company) {
      player.company = id;
      player.skin = company().skins[0];
    }
    if (bus) bus.userData.setSkin(player.skin);
    Sfx.unlock();
    Sfx.click();
    renderCompanies();
  }
  function openPlayer(next) {
    afterPlayer = next;
    $('playerName').value = player.name;
    $('playerName').classList.remove('bad');
    renderCompanies();
    show('playerBox', true);
    if (!touchUI) setTimeout(() => { $('playerName').focus(); $('playerName').select(); }, 50);
  }
  function confirmPlayer() {
    const name = $('playerName').value.trim().toUpperCase().slice(0, 12);
    if (!name) { $('playerName').classList.add('bad'); $('playerName').focus(); Sfx.miss(); return; }
    player.name = name;
    player.chosen = true;
    savePlayer();
    $('playerName').blur();
    Sfx.unlock();
    Sfx.click();
    show('playerBox', false);
    if (bus) bus.userData.setSkin(player.skin);
    renderTitle();
    const next = afterPlayer;
    afterPlayer = null;
    if (next) next();
  }
  $('playerOk').addEventListener('click', confirmPlayer);
  // El Enter del nombre solo confirma: no tiene que llegar al juego (si no, arrancaría el viaje).
  $('playerName').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') confirmPlayer(); });
  $('playerName').addEventListener('input', () => $('playerName').classList.remove('bad'));
  $('playerBox').addEventListener('pointerdown', (e) => e.stopPropagation());
  $('titlePlayer').addEventListener('pointerdown', (e) => { e.stopPropagation(); if (mode === 'title') openPlayer(null); });

  // Botón del título: solo si la empresa tiene más de un ómnibus (hoy cada una tiene uno).
  function skinButtonText() {
    const s = SKINS.find((k) => k.id === player.skin) || SKINS[0];
    return `ÓMNIBUS: ${s.name.toUpperCase()}${touchUI ? '' : ' (O)'}`;
  }
  function cycleSkin() {
    const list = company().skins;
    if (list.length < 2) return;
    player.skin = list[(list.indexOf(player.skin) + 1) % list.length];
    savePlayer();
    if (bus) bus.userData.setSkin(player.skin);
    Sfx.unlock();
    Sfx.click();
    $('titleSkin').textContent = skinButtonText();
  }
  $('titleSkin').addEventListener('pointerdown', (e) => { e.stopPropagation(); if (mode === 'title') cycleSkin(); });

  // ---------- Controles en el celular: botones o inclinación ----------
  // Al entrar desde un celular se elige cómo manejar. Con "inclinación" el celular es el volante:
  // se mide hacia dónde queda "arriba" (la gravedad) en el plano de la pantalla, así anda parado,
  // acostado o un poco recostado. Inclinado, el ómnibus se corre de a poco hacia ese lado; derecho,
  // se acomoda solo en el carril más cercano (así es fácil quedar justo en la parada).
  const CONTROL_KEY = 'cot-ruta-3d-control';
  const TILT_DEAD = 4, TILT_FULL = 24;     // grados: zona muerta y giro máximo
  const TILT_HYST = 1.5;                   // grados: para salir de la zona muerta hay que pasarla por esto
  const TILT_SMOOTH = 0.12;                // s: suavizado del sensor (saca el temblor de la mano)
  let control = 'buttons', controlChosen = false, afterControl = null;
  try { if (localStorage.getItem(CONTROL_KEY) === 'tilt') control = 'tilt'; } catch (e) { /* se usan botones */ }
  const tilt = { raw: null, zero: 0, sign: 0, seen: 0, idle: 0, calib: false, shown: 999, listening: false };

  function onMotion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x === null || g.y === null) return;
    tilt.seen = performance.now();
    // Pasar del sistema del celular al de la pantalla (si está acostado, la pantalla está girada).
    const so = screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : (window.orientation || 0);
    const a = (so * Math.PI) / 180;
    let X = g.x * Math.cos(a) - g.y * Math.sin(a);
    let Y = g.x * Math.sin(a) + g.y * Math.cos(a);
    let Z = g.z || 0;
    // Algunos celulares dan la gravedad con el signo al revés: se detecta con el celular derecho
    // (o, si está muy acostado, con la pantalla hacia arriba).
    if (!tilt.sign && Math.abs(Y) > 4) tilt.sign = Y < 0 ? -1 : 1;
    else if (!tilt.sign && Math.abs(Z) > 4) tilt.sign = Z < 0 ? -1 : 1;
    if (!tilt.sign) return;
    X *= tilt.sign;
    Y *= tilt.sign;
    Z *= tilt.sign;
    // Giro tipo volante, sin importar cuánto esté echado hacia atrás el celular. Antes era
    // atan2(-X, Y): con el celular en vertical pero inclinado hacia atrás (como se lo mira), Y es
    // chico y cualquier temblor de la mano se multiplicaba (el ómnibus temblaba y se pasaba de carril).
    const back = Math.hypot(Y, Z);
    if (Math.hypot(X, back) < 5) return;     // dato raro (golpe, sacudón)
    const deg = (Math.atan2(-X, back) * 180) / Math.PI;
    // Filtro por tiempo (no por cantidad de eventos: cada celular manda a otra frecuencia).
    const now = performance.now();
    const dt = tilt.t ? Math.min(0.1, (now - tilt.t) / 1000) : 0.016;
    tilt.t = now;
    tilt.raw = tilt.raw === null ? deg : tilt.raw + (deg - tilt.raw) * (1 - Math.exp(-dt / TILT_SMOOTH));
  }

  const nearestLane = (x) => busLanes().reduce((b, l) => (Math.abs(l - x) < Math.abs(b - x) ? l : b), LANE_X[0]);

  function updateTilt(dt) {
    if (tilt.raw === null) return;
    if (tilt.calib) { tilt.zero = Math.max(-30, Math.min(30, tilt.raw)); tilt.calib = false; }
    const a = tilt.raw - tilt.zero, m = Math.abs(a);
    // Zona muerta con histéresis: entra a girar pasando DEAD + HYST y deja de girar bajo DEAD.
    // Así, con el celular cerca del borde, no alterna entre "girar" y "volver al carril".
    tilt.steering = m > TILT_DEAD + (tilt.steering ? 0 : TILT_HYST);
    if (tilt.steering) {
      const v = Math.sign(a) * Math.min(1, (m - TILT_DEAD) / (TILT_FULL - TILT_DEAD));
      // El objetivo avanza de a poco hacia el costado (no se recalcula desde la posición del
      // ómnibus en cada cuadro, que hacía que el ruido del sensor llegara directo al volante).
      const base = Math.abs(S.targetX - S.busX) > 2 ? S.busX : S.targetX;
      S.targetX = clampX(base + v * 4.5 * dt);
      tilt.idle = 0;
    } else if ((tilt.idle += dt) > 0.25) {
      S.targetX = nearestLane(S.busX + S.latV * 0.3);
    }
    // El volante dibujado gira como el celular.
    const r = Math.round(Math.max(-90, Math.min(90, a)));
    if (r !== tilt.shown) { tilt.shown = r; $('wheel').firstElementChild.style.transform = `rotate(${r}deg)`; }
  }

  // Si a los 2 s de salir no llegó ningún dato del sensor, se pasa a botones.
  function checkSensor() {
    if (mode !== 'play' || control !== 'tilt' || performance.now() - tilt.seen < 1500) return;
    control = 'buttons';
    $('touch').classList.remove('tilt');
    toast('Este celular no manda datos del sensor:<br>usá los botones', '#ffd36b');
  }

  function askMotion() {
    const DM = window.DeviceMotionEvent;
    if (!DM) return Promise.resolve(false);
    // iPhone: hay que pedir permiso, y solo se puede al tocar un botón.
    if (typeof DM.requestPermission === 'function') return DM.requestPermission().then((r) => r === 'granted', () => false);
    return Promise.resolve(true);
  }

  function openControls(next) {
    afterControl = next;
    $('cButtons').classList.toggle('last', control === 'buttons');
    $('cTilt').classList.toggle('last', control === 'tilt');
    show('controlBox', true);
  }

  function chooseControl(kind) {
    Sfx.unlock();
    Sfx.click();
    const done = (k, note) => {
      control = k;
      controlChosen = true;
      try { localStorage.setItem(CONTROL_KEY, k); } catch (e) { /* no se recuerda */ }
      show('controlBox', false);
      renderTitle();
      if (note) toast(note, '#ffd36b');
      const next = afterControl;
      afterControl = null;
      if (next) next();
    };
    if (kind !== 'tilt') { done('buttons'); return; }
    askMotion().then((ok) => {
      if (!ok) { done('buttons', 'No hay permiso para el sensor:<br>vas con botones'); return; }
      if (!tilt.listening) { window.addEventListener('devicemotion', onMotion); tilt.listening = true; }
      done('tilt');
    });
  }

  // Pantalla completa en el celular (y con el celular de volante, que no se dé vuelta la imagen).
  function goFullscreen() {
    const el = document.documentElement;
    if (document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen({ navigationUI: 'hide' }).then(() => {
      if (control === 'tilt' && screen.orientation && screen.orientation.lock) screen.orientation.lock(screen.orientation.type).catch(() => {});
    }, () => { /* el navegador no lo permite: se sigue igual */ });
  }

  $('cButtons').addEventListener('click', () => chooseControl('buttons'));
  $('cTilt').addEventListener('click', () => chooseControl('tilt'));
  $('titleControl').addEventListener('pointerdown', (e) => { e.stopPropagation(); if (mode === 'title') openControls(null); });
  $('wheel').addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (tilt.raw === null) return;
    tilt.zero = tilt.raw;
    popup('Volante centrado', '#ffffff');
  });
  $('bPause').addEventListener('pointerdown', (e) => { e.preventDefault(); togglePause(); });
  // Si se cambia de app o se apaga la pantalla, el juego queda en pausa.
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play' && !paused) togglePause(); });

  // ---------- Entrada ----------
  // Mientras se escribe el nombre (o está abierta la pantalla del jugador) el juego no toma las teclas.
  const typing = () => (document.activeElement && document.activeElement.tagName === 'INPUT') || !$('playerBox').classList.contains('hidden');

  // Los botones en pantalla solo aparecen en dispositivos táctiles.
  let touchUI = window.matchMedia('(pointer: coarse)').matches;
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !touchUI) {
      touchUI = true;
      if (mode === 'play') { show('touch', true); show('bPause', true); }
      if (mode === 'title') renderTitle();
    }
  }, true);

  window.addEventListener('keydown', (e) => {
    if (typing()) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space'].includes(e.code)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') steerPress(-1);
    if (e.code === 'ArrowRight' || e.code === 'KeyD') steerPress(1);
    if (e.code === 'KeyH') Sfx.horn();
    if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
    else if (e.code === 'KeyR' && paused && mode === 'play') restartTrip();
    const confirm = e.code === 'Space' || e.code === 'Enter';
    if (mode === 'title' && e.code === 'KeyO') cycleSkin();
    if (confirm && mode === 'title') startGame();
    else if (confirm && mode === 'result' && canLeave) leaveResult();
    // Para el organizador del evento: Shift + B borra el ranking.
    if (e.code === 'KeyB' && e.shiftKey && mode === 'title' && window.confirm('¿Borrar todo el ranking?')) {
      Ranking.clear();
      rankTable($('titleRank'), -1, 5);
    }
  });
  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') steerRelease(-1);
    if (e.code === 'ArrowRight' || e.code === 'KeyD') steerRelease(1);
  });
  window.addEventListener('blur', () => { keys.clear(); touchBrake = false; steerRelease(steer.dir); });

  $('titleScreen').addEventListener('pointerdown', () => { if (mode === 'title') startGame(); });
  $('resultScreen').addEventListener('pointerdown', () => { if (mode === 'result' && canLeave) leaveResult(); });
  // Tocar afuera del menú también sigue (los botones del menú no llegan acá).
  $('pauseScreen').addEventListener('pointerdown', (e) => { if (e.target === $('pauseScreen')) togglePause(); });

  const hold = (el, down, up) => {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); down(); });
    if (up) ['pointerup', 'pointerleave', 'pointercancel'].forEach((t) => el.addEventListener(t, up));
  };
  hold($('bLeft'), () => steerPress(-1), () => steerRelease(-1));
  hold($('bRight'), () => steerPress(1), () => steerRelease(1));
  hold($('bBrake'), () => { touchBrake = true; }, () => { touchBrake = false; });

  // ---------- Arranque ----------
  const modelsReady = Models3D.load();
  bus = World3D.loadBus((root) => {
    scene.add(root);
    syncBlobs(root);
    root.userData.setSkin(player.skin);
    $('loading').textContent = 'Preparando gráficos…';
    // Con los modelos del pack listos, la decoración se rearma con ellos.
    modelsReady.then(() => {
      Object.keys(decoSets).forEach((k) => delete decoSets[k]);
      Object.keys(decoPools).forEach((k) => delete decoPools[k]);
      buildDecos();
      resetDecos();
      applyGfx(gfx.level);
    })
    // Se espera un cuadro para que se vea el mensaje antes de compilar.
    .then(() => new Promise((res) => requestAnimationFrame(res))).then(() => prewarm().then(() => {
      $('loading').remove();
      goTitle();
      // Lo primero: nombre y empresa; en el celular, después, cómo manejar.
      openPlayer(touchUI ? () => openControls(null) : null);
      renderer.setAnimationLoop(frame);
    }));
  });
  createDecos();
  setupRoute();
  S = newRun(true);
  resetDecos();
  applyGfx(gfx.level);

  // Para depurar desde la consola.
  window.game3d = {
    get state() { return S; }, get mode() { return mode; }, get gfx() { return { ...gfx, name: GFX_LEVELS[gfx.level].name }; },
    scene, camera, renderer, TRIP_M, applyGfx, get route() { return R; }, SEGS, profileAt, step: (dt) => update(dt),
    kmAt, posAt, resetDecos, headingAt, heightAt, get tilt() { return { ...tilt, control }; }
  };
})();
