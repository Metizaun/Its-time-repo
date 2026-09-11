#!/usr/bin/env python3
"""
Gerador do relatorio de auditoria de seguranca (PDF, pt-BR).

Saida: docs/security-audit/relatorio-auditoria-seguranca.pdf

Como rodar (ambiente isolado, nada global):

    python -m venv .venv
    .venv/Scripts/python -m pip install reportlab matplotlib   # Windows
    .venv/bin/python     -m pip install reportlab matplotlib   # Linux/macOS
    .venv/Scripts/python docs/security-audit/gerar_relatorio.py

Os dados da auditoria ficam em dados_auditoria.py (mesmo diretorio). Para
regerar o relatorio depois de uma nova rodada, edite aquele arquivo e rode
este script novamente.
"""

from __future__ import annotations

import os
import sys
import textwrap
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Patch

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    BaseDocTemplate,
    CondPageBreak,
    Flowable,
    Frame,
    HRFlowable,
    Image,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import dados_auditoria as D  # noqa: E402

OUT_PDF = HERE / "relatorio-auditoria-seguranca.pdf"
CHART_DIR = HERE / ".charts"

# ---------------------------------------------------------------------------
# Paleta
# ---------------------------------------------------------------------------

SEV = {
    "critica": dict(label="CRITICA", hex="#B91C1C", ordem=0),
    "alta": dict(label="ALTA", hex="#EA580C", ordem=1),
    "media": dict(label="MEDIA", hex="#D97706", ordem=2),
    "baixa": dict(label="BAIXA", hex="#2563EB", ordem=3),
    "info": dict(label="INFORMATIVA", hex="#64748B", ordem=4),
}
VERDE_FORTE = "#059669"

INK = colors.HexColor("#0F172A")
INK_SOFT = colors.HexColor("#475569")
INK_FAINT = colors.HexColor("#94A3B8")
RULE = colors.HexColor("#E2E8F0")
SURFACE = colors.HexColor("#F8FAFC")
CODE_BG = colors.HexColor("#F1F5F9")
ISSUE_BG = colors.HexColor("#FAFAF9")

RELATORIO_NOME = "Relatorio de Auditoria de Seguranca"

# ---------------------------------------------------------------------------
# Estilos
# ---------------------------------------------------------------------------

_base = getSampleStyleSheet()


def _s(name, **kw):
    kw.setdefault("parent", _base["BodyText"])
    return ParagraphStyle(name, **kw)


ST = {
    "capa_kicker": _s("capa_kicker", fontName="Helvetica-Bold", fontSize=9.5, leading=13,
                      textColor=colors.HexColor("#B91C1C"), alignment=TA_LEFT, spaceAfter=6),
    "capa_titulo": _s("capa_titulo", fontName="Helvetica-Bold", fontSize=27, leading=32,
                      textColor=INK, alignment=TA_LEFT, spaceAfter=4),
    "capa_sub": _s("capa_sub", fontName="Helvetica", fontSize=13.5, leading=18,
                   textColor=INK_SOFT, alignment=TA_LEFT, spaceAfter=16),
    "h1": _s("h1", fontName="Helvetica-Bold", fontSize=17, leading=21, textColor=INK,
             spaceBefore=2, spaceAfter=9),
    "h2": _s("h2", fontName="Helvetica-Bold", fontSize=12, leading=15.5, textColor=INK,
             spaceBefore=13, spaceAfter=5),
    "h3": _s("h3", fontName="Helvetica-Bold", fontSize=10, leading=13.5, textColor=INK,
             spaceBefore=9, spaceAfter=3),
    "body": _s("body", fontName="Helvetica", fontSize=9.1, leading=13.2, textColor=INK,
               alignment=TA_JUSTIFY, spaceAfter=5),
    "body_l": _s("body_l", fontName="Helvetica", fontSize=9.1, leading=13.2, textColor=INK,
                 alignment=TA_LEFT, spaceAfter=5),
    "small": _s("small", fontName="Helvetica", fontSize=8, leading=11, textColor=INK_SOFT,
                alignment=TA_LEFT, spaceAfter=3),
    "small_j": _s("small_j", fontName="Helvetica", fontSize=8, leading=11.4, textColor=INK_SOFT,
                  alignment=TA_JUSTIFY, spaceAfter=3),
    "cell": _s("cell", fontName="Helvetica", fontSize=8, leading=11, textColor=INK,
               alignment=TA_LEFT, spaceAfter=0),
    "cell_j": _s("cell_j", fontName="Helvetica", fontSize=8, leading=11, textColor=INK,
                 alignment=TA_JUSTIFY, spaceAfter=0),
    "cell_hdr": _s("cell_hdr", fontName="Helvetica-Bold", fontSize=8, leading=10.5,
                   textColor=colors.white, alignment=TA_LEFT, spaceAfter=0),
    "path": _s("path", fontName="Courier-Bold", fontSize=7.4, leading=10, textColor=INK,
               alignment=TA_LEFT, spaceAfter=0),
    "chip": _s("chip", fontName="Helvetica-Bold", fontSize=7, leading=9,
               textColor=colors.white, alignment=TA_CENTER, spaceAfter=0),
    "kpi_num": _s("kpi_num", fontName="Helvetica-Bold", fontSize=22, leading=25,
                  alignment=TA_CENTER, spaceAfter=0),
    "kpi_lbl": _s("kpi_lbl", fontName="Helvetica-Bold", fontSize=6.6, leading=9,
                  textColor=INK_SOFT, alignment=TA_CENTER, spaceAfter=0),
    "code": ParagraphStyle("code", fontName="Courier", fontSize=7.1, leading=9.4,
                           textColor=colors.HexColor("#0B1220")),
    "issue": ParagraphStyle("issue", fontName="Courier", fontSize=7.0, leading=9.3,
                            textColor=colors.HexColor("#111827")),
    "issue_tag": _s("issue_tag", fontName="Courier-Bold", fontSize=7.6, leading=10,
                    textColor=colors.HexColor("#B91C1C"), alignment=TA_LEFT, spaceAfter=2),
    "footer": _s("footer", fontName="Helvetica", fontSize=7.2, leading=9, textColor=INK_FAINT),
}


