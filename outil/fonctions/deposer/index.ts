// Fonction « deposer » : reçoit depuis la page depot.html (ouverte dans Chrome sur l'ordinateur de veille)
// une capture d'écran de publication ou le PDF du rapport, et la range dans le stockage.
//   en-têtes : x-jeton (jeton_envoi), x-mode (capture | rapport), x-id (id publication), x-jour (AAAA-MM-JJ)
import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const CORS = {
  "Access-Control-Allow-Origin": "https://veillecharlysierra.github.io",
  "Access-Control-Allow-Headers": "content-type, x-jeton, x-mode, x-id, x-jour",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const rep = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function ranger(bucket: string, chemin: string, corps: Uint8Array, type: string) {
  const srv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  await fetch(Deno.env.get("SUPABASE_URL") + `/storage/v1/object/${bucket}/${chemin}`, {
    method: "POST", body: corps,
    headers: { Authorization: "Bearer " + srv, apikey: srv, "Content-Type": type, "x-upsert": "true" },
    signal: AbortSignal.timeout(8000) }).catch(() => null);
  // la réponse du stockage peut tarder alors que le fichier est enregistré : on vérifie dans la base
  for (let i = 0; i < 5; i++) {
    const ok = await sql`select 1 from storage.objects where bucket_id = ${bucket} and name = ${chemin} and coalesce(updated_at, created_at) > now() - interval '5 minutes'`;
    if (ok.length) return true;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const [{ valeur: jeton }] = await sql`select valeur from prive.cles where nom = 'jeton_envoi'`;
    if (req.headers.get("x-jeton") !== jeton) return rep({ ok: false, erreur: "refusé" }, 403);
    const mode = req.headers.get("x-mode"), jour = req.headers.get("x-jour") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(jour)) return rep({ ok: false, erreur: "jour invalide" }, 400);
    const corps = new Uint8Array(await req.arrayBuffer());
    if (corps.length < 500) return rep({ ok: false, erreur: "fichier vide" }, 400);
    if (mode === "capture") {
      const id = Number(req.headers.get("x-id"));
      if (!id) return rep({ ok: false, erreur: "id manquant" }, 400);
      const chemin = `${jour}/p${id}.jpg`;
      if (!(await ranger("captures", chemin, corps, "image/jpeg"))) return rep({ ok: false, erreur: "stockage" }, 500);
      await sql`update public.publications set capture = ${chemin} where id = ${id}`;
      return rep({ ok: true, chemin });
    }
    if (mode === "rapport") {
      const fichier = "Rapport_de_veille_quotidien_" + jour.split("-").reverse().join("") + ".pdf";
      if (!(await ranger("rapports", fichier, corps, "application/pdf"))) return rep({ ok: false, erreur: "stockage" }, 500);
      await sql`delete from public.rapports_journaliers where jour = ${jour}`;
      await sql`insert into public.rapports_journaliers(jour, fichier, cree_le) values (${jour}, ${fichier}, now())`;
      await sql`insert into public.journal(le, type, par, detail) values (now(), 'Rapport', 'dépôt', ${"Rapport du " + jour.split("-").reverse().join("/") + " déposé (" + Math.round(corps.length / 1024) + " Ko)"})`;
      return rep({ ok: true, fichier });
    }
    return rep({ ok: false, erreur: "mode inconnu" }, 400);
  } catch (e) {
    return rep({ ok: false, erreur: (e as Error).message }, 500);
  }
});
