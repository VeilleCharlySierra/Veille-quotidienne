# Construit la maquette du format final (index.html) à partir des données réelles du 01/11 et du 03/11.
import json, os, math, re
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
O = os.path.join(R, 'outil')
S = '/tmp/claude-0/-home-claude/3ca2cf62-f909-56e1-8bd3-43d1bf3035c3/scratchpad/r0311/data.json'

def inter(r): return (r.get('jaime') or 0) + (r.get('com') or 0) + (r.get('part') or 0)

d03 = json.load(open(S, encoding='utf-8'))
J01 = json.load(open(os.path.join(R, 'data/jour.json'), encoding='utf-8'))
hist = json.load(open(os.path.join(R, 'data/historique.json'), encoding='utf-8'))

pubs = []
for i, r in enumerate(d03):
    img = r.get('img') or ''
    if img:
        img = 'img/0311/' + os.path.basename(img)
        if not os.path.exists(os.path.join(R, img)): img = ''
    pubs.append(dict(id='P%02d' % i, jour='2026-11-03', marque=r['marque'], pf=r['pf'], auteur=r['auteur'], texte=r['texte'],
                     theme=r['theme'], lieu=r['lieu'], sentiment=r['sentiment'], jaime=r.get('jaime'), com=r.get('com'),
                     part=r.get('part'), vues=r.get('vues'), remontee=r.get('remontee'), lien=r.get('lien'), img=img))
p01 = []
for r in J01['publications']:
    p01.append(dict(id=r['id'], jour='2026-11-01', marque=r['marque'], pf=r['pf'], auteur=r['auteur'], texte=r['texte'], theme=r['theme'], lieu=r['lieu'], sentiment=r['sentiment'],
                    jaime=r.get('jaime'), com=r.get('com'), part=r.get('part'), vues=r.get('vues'), remontee=r.get('remontee'), lien=r.get('lien'), img=r.get('img') or ''))

def stats(rows):
    out = {}
    for m in ('CIE', 'SODECI'):
        x = [r for r in rows if r['marque'] == m]
        n = len(x)
        out[m] = dict(n=n, neg=round(100 * sum(1 for r in x if r['sentiment'] == 'Négatif') / n) if n else 0, inter=sum(inter(r) for r in x))
    return out

serie = []
for h in hist:
    if h['jour'] == '2026-10-31':
        serie.append(dict(jour=h['jour'], CIE=dict(n=h['CIE']['n'], neg=h['CIE']['neg'], inter=None), SODECI=dict(n=h['SODECI']['n'], neg=h['SODECI']['neg'], inter=None)))
serie.append(dict(jour='2026-11-01', **stats(p01)))
serie.append(dict(jour='2026-11-02', CIE=None, SODECI=None))
serie.append(dict(jour='2026-11-03', **stats(pubs)))

# Points d'attention de la semaine
att = []
boli = next(p for p in pubs if p['auteur'].startswith('Boli Conseil'))
att.append(dict(type='pub', marque='CIE', pf='TikTok', auteur='Boli Conseil', titre=boli['texte'], lien=boli['lien'], img=boli['img'],
                raisons=['Plus de 150 commentaires'], depuis='03/11 09h00', statut='Suivi toutes les heures', actif=True, exemple=True,
                releves=[dict(h='03/11 09h', jaime=4300, com=171, part=160), dict(h='10h', jaime=4650, com=193, part=178),
                         dict(h='11h', jaime=4980, com=212, part=195), dict(h='12h', jaime=5171, com=223, part=208)],
                sens=dict(neg=58, neu=30, pos=12),
                mots={'courant': 14, 'délestage': 11, 'facture': 9, 'quartier': 8, 'chaleur': 7, 'nuit': 6, 'compteur': 6, 'explication': 5, 'patience': 4, 'travaux': 4, 'merci': 3, 'Yopougon': 3, 'Abobo': 3, 'prépayé': 2}))