def P(txt, style="body"):
    return Paragraph(txt, ST[style])


def esc(txt: str) -> str:
    return (str(txt).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


# ---------------------------------------------------------------------------
# Flowables auxiliares
# ---------------------------------------------------------------------------

class Chip(Flowable):
    """Etiqueta de severidade com fundo colorido."""

    def __init__(self, texto, cor_hex, largura=54, altura=11.5, fonte=6.6):
        super().__init__()
        self.texto = texto
        self.cor = colors.HexColor(cor_hex)
        self.width = largura
        self.height = altura
        self.fonte = fonte

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(self.cor)
        c.roundRect(0, 0, self.width, self.height, 2.6, stroke=0, fill=1)
        c.setFillColor(colors.white)
        c.setFont("Helvetica-Bold", self.fonte)
        c.drawCentredString(self.width / 2.0, self.height / 2.0 - self.fonte * 0.36, self.texto)


class Bar(Flowable):
    """Barra horizontal proporcional, usada nas mini-metricas."""

    def __init__(self, frac, cor_hex, largura, altura=5.5):
        super().__init__()
        self.frac = max(0.0, min(1.0, frac))
        self.cor = colors.HexColor(cor_hex)
        self.width = largura
        self.height = altura

    def wrap(self, *_):
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(colors.HexColor("#E8EDF3"))
        c.roundRect(0, 0, self.width, self.height, self.height / 2, stroke=0, fill=1)
        w = self.width * self.frac
        if w > 0.5:
            c.setFillColor(self.cor)
            c.roundRect(0, 0, max(w, self.height), self.height, self.height / 2, stroke=0, fill=1)


def _quebrar_codigo(codigo: str, largura: float, fonte: float) -> list[str]:
    """Quebra linhas longas respeitando a largura util em fonte monoespacada."""
    limite = max(20, int((largura - 16) / (fonte * 0.6)))
    linhas: list[str] = []
    for linha in codigo.split("\n"):
        linha = linha.replace("\t", "    ")
        if len(linha) <= limite:
            linhas.append(linha)
            continue
        indent = len(linha) - len(linha.lstrip())
        envolvido = textwrap.wrap(
            linha, width=limite, subsequent_indent=" " * min(indent + 2, limite - 10),
            break_long_words=True, break_on_hyphens=False, drop_whitespace=False,
        )
        linhas.extend(envolvido or [linha[:limite]])
    return linhas


def caixa_codigo(codigo: str, largura: float, bg=CODE_BG, borda="#CBD5E1",
                 fonte=7.1, leading=9.4):
    """
    Bloco de codigo monoespacado com fundo.

    Uma linha de texto por linha de tabela: assim o bloco pode se dividir entre
    paginas (Preformatted em celula unica nao divide e estoura o frame).
    """
    linhas = _quebrar_codigo(codigo, largura, fonte)
    estilo = ParagraphStyle("codeblk", fontName="Courier", fontSize=fonte, leading=leading,
                            textColor=colors.HexColor("#0B1220"))
    dados = [[Preformatted(l if l.strip() else " ", estilo)] for l in linhas] or [[Preformatted(" ", estilo)]]
    t = Table(dados, colWidths=[largura], rowHeights=[leading] * len(dados),
              splitByRow=1, repeatRows=0)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor(borda)),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


# ---------------------------------------------------------------------------
# Graficos
# ---------------------------------------------------------------------------

def _contagem_severidade():
    cont = {k: 0 for k in SEV}
    for a in D.ACHADOS:
        cont[a["severidade"]] += 1
    return cont


def _contagem_categoria():
    ordem = [
        "1. Banco sem tranca (isolamento de tenant)",
        "2. Permissao definida no navegador",
        "3. IDOR",
        "4. Chaves expostas",
        "5. Inputs sem tratamento (XSS)",
        "Extra (defesa em profundidade)",
    ]
    cont = {k: [] for k in ordem}
    for a in D.ACHADOS:
        cont.setdefault(a["categoria"], []).append(a)
    return [(k, cont[k]) for k in ordem if k in cont]


def grafico_rosca(path: Path):
    cont = _contagem_severidade()
    itens = [(SEV[k]["label"], v, SEV[k]["hex"]) for k, v in cont.items() if v > 0]
    itens.sort(key=lambda x: [s["label"] for s in SEV.values()].index(x[0]))
    labels = [f"{n}  ({v})" for n, v, _ in itens]
    vals = [v for _, v, _ in itens]
    cols = [c for _, _, c in itens]

    fig, ax = plt.subplots(figsize=(5.2, 2.35), dpi=240)
    wedges, _ = ax.pie(
        vals, colors=cols, startangle=90, counterclock=False,
        wedgeprops=dict(width=0.42, edgecolor="white", linewidth=2.0),
    )
    total = sum(vals)
    ax.text(0, 0.11, str(total), ha="center", va="center",
            fontsize=24, fontweight="bold", color="#0F172A")
    ax.text(0, -0.21, "achados", ha="center", va="center", fontsize=8, color="#64748B")
    ax.legend(wedges, labels, loc="center left", bbox_to_anchor=(1.00, 0.5),
              frameon=False, fontsize=8.2, handlelength=0.9, handleheight=0.9,
              labelspacing=0.60, borderpad=0)
    ax.set(aspect="equal")
    fig.subplots_adjust(left=0.02, right=0.48, top=1.0, bottom=0.0)
    fig.savefig(path, transparent=True)
    plt.close(fig)


