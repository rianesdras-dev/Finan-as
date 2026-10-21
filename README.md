# Financeiro

App de finanças pessoais em um arquivo só (`index.html`), feito a partir da planilha
“Organização Financeira”. Funciona no celular, sem internet, e pode ser instalado na
tela de início.

## O que tem

- **Painel (entrada):** a reserva hoje e no fim de cada um dos próximos 3 meses (com o
  piso marcado), quanto fica **livre para aproveitar** acima do piso, o cenário de
  **quando cai o primeiro dinheiro de plantão** (toque no mês e tudo recalcula), o que
  muda em cada mês (bolsas que acabam, parcelas que terminam, pagamentos da formatura,
  datas como a prova), quanto dá pra gastar hoje, envelopes, para onde foi o dinheiro,
  contas a pagar, cartão e objetivos.
- **+ (lançar):** valor no teclado, categoria e forma de pagamento. No cartão, dá pra
  escolher **à vista ou 2x…12x**: parcelado vira parcela do cartão (fora dos envelopes).
- **Extrato do banco:** escolha o arquivo exportado pelo banco (OFX, CSV, PDF) ou cole o
  texto. O app separa cada transação: gasto (com categoria), conta do plano paga, fatura
  paga, parcelamento novo, entrada, ou fica de fora (assinaturas e parcelas que já estão
  no plano, transferências entre contas, aplicações/resgates, o que já foi lançado à
  mão, o que já foi importado antes). Dá pra trocar a categoria tocando no item, e o app
  **aprende** para os próximos extratos. O leitor fica em `app/extrato.js` (testes em
  `testes/`, rodar com `node --test testes/`).
- **Mês › Plano e contas:** o plano do mês como na planilha (entradas + plantões −
  contas − cartão − metas − pagamentos únicos = vai para a reserva ou sai dela), a lista
  de contas com “pago” e as entradas. Um valor pode mudar só num mês ou daquele mês em
  diante.
- **Mês › Gastos:** o mês por envelope e por categoria, onde mais gastou, assinaturas
  encontradas, o que entrou de verdade e a lista por dia.
- **Cartões:** a fatura do mês com “paga”, cada parcelamento com k/n, quanto falta e
  quando acaba, quanto ainda falta pagar em parcelas, assinaturas, próximas faturas e o
  cartão da mãe. Com os dias de fechamento e vencimento (Ajustes), cada compra cai na
  fatura certa.
- **Futuro:** reserva no fim de cada mês por 12 meses com a linha do piso, comparação
  com e sem plantões, até quando a reserva dura, o que muda mês a mês, tabela, objetivos
  com o mês de pagar cada item (entram na previsão) e “Posso gastar isso?”.

O cartão da mãe é um envelope à parte, só para mercado: não entra como receita, porque
esse dinheiro não sobra para a reserva.

- **Feito para TDAH:** no topo do painel, o cartão **Agora** mostra só o próximo passo
  (no máximo 3, cada um com um botão); **revisão de 5 minutos** guiada, um passo por
  tela, contando semanas seguidas; lista **Quero comprar** com espera de 48 h;
  comemoração ao pagar; lembretes no calendário do celular (.ics).
- **Conferir a fatura:** escolha a fatura (CSV, OFX, PDF). O app (`conferencia.js`)
  casa cada cobrança com as assinaturas e parcelas do plano e com o que você lançou, e
  só pergunta o que precisa, um cartão por vez: duplicadas, cobranças que você não
  reconhece (vão para “pra contestar”), assinatura que subiu de preço, assinatura ou
  parcelamento novo, o que estava no plano e não veio, e se o total impresso bate.
- **Comprovantes:** ao marcar uma conta como paga, “📎 comprovante” guarda a foto ou o
  PDF (`comprovantes.js`, IndexedDB, só no celular). O app lê valor e data do PDF e
  sugere de qual conta é. No Android dá pra “Compartilhar › Financeiro” direto do app
  do banco. Backup de todos em .zip.
- **Privado:** cadeado com PIN, modo discreto (o 👁 esconde os valores), fora do Google.

## Dados

Ficam só no aparelho (localStorage). **Nenhum dado pessoal está no código**: o site é
público, então os dados entram por importação.

- **Importar:** na primeira tela, “Importar meus dados” (arquivo `.json`), ou abrir o
  link `…/#importar=…`. A parte depois do `#` não é enviada ao servidor, e o app limpa
  o endereço depois de importar.
- **Backup:** Ajustes › Exportar backup (.json). Também exporta os gastos em `.csv`
  para abrir na planilha.
- Se a versão anterior do app estiver no mesmo endereço, os lançamentos reais dela
  (não os de exemplo) são aproveitados.

## Publicar no Netlify

O app é estático; não tem build.

- **Pelo GitHub (atualiza sozinho a cada push):** no Netlify, *Site configuration ›
  Build & deploy › Link repository*, escolha este repositório e o branch `main`. O
  `netlify.toml` já diz para publicar a pasta `app/` (sem build).
- **Arrastando:** em *Deploys*, arraste a pasta `app` inteira.

## Pastas

- `app/` — o site (é só isso que vai para o Netlify).
- `testes/` — testes do leitor de extratos, com extratos sintéticos de vários bancos.

Este repositório é público: nunca coloque aqui o backup `.json` do app nem extratos
reais (o `.gitignore` já ignora arquivos `.json`).

O arquivo `app/_headers` faz o `index.html` e o `sw.js` nunca ficarem presos em cache.
