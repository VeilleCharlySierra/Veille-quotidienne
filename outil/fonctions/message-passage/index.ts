// Fonction « message-passage » : après chaque passage enregistré (déclencheur sur la table passages), envoie par e-mail
// aux destinataires des incidents le message « 🚨 ALERTE DISPOSITIF » quand le passage a un incident (le RAS ne part que dans WhatsApp).
// Les chiffres viennent de la base ; le motif d'un incident reprend le début du compte rendu du passage.
import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const hh = (d: Date) => String(d.getUTCHours()).padStart(2, "0") + "h" + String(d.getUTCMinutes()).padStart(2, "0");
const jj = (d: Date) => d.toISOString().slice(8, 10) + "/" + d.toISOString().slice(5, 7);

Deno.serve(async (req) => {
  try {
    const [{ valeur: jeton }] = await sql`select valeur from prive.cles where nom = 'jeton_envoi'`;
    if (req.headers.get("x-jeton") !== jeton) return new Response("refusé", { status: 403 });
    const { id } = await req.json();
    const [p] = await sql`select * from public.passages where id = ${id}`;
    if (!p) return Response.json({ ok: false, erreur: "passage introuvable" });
    const debut = new Date(p.debut), fin = p.fin ? new Date(p.fin) : new Date();
    const [c] = await sql`select count(*) filter (where marque = 'CIE')::int cie, count(*) filter (where marque = 'SODECI')::int sodeci
      from public.publications where cree_le >= ${debut} and cree_le <= ${fin}`;
    const [a] = await sql`select count(*)::int n from public.publications where point_attention and coalesce(statut_alerte,'') <> 'Alerte close'`;
    const th = await sql`select marque::text, theme from public.themes_alerte where actif order by marque, theme`;
    const incident = /incident/i.test(p.statut || "");
    // Décision du 09/11 : le RAS part seulement dans WhatsApp (KKS) ; l'e-mail est réservé aux alertes dispositif
    if (!incident) return Response.json({ ok: true, envoye: false, raison: "RAS : WhatsApp seulement" });
    const motif = String(p.detail || "").split(/Collecte\s*:/)[0].replace(/apify/gi, "collecte automatisée").replace(/\s+/g, " ").trim().slice(0, 600);
    const lien = "https://veillecharlysierra.github.io/Veille-quotidienne/";
    const sujet = incident
      ? `🚨 ALERTE DISPOSITIF – passage de ${hh(debut)} UTC (${jj(debut)})`
      : `✅ DISPOSITIF RAS – passage de ${hh(debut)} UTC (${jj(debut)})`;
    const texte = `Bonjour,\n\n` +
      (incident ? `Le passage de veille de ${hh(debut)} UTC (${jj(debut)}) s'est terminé avec un incident :\n${motif || "détail non précisé"}\n\n`
                : `Le passage de veille de ${hh(debut)} UTC (${jj(debut)}) s'est déroulé sans incident.\n\n`) +
      `Nouvelles publications : ${c.cie + c.sodeci} (${c.cie} CIE, ${c.sodeci} SODECI)\n` +
      `Points d'attention actifs : ${a.n}\n` +
      `Thématiques en alerte : ${th.length ? th.map((t) => t.marque + " – " + t.theme).join(" ; ") : "aucune"}\n\n` +
      `Plateforme : ${lien}\n\nViral SARL – document confidentiel`;
    const dest: string[] = JSON.parse((await sql`select coalesce((select valeur from public.parametres where cle = 'destinataires_incidents'), '[]') v`)[0].v);
    if (!dest.length) return Response.json({ ok: true, envoye: false, raison: "aucun destinataire" });
    const gs = await sql`select (select valeur from prive.cles where nom = 'url_gmail_script') as url, (select valeur from prive.cles where nom = 'jeton_gmail') as jeton`;
    const r = await fetch(gs[0].url, { method: "POST", headers: { "Content-Type": "application/json" }, redirect: "follow",
      body: JSON.stringify({ jeton: gs[0].jeton, to: dest, subject: sujet, text: texte }) });
    const t = (await r.text()).trim();
    if (t !== "ok") throw new Error("script Gmail : " + r.status + " " + t.slice(0, 150));
    await sql`insert into public.journal(le, type, par, detail) values (now(), 'E-mail', 'message de passage', ${(incident ? "Alerte dispositif" : "RAS") + " du passage de " + hh(debut) + " envoyé à " + dest.join(", ")})`;
    return Response.json({ ok: true, envoye: true, incident });
  } catch (e) {
    await sql`insert into public.journal(le, type, par, detail) values (now(), 'Incident', 'message de passage', ${"E-mail du passage non envoyé : " + (e as Error).message})`.catch(() => {});
    return Response.json({ ok: false, erreur: (e as Error).message }, { status: 500 });
  }
});
