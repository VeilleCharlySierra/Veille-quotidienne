// Fonction « surveillance » : contrôle indépendant de l'ordinateur de veille (lancée par la base toutes les 15 min).
// Si aucun passage n'a démarré depuis 4 h, e-mail d'alerte aux destinataires des incidents (rappel toutes les 6 h),
// puis e-mail « rétabli » dès qu'un passage reprend.
import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const fh = (d: Date) => d.toISOString().slice(8, 10) + "/" + d.toISOString().slice(5, 7) + " à " + d.toISOString().slice(11, 13) + "h" + d.toISOString().slice(14, 16) + " UTC";

async function courriel(dest: string[], sujet: string, texte: string) {
  const gs = await sql`select (select valeur from prive.cles where nom = 'url_gmail_script') as url, (select valeur from prive.cles where nom = 'jeton_gmail') as jeton`;
  const r = await fetch(gs[0].url, { method: "POST", headers: { "Content-Type": "application/json" }, redirect: "follow",
    body: JSON.stringify({ jeton: gs[0].jeton, to: dest, subject: sujet, text: texte }) });
  const t = (await r.text()).trim();
  if (t !== "ok") throw new Error("script Gmail : " + r.status + " " + t.slice(0, 150));
}
const param = async (cle: string) => (await sql`select valeur from public.parametres where cle = ${cle}`)[0]?.valeur ?? null;
const poser = (cle: string, v: string | null) => v === null
  ? sql`delete from public.parametres where cle = ${cle}`
  : sql`insert into public.parametres(cle, valeur) values (${cle}, ${v}) on conflict (cle) do update set valeur = excluded.valeur`;

Deno.serve(async (req) => {
  try {
    const [{ valeur: jeton }] = await sql`select valeur from prive.cles where nom = 'jeton_envoi'`;
    if (req.headers.get("x-jeton") !== jeton) return new Response("refusé", { status: 403 });
    const [{ dernier }] = await sql`select max(debut) as dernier from public.passages`;
    const dest: string[] = JSON.parse((await param("destinataires_incidents")) || "[]");
    const alerte = await param("surveillance_alerte_le");
    const age = (Date.now() - new Date(dernier).getTime()) / 3600e3;
    const lien = "https://veillecharlysierra.github.io/Veille-quotidienne/";
    if (age >= 4) {
      if (!alerte || Date.now() - new Date(alerte).getTime() >= 6 * 3600e3) {
        await courriel(dest, `⚠️ ALERTE DISPOSITIF – aucun passage de veille depuis ${Math.floor(age)} h`,
          `Bonjour,\n\nAucun passage de veille n'a démarré depuis le ${fh(new Date(dernier))} (${Math.floor(age)} heures).\n` +
          `Causes possibles : ordinateur de veille éteint, en veille, sans internet ou sans courant ; application Claude fermée ; limite d'abonnement atteinte.\n\n` +
          `À vérifier sur l'ordinateur de veille : allumé, connecté, application Claude ouverte.\n` +
          `Le rapport de 06h00 et les e-mails automatiques continuent de partir depuis le serveur, mais sans nouvelles publications.\n\n` +
          `Message envoyé par le serveur, indépendamment de l'ordinateur de veille. Rappel toutes les 6 heures tant que la situation dure.\n${lien}`);
        await poser("surveillance_alerte_le", new Date().toISOString());
        await sql`insert into public.journal(le, type, par, detail) values (now(), 'Incident', 'surveillance serveur', ${"Aucun passage depuis " + Math.floor(age) + " h : alerte e-mail envoyée à " + dest.join(", ")})`;
        return Response.json({ ok: true, etat: "alerte envoyée", age });
      }
      return Response.json({ ok: true, etat: "alerte déjà envoyée", age });
    }
    if (alerte) {
      await courriel(dest, "✅ DISPOSITIF RÉTABLI – les passages de veille ont repris",
        `Bonjour,\n\nLes passages de veille ont repris : dernier passage démarré le ${fh(new Date(dernier))}.\n\n${lien}`);
      await poser("surveillance_alerte_le", null);
      await sql`insert into public.journal(le, type, par, detail) values (now(), 'Incident', 'surveillance serveur', ${"Passages repris (" + fh(new Date(dernier)) + ") : e-mail de rétablissement envoyé"})`;
      return Response.json({ ok: true, etat: "rétabli" });
    }
    return Response.json({ ok: true, etat: "normal", age });
  } catch (e) {
    return Response.json({ ok: false, erreur: (e as Error).message }, { status: 500 });
  }
});
