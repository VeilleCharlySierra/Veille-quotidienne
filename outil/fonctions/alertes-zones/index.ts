// Fonction « alertes-zones » : après chaque passage, envoie (1) les détections de termes surveillés aux destinataires du rapport et (2) à chaque responsable de zone les nouveaux signalements
// de sa zone : toutes les nouvelles publications remontées citant ses localités, et les commentaires signalant une coupure sous les points d'attention et publications suivies,
// avec le lien de la publication (publication commentée pour un commentaire). Rien n'est envoyé s'il n'y a rien de nouveau.
import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const journal = (type: string, detail: string) =>
  sql`insert into public.journal(le, type, par, detail) values (now(), ${type}, 'alertes zones', ${detail})`;
const fmt = (d: Date) => d.toISOString().slice(8, 10) + "/" + d.toISOString().slice(5, 7) + " " +
  d.toISOString().slice(11, 13) + "h" + d.toISOString().slice(14, 16);

async function courriel(dest: string[], sujet: string, texte: string) {
  const gs = await sql`select (select valeur from prive.cles where nom = 'url_gmail_script') as url, (select valeur from prive.cles where nom = 'jeton_gmail') as jeton`;
  if (!gs[0].url) throw new Error("script Gmail non configuré");
  const r = await fetch(gs[0].url, { method: "POST", headers: { "Content-Type": "application/json" }, redirect: "follow",
    body: JSON.stringify({ jeton: gs[0].jeton, to: dest, subject: sujet, text: texte }) });
  const t = (await r.text()).trim();
  if (t !== "ok") throw new Error("script Gmail : " + r.status + " " + t.slice(0, 150));
}

