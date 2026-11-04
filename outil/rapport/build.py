# Générateur du rapport quotidien de veille (même présentation que le rapport du 03/11/2026)
import json, collections, os, textwrap
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

D = os.path.dirname(os.path.abspath(__file__))
import sys
WD = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else D
os.chdir(D)
F = '/usr/share/fonts/truetype/crosextra/'
if not os.path.exists(F + 'Carlito-Regular.ttf'): F = os.path.join(D, 'polices/')
pdfmetrics.registerFont(TTFont('C', F + 'Carlito-Regular.ttf'))
pdfmetrics.registerFont(TTFont('CB', F + 'Carlito-Bold.ttf'))
import matplotlib.font_manager as fm
for _f in ('Carlito-Regular.ttf', 'Carlito-Bold.ttf'):
    try: fm.fontManager.addfont(F + _f)
    except Exception: pass
plt.rcParams['font.family'] = 'Carlito'

W, H = 540, 780
GREEN, LGREEN, RED, ORANGE, BLUE, GREY = HexColor('#00B050'), HexColor('#92D050'), HexColor('#C00000'), HexColor('#F57F00'), HexColor('#1F6FB2'), HexColor('#777777')
# ---------- entrées ----------
# usage : python3 build.py <dossier_travail>   (contient data.json et synthese.json ; le PDF y est écrit)
RAW = json.load(open(os.path.join(WD, 'data.json')))
S = json.load(open(os.path.join(WD, 'synthese.json')))
P = []
for r in RAW:
    if r.get('type', 'remontee') != 'remontee': continue
    P.append(dict(marque=r['marque'], auteur=r.get('auteur') or '(auteur non disponible)', texte=(r.get('texte') or '').strip(),
                  theme=r.get('theme') or 'Non classé', lieu=r.get('lieu') or 'Non localisé', sentiment=r.get('sentiment') or 'Neutre',
                  jaime=r.get('jaime'), com=r.get('com'), part=r.get('part'), pf=r.get('pf') or r.get('plateforme') or '',
                  pub=r.get('pub'), rem=r.get('rem'), lien=r.get('lien') or '', pa=r.get('pa'),
                  origine='remontée humaine' if r.get('origine') == 'humaine' else 'remontée automatisée'))
JOUR = S['jour']                     # AAAA-MM-JJ
JFR = '/'.join(JOUR.split('-')[::-1])
PERIODE = S['periode']               # ex. "du 04/11/2026 à 06h00 au 05/11/2026 à 06h00 UTC"
OUT = os.path.join(WD, 'Rapport_de_veille_quotidien_' + JFR.replace('/', '') + '.pdf')
c = canvas.Canvas(OUT, pagesize=(W, H))
c.setTitle('Rapport de veille quotidien – ' + JFR)
page = [0]
def inter(p): return (p['jaime'] or 0) + (p['com'] or 0) + (p['part'] or 0)
def nd(x): return 'n.d.' if x is None else f"{x:,}".replace(',', ' ')

def wrap(txt, font, size, width):
    words, lines, cur = txt.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if pdfmetrics.stringWidth(t, font, size) <= width: cur = t
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    return lines

def para(x, y, txt, font='C', size=10, width=500, lead=None, color=black):
    lead = lead or size * 1.25
    c.setFillColor(color); c.setFont(font, size)
    for ln in wrap(txt, font, size, width):
        c.drawString(x, y, ln); y -= lead
    return y

def bullet(x, y, key, txt, size=10, width=490):
    c.setFillColor(black); c.setFont('C', size); c.drawString(x, y, '•')
    full = (key + ' : ' if key else '') + txt
    lines = wrap(full, 'C', size, width)
    first = True
    for ln in lines:
        if first and key:
            c.setFont('CB', size); c.drawString(x + 10, y, key + ' :')
            kw = pdfmetrics.stringWidth(key + ' : ', 'CB', size)
            c.setFont('C', size); c.drawString(x + 10 + kw, y, ln[len(key) + 3:])
        else:
            c.setFont('C', size); c.drawString(x + 10, y, ln)
        first = False; y -= size * 1.3
    return y - 2

def newpage(title=None, band=True):
    if page[0]: c.showPage()
    page[0] += 1
    if title:
        c.setFillColor(GREEN); c.rect(0, H - 28, W, 28, stroke=0, fill=1)
        c.setFillColor(white); c.setFont('CB', 13); c.drawString(16, H - 19, title.upper())
    if band:
        c.setFillColor(GREEN); c.rect(0, 0, W, 6, stroke=0, fill=1)
    c.setFillColor(GREY); c.setFont('C', 7); c.drawRightString(W - 10, 10, str(page[0]))

