# Mantac Pedidos

PWA para consulta de preços da **Tabela 44 (Atacado Especial)**, catálogo técnico e montagem de orçamentos para clientes do Paraná. Roda 100% no navegador (sem servidor), é instalável e funciona offline depois do primeiro acesso.

## Funções

- **Consulta**: busca por código, descrição, bitola ou linha, com filtro por classe. Cada produto mostra as 4 faixas de preço (Tabela, −10%, 2×10, 3×10), o preço com impostos, a comissão, os dados comerciais (NCM, IPI, embalagem, peso, vigência) e a ficha técnica do Catálogo 2025 (medidas, pressões, aplicação, cores e foto).
- **Orçamento**: desconto escolhido por item e quantidade sempre em múltiplos da embalagem. Mostra os totais de mercadorias, IPI e ICMS-ST, além da comissão (visível só no app).
- **Compartilhar**: exporta como **Texto** (WhatsApp), **Imagem** (PNG) ou **PDF**, com a logo, o cliente, o vendedor e a data. A comissão e a faixa de desconto não aparecem no material do cliente.
- **Painel** (sem senha):
  - importa a Lista de Preços em **PDF (Prosyst)** e/ou a **planilha XLS/XLSX** de descontos, com uma prévia antes de aplicar;
  - configura o ICMS-ST por NCM (MVA, alíquota interna PR e alíquota interestadual) e os códigos de exceção;
  - define o vendedor padrão.

## Cálculo

```
unitário   = preço Tabela 44 (já com ICMS) × fator da faixa (1 · 0,9 · 0,81 · 0,729)
             ou o preço digitado na planilha, quando existir (42 conexões PE/PP no 3×10)
mercadoria = unitário × quantidade
IPI        = mercadoria × % IPI do item
ICMS-ST    = (mercadoria + IPI) × (1 + MVA) × ICMS interno PR − mercadoria × ICMS interestadual
             (só para NCMs com MVA preenchida no Painel; desligado por padrão)
comissão   = mercadoria × % da faixa (8% · 8% · 8% · 5%)
```

## Atualizar os dados publicados

Os arquivos originais ficam em `tools/fontes/`, que **não é versionado**, porque o PDF traz o custo de compra.

```bash
npm install
npm run dados       # tools/fontes/tabela44.pdf + tabela44.xls  -> data/tabela44.json
npm run catalogo    # tools/fontes/catalogo2025.pdf             -> data/catalogo.json + img/cat/  (pip install pymupdf)
npm run sw          # regenera sw.js (lista offline + versão) — rode sempre antes de publicar
```

No aparelho, uma importação feita pelo Painel substitui a tabela publicada só naquele aparelho, até que o usuário escolha "Voltar à versão publicada".

## Publicação (GitHub Pages)

Em *Settings → Pages*, escolha *Deploy from a branch* → `main` / `(root)`. Não há etapa de build: o repositório é o site.
