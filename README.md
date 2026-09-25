# Mantac Pedidos

PWA para consulta de preços da **Tabela 44 (Atacado Especial)**, catálogo técnico e montagem de orçamentos para clientes do Paraná. Roda 100% no navegador (sem servidor), é instalável e funciona offline depois do primeiro acesso.

## Funções

O uso segue o modelo do app de vendas da Cortag (appdb), sem levantamento de estoque:

- **Pedido**
  - Cartão do cliente: selecionar, trocar ou cadastrar um cliente.
  - **Faixa de desconto padrão** (Tabela, −10%, 2×10, 3×10), com a comissão de cada faixa.
  - Busca por código ou nome a partir de 2 caracteres. Cada resultado aparece num cartão com quantidade (em múltiplos da embalagem), preço na faixa, preço com impostos e botão **+**.
  - O ⓘ abre a ficha técnica do Catálogo 2025: medidas, pressões, aplicação, cores e foto.
- **Barra do orçamento**: fica fixa embaixo e abre a gaveta do orçamento.
  - Na gaveta dá para mudar a faixa e a quantidade de cada item.
  - Os totais separam mercadorias, IPI e ICMS-ST. A comissão aparece só no app.
  - Compartilha como **Texto** (WhatsApp), **Imagem** ou **PDF**, com o nº do orçamento. Ao compartilhar, o orçamento é salvo no histórico.
- **Clientes**
  - Cadastro com nome, CNPJ/CPF, fantasia, cidade, telefone, e-mail e observações.
  - O botão "Buscar" preenche os dados pelo CNPJ (BrasilAPI, precisa de internet).
  - "Orçar" já seleciona o cliente no pedido.
- **Histórico**: orçamentos salvos com nº, data, cliente e total. Cada um pode ser reaberto e editado, duplicado como novo ou excluído.
- **Painel** (engrenagem, sem senha):
  - importa o PDF do Prosyst ou o XLS/XLSX de descontos, com prévia antes de aplicar;
  - configura o ICMS-ST por NCM;
  - define o vendedor;
  - faz **backup** (exportar e importar JSON) de clientes, histórico e configurações.

Tudo fica salvo **só no aparelho** (IndexedDB), sem servidor. Para passar os dados para outro aparelho, use o backup.

## Cálculo

```
unitário   = preço Tabela 44 (já com ICMS) × fator da faixa (1 · 0,9 · 0,81 · 0,729)
             ou o preço digitado na planilha, quando existir (42 conexões PE/PP no 3×10)
mercadoria = unitário × quantidade
IPI        = mercadoria × % IPI do item
ICMS-ST    = (mercadoria + IPI*) × (1 + MVA do item) × ICMS interno PR − mercadoria × ICMS interestadual (12%)
comissão   = mercadoria × % da faixa (8% · 8% · 8% · 5%)
```

**Ofertas** (`data/ofertas.json`, editável no Painel):
- Enquanto a campanha estiver valendo, o preço da oferta substitui o de tabela. O "Setembro de Ofertas" vai até 30/09/26 e tem 179 produtos.
- As faixas −10%, 2×10 e 3×10 incidem sobre o preço da oferta, e a comissão é a da oferta (8%).
- A oferta só vale quando for menor que o preço de tabela.
- Terminada a validade, os preços de tabela voltam sozinhos.
- No Pedido, o botão amarelo lista só os produtos em oferta.

**À vista:** a opção no orçamento aplica −2% em todos os itens e muda a condição para "à vista" no texto, na imagem e no PDF.

**ICMS-ST por produto.** A regra vem da tabela "PR ST 2025 — Mantac Industrialização" (`data/st-pr.json`): cada código tem ST ou não, com MVA (39%, 50%, 58% ou 71,78%), ICMS interno (19,5%) e CEST. O NCM sozinho não decide. Dentro do 39.17.3229, por exemplo, há itens com MVA 39%, com MVA 71,78% e sem ST.

- \* **IPI na base**: ligado por padrão, que é a regra legal. Desligado, o cálculo fica igual à coluna "%ST" da tabela da Mantac, que não considera IPI. A opção fica no Painel.
- **Produtos fora da tabela de ST**: 66 produtos da Tabela 44 não aparecem na tabela de ST e ficam sem ST. Se algum deles tiver ST, dá para informar a MVA por NCM no Painel; essa regra vale só para esses produtos.
- **Atualização**: a tabela de ST pode ser trocada pelo Painel, enviando o PDF novo. O app reconhece sozinho se o PDF é a lista de preços ou a tabela de ST.

## Atualizar os dados publicados

Os arquivos originais ficam em `tools/fontes/`, que **não é versionado**, porque o PDF traz o custo de compra.

```bash
npm install
npm run dados       # tools/fontes/tabela44.pdf + tabela44.xls (+ st-pr.pdf) -> data/tabela44.json (+ data/st-pr.json)
npm run catalogo    # tools/fontes/catalogo2025.pdf             -> data/catalogo.json + img/cat/  (pip install pymupdf)
npm run sw          # regenera sw.js (lista offline + versão) — rode sempre antes de publicar
```

No aparelho, uma importação feita pelo Painel substitui a tabela publicada só naquele aparelho, até que o usuário escolha "Voltar à versão publicada".

## Publicação (GitHub Pages)

Em *Settings → Pages*, escolha *Deploy from a branch* → `main` / `(root)`. Não há etapa de build: o repositório é o site.
