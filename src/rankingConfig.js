// Ranking online (Supabase). Completar con los datos del proyecto: Supabase → Project Settings → API.
// url: "Project URL". key: la clave pública "anon" / "publishable" (NO la "service_role" ni la "secret").
// La clave anon es pública a propósito: con ella solo se puede leer el ranking y agregar viajes
// (ver supabase/ranking.sql). Si queda vacío, el juego usa solo el ranking de esta PC.
// El aviso para que Supabase no pause el proyecto (.github/workflows/supabase-despierto.yml) lee
// estos mismos dos valores de este archivo.
window.RANKING_ONLINE = {
  url: '',
  key: ''
};