Deno.serve(async (req) => {
  try {
    const [{ valeur: jeton }] = await sql`select valeur from prive.cles where nom = 'jeton_envoi'`;
    if (req.headers.get("x-jeton") !== jeton) return new Response("refusé", { status: 403 });
    const corps = await req.json().catch(() => ({}));
    const envoyer = corps.envoyer !== false;
    const [{ depuis }] = await sql`select coalesce((select valeur::timestamptz from public.parametres where cle = 'dernier_envoi_zones'), now() - interval '3 hours') as depuis`;
    // (a) toutes les nouvelles publications remontées citant une localité de la zone (toutes thématiques) ;
    // (b) les commentaires signalant une coupure sous les points d'attention et publications suivies (vue pannes).
    const lignes = await sql`
      select * from (
        select 'publication'::text as source, p.id, p.marque::text as marque, p.plateforme, p.texte, p.theme, p.lieu as detail,
               coalesce(p.publiee_le, p.remontee_le) as le, p.lien, public.commune_de(p.lieu) as commune, z.nom as zone, z.email_responsable
        from public.publications p
        join public.zones z on z.marque = p.marque
          and exists (select 1 from unnest(z.localites) l(l) where public.commune_de(l.l) = public.commune_de(p.lieu))
        where p.type = 'remontee' and p.cree_le > ${depuis} and public.commune_de(p.lieu) is not null
        union all
        select 'commentaire', pa.id, pa.marque::text, pa.plateforme, pa.texte, 'Signalement de coupure (commentaire)', pa.detail,
               pa.le, pa.lien, pa.commune, pa.zone, z.email_responsable
        from public.pannes pa join public.zones z on z.marque = pa.marque and z.nom = pa.zone
        where pa.source = 'commentaire' and pa.releve_le > ${depuis}
      ) x where email_responsable is not null
      order by zone, le desc`;
    const parZone = new Map<string, typeof lignes>();
    for (const l of lignes) {
      const k = l.marque + "|" + l.zone + "|" + l.email_responsable;
      if (!parZone.has(k)) parZone.set(k, [] as unknown as typeof lignes);
      parZone.get(k)!.push(l);
    }
    const bilan: string[] = [];
    for (const [k, ls] of parZone) {
      const [marque, zone, email] = k.split("|");
      const nbC = ls.filter((l) => l.source === "commentaire").length;
      const nbCoup = ls.filter((l) => /^Coupure|coupure/.test(l.theme || "")).length;
      const texte = `Bonjour,\n\nNouveaux éléments sur les localités de la zone ${zone} (${marque}) depuis le dernier envoi :\n` +
        `${ls.length - nbC} publication(s) remontée(s) citant vos localités (toutes thématiques) et ${nbC} commentaire(s) signalant une coupure ; ${nbCoup} élément(s) concernent une coupure.\n\n` +
        ls.map((l, i) => `${i + 1}. ${l.commune} – ${l.detail}\n   Thématique : ${l.theme || "non classée"}\n   Date : ${fmt(new Date(l.le))} UTC · ${l.source === "commentaire" ? "Commentaire" : "Publication"} · ${l.plateforme}\n` +
          `   Extrait : « ${String(l.texte || "").replace(/\s+/g, " ").slice(0, 220)} »\n` +
          `   Lien${l.source === "commentaire" ? " (publication commentée)" : ""} : ${l.lien || "non disponible"}`).join("\n\n") +
        `\n\nToutes les publications : plateforme de veille (onglets Publications et Pannes)\nhttps://veillecharlysierra.github.io/Veille-quotidienne/\n\nViral SARL – document confidentiel`;
      if (envoyer) {
        try {
          await courriel([email], `Veille ${marque} – nouveautés sur la zone ${zone} (${ls.length})`, texte);
          bilan.push(`${zone} : ${ls.length} élément(s) envoyés à ${email}`);
        } catch (e) { bilan.push(`${zone} : échec e-mail (${(e as Error).message})`); }
      } else bilan.push(`${zone} : ${ls.length} élément(s) (essai, sans e-mail)`);
    }
    // Termes surveillés : un e-mail groupé aux destinataires du rapport pour les détections pas encore envoyées
    const at = await sql`select * from public.alertes_termes where mail_envoye_le is null order by marque, terme, trouve_le`;
    if (at.length) {
      const [{ valeur: dj }] = await sql`select coalesce((select valeur from public.parametres where cle = 'destinataires_rapport'), '[]') as valeur`;
      const dest: string[] = JSON.parse(dj);
      const termes = [...new Set(at.map((a) => `« ${String(a.terme).replace(/\*$/, "")} » (${a.marque})`))].join(", ");
      const texte = `Bonjour,\n\nTerme(s) surveillé(s) détecté(s) depuis le dernier passage de veille : ${termes}.\n\n` +
        at.map((a, i) => `${i + 1}. ${a.marque} · terme « ${a.terme} » · ${a.source === "commentaire" ? "commentaire" : "publication"} · ${fmt(new Date(a.trouve_le))} UTC\n` +
          `   Extrait : « ${String(a.extrait || "").slice(0, 220)} »\n` +
          `   Lien${a.source === "commentaire" ? " (publication commentée)" : ""} : ${a.lien || "non disponible"}`).join("\n\n") +
        `\n\nPlateforme de veille : https://veillecharlysierra.github.io/Veille-quotidienne/\n\nViral SARL – document confidentiel`;
      if (envoyer && dest.length) {
        try {
          await courriel(dest, `Veille CIE / SODECI – terme surveillé détecté (${at.length})`, texte);
          await sql`update public.alertes_termes set mail_envoye_le = now() where id in ${sql(at.map((a) => a.id))}`;
          bilan.push(`termes surveillés : ${at.length} détection(s) envoyées à ${dest.join(", ")}`);
        } catch (e) { bilan.push(`termes surveillés : échec e-mail (${(e as Error).message})`); }
      } else bilan.push(`termes surveillés : ${at.length} détection(s) (essai, sans e-mail)`);
    }
    if (envoyer) {
      await sql`insert into public.parametres(cle, valeur) values ('dernier_envoi_zones', ${new Date().toISOString()})
                on conflict (cle) do update set valeur = excluded.valeur`;
      if (bilan.length) await journal("Alerte", "E-mails automatiques : " + bilan.join(" ; "));
    }
    return Response.json({ ok: true, depuis, n: lignes.length, bilan, apercu: envoyer ? undefined : lignes.slice(0, 3) });
  } catch (e) {
    await journal("Incident", "Alertes zones : " + (e as Error).message).catch(() => {});
    return Response.json({ ok: false, erreur: (e as Error).message }, { status: 500 });
  }
});
