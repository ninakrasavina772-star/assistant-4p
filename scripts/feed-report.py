"""Сводка по CSV-фиду 4Partners. python scripts/feed-report.py [path]"""
import csv
import io
import re
import sys
from collections import defaultdict
from pathlib import Path

path = Path(
    sys.argv[1]
    if len(sys.argv) > 1
    else r"C:\Users\guita\.cursor\projects\c-Users-guita-Desktop\uploads\feed-live-check.csv"
)

def norm_ean(s):
    d = re.sub(r"\D", "", s or "")
    return d if len(d) >= 6 else ""

def expand_keys(d):
    out = {d}
    t = d.lstrip("0") or "0"
    out.add(t)
    for n in (12, 13, 14):
        if len(t) <= n:
            out.add(t.zfill(n))
    return out

lines = path.read_text(encoding="utf-8").splitlines()
hdr = next(i for i, l in enumerate(lines) if "Id" in l and "EAN" in l)
rows = list(csv.reader(io.StringIO("\n".join(lines[hdr:]))))
h = [x.strip().strip('"') for x in rows[0]]
id_i = h.index("Id товара")
ean_i = h.index("EAN")
name_i = next(i for i, x in enumerate(h) if "Название" in x or x == "Product Name")

ids = set()
per_id_rows = defaultdict(int)
ean_to_ids = defaultdict(set)
key_to_ids = defaultdict(set)
name_to_ids = defaultdict(set)

for row in rows[1:]:
    try:
        pid = int(str(row[id_i]).strip())
    except ValueError:
        continue
    ids.add(pid)
    per_id_rows[pid] += 1
    e = norm_ean(row[ean_i] if ean_i < len(row) else "")
    if e:
        ean_to_ids[e].add(pid)
        for k in expand_keys(e):
            key_to_ids[k].add(pid)
    nm = (row[name_i] if name_i < len(row) else "").strip().lower()
    if nm:
        name_to_ids[nm].add(pid)

uf = {}
def find(x):
    uf.setdefault(x, x)
    while uf[x] != x:
        uf[x] = uf[uf[x]]
        x = uf[x]
    return x

def union(a, b):
    ra, rb = find(a), find(b)
    if ra != rb:
        uf[ra] = rb

for pid in ids:
    find(pid)
for s in key_to_ids.values():
    arr = list(s)
    for i in range(1, len(arr)):
        union(arr[0], arr[i])

clusters = defaultdict(set)
for pid in ids:
    clusters[find(pid)].add(pid)
ean_dup_clusters = [c for c in clusters.values() if len(c) >= 2]

print("file:", path.name)
print("data rows:", len(rows) - 1)
print("unique Id товара:", len(ids))
print("rows with EAN:", sum(1 for row in rows[1:] if norm_ean(row[ean_i] if ean_i < len(row) else "")))
print("ids with 2+ feed rows (variants):", sum(1 for c in per_id_rows.values() if c > 1))
print("EAN duplicate clusters (2+ different id):", len(ean_dup_clusters))
print("cards in EAN dup clusters:", sum(len(c) for c in ean_dup_clusters))
if ean_dup_clusters:
    top = sorted(ean_dup_clusters, key=len, reverse=True)[:5]
    for c in top:
        print("  cluster size", len(c), "ids", sorted(c)[:8])
