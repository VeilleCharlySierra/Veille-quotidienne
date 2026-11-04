# Rapport quotidien de veille (envoi automatique à 06h00 UTC)

Chaîne :
1. **05h07 UTC** – tâche planifiée « Rapport quotidien 06h CIE SODECI » : extrait les publications, rédige la synthèse,
   construit le PDF (`build.py`), le chiffre (`chiffrer.py`) et le pousse dans `envoi/rapport_<AAAA-MM-JJ>.bin`.
2. **06h00 UTC** – tâche `envoi_rapport_06h` de la base : appelle la fonction `envoyer-rapport`, qui déchiffre le PDF,
   le range dans l'onglet Rapports de la page et l'envoie par e-mail (Resend) aux adresses de
   `parametres.destinataires_rapport` (liste JSON). Si le fichier manque, un e-mail « non disponible » part et un incident est journalisé.

## Procédure de la tâche de 05h07 (jour J = date UTC du jour)

Période : de J-1 06h00 à J 06h00 UTC (sauf consigne contraire), selon la date de publication (voir extraire.sql).

1. `cd` dans le dépôt, `git pull`.
2. Extraire les données avec l'outil Supabase `execute_sql` (projet `vtpfgzrlyqdjrulotxni`) : requête de `extraire.sql`,
   `:DEBUT` / `:FIN` remplacés. Enregistrer la sortie brute dans un fichier puis
   `python3 outil/rapport/lire_resultat.py <sortie> <dossier>/data.json`.
3. Lire toutes les publications (texte, thème, lieu, sentiment, engagement) et écrire `<dossier>/synthese.json` :
   ```json
   {"jour": "AAAA-MM-JJ", "periode": "du JJ/MM/AAAA à 06h00 au JJ/MM/AAAA à 06h00 UTC",
    "periode_courte": "JJ/MM 06h00 – JJ/MM 06h00 UTC",
    "faits": [["Titre court", "texte"], ...],          // 3 à 5 puces « Ce qui s'est passé »
    "attention": [["Titre court", "texte"], ...],      // 3 à 5 puces « Points d'attention »
    "marques": {"CIE": [["Titre", "texte"], ...], "SODECI": [...]}}   // 3 à 5 puces par marque
   ```
4. `python3 outil/rapport/build.py <dossier>` → `<dossier>/Rapport_de_veille_quotidien_JJMMAAAA.pdf`.
   Vérifier visuellement 3 ou 4 pages (pdftoppm) et que le PDF ne contient pas le mot « Apify » (`pdftotext … | grep -i apify`).
5. Clé : `select valeur from prive.cles where nom = 'cle_rapport'` (via `execute_sql`). Ne jamais l'écrire dans un fichier du dépôt ni dans un message.
   `python3 outil/rapport/chiffrer.py <pdf> <AAAA-MM-JJ> <clé>`.
6. Supprimer les `envoi/rapport_*.bin` de plus de 3 jours, `git add envoi`, commit « Rapport quotidien du JJ/MM/AAAA », `git push`.
   Ne jamais committer le PDF en clair, data.json ni synthese.json.

## Règles de rédaction (obligatoires)
- Analyste rigoureux et sans parti pris : titres et textes **neutres et factuels**, uniquement ce que disent les publications ; aucune déduction, aucun contenu inventé.
- Chaque chiffre cité vient des données (j'aime, commentaires, partages, nombre de publications, localités).
- Ne jamais mentionner « Apify » : dire « remontée humaine » ou « remontée automatisée ».
- Seuils de personnalité : plus de 5 000 abonnés (profil Facebook ou compte X), 100 000 (page Facebook), 150 000 (TikTok).
- Une publication de plus de 150 commentaires est signalée dans les points d'attention.
- Les communiqués des canaux officiels ne sont pas comptés ; un commentaire de soutien à l'auteur compte comme neutre.
- Si une information n'est pas vérifiable, l'écrire (« non vérifiable », « non précisé »).

## Essai manuel de l'envoi
`select prive.lancer_envoi_rapport('AAAA-MM-JJ'::date, true);` (false = rangement dans l'onglet Rapports sans e-mail).
