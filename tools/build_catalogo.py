"""Extrai o catálogo técnico (Catálogo 2025, PDF) para data/catalogo.json + img/cat/*.jpg.

Cada "linha" do catálogo (ex.: "Mangueira Jardim Trançada Ouro Flex") traz título,
texto, aplicação, características, cores, foto e uma ou mais tabelas técnicas
cuja primeira coluna é o código interno — o mesmo código da Tabela 44.

    pip install pymupdf
    python3 tools/build_catalogo.py [tools/fontes/catalogo2025.pdf]
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

RAIZ = Path(__file__).resolve().parent.parent
PDF = Path(sys.argv[1]) if len(sys.argv) > 1 else RAIZ / "tools/fontes/catalogo2025.pdf"
OUT_JSON = RAIZ / "data/catalogo.json"
OUT_IMG = RAIZ / "img/cat"

COD = re.compile(r"^\d{3,6}(-\d+)?$")


def limpa(s):
    return re.sub(r"\s+", " ", (s or "").replace("\n", " ")).strip()


def slug(s):
    s = s.lower()
    for a, b in (("áàâã", "a"), ("éê", "e"), ("í", "i"), ("óôõ", "o"), ("ú", "u"), ("ç", "c")):
        for ch in a:
            s = s.replace(ch, b)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:60]


def titulos_da_pagina(page):
    """Spans de título (fonte grande), agrupando linhas consecutivas do mesmo título."""
    spans = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                t = s["text"].strip()
                if s["size"] >= 15 and len(t) > 2 and not re.fullmatch(r"[\d|\s]+", t):
                    spans.append({"t": t, "bbox": pymupdf.Rect(s["bbox"]), "size": s["size"]})
    spans.sort(key=lambda s: (s["bbox"].y0, s["bbox"].x0))
    grupos = []
    for s in spans:
        g = next(
            (
                g
                for g in reversed(grupos)
                if abs(s["bbox"].x0 - g["bbox"].x0) < 40
                and -6 <= s["bbox"].y0 - g["bbox"].y1 < s["size"] * 0.8
            ),
            None,
        )
        if g:
            g["t"] = g["t"].rstrip() + " " + s["t"]
            g["bbox"] |= s["bbox"]
        else:
            grupos.append(dict(s))
    for g in grupos:
        t = limpa(g["t"])
        g["t"] = t.title() if t.isupper() else t
    return grupos


def lado(rect, meio):
    return 0 if (rect.x0 + rect.x1) / 2 < meio else 1


def nomes_colunas(cab, ncols):
    nomes = []
    grupo = [None] * ncols
    if cab:
        atual = None
        for i in range(ncols):
            v = limpa(cab[0][i]) if i < len(cab[0]) else ""
            atual = v or atual
            grupo[i] = atual
    for i in range(ncols):
        g = grupo[i] or ""
        sub = limpa(cab[1][i]) if len(cab) > 1 and i < len(cab[1]) and cab[1][i] else ""
        if g in ("Interno",):
            g = "Ø Interno"
        if g in ("Externo",):
            g = "Ø Externo"
        nomes.append(f"{g} ({sub})" if g and sub and sub != g else (g or sub))
    return nomes


def ler_tabela(tab):
    dados = tab.extract()
    i0 = next((i for i, r in enumerate(dados) if r and COD.match(limpa(r[0]))), None)
    if i0 is None:
        return None
    cols = nomes_colunas(dados[:i0], tab.col_count)
    cols[0] = "Código"
    corpo = [[limpa(v) for v in r] for r in dados[i0:] if COD.match(limpa(r[0]))]
    # Células mescladas geram colunas repetidas/vazias: junta por nome.
    ordem, idx = [], {}
    for i, c in enumerate(cols):
        if c not in idx:
            idx[c] = len(ordem)
            ordem.append([c, []])
        ordem[idx[c]][1].append(i)
    colunas, linhas = [], [[] for _ in corpo]
    for nome, ids in ordem:
        vals = [next((r[i] for i in ids if i < len(r) and r[i]), "") for r in corpo]
        if not any(vals):
            continue
        colunas.append(nome)
        for li, v in enumerate(vals):
            linhas[li].append(v)
    return {"colunas": colunas, "linhas": linhas} if linhas else None


def texto_linha(page, lado_idx, meio, y0, y1):
    partes = []
    for b in page.get_text("blocks"):
        r = pymupdf.Rect(b[:4])
        if lado(r, meio) != lado_idx or r.y0 < y0 - 1 or r.y0 > y1:
            continue
        partes.append((r.y0, r.x0, limpa(b[4])))
    partes.sort()
    return " ".join(p[2] for p in partes)


def separa_campos(txt):
    campos = {"texto": txt, "aplicacao": "", "caracteristicas": "", "cores": ""}
    m = re.search(r"Dispon[íi]ve(?:l|is) na[s]? cor(?:es)?\s*:?(.*)$", txt, re.I)
    if m:
        cores = re.split(r"\s*(?:\*|\.\s+(?=[A-ZÁÉÍÓÚÇ]{3,}))", limpa(m.group(1)))[0]
        campos["cores"] = cores.strip(" .")
        txt = txt[: m.start()]
    m = re.search(r"Caracter[íi]sticas T[ée]cnicas\s*:(.*)$", txt, re.I)
    if m:
        campos["caracteristicas"] = limpa(m.group(1))
        txt = txt[: m.start()]
    m = re.search(r"Aplica[çc][ãa]o\s*:(.*)$", txt, re.I)
    if m:
        campos["aplicacao"] = limpa(m.group(1))
        txt = txt[: m.start()]
    campos["texto"] = limpa(txt)
    return campos


def main():
    doc = pymupdf.open(PDF)
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    for f in OUT_IMG.glob("*.jpg"):
        f.unlink()
    linhas, itens = [], {}
    ultimo = None
    for pno, page in enumerate(doc):
        meio = page.rect.width / 2
        titulos = [t for t in titulos_da_pagina(page) if t["bbox"].y0 > 60]
        for t in titulos:
            t["lado"] = lado(t["bbox"], meio)
            t["linha"] = None
        tabelas = page.find_tables().tables
        imagens = [
            pymupdf.Rect(i["bbox"])
            for i in page.get_image_info()
            if pymupdf.Rect(i["bbox"]).width < 480 and pymupdf.Rect(i["bbox"]).y0 > 20
        ]

        def linha_do_titulo(t):
            if t["linha"] is None:
                lin = {
                    "id": slug(t["t"]),
                    "titulo": limpa(t["t"]),
                    "pagina": pno + 1,
                    "_t": t,
                    "_tabs": [],
                    "img": None,
                    "tabelas": [],
                }
                linhas.append(lin)
                t["linha"] = lin
            return t["linha"]

        extraidas, orfas = [], []
        for tab in sorted(tabelas, key=lambda x: (x.bbox[1], x.bbox[0])):
            tb = pymupdf.Rect(tab.bbox)
            t_dados = ler_tabela(tab)
            if not t_dados:
                continue
            t_dados |= {"_bbox": tb, "_page": pno}
            lt = lado(tb, meio)
            cands = [t for t in titulos if t["lado"] == lt and t["bbox"].y0 < tb.y0]
            if cands:
                lin = linha_do_titulo(max(cands, key=lambda t: t["bbox"].y0))
                lin["_tabs"].append(t_dados)
                extraidas.append((t_dados, lin))
                ultimo = lin
            else:
                orfas.append(t_dados)
        # Tabela sem título no mesmo lado: continuação de outra tabela da página
        # com o mesmo cabeçalho; senão, da última linha vista.
        for t_dados in orfas:
            par = next((lin for x, lin in extraidas if x["colunas"] == t_dados["colunas"]), None) or ultimo
            if par:
                par["_tabs"].append(t_dados)
        # Texto e foto de cada título desta página.
        for t in titulos:
            if t["linha"] is None:
                continue
            lin = t["linha"]
            tb_top = min([x["_bbox"].y0 for x in lin["_tabs"] if x["_page"] == pno] + [page.rect.height])
            outros = [o["bbox"].y0 for o in titulos if o["lado"] == t["lado"] and o["bbox"].y0 > t["bbox"].y1]
            fim = min([tb_top] + outros)
            lin.update(separa_campos(texto_linha(page, t["lado"], meio, t["bbox"].y1, fim - 2)))
            perto = [
                r
                for r in imagens
                if lado(r, meio) == t["lado"] and r.y1 > t["bbox"].y0 - 160 and r.y0 < fim + 40
            ]
            if perto:
                r = min(perto, key=lambda r: abs((r.y0 + r.y1) / 2 - t["bbox"].y1))
                nome = f"{lin['id']}.jpg"
                pix = page.get_pixmap(clip=r, dpi=150)
                if pix.width > 420:
                    pix = page.get_pixmap(clip=r, dpi=int(150 * 420 / pix.width))
                pix.save(OUT_IMG / nome, jpg_quality=72)
                lin["img"] = f"img/cat/{nome}"

    saida = []
    ids = set()
    for lin in linhas:
        if not lin["_tabs"]:
            continue
        base, n = lin["id"], 2
        while lin["id"] in ids:
            lin["id"] = f"{base}-{n}"
            n += 1
        ids.add(lin["id"])
        idx = len(saida)
        tabelas = []
        for tab in lin["_tabs"]:
            ti = len(tabelas)
            tabelas.append({"colunas": tab["colunas"], "linhas": tab["linhas"]})
            for r in tab["linhas"]:
                itens.setdefault(r[0], [idx, ti])
        saida.append(
            {
                k: lin.get(k, "")
                for k in ("id", "titulo", "pagina", "texto", "aplicacao", "caracteristicas", "cores", "img")
            }
            | {"tabelas": tabelas}
        )
    OUT_JSON.write_text(json.dumps({"linhas": saida, "itens": itens}, ensure_ascii=False))
    print(f"{len(saida)} linhas, {len(itens)} códigos, {sum(1 for l in saida if l['img'])} fotos")


if __name__ == "__main__":
    main()