def img(path, x, y, w, h, keep=True):
    ir = ImageReader(path); iw, ih = ir.getSize()
    if keep:
        s = min(w / iw, h / ih); dw, dh = iw * s, ih * s
        c.drawImage(ir, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
    else:
        c.drawImage(ir, x, y, w, h)


def chart_bars(data, title, color, fn, fmt=lambda v, t: f"{round(100 * v / t)} % ({v})"):
    labels = [k for k, _ in data][::-1]; vals = [v for _, v in data][::-1]; tot = sum(vals) or 1
    fig, ax = plt.subplots(figsize=(5.2, 0.42 * len(data) + 0.7), dpi=130)
    ax.barh(labels, vals, color=color)
    for i, v in enumerate(vals): ax.text(v + max(vals) * 0.01, i, fmt(v, tot), va='center', fontsize=9)
    ax.set_xlim(0, max(vals) * 1.35); ax.set_title(title, fontsize=11, loc='left', fontweight='bold')
    for s in ('top', 'right', 'bottom'): ax.spines[s].set_visible(False)
    ax.set_xticks([]); ax.tick_params(axis='y', labelsize=9)
    plt.tight_layout(); fig.savefig(fn); plt.close(fig)

def chart_pie(cnt, fn):
    keys = [k for k in ('Négatif', 'Neutre', 'Positif') if cnt.get(k)]
    cols = {'Négatif': '#C00000', 'Neutre': '#A6A6A6', 'Positif': '#00B050'}
    fig, ax = plt.subplots(figsize=(2.6, 2.6), dpi=130)
    ax.pie([cnt[k] for k in keys], labels=[f"{k}\n{round(100 * cnt[k] / sum(cnt.values()))} %" for k in keys], colors=[cols[k] for k in keys],
           startangle=90, textprops={'fontsize': 9}, wedgeprops={'linewidth': 1, 'edgecolor': 'white'})
    ax.set_title('Sens des publications', fontsize=10, fontweight='bold')
    plt.tight_layout(); fig.savefig(fn); plt.close(fig)


# ---------- couverture ----------
newpage(band=False)
img('mod/m-000.jpg', 22, H - 130, 140, 100)
c.setFillColor(black); c.setFont('CB', 19)
c.drawRightString(W - 22, H - 70, 'Rapport quotidien de')
c.drawRightString(W - 22, H - 94, 'Veille E-réputationnelle')
c.setFillColor(RED); c.rect(0, H - 245, W, 100, stroke=0, fill=1)
c.setFillColor(white); c.setFont('C', 10)
for i, t in enumerate(['Émis par : Viral Sarl', 'Marques :', '   • SODECI', '   • CIE']):
    c.drawString(22, H - 168 - i * 16, t)
c.drawRightString(W - 22, H - 168, 'Date : ' + JFR)
c.drawRightString(W - 22, H - 184, 'Période : ' + S.get('periode_courte', PERIODE))
c.setFont('CB', 12); c.drawRightString(W - 22, H - 222, 'CONFIDENTIEL')
img('mod/m-001.jpg', 40, H - 345, 210, 90); img('mod/m-002.jpg', 290, H - 345, 210, 90)
img('mod/m-003.jpg', 0, 0, W, H - 355, keep=False)

def pct(a, b): return round(100 * a / b) if b else 0
def stats(b):
    rs = [p for p in P if p['marque'] == b]
    return rs, sum(p['sentiment'] == 'Négatif' for p in rs)

def section(y, title, items, size=10):
    if y < 120: newpage('Synthèse de la journée (suite)'); y = H - 52
    c.setFillColor(GREEN); c.setFont('CB', 12); c.drawString(20, y, title); y -= 16
    for k, t in items:
        if y < 60: newpage('Synthèse de la journée (suite)'); y = H - 52
        y = bullet(22, y, k, t, size=size, width=488)
    return y - 4

newpage('Synthèse de la journée')
y = H - 52
y = para(20, y, f"Période couverte : {PERIODE}.", 'CB', 10.5)
y -= 4
sr, sn = stats('SODECI'); cr, cn = stats('CIE')
nh = sum(p['origine'] == 'remontée humaine' for p in P)
y = para(20, y, f"{len(cr) + len(sr)} publications retenues après filtrage et dédoublonnage : {len(cr)} sur la CIE et {len(sr)} sur la SODECI "
         f"(une publication qui cite les deux marques est comptée pour chacune ; {nh} remontées humaines, {len(P) - nh} remontées automatisées). "
         f"Sentiment négatif : {pct(cn, len(cr))} % pour la CIE, {pct(sn, len(sr))} % pour la SODECI. Les communiqués des canaux officiels ne sont pas comptés.",
         size=10.5, width=500)
y -= 8
y = section(y, "Ce qui s'est passé", S.get('faits', []))
y = section(y, "Points d'attention", S.get('attention', []))

def brand_pages(b, col, logo, attention):
    rs = [p for p in P if p['marque'] == b]
    newpage(band=False)
    c.setFillColor(col); c.rect(0, 0, W, H, stroke=0, fill=1)
    c.setFillColor(white); c.roundRect(110, H / 2 - 70, 320, 140, 18, stroke=0, fill=1)
    img(logo, 130, H / 2 - 55, 280, 110)
    newpage(f'Statistiques {b}')
    if not rs:
        para(20, H - 60, f"Aucune publication retenue sur la {b} pour cette période.", size=11); return
    th = collections.Counter(p['theme'] for p in rs).most_common()
    chart_bars(th[:10], f'Thématique des publications ({len(rs)} publications)', '#00B050', os.path.join(WD, f'th_{b}.png'))
    img(os.path.join(WD, f'th_{b}.png'), 14, H - 50 - 250, 330, 250)
    sent = collections.Counter(p['sentiment'] for p in rs)
    chart_pie(sent, os.path.join(WD, f'pie_{b}.png')); img(os.path.join(WD, f'pie_{b}.png'), 350, H - 50 - 190, 180, 180)
    cnt = collections.Counter(p['pf'] for p in rs)
    neg = sent.get('Négatif', 0)
    lieux = [l for l, _ in collections.Counter(p['lieu'] for p in rs if p['theme'] == th[0][0] and p['lieu'] != 'Non localisé').most_common(5)]
    y = H - 330
    c.setFillColor(GREEN); c.setFont('CB', 12); c.drawString(20, y, 'Résumé'); y -= 16
    rep = ', '.join(f"{n} sur {k}" for k, n in cnt.most_common())
    y = para(20, y, f"Sur {len(rs)} publications analysées ({rep}), {neg} sont négatives, soit un taux de sentiment négatif de {pct(neg, len(rs))} %.", size=10.5)
    y = para(20, y, f"Le thème principal est {th[0][0]} : {pct(th[0][1], len(rs))} % ({th[0][1]} publications)" + (f", avec pour principales localités {', '.join(lieux)}." if lieux else "."), size=10.5)
    y -= 4; c.setFont('CB', 10.5); c.drawString(20, y, 'Autres thèmes :'); y -= 14
    for t, n in th[1:8]:
        y = bullet(28, y, '', f"{t} : {pct(n, len(rs))} % ({n})", size=10)
    y -= 6
    vals = [(len(rs), 'publications'), (sum(p['jaime'] or 0 for p in rs), "réactions (j'aime)"), (sum(p['com'] or 0 for p in rs), 'commentaires'), (sum(p['part'] or 0 for p in rs), 'partages')]
    bw = (W - 40 - 30) / 4
    for i, (v, l) in enumerate(vals):
        x = 20 + i * (bw + 10)
        c.setFillColor(HexColor('#F2F2F2')); c.roundRect(x, y - 52, bw, 50, 6, stroke=0, fill=1)
        c.setFillColor(col); c.setFont('CB', 18); c.drawCentredString(x + bw / 2, y - 26, nd(v))
        c.setFillColor(black); c.setFont('C', 9); c.drawCentredString(x + bw / 2, y - 42, l)
    y -= 66
    para(20, y, f"Base : remontées {PERIODE} ; {rep} ; vues : non disponibles. Chiffres d'engagement relevés au dernier passage.", size=8.5, color=GREY)
    newpage(f'Statistiques {b} (suite)')
    lc = collections.Counter(p['lieu'] for p in rs).most_common(12)
    chart_bars(lc, 'Localisation des publications', '#1F6FB2', os.path.join(WD, f'loc_{b}.png'), fmt=lambda v, t: str(v))
    img(os.path.join(WD, f'loc_{b}.png'), 14, H - 40 - 300, 300, 300)
    ti = collections.defaultdict(int)
    for p in rs: ti[p['theme']] += inter(p)
    tis = sorted(ti.items(), key=lambda x: -x[1])[:10]
    if any(v for _, v in tis):
        chart_bars(tis, 'Interactions par thématique', '#00B050', os.path.join(WD, f'ti_{b}.png'), fmt=lambda v, t: str(v))
        img(os.path.join(WD, f'ti_{b}.png'), 300, H - 40 - 200, 235, 200)
    y = H - 360
    c.setFillColor(GREEN); c.setFont('CB', 12); c.drawString(20, y, "Points d'attention"); y -= 16
    for k, t in attention:
        if y < 40: break
        y = bullet(22, y, k, t, size=10, width=488)
    rs2 = sorted(rs, key=inter, reverse=True)
    for i in range(0, len(rs2), 6):
        newpage(f'Publications observées – {b}')
        c.setFillColor(GREY); c.setFont('C', 8)
        c.drawString(14, H - 40, f"{len(rs2)} publications retenues, classées par engagement (j'aime + commentaires + partages) – page {i // 6 + 1}/{(len(rs2) + 5) // 6}")
        for j, p in enumerate(rs2[i:i + 6]):
            fx = 14 + (j % 2) * 260; fy = H - 50 - (j // 2 + 1) * 238
            fw, fh = 252, 232
            c.setStrokeColor(HexColor('#BFBFBF')); c.setLineWidth(0.6); c.rect(fx, fy, fw, fh, stroke=1, fill=0)
            c.setFillColor(GREEN); c.rect(fx, fy + fh - 13, fw, 13, stroke=0, fill=1)
            c.setFillColor(white); c.setFont('CB', 7.5); c.drawString(fx + 5, fy + fh - 9.5, f"{p['origine'].upper()} · {p['pf'].upper()}")
            top = fy + fh - 15
            if (p['com'] or 0) >= 150:
                c.setFillColor(RED); c.rect(fx + 3, top - 11, 110, 10, stroke=0, fill=1)
                c.setFillColor(white); c.setFont('CB', 6.5); c.drawString(fx + 6, top - 8.5, 'PLUS DE 150 COMMENTAIRES'); top -= 12
            # texte de la publication (pas de capture d'écran dans le rapport automatique)
            c.setFillColor(HexColor('#F7F7F7')); c.rect(fx + 4, fy + 74, fw - 8, top - (fy + 74) - 2, stroke=0, fill=1)
            yy = top - 14; c.setFillColor(black)
            lines = wrap(p['texte'] or '(texte non disponible)', 'C', 9, fw - 20)
            maxl = int((top - (fy + 80)) // 11.5)
            if len(lines) > maxl: lines = lines[:maxl]; lines[-1] = lines[-1][:-1] + '…'
            c.setFont('C', 9)
            for ln in lines: c.drawString(fx + 10, yy, ln); yy -= 11.5
            yy = fy + 62
            c.setFillColor(black); c.setFont('CB', 8); c.drawString(fx + 5, yy, p['auteur'][:58]); yy -= 10
            c.setFont('C', 7); c.setFillColor(GREY)
            c.drawString(fx + 5, yy, f"publiée le {p['pub'] or '(date non disponible)'} · remontée le {p['rem']} UTC"[:80]); yy -= 10
            c.setFillColor(black); c.drawString(fx + 5, yy, f"J'aime {nd(p['jaime'])} · Commentaires {nd(p['com'])} · Partages {nd(p['part'])}"); yy -= 10
            c.drawString(fx + 5, yy, f"{p['theme']} · {p['lieu']} · {p['sentiment']}"[:75]); yy -= 10
            c.setFillColor(BLUE); c.setFont('C', 6)
            c.drawString(fx + 5, yy, p['lien'].replace('https://www.', '').replace('https://', '')[:78])
            if p['lien'].startswith('http'): c.linkURL(p['lien'], (fx, fy, fx + fw, fy + 14), relative=0)

M = S.get('marques', {})
brand_pages('SODECI', LGREEN, 'mod/m-001.jpg', M.get('SODECI', []))
brand_pages('CIE', ORANGE, 'mod/m-002.jpg', M.get('CIE', []))
newpage(band=False)
c.setFillColor(RED); c.rect(0, 0, W, H, stroke=0, fill=1)
c.save()
print(OUT, page[0])