def grafico_barras(path: Path):
    cats = _contagem_categoria()
    curtos = {
        "1. Banco sem tranca (isolamento de tenant)": "1. Isolamento\nde tenant",
        "2. Permissao definida no navegador": "2. Permissao no\nnavegador",
        "3. IDOR": "3. IDOR",
        "4. Chaves expostas": "4. Chaves\nexpostas",
        "5. Inputs sem tratamento (XSS)": "5. XSS / inputs",
        "Extra (defesa em profundidade)": "Extra: defesa em\nprofundidade",
    }
    nomes = [curtos.get(c, c) for c, _ in cats]
    ordem_sev = ["critica", "alta", "media", "baixa", "info"]
    empilhado = {s: [] for s in ordem_sev}
    for _, achados in cats:
        for s in ordem_sev:
            empilhado[s].append(sum(1 for a in achados if a["severidade"] == s))

    fig, ax = plt.subplots(figsize=(6.5, 2.85), dpi=230)
    base = [0] * len(nomes)
    for s in ordem_sev:
        vals = empilhado[s]
        if not any(vals):
            continue
        ax.bar(nomes, vals, bottom=base, color=SEV[s]["hex"], width=0.6,
               edgecolor="white", linewidth=0.8, label=SEV[s]["label"])
        base = [b + v for b, v in zip(base, vals)]

    for i, tot in enumerate(base):
        if tot:
            ax.text(i, tot + 0.12, str(tot), ha="center", va="bottom",
                    fontsize=9, fontweight="bold", color="#0F172A")

    ax.set_ylim(0, max(base) + 1.35)
    ax.set_ylabel("achados", fontsize=8, color="#64748B")
    ax.tick_params(axis="x", labelsize=7.4, colors="#334155", length=0)
    ax.tick_params(axis="y", labelsize=7.4, colors="#64748B", length=0)
    ax.set_yticks(range(0, max(base) + 2))
    for sp in ("top", "right", "left"):
        ax.spines[sp].set_visible(False)
    ax.spines["bottom"].set_color("#CBD5E1")
    ax.grid(axis="y", color="#EDF2F7", linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    handles = [Patch(facecolor=SEV[s]["hex"], label=SEV[s]["label"])
               for s in ordem_sev if any(empilhado[s])]
    ax.legend(handles=handles, loc="upper right", frameon=False, fontsize=7.2,
              ncol=len(handles), handlelength=0.8, handleheight=0.8, columnspacing=1.0)
    fig.tight_layout(pad=0.35)
    fig.savefig(path, transparent=True)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Documento: templates de pagina, cabecalho e rodape
# ---------------------------------------------------------------------------

MARGEM = 2 * cm
LARG_UTIL = A4[0] - 2 * MARGEM


class Doc(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(
            str(path), pagesize=A4,
            leftMargin=MARGEM, rightMargin=MARGEM, topMargin=MARGEM, bottomMargin=MARGEM,
            title=f"{RELATORIO_NOME} - {D.PROJETO}",
            author="Auditoria de seguranca (Claude Code)",
            subject="Auditoria estatica de seguranca de aplicacao",
        )
        capa = Frame(MARGEM, MARGEM, LARG_UTIL, A4[1] - 2 * MARGEM, id="capa",
                     leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        corpo = Frame(MARGEM, MARGEM + 8 * mm, LARG_UTIL, A4[1] - 2 * MARGEM - 16 * mm,
                      id="corpo", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
        self.addPageTemplates([
            PageTemplate(id="Capa", frames=[capa], onPage=self._capa),
            PageTemplate(id="Corpo", frames=[corpo], onPage=self._corpo),
        ])

    def _capa(self, canv, _doc):
        canv.saveState()
        canv.setFillColor(colors.HexColor("#0F172A"))
        canv.rect(0, A4[1] - 12 * mm, A4[0], 12 * mm, stroke=0, fill=1)
        canv.setFillColor(colors.HexColor("#B91C1C"))
        canv.rect(0, A4[1] - 12 * mm, A4[0] * 0.32, 12 * mm, stroke=0, fill=1)
        canv.setFillColor(colors.HexColor("#0F172A"))
        canv.rect(0, 0, A4[0], 5 * mm, stroke=0, fill=1)
        canv.restoreState()

    def _corpo(self, canv, doc):
        canv.saveState()
        y = A4[1] - MARGEM + 5 * mm
        canv.setStrokeColor(RULE)
        canv.setLineWidth(0.5)
        canv.line(MARGEM, y, A4[0] - MARGEM, y)
        canv.setFont("Helvetica", 7.2)
        canv.setFillColor(INK_FAINT)
        canv.drawString(MARGEM, y + 2.6 * mm, f"{RELATORIO_NOME} — {D.PROJETO}")
        canv.drawRightString(A4[0] - MARGEM, y + 2.6 * mm, D.DATA_AUDITORIA)

        yb = MARGEM - 2 * mm
        canv.line(MARGEM, yb + 4 * mm, A4[0] - MARGEM, yb + 4 * mm)
        canv.setFont("Helvetica", 7.2)
        canv.setFillColor(INK_FAINT)
        canv.drawString(MARGEM, yb, "Confidencial — uso interno")
        canv.setFont("Helvetica-Bold", 7.6)
        canv.setFillColor(INK_SOFT)
        canv.drawRightString(A4[0] - MARGEM, yb, f"Pagina {doc.page}")
        canv.restoreState()


# ---------------------------------------------------------------------------
# Secoes
# ---------------------------------------------------------------------------

def secao_capa():
    f = []
    cont = _contagem_severidade()
    f.append(Spacer(1, 30 * mm))
    f.append(P("AUDITORIA ESTATICA DE SEGURANCA DE APLICACAO", "capa_kicker"))
    f.append(P(f"{RELATORIO_NOME} — {esc(D.PROJETO)}", "capa_titulo"))
    f.append(P(f"{D.DATA_AUDITORIA} &nbsp;·&nbsp; branch <b>{esc(D.BRANCH)}</b> "
               f"&nbsp;·&nbsp; commit <b>{esc(D.COMMIT)}</b>", "capa_sub"))
    f.append(HRFlowable(width="100%", thickness=1.1, color=colors.HexColor("#0F172A"),
                        spaceBefore=2, spaceAfter=12))

    # Faixa de KPIs
    cels, estilo = [], [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 9),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
    ]
    chaves = [k for k in SEV if cont[k] > 0] + ["fortes"]
    for i, k in enumerate(chaves):
        if k == "fortes":
            num, lbl, hexc = len(D.PONTOS_FORTES), "PONTOS FORTES", VERDE_FORTE
        else:
            num, lbl, hexc = cont[k], SEV[k]["label"], SEV[k]["hex"]
        cels.append([
            Paragraph(f'<font color="{hexc}">{num}</font>', ST["kpi_num"]),
            P(lbl, "kpi_lbl"),
        ])
        estilo += [
            ("BACKGROUND", (i, 0), (i, 1), SURFACE),
            ("LINEBELOW", (i, 0), (i, 0), 0, colors.white),
        ]
        if i:
            estilo.append(("LINEBEFORE", (i, 0), (i, 1), 0.5, RULE))

    n = len(chaves)
    w = LARG_UTIL / n
    kpis = Table([[c[0] for c in cels], [c[1] for c in cels]], colWidths=[w] * n)
    kpis.setStyle(TableStyle(estilo + [
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("TOPPADDING", (0, 1), (-1, 1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 0),
    ]))
    f.append(kpis)
    f.append(Spacer(1, 12 * mm))

    # Stack detectada
    f.append(P("Stack detectada", "h2"))
    linhas = [[P("<b>Camada</b>", "cell"), P("<b>Tecnologia identificada</b>", "cell")]]
    for k, v in D.STACK:
        linhas.append([P(f"<b>{esc(k)}</b>", "cell"), P(esc(v), "cell_j")])
    t = Table(linhas, colWidths=[4.4 * cm, LARG_UTIL - 4.4 * cm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEF2F7")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    f.append(t)
    f.append(Spacer(1, 7 * mm))

    f.append(P("Escopo auditado", "h2"))
    for item in D.ESCOPO:
        f.append(P(f"•&nbsp;&nbsp;{esc(item)}", "small_j"))
    return f


def secao_metodologia():
    f = [P("Nota metodologica", "h1")]
    f.append(P(
        "Cada uma das cinco categorias solicitadas foi traduzida para o equivalente desta stack antes da "
        "revisao. O mapeamento abaixo descreve como cada categoria foi investigada e o que foi efetivamente "
        "percorrido, para que a cobertura da auditoria seja verificavel."))
    for titulo, texto in D.METODOLOGIA:
        f.append(P(esc(titulo), "h3"))
        f.append(P(esc(texto)))
    f.append(P("Limites e premissas", "h3"))
    for obs in D.OBSERVACOES_GERAIS:
        f.append(P(f"•&nbsp;&nbsp;{esc(obs)}", "small_j"))
    return f


def secao_resumo():
    f = [P("Resumo executivo", "h1")]
    cont = _contagem_severidade()
    total = sum(cont.values())
    crit_alta = cont["critica"] + cont["alta"]
    f.append(P(
        f"Foram identificados <b>{total} achados</b> — {cont['critica']} de severidade critica, "
        f"{cont['alta']} alta, {cont['media']} media, {cont['baixa']} baixa e {cont['info']} informativa — "
        f"alem de <b>{len(D.PONTOS_FORTES)} controles verificados e aprovados</b>. "
        "O nucleo do produto se sustenta bem: o isolamento multi-tenant e implementado em duas camadas "
        "independentes (RLS no Postgres e filtro manual por <font face='Courier'>aces_id</font> no backend) e a "
        "camada de servico do backend apresentou cobertura integral de guardas de posse nos 53 metodos que "
        "recebem contexto autenticado."))
    f.append(P(
        f"Os {crit_alta} achados de severidade critica e alta estao concentrados nas <b>bordas de integracao "
        "com parceiros</b> — endpoints que nao passam pelo <font face='Courier'>authMiddleware</font> nem pela "
        "camada de servico e que, por isso, ficaram fora do padrao seguido pelo resto do sistema. O caso mais "
        "grave e <font face='Courier'>POST /webhook/login</font>, que emite um token de webhook assinado para "
        "qualquer tenant sem exigir nenhuma credencial. Somam-se a isso um padrao de <i>falha aberta</i> na "
        "validacao do webhook da Evolution, a ausencia de autorizacao numa Edge Function de convite de usuario "
        "e uma senha de root de producao em texto puro em scripts locais."))
    f.append(Spacer(1, 3 * mm))

    CHART_DIR.mkdir(exist_ok=True)
    p_rosca, p_barras = CHART_DIR / "rosca.png", CHART_DIR / "barras.png"
    grafico_rosca(p_rosca)
    grafico_barras(p_barras)

    img = Image(str(p_rosca), width=LARG_UTIL * 0.92, height=LARG_UTIL * 0.92 * (2.35 / 5.2))
    img.hAlign = "CENTER"
    f.append(KeepTogether([P("Distribuicao por severidade", "h2"), img]))
    f.append(Spacer(1, 3 * mm))

    img2 = Image(str(p_barras), width=LARG_UTIL, height=LARG_UTIL * (2.85 / 6.5))
    img2.hAlign = "CENTER"
    f.append(KeepTogether([
        P("Distribuicao por categoria (empilhada por severidade)", "h2"), img2]))
    f.append(Spacer(1, 4 * mm))

    # Painel de veredito por categoria
    f.append(P("Veredito por categoria", "h2"))
    linhas = [[P("<b>Categoria</b>", "cell"), P("<b>Achados</b>", "cell"),
               P("<b>Pior severidade</b>", "cell"), P("<b>Leitura</b>", "cell")]]
    leitura = {
        "1. Banco sem tranca (isolamento de tenant)":
            "Duplo mecanismo (RLS + filtro por aces_id) implementado com consistencia; falhas pontuais de escopo, sem vazamento sistemico.",
        "2. Permissao definida no navegador":
            "Maioria dos gates de papel tem equivalente no servidor (RLS ADMIN ou ensureAdmin); 3 excecoes reais.",
        "3. IDOR":
            "Objetos por ID sao consistentemente validados na camada de servico; as falhas estao nas rotas que a contornam.",
        "4. Chaves expostas":
            "Nada sensivel versionado e producao sem defaults; problemas em arquivo local e no historico.",
        "5. Inputs sem tratamento (XSS)":
            "Frontend praticamente sem sinks; os achados sao reflexao no backend e endurecimento.",
        "Extra (defesa em profundidade)":
            "Itens de robustez que nao se encaixam nas cinco categorias solicitadas.",
    }
    for cat, achados in _contagem_categoria():
        pior = min(achados, key=lambda a: SEV[a["severidade"]]["ordem"])["severidade"]
        linhas.append([
            P(esc(cat), "cell"),
            P(str(len(achados)), "cell"),
            Chip(SEV[pior]["label"], SEV[pior]["hex"], largura=52),
            P(esc(leitura.get(cat, "")), "cell_j"),
        ])
    t = Table(linhas, colWidths=[5.0 * cm, 1.9 * cm, 2.1 * cm, LARG_UTIL - 9.0 * cm], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#EEF2F7")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, -1), "CENTER"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]))
    f.append(t)
    return f


def secao_pontos():
    f = [P("Pontos fortes verificados", "h1")]
    f.append(P(
        "Os itens abaixo foram inspecionados e <b>aprovados</b>. Cada um traz a evidencia com arquivo e linha, "
        "tanto para registrar o que ja esta protegido quanto para demonstrar a cobertura da auditoria — e, em "
        "varios casos, para servir de referencia interna na correcao dos achados."))
    f.append(Spacer(1, 1.5 * mm))
    for i, pf in enumerate(D.PONTOS_FORTES, 1):
        bloco = [
            Table(
                [[Chip("OK", VERDE_FORTE, largura=26, altura=11),
                  P(f"<b>{i}. {esc(pf['titulo'])}</b>", "cell")]],
                colWidths=[30, LARG_UTIL - 30],
                style=TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 0),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 1),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
                ]),
            ),
            Table(
                [[P(esc(pf["evidencia"]), "small_j")]],
                colWidths=[LARG_UTIL - 30],
                style=TableStyle([
                    ("LINEBEFORE", (0, 0), (0, -1), 1.6, colors.HexColor(VERDE_FORTE)),
                    ("LEFTPADDING", (0, 0), (-1, -1), 7),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                    ("TOPPADDING", (0, 0), (-1, -1), 1),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ]),
            ),
        ]
        wrap = Table([[bloco[0]], [bloco[1]]], colWidths=[LARG_UTIL])
        wrap.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("ALIGN", (0, 1), (0, 1), "RIGHT"),
        ]))
        f.append(KeepTogether(wrap))

    f.append(PageBreak())
    f.append(P("Pontos fracos — riscos centrais", "h1"))
    f.append(P(
        "Os seis temas abaixo sintetizam a causa-raiz dos achados. Corrigir apenas os sintomas resolve esta "
        "auditoria; tratar estes temas evita a reincidencia."))
    for i, pw in enumerate(D.PONTOS_FRACOS, 1):
        cab = Table(
            [[Chip(f"R{i}", "#B91C1C", largura=26, altura=11),
              P(f"<b>{esc(pw['titulo'])}</b>", "cell")]],
            colWidths=[30, LARG_UTIL - 30],
            style=TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
            ]),
        )
        corpo = Table(
            [[P(esc(pw["detalhe"]), "small_j")]],
            colWidths=[LARG_UTIL - 30],
            style=TableStyle([
                ("LINEBEFORE", (0, 0), (0, -1), 1.6, colors.HexColor("#B91C1C")),
                ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]),
        )
        wrap = Table([[cab], [corpo]], colWidths=[LARG_UTIL])
        wrap.setStyle(TableStyle([
            ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
            ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ("ALIGN", (0, 1), (0, 1), "RIGHT"),
        ]))
        f.append(KeepTogether(wrap))
    return f


