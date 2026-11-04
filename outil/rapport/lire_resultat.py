# usage : python3 lire_resultat.py <fichier contenant la sortie de execute_sql> <data.json>
# accepte la sortie brute de l'outil (avec balises untrusted-data) ou un tableau JSON
import sys, json, re
t = open(sys.argv[1], encoding='utf-8').read()
for _ in range(3):
    try:
        j = json.loads(t)
        if isinstance(j, list) and (not j or 'marque' in j[0]): break
        if isinstance(j, dict) and 'result' in j: t = j['result']; continue
        if isinstance(j, list) and j and 'text' in j[0]: t = j[0]['text']; continue
        break
    except Exception: break
m = re.search(r'(\[\s*\{.*\}\s*\]|\[\s*\])', t, re.S)
rows = json.loads(m.group(1))
json.dump(rows, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False)
print(len(rows), 'publications')
