// Fonction « stats-pannes » : relais entre la page de veille et l'API de statistiques de la plateforme de signalement
// (pannes CIE). Réservée aux utilisateurs connectés et autorisés ; la clé de la plateforme de signalement reste côté serveur.
import postgres from "npm:postgres@3.4.4";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Content-Type": "application/json; charset=utf-8" };
const rep = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: ok } = await sb.rpc("est_autorise");
    if (!ok) return rep({ erreur: "non autorisé" }, 403);
    const corps = await req.json().catch(() => ({}));
    const [p] = await sql`select (select valeur from public.parametres where cle = 'pannes_cie_externe') as conf,
                                 (select valeur from prive.cles where nom = 'cle_stats_signalement') as cle`;
    const conf = JSON.parse(p.conf || "{}");
    if (!conf.actif || !conf.url || !p.cle) return rep({ erreur: "bascule non activée" }, 409);
    const u = new URL(conf.url);
    for (const k of ["depuis", "jusqua"]) if (corps[k] && !isNaN(new Date(corps[k]).getTime())) u.searchParams.set(k, new Date(corps[k]).toISOString());
    const r = await fetch(u, { headers: { "x-api-key": p.cle, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    if (!r.ok) return rep({ erreur: `plateforme de signalement : réponse ${r.status}` }, 502);
    let j: Record<string, unknown>;
    try { j = JSON.parse(t); } catch { return rep({ erreur: "plateforme de signalement : réponse illisible" }, 502); }
    if (typeof j.signalements !== "number" || !Array.isArray(j.par_jour) || !Array.isArray(j.par_localite))
      return rep({ erreur: "plateforme de signalement : format inattendu (signalements, par_jour, par_localite obligatoires)" }, 502);
    return rep(j);
  } catch (e) {
    return rep({ erreur: "plateforme de signalement injoignable : " + (e as Error).message }, 502);
  }
});
