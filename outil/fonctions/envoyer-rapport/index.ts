// Fonction « envoyer-rapport » : reprend le rapport du jour déposé dans le stockage « rapports »
// (par la tâche du matin) et l'envoie par e-mail (script Gmail, Resend ou Gmail SMTP).
import postgres from "npm:postgres@3.4.4";
import nodemailer from "npm:nodemailer@6.9.14";
import { encodeBase64 } from "jsr:@std/encoding@1.0.5/base64";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });

const journal = (type: string, detail: string) =>
  sql`insert into public.journal(le, type, par, detail) values (now(), ${type}, 'envoi automatique', ${detail})`;

async function courriel(dest: string[], sujet: string, texte: string, pj?: { filename: string; content: Uint8Array }) {
  // 1) Script Google du compte Gmail de la veille (gratuit, sans SMS ni domaine)
  const gs = await sql`select (select valeur from prive.cles where nom = 'url_gmail_script') as url, (select valeur from prive.cles where nom = 'jeton_gmail') as jeton`;
  if (gs[0].url) {
    const r = await fetch(gs[0].url, { method: "POST", headers: { "Content-Type": "application/json" }, redirect: "follow",
      body: JSON.stringify({ jeton: gs[0].jeton, to: dest, subject: sujet, text: texte,
        filename: pj?.filename, b64: pj ? encodeBase64(pj.content) : undefined }) });
    const t = (await r.text()).trim();
    if (t !== "ok") throw new Error("script Gmail : " + r.status + " " + t.slice(0, 150));
    return "e-mail envoyé à " + dest.join(", ");
  }
  const rk = Deno.env.get("RESEND_API_KEY");
  if (rk) {
    // Resend (offre gratuite) : expéditeur sur le domaine vérifié, défini par le secret RESEND_FROM
    const from = Deno.env.get("RESEND_FROM") || "Veille e-réputation Viral <onboarding@resend.dev>";
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: "Bearer " + rk, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: dest, subject: sujet, text: texte,
        attachments: pj ? [{ filename: pj.filename, content: encodeBase64(pj.content) }] : undefined }) });
    if (!r.ok) throw new Error("Resend " + r.status + " : " + (await r.text()).slice(0, 200));
    return "e-mail envoyé à " + dest.join(", ");
  }
  const user = Deno.env.get("GMAIL_USER"), pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) return "envoi e-mail non configuré (script Gmail non installé)";
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass: pass.replace(/\s/g, "") } });
  await t.sendMail({ from: `Veille e-réputation Viral <${user}>`, to: dest.join(", "), subject: sujet, text: texte,
    attachments: pj ? [{ filename: pj.filename, content: pj.content, contentType: "application/pdf" }] : [] });
  return "e-mail envoyé à " + dest.join(", ");
}

Deno.serve(async (req) => {
  try {
    const [{ valeur: jeton }] = await sql`select valeur from prive.cles where nom = 'jeton_envoi'`;
    if (req.headers.get("x-jeton") !== jeton) return new Response("refusé", { status: 403 });
    const corps = await req.json().catch(() => ({}));
    const jour: string = corps.jour || new Date().toISOString().slice(0, 10);
    const envoyer = corps.envoyer !== false;
    const jfr = jour.split("-").reverse().join("/");
    const fichier = "Rapport_de_veille_quotidien_" + jour.split("-").reverse().join("") + ".pdf";
    const [{ valeur: dj }] = await sql`select coalesce((select valeur from public.parametres where cle = 'destinataires_rapport'), '[]') as valeur`;
    const dest: string[] = JSON.parse(dj);

    // le PDF est déposé dans le stockage par la tâche du matin (page depot.html)
    const deja = await sql`select 1 from public.rapports_journaliers where jour = ${jour} and fichier = ${fichier}`;
    const srv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let pdf: Uint8Array | null = null;
    if (deja.length) {
      const r = await fetch(Deno.env.get("SUPABASE_URL") + "/storage/v1/object/rapports/" + fichier,
        { headers: { Authorization: "Bearer " + srv, apikey: srv }, signal: AbortSignal.timeout(30000) }).catch(() => null);
      if (r && r.ok) pdf = new Uint8Array(await r.arrayBuffer());
    }
    if (!pdf || pdf.length < 1000) {
      const m = await courriel(dest, `Rapport de veille du ${jfr} : non disponible`,
        `Le rapport quotidien de veille du ${jfr} n'a pas été produit à temps. L'équipe Viral a été prévenue.`).catch((e) => "échec e-mail : " + e.message);
      await journal("Incident", `Rapport du ${jfr} introuvable à l'heure d'envoi ; ${m}`);
      return Response.json({ ok: false, raison: "rapport absent", email: m });
    }

    let m = "envoi e-mail non demandé";
    if (envoyer) {
      m = await courriel(dest, `Rapport quotidien de veille e-réputationnelle CIE / SODECI – ${jfr}`,
        `Bonjour,\n\nVeuillez trouver ci-joint le rapport quotidien de veille e-réputationnelle CIE / SODECI du ${jfr}.\n` +
        `Il est aussi disponible sur la plateforme, onglet Rapports :\nhttps://veillecharlysierra.github.io/Veille-quotidienne/\n\nViral SARL – document confidentiel`,
        { filename: fichier, content: pdf }).catch((e) => "échec e-mail : " + e.message);
    }
    await journal("Rapport", `Rapport journalier du ${jfr} rangé dans l'onglet Rapports ; ${m}`);
    return Response.json({ ok: true, fichier, email: m });
  } catch (e) {
    await journal("Incident", "Envoi du rapport : " + (e as Error).message).catch(() => {});
    return Response.json({ ok: false, erreur: (e as Error).message }, { status: 500 });
  }
});
