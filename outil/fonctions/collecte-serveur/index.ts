// Fonction « collecte-serveur » (préparée le 09/11/2026, NON ACTIVÉE pendant le test) : la collecte automatisée faite par le serveur,
// sans Claude ni ordinateur de veille. Elle lance les recherches Facebook, X (et TikTok une fois par jour), écarte ce qui est déjà
// connu et dépose les nouveautés dans la file « a_classer », avec texte, auteur, date, chiffres et image (pour la capture).
// Claude n'a plus qu'à classer cette file au passage. Activation : parametres.collecte_serveur.active = true + tâche planifiée.
// Format retenu (09/11) pour l'activation, tâche planifiée toutes les heures : Facebook par mots-clés toutes les 2 heures (heures paires) ;
// X toutes les heures ; TikTok : comptes suivis (liste cible d'environ 500 comptes dans sources_suivies) 3 fois par jour (06h, 13h, 20h),
// seules les vidéos publiées depuis le relevé précédent, plus les hashtags en filet de sécurité une fois par jour (06h).
// Appel manuel d'essai : corps {"essai": true} (une seule recherche Facebook de 5 résultats, rien n'est modifié dans la rotation).
import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const TOKEN = Deno.env.get("APIFY_TOKEN") || "";

// Répartition de l'effort : 80 % CIE, 20 % SODECI (décision du 07/11)
const MOTS_CIE = ["CIE coupure", "délestage Abidjan", "coupure courant Côte d'Ivoire", "CIE facture", "CIE courant", "dans le noir",
  "nous sommes dans la chaleur", "compteur à carte", "poteau électrique", "pas de courant", "courant est parti", "lumière est partie",
  "cash power", "compteur bloqué", "facture salée"];
const MOTS_SODECI = ["SODECI eau", "SODECI coupure", "pas d'eau"];
const X_TERMES = ["CIE coupure", "délestage Abidjan", "\"coupure de courant\" Abidjan", "CIE électricité"];
const HEURES_SODECI = [4, 12, 20];
const HEURES_TIKTOK = [6, 13, 20];
const HASHTAGS = ["coupuredecourant", "cieci", "delestage", "sodeci"];

async function acteur(nom: string, input: unknown, plafond: number): Promise<any[]> {
  const url = `https://api.apify.com/v2/acts/${nom.replace("/", "~")}/run-sync-get-dataset-items?timeout=120&maxTotalChargeUsd=${plafond.toFixed(3)}`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + TOKEN },
    body: JSON.stringify(input), signal: AbortSignal.timeout(140000) });
  if (!r.ok) throw new Error(nom + " " + r.status + " " + (await r.text()).slice(0, 160));
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}
const n = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.round(v) : null);
const d = (v: unknown) => { const t = typeof v === "number" ? new Date(v) : new Date(String(v || "")); return isNaN(t.getTime()) ? null : t; };

type Element = { plateforme: string; auteur: string; texte: string; lien: string; publiee_le: Date | null; image: string | null;
  jaime: number | null; com: number | null; part: number | null; vues: number | null; abonnes: number | null; mot_cle: string; marque: string; brut: unknown };

function facebook(o: any, mot: string, marque: string): Element | null {
  const lien = o.url || o.postUrl; if (!lien) return null;
  const partage = o.sharedPost || {};
  const texte = [o.postText, partage.postText ? "Publication partagée : " + partage.postText : ""].filter(Boolean).join("\n");
  const att = (o.attachments || partage.attachments || []).find((a: any) => a?.url && /photo|image|video/i.test(a.type || "photo"));
  return { plateforme: "Facebook", auteur: o.author?.name || "", texte, lien, publiee_le: d(o.timestamp), image: att?.url || null,
    jaime: n(o.reactionsCount), com: n(o.commentsCount), part: n(o.sharesCount), vues: null, abonnes: null, mot_cle: mot, marque, brut: null };
}
function tweet(o: any, mot: string): Element | null {
  const lien = o.url || o.twitterUrl; if (!lien) return null;
  const media = (o.extendedEntities?.media || o.media || [])[0];
  return { plateforme: "X", auteur: o.author?.name ? `${o.author.name} (@${o.author.userName})` : "", texte: o.text || o.fullText || "", lien,
    publiee_le: d(o.createdAt), image: media?.media_url_https || null, jaime: n(o.likeCount), com: n(o.replyCount), part: n(o.retweetCount),
    vues: n(o.viewCount), abonnes: n(o.author?.followers), mot_cle: mot, marque: /sodeci/i.test(mot) ? "SODECI" : "CIE", brut: null };
}
function tiktok(o: any, mot: string): Element | null {
  const lien = o.webVideoUrl; if (!lien) return null;
  return { plateforme: "TikTok", auteur: o.authorMeta?.nickName ? `${o.authorMeta.nickName} (@${o.authorMeta.name})` : "", texte: o.text || "", lien,
    publiee_le: d(o.createTimeISO), image: o.videoMeta?.coverUrl || null, jaime: n(o.diggCount), com: n(o.commentCount), part: n(o.shareCount),
    vues: n(o.playCount), abonnes: n(o.authorMeta?.fans), mot_cle: mot, marque: /sodeci/i.test(mot) ? "SODECI" : "CIE", brut: null };
}