def secao_indice_achados():
    f = [P("Indice de achados", "h1")]
    f.append(P("Visao consolidada. O detalhamento por categoria vem nas paginas seguintes."))
    linhas = [[P("<b>Sev.</b>", "cell_hdr"), P("<b>ID</b>", "cell_hdr"),
               P("<b>Achado</b>", "cell_hdr"), P("<b>Arquivo:linha principal</b>", "cell_hdr")]]
    ordenados = sorted(D.ACHADOS, key=lambda a: (SEV[a["severidade"]]["ordem"], a["id"]))
    estilo = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, RULE),
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]
    for i, a in enumerate(ordenados, start=1):
        sev = SEV[a["severidade"]]
        linhas.append([
            Chip(sev["label"], sev["hex"], largura=52),
            P(f"<b>{a['id']}</b>", "cell"),
            P(esc(a["titulo"]), "cell"),
            Paragraph(esc(a["arquivos"][0]), ST["path"]),
        ])
        if i % 2 == 0:
            estilo.append(("BACKGROUND", (0, i), (-1, i), SURFACE))
    t = Table(linhas, colWidths=[2.0 * cm, 1.0 * cm, 8.0 * cm, LARG_UTIL - 11.0 * cm], repeatRows=1)
    t.setStyle(TableStyle(estilo))
    f.append(t)
    return f


