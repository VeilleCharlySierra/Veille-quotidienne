// Fonction « releve-horaire » : relevé réel des chiffres des points d'attention, lancé par la base toutes les heures
// (minute 17), indépendamment de l'ordinateur de veille.
//   « Suivi toutes les heures » (et « En attente du premier relevé ») : relevé à chaque heure.
//   « Suivi toutes les 2 heures » : relevé aux heures paires.
// Si un relevé a déjà été fait depuis moins de 40 minutes (par exemple par le passage), la publication est sautée.
// La clé Apify est lue dans le secret APIFY_TOKEN (jamais écrite dans le code ni dans la base).
import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const TOKEN = Deno.env.get("APIFY_TOKEN") || "";

async function acteur(nom: string, input: unknown, plafond: number): Promise<any[]> {
  const url = `https://api.apify.com/v2/acts/${nom.replace("/", "~")}/run-sync-get-dataset-items?timeout=110&maxTotalChargeUsd=${plafond.toFixed(3)}`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify(input), signal: AbortSignal.timeout(125000) });
  if (!r.ok) throw new Error(nom + " " + r.status + " " + (await r.text()).slice(0, 160));
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}
// Secours Bright Data (décision du 12/11 : compte Apify bloqué) : utilisé quand l'outil Apify échoue pour Facebook ou TikTok.
const BD = Deno.env.get("BRIGHTDATA_TOKEN") || "";
async function brightData(dataset: string, urls: string[]): Promise<any[]> {
  const H = { Authorization: "Bearer " + BD, "Content-Type": "application/json" };
  const r = await fetch(`https://api.brightdata.com/datasets/v3/scrape?dataset_id=${dataset}&include_errors=true`, {
    method: "POST", headers: H, body: JSON.stringify({ input: urls.map((url) => ({ url })) }), signal: AbortSignal.timeout(70000) });
  const t = await r.text();
  if (r.status === 202) {
    // collecte plus longue : on attend le résultat (70 s au plus)
    const snap = JSON.parse(t).snapshot_id;
    for (let i = 0; i < 7; i++) {
      await new Promise((ok) => setTimeout(ok, 10000));
      const pr = await (await fetch(`https://api.brightdata.com/datasets/v3/progress/${snap}`, { headers: H })).json();
      if (pr.status === "ready") return await (await fetch(`https://api.brightdata.com/datasets/v3/snapshot/${snap}?format=json`, { headers: H })).json();
      if (pr.status === "failed") throw new Error("Bright Data : collecte en échec");
    }
    throw new Error("Bright Data : pas de résultat en 70 s");
  }
  if (!r.ok) throw new Error("Bright Data " + r.status + " " + t.slice(0, 150));
  const j = t.trim().startsWith("[") ? JSON.parse(t) : t.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return Array.isArray(j) ? j : [];
}
const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.round(v) : null);
const idTweet = (u: string) => (u.match(/status\/(\d+)/) || [])[1] || "";
const idTiktok = (u: string) => (u.match(/video\/(\d+)/) || [])[1] || "";
// adresse normalisée ; pour permalink.php / story.php, l'identifiant de la publication est dans les paramètres : on le garde
const propre = (u: string) => {
  const t = String(u || "").replace("web.facebook.com", "www.facebook.com").replace("m.facebook.com", "www.facebook.com");
  const f = (t.match(/story_fbid=([^&]+)/) || [])[1];
  return (t.split("?")[0].replace(/\/$/, "")) + (f ? "#" + f : "");
};

