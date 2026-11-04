# usage : python3 chiffrer.py <rapport.pdf> <AAAA-MM-JJ> <clé hexadécimale>
# écrit envoi/rapport_<jour>.bin (AES-256-GCM : 12 octets de nonce + texte chiffré) à la racine du dépôt
import sys, os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
pdf, jour, cle = sys.argv[1], sys.argv[2], sys.argv[3]
racine = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.makedirs(os.path.join(racine, 'envoi'), exist_ok=True)
n = os.urandom(12)
out = os.path.join(racine, 'envoi', f'rapport_{jour}.bin')
open(out, 'wb').write(n + AESGCM(bytes.fromhex(cle)).encrypt(n, open(pdf, 'rb').read(), None))
print(out)
