# Page de veille CIE-SODECI : mode d'emploi pour les tâches automatiques

1. Cloner le dépôt : `git clone https://github.com/VeilleCharlySierra/Veille-quotidienne.git veille && cd veille`
2. Modifier `data/jour.json` (format ci-dessous) et déposer les visuels dans `img/` (JPEG, qualité 55, largeur ≤ 600 px).
3. Construire : `python3 outil/construire.py` (en journée) ou `python3 outil/construire.py --bulletin` (bulletin du soir : met à jour `data/historique.json` et crée `archives/AAAA-MM-JJ/`).
4. Vérifier : `python3 -c "import json;json.load(open('data/jour.json'))"` puis ouvrir `index.html` avec Playwright (aucune erreur JavaScript).
5. Publier : `git add -A && git -c user.name="Claude" -c user.email="noreply@anthropic.com" commit -m "Mise à jour JJ/MM HHhMM" && git pull --rebase origin main && git push origin HEAD:main`

## Format de `data/jour.json`

```json
{
  "maj": "01/11/2026 à 09h45 UTC",
  "jour": "2026-11-01", "jour_fr": "01/11/2026",
  "pdf": "rapports/Rapport_de_veille_quotidien_01112026.pdf",   // seulement quand le PDF du jour existe
  "fenetre_comm": "Commentaires publiés du … au … UTC sous les dernières publications des canaux officiels (…).",
  "publications": [ {
      "id": "H1",                      // H… remontée humaine, A… remontée automatisée ; unique par jour
      "marque": "CIE",                 // "CIE" ou "SODECI" (une ligne par marque si les deux sont citées)
      "origine": "h",                  // "h" humaine, "a" automatisée
      "auto": false,                   // true si une remontée humaine a aussi été trouvée automatiquement
      "pf": "Facebook",                // Facebook, TikTok ou X
      "auteur": "…", "publiee": "31/10 11h29", "remontee": "31/10 15h21",   // JJ/MM HHhMM UTC ; inconnu : "non disponible"
      "texte": "« citation courte » contexte",
      "jaime": 26, "com": 24, "part": 2, "vues": null,                   // null = non disponible
      "theme": "Coupures et pénuries d'eau",
      "lieu": "Abobo",                 // nom de outil/lieux.json, ou "Non localisé"
      "sentiment": "Négatif",          // "Négatif", "Neutre" ou "Positif"
      "lien": "fb.com/share/p/…",
      "img": "img/H1.jpg"              // capture (humaine) ou carte reconstituée (automatisée) ; null si aucune
  } ],
  "alertes": [ {                     // publications ayant fait l'objet d'une ALERTE VEILLE encore actives ; un relevé ajouté à chaque passage
      "marque": "CIE", "pf": "Facebook", "auteur": "…", "titre": "objet court", "lien": "https://…",
      "alerte_le": "01/11 18h40",
      "suivi": [ { "heure": "01/11 18h40", "jaime": 40, "com": 55, "part": 3, "vues": null } ]
  } ],
  "surveillance": {                    // Point d'attention ; les statistiques sont calculées automatiquement
    "SODECI": { "pubs":   [["S20", "pourquoi la surveiller"]],
                "themes": [["Coupures et pénuries d'eau", "foyers, contexte"]] },
    "CIE":    { "pubs": [], "themes": [] }
  },
  "officiels": { "SODECI": [ { "id": "OS1", "canal": "Facebook · page SODECI", "date": "30/10 20h22", "texte": "…",
                               "jaime": 29, "com": null, "part": 1, "vues": null, "lien": "https://…", "vignette": "https://…(image fournie par la collecte, facultatif)" } ],
                 "CIE": [] },
  "commentaires": { "SODECI": [ { "auteur": "…", "date": "31/10 19h32", "texte": "…", "sentiment": "Négatif", "theme": "…", "lieu": "Bonoua" } ],
                    "CIE": [] }
}
```

Lieux connus : voir `outil/lieux.json` ([latitude, longitude, 1 si commune du district d'Abidjan]). Un lieu absent de la liste est listé mais non placé sur la carte ; on peut l'ajouter avec des coordonnées fiables.