Deno.serve(async (req) => {
  try {
    const [{ valeur: jeton }] = await sql`select valeur from prive.cles where nom = 'jeton_envoi'`;
    if (req.headers.get("x-jeton") !== jeton) return new Response("refusé", { status: 403 });
    const corps = await req.json().catch(() => ({}));
    const essai = corps.essai === true;
    const [p] = await sql`select valeur from public.parametres where cle = 'collecte_serveur'`;
    const conf = JSON.parse(p?.valeur || "{}");
    if (!conf.active && !essai) return Response.json({ ok: false, raison: "collecte serveur non activée (prévue après le test)" });
    if (!TOKEN) return Response.json({ ok: false, raison: "clé de collecte absente" });

    const heure = new Date().getUTCHours(), rot = Number(conf.rotation) || 0;
    const fb: [string, string][] = essai ? [[MOTS_CIE[rot % MOTS_CIE.length], "CIE"]]
      : heure % 2 === 1 ? []
      : HEURES_SODECI.includes(heure)
        ? [[MOTS_CIE[rot % MOTS_CIE.length], "CIE"], [MOTS_SODECI[rot % MOTS_SODECI.length], "SODECI"]]
        : [[MOTS_CIE[(2 * rot) % MOTS_CIE.length], "CIE"], [MOTS_CIE[(2 * rot + 1) % MOTS_CIE.length], "CIE"]];
    const elements: Element[] = [], erreurs: string[] = [];
    await Promise.all([
      ...fb.map(async ([mot, marque]) => {
        try {
          const it = await acteur("scraper_one/facebook-posts-search", { query: mot, resultsCount: essai ? 5 : 20, searchType: "latest" }, essai ? 0.03 : 0.08);
          it.forEach((o) => { const e = facebook(o, mot, marque); if (e) elements.push(e); });
        } catch (e) { erreurs.push("Facebook « " + mot + " » : " + (e as Error).message); }
      }),
      (async () => {
        if (essai) return;
        const termes = X_TERMES.map((t) => (HEURES_SODECI.includes(heure) && t === "CIE électricité" ? "SODECI" : t));
        try {
          const hier = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
          const it = await acteur("apidojo/tweet-scraper", { searchTerms: termes, sort: "Latest", start: hier, maxItems: 40 }, 0.05);
          it.forEach((o) => { const e = tweet(o, termes.join(" | ")); if (e) elements.push(e); });
        } catch (e) { erreurs.push("X : " + (e as Error).message); }
      })(),
      (async () => {
        if (essai || !HEURES_TIKTOK.includes(heure)) return;
        try {
          const depuis = conf.tiktok_depuis ? new Date(conf.tiktok_depuis) : new Date(Date.now() - 864e5);
          const profils = (await sql`select url from public.sources_suivies where actif and plateforme = 'TikTok' and categorie <> 'hashtag'`)
            .map((r) => (String(r.url).match(/@([^/?]+)/) || [])[1]).filter(Boolean);
          const entree: Record<string, unknown> = { profiles: profils, profileSorting: "latest", oldestPostDateUnified: depuis.toISOString().slice(0, 10), resultsPerPage: 5 };
          if (heure === HEURES_TIKTOK[0]) entree.hashtags = HASHTAGS;
          const it = await acteur("clockworks/tiktok-scraper", entree, Math.min(3, 0.1 + profils.length * 0.01));
          it.filter((o) => !o.createTimeISO || new Date(o.createTimeISO) > depuis)
            .forEach((o) => { const e = tiktok(o, "TikTok (comptes suivis" + (entree.hashtags ? " et hashtags)" : ")")); if (e) elements.push(e); });
          conf.tiktok_depuis = new Date().toISOString();
        } catch (e) { erreurs.push("TikTok : " + (e as Error).message); }
      })(),
    ]);

    // dépôt dans la file à classer, sans doublon (déjà publié ou déjà en file)
    let nouveaux = 0;
    for (const e of elements) {
      if (e.publiee_le && e.publiee_le.getTime() < Date.now() - 3 * 864e5) continue;
      const [deja] = await sql`select 1 as x from public.publications where lien = ${e.lien} limit 1`;
      if (deja) continue;
      const r = await sql`insert into public.a_classer(source, plateforme, auteur, texte, lien, publiee_le, image, jaime, com, part, vues, abonnes, mot_cle, circuit, marque_probable)
        values (${"Recherche " + e.plateforme}, ${e.plateforme}, ${e.auteur}, ${e.texte.slice(0, 3000)}, ${e.lien}, ${e.publiee_le}, ${e.image},
                ${e.jaime}, ${e.com}, ${e.part}, ${e.vues}, ${e.abonnes}, ${e.mot_cle}, ${essai ? "serveur (essai)" : "serveur"}, ${e.marque})
        on conflict (lien) do nothing returning id`;
      if (r.length) nouveaux++;
    }
    if (!essai) await sql`update public.parametres set valeur = ${JSON.stringify({ ...conf, rotation: rot + 1, derniere: new Date().toISOString(), nouveaux, erreurs })} where cle = 'collecte_serveur'`;
    if (erreurs.length) await sql`insert into public.journal(le, type, par, detail) values (now(), 'Incident', 'collecte serveur', ${"Collecte serveur : " + erreurs.join(" ; ")})`;
    return Response.json({ ok: true, essai, recherches: fb.map((x) => x[0]), recus: elements.length, nouveaux, erreurs });
  } catch (e) {
    return Response.json({ ok: false, erreur: (e as Error).message }, { status: 500 });
  }
});
