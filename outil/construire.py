#!/usr/bin/env python3
"""Construit la page de veille (index.html) à partir de data/jour.json.

Usage (depuis la racine du dépôt) :
  python3 outil/construire.py              # mise à jour de la journée (toutes les 2h30)
  python3 outil/construire.py --bulletin   # bulletin du soir : historique + archive du jour

Le format de data/jour.json est décrit dans outil/LISEZMOI.md.
"""
import json, os, re, sys, math, shutil, collections, textwrap

R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
O = os.path.join(R, 'outil')
BASE = '/Veille-quotidienne/'
J = json.load(open(os.path.join(R, 'data', 'jour.json'), encoding='utf-8'))
rows = J['publications']
for r in rows:
    r.setdefault('auto', False); r.setdefault('vues', None); r.setdefault('img', None); r.setdefault('remontee', '')
    r.setdefault('publiee', 'non disponible'); r.setdefault('lieu', 'Non localisé')
    if r.get('img') and not os.path.exists(os.path.join(R, r['img'])): r['img'] = None

def inter(r): return (r.get('jaime') or 0) + (r.get('com') or 0) + (r.get('part') or 0)
def court(t, n=90):
    t = re.sub(r'\s*\(remontée \d+ fois\)', '', t or '').strip(' «»"')
    return t if len(t) <= n else t[:n].rsplit(' ', 1)[0] + '…'

# ---- Point d'attention : statistiques calculées ----
BYID = {(r['id'], r['marque']): r for r in rows}
POINT = {}
for b in ('SODECI', 'CIE'):
    sv = (J.get('surveillance') or {}).get(b) or {'pubs': [], 'themes': []}
    pubs = []
    for i, note in sv.get('pubs', []):
        r = BYID.get((i, b))
        if not r: continue
        pubs.append(dict(auteur=r['auteur'], pf=r['pf'], publiee=r['publiee'], titre=court(r['texte']), jaime=r.get('jaime'), com=r.get('com'),
                         part=r.get('part'), vues=r.get('vues'), lien=r['lien'], note=note))
    themes = []
    for th, note in sv.get('themes', []):
        rs = sorted([r for r in rows if r['marque'] == b and r['theme'] == th], key=inter, reverse=True)
        themes.append(dict(theme=th, n=len(rs), inter=sum(inter(r) for r in rs), neg=round(100 * sum(r['sentiment'] == 'Négatif' for r in rs) / max(1, len(rs))),
                           note=note, liens=[dict(auteur=r['auteur'], lien=r['lien'], inter=inter(r)) for r in rs[:5]], autres=max(0, len(rs) - 5)))
    POINT[b] = dict(pubs=pubs, themes=themes)

# ---- 10 dernières remontées ----
def rkey(r):
    m = re.match(r'(\d+)/(\d+) (\d+)h(\d+)', r.get('remontee') or '') or re.match(r'(\d+)/(\d+) (\d+)h(\d+)', r.get('publiee') or '')
    return tuple(int(x) for x in (m.group(2), m.group(1), m.group(3), m.group(4))) if m else (0, 0, 0, 0)
DERNIERES = {b: [dict(auteur=r['auteur'], titre=court(r['texte'], 140), lien=r['lien'], remontee=r.get('remontee') or r.get('publiee') or 'non disponible', origine=r['origine'])
                 for r in sorted([r for r in rows if r['marque'] == b], key=rkey, reverse=True)[:10]] for b in ('SODECI', 'CIE')}

# ---- géographie (coordonnées approximatives) ----
GEO = json.load(open(os.path.join(O, 'geo_ci.json')))
def proj(lon, lat): return [round((lon + 8.7) * 100 * math.cos(math.radians(7.5)), 2), round((10.8 - lat) * 100, 2)]
LIEUX = json.load(open(os.path.join(O, 'lieux.json'), encoding='utf-8'))
GEO['lieux'] = {k: dict(xy=proj(v[1], v[0]), abj=bool(v[2])) for k, v in LIEUX.items()}
GEO['abidjan'] = proj(-4.008, 5.36)
x0, y0 = proj(-4.31, 5.535); x1, y1 = proj(-3.83, 5.215); GEO['inset'] = [x0, y0, round(x1 - x0, 2), round(y1 - y0, 2)]

# ---- canaux officiels : visuel reconstitué si besoin ----
CANAUX = json.load(open(os.path.join(O, 'canaux.json'), encoding='utf-8'))
try:
    from PIL import Image, ImageDraw, ImageFont
    def font(bold, size):
        for p in (['/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'] if bold else
                  ['/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']):
            if os.path.exists(p): return ImageFont.truetype(p, size)
        return ImageFont.load_default()
except ImportError:
    Image = None
