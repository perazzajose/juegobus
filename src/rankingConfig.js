// Ranking online (Supabase). Completar con los datos del proyecto: Supabase → Project Settings → API.
// url: "Project URL". key: la clave pública "publishable" (sb_publishable_...) o la vieja "anon"
// (NUNCA la "service_role" ni la "secret"). Proyecto: "juegobus" en Supabase (São Paulo).
// La clave anon es pública a propósito: con ella solo se puede leer el ranking y agregar viajes
// (ver supabase/ranking.sql). Si queda vacío, el juego usa solo el ranking de esta PC.
// El aviso para que Supabase no pause el proyecto (.github/workflows/supabase-despierto.yml) lee
// estos mismos dos valores de este archivo.
window.RANKING_ONLINE = {
  url: 'https://loqjfwaewccwfjtxllgs.supabase.co',
  key: 'sb_publishable_uL3UYWt6wkAKB-Gf_tatNg_UO3o-VWr'
};
