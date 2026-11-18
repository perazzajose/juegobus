// Ranking local (top 10) guardado en el navegador de la máquina del evento.
const Ranking = {
  KEY: 'cot-ruta-a-la-costa-ranking',
  SIZE: 10,

  load() {
    try {
      const list = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  },

  save(list) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(list));
    } catch (e) {
      // Sin almacenamiento (modo privado, etc.): el juego sigue funcionando.
    }
  },

  qualifies(score) {
    const list = this.load();
    return score > 0 && (list.length < this.SIZE || score > list[list.length - 1].score);
  },

  // Devuelve la posición (0 = primero) en la que quedó la entrada.
  // company es opcional (el 3D guarda la empresa del jugador).
  add(name, score, company) {
    const entry = { name, score, date: Date.now() };
    if (company) entry.company = company;
    const list = this.load();
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    const top = list.slice(0, this.SIZE);
    this.save(top);
    return top.indexOf(entry);
  },

  clear() {
    this.save([]);
  }
};

// Ranking online (Supabase, ver supabase/ranking.sql y src/rankingConfig.js).
// Si no hay internet o no está configurado, el juego sigue con el ranking local. Los viajes que no se
// pudieron mandar quedan guardados en esta PC y se mandan solos la próxima vez que haya conexión.
const RankingOnline = {
  PENDING_KEY: 'cot-ruta-3d-ranking-pendientes',
  TIMEOUT: 6000,
  cache: null,           // último top descargado: [{ id, nombre, empresa, puntos }]
  lastId: null,          // id del último viaje mandado desde esta PC (para resaltarlo)

  get cfg() { return window.RANKING_ONLINE || {}; },
  enabled() { return !!(this.cfg.url && this.cfg.key && window.fetch); },

  request(path, opts = {}) {
    const ctl = window.AbortController ? new AbortController() : null;
    const timer = ctl && setTimeout(() => ctl.abort(), this.TIMEOUT);
    return fetch(this.cfg.url.replace(/\/$/, '') + '/rest/v1/' + path, {
      ...opts,
      signal: ctl ? ctl.signal : undefined,
      headers: { apikey: this.cfg.key, Authorization: 'Bearer ' + this.cfg.key, 'Content-Type': 'application/json', ...(opts.headers || {}) }
    }).then((r) => {
      clearTimeout(timer);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.status === 204 ? null : r.json();
    }, (e) => { clearTimeout(timer); throw e; });
  },

  // Top n (por puntos; en empate, el más viejo primero). Guarda el resultado en cache.
  top(n = 10) {
    if (!this.enabled()) return Promise.resolve(null);
    return this.request(`ranking?select=id,nombre,empresa,puntos&order=puntos.desc,creado.asc&limit=${n}`)
      .then((list) => { this.cache = list; return list; })
      .catch(() => null);
  },

  pending() {
    try { const l = JSON.parse(localStorage.getItem(this.PENDING_KEY) || '[]'); return Array.isArray(l) ? l : []; }
    catch (e) { return []; }
  },
  savePending(list) {
    try { localStorage.setItem(this.PENDING_KEY, JSON.stringify(list.slice(-50))); } catch (e) { /* sin almacenamiento */ }
  },

  send(entry) {
    return this.request('ranking?select=id', {
      method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(entry)
    }).then((rows) => (rows && rows[0] ? rows[0].id : null));
  },

  // Manda un viaje. Devuelve una promesa con el id (o null si quedó pendiente / no hay online).
  add(nombre, empresa, puntos, km, llego) {
    if (!this.enabled() || !(puntos > 0)) return Promise.resolve(null);
    const entry = {
      nombre: String(nombre || 'JUGADOR').trim().slice(0, 12) || 'JUGADOR',
      empresa, puntos: Math.round(puntos), km: Math.round(km * 10) / 10, llego: !!llego
    };
    return this.flush().then(() => this.send(entry)).then((id) => { this.lastId = id; return id; }, () => {
      this.savePending(this.pending().concat(entry));
      return null;
    });
  },

  // Manda los viajes que quedaron pendientes (sin internet en su momento).
  flush() {
    const list = this.pending();
    if (!this.enabled() || !list.length) return Promise.resolve();
    const rest = list.slice();
    const next = () => {
      if (!rest.length) { this.savePending([]); return Promise.resolve(); }
      return this.send(rest[0]).then(() => { rest.shift(); return next(); }, () => { this.savePending(rest); });
    };
    return next();
  }
};
