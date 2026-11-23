#!/usr/bin/env python3
"""逐條核對注文所引與 CBETA 原文。

用法：
    python3 tools/verify_quotes.py                # 核對全部
    python3 tools/verify_quotes.py T08n0235       # 只核對某一部

所引的 l 欄作「T25.1509.0139a25–26」或「T25.1509.0319b29–0319c02」。
取起始行至終止行之後的下一個行號之前的全文，去行號、空白、引號、
CBETA 遺留的「-->」標記後，檢查 q 是否為其子串。

藏經原檔置 sources/canon/，缺失時自 CBETA GitHub 下載（不入庫）。
"""
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CANON = ROOT / "sources" / "canon"
BASE = "https://raw.githubusercontent.com/cbeta-org/xml-p5/master/T/T{v}/{f}.xml"

_cache = {}


def fetch(text_id):
    """text_id 如 T25n1509，返回去標籤後帶 ⟦行號⟧ 的全文。"""
    if text_id in _cache:
        return _cache[text_id]
    path = CANON / (text_id + ".xml")
    if not path.exists() or path.stat().st_size < 1024:
        vol = re.match(r"T(\d\d)", text_id).group(1)
        url = BASE.format(v=vol, f=text_id)
        CANON.mkdir(parents=True, exist_ok=True)
        print("下載", url)
        # urllib 對大檔常中斷，改走 curl 續傳
        subprocess.run(["curl", "-sL", "--retry", "3", "-C", "-", "-o", str(path), url], check=True)
    raw = path.read_text(encoding="utf-8")
    body = re.search(r"<body>(.*)</body>", raw, re.S).group(1)
    body = re.sub(r"<app[^>]*>.*?</app>", "", body, flags=re.S)
    body = re.sub(r"<note[^>]*>.*?</note>", "", body, flags=re.S)
    text = re.sub(r'<lb\b[^>]*?n="([0-9a-z]+)"[^>]*?/>', r"⟦\1⟧", body)
    text = re.sub(r"<[^>]+>", "", text)
    _cache[text_id] = text
    return text


PUNCT = "，。；：、！？…—「」『』（）《》〈〉·"


def norm(s):
    """只留文字，去行號、空白、標點與 CBETA 殘留標記。

    引文獨立成句時標點常隨文改（原文作「；」者引作「。」），
    逐字比對只需文字相合，故標點一概不計。
    """
    s = re.sub(r"⟦[0-9a-z]+⟧", "", s)
    s = re.sub(r"[\s\u3000]", "", s)
    s = s.replace("-->", "").replace("<!--", "")
    return s.translate({ord(c): None for c in PUNCT})


def matches(quote, source):
    """q 可含「……」表省略，逐段按序查找。"""
    parts = [norm(p) for p in re.split(r"…+|⋯+", quote)]
    parts = [p for p in parts if p]
    if not parts:
        return False
    i = 0
    for part in parts:
        j = source.find(part, i)
        if j < 0:
            return False
        i = j + len(part)
    return True


def parse_loc(loc):
    """T25.1509.0139a25–26 → ('T25n1509', '0139a25', '0139a26')"""
    m = re.match(
        r"T(\d+)\.(\d+)\.(\d{4})([abc])(\d{2})(?:[–-](?:(\d{4})([abc]))?(\d{2}))?$", loc
    )
    if not m:
        return None
    vol, num, p1, c1, n1, p2, c2, n2 = m.groups()
    p2 = p2 or p1
    c2 = c2 or c1
    n2 = n2 or n1
    return f"T{vol}n{int(num):04d}", p1 + c1 + n1, p2 + c2 + n2


def segment(text, start, end):
    i = text.find("⟦%s⟧" % start)
    if i < 0:
        return None
    j = text.find("⟦%s⟧" % end, i)
    if j < 0:
        return None
    k = text.find("⟦", j + len(end) + 2)
    return text[i: k if k > 0 else len(text)]


def main(only=None):
    total = bad = 0
    for path in sorted((ROOT / "annotations").glob("*.json")):
        if path.name.startswith("_"):
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        tid = data.get("text", "")
        if only and tid != only:
            continue
        for note in data.get("notes", []):
            for src in note.get("src", []):
                q, loc = src.get("q", ""), src.get("l", "")
                if not q or not loc:
                    continue
                total += 1
                parsed = parse_loc(loc)
                if not parsed:
                    print("!! 行號無法解析", note["id"], loc)
                    bad += 1
                    continue
                text_id, a, b = parsed
                seg = segment(fetch(text_id), a, b)
                if seg is None:
                    print("!! 行號找不到", note["id"], loc)
                    bad += 1
                    continue
                if matches(q, norm(seg)):
                    print("OK  ", note["id"], loc, q[:24])
                else:
                    bad += 1
                    print("FAIL", note["id"], loc, q[:40])
                    print("   原文：", norm(seg)[:120])
    print(f"\n共 {total} 條，不合者 {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else None))
