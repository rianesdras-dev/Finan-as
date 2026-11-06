// Formatos vistos em arquivos reais (com dados inventados): extrato com descrição em duas linhas
// dentro das aspas, fatura com o vencimento no nome do arquivo e crédito de loja na fatura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregar } from './carregar.mjs';
const E = carregar();

test('extrato com "Pix enviado⏎Nome" em duas linhas e compra no débito com a loja no fim', () => {
  const txt = 'Extrato de conta corrente\nNome;Fulano\nAgência;0001\nConta;01.000000.1\nPeríodo do extrato;20/10/2026 a 03/11/2026\n\nLançamentos:\n' +
    'Data;Descrição;Valor;Saldo\n03/11/2026;"Pix enviado\nMaria teste silva";-109,65;140,26\n03/11/2026;Aplicacao cdb/rdb;-1000,00;249,91\n' +
    '30/10/2026;"Pagamento de boleto outros bancos\nImobiliaria exemplo ltda";-2856,82;-2891,08\n' +
    '26/10/2026;"Debito visa electron brasil\n26/10 restaurante exemplo";-138,63;241,66\n27/10/2026;"Debito aut. conta gas\nComgas";-12,40;129,26\n';
  const r = E.ler(txt, 'extrato_20-10-2026_a_03-11-2026.csv', { ano: 2026 });
  assert.equal(r.conta, 'corrente');
  assert.equal(r.transacoes.length, 5);
  const d = Object.fromEntries(r.transacoes.map(t => [t.valor, t.desc]));
  assert.equal(d[-109.65], 'Pix enviado Maria teste silva');
  assert.equal(d[-138.63], 'restaurante exemplo');
  assert.equal(d[-12.4], 'gas Comgas');
  assert.equal(E.classificar(r.transacoes.find(t => t.valor === -1000), {}).tipo, 'investimento');
});

test('fatura: vencimento no nome "Fatura2026-11-10.csv", crédito de loja vira estorno, aluguel de carro é transporte', () => {
  const txt = 'Data;Estabelecimento;Portador;Valor;Parcela\n07/10/2026;Pagamento de fatura;FULANO;R$ -1.543,78; de 1\n' +
    '16/09/2026;WELLHUB FULANO;FULANO;R$ -6,66;-\n30/10/2026;TURBI;FULANO;R$ 336,41;-\n31/10/2026;AMAZON BR;FULANO;R$ 41,24;1 de 4\n';
  const r = E.ler(txt, 'Fatura2026-11-10.csv', { ano: 2026 });
  assert.equal(r.conta, 'cartao');
  assert.equal(r.referencia.vencimento, '2026-11-10');
  const por = v => r.transacoes.find(t => t.valor === v);
  assert.equal(E.classificar(por(1543.78), {}).tipo, 'fatura');
  assert.equal(E.classificar(por(6.66), {}).tipo, 'estorno');
  assert.equal(E.classificar(por(-336.41), {}).cat, 'transp');
  assert.deepEqual({ ...por(-41.24).parcela }, { k: 1, n: 4 });
});

test('extrato em PDF (texto): tipo em cima, data e valor no meio, nome embaixo; IOF com "Periodo"; cabeçalhos de dia e de página', () => {
  const txt = [
    'EXTRATO DE CONTA', 'Agência: 0001 | Conta: 01.000000.1', 'Período: 08/10/2026 a 06/11/2026', 'Nome: Fulano',
    'Saldo inicial Entradas Saídas Saldo final', 'R$ 100,00 R$ 650,00 R$ 820,13 -R$ 70,13',
    'DETALHE DOS MOVIMENTOS', 'Data Descrição Valor Saldo',
    'Quinta, 5 de novembro',
    '             Pagamento de boleto outros bancos', '05/11/2026      -R$ 190,55        -R$ 70,13', '             Distribuidora De Energia',
    '             Pix enviado', '05/11/2026      -R$ 600,00        R$ 120,42', '             Maria Teste Silva',
    'Terça, 3 de novembro',
    '             Iof adicional - automatico', '03/11/2026      -R$ 3,40          R$ 720,42', '             Periodo: 01/10 a 31/10/26',
    '             Iof imposto operacoes financeiras', '03/11/2026      -R$ 0,13          R$ 723,82', '             Periodo: 01/10 a 31/10/26',
    '03/11/2026   Aplicacao cdb/rdb   -R$ 26,05    R$ 723,95', '                                   1/5',
    'DETALHE DOS MOVIMENTOS', 'Data Descrição Valor Saldo', 'Terça, 3 de novembro',
    '             Pix recebido', '03/11/2026      R$ 650,00         R$ 750,00', '             Joana Teste Pereira',
  ].join('\n');
  const r = E.lerTexto(txt, { ano: 2026 });
  assert.equal(r.conta, 'corrente');
  const ds = r.transacoes.map(t => [t.valor, t.desc]);
  assert.equal(ds.length, 6);
  assert.equal(r.transacoes.reduce((s, t) => s + t.valor, 0).toFixed(2), '-170.13');   // 100 → −70,13
  const por = v => r.transacoes.find(t => t.valor === v).desc;
  assert.equal(por(-0.13), 'Iof imposto operacoes financeiras');
  assert.equal(por(-3.4), 'Iof adicional - automatico');
  assert.equal(por(650), 'Pix recebido Joana Teste Pereira');
  assert.equal(por(-190.55), 'Pagamento de boleto outros bancos Distribuidora De Energia');
});
