// Fonction « envoyer-rapport » : récupère le rapport quotidien chiffré déposé dans le dépôt,
// le range dans le stockage « rapports » (onglet Rapports de la page) et l'envoie par e-mail (Gmail SMTP).
import postgres from "npm:postgres@3.4.4";
import nodemailer from "npm:nodemailer@6.9.14";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const DEPOT = "https://raw.githubusercontent.com/VeilleCharlySierra/Veille-quotidienne/main/envoi/";

const hex = (h: string) => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));
const journal = (type: string, detail: string) =>
  sql`insert into public.journal(le, type, par, detail) values (now(), ${type}, 'envoi automatique', ${detail})`;

async function courriel(dest: string[], sujet: string, texte: string, pj?: { filename: string; content: Uint8Array }) {
  const user = Deno.env.get("GMAIL_USER"), pass = Deno.env.get("GMAIL_APP_PASSWORD");
  if (!user || !pass) return "envoi e-mail non configuré (mot de passe d'application Gmail absent)";
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

    const r = await fetch(DEPOT + "rapport_" + jour + ".bin?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) {
      const m = await courriel(dest, `Rapport de veille du ${jfr} : non disponible`,
        `Le rapport quotidien de veille du ${jfr} n'a pas été produit à temps. L'équipe Viral a été prévenue.`).catch((e) => "échec e-mail : " + e.message);
      await journal("Incident", `Rapport du ${jfr} introuvable à l'heure d'envoi ; ${m}`);
      return Response.json({ ok: false, raison: "rapport absent", email: m });
    }
    const brut = new Uint8Array(await r.arrayBuffer());
    if (brut.length < 1000) throw new Error("fichier reçu trop court (" + brut.length + " octets)");
    const [{ valeur: cle }] = await sql`select valeur from prive.cles where nom = 'cle_rapport'`;
    const k = await crypto.subtle.importKey("raw", hex(cle), "AES-GCM", false, ["decrypt"]);
    const pdf = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: brut.slice(0, 12) }, k, brut.slice(12)));

    const cle_srv = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const up = await fetch(Deno.env.get("SUPABASE_URL") + "/storage/v1/object/rapports/" + fichier, {
      method: "POST", body: pdf,
      headers: { Authorization: "Bearer " + cle_srv, apikey: cle_srv, "Content-Type": "application/pdf", "x-upsert": "true" } });
    if (!up.ok) throw new Error("stockage " + up.status + " : " + (await up.text()).slice(0, 200));
    await sql`delete from public.rapports_journaliers where jour = ${jour}`;
    await sql`insert into public.rapports_journaliers(jour, fichier, cree_le) values (${jour}, ${fichier}, now())`;

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
