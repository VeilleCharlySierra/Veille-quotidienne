// Fonction « importer-captures » : récupère dans le dépôt le paquet chiffré des captures d'un jour
// (envoi/captures_<jour>.bin = JSON {id_publication: jpeg en base64}), les range dans le stockage « captures »
// et renseigne publications.capture.
import postgres from "npm:postgres@3.4.4";
import { decodeBase64 } from "jsr:@std/encoding@1.0.5/base64";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const DEPOT = "https://raw.githubusercontent.com/VeilleCharlySierra/Veille-quotidienne/main/envoi/";
const hex = (h: string) => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));

Deno.serve(async (req) => {
  try {
    const [{ valeur: jeton }] = await sql`select valeur from prive.cles where nom = 'jeton_envoi'`;
    if (req.headers.get("x-jeton") !== jeton) return new Response("refusé", { status: 403 });
    const corps = await req.json();
    const jour: string = corps.jour;                                   // dossier de rangement (AAAA-MM-JJ)
    const paquet: string = corps.fichier || ("captures_" + jour + ".bin"); // fichier dans envoi/
    const r = await fetch(DEPOT + paquet + "?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return Response.json({ ok: false, raison: "paquet absent " + r.status });
    const brut = new Uint8Array(await r.arrayBuffer());
    const [{ valeur: cle }] = await sql`select valeur from prive.cles where nom = 'cle_rapport'`;
    const k = await crypto.subtle.importKey("raw", hex(cle), "AES-GCM", false, ["decrypt"]);
    const clair = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: brut.slice(0, 12) }, k, brut.slice(12)));
    const caps: Record<string, string> = JSON.parse(new TextDecoder().decode(clair));
    const srv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ids = Object.keys(caps);
    for (let i = 0; i < ids.length; i += 10) {
      await Promise.all(ids.slice(i, i + 10).map((id) =>
        fetch(Deno.env.get("SUPABASE_URL") + `/storage/v1/object/captures/${jour}/p${id}.jpg`, {
          method: "POST", body: decodeBase64(caps[id]),
          headers: { Authorization: "Bearer " + srv, apikey: srv, "Content-Type": "image/jpeg", "x-upsert": "true" },
          signal: AbortSignal.timeout(4000) }).catch(() => null)));
    }
    // la réponse du stockage peut tarder : on vérifie dans la base ce qui est bien enregistré
    const faits = await sql`select name from storage.objects where bucket_id = 'captures' and name like ${jour + "/p%"}`;
    const ok = new Set(faits.map((f) => f.name));
    let n = 0; const echecs: string[] = [];
    for (const id of ids) {
      const chemin = `${jour}/p${id}.jpg`;
      if (ok.has(chemin)) { await sql`update public.publications set capture = ${chemin} where id = ${Number(id)}`; n++; }
      else echecs.push(id);
    }
    await sql`insert into public.journal(le, type, par, detail) values (now(), 'Administration', 'import captures', ${`${n} captures du ${jour} rangées` + (echecs.length ? ` ; échecs : ${echecs.join(", ")}` : "")})`;
    return Response.json({ ok: true, n, echecs });
  } catch (e) {
    return Response.json({ ok: false, erreur: (e as Error).message }, { status: 500 });
  }
});
