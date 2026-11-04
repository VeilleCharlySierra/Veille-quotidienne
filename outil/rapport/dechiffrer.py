# usage : python3 dechiffrer.py <AAAA-MM-JJ> <clé hexadécimale> <dossier_sortie>
# déchiffre envoi/rapport_<jour>.bin en <dossier_sortie>/Rapport_de_veille_quotidien_JJMMAAAA.pdf
import sys, os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
jour, cle, sortie = sys.argv[1], sys.argv[2], sys.argv[3]
racine = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
b = open(os.path.join(racine, 'envoi', f'rapport_{jour}.bin'), 'rb').read()
os.makedirs(sortie, exist_ok=True)
out = os.path.join(sortie, 'Rapport_de_veille_quotidien_' + ''.join(jour.split('-')[::-1]) + '.pdf')
open(out, 'wb').write(AESGCM(bytes.fromhex(cle)).decrypt(b[:12], b[12:], None))
print(out)