def secao_achados_detalhados():
    f = [P("Achados detalhados por categoria", "h1")]
    f.append(P(
        "Para cada achado: severidade, arquivo e linha exatos, trecho do codigo, por que e explorável, impacto, "
        "condicao de explorabilidade, correcao sugerida e critérios de aceite verificaveis."))

    for cat, achados in _contagem_categoria():
        achados = sorted(achados, key=lambda a: (SEV[a["severidade"]]["ordem"], a["id"]))
        f.append(CondPageBreak(70 * mm))
        cab = Table([[P(f"<b>{esc(cat)}</b>", "cell_hdr"),
                      P(f"<b>{len(achados)} achado(s)</b>", "cell_hdr")]],
                    colWidths=[LARG_UTIL - 3.2 * cm, 3.2 * cm])
        cab.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#0F172A")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]))
        f.append(Spacer(1, 4 * mm))
        f.append(cab)

        for a in achados:
            sev = SEV[a["severidade"]]
            f.append(Spacer(1, 4 * mm))

            titulo = Table(
                [[Chip(sev["label"], sev["hex"], largura=58, altura=12.5, fonte=7),
                  P(f"<b>{a['id']} — {esc(a['titulo'])}</b>", "cell")]],
                colWidths=[64, LARG_UTIL - 64],
                style=TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
                    ("LINEBEFORE", (0, 0), (0, -1), 2.4, colors.HexColor(sev["hex"])),
                    ("BOX", (0, 0), (-1, -1), 0.5, RULE),
                    ("LEFTPADDING", (0, 0), (0, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                    ("TOPPADDING", (0, 0), (-1, -1), 5),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
                ]),
            )
            f.append(KeepTogether([titulo, Spacer(1, 2.4 * mm),
                                   P("<b>Localizacao</b>", "h3")]))
            for caminho in a["arquivos"]:
                f.append(Paragraph(f"&nbsp;&nbsp;{esc(caminho)}", ST["path"]))
            f.append(Spacer(1, 2.4 * mm))
            f.append(P("<b>Trecho do codigo</b>", "h3"))
            f.append(caixa_codigo(a["codigo"], LARG_UTIL))
            f.append(Spacer(1, 2.4 * mm))

            for rot, chave in (("Por que e explorável", "porque"),
                               ("Impacto", "impacto"),
                               ("Condicao de explorabilidade", "condicao"),
                               ("Correcao sugerida", "correcao")):
                f.append(P(f"<b>{rot}</b>", "h3"))
                f.append(P(esc(a[chave]), "small_j"))

            f.append(P("<b>Criterios de aceite</b>", "h3"))
            for c in a["aceite"]:
                f.append(P(f"&nbsp;&nbsp;[ ]&nbsp;&nbsp;{esc(c)}", "small"))
            f.append(HRFlowable(width="100%", thickness=0.5, color=RULE,
                                spaceBefore=5, spaceAfter=1))
    return f


