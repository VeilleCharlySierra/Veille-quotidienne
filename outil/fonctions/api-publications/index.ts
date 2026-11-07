// Fonction « api-publications » : accès en lecture seule aux publications CIE qui signalent une panne (thématique « Coupures d'électricité »), pour un système tiers.
// Authentification : en-tête « x-api-key: <clé> » (ou « Authorization: Bearer <clé> »). Les clés sont créées et révoquées
// par le super administrateur dans l'Administration ; seule leur empreinte SHA-256 est conservée.
// Ne renvoie QUE ces publications (ni autres thématiques, ni SODECI, ni commentaires, ni statistiques, ni règles de surveillance).
// Paramètres (GET) : depuis=<date ISO> (défaut : 24 h), jusqua=<date ISO>, limite=1..500 (défaut 100), apres_id=<id> (pagination).
import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const ENTETES = { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "x-api-key, authorization", "Cache-Control": "no-store" };
const rep = (corps: unknown, status = 200) => new Response(JSON.stringify(corps), { status, headers: ENTETES });

async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const date = (v: string | null) => { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? undefined : d; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: ENTETES });
  if (req.method !== "GET") return rep({ erreur: "méthode non autorisée (GET seulement)" }, 405);
  try {
    const cle = (req.headers.get("x-api-key") || (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "")).trim();
    if (!/^vcs_[0-9a-f]{48}$/.test(cle)) return rep({ erreur: "clé d'accès absente ou invalide" }, 401);
    const [c] = await sql`select id from prive.cles_api where empreinte = ${await sha256(cle)} and actif`;
    if (!c) return rep({ erreur: "clé d'accès absente ou invalide" }, 401);

    const u = new URL(req.url);
    const depuis = date(u.searchParams.get("depuis")), jusqua = date(u.searchParams.get("jusqua"));
    if (depuis === undefined || jusqua === undefined) return rep({ erreur: "date invalide (format ISO, ex. 2026-11-07T00:00:00Z)" }, 400);
    const limite = Math.min(Math.max(parseInt(u.searchParams.get("limite") || "100") || 100, 1), 500);
    const apres = parseInt(u.searchParams.get("apres_id") || "0") || 0;
    const d0 = depuis || new Date(Date.now() - 864e5);

    const lignes = await sql`
      select id::int as id, case when type = 'officiel' then 'canal officiel' else 'remontée' end as type,
             plateforme, auteur, texte, lieu, sentiment, lien,
             publiee_le, coalesce(remontee_le, cree_le) as remontee_le, jaime, com as commentaires, part as partages, vues
      from public.publications
      where marque::text = 'CIE' and theme = 'Coupures d''électricité' and coalesce(remontee_le, cree_le) >= ${d0}
        ${jusqua ? sql`and coalesce(remontee_le, cree_le) < ${jusqua}` : sql``}
        and id > ${apres}
      order by id
      limit ${limite + 1}`;
    const suite = lignes.length > limite;
    const items = lignes.slice(0, limite);
    await sql`update prive.cles_api set dernier_usage = now(), nb_appels = nb_appels + 1 where id = ${c.id}`;
    return rep({ nombre: items.length, suite, apres_id: suite ? items[items.length - 1].id : null, publications: items });
  } catch (e) {
    console.error(e);
    return rep({ erreur: "erreur interne" }, 500);
  }
});
