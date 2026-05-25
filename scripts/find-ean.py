import csv
import io
import re
import sys

needle = re.sub(r"\D", "", sys.argv[1] if len(sys.argv) > 1 else "20714052959")
paths = [
    r"C:\Users\guita\.cursor\projects\c-Users-guita-Desktop\uploads\feed-live.csv",
    r"C:\Users\guita\.cursor\projects\c-Users-guita-Desktop\uploads\r-parfyumeriya-1184649-1234-0.csv",
]


def variants(d: str) -> set[str]:
    out = {d}
    if len(d) == 11:
        out.add("0" + d)
    if len(d) == 12 and d.startswith("0"):
        out.add(d.lstrip("0") or "0")
    if len(d) == 13 and d.startswith("0"):
        out.add(d[1:])
    return out


def norm(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def search_file(path: str) -> None:
    print(f"\n=== {path} ===")
    try:
        lines = open(path, encoding="utf-8").readlines()
    except FileNotFoundError:
        print("not found")
        return
    hdr_i = next((i for i, l in enumerate(lines) if "EAN" in l and "Id" in l), None)
    if hdr_i is None:
        print("no header")
        return
    reader = csv.reader(io.StringIO("".join(lines[hdr_i:])))
    headers = [h.strip().strip('"') for h in next(reader)]

    def idx(names):
        for n in names:
            for i, h in enumerate(headers):
                if n.lower() in h.lower():
                    return i
        return -1

    id_i = idx(["Id товара", "Product Id"])
    ean_i = idx(["EAN"])
    name_i = idx(["Название", "Product Name"])
    art_i = idx(["Артикул", "SKU"])

    want = variants(needle)
    hits = []
    all_eans = {}
    for row in reader:
        e = norm(row[ean_i] if 0 <= ean_i < len(row) else "")
        if not e:
            continue
        all_eans.setdefault(e, []).append(row)
        if e in want or any(w in e or e in w for w in want if len(w) >= 8):
            hits.append(row)

    print("needle variants:", sorted(want))
    print("exact/partial hits:", len(hits))
    for row in hits:
        pid = row[id_i] if 0 <= id_i < len(row) else "?"
        e = row[ean_i] if 0 <= ean_i < len(row) else ""
        nm = row[name_i] if 0 <= name_i < len(row) else ""
        art = row[art_i] if 0 <= art_i < len(row) else ""
        print(f"  id={pid} ean={e!r} art={art!r} name={nm[:60]!r}")

    # same normalized key as compare (union on expanded keys)
    from collections import defaultdict

    key_to_ids = defaultdict(set)
    for e, rows in all_eans.items():
        keys = variants(e)
        for row in rows:
            try:
                pid = int(str(row[id_i]).strip())
            except ValueError:
                continue
            for k in keys:
                key_to_ids[k].add(pid)

    for k in sorted(want):
        ids = key_to_ids.get(k, set())
        if len(ids) >= 2:
            print(f"DUPLICATE GROUP key={k} ids={sorted(ids)}")


for p in paths:
    search_file(p)
