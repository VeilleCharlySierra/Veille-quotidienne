// Fonction « purge-captures » : supprime du stockage les captures qui ne sont plus rattachées à aucune publication
// (publications arrivées à échéance de la règle de conservation). Ne fait rien tant que la règle n'est pas activée.
import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });

Deno.serve(async (req) => {
  try {
    const [{ valeur: jeton }] = await sql`select valeur from prive.cles where nom = 'jeton_envoi'`;
    if (req.headers.get("x-jeton") !== jeton) return new Response("refusé", { status: 403 });
    const [{ actif }] = await sql`select coalesce((select (valeur::jsonb->>'active')::boolean from public.parametres where cle = 'conservation'), false) as actif`;
    const orphelines = await sql`select name from storage.objects o where bucket_id = 'captures' and created_at < now() - interval '2 hours'
      and not exists (select 1 from public.publications p where p.capture = o.name) limit 1000`;
    if (!actif) return Response.json({ ok: true, essai: true, a_supprimer: orphelines.length });
    let n = 0;
    for (let i = 0; i < orphelines.length; i += 100) {
      const lot = orphelines.slice(i, i + 100).map((o) => o.name);
      const r = await fetch(Deno.env.get("SUPABASE_URL") + "/storage/v1/object/captures", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") },
        body: JSON.stringify({ prefixes: lot }),
      });
      if (!r.ok) throw new Error("stockage " + r.status + " " + (await r.text()).slice(0, 150));
      n += lot.length;
    }
    if (n) await sql`insert into public.journal(le, type, par, detail) values (now(), 'Conservation', 'règle de conservation', ${n + " capture(s) effacée(s) du stockage à échéance."})`;
    return Response.json({ ok: true, supprimees: n });
  } catch (e) {
    await sql`insert into public.journal(le, type, par, detail) values (now(), 'Incident', 'règle de conservation', ${"Purge des captures : " + (e as Error).message})`.catch(() => {});
    return Response.json({ ok: false, erreur: (e as Error).message }, { status: 500 });
  }
});
