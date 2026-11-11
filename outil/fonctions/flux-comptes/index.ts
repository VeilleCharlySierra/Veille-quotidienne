// Fonction « flux-comptes » : remplace RSS.app pour les comptes Facebook suivis (sources_suivies, Facebook, actives, avec adresse).
// Collecte par Bright Data (jeu « Facebook posts by profile/page URL »), en deux temps lancés par la base :
//   ?etape=lancer   (minute 25 des heures 0,3,6,…) : demande les 5 dernières publications de chaque compte suivi ;
//   ?etape=recevoir (minutes 35 et 45)              : récupère le résultat et l'ingère comme le faisaient les flux
//                                                     (comptes officiels → publications « officiel » ; autres → a_classer).
// Le jeton Bright Data est lu dans un secret de la fonction (jamais écrit dans le code ni dans la base).
// L'état est noté dans parametres.flux_comptes ; une erreur alimente l'alerte dispositif (anomalies_flux).
import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const NOMS = ["BRIGHTDATA_TOKEN", "BRIGHT_DATA_TOKEN", "BRIGHTDATA_API_KEY", "BRIGHT_DATA_API_KEY", "BRIGHTDATA_API_TOKEN", "BRIGHT_DATA_API_TOKEN", "BRIGHTDATA_KEY", "BRIGHTDATA"];
const nomSecret = NOMS.find((k) => Deno.env.get(k)) ||
  Object.keys(Deno.env.toObject()).find((k) => /bright/i.test(k)) || "";
const TOKEN = nomSecret ? Deno.env.get(nomSecret)! : "";
const DATASET = "gd_lkaxegm826bjpoo9m5";
const API = "https://api.brightdata.com/datasets/v3";

const etat = async (v: Record<string, unknown>) => {
  const [a] = await sql`select valeur from public.parametres where cle = 'flux_comptes'`;
  const n = { ...(a ? JSON.parse(a.valeur) : {}), ...v };
  await sql`insert into public.parametres(cle, valeur) values ('flux_comptes', ${JSON.stringify(n)}) on conflict (cle) do update set valeur = excluded.valeur`;
  return n;
};
const incident = (t: string) =>
  sql`insert into public.journal(le, type, par, detail) values (now(), 'Incident', 'flux des comptes suivis', ${t})`.catch(() => {});
const propre = (u: string) => String(u || "").replace(/(web|m)\.facebook\.com/, "www.facebook.com").split("?")[0].replace(/\/$/, "").toLowerCase();
const cleSource = (u: string) => {
  const t = String(u || "");
  const id = (t.match(/[?&]id=(\d+)/) || [])[1];
  return id || propre(t).replace("https://www.facebook.com/", "");
};

