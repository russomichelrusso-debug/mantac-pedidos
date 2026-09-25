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
