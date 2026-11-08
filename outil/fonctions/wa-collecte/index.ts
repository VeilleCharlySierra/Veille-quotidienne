// Fonction « wa-collecte » : reçoit, en lecture seule, les nouveaux messages du groupe WhatsApp des équipes, envoyés par le
// script installé dans le Chrome de l'ordinateur de veille (clé de portée « whatsapp », créée dans l'Administration).
// Circuit rapide : un message qui contient un lien ET signale une coupure d'électricité ou d'eau est enregistré tout de suite
// comme signalement de panne « à vérifier » (onglet Pannes, API). Le passage complet suivant récupère le texte et les chiffres
// de la publication, vérifie le classement et lève la mention « à vérifier ». Les autres messages attendent le passage complet.
import postgres from "npm:postgres@3.4.4";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 1 });
const CORS = { "Access-Control-Allow-Origin": "https://web.whatsapp.com", "Access-Control-Allow-Headers": "x-api-key, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json; charset=utf-8" };
const rep = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: CORS });
async function sha256(t: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const ELEC = /(courant|électricit|electricit|délestage|delestage|dans le noir|chaleur|lumi[eè]re|compteur|cash ?power|poteau|transfo|câble|cable|\bcie\b|coupure)/i;
const EAU = /(\bsodeci\b|pas d.eau|\beau\b|robinet|pénurie d.eau|penurie d.eau)/i;
const PANNE = /(coupure|coupé|coupe|délestage|delestage|pas de courant|pas d.eau|dans le noir|chaleur|parti|panne|noir total|sans courant|sans eau|pénurie|penurie|poteau|compteur bloqué|compteur bloque)/i;
const plateforme = (u: string) => /tiktok\.com/.test(u) ? "TikTok" : /(x|twitter)\.com/.test(u) ? "X" : /facebook\.com|fb\.watch/.test(u) ? "Facebook" : "Média en ligne";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return rep({ erreur: "POST seulement" }, 405);
  try {
    const cle = (req.headers.get("x-api-key") || "").trim();
    if (!/^vcs_[0-9a-f]{48}$/.test(cle)) return rep({ erreur: "clé absente ou invalide" }, 401);
    const [k] = await sql`select id from prive.cles_api where empreinte = ${await sha256(cle)} and actif and portee = 'whatsapp'`;
    if (!k) return rep({ erreur: "clé absente ou invalide" }, 401);
    const corps = await req.json().catch(() => ({}));
    const msgs = Array.isArray(corps.messages) ? corps.messages.slice(0, 100) : [];
    let nouveaux = 0, signalements = 0;
    for (const m of msgs) {
      const id = String(m.id || "").slice(0, 200), texte = String(m.texte || "").slice(0, 4000);
      if (!id) continue;
      const liens: string[] = (Array.isArray(m.liens) ? m.liens : []).map(String).filter((u: string) => /^https?:\/\//.test(u)).slice(0, 5);
      const envoye = m.envoye_le && !isNaN(new Date(m.envoye_le).getTime()) ? new Date(m.envoye_le) : new Date();
      const ins = await sql`insert into public.wa_messages(id, groupe, auteur, envoye_le, texte, liens) values (${id}, ${String(m.groupe || "").slice(0, 200)},
        ${String(m.auteur || "").slice(0, 200)}, ${envoye}, ${texte}, ${liens}) on conflict (id) do nothing returning id`;
      if (!ins.length) continue;
      nouveaux++;
      if (!liens.length || !PANNE.test(texte)) continue;
      const marque = EAU.test(texte) && !ELEC.test(texte.replace(/\bcoupure\b/gi, "")) ? "SODECI" : ELEC.test(texte) ? "CIE" : null;
      if (!marque) continue;
      const [c] = await sql`select a.commune from public.alias_lieux a where public.norm_lieu(${texte}) like '%' || a.cle || '%' order by length(a.cle) desc limit 1`;
      const commune = c?.commune || null;
      const lien = liens[0];
      const deja = await sql`select id from public.publications where lien = ${lien} limit 1`;
      let pid = deja[0]?.id || null;
      if (!pid) {
        const [p] = await sql`insert into public.publications(marque, type, plateforme, texte, theme, lieu, lien, origine, remontee_le, a_verifier, circuit)
          values (${marque}, 'remontee', ${plateforme(lien)}, ${"Signalement transmis par l'équipe de veille, publication en cours de vérification. Message de l'équipe : « " + texte.replace(/https?:\/\/\S+/g, "").trim().slice(0, 300) + " »"},
                  ${marque === "CIE" ? "Coupures d'électricité" : "Coupures et pénuries d'eau"}, ${commune || "Non localisé"}, ${lien}, 'humaine', ${envoye}, true, 'rapide')
          returning id`;
        pid = p.id; signalements++;
      }
      await sql`update public.wa_messages set coupure = ${marque}, commune = ${commune}, publication_id = ${pid} where id = ${id}`;
    }
    await sql`update prive.cles_api set dernier_usage = now(), nb_appels = nb_appels + 1 where id = ${k.id}`;
    if (signalements) await sql`insert into public.journal(le, type, par, detail) values (now(), 'Alerte', 'circuit rapide', ${signalements + " signalement(s) de coupure enregistré(s) dès leur remontée dans le groupe des équipes (à vérifier au prochain passage)"})`;
    return rep({ ok: true, recus: msgs.length, nouveaux, signalements });
  } catch (e) {
    console.error(e);
    return rep({ erreur: "erreur interne" }, 500);
  }
});