for a in J01['alertes']:
    last = a['suivi'][-1]
    rs = []
    if (last.get('com') or 0) >= 150: rs.append('Plus de 150 commentaires')
    if (last.get('vues') or 0) > 10000: rs.append('Plus de 10 000 vues')
    if not rs: rs.append('Personnalité publique')
    img = ''
    for r in J01['publications']:
        if r.get('lien') and a['lien'].rstrip('/').startswith(r['lien'].rstrip('/')): img = r.get('img') or ''
    att.append(dict(type='pub', marque=a['marque'], pf=a['pf'], auteur=a['auteur'], titre=a['titre'], lien=a['lien'], img=img,
                    raisons=rs, depuis=a['alerte_le'], statut='Alerte close', actif=False, exemple=True,
                    releves=[dict(h=s_['heure'], jaime=s_.get('jaime'), com=s_.get('com'), part=s_.get('part')) for s_ in a['suivi']],
                    sens=dict(neg=71, neu=22, pos=7) if a['marque'] == 'SODECI' else dict(neg=49, neu=38, pos=13),
                    mots={'eau': 12, 'Tiébissou': 9, 'couleur': 7, 'robinet': 6, 'facture': 6, 'vie chère': 5, 'courant': 4, 'mairie': 3, 'patience': 3, 'santé': 2} if a['marque'] == 'SODECI'
                    else {'courant': 10, 'coupure': 9, 'explication': 6, 'délestage': 5, 'vérité': 4, 'Eranove': 4, 'tarif': 3, 'merci': 3}))
# thématiques en point d'attention (calcul réel par relevé de 3 h)
import collections
def th_alert(m, theme):
    x = [p for p in pubs if p['marque'] == m and p['theme'] == theme]
    c = collections.Counter()
    for p in x:
        dd, h = p['remontee'].split(); c[(dd[3:5] + dd[0:2], int(h[:2]) // 3 * 3, dd)] += 1
    rel = [dict(h='%s %02dh' % (k[2], k[1]), n=v) for k, v in sorted(c.items())][-6:]
    ev = round(100 * (rel[-1]['n'] - rel[-2]['n']) / rel[-2]['n']) if len(rel) > 1 and rel[-2]['n'] else None
    allm = [p for p in pubs if p['marque'] == m]
    return dict(marque=m, theme=theme, n=len(x), inter=sum(inter(p) for p in x), neg=round(100 * sum(1 for p in x if p['sentiment'] == 'Négatif') / len(x)),
                part=round(100 * len(x) / len(allm)), evol=ev, releves=rel, depuis='02/11 18h', raison='Plus de 30 % des publications')
themes_att = [th_alert('CIE', "Coupures d'électricité")]

# Carte
LIEUX = json.load(open(os.path.join(O, 'lieux.json'), encoding='utf-8'))
def proj(lon, lat): return [round((lon + 8.7) * 100 * math.cos(math.radians(7.5)), 2), round((10.8 - lat) * 100, 2)]
GEO = dict(path=json.load(open(os.path.join(O, 'geo_ci.json')))['path'],
           lieux={k: dict(xy=proj(v[1], v[0]), abj=bool(v[2])) for k, v in LIEUX.items()}, abidjan=proj(-4.008, 5.36))

OFFI = {}
for m, L in J01['officiels'].items():
    OFFI[m] = [dict(o, img=('img/%s.jpg' % o['id']) if os.path.exists(os.path.join(R, 'img/%s.jpg' % o['id'])) else '') for o in L]
CANAUX = json.load(open(os.path.join(O, 'canaux.json'), encoding='utf-8'))
DATA = dict(jour='2026-11-03', jour_fr='03/11/2026', pubs=pubs, p01=p01, serie=serie, att=att, themes_att=themes_att, geo=GEO, officiels=OFFI, comm_off=J01['commentaires'], canaux=CANAUX, fenetre_comm=J01.get('fenetre_comm'),
            rapports={'2026-10-31': 'rapports/Rapport_de_veille_quotidien_31102026.pdf', '2026-11-01': 'rapports/Rapport_de_veille_quotidien_01112026.pdf'})
html = open(os.path.join(O, 'maquette_modele.html'), encoding='utf-8').read()
html = html.replace('/*DATA*/null', json.dumps(DATA, ensure_ascii=False))
open(os.path.join(R, 'index.html'), 'w', encoding='utf-8').write(html)
print('ok', len(pubs), 'publications,', len(att), "points d'attention")
