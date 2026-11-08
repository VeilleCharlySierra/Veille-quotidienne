// ==UserScript==
// @name         Veille – remontées du groupe WhatsApp (lecture seule)
// @namespace    https://veillecharlysierra.github.io/Veille-quotidienne/
// @version      1.1
// @description  Transmet à la plateforme de veille, dès leur arrivée, les nouveaux messages du groupe des équipes. Lecture seule : n'écrit jamais dans WhatsApp.
// @match        https://web.whatsapp.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      vtpfgzrlyqdjrulotxni.supabase.co
// @run-at       document-idle
// ==/UserScript==
(function () {
  "use strict";
  const GROUPE = "Remontées publications CIE- Sodeci";
  const URL_COLLECTE = "https://vtpfgzrlyqdjrulotxni.supabase.co/functions/v1/wa-collecte";
  const vus = new Set(JSON.parse(GM_getValue("vus", "[]")));
  let envoiEnCours = false;

  // Clé du script : créée par le super administrateur (Administration > Script WhatsApp), saisie une seule fois par le menu
  // Tampermonkey « Saisir la clé de la veille ». Jamais de fenêtre automatique (elle bloquerait les passages de veille).
  GM_registerMenuCommand("Saisir la clé de la veille", () => {
    const k = (window.prompt("Collez la clé du script WhatsApp (Administration de la plateforme de veille) :") || "").trim();
    if (/^vcs_[0-9a-f]{48}$/.test(k)) { GM_setValue("cle", k); window.alert("Clé enregistrée. Ouvrez le groupe des équipes : ses nouveaux messages seront transmis à la veille."); }
    else if (k) window.alert("Clé non reconnue : elle doit commencer par vcs_ et compter 52 caractères.");
  });
  const cle = () => { const k = GM_getValue("cle", ""); return /^vcs_[0-9a-f]{48}$/.test(k) ? k : ""; };

  function titreConversation() {
    const h = document.querySelector("#main header");
    if (!h) return "";
    const s = h.querySelector("span[title]");
    return (s ? s.getAttribute("title") : (h.innerText || "").split("\n")[0]).trim();
  }

  // « [21:50, 08/11/2026] Nom : » → date et auteur
  function entete(pre) {
    const m = (pre || "").match(/^\[(\d{1,2}):(\d{2}),\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\]\s*(.*?):\s*$/);
    if (!m) return { auteur: "", date: null };
    const d = new Date(+m[5], +m[4] - 1, +m[3], +m[1], +m[2]);
    return { auteur: m[6], date: isNaN(d) ? null : d.toISOString() };
  }

  function lireMessages() {
    const out = [];
    document.querySelectorAll("#main div[data-id]").forEach((el) => {
      const id = el.getAttribute("data-id");
      if (!id || vus.has(id)) return;
      const c = el.querySelector(".copyable-text[data-pre-plain-text]");
      if (!c) return; // message système ou image sans texte : laissé au passage complet
      const { auteur, date } = entete(c.getAttribute("data-pre-plain-text"));
      const t = c.querySelector("span.selectable-text");
      const texte = ((t && t.innerText) || c.innerText || "").trim();
      const liens = [...el.querySelectorAll("a[href]")].map((a) => a.href).filter((u) => /^https?:\/\//.test(u) && !/whatsapp\.com/.test(u));
      out.push({ id, groupe: GROUPE, auteur, envoye_le: date, texte, liens: [...new Set(liens)] });
    });
    return out;
  }

  function envoyer(msgs, k) {
    envoiEnCours = true;
    GM_xmlhttpRequest({
      method: "POST", url: URL_COLLECTE, timeout: 20000,
      headers: { "Content-Type": "application/json", "x-api-key": k },
      data: JSON.stringify({ messages: msgs }),
      onload: (r) => {
        envoiEnCours = false;
        if (r.status === 200) {
          msgs.forEach((m) => vus.add(m.id));
          GM_setValue("vus", JSON.stringify([...vus].slice(-2000)));
        } else if (r.status === 401) GM_setValue("cle", ""); // clé révoquée : elle sera redemandée
      },
      onerror: () => { envoiEnCours = false; },
      ontimeout: () => { envoiEnCours = false; },
    });
  }

  setInterval(() => {
    if (envoiEnCours || titreConversation() !== GROUPE) return;
    const msgs = lireMessages();
    if (!msgs.length) return;
    const k = cle();
    if (k) envoyer(msgs.slice(0, 100), k);
  }, 20000);
})();
