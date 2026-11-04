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