Deno.serve(async (req) => {
  try {
    const [{ valeur: jeton }] = await sql`select valeur from prive.cles where nom = 'jeton_envoi'`;
    if (req.headers.get("x-jeton") !== jeton) return new Response("refusé", { status: 403 });
    if (!TOKEN) {
      await sql`insert into public.journal(le, type, par, detail) values (now(), 'Incident', 'relevé horaire', 'Relevé horaire impossible : la clé Apify (secret APIFY_TOKEN) n''est pas encore enregistrée')`;
      return Response.json({ ok: false, erreur: "clé Apify absente" });
    }
    const heure = new Date().getUTCHours();
    const pubs = await sql`
      select p.id, p.plateforme, p.lien, p.publiee_le, p.statut_alerte
      from public.publications p
      where p.point_attention and coalesce(p.statut_alerte,'') <> 'Alerte close' and p.lien is not null
        and (coalesce(p.statut_alerte,'') <> 'Suivi toutes les 2 heures' or ${heure} % 2 = 0)
        and not exists (select 1 from public.releves r where r.publication_id = p.id and r.releve_le > now() - interval '40 minutes')`;
    const fb = pubs.filter((p) => /facebook\.com|fb\.watch/.test(p.lien));
    const tk = pubs.filter((p) => /tiktok\.com/.test(p.lien));
    const xx = pubs.filter((p) => /(x|twitter)\.com\/.+\/status\//.test(p.lien));
    const res: { id: number; jaime: number | null; com: number | null; part: number | null; vues: number | null }[] = [];
    const erreurs: string[] = [];
    await Promise.all([
      (async () => {
        if (!fb.length) return;
        try {
          const it = await acteur("apify/facebook-posts-scraper",
            { startUrls: fb.map((p) => ({ url: p.lien })), resultsLimit: 1 }, 0.01 + 0.006 * fb.length);
          for (const p of fb) {
            const o = it.find((x) => [x.facebookUrl, x.inputUrl, x.url].some((u) => u && propre(u) === propre(p.lien)));
            // noms de champs actuels de l'outil (likesCount, commentsCount, sharesCount) et anciens noms en secours
            if (o) res.push({ id: p.id, jaime: n(o.likesCount ?? o.likes ?? o.likers?.count ?? o.unified_reactors?.count),
              com: n(o.commentsCount ?? o.comments ?? o.total_comment_count), part: n(o.sharesCount ?? o.shares),
              vues: n(o.viewsCount ?? o.videoViewCount ?? o.videoPostViewCount) });
          }
        } catch (e) {
          if (!BD) { erreurs.push("Facebook : " + (e as Error).message); return; }
          try {
            const it = await brightData("gd_lyclm1571iy3mv57zw", fb.map((p) => p.lien));
            for (const p of fb) {
              const o = it.find((x) => !x.error && [x.url, x.input?.url].some((u) => u && propre(u) === propre(p.lien)));
              if (o) res.push({ id: p.id, jaime: n(o.likes), com: n(o.num_comments), part: n(o.num_shares), vues: n(o.video_view_count ?? o.play_count) });
            }
          } catch (e2) { erreurs.push("Facebook : " + (e as Error).message.slice(0, 120) + " ; secours Bright Data : " + (e2 as Error).message); }
        }
      })(),
      (async () => {
        if (!tk.length) return;
        try {
          const it = await acteur("clockworks/tiktok-scraper", { postURLs: tk.map((p) => p.lien), resultsPerPage: 1 }, 0.5);
          for (const p of tk) {
            const o = it.find((x) => String(x.id) === idTiktok(p.lien));
            if (o) res.push({ id: p.id, jaime: n(o.diggCount), com: n(o.commentCount), part: n(o.shareCount), vues: n(o.playCount) });
          }
        } catch (e) {
          if (!BD) { erreurs.push("TikTok : " + (e as Error).message); return; }
          try {
            const it = await brightData("gd_lu702nij2f790tmv9h", tk.map((p) => p.lien));
            for (const p of tk) {
              const o = it.find((x) => !x.error && (String(x.post_id) === idTiktok(p.lien) || (x.input?.url && idTiktok(x.input.url) === idTiktok(p.lien))));
              if (o) res.push({ id: p.id, jaime: n(o.digg_count ?? o.likes), com: n(o.comment_count), part: n(o.share_count), vues: n(o.play_count) });
            }
          } catch (e2) { erreurs.push("TikTok : " + (e as Error).message.slice(0, 120) + " ; secours Bright Data : " + (e2 as Error).message); }
        }
      })(),
      (async () => {
        if (!xx.length) return;
        try {
          const comptes = [...new Set(xx.map((p) => (p.lien.match(/\.com\/([^/]+)\/status/) || [])[1]).filter(Boolean))];
          const debut = new Date(Math.min(...xx.map((p) => new Date(p.publiee_le || Date.now() - 7 * 864e5).getTime())) - 864e5).toISOString().slice(0, 10);
          const it = await acteur("apidojo/tweet-scraper", { twitterHandles: comptes, start: debut, maxItems: 40, sort: "Latest" }, 0.05);
          for (const p of xx) {
            const o = it.find((x) => String(x.id) === idTweet(p.lien));
            if (o) res.push({ id: p.id, jaime: n(o.likeCount), com: n(o.replyCount), part: n(o.retweetCount), vues: n(o.viewCount) });
          }
        } catch (e) { erreurs.push("X : " + (e as Error).message); }
      })(),
    ]);
    // un relevé sans aucun chiffre n'est jamais enregistré (il s'afficherait comme des zéros)
    for (const r of res.splice(0).filter((x) => [x.jaime, x.com, x.part, x.vues].some((v) => v !== null))) res.push(r);
    for (const r of res) {
      await sql`insert into public.releves(publication_id, releve_le, jaime, com, part, vues) values (${r.id}, now(), ${r.jaime}, ${r.com}, ${r.part}, ${r.vues})`;
      await sql`update public.publications set jaime = coalesce(${r.jaime}, jaime), com = coalesce(${r.com}, com), part = coalesce(${r.part}, part), vues = coalesce(${r.vues}, vues) where id = ${r.id}`;
    }
    const manquants = pubs.filter((p) => !res.some((r) => r.id === p.id)).map((p) => p.id);
    await sql`insert into public.parametres(cle, valeur) values ('dernier_releve_horaire', ${JSON.stringify({ le: new Date().toISOString(), a_relever: pubs.length, releves: res.length, manquants, erreurs })})
              on conflict (cle) do update set valeur = excluded.valeur`;
    if (erreurs.length || (pubs.length && !res.length)) {
      await sql`insert into public.journal(le, type, par, detail) values (now(), 'Incident', 'relevé horaire', ${"Relevé horaire : " + res.length + "/" + pubs.length + " relevés" + (erreurs.length ? " ; " + erreurs.join(" ; ") : "")})`;
    }
    return Response.json({ ok: true, a_relever: pubs.length, releves: res.length, manquants, erreurs });
  } catch (e) {
    await sql`insert into public.journal(le, type, par, detail) values (now(), 'Incident', 'relevé horaire', ${"Relevé horaire : " + (e as Error).message})`.catch(() => {});
    return Response.json({ ok: false, erreur: (e as Error).message }, { status: 500 });
  }
});
