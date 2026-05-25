import csv
import re
from collections import Counter, defaultdict

path = r"C:\Users\guita\.cursor\projects\c-Users-guita-Desktop\uploads\r-parfyumeriya-1184649-1234-0.csv"
with open(path, encoding="utf-8", newline="") as f:
    lines = f.readlines()

hdr_i = None
for i, line in enumerate(lines):
    if "Id" in line and "EAN" in line:
        hdr_i = i
        break

import io

text = "".join(lines[hdr_i:])
reader = csv.reader(io.StringIO(text))
headers = [h.strip().strip('"') for h in next(reader)]


def col_idx(names):
    for n in names:
        for i, h in enumerate(headers):
            if h.lower() == n.lower():
                return i
    return -1


id_i = col_idx(["Id товара", "Product Id"])
ean_i = col_idx(["EAN"])
name_i = col_idx(["Название товара", "Product Name"])

rows = list(reader)
print("header line", hdr_i + 1)
print("data rows", len(rows))


def norm_ean(s):
    d = re.sub(r"\D", "", s or "")
    return d if len(d) >= 6 else None


ean_to_ids = defaultdict(set)
name_to_ids = defaultdict(set)
id_eans = defaultdict(set)
row_per_id = Counter()

for row in rows:
    if id_i < 0 or id_i >= len(row):
        continue
    try:
        pid = int(str(row[id_i]).strip())
    except ValueError:
        continue
    row_per_id[pid] += 1
    e = norm_ean(row[ean_i] if 0 <= ean_i < len(row) else "")
    if e:
        ean_to_ids[e].add(pid)
        id_eans[pid].add(e)
    nm = (row[name_i] if 0 <= name_i < len(row) else "").strip().lower()
    if nm:
        name_to_ids[nm].add(pid)

ean_groups = [ids for ids in ean_to_ids.values() if len(ids) >= 2]
name_groups = [ids for ids in name_to_ids.values() if len(ids) >= 2]

print("unique product ids", len(row_per_id))
print("rows with EAN", sum(1 for r in rows if norm_ean(r[ean_i] if 0 <= ean_i < len(r) else "")))
print("EAN groups (same code, 2+ different id)", len(ean_groups))
print("name groups (same title, 2+ different id)", len(name_groups))
print("ids with multiple feed rows (variants)", sum(1 for c in row_per_id.values() if c > 1))

for ids in sorted(ean_groups, key=len, reverse=True)[:5]:
    e = next(e for e, s in ean_to_ids.items() if s == ids)
    print("  EAN", e, "->", len(ids), "ids", sorted(ids)[:8])