def secao_recomendacoes():
    f = [P("Recomendacoes priorizadas", "h1")]
    f.append(P(
        "Prioridade definida por impacto x facilidade de exploracao x esforco de correcao. P1 concentra o que "
        "e explorável sem autenticacao previa ou o que expoe credencial de producao."))
    cores_p = {"P1": "#B91C1C", "P2": "#EA580C", "P3": "#D97706", "P4": "#2563EB"}
    for grupo in D.RECOMENDACOES:
        pr = grupo["prioridade"]
        cor = cores_p.get(pr, "#2563EB")
        cab = Table(
            [[Chip(pr, cor, largura=30, altura=13, fonte=7.6),
              P(f"<b>{esc(grupo['prazo'])}</b>", "cell"),
              P(f"{len(grupo['itens'])} acao(oes)", "cell")]],
            colWidths=[36, LARG_UTIL - 36 - 2.6 * cm, 2.6 * cm],
            style=TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
                ("BOX", (0, 0), (-1, -1), 0.5, RULE),
                ("LINEBEFORE", (0, 0), (0, -1), 2.4, colors.HexColor(cor)),
                ("ALIGN", (2, 0), (2, 0), "RIGHT"),
                ("TEXTCOLOR", (2, 0), (2, 0), INK_FAINT),
                ("LEFTPADDING", (0, 0), (0, -1), 3),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]),
        )
        f.append(Spacer(1, 4 * mm))
        f.append(cab)
        linhas = []
        for j, (acao, motivo) in enumerate(grupo["itens"], 1):
            linhas.append([
                P(f"<b>{pr}.{j}</b>", "cell"),
                P(f"<b>{esc(acao)}</b><br/><font color='#475569'>{esc(motivo)}</font>", "cell_j"),
            ])
        t = Table(linhas, colWidths=[1.5 * cm, LARG_UTIL - 1.5 * cm])
        t.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
            ("BOX", (0, 0), (-1, -1), 0.5, RULE),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]))
        f.append(t)
    return f


# ---------------------------------------------------------------------------
# Issues para o GitHub
# ---------------------------------------------------------------------------

def markdown_issue(numero: int, achado: dict) -> str:
    sev = SEV[achado["severidade"]]
    label_sev = {
        "critica": "severity:critical", "alta": "severity:high",
        "media": "severity:medium", "baixa": "severity:low", "info": "severity:info",
    }[achado["severidade"]]
    ev = "\n".join(f"- `{c}`" for c in achado["arquivos"])
    aceite = "\n".join(f"- [ ] {c}" for c in achado["aceite"])
    return f"""## Titulo

[Seguranca] {achado['titulo']}

## Labels

`security`, `{label_sev}`

## Severidade

{sev['label']} (achado {achado['id']} da auditoria de {D.DATA_AUDITORIA})

## Problema

{achado['porque']}

## Evidencia

{ev}

```ts
{achado['codigo']}
```

## Impacto

{achado['impacto']}

## Condicao de explorabilidade

{achado['condicao']}

## Correcao sugerida

{achado['correcao']}

## Criterios de aceite

{aceite}
"""


