// Fonction « lien-connexion » : envoie à un utilisateur autorisé son lien de connexion à la plateforme
// par le script Gmail de la veille (le service d'e-mail gratuit de Supabase n'écrit qu'aux membres du projet).
// Appel : par la base (x-jeton), par un administrateur connecté (Authorization: Bearer <jeton de session>),
// ou par la page de connexion (sans compte) : le lien part alors uniquement à l'adresse demandée, si elle est
// dans la liste des utilisateurs, 3 fois par heure au plus.
import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const URL_SB = Deno.env.get("SUPABASE_URL")!, SRV = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE = "https://veillecharlysierra.github.io/Veille-quotidienne/";
const CORS = { "Access-Control-Allow-Origin": "https://veillecharlysierra.github.io",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const rep = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    let par = "base", admin = true;
    const [{ valeur: jeton }] = await sql`select valeur from prive.cles where nom = 'jeton_envoi'`;
    if (req.headers.get("x-jeton") !== jeton) {
      admin = false; par = "page de connexion";
      const u = await fetch(URL_SB + "/auth/v1/user", { headers: { Authorization: req.headers.get("authorization") || "", apikey: SRV } });
      if (u.ok) {
        const moi = (await u.json()).email?.toLowerCase();
        if ((await sql`select 1 from public.utilisateurs where lower(email) = ${moi} and role in ('admin','super')`).length) { admin = true; par = moi; }
      }
    }
    const { email, a } = await req.json();
    if (a && !admin) return rep({ ok: false, erreur: "réservé aux administrateurs" }, 403);
    if (!admin) {
      const [{ n }] = await sql`select count(*)::int n from public.journal where type = 'Administration' and detail like ${"Lien de connexion de " + String(email || "").trim().toLowerCase() + " %"} and le > now() - interval '1 hour'`;
      if (n >= 3) return rep({ ok: false, erreur: "trop de liens demandés" }, 429);
    }
    // a : remettre le lien à un super administrateur (qui le transmet lui-même) si l'e-mail n'arrive pas chez la personne
    const relais = a ? String(a).trim().toLowerCase() : "";
    if (relais && !(await sql`select 1 from public.utilisateurs where lower(email) = ${relais} and role = 'super'`).length)
      return rep({ ok: false, erreur: "relais réservé à un super administrateur" }, 400);
    const e = String(email || "").trim().toLowerCase();
    const ok = await sql`select nom from public.utilisateurs where lower(email) = ${e}`;
    if (!ok.length) return rep({ ok: false, erreur: "adresse absente de la liste des utilisateurs" }, 400);
    const g = await fetch(URL_SB + "/auth/v1/admin/generate_link", { method: "POST",
      headers: { Authorization: "Bearer " + SRV, apikey: SRV, "Content-Type": "application/json" },
      body: JSON.stringify({ type: "magiclink", email: e, options: { redirect_to: SITE } }) });
    const gj = await g.json();
    const lien = gj.action_link || gj.properties?.action_link;
    if (!lien) return rep({ ok: false, erreur: "lien non généré : " + JSON.stringify(gj).slice(0, 200) }, 500);
    const gs = await sql`select (select valeur from prive.cles where nom = 'url_gmail_script') as url, (select valeur from prive.cles where nom = 'jeton_gmail') as jeton`;
    const nom = ok[0].nom ? " " + ok[0].nom : "";
    const texte = (relais ? `Lien de connexion de ${e} à lui transmettre (valable une heure, un seul usage ; ne pas l'ouvrir vous-même, sinon il ne servira plus) :\n\n${lien}\n\n---\n\n` : "") + `Bonjour${nom},\n\nVoici votre lien personnel de connexion à la plateforme de veille e-réputationnelle CIE / SODECI (Viral SARL) :\n\n${lien}\n\nCe lien est valable une heure et ne sert qu'une fois. Pour vous reconnecter plus tard, saisissez votre adresse sur la page de la plateforme : un nouveau lien vous sera envoyé.\nAdresse de la plateforme : ${SITE}\n\nViral SARL – document confidentiel`;
    const m = await fetch(gs[0].url, { method: "POST", headers: { "Content-Type": "application/json" }, redirect: "follow",
      body: JSON.stringify({ jeton: gs[0].jeton, to: [relais || e], subject: (relais ? "À transmettre à " + e + " – " : "") + "Votre accès à la plateforme de veille CIE / SODECI", text: texte }) });
    const t = (await m.text()).trim();
    if (t !== "ok") return rep({ ok: false, erreur: "e-mail : " + t.slice(0, 150) }, 500);
    await sql`insert into public.journal(le, type, par, detail) values (now(), 'Administration', ${par}, ${"Lien de connexion de " + e + " envoyé à " + (relais || e)})`;
    return rep({ ok: true });
  } catch (err) {
    return rep({ ok: false, erreur: (err as Error).message }, 500);
  }
});