Deno.serve(async (req) => {
  try {
    const [{ valeur: jeton }] = await sql`select valeur from prive.cles where nom = 'jeton_envoi'`;
    if (req.headers.get("x-jeton") !== jeton) return new Response("refusé", { status: 403 });
    const etape = new URL(req.url).searchParams.get("etape") || "recevoir";
    if (etape === "diag") return Response.json({ ok: true, secret_trouve: !!TOKEN, nom_secret: nomSecret || null });
    if (!TOKEN) {
      await etat({ statut: "erreur", erreur: "jeton Bright Data introuvable dans les secrets", le: new Date().toISOString() });
      await incident("Collecte des comptes suivis impossible : jeton Bright Data introuvable dans les secrets des fonctions");
      return Response.json({ ok: false, erreur: "jeton absent" });
    }
    const H = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" };
    const sources = await sql`select id, nom, url, categorie, marque::text marque, plateforme from public.sources_suivies
      where actif and plateforme = 'Facebook' and url is not null order by id`;

    if (etape === "lancer") {
      const debut = new Date(Date.now() - 3 * 864e5);
      const d = `${String(debut.getUTCMonth() + 1).padStart(2, "0")}-${String(debut.getUTCDate()).padStart(2, "0")}-${debut.getUTCFullYear()}`;
      const r = await fetch(`${API}/trigger?dataset_id=${DATASET}&include_errors=true`, {
        method: "POST", headers: H, body: JSON.stringify(sources.map((s) => ({ url: s.url, num_of_posts: 5, start_date: d }))) });
      const t = await r.text();
      if (!r.ok) {
        await etat({ statut: "erreur", erreur: "lancement " + r.status + " " + t.slice(0, 150), le: new Date().toISOString() });
        await incident("Collecte des comptes suivis : lancement refusé (" + r.status + " " + t.slice(0, 150) + ")");
        return Response.json({ ok: false, statut: r.status, erreur: t.slice(0, 300) });
      }
      const snap = JSON.parse(t).snapshot_id;
      await etat({ statut: "lancé", snapshot: snap, lance_le: new Date().toISOString(), comptes: sources.length, erreur: null });
      return Response.json({ ok: true, snapshot: snap, comptes: sources.length });
    }

    // recevoir
    const [p] = await sql`select valeur from public.parametres where cle = 'flux_comptes'`;
    const e = p ? JSON.parse(p.valeur) : {};
    if (!e.snapshot || e.statut !== "lancé") return Response.json({ ok: true, rien: "aucune collecte en attente", statut: e.statut });
    const pr = await (await fetch(`${API}/progress/${e.snapshot}`, { headers: H })).json();
    if (pr.status === "running" || pr.status === "starting" || pr.status === "building" || pr.status === "collecting") {
      // au-delà de 50 minutes sans résultat : incident
      if (Date.now() - new Date(e.lance_le).getTime() > 50 * 60e3) {
        await etat({ statut: "erreur", erreur: "collecte toujours en cours après 50 min", le: new Date().toISOString() });
        await incident("Collecte des comptes suivis : pas de résultat 50 min après le lancement");
      }
      return Response.json({ ok: true, en_cours: pr.status });
    }
    if (pr.status !== "ready") {
      await etat({ statut: "erreur", erreur: "collecte " + pr.status, le: new Date().toISOString() });
      await incident("Collecte des comptes suivis en échec : " + JSON.stringify(pr).slice(0, 200));
      return Response.json({ ok: false, progress: pr });
    }
    const rs = await fetch(`${API}/snapshot/${e.snapshot}?format=json`, { headers: H });
    const items: any[] = rs.ok ? await rs.json() : [];
    if (!rs.ok) throw new Error("téléchargement " + rs.status);
    let off = 0, acl = 0, err = 0, vieux = 0;
    for (const it of items) {
      if (it.error || it.error_code || !it.url) { err++; continue; }
      const src = sources.find((s) => [it.input?.url, it.page_url, it.user_url].some((u) => u && cleSource(u) === cleSource(s.url)))
        || sources.find((s) => it.input?.url && propre(it.input.url) === propre(s.url));
      if (!src) { err++; continue; }
      const le = it.date_posted ? new Date(it.date_posted) : null;
      if (!le || isNaN(le.getTime()) || le.getTime() < Date.now() - 72 * 3600e3) { vieux++; continue; }
      const texte = String(it.content || it.description || "").replace(/\s+/g, " ").trim();
      const att = Array.isArray(it.attachments) ? it.attachments[0] : null;
      const img = att?.attachment_url || att?.url || att?.thumbnail_url || it.thumbnail || null;
      const lien = String(it.url).replace(/(web|m)\.facebook\.com/, "www.facebook.com");
      // déjà connue (même lien, ou même compte et même début de texte reçu par l'ancien flux)
      const [deja] = await sql`select 1 from public.publications where lien = ${lien}
          or (auteur = ${src.nom} and ${texte} <> '' and left(texte, 80) = left(${texte}, 80)) limit 1`;
      const [deja2] = await sql`select 1 from public.a_classer where lien = ${lien} limit 1`;
      if (deja || deja2) continue;
      if (src.categorie === "officiel" && src.marque) {
        const r = await sql`insert into public.publications(marque, type, plateforme, auteur, texte, theme, sentiment, lien, publiee_le, capture, origine,
            jaime, com, part)
          values (${src.marque}::public.marque, 'officiel', 'Facebook', ${src.nom}, ${texte.slice(0, 800) || null}, 'Informations et communiqués', 'Neutre',
            ${lien}, ${le}, ${img}, 'automatisee', ${it.likes ?? null}, ${it.num_comments ?? null}, ${it.num_shares ?? null})
          on conflict do nothing returning id`;
        if (r.length) off++;
      } else {
        const r = await sql`insert into public.a_classer(source, plateforme, auteur, texte, lien, publiee_le, image)
          values (${src.nom}, 'Facebook', ${src.nom}, ${texte.slice(0, 1500) || null}, ${lien}, ${le}, ${img}) on conflict (lien) do nothing returning id`;
        if (r.length) acl++;
      }
    }
    const fin = await etat({ statut: "reçu", recu_le: new Date().toISOString(), elements: items.length, officiels: off, a_classer: acl,
      erreurs_comptes: err, trop_anciens: vieux, erreur: null });
    if (items.length && err === items.length) await incident("Collecte des comptes suivis : aucun compte lu (" + err + " erreurs)");
    return Response.json({ ok: true, ...fin });
  } catch (x) {
    await etat({ statut: "erreur", erreur: (x as Error).message.slice(0, 200), le: new Date().toISOString() }).catch(() => {});
    await incident("Collecte des comptes suivis : " + (x as Error).message);
    return Response.json({ ok: false, erreur: (x as Error).message }, { status: 500 });
  }
});