def markdown_issue_agrupada(numero: int, titulo: str, label_sev: str, sev_label: str,
                            ids: list[str], problema: str, evidencias: list[str],
                            codigo: str, impacto: str, condicao: str, correcao: str,
                            aceite: list[str]) -> str:
    ev = "\n".join(f"- `{c}`" for c in evidencias)
    ac = "\n".join(f"- [ ] {c}" for c in aceite)
    return f"""## Titulo

[Seguranca] {titulo}

## Labels

`security`, `{label_sev}`

## Severidade

{sev_label} (agrupa os achados {', '.join(ids)} da auditoria de {D.DATA_AUDITORIA})

## Problema

{problema}

## Evidencia

{ev}

```ts
{codigo}
```

## Impacto

{impacto}

## Condicao de explorabilidade

{condicao}

## Correcao sugerida

{correcao}

## Criterios de aceite

{ac}
"""


def montar_issues() -> list[tuple[str, str]]:
    """Retorna [(titulo curto, markdown completo)] na ordem de publicacao."""
    por_id = {a["id"]: a for a in D.ACHADOS}
    issues: list[tuple[str, str]] = []

    # Issues individuais para tudo de critica/alta/media, exceto os agrupados abaixo.
    agrupados = {"F13", "F14", "F15", "F16", "F18", "F11", "F12"}
    individuais = [a for a in D.ACHADOS
                   if a["id"] not in agrupados and a["severidade"] != "info"]
    individuais.sort(key=lambda a: (SEV[a["severidade"]]["ordem"], a["id"]))

    n = 0
    for a in individuais:
        n += 1
        issues.append((f"[Seguranca] {a['titulo']}", markdown_issue(n, a)))

    # Agrupamento 1: reflexao/redirecionamento na borda HTTP (F11 + F12)
    n += 1
    f11, f12 = por_id["F11"], por_id["F12"]
    issues.append((
        "[Seguranca] Reflexao e redirecionamento sem validacao na borda HTTP (challenge de webhook e returnPath do OAuth)",
        markdown_issue_agrupada(
            n,
            "Reflexao e redirecionamento sem validacao na borda HTTP (challenge de webhook e returnPath do OAuth)",
            "severity:low", "BAIXA", ["F11", "F12"],
            "Dois pontos da borda HTTP devolvem valor controlado pelo requisitante sem validacao adequada.\n\n"
            "**1) XSS refletido no challenge de verificacao (F11).** "
            + f11["porque"] +
            "\n\n**2) Open redirect por URL protocolo-relativa (F12).** " + f12["porque"],
            f11["arquivos"] + f12["arquivos"],
            f11["codigo"] + "\n\n// ---------------------------------------------------------\n\n" + f12["codigo"],
            "**F11:** " + f11["impacto"] + "\n\n**F12:** " + f12["impacto"],
            "**F11:** " + f11["condicao"] + "\n\n**F12:** " + f12["condicao"],
            "**F11:** " + f11["correcao"] + "\n\n**F12:** " + f12["correcao"],
            f11["aceite"] + f12["aceite"],
        ),
    ))

    # Agrupamento 2: endurecimento da borda do backend (F13 + F14 + F15)
    n += 1
    f13, f14, f15 = por_id["F13"], por_id["F14"], por_id["F15"]
    issues.append((
        "[Seguranca] Endurecimento da borda do backend: vazamento de erro do banco, limite de corpo de 150 MB e comparacao de segredo sem tempo constante",
        markdown_issue_agrupada(
            n,
            "Endurecimento da borda do backend: vazamento de erro do banco, limite de corpo de 150 MB e comparacao de segredo sem tempo constante",
            "severity:low", "BAIXA", ["F13", "F14", "F15"],
            "Tres ajustes de defesa em profundidade no mesmo arquivo de entrada do backend.\n\n"
            "**1) Erro cru do banco na resposta (F13).** " + f13["porque"] +
            "\n\n**2) Limite de corpo JSON em 150 MB (F14).** " + f14["porque"] +
            "\n\n**3) Comparacao de segredo fora de tempo constante (F15).** " + f15["porque"],
            f13["arquivos"] + f14["arquivos"] + f15["arquivos"],
            f13["codigo"] + "\n\n// ---------------------------------------------------------\n\n"
            + f14["codigo"] + "\n\n// ---------------------------------------------------------\n\n"
            + f15["codigo"],
            "**F13:** " + f13["impacto"] + "\n\n**F14:** " + f14["impacto"]
            + "\n\n**F15:** " + f15["impacto"],
            "**F13:** " + f13["condicao"] + "\n\n**F14:** " + f14["condicao"]
            + "\n\n**F15:** " + f15["condicao"],
            "**F13:** " + f13["correcao"] + "\n\n**F14:** " + f14["correcao"]
            + "\n\n**F15:** " + f15["correcao"],
            f13["aceite"] + f14["aceite"] + f15["aceite"],
        ),
    ))

    # Agrupamento 3: endurecimento de XSS no frontend (F16 + F18)
    n += 1
    f16, f18 = por_id["F16"], por_id["F18"]
    issues.append((
        "[Seguranca] Endurecimento de XSS no frontend: CSP, sanitizacao obrigatoria e sinks latentes de <style>",
        markdown_issue_agrupada(
            n,
            "Endurecimento de XSS no frontend: CSP, sanitizacao obrigatoria e sinks latentes de <style>",
            "severity:low", "BAIXA", ["F16", "F18"],
            "Nenhum XSS explorável foi encontrado no frontend, mas duas condicoes ampliam o impacto de um XSS futuro.\n\n"
            "**1) Sessao em localStorage (F16).** " + f16["porque"] +
            "\n\n**2) Sink latente de CSS em componente sem uso (F18).** " + f18["porque"],
            f16["arquivos"] + f18["arquivos"],
            f16["codigo"] + "\n\n// ---------------------------------------------------------\n\n" + f18["codigo"],
            "**F16:** " + f16["impacto"] + "\n\n**F18:** " + f18["impacto"],
            "**F16:** " + f16["condicao"] + "\n\n**F18:** " + f18["condicao"],
            "**F16:** " + f16["correcao"] + "\n\n**F18:** " + f18["correcao"],
            f16["aceite"] + f18["aceite"],
        ),
    ))
    return issues