def offcard(o, mention='Visuel reconstitué (canal officiel)'):
    p = f"img/{o['id']}.jpg"
    if Image is None: return p if os.path.exists(os.path.join(R, p)) else None
    Wc, pad = 480, 22
    lines = textwrap.wrap(o.get('texte') or '', 42)[:7]
    Hc = 150 + 30 * len(lines) + 70
    im = Image.new('RGB', (Wc, Hc), 'white'); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, Wc - 1, Hc - 1], outline='#D0D0D0', width=2)
    tk = o['canal'].startswith('TikTok')
    d.ellipse([pad, pad, pad + 56, pad + 56], fill='#111111' if tk else '#1877F2')
    d.text((pad + 28, pad + 28), 'T' if tk else 'f', fill='white', font=font(True, 34), anchor='mm')
    parts = o['canal'].split(' · ')
    d.text((pad + 72, pad + 6), parts[-1], fill='#111', font=font(True, 24))
    d.text((pad + 72, pad + 36), f"{parts[0]} · publiée le {o.get('date', 'non disponible')} UTC", fill='#666', font=font(False, 18))
    yy = 100
    for ln in lines: d.text((pad, yy), ln, fill='#111', font=font(False, 22)); yy += 30
    yy += 16; d.line([pad, yy, Wc - pad, yy], fill='#E0E0E0', width=2); yy += 14
    nd = lambda x: 'non disponible' if x is None else x
    v = f" · Vues {o['vues']}" if o.get('vues') else ''
    d.text((pad, yy), f"J'aime {nd(o.get('jaime'))} · Commentaires {nd(o.get('com'))} · Partages {nd(o.get('part'))}{v}", fill='#444', font=font(False, 18))
    yy += 30; d.text((pad, yy), mention, fill='#999', font=font(False, 15))
    os.makedirs(os.path.join(R, 'img'), exist_ok=True); im.save(os.path.join(R, p), quality=60); return p
def pubcard(r):
    # carte reconstituée pour une publication sans visuel
    o = dict(id=r['id'] + '_' + r['marque'], canal=f"{r['pf']} · {r['auteur']}", date=r.get('publiee') or 'non disponible', texte=r.get('texte'),
             jaime=r.get('jaime'), com=r.get('com'), part=r.get('part'), vues=r.get('vues'))
    return offcard(o, 'Visuel reconstitué (' + ('remontée automatisée' if r['origine'] == 'a' else 'capture non disponible') + ')')
for r in rows:
    if not r.get('img'): r['img'] = pubcard(r)
OFF = J.get('officiels') or {}
for b in OFF:
    for o in OFF[b]:
        o.setdefault('vues', None); o.setdefault('vignette', None); o.setdefault('lien', None)
        o['carte'] = offcard(o)

# ---- rapport PDF, historique, archives ----
JOUR = J['jour']; JOUR_FR = J['jour_fr']
PDF = J.get('pdf')
os.makedirs(os.path.join(R, 'data'), exist_ok=True)
HP = os.path.join(R, 'data', 'historique.json')
hist = json.load(open(HP, encoding='utf-8')) if os.path.exists(HP) else []
def bilan(b):
    rs = [r for r in rows if r['marque'] == b]; c = collections.Counter(r['theme'] for r in rs).most_common(1)
    return dict(n=len(rs), neg=round(100 * sum(r['sentiment'] == 'Négatif' for r in rs) / max(1, len(rs))), inter=sum(inter(r) for r in rs),
                theme=c[0][0] if c else 'non disponible', comm=len((J.get('commentaires') or {}).get(b, [])))
BULLETIN = '--bulletin' in sys.argv
if BULLETIN:
    entry = dict(jour=JOUR, jour_fr=JOUR_FR, SODECI=bilan('SODECI'), CIE=bilan('CIE'), archive=f'{BASE}archives/{JOUR}/', pdf=(BASE + PDF) if PDF else None)
    hist = [h for h in hist if h['jour'] != JOUR] + [entry]; hist.sort(key=lambda h: h['jour'])
    json.dump(hist, open(HP, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
if not hist:  # pas encore d'historique : ligne provisoire du jour
    hist = [dict(jour=JOUR, jour_fr=JOUR_FR, SODECI=bilan('SODECI'), CIE=bilan('CIE'), archive=BASE, pdf=(BASE + PDF) if PDF else None)]
last_pdf = PDF or next((h['pdf'][len(BASE):] for h in reversed(hist) if h.get('pdf')), None)

DATA = dict(maj=J['maj'], alertes=J.get('alertes') or [], publications=rows, point=POINT, officiels=OFF, canaux=CANAUX, geo=GEO, dernieres=DERNIERES, historique=hist,
            pdf=(BASE + last_pdf) if last_pdf else '#', jour_fr=JOUR_FR, commentaires=J.get('commentaires') or {'SODECI': [], 'CIE': []},
            fenetre_comm=J.get('fenetre_comm') or 'Commentaires des dernières 48 h sous les publications des canaux officiels (Facebook, TikTok ; X non disponible avec le plan actuel).')
page = open(os.path.join(O, 'modele.html'), encoding='utf-8').read().replace('/*__DATA__*/null', json.dumps(DATA, ensure_ascii=False))
open(os.path.join(R, 'index.html'), 'w', encoding='utf-8').write(page)
open(os.path.join(R, 'data.json'), 'w', encoding='utf-8').write(json.dumps(DATA, ensure_ascii=False))
if BULLETIN:
    A = os.path.join(R, 'archives', JOUR)
    if os.path.exists(A): shutil.rmtree(A)
    os.makedirs(A)
    used = {r['img'] for r in rows if r.get('img')} | {o['carte'] for b in OFF for o in OFF[b] if o.get('carte')} | {'img/logo-viral.jpg'}
    for u in used:
        if os.path.exists(os.path.join(R, u)):
            os.makedirs(os.path.dirname(os.path.join(A, u)), exist_ok=True); shutil.copy(os.path.join(R, u), os.path.join(A, u))
    open(os.path.join(A, 'index.html'), 'w', encoding='utf-8').write(page.replace('<title>', '<title>Archive ' + JOUR_FR + ' · ', 1))
print(f"{len(rows)} publications · page {len(page) // 1024} Ko" + (' · historique et archive mis à jour' if BULLETIN else ''))
