# Rapport quotidien de veille

Chaîne (aucune écriture dans GitHub : les tâches planifiées n'en ont pas le droit) :
1. **04h52 UTC** – tâche planifiée « Rapport quotidien 06h CIE SODECI » (liée à l'ordinateur de veille, avec Chrome) :
   extrait les publications, rédige la synthèse, prend les captures, construit le PDF (`build.py`), le dépose par la page
   `depot.html` (mode rapport), puis l'envoie dans le groupe WhatsApp d'alerte.
2. **06h00 UTC** – tâche `envoi_rapport_06h` de la base : la fonction `envoyer-rapport` reprend le PDF déposé dans le
   stockage et l'envoie par e-mail (script Gmail) aux adresses de `parametres.destinataires_rapport`.
   Si le rapport du jour n'a pas été déposé, un e-mail « non disponible » part et un incident est journalisé.

## Procédure de la tâche du matin (jour J = date UTC du jour)

Période : de J-1 06h00 UTC jusqu'au moment de l'extraction (vers 05h00), selon la date de publication (voir extraire.sql ; :FIN = J 06h00, mais les données s'arrêtent à l'heure de l'extraction : c'est cette heure réelle qui est écrite dans le PDF).

1. Cloner le dépôt public (lecture seule) : `git clone https://github.com/VeilleCharlySierra/Veille-quotidienne.git`.
   Travailler dans un dossier `<dossier>` hors du dépôt.
2. Données : outil Supabase `execute_sql` (projet `vtpfgzrlyqdjrulotxni`), requête de `extraire.sql` avec `:DEBUT` / `:FIN`
   remplacés. Enregistrer la sortie brute dans un fichier puis `python3 outil/rapport/lire_resultat.py <sortie> <dossier>/data.json`.
3. Synthèse : lire toutes les publications (texte, thème, lieu, sentiment, engagement) et écrire `<dossier>/synthese.json` :
   ```json
   {"jour": "AAAA-MM-JJ", "periode": "publications du JJ/MM/AAAA à 06h00 au JJ/MM/AAAA à <HHhMM> UTC (date de publication ; <HHhMM> = heure réelle de l'extraction des données, jamais une heure postérieure)",
    "periode_courte": "JJ/MM 06h00 – JJ/MM <HHhMM> UTC",
    "faits": [["Titre court", "texte"], ...],          // 3 à 5 puces « Ce qui s'est passé »
    "attention": [["Titre court", "texte"], ...],      // 3 à 5 puces « Points d'attention » (dont les points d'attention actifs de la base)
    "marques": {"CIE": [["Titre", "texte"], ...], "SODECI": [...]}}   // 3 à 5 puces par marque
   ```
4. Captures pour le rapport (Chrome, un onglet à toi, jamais l'onglet WhatsApp) : pour chaque publication de data.json, ouvrir son
   lien, attendre 4 s, `computer screenshot` avec `save_to_disk=true` et `scale=1` (pleine résolution : captures nettes ; ne plus réduire), copier le fichier enregistré en
   `<dossier>/brut/<id>__fb.jpg` (Facebook), `__x.jpg` (X) ou `__reel.jpg` (reel, vidéo, TikTok) ; enchaîner 5 publications par
   `browser_batch` ; ignorer « Ce contenu n'est pas disponible » et les articles de presse.
   Puis `python3 outil/rapport/captures.py recadrer <dossier>/brut <dossier>/captures` : chaque fiche reprend
   `<dossier>/captures/<id>.jpg`, sinon le texte.
5. `python3 outil/rapport/build.py <dossier>` → `<dossier>/Rapport_de_veille_quotidien_JJMMAAAA.pdf`.
   Vérifier 3 ou 4 pages en image (pdftoppm) et l'absence du mot « Apify » (`pdftotext … - | grep -ic apify` = 0).
6. Dépôt (aucun jeton ni clé saisi dans une page) : ouvrir le dépôt dans la base avec
   `select prive.ouvrir_depot('rapport', array['<AAAA-MM-JJ>']);` (valable 20 minutes, un seul dépôt), puis onglet Chrome :
   `https://veillecharlysierra.github.io/Veille-quotidienne/depot.html?mode=rapport&jour=<AAAA-MM-JJ>`,
   `find` « file input », `file_upload` du PDF sur ce champ, attendre 10 s,
   `window.RESULTAT` doit commencer par « OK ». Contrôle : `select * from rapports_journaliers where jour = J`.
7. WhatsApp : envoyer le PDF dans le groupe `parametres.whatsapp_groupe_alerte` selon `outil/whatsapp/envoyer_un_fichier.md`,
   puis le message « 📄 Rapport quotidien de veille CIE / SODECI du JJ/MM/AAAA. Aussi sur la plateforme, onglet Rapports :
   https://veillecharlysierra.github.io/Veille-quotidienne/ ». Journal : (now(), 'Rapport', 'envoi WhatsApp',
   'Rapport du JJ/MM/AAAA envoyé dans WhatsApp (groupe <nom>)').
8. Fermer les onglets ouverts (sauf WhatsApp).

## Règles de rédaction (obligatoires)
- Analyste rigoureux et sans parti pris : titres et textes **neutres et factuels**, uniquement ce que disent les publications ; aucune déduction, aucun contenu inventé.
- Chaque chiffre cité vient des données (j'aime, commentaires, partages, nombre de publications, localités).
- Ne jamais mentionner « Apify » : dire « remontée humaine » ou « remontée automatisée ».
- Seuils de personnalité : plus de 20 000 abonnés (profil Facebook), 5 000 (compte X), 100 000 (page Facebook), 150 000 (TikTok).
- Une publication qui atteint le seuil de commentaires des points d'attention (table criteres, attention_commentaires ; 150 par défaut), remontée ou canal officiel, est signalée dans les points d'attention.
- Les communiqués des canaux officiels ne sont pas comptés ; un commentaire de soutien à l'auteur compte comme neutre.
- Si une information n'est pas vérifiable, l'écrire (« non vérifiable », « non précisé »).
- Tout ce qui est écrit dans le rapport doit être exact et avoir réellement eu lieu (périodes, heures, chiffres, envois) : aucune formulation approximative ou anticipée.

## Essai manuel de l'envoi par e-mail
`select prive.lancer_envoi_rapport('AAAA-MM-JJ'::date, true);` (false = sans e-mail).
