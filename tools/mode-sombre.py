#!/usr/bin/env python3
"""Recopie les règles du mode sombre automatique pour le réglage manuel « Sombre ».

Dans styles.css, le mode sombre suit le téléphone via
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) ... }
Pour que le choix manuel « Sombre » (data-theme="dark") donne exactement le même rendu sur un
téléphone clair, ce script copie ces règles à la fin du fichier, entre deux repères.
À relancer après toute modification d'une règle sombre :  python3 tools/mode-sombre.py
"""
import re, sys, pathlib

CSS = pathlib.Path(__file__).resolve().parent.parent / "styles.css"
BEGIN = "/* >>> MODE-SOMBRE-GENERE (tools/mode-sombre.py) — ne pas modifier à la main */"
END = "/* <<< MODE-SOMBRE-GENERE */"
SRC = ':root:not([data-theme="light"])'
DST = ':root[data-theme="dark"]'

s = CSS.read_text(encoding="utf8")
if BEGIN in s:
    s = s[: s.index(BEGIN)].rstrip() + "\n"

blocks, i = [], 0
while True:
    j = s.find("@media (prefers-color-scheme: dark)", i)
    if j < 0:
        break
    k = s.index("{", j)
    depth, p = 1, k + 1
    while depth:
        depth += {"{": 1, "}": -1}.get(s[p], 0)
        p += 1
    inner = s[k + 1 : p - 1].strip()
    if SRC not in inner:
        sys.exit("Bloc sombre sans le sélecteur attendu : " + inner[:80])
    blocks.append(inner.replace(SRC, DST))
    i = p

out = s + "\n" + BEGIN + "\n" + "\n".join(blocks) + "\n" + END + "\n"
CSS.write_text(out, encoding="utf8")
print(len(blocks), "blocs sombres recopiés")