def secao_issues():
    f = [P("Issues para o GitHub", "h1")]
    f.append(P(
        "Texto completo de cada issue em Markdown, pronto para copiar e colar. Cada issue esta delimitada entre "
        "<font face='Courier'>--- ISSUE n ---</font> e <font face='Courier'>--- FIM ISSUE n ---</font>. "
        "Achados triviais do mesmo tema foram agrupados numa issue unica para nao gerar ruido no backlog: "
        "F11+F12 (reflexao/redirecionamento na borda HTTP), F13+F14+F15 (endurecimento da borda do backend) e "
        "F16+F18 (endurecimento de XSS no frontend)."))
    issues = montar_issues()
    f.append(P(f"<b>Total: {len(issues)} issues</b> cobrindo os {len(D.ACHADOS)} achados.", "small"))

    for i, (titulo, corpo) in enumerate(issues, 1):
        f.append(CondPageBreak(60 * mm))
        f.append(Spacer(1, 4 * mm))
        f.append(P(f"ISSUE {i} — {esc(titulo)}", "h2"))
        bloco = f"--- ISSUE {i} ---\n\n{corpo}\n--- FIM ISSUE {i} ---"
        f.append(caixa_codigo(bloco, LARG_UTIL, bg=ISSUE_BG, borda="#D6D3D1",
                              fonte=6.9, leading=9.1))
    return f


def secao_anexo_cobertura():
    f = [P("Anexo — cobertura da revisao", "h1")]
    f.append(P(
        "Registro do que foi efetivamente percorrido, para tornar a cobertura auditavel."))
    linhas = [
        ["Superficie", "Volume revisado", "Metodo"],
        ["Rotas Express (Project/IA/api-server.ts)",
         "167 registros de rota, 100%",
         "Leitura sequencial do arquivo inteiro (4.330 linhas), nao amostragem"],
        ["Metodos de servico com AuthContext (sdr-agent-gemini.ts)",
         "53 metodos, 100%",
         "Extracao programatica + classificacao por guarda de posse"],
        ["Rotas sem authMiddleware",
         "13 endpoints",
         "Enumeracao e verificacao individual do controle compensatorio"],
        ["Migrations SQL (supabase/migrations)",
         "173 arquivos",
         "Levantamento de ENABLE RLS, CREATE POLICY, GRANT/REVOKE, security_invoker e FKs compostas"],
        ["Tabelas/views consultadas direto pelo frontend",
         "23 objetos",
         "Cruzamento com a lista de RLS habilitada e com as policies por operacao"],
        ["Edge Functions (Deno)",
         "3 funcoes + config.toml",
         "Leitura integral e checagem de verify_jwt vs. verificacao interna"],
        ["Arquivos de deploy",
         "docker-compose.yml, docker-stack.backend.yml, Dockerfile",
         "Inspecao de defaults ${VAR:-...} e de injecao de segredo"],
        ["Historico do Git",
         "Todos os commits alcancaveis",
         "git grep por JWT/AIzaSy/sk-/PRIVATE KEY + decodificacao dos payloads encontrados"],
        ["Bundle compilado",
         "dist/assets/*.js",
         "Varredura por service_role, JWT e chaves de API"],
        ["Sinks de XSS no frontend",
         "Todo o src/",
         "Busca por dangerouslySetInnerHTML, innerHTML, eval, new Function, href/src dinamicos"],
    ]
    dados = [[P(f"<b>{esc(c)}</b>", "cell_hdr") for c in linhas[0]]]
    estilo = [
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F172A")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 1), (-1, -2), 0.4, RULE),
        ("BOX", (0, 0), (-1, -1), 0.5, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
        ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ]
    for i, row in enumerate(linhas[1:], start=1):
        dados.append([P(esc(row[0]), "cell"), P(esc(row[1]), "cell"), P(esc(row[2]), "cell_j")])
        if i % 2 == 0:
            estilo.append(("BACKGROUND", (0, i), (-1, i), SURFACE))
    t = Table(dados, colWidths=[5.4 * cm, 3.3 * cm, LARG_UTIL - 8.7 * cm], repeatRows=1)
    t.setStyle(TableStyle(estilo))
    f.append(t)
    f.append(Spacer(1, 5 * mm))
    f.append(P(
        "<b>Categorias nao aplicaveis:</b> nenhuma das cinco categorias solicitadas ficou fora de escopo. "
        "O projeto tem frontend (React), backend proprio (Express), banco com RLS (Supabase/Postgres), arquivos "
        "de deploy (Docker/Swarm/Vercel) e funcoes serverless, portanto as cinco foram avaliadas. "
        "Nao existe ORM classico (Prisma/TypeORM/Sequelize) nem SQL concatenado no codigo da aplicacao: todo o "
        "acesso passa por PostgREST via supabase-js ou por RPCs parametrizadas, de modo que <b>SQL injection "
        "classica nao se aplica</b> a esta stack — verificado por ausencia de construcao dinamica de query "
        "no codigo TypeScript.", "small_j"))
    return f


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    story = []
    story += secao_capa()
    story.append(NextPageTemplate("Corpo"))
    story.append(PageBreak())
    story += secao_metodologia()
    story.append(PageBreak())
    story += secao_resumo()
    story.append(PageBreak())
    story += secao_pontos()
    story.append(PageBreak())
    story += secao_indice_achados()
    story.append(PageBreak())
    story += secao_achados_detalhados()
    story.append(PageBreak())
    story += secao_recomendacoes()
    story.append(PageBreak())
    story += secao_anexo_cobertura()
    story.append(PageBreak())
    story += secao_issues()

    doc = Doc(OUT_PDF)
    doc.build(story)
    tam = OUT_PDF.stat().st_size / 1024
    print(f"OK  {OUT_PDF}  ({tam:.0f} KB)")
    print(f"    achados: {len(D.ACHADOS)}  |  pontos fortes: {len(D.PONTOS_FORTES)}"
          f"  |  issues: {len(montar_issues())}")


if __name__ == "__main__":
    main()
