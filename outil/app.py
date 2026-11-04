# Construit la page (index.html) : données chargées depuis Supabase après connexion.
import json, os, math
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); O = os.path.join(R, 'outil')
LIEUX = json.load(open(os.path.join(O, 'lieux.json'), encoding='utf-8'))
def proj(lon, lat): return [round((lon + 8.7) * 100 * math.cos(math.radians(7.5)), 2), round((10.8 - lat) * 100, 2)]
GEO = dict(path=json.load(open(os.path.join(O, 'geo_ci.json')))['path'], lieux={k: dict(xy=proj(v[1], v[0]), abj=bool(v[2])) for k, v in LIEUX.items()}, abidjan=proj(-4.008, 5.36))
STATIC = dict(geo=GEO, canaux=json.load(open(os.path.join(O, 'canaux.json'), encoding='utf-8')))
html = open(os.path.join(O, 'app_modele.html'), encoding='utf-8').read().replace('/*DATA*/null', json.dumps(STATIC, ensure_ascii=False))
open(os.path.join(R, 'index.html'), 'w', encoding='utf-8').write(html); print('index.html', len(html))
