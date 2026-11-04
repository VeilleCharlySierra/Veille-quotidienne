# Captures d'écran des publications.
#  python3 captures.py paquet <dossier_images> <nom_paquet.bin> <clé>
#      dossier_images contient des fichiers <id>__fb.jpg | <id>__x.jpg | <id>__reel.jpg (capture du navigateur à l'échelle 0,6 :
#      820 x 385 environ) ; ils sont recadrés sur la publication puis chiffrés dans envoi/<nom_paquet.bin>.
#  python3 captures.py recadrer <dossier_images> <dossier_sortie>
#      recadre <id>__fb.jpg | __x.jpg | __reel.jpg (captures du navigateur) en <dossier_sortie>/<id>.jpg (pour le rapport).
#  python3 captures.py extraire <dossier_sortie> <clé>
#      déchiffre tous les paquets envoi/captures_*.bin dans <dossier_sortie>/<id>.jpg (pour le rapport).
import sys, os, io, json, base64, glob
from PIL import Image
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CADRES = {'fb': (196, 56, 616, 328), 'x': (190, 30, 548, 230), 'reel': (294, 42, 482, 375)}

def paquet(dossier, nom, cle):
    d = {}
    for f in sorted(glob.glob(os.path.join(dossier, '*__*.jpg'))):
        pid, typ = os.path.basename(f)[:-4].split('__')
        im = Image.open(f).convert('RGB')
        w, h = im.size; s = w / 820
        x0, y0, x1, y1 = CADRES.get(typ, CADRES['fb'])
        im = im.crop((int(x0 * s), int(y0 * s), int(x1 * s), int(y1 * s)))
        b = io.BytesIO(); im.save(b, 'JPEG', quality=88); d[pid] = base64.b64encode(b.getvalue()).decode()
    n = os.urandom(12)
    os.makedirs(os.path.join(RACINE, 'envoi'), exist_ok=True)
    out = os.path.join(RACINE, 'envoi', nom)
    open(out, 'wb').write(n + AESGCM(bytes.fromhex(cle)).encrypt(n, json.dumps(d).encode(), None))
    print(len(d), 'captures ->', out)

FRACTIONS = {'fb': (0.239, 0.145, 0.751, 0.852), 'x': (0.232, 0.078, 0.668, 0.597), 'reel': (0.359, 0.109, 0.588, 0.974)}

def recadrer(dossier, sortie):
    os.makedirs(sortie, exist_ok=True); n = 0
    for f in sorted(glob.glob(os.path.join(dossier, '*__*.jpg'))):
        pid, typ = os.path.basename(f)[:-4].split('__')
        im = Image.open(f).convert('RGB'); w, h = im.size
        x0, y0, x1, y1 = FRACTIONS.get(typ, FRACTIONS['fb'])
        im.crop((int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h))).save(os.path.join(sortie, pid + '.jpg'), quality=88); n += 1
    print(n, 'captures recadrées dans', sortie)

def extraire(sortie, cle):
    os.makedirs(sortie, exist_ok=True); n = 0
    for f in sorted(glob.glob(os.path.join(RACINE, 'envoi', 'captures_*.bin'))):
        b = open(f, 'rb').read()
        d = json.loads(AESGCM(bytes.fromhex(cle)).decrypt(b[:12], b[12:], None))
        for pid, v in d.items():
            open(os.path.join(sortie, pid + '.jpg'), 'wb').write(base64.b64decode(v)); n += 1
    print(n, 'captures extraites dans', sortie)

if __name__ == '__main__':
    if sys.argv[1] == 'paquet': paquet(sys.argv[2], sys.argv[3], sys.argv[4])
    elif sys.argv[1] == 'recadrer': recadrer(sys.argv[2], sys.argv[3])
    else: extraire(sys.argv[2], sys.argv[3])
