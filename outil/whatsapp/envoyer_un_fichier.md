# Envoyer un fichier (PDF) dans WhatsApp Web avec Claude in Chrome

Problème : le champ de fichier présent par défaut accepte seulement les images (`image/*`). Un PDF déposé dedans
s'affiche en aperçu puis est refusé à l'envoi (« fichier non pris en charge »). Le champ « Document » n'est créé
qu'au clic sur le menu « Document », qui ouvre normalement la fenêtre de choix de fichier.

Méthode qui fonctionne (testée le 04/11/2026) :
0. RÈGLE ABSOLUE (incident du 07/11/2026 : un message a été publié par erreur dans le groupe des équipes) : le groupe
   « Remontées publications CIE- Sodeci » est en LECTURE SEULE. Ouvrir la conversation en cliquant sur l'élément de la liste dont
   le titre est EXACTEMENT le nom voulu (`[...document.querySelectorAll('#pane-side span[title]')].find(s=>s.title==='<nom exact>')`),
   jamais le premier résultat d'une recherche ; avant tout envoi, vérifier par javascript que le titre de l'en-tête de la
   conversation ouverte est STRICTEMENT égal au nom voulu ; sinon ne rien envoyer.
1. Ouvrir la conversation (voir 0), cliquer sur le trombone (« Joindre »).
2. javascript_tool : neutraliser l'ouverture de la fenêtre de choix puis cliquer sur « Document » :
   ```js
   window.__clickOrig = window.__clickOrig || HTMLInputElement.prototype.click;
   HTMLInputElement.prototype.click = function(){ if (this.type==='file') return; return window.__clickOrig.call(this); };
   [...document.querySelectorAll('li, div[role=button], span')].find(e=>e.innerText && e.innerText.trim()==='Document').click();
   ```
3. find « file input accept="*" » : prendre le champ qui N'EST PAS `image/*` ; file_upload du PDF dessus.
   L'aperçu doit afficher « Aucun aperçu disponible · x Mo · PDF » (mode document).
4. Ne pas cliquer dans la zone de légende ; cliquer directement sur le bouton d'envoi (flèche verte).
5. Vérifier que le message apparaît avec la taille du fichier, puis restaurer :
   `HTMLInputElement.prototype.click = window.__clickOrig;`
