// Ambiente del viaje: la noche (cielo con estrellas y luna, luces de autos y faroles) y los eventos
// del camino (lluvia, niebla e incendios de campo a lo lejos). Todo pensado para celulares de gama
// media: texturas chicas hechas con canvas, un solo dibujo por efecto y nada de luces reales extra
// (las luces son "manchas" que suman brillo: aditivas).
// Global `Ambiente`. Cargar después de bend3d.js y antes de world3d.js.
const Ambiente = (() => {
  // La luna (y la luz de luna) viene de adelante a la izquierda, alta.
  const MOON_DIR = new THREE.Vector3(-0.42, 0.62, -0.66).normalize();

  function canvas(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
  }

  // ---------- Cielo de noche (equirectangular, como la foto del cielo de día) ----------
  function nightSky() {
    const W = 2048, H = 1024;
    // Semilla fija: el mismo cielo en todas las partidas.
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const c = canvas(W, H, (g) => {
      const sky = g.createLinearGradient(0, 0, 0, H / 2);
      sky.addColorStop(0, '#03060f');
      sky.addColorStop(0.55, '#0a1328');
      sky.addColorStop(0.9, '#1a2747');
      sky.addColorStop(1, '#2b3550');           // horizonte: un poco de luz de los pueblos
      g.fillStyle = sky;
      g.fillRect(0, 0, W, H / 2);
      g.fillStyle = '#0b0f17';                   // debajo del horizonte (casi no se ve: hay pasto)
      g.fillRect(0, H / 2, W, H / 2);
      // Vía Láctea: una franja inclinada de bruma clara.
      for (let i = 0; i < 2600; i++) {
        const t = rnd();
        const x = t * W;
        const y = H * (0.12 + 0.22 * Math.sin(t * Math.PI * 2 + 0.6)) + (rnd() - 0.5) * 90;
        if (y > H / 2 - 20) continue;
        g.fillStyle = `rgba(190,200,255,${0.02 + rnd() * 0.04})`;
        g.beginPath();
        g.arc(x, y, 6 + rnd() * 18, 0, Math.PI * 2);
        g.fill();
      }
      // Estrellas: más arriba, más estrellas (cerca del horizonte las tapa la bruma).
      for (let i = 0; i < 5200; i++) {
        const x = rnd() * W;
        const y = Math.pow(rnd(), 1.35) * (H / 2 - 16);
        const big = rnd();
        const r = big > 0.985 ? 1.6 : big > 0.9 ? 1.05 : 0.6;
        const a = (0.35 + rnd() * 0.65) * (1 - 0.6 * y / (H / 2));
        const tint = rnd();
        g.fillStyle = tint > 0.9 ? `rgba(255,214,170,${a})` : tint > 0.8 ? `rgba(170,200,255,${a})` : `rgba(255,255,255,${a})`;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
      // Luna (donde está MOON_DIR en la proyección equirectangular de three.js).
      const u = Math.atan2(MOON_DIR.z, MOON_DIR.x) / (2 * Math.PI) + 0.5;
      const v = Math.asin(MOON_DIR.y) / Math.PI + 0.5;
      const mx = u * W, my = (1 - v) * H;
      const halo = g.createRadialGradient(mx, my, 10, mx, my, 120);
      halo.addColorStop(0, 'rgba(220,230,255,0.35)');
      halo.addColorStop(1, 'rgba(220,230,255,0)');
      g.fillStyle = halo;
      g.fillRect(mx - 120, my - 120, 240, 240);
      g.fillStyle = '#f4f1e6';
      g.beginPath();
      g.arc(mx, my, 13, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(160,160,150,0.35)';     // manchas de la luna
      [[-4, -3, 4], [4, 3, 3], [-2, 5, 2.5]].forEach(([dx, dy, r]) => { g.beginPath(); g.arc(mx + dx, my + dy, r, 0, Math.PI * 2); g.fill(); });
    });
    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---------- Manchas de luz (aditivas) ----------
  const glowCanvas = (inner, outer, soft = 0.45) => canvas(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, inner);
    r.addColorStop(soft, outer);
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });
  const GLOW = new THREE.CanvasTexture(glowCanvas('rgba(255,255,255,1)', 'rgba(255,255,255,0.25)'));
  GLOW.colorSpace = THREE.SRGBColorSpace;
  const additive = (opts) => new THREE.MeshBasicMaterial({
    map: GLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, ...opts
  });
  // Mancha de luz sobre el piso (faroles, estación de servicio, refugios).
  const POOL_MAT = additive({ color: 0x5c4a2a, fog: true });
  const LAMP_MAT = additive({ color: 0xffd9a0, fog: false });

  // Faros del ómnibus: dos haces sobre el asfalto, de 6 a 55 m adelante.
  function headlightPool() {
    const tex = new THREE.CanvasTexture(canvas(64, 256, (g, w, h) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      // Cono que se abre hacia adelante (arriba en la textura) y se apaga a lo lejos.
      for (let y = 0; y < h; y++) {
        // y = 0 es la fila de abajo de la textura, que queda pegada al ómnibus.
        const t = y / h;                            // 0 cerca, 1 lejos
        const half = (0.3 + 0.7 * Math.sqrt(t)) * w / 2;
        // Entra suave delante del ómnibus, es fuerte a unos metros y se apaga de a poco a lo lejos
        // (sin borde: en la última fila ya vale 0).
        const a = Math.min(1, (y + 4) / 22) * Math.pow(1 - t, 1.1);
        const grad = g.createLinearGradient(w / 2 - half, 0, w / 2 + half, 0);
        grad.addColorStop(0, 'rgba(255,240,210,0)');
        grad.addColorStop(0.5, `rgba(255,240,210,${a})`);
        grad.addColorStop(1, 'rgba(255,240,210,0)');
        g.fillStyle = grad;
        g.fillRect(0, h - 1 - y, w, 1);
      }
    }));
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(10, 50, 1, 10).rotateX(-Math.PI / 2);
    geo.translate(0, 0.06, -31);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: tex, color: 0xc8bca2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false
    }));
    m.renderOrder = 3;
    m.frustumCulled = false;
    return m;
  }

  // Luces de un auto, camión o moto: faros blancos adelante (-Z) y rojos atrás (+Z).
  // Una sola malla por vehículo (cuatro cuadrados con colores por vértice), compartida por tamaño.
  const lightGeos = {};
  const CAR_LIGHT_MAT = new THREE.MeshBasicMaterial({
    map: GLOW, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false
  });
  function carLights(car) {
    const u = car.userData;
    if (!u.hw || !u.hl) return;
    const key = `${u.hw.toFixed(2)}|${u.hl.toFixed(2)}`;
    if (!lightGeos[key]) {
      const pos = [], uv = [], col = [];
      const quad = (x, y, z, s, facing, r, g, b) => {
        const h = s / 2;
        const pts = [[-h, -h], [h, -h], [h, h], [-h, h]];
        const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
        [0, 1, 2, 0, 2, 3].forEach((i) => {
          pos.push(x + pts[i][0] * facing, y + pts[i][1], z);
          uv.push(...uvs[i]);
          col.push(r, g, b);
        });
      };
      const one = u.hw < 0.6;                  // moto: un solo faro
      const xs = one ? [0] : [-(u.hw - 0.35), u.hw - 0.35];
      xs.forEach((x) => {
        quad(x, 0.75, -u.hl - 0.08, 1.5, -1, 1, 0.95, 0.8);   // faro (mira hacia -Z)
        quad(x, 0.85, u.hl + 0.08, 0.8, 1, 0.9, 0.08, 0.05);  // luz trasera (mira hacia +Z)
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      lightGeos[key] = geo;
    }
    const m = new THREE.Mesh(lightGeos[key], CAR_LIGHT_MAT);
    m.renderOrder = 4;
    m.frustumCulled = false;
    car.add(m);
  }

  // ---------- Incendio de campo a lo lejos ----------
  // Llamas y humo con Points (un dibujo cada uno), más el resplandor naranja en el piso.
  // Sin niebla: se ve de lejos, de noche, como en la ruta.
  const FLAME_TEX = new THREE.CanvasTexture(glowCanvas('rgba(255,250,220,1)', 'rgba(255,140,30,0.6)', 0.35));
  FLAME_TEX.colorSpace = THREE.SRGBColorSpace;
  const SMOKE_TEX = new THREE.CanvasTexture(glowCanvas('rgba(255,255,255,0.55)', 'rgba(255,255,255,0.25)', 0.6));
  function makeFire(width = 46) {
    const g = new THREE.Group();
    const NF = 70, NS = 46;
    const flames = new THREE.BufferGeometry();
    const fp = new Float32Array(NF * 3), fc = new Float32Array(NF * 3);
    const base = [];
    for (let i = 0; i < NF; i++) {
      const x = (Math.random() - 0.5) * width, z = (Math.random() - 0.5) * width * 0.5;
      base.push({ x, z, ph: Math.random() * 10, h: 1.5 + Math.random() * 5 });
      const k = Math.random();
      fc.set([1, 0.45 + 0.4 * k, 0.12 * k], i * 3);
    }
    flames.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    flames.setAttribute('color', new THREE.BufferAttribute(fc, 3));
    const fpts = new THREE.Points(flames, new THREE.PointsMaterial({
      map: FLAME_TEX, size: 7, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false, toneMapped: false
    }));
    const smoke = new THREE.BufferGeometry();
    const sp = new Float32Array(NS * 3), sc = new Float32Array(NS * 3);
    const puffs = [];
    for (let i = 0; i < NS; i++) puffs.push({ x: (Math.random() - 0.5) * width * 0.8, z: (Math.random() - 0.5) * width * 0.4, t: Math.random() });
    smoke.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    smoke.setAttribute('color', new THREE.BufferAttribute(sc, 3));
    const spts = new THREE.Points(smoke, new THREE.PointsMaterial({
      map: SMOKE_TEX, size: 22, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, fog: false
    }));
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(width * 2.4, width * 1.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: GLOW, color: 0xff6a1a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
    glow.position.y = 0.3;
    [fpts, spts, glow].forEach((o) => { o.frustumCulled = false; o.renderOrder = 5; g.add(o); });
    g.userData.update = (t) => {
      for (let i = 0; i < NF; i++) {
        const b = base[i];
        const f = Math.sin(t * 9 + b.ph) * 0.5 + 0.5;
        fp[i * 3] = b.x + Math.sin(t * 3 + b.ph) * 0.4;
        fp[i * 3 + 1] = b.h * (0.6 + 0.5 * f);
        fp[i * 3 + 2] = b.z;
      }
      flames.attributes.position.needsUpdate = true;
      for (let i = 0; i < NS; i++) {
        const p = puffs[i];
        const k = (p.t + t * 0.05) % 1;              // sube, se abre y se va con el viento
        sp[i * 3] = p.x + k * 30;
        sp[i * 3 + 1] = 6 + k * 70;
        sp[i * 3 + 2] = p.z - k * 10;
        const lit = Math.max(0, 1 - k * 3);          // abajo, iluminado de naranja por el fuego
        const fade = (1 - k) * 0.6;
        sc.set([(0.18 + 0.6 * lit) * fade, (0.17 + 0.25 * lit) * fade, (0.18 + 0.05 * lit) * fade], i * 3);
      }
      smoke.attributes.position.needsUpdate = true;
      smoke.attributes.color.needsUpdate = true;
      glow.material.opacity = 0.75 + 0.25 * Math.sin(t * 7);
    };
    g.userData.update(0);
    return g;
  }

  // ---------- Lluvia ----------
  // Gotas como rayitas en el espacio de la cámara (hija de la cámara); el movimiento lo hace el
  // shader (nada en la CPU). `count` baja con la calidad.
  function makeRain(count) {
    const pos = new Float32Array(count * 6), end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = (Math.random() - 0.5) * 40, y = Math.random() * 30, z = -2 - Math.random() * 40;
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2] = 0;
      end[i * 2 + 1] = 1;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 } },
      vertexShader: `attribute float aEnd; uniform float uTime; varying float vEnd;
        void main() {
          vec3 p = position;
          p.y = mod(p.y - uTime * 26.0, 30.0) - 12.0;
          p.x += p.y * 0.08;                         // un poco de viento
          p.y -= aEnd * 1.1; p.x -= aEnd * 0.09;     // largo de la gota
          vEnd = aEnd;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: `uniform float uAlpha; varying float vEnd;
        void main() { gl_FragColor = vec4(0.72, 0.78, 0.9, uAlpha * (1.0 - vEnd * 0.7)); }`,
      transparent: true, depthWrite: false
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    lines.renderOrder = 10;
    lines.userData.update = (t, alpha) => { mat.uniforms.uTime.value = t; mat.uniforms.uAlpha.value = alpha; };
    return lines;
  }

  // ---------- Zona de parada / bombas: luz que sale del piso (como en los juegos de los 2000) ----------
  // Un rectángulo de luz suave en el asfalto y "paredes" de luz bajas que se desvanecen hacia arriba,
  // con franjas que suben despacio. Todo aditivo y tenue: se ve sin tapar la ruta. Vértices cada 2 m a
  // lo largo para que se curve con la ruta (bend3d.js). Un material por color, animado en updateZones().
  const zoneMats = {};
  function zoneMaterials(color) {
    if (zoneMats[color]) return zoneMats[color];
    // Piso: rectángulo con bordes suaves.
    const floor = new THREE.CanvasTexture(canvas(64, 128, (g, w, h) => {
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const dx = Math.min(x, w - 1 - x) / (w * 0.5), dy = Math.min(y, h - 1 - y) / (h * 0.5);
        const edge = Math.min(1, dx / 0.35) * Math.min(1, dy / 0.18);       // 0 en el borde, 1 adentro
        const rim = Math.exp(-Math.pow((Math.min(dx * 2.2, dy * 5.5) - 0.12) / 0.1, 2)); // borde más brillante
        const v = Math.round(255 * Math.min(1, edge * 0.35 + rim * 0.55));
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    }));
    // Paredes: fuertes abajo, nada arriba, con franjas horizontales que se repiten (suben con offset).
    const wall = new THREE.CanvasTexture(canvas(8, 128, (g, w, h) => {
      for (let y = 0; y < h; y++) {
        const k = y / h;                                   // 0 arriba, 1 abajo (en el canvas)
        const band = 0.55 + 0.45 * Math.pow(Math.sin(k * Math.PI * 4) * 0.5 + 0.5, 3);
        const v = Math.round(255 * band);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(0, y, w, 1);
      }
    }));
    wall.wrapT = THREE.RepeatWrapping;
    const fade = new THREE.CanvasTexture(canvas(8, 64, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#000');
      gr.addColorStop(0.6, '#555');
      gr.addColorStop(1, '#fff');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    }));
    const opts = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide };
    const m = {
      floor: new THREE.MeshBasicMaterial({ ...opts, map: floor, color, opacity: 0.55 }),
      wall: new THREE.MeshBasicMaterial({ ...opts, map: wall, alphaMap: fade, color, opacity: 0.35 })
    };
    // Con blending aditivo three.js usa la transparencia (SrcAlpha), así que alphaMap desvanece las paredes.
    zoneMats[color] = m;
    return m;
  }

  function zoneGlow(color, w = 3.4, len = 16, h = 2.6) {
    const m = zoneMaterials(color);
    const g = new THREE.Group();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.6, len + 1, 1, Math.ceil(len / 2)).rotateX(-Math.PI / 2), m.floor);
    floor.position.y = 0.04;
    floor.renderOrder = 2;
    g.add(floor);
    // Cuatro paredes de luz (las largas con cortes cada 2 m).
    const pos = [], uv = [], idx = [];
    const wallQuad = (x0, z0, x1, z1) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2));
      const b = pos.length / 3;
      for (let i = 0; i <= n; i++) {
        const t = i / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
        pos.push(x, 0, z, x, h, z);
        uv.push(t, 0, t, 1);
        if (i) { const a = b + (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
    };
    const hw = w / 2, hl = len / 2;
    wallQuad(-hw, -hl, -hw, hl); wallQuad(hw, -hl, hw, hl); wallQuad(-hw, -hl, hw, -hl); wallQuad(-hw, hl, hw, hl);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const walls = new THREE.Mesh(geo, m.wall);
    walls.renderOrder = 3;
    g.add(walls);
    g.traverse((o) => { o.frustumCulled = false; });
    return g;
  }

  // Animación de todas las zonas: las franjas suben y la luz late suave.
  function updateZones(t) {
    for (const k in zoneMats) {
      const m = zoneMats[k];
      m.wall.map.offset.y = -t * 0.35;
      const p = 0.5 + 0.5 * Math.sin(t * 3);
      m.wall.opacity = 0.42 + 0.16 * p;
      m.floor.opacity = 0.5 + 0.15 * p;
    }
  }

  return { MOON_DIR, GLOW, POOL_MAT, LAMP_MAT, nightSky, headlightPool, carLights, makeFire, makeRain, additive, zoneGlow, updateZones };
})();
