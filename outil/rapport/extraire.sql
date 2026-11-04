-- Remplacer :DEBUT et :FIN (ex. '2026-11-04 06:00+00' et '2026-11-05 06:00+00').
-- Retenu : remontée avant :FIN et publiée dans la période (date de publication, à défaut date de remontée),
-- plus les publications remontées dans la période et publiées dans les 3 h précédant :DEBUT (passage de 06h47).
select id, marque, type, plateforme pf, auteur, left(texte, 600) texte, theme, lieu, sentiment, jaime, com, part, vues, lien,
       to_char(publiee_le, 'DD/MM HH24"h"MI') pub, to_char(remontee_le, 'DD/MM HH24"h"MI') rem, point_attention pa, suivi_auto, origine
from publications
where type = 'remontee' and remontee_le < :FIN
  and (coalesce(publiee_le, remontee_le) >= :DEBUT
       or (remontee_le >= :DEBUT and publiee_le >= :DEBUT::timestamptz - interval '3 hours'))
order by marque, coalesce(jaime,0) + coalesce(com,0) + coalesce(part,0) desc;
