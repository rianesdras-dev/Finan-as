// Testes do leitor de extratos (app/extrato.js).
// Rodar: node --test testes/
// Todos os dados das fixtures são inventados (nomes, valores, contas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { carregar } from './carregar.mjs';

const X = carregar();
const dir = new URL('./fixtures/', import.meta.url);
const bytesDe = nome => readFileSync(new URL(nome, dir));
const textoDe = nome => X.decodificar(bytesDe(nome));
// objetos criados dentro do vm têm outro protótipo: compara pela forma JSON
const plano = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const igual = (a, b, msg) => assert.deepEqual(plano(a), plano(b), msg);
const resumo = r => r.transacoes.map(t => {
  const c = X.classificar(t, {});
  return `${t.data} ${t.valor.toFixed(2)} ${c.tipo}${c.cat ? '/' + c.cat : ''}`;
});

/* ───────────── um caso por banco/formato (exemplos da pesquisa) ───────────── */

const CASOS = [
  // [arquivo, leitor, formato, banco, conta, linhas esperadas]
  ['nubank-conta.csv', 'ler', 'csv', 'Nubank', 'corrente', [
    '2026-10-01 -42.50 gasto/diaria', '2026-10-02 5000.00 entrada', '2026-10-03 -150.00 gasto/outros',
    '2026-10-05 -1000.00 investimento', '2026-10-10 -2310.45 fatura', '2026-10-12 300.00 transferencia', '2026-10-12 -300.00 transferencia']],
  ['nubank-conta.ofx', 'ler', 'ofx', 'Nubank', 'corrente', [
    '2026-10-03 -150.00 gasto/outros', '2026-10-04 19.90 estorno/compras', '2026-10-10 -2310.45 fatura']],
  ['nubank-cartao.csv', 'ler', 'csv', 'Nubank', 'cartao', [
    '2026-10-19 -42.50 gasto/comida', '2026-10-21 -66.67 gasto/compras', '2026-10-21 -66.67 gasto/compras',
    '2026-10-22 -4.12 gasto/outros', '2026-10-25 1250.00 fatura', '2026-10-26 19.90 estorno/compras']],
  ['Nubank_2026-11-14.csv', 'ler', 'csv', 'Nubank', 'cartao', [
    '2026-10-19 -23.90 gasto/transp', '2026-10-20 -55.90 gasto/role', '2026-10-23 -1215.00 gasto/compras', '2026-10-25 1250.00 fatura']],
  ['nubank-cartao.ofx', 'ler', 'ofx', 'Nubank', 'cartao', [
    '2026-10-19 -42.50 gasto/comida', '2026-10-20 5.00 estorno/compras', '2026-10-25 1250.00 fatura']],
  ['nubank-fatura-pdf.txt', 'texto', 'texto', null, 'cartao', [
    '2026-10-19 -42.50 gasto/comida', '2026-10-21 -66.67 gasto/compras', '2026-10-23 -4.12 gasto/outros',
    '2026-10-23 -108.80 gasto/outros', '2026-10-25 1250.00 fatura']],
  ['nubank-conta-pdf.txt', 'texto', 'texto', null, 'corrente', [
    '2026-10-01 5000.00 entrada', '2026-10-01 -42.50 gasto/diaria', '2026-10-03 -1000.00 investimento']],
  ['inter-conta.csv', 'ler', 'csv', 'Banco Inter', 'corrente', [
    '2026-10-02 5000.00 entrada', '2026-10-03 -18.90 gasto/diaria', '2026-10-05 -300.00 investimento', '2026-10-10 -1681.10 fatura']],
  ['inter-conta.ofx', 'ler', 'ofx', 'Banco Inter', 'corrente', ['2026-10-03 -150.00 gasto/outros', '2026-10-10 -1681.10 fatura']],
  ['inter-cartao.csv', 'ler', 'csv', 'Banco Inter', 'cartao', [
    '2026-10-05 1681.10 fatura', '2026-10-12 -66.67 gasto/compras', '2026-10-15 -3.85 gasto/outros', '2026-10-19 -42.50 gasto/comida']],
  ['inter-conta-pdf.txt', 'texto', 'texto', 'Banco Inter', 'corrente', [
    '2026-10-02 5000.00 entrada', '2026-10-03 -18.90 gasto/diaria', '2026-10-05 -300.00 investimento', '2026-10-05 -80.90 gasto/outros']],
  ['inter-fatura-pdf.txt', 'texto', 'texto', 'Banco Inter', 'cartao', [
    '2026-10-05 -12.30 gasto/diaria', '2026-10-07 1681.10 fatura', '2026-10-09 -89.90 gasto/compras']],
  ['itau-conta.ofx', 'ler', 'ofx', 'Itaú', 'corrente', ['2026-10-03 -150.00 gasto/outros', '2026-10-03 0.42 investimento', '2026-10-05 -12.90 gasto/outros']],
  ['itau-conta.csv', 'ler', 'csv', 'Itaú', 'corrente', [
    '2026-10-01 -42.50 gasto/comida', '2026-10-02 5000.00 entrada', '2026-10-02 -4.50 gasto/outros', '2026-10-03 1000.00 transferencia',
    '2026-10-05 -89.90 gasto/outros', '2026-10-10 -1681.10 fatura']],
  ['itau-conta-pdf.txt', 'texto', 'texto', 'Itaú', 'corrente', [
    '2026-10-02 5000.00 entrada', '2026-10-03 0.42 investimento', '2026-10-05 -18.90 gasto/diaria', '2026-10-10 -1681.10 fatura']],
  ['itau-fatura-pdf.txt', 'texto', 'texto', null, 'cartao', [
    '2026-10-04 -108.80 gasto/outros', '2026-10-04 -3.81 gasto/outros', '2026-10-10 1681.10 fatura', '2026-10-16 -35.00 gasto/outros',
    '2026-10-19 -42.50 gasto/comida', '2026-10-21 -23.90 gasto/transp', '2026-10-28 -112.67 gasto/compras']],
  ['itau-cartao.csv', 'ler', 'csv', 'Itaú', 'cartao', ['2026-10-10 1681.10 fatura', '2026-10-19 -42.50 gasto/comida', '2026-10-21 -66.67 gasto/compras']],
  ['bradesco-conta.csv', 'ler', 'csv', 'Bradesco', 'corrente', [
    '2026-10-02 5000.00 entrada', '2026-10-03 -18.90 gasto/outros', '2026-10-10 -1681.10 gasto/outros', '2026-10-19 0.42 investimento']],
  ['bradesco-conta-antigo.csv', 'ler', 'csv', 'Bradesco', 'corrente', ['2026-10-03 -18.90 gasto/diaria', '2026-10-04 0.01 investimento']],
  ['bradesco-conta.ofx', 'ler', 'ofx', 'Bradesco', 'corrente', ['2026-10-05 -120.00 gasto/mercado', '2026-10-10 -1681.10 fatura', '2026-10-11 -32.00 gasto/comida']],
  ['bradesco-fatura-pdf.txt', 'texto', 'texto', 'Bradesco', 'cartao', [
    '2026-10-10 1681.10 fatura', '2026-10-19 -42.50 gasto/comida', '2026-10-21 -89.90 gasto/saude', '2026-10-22 166.47 estorno/compras',
    '2026-11-01 -0.01 gasto/outros']],
  ['bb-conta.csv', 'ler', 'csv', 'Banco do Brasil', 'corrente', [
    '2026-10-02 5000.00 entrada', '2026-10-03 -18.90 gasto/diaria', '2026-10-03 -18.90 gasto/diaria', '2026-10-03 -4900.00 investimento',
    '2026-10-10 -1681.10 fatura']],
  ['bb-conta-antigo.csv', 'ler', 'csv', 'Banco do Brasil', 'corrente', ['2026-10-03 -150.00 gasto/outros', '2026-10-04 -1471.52 gasto/outros']],
  ['bb-conta.ofx', 'ler', 'ofx', 'Banco do Brasil', 'corrente', ['2026-10-03 -18.90 gasto/diaria', '2026-10-03 18.90 investimento', '2026-10-04 -50.00 investimento']],
  ['bb-ourocard.txt', 'texto', 'texto', null, 'cartao', ['2026-10-10 1681.10 fatura', '2026-10-19 -42.50 gasto/comida', '2026-10-28 -112.67 gasto/compras']],
  ['bb-conta-pdf.txt', 'texto', 'texto', 'Banco do Brasil', 'corrente', ['2026-10-03 -150.00 gasto/outros', '2026-10-03 150.00 investimento']],
  ['caixa-conta.ofx', 'ler', 'ofx', 'Caixa', 'corrente', [
    '2026-10-01 0.06 investimento', '2026-10-01 0.11 investimento', '2026-10-03 -150.00 gasto/outros', '2026-10-05 -28.50 gasto/outros']],
  ['caixa-conta-pdf.txt', 'texto', 'texto', 'Caixa', 'corrente', ['2026-10-02 5000.00 entrada', '2026-10-03 -150.00 gasto/outros']],
  ['caixa-fatura-pdf.txt', 'texto', 'texto', null, 'cartao', ['2026-10-10 1681.10 fatura', '2026-10-19 -42.50 gasto/comida']],
  ['santander-conta.ofx', 'ler', 'ofx', 'Santander', 'corrente', ['2026-10-03 -150.00 gasto/outros', '2026-10-05 -300.00 investimento', '2026-10-06 1450.00 entrada']],
  ['santander-conta.txt', 'ler', 'csv', 'Santander', 'corrente', ['2026-10-02 5000.00 entrada', '2026-10-03 -150.00 gasto/outros', '2026-10-10 -1681.10 fatura']],
  ['santander-conta-pdf.txt', 'texto', 'texto', null, null, ['2026-10-02 5000.00 entrada', '2026-10-05 -89.90 gasto/outros']],
  ['santander-cartao.csv', 'ler', 'csv', 'Santander', 'cartao', ['2026-10-10 1681.10 fatura', '2026-10-19 -42.50 gasto/comida', '2026-10-21 -66.67 gasto/compras']],
  ['santander-fatura-pdf.txt', 'texto', 'texto', 'Santander', 'cartao', [
    '2026-10-10 1681.10 fatura', '2026-10-19 -42.50 gasto/comida', '2026-10-21 -66.67 gasto/compras', '2026-10-21 -3.81 gasto/outros']],
  ['c6-conta.csv', 'ler', 'csv', 'C6 Bank', 'corrente', ['2026-10-02 5000.00 entrada', '2026-10-03 -150.00 gasto/outros', '2026-10-10 -1681.10 fatura']],
  ['Fatura_2026-11-15.csv', 'ler', 'csv', 'C6 Bank', 'cartao', [
    '2026-10-10 1681.10 fatura', '2026-10-17 -31.20 gasto/saude', '2026-10-19 -42.50 gasto/comida', '2026-10-21 -66.67 gasto/compras']],
  ['c6-conta-pdf.txt', 'texto', 'texto', 'C6 Bank', 'corrente', ['2026-10-02 5000.00 entrada', '2026-10-03 -150.00 gasto/outros']],
  ['c6-fatura-pdf.txt', 'texto', 'texto', 'C6 Bank', 'cartao', [
    '2026-10-19 -42.50 gasto/comida', '2026-10-21 -66.67 gasto/compras', '2026-10-23 -108.80 gasto/outros', '2026-10-23 -3.81 gasto/outros']],
  ['picpay-conta.csv', 'ler', 'csv', 'PicPay', 'corrente', [
    '2026-10-02 5000.00 entrada', '2026-10-03 -18.90 gasto/diaria', '2026-10-05 -300.00 investimento', '2026-10-10 -820.00 fatura']],
  ['picpay-conta-pdf.txt', 'texto', 'texto', 'PicPay', 'corrente', ['2026-10-03 -18.90 gasto/diaria', '2026-10-05 -300.00 investimento']],
  ['picpay-fatura.txt', 'texto', 'texto', 'PicPay', 'cartao', ['2026-10-19 -42.50 gasto/comida', '2026-10-21 -66.67 gasto/compras']],
  ['mercadopago-conta.csv', 'ler', 'csv', 'Mercado Pago', 'corrente', ['2026-10-02 5000.00 entrada', '2026-10-03 -167.80 gasto/compras', '2026-10-04 0.42 investimento']],
  ['mercadopago-conta-pdf.txt', 'texto', 'texto', null, 'corrente', ['2026-10-02 0.06 investimento', '2026-10-03 -48.51 gasto/compras', '2026-10-05 -20.00 gasto/outros']],
  ['mercadopago-fatura-pdf.txt', 'texto', 'texto', 'Mercado Pago', 'cartao', [
    '2026-10-07 812.40 fatura', '2026-10-08 -12.30 gasto/outros', '2026-10-15 -44.94 gasto/compras', '2026-10-19 -42.50 gasto/comida']],
  ['xp-cartao.csv', 'ler', 'csv', 'XP', 'cartao', [
    '2026-09-05 -300.00 gasto/compras', '2026-10-08 1250.00 fatura', '2026-10-12 20.00 estorno/compras', '2026-10-19 -42.50 gasto/comida']],
  ['xp-conta-pdf.txt', 'texto', 'texto', null, null, ['2026-10-02 5000.00 entrada', '2026-10-03 -150.00 gasto/outros']],
  ['btg-conta-pdf.txt', 'texto', 'texto', 'BTG Pactual', 'corrente', ['2026-10-02 5000.00 entrada', '2026-10-05 -300.00 investimento']],
  ['neon-conta-pdf.txt', 'texto', 'texto', null, null, ['2026-10-03 -150.00 gasto/outros', '2026-10-05 -18.90 gasto/diaria']]
];

for (const [arq, leitor, formato, banco, conta, esperado] of CASOS) {
  test(`fixture ${arq}`, () => {
    const txt = textoDe(arq);
    const r = leitor === 'ler' ? X.ler(txt, arq, { ano: 2026 }) : X.lerTexto(txt, { ano: 2026 });
    assert.equal(r.formato, formato);
    assert.equal(r.banco, banco);
    assert.equal(r.conta, conta);
    igual(resumo(r), esperado);
    for (const t of r.transacoes) {
      assert.match(t.data, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(typeof t.valor, 'number');
      assert.ok(t.desc && t.original && t.id);
      if (conta) assert.equal(t.conta, conta);
    }
    // ler() de novo dá exatamente os mesmos ids
    const r2 = leitor === 'ler' ? X.ler(txt, arq, { ano: 2026 }) : X.lerTexto(txt, { ano: 2026 });
    igual(r2.transacoes.map(t => t.id), r.transacoes.map(t => t.id));
    assert.equal(new Set(r.transacoes.map(t => t.id)).size, r.transacoes.length, 'ids únicos no arquivo');
  });
}

/* ───────────── detalhes de formato ───────────── */

test('Nubank conta CSV: descrição com vírgulas, ids pelo Identificador e par Pix no Crédito', () => {
  const r = X.ler(textoDe('nubank-conta.csv'), 'NU_123_01OUT2026_19OUT2026.csv');
  assert.equal(r.transacoes[0].id, 'nu:6a1f2c3d-0001-4abc-9def-000000000001');
  assert.match(r.transacoes[2].desc, /Agência: 1234 Conta: 56789-0$/);
  const par = r.transacoes.filter(t => t.data === '2026-10-12');
  assert.equal(par.length, 2);
  assert.notEqual(par[0].id, par[1].id, 'mesmo Identificador em +X/−X não pode colidir');
  assert.ok(par.every(t => t.id.startsWith('nu:6a1f2c3d-0006')));
});

test('Nubank: o mesmo lançamento no CSV e no OFX ganha o mesmo id', () => {
  const csv = X.ler(textoDe('nubank-conta.csv'), 'a.csv').transacoes.find(t => t.valor === -150);
  const ofx = X.ler(textoDe('nubank-conta.ofx'), 'a.ofx').transacoes.find(t => t.valor === -150);
  assert.equal(csv.id, ofx.id);
});

test('OFX: FITID fraco (repetido, zero, posicional) cai no hash; forte vira id', () => {
  const bb = X.ler(textoDe('bb-conta.ofx'), 'bb.ofx').transacoes;
  assert.equal(bb[0].id, 'ofx:98765-4:40.301');
  assert.notEqual(bb[1].id, bb[2].id);
  const cx = X.ler(textoDe('caixa-conta.ofx'), 'cx.ofx').transacoes;
  assert.equal(new Set(cx.map(t => t.id)).size, 4);
  assert.ok(cx.filter(t => t.valor > 0 && t.valor < 1).every(t => t.id.startsWith('h')));
  const itau = X.ler(textoDe('itau-conta.ofx'), 'i.ofx').transacoes;
  assert.ok(itau.every(t => t.id.startsWith('h')), 'FITID do Itaú é posicional');
});

test('OFX de cartão já vem com compra negativa: não inverte', () => {
  const r = X.ler(textoDe('nubank-cartao.ofx'), 'n.ofx');
  assert.equal(r.conta, 'cartao');
  assert.equal(r.transacoes[0].valor, -42.5);
  assert.equal(r.transacoes[2].valor, 1250);
});

test('OFX Santander: vírgula decimal, TRNTYPE OTHER e DTSERVER de 13 dígitos', () => {
  const r = X.ler(textoDe('santander-conta.ofx'), 's.ofx');
  igual(r.transacoes.map(t => t.valor), [-150, -300, 1450]);
  assert.equal(X.chave(r.transacoes[0].desc), 'beltrana souza silva');
});

test('OFX numa linha só, sem </STMTTRN>, e lixo no meio não quebram', () => {
  const ofx = 'OFXHEADER:100\n<OFX><BANKMSGSRSV1><STMTRS><BANKACCTFROM><BANKID>341<ACCTID>99</BANKACCTFROM><BANKTRANLIST>' +
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261001<TRNAMT>-10.00<FITID>A1<MEMO>PADARIA X &amp; Y' +
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261301<TRNAMT>-5.00<FITID>A2<MEMO>DATA INVALIDA' +
    '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261002<TRNAMT>20.5<FITID>A3<MEMO>PIX RECEBIDO</BANKTRANLIST></STMTRS></BANKMSGSRSV1></OFX>';
  const r = X.ler(ofx, 'x.ofx');
  assert.equal(r.banco, 'Itaú');
  igual(r.transacoes.map(t => [t.data, t.valor]), [['2026-10-01', -10], ['2026-10-02', 20.5]]);
  assert.equal(r.transacoes[0].desc, 'Padaria X & Y');
});

test('CSV de cartão Nubank, formato novo: vírgula decimal entre aspas e espaço depois do sinal', () => {
  const r = X.ler(textoDe('Nubank_2026-11-14.csv'), 'Nubank_2026-11-14.csv');
  igual(r.transacoes.map(t => t.valor), [-23.9, -55.9, -1215, 1250]);
});

test('CSV do Nubank cartão: aspas escapadas no título', () => {
  const t = X.ler(textoDe('nubank-cartao.csv'), 'n.csv').transacoes.find(t => t.valor === -4.12);
  assert.equal(t.desc, 'IOF de "Openai *Chatgpt Subscr"');
});

test('CSV Inter conta: aspas literais no meio do campo e preâmbulo antes do cabeçalho', () => {
  const r = X.ler(textoDe('inter-conta.csv'), 'Extrato.csv');
  assert.equal(r.transacoes[0].desc, 'Pix recebido: "Cp :18236120-HOSPITAL EXEMPLO LTDA"');
  assert.equal(X.chave(r.transacoes[0].desc), 'hospital exemplo');
});

test('CSV Inter cartão: parcela na coluna Tipo e BOM UTF-8', () => {
  const r = X.ler(textoDe('inter-cartao.csv'), 'fatura-inter.csv');
  const p = r.transacoes.find(t => t.parcela);
  igual(plano(p.parcela), { k: 2, n: 3 });
  assert.equal(X.chave(p.desc), 'loja exemplo');
});

test('CSV Bradesco: crédito/débito separados, segundo bloco e linha de total', () => {
  const r = X.ler(textoDe('bradesco-conta.csv'), 'b.csv');
  assert.equal(r.transacoes.length, 4);
  assert.equal(r.transacoes[3].desc, 'Rendimentos');
});

test('CSV Bradesco antigo: windows-1252, só CR, linha "Des:" anexada, bloco Invest Fácil ignorado', () => {
  const bytes = bytesDe('bradesco-conta-antigo.csv');
  const txt = X.decodificar(bytes);
  assert.ok(txt.includes('Histórico') && txt.includes('Fácil'));
  const r = X.ler(txt, 'b.csv');
  assert.equal(r.transacoes.length, 2);
  assert.equal(r.transacoes[0].desc, 'Pix Enviado - Padaria Pao Quente');
  assert.equal(X.chave(r.transacoes[0].desc), 'padaria pao quente');
});

test('CSV BB: Tipo Lançamento manda no sinal; linhas de saldo e 00/00/0000 ignoradas', () => {
  const r = X.ler(textoDe('bb-conta.csv'), 'bb.csv');
  assert.equal(r.transacoes.at(-1).valor, -1681.1);   // veio "1.681,10" + "Saída"
  assert.equal(r.transacoes[1].desc, 'Compra com Cartão - PADARIA PAO QUENTE');
});

test('CSV C6 cartão: parcela com data da compra original vai para o mês da cobrança', () => {
  const r = X.ler(textoDe('Fatura_2026-11-15.csv'), 'Fatura_2026-11-15.csv');
  const p = r.transacoes.find(t => t.parcela);
  igual(plano(p.parcela), { k: 3, n: 6 });
  assert.equal(p.data, '2026-10-21');
  assert.equal(p.dataCompra, '2026-08-21');
  assert.ok(r.avisos.some(a => /parcela/.test(a)));
  assert.equal(r.transacoes.find(t => /Drogasil/.test(t.desc)).parcela, null);   // 'Única'
});

test('CSV XP: parcela "2 de 6", estorno e pagamento negativos viram positivos', () => {
  const r = X.ler(textoDe('xp-cartao.csv'), 'FaturaXP.csv');
  igual(plano(r.transacoes[0].parcela), { k: 2, n: 6 });
  assert.equal(r.transacoes.find(t => /Estorno/.test(t.desc)).valor, 20);
});

test('CSV Mercado Pago: DD-MM-AAAA, preâmbulo de resumo e REFERENCE_ID como id', () => {
  const r = X.ler(textoDe('mercadopago-conta.csv'), 'mp.csv');
  assert.equal(r.transacoes[0].id, 'mp:101754790001');
  assert.equal(r.transacoes[2].desc, 'Rendimentos');
});

test('CSV PicPay: minus U+2212, "+R$" e descrição = tipo + origem/destino', () => {
  const r = X.ler(textoDe('picpay-conta.csv'), 'picpay.csv');
  assert.equal(r.transacoes[0].valor, 5000);
  assert.equal(r.transacoes[1].desc, 'Compra realizada - Padaria Pao Quente');
});

test('CSV Itaú (Excel salvo como CSV): seção de lançamentos futuros é ignorada', () => {
  const r = X.ler(textoDe('itau-conta.csv'), 'itau.csv');
  assert.equal(r.transacoes.length, 6);
  assert.ok(!r.transacoes.some(t => t.data === '2026-10-25'));
});

test('CSV sem cabeçalho cai no leitor de texto', () => {
  const r = X.ler('02/10/2026;Padaria Pao Quente;-18,90;100,00\n03/10/2026;Pix recebido Fulano;50,00;150,00\n', 'x.csv');
  igual(r.transacoes.map(t => t.valor), [-18.9, 50]);
});

test('CSV com tabulação e coluna D/C', () => {
  const csv = 'Data\tHistórico\tValor\tD/C\n01/10/2026\tSUPERMERCADO EXEMPLO\t120,00\tD\n02/10/2026\tSALARIO EXEMPLO\t3.000,00\tC\n';
  const r = X.ler(csv, 'x.tsv');
  igual(r.transacoes.map(t => t.valor), [-120, 3000]);
});

/* ───────────── texto livre / PDF ───────────── */

test('lerTexto: linhas do contrato', () => {
  const txt = [
    '19/10 IFOOD *RESTAURANTE 42,50',
    '19 OUT iFood 42,50',
    '19/10/2026 Pix enviado Fulano -150,00',
    'Uber *Trip R$ 23,90',
    '02 NOV  NETFLIX.COM  55,90',
    '19 OUT Restaurante X - Parcela 2/3 R$ 66,67'
  ].join('\n');
  const r = X.lerTexto(txt, { ano: 2026 });
  assert.equal(r.formato, 'texto');
  igual(r.transacoes.map(t => [t.data, t.valor, t.desc]), [
    ['2026-10-19', -42.5, 'Ifood *Restaurante'],
    ['2026-10-19', -42.5, 'iFood'],
    ['2026-10-19', -150, 'Pix enviado Fulano'],
    ['2026-10-19', -23.9, 'Uber *Trip'],
    ['2026-10-19', -66.67, 'Restaurante X - Parcela 2/3'],
    ['2026-11-02', -55.9, 'Netflix.com']
  ]);
  igual(plano(r.transacoes[4].parcela), { k: 2, n: 3 });
  const cls = r.transacoes.map(t => X.classificar(t).cat);
  igual(cls, ['comida', 'comida', 'outros', 'transp', 'comida', 'role']);
});

test('lerTexto: ano pelo cabeçalho e virada de ano na fatura (dezembro numa fatura de janeiro)', () => {
  const r = X.lerTexto('FATURA 14 JAN 2027\n20 DEZ Loja Natal R$ 100,00\n05 JAN Padaria R$ 10,00', { ano: 2026 });
  assert.equal(r.conta, 'cartao');
  igual(r.transacoes.map(t => t.data), ['2026-12-20', '2027-01-05']);
  const s = X.lerTexto('28/12 Mercado Exemplo 50,00\n03/01 Padaria Exemplo 9,00', { ano: 2027, conta: 'cartao' });
  igual(s.transacoes.map(t => t.data), ['2026-12-28', '2027-01-03']);
  const v = X.lerTexto('Vencimento: 15/01/2027\n18/12 LOJA EXEMPLO 30,00\n02/01 LOJA DOIS 5,00');
  igual(v.transacoes.map(t => t.data), ['2026-12-18', '2027-01-02']);
});

test('lerTexto: sem ano usa o ano do cabeçalho', () => {
  const r = X.lerTexto('Extrato de outubro 2025\n10/10 Padaria Exemplo -12,00');
  assert.equal(r.transacoes[0].data, '2025-10-10');
});

test('lerTexto: na fatura, "-" na frente é crédito e linha sem sinal é compra', () => {
  const r = X.lerTexto('Fatura do cartão - Vencimento 10/11/2026\n01/10 LOJA A 10,00\n02/10 ESTORNO LOJA A -10,00\n03/10 LOJA B 5,00-\n04/10 LOJA C (20,00)', {});
  igual(r.transacoes.map(t => t.valor), [-10, 10, 5, 20]);
});

test('lerTexto: na conta, sufixo C/D e "-" no fim', () => {
  const r = X.lerTexto('Saldo anterior 10,00\n01/10/2026 PIX ENVIADO FULANO 150,00 D 100,00 C\n02/10/2026 CRED PIX FULANA 20,00 C\n03/10/2026 TARIFA 5,00-', {});
  assert.equal(r.conta, 'corrente');
  igual(r.transacoes.map(t => t.valor), [-150, 20, -5]);
});

test('lerTexto: Nubank PDF de conta sem sinal usa "Total de entradas/saídas"', () => {
  const r = X.lerTexto(textoDe('nubank-conta-pdf.txt'), { ano: 2026 });
  igual(r.transacoes.map(t => t.valor), [5000, -42.5, -1000]);
});

test('lerTexto: compra internacional em várias linhas no PDF do Nubank', () => {
  const r = X.lerTexto(textoDe('nubank-fatura-pdf.txt'));
  const t = r.transacoes.find(t => t.valor === -108.8);
  assert.equal(t.desc, 'Openai *Chatgpt Subscr');
  assert.equal(t.data, '2026-10-23');
  assert.ok(!r.transacoes.some(t => Math.abs(t.valor) === 612.4 || Math.abs(t.valor) === 70.12 || t.valor === 0));
});

test('lerTexto: Mercado Pago PDF junta descrição quebrada acima e abaixo da linha da data', () => {
  const r = X.lerTexto(textoDe('mercadopago-conta-pdf.txt'));
  igual(r.transacoes.map(t => t.desc), ['Rendimentos', 'Compra de 2 produtos Mercado Livre', 'Transferência Pix enviada Beltrana Souza']);
});

test('lerTexto: seção de parcelas futuras não entra', () => {
  const inter = X.lerTexto(textoDe('inter-fatura-pdf.txt'));
  assert.equal(inter.transacoes.filter(t => /LOJA/.test(t.desc)).length, 1);
  const itau = X.lerTexto(textoDe('itau-fatura-pdf.txt'));
  assert.ok(!itau.transacoes.some(t => /ROUPA04|Roupa04/.test(t.desc)));
  const mp = X.lerTexto(textoDe('mercadopago-fatura-pdf.txt'));
  assert.ok(!mp.transacoes.some(t => t.parcela && t.parcela.k === 7));
});

test('lerTexto: Itaú com data colada na descrição e saldo do dia', () => {
  const r = X.lerTexto(textoDe('itau-conta-pdf.txt'));
  assert.equal(r.transacoes.length, 4);
  assert.equal(X.chave('PIX QRS PADARIA PA05/10'), 'padaria');
  assert.equal(r.transacoes.find(t => /PADARIA|Padaria/.test(t.desc)).parcela, null);
});

test('lerTexto: Ourocard com data colada, parcela PARC 06/06 movida para o mês da fatura', () => {
  const r = X.lerTexto(textoDe('bb-ourocard.txt'));
  const p = r.transacoes.find(t => t.parcela);
  igual(plano(p.parcela), { k: 6, n: 6 });
  assert.equal(p.dataCompra, '2026-05-28');
  assert.equal(p.data, '2026-10-28');
});

test('lerTexto: texto vazio ou sem lançamentos devolve aviso, nunca lança erro', () => {
  for (const entrada of ['', '   \n  ', 'Olá, tudo bem?\nNada aqui', null, undefined, 12345, { a: 1 }]) {
    const r = X.lerTexto(entrada);
    assert.equal(r.transacoes.length, 0);
    assert.ok(r.avisos.length > 0);
  }
});

/* ───────────── ler(): robustez e detecção ───────────── */

test('ler: entradas ruins não lançam erro', () => {
  for (const entrada of ['', null, undefined, '%PDF-1.7 lixo binário', '<OFX><STMTTRN>quebrado', 'a,b,c\n1,2,3', new Uint8Array([0xff, 0x00, 0x81]), 42]) {
    const r = X.ler(entrada, 'x');
    assert.ok(Array.isArray(r.transacoes));
    assert.ok(Array.isArray(r.avisos));
    if (!r.transacoes.length) assert.ok(r.avisos.length > 0);
  }
});

test('ler: aceita bytes direto (ArrayBuffer e Uint8Array)', () => {
  const u8 = bytesDe('nubank-cartao.csv');
  const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  assert.equal(X.ler(new Uint8Array(u8), 'n.csv').transacoes.length, 6);
  assert.equal(X.ler(ab, 'n.csv').transacoes.length, 6);
});

/* ───────────── codificação ───────────── */

function cp1252(str) {
  const mapa = { '€': 0x80, '‚': 0x82, '“': 0x93, '”': 0x94, '–': 0x96, '—': 0x97 };
  return Uint8Array.from([...str].map(c => mapa[c] || c.charCodeAt(0)));
}

test('decodificar: UTF-8 com e sem BOM', () => {
  const s = 'Descrição: Padaria Pão Quente “Ótima” – 5€';
  const u = new TextEncoder().encode(s);
  assert.equal(X.decodificar(u), s);
  assert.equal(X.decodificar(Uint8Array.from([0xEF, 0xBB, 0xBF, ...u])), s);
  assert.equal(X.decodificar(u.buffer), s);
});

test('decodificar: windows-1252 quando o UTF-8 é inválido', () => {
  const s = 'Data;Histórico;Valor\n01/10/2026;Café da manhã – Padaria São João “Pão”;-12,50\n';
  const bytes = cp1252(s);
  assert.equal(X.decodificar(bytes), s);
  const r = X.ler(X.decodificar(bytes), 'x.csv');
  assert.equal(r.transacoes[0].desc, 'Café da manhã – Padaria São João “Pão”');
  assert.equal(X.classificar(r.transacoes[0]).cat, 'diaria');
});

test('decodificar: OFX com CHARSET:1252 e bytes 1252 / OFX que diz 1252 mas é UTF-8', () => {
  const ofx = 'OFXHEADER:100\nDATA:OFXSGML\nENCODING:USASCII\nCHARSET:1252\n<OFX><BANKMSGSRSV1><STMTRS><BANKACCTFROM><BANKID>0341<ACCTID>1</BANKACCTFROM>' +
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003<TRNAMT>-9.90<FITID>X1<MEMO>FARMÁCIA SÃO JOÃO</STMTTRN></STMTRS></BANKMSGSRSV1></OFX>';
  const como1252 = X.decodificar(cp1252(ofx));
  assert.ok(como1252.includes('FARMÁCIA SÃO JOÃO'));
  const comoUtf8 = X.decodificar(new TextEncoder().encode(ofx.replace('FARMÁCIA SÃO JOÃO', 'Antecipação')));
  assert.ok(comoUtf8.includes('Antecipação'));
  const r = X.ler(como1252, 'x.ofx');
  assert.equal(r.transacoes[0].desc, 'Farmácia São João');
  assert.equal(X.classificar(r.transacoes[0]).cat, 'saude');
});

test('decodificar: nunca lança erro', () => {
  for (const b of [null, undefined, 1, {}, [], 'texto', new ArrayBuffer(0)]) assert.equal(typeof X.decodificar(b), 'string');
});

/* ───────────── ids estáveis ───────────── */

test('ids: mesmo arquivo -> mesmos ids; linhas idênticas -> ids diferentes', () => {
  const a = X.ler(textoDe('nubank-cartao.csv'), 'n.csv').transacoes;
  const b = X.ler(textoDe('nubank-cartao.csv'), 'n.csv').transacoes;
  igual(a.map(t => t.id), b.map(t => t.id));
  const parcelas = a.filter(t => t.valor === -66.67);
  assert.equal(parcelas.length, 2);
  assert.notEqual(parcelas[0].id, parcelas[1].id);
  assert.equal(parcelas[1].id, parcelas[0].id + '-2');
});

test('ids: arquivos sobrepostos da mesma fonte dão o mesmo id para o mesmo lançamento', () => {
  const quinzena = 'date,title,amount\n2026-10-01,Padaria Exemplo,10.00\n2026-10-02,Uber *Trip,23.90\n';
  const mes = quinzena + '2026-10-20,Netflix.Com,55.90\n2026-10-01,Padaria Exemplo,10.00\n';
  const a = X.ler(quinzena, 'a.csv').transacoes, b = X.ler(mes, 'b.csv').transacoes;
  for (const t of a) assert.ok(b.some(u => u.id === t.id), t.desc);
  assert.equal(new Set(b.map(t => t.id)).size, 4);
});

test('ids: ordem de linhas iguais do mesmo dia não muda o conjunto de ids', () => {
  const l1 = '01/10/2026 CAFE EXEMPLO -8,00', l2 = '02/10/2026 PADARIA EXEMPLO -5,00';
  const a = X.lerTexto([l1, l2, l1].join('\n')).transacoes.map(t => t.id).sort();
  const b = X.lerTexto([l2, l1, l1].join('\n')).transacoes.map(t => t.id).sort();
  igual(a, b);
});

/* ───────────── parcelas ───────────── */

test('parcelas em todos os formatos', () => {
  const casos = [
    ['19 OUT Loja Exemplo - Parcela 2/10 R$ 30,00', { k: 2, n: 10 }],
    ['19/10 LOJA EXEMPLO PARC 02/10 30,00', { k: 2, n: 10 }],
    ['19/10 LOJA EXEMPLO (Parcela 02 de 05) 30,00', { k: 2, n: 5 }],
    ['19/10 LOJA*EXEMPLO Parcela 6 de 10 R$ 30,00', { k: 6, n: 10 }],
    ['19/10 LOJA EXEMPLO ROUPA03/06 30,00', { k: 3, n: 6 }],
    ['19/10 LOJA EXEMPLO 2/10 30,00', { k: 2, n: 10 }],
    ['19/10 LOJA EXEMPLO 30,00', null]
  ];
  for (const [linha, esp] of casos) {
    const t = X.lerTexto('Fatura - Vencimento 10/11/2026\n' + linha).transacoes[0];
    igual(plano(t.parcela), esp, linha);
    assert.equal(t.valor, -30);
  }
  // em extrato de conta, 'DD/MM' colado é data da operação, não parcela
  const c = X.lerTexto('Saldo anterior 1,00\n05/10/2026 PIX QRS PADARIA PA05/10 -18,90').transacoes[0];
  assert.equal(c.parcela, null);
});

/* ───────────── chave() ───────────── */

test('chave: variantes do mesmo comerciante dão a mesma chave', () => {
  const grupos = [
    ['UBER *TRIP HELP.UBER.COM', 'Uber *Trip', 'UBER* TRIP SAO PAULO BR', 'Uber Uber *Trip Help.U', 'UBER *UBER *TRIP'],
    ['IFD*RESTAURANTE SABOR SAO PAULO BR', 'iFood *Restaurante Sabor', 'IFD*RESTAURANTE SABOR', 'Ifd*Restaurante Sabor'],
    ['Loja Exemplo - Parcela 2/3', 'LOJA EXEMPLO          SAO PAULO     BRA  ', 'Loja Exemplo - Parcela 3/3', 'LOJA EXEMPLO PARC 05/06 SAO PAULO BR'],
    ['Raia140', 'RAIA 99', 'Raia2349'],
    ['NETFLIX.COM', 'Netflix.Com', 'NETFLIX.COM SAO PAULO BRA'],
    ['Transferência enviada pelo Pix - Beltrana Souza - •••.123.456-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 1234 Conta: 56789-0',
      'Pix enviado: "Cp :60701190-Beltrana Souza"', 'Pix enviado para Beltrana Souza', 'Pix - Enviado - Beltrana Souza',
      'Transferência recebida pelo Pix - BELTRANA SOUZA - •••.123.456-•• - NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 1-1'],
    ['Compra no débito - Padaria Pao Quente', 'Compra no debito: "PADARIA PAO QUENTE"', 'Compra com Cartão - PADARIA PAO QUENTE', 'PG *TON PADARIA PAO QUENTE']
  ];
  for (const g of grupos) {
    const ch = g.map(X.chave);
    assert.ok(ch[0].length > 0);
    igual(ch, g.map(() => ch[0]), JSON.stringify(g));
  }
});

test('chave: formato (minúsculas, sem acento, sem dígitos, até 3 palavras)', () => {
  assert.equal(X.chave('UBER *TRIP HELP.UBER.COM'), 'uber trip');
  assert.equal(X.chave('IFD*RESTAURANTE SABOR SAO PAULO BR'), 'ifood restaurante sabor');
  assert.equal(X.chave('Transferência enviada pelo Pix - Uber - 17.895.646/0001-87 - EBANX IP LTDA. (0383) Agência: 1 Conta: 1-1'), 'uber');
  assert.equal(X.chave('Drogaria São Paulo 1234 Unidade Centro Pinheiros'), 'drogaria sao paulo');
  assert.equal(X.chave('PIX TRANSF BELTRAN03/10'), 'beltran');
  assert.equal(X.chave('Pix recebido: "00019 123456789 HOSPITAL EXEMPLO"'), 'hospital exemplo');
  assert.equal(X.chave('02/10 08:15 00012345678901 HOSPITAL EXEMPLO'), 'hospital exemplo');
  assert.equal(X.chave('99 *99app'), '99app');
  for (const d of ['Café Ótimo nº 12', 'MP *LOJADOJOAO', 'Pagamento de fatura', 'PIX ENVIADO']) {
    const c = X.chave(d);
    assert.match(c, /^[a-z0-9 ]+$/);
    assert.ok(c.split(' ').length <= 3);
    assert.ok(!/\d/.test(c) || c === '99app');
  }
  assert.ok(X.generica(X.chave('PIX ENVIADO')));
  assert.ok(!X.generica(X.chave('Pix enviado para Beltrana Souza')));
});

/* ───────────── classificar() ───────────── */

const C = (desc, valor, extra) => X.classificar(Object.assign({ desc, valor }, extra || {}), {});
const CLASSES = [
  // [descrição, valor, tipo, cat, assinatura?]
  ['IFD*RESTAURANTE SABOR', -42.5, 'gasto', 'comida'],
  ['iFood *Pizzaria Bella', -60, 'gasto', 'comida'],
  ['Rappi*Sushi Bar Japones', -80, 'gasto', 'comida'],
  ['99Food *99Food', -35, 'gasto', 'comida'],
  ['UBER* EATS', -30, 'gasto', 'comida'],
  ['MCDONALDS SAO PAULO BR', -32, 'gasto', 'comida'],
  ['STARBUCKS PAULISTA', -18, 'gasto', 'comida'],
  ['Lanchonete do Ze', -15, 'gasto', 'comida'],
  ['CACAU SHOW 123', -25, 'gasto', 'comida'],
  ['IFD*IFOOD CLUB', -12.9, 'gasto', 'comida', true],
  ['ASSAI ATACADISTA 044', -320, 'gasto', 'mercado'],
  ['IFD*ASSAI ATACADISTA', -150, 'gasto', 'mercado'],
  ['CARREFOUR HIPER', -210, 'gasto', 'mercado'],
  ['SUPERMERCADO DIA A DIA', -88, 'gasto', 'mercado'],
  ['HORTIFRUTI NATURAL DA TERRA', -40, 'gasto', 'mercado'],
  ['ACOUGUE BOI GORDO', -70, 'gasto', 'mercado'],
  ['BAR DO JOAO', -90, 'gasto', 'role'],
  ['CINEMARK SHOPPING', -46, 'gasto', 'role'],
  ['SYMPLA*SHOW DE ROCK', -120, 'gasto', 'role'],
  ['AIRBNB * HMXYZ', -800, 'gasto', 'role'],
  ['LATAM AIRLINES BRASIL', -950, 'gasto', 'role'],
  ['NETFLIX.COM', -55.9, 'gasto', 'role', true],
  ['Spotify P0A1B2C3', -21.9, 'gasto', 'role', true],
  ['AMAZON PRIME CANAIS', -19.9, 'gasto', 'role', true],
  ['DISNEY PLUS', -33.9, 'gasto', 'role', true],
  ['Microsoft*Xbox Game Pass', -44.99, 'gasto', 'role', true],
  ['STEAM PURCHASE', -50, 'gasto', 'role', false],
  ['UBER *TRIP HELP.UBER.COM', -23.9, 'gasto', 'transp'],
  ['99 *99app', -18, 'gasto', 'transp'],
  ['POSTO SHELL AV BRASIL', -200, 'gasto', 'transp'],
  ['AUTO POSTO IPIRANGA', -180, 'gasto', 'transp'],
  ['ESTAPAR ESTACIONAMENTO', -25, 'gasto', 'transp'],
  ['SEM PARAR', -48, 'gasto', 'transp'],
  ['RECARGA BILHETE UNICO', -50, 'gasto', 'transp'],
  ['PAY  -ESTAC 01/10', -15, 'gasto', 'transp'],
  ['UBERLANDIA PIZZARIA', -60, 'gasto', 'comida'],
  ['PADARIA PAO QUENTE', -12, 'gasto', 'diaria'],
  ['PG *TON PADARIA PAO QUENTE', -12, 'gasto', 'diaria'],
  ['AM PM CONVENIENCIA', -20, 'gasto', 'diaria'],
  ['LAVANDERIA 5ASEC', -45, 'gasto', 'diaria'],
  ['BANCA DE JORNAL CENTRAL', -8, 'gasto', 'diaria'],
  ['AMAZON MARKETPLACE', -150, 'gasto', 'compras'],
  ['MERCADOLIVRE*LOJA EXEMPLO', -99, 'gasto', 'compras'],
  ['Mercado*Lojaexemplo', -99, 'gasto', 'compras'],
  ['Compra de 2 produtos Mercado Livre', -167.8, 'gasto', 'compras'],
  ['SHOPEE *VENDEDOR', -40, 'gasto', 'compras'],
  ['SHEIN COM', -130, 'gasto', 'compras'],
  ['LOJAS RENNER FL 123', -199, 'gasto', 'compras'],
  ['NETSHOES', -250, 'gasto', 'compras'],
  ['SEPHORA IGUATEMI', -300, 'gasto', 'compras'],
  ['DROGASIL 1455', -31.2, 'gasto', 'saude'],
  ['RAIA140', -45, 'gasto', 'saude'],
  ['DROGARIA SAO PAULO', -60, 'gasto', 'saude'],
  ['PAGUE MENOS 0123', -28, 'gasto', 'saude'],
  ['LABORATORIO FLEURY', -150, 'gasto', 'saude'],
  ['SMART FIT MENSALIDADE', -119.9, 'gasto', 'saude', true],
  ['WELLHUB GYMPASS BR', -89.9, 'gasto', 'saude', true],
  ['POSTO DE SAUDE MUNICIPAL', -10, 'gasto', 'saude'],
  ['PSICOLOGA ANA EXEMPLO', -200, 'gasto', 'saude'],
  ['CARTAO DE TODOS', -32.9, 'gasto', 'saude'],
  ['CLAUDE.AI SUBSCRIPTION', -110, 'gasto', 'outros', true],
  ['OPENAI *CHATGPT SUBSCR', -108.8, 'gasto', 'outros', true],
  ['APPLE.COM/BILL', -14.9, 'gasto', 'outros', true],
  ['IOF de "Netflix.Com"', -1.96, 'gasto', 'outros', false],
  ['IOF DIARIO', -0.01, 'gasto', 'outros'],
  ['Juros de atraso', -12.3, 'gasto', 'outros'],
  ['ANUIDADE DIFERENCI06/12', -35, 'gasto', 'outros'],
  ['TAR PACOTE ITAU', -12.9, 'gasto', 'outros'],
  ['SIMPLES NACIONAL', -80.9, 'gasto', 'outros'],
  ['DAS - SIMPLES NACIONAL', -80.9, 'gasto', 'outros'],
  ['IPVA 2026 SP', -900, 'gasto', 'outros'],
  ['MEDGRUPO CURSO RESIDENCIA', -890, 'gasto', 'outros'],
  ['FORMATURA MEDICINA TURMA X 3/12', -450, 'gasto', 'outros'],
  ['CREMESP ANUIDADE', -700, 'gasto', 'outros'],
  ['CLINICA VETERINARIA AMIGO', -150, 'gasto', 'outros'],
  ['BARBEARIA DO ZE', -50, 'gasto', 'outros'],
  ['DA  VIVO-SP 11999990000', -89.9, 'gasto', 'outros'],
  ['FATURA ENEL SP', -180, 'gasto', 'outros'],
  ['Transferência enviada pelo Pix - Beltrana Souza - •••.123.456-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 1234 Conta: 56789-0', -150, 'gasto', 'outros'],
  ['PIX ENVIADO JOAO HIROTA', -50, 'gasto', 'outros'],
  ['Transferência enviada pelo Pix - Uber - 17.895.646/0001-87 - EBANX IP LTDA. (0383) Agência: 1 Conta: 1-1', -20, 'gasto', 'transp'],
  ['Pix enviado - Mercado Pago IP - Fulano', -30, 'gasto', 'outros'],
  ['Pagamento de fatura', -2310.45, 'fatura', null],
  ['Pagamento efetuado: "Pagamento fatura cartao Inter"', -1681.1, 'fatura', null],
  ['Pagto cartão crédito', -1681.1, 'fatura', null],
  ['PGTO FAT CARTAO C6', -1681.1, 'fatura', null],
  ['ITAU BLACK  1234-5678', -1681.1, 'fatura', null],
  ['PAG BOLETO NU PAGAMENTOS SA', -900, 'fatura', null],
  ['Pagamento de boleto efetuado - NU PAGAMENTOS S.A.', -900, 'fatura', null],
  ['NU PAGAMENTO', -500, 'fatura', null],
  ['Pagto Cobranca Nubank', -500, 'fatura', null],
  ['Pagamento recebido', 1250, 'fatura', null],
  ['PAGAMENTO ON LINE', 1681.1, 'fatura', null],
  ['Pagamento em 25 OUT', 1250, 'fatura', null],
  ['Inclusao de Pagamento', 1681.1, 'fatura', null],
  ['Pagamentos Validos Normais', 1250, 'fatura', null],
  ['Pagamento da fatura de outubro/2026', 812.4, 'fatura', null],
  ['PGTO DEBITO CONTA 1234 000001234', 1681.1, 'fatura', null],
  ['Transferência entre contas', -1000, 'transferencia', null],
  ['TED mesma titularidade', 2000, 'transferencia', null],
  ['Transferência para conta própria', -500, 'transferencia', null],
  ['Valor adicionado na conta por cartão de crédito - Valor adicionado para Pix no Crédito', 300, 'transferencia', null],
  ['Aplicação RDB', -1000, 'investimento', null],
  ['Resgate RDB', 500, 'investimento', null],
  ['Aplicacao: "CDB Porq Obj BANCO INTER S A"', -300, 'investimento', null],
  ['REND PAGO APLIC AUT MAIS', 0.42, 'investimento', null],
  ['BB Rende Fácil', -4900, 'investimento', null],
  ['APLICACAO CONTAMAX', -300, 'investimento', null],
  ['Tesouro Direto Selic', -1000, 'investimento', null],
  ['Dinheiro guardado com resgate planejado', -200, 'investimento', null],
  ['Rendimentos', 0.42, 'investimento', null],
  ['Rent.inv.facil', 0.01, 'investimento', null],
  ['Transferência recebida pelo Pix - HOSPITAL EXEMPLO LTDA - 12.345.678/0001-90 - BCO EXEMPLO S.A. (0999) Agência: 1 Conta: 12345-6', 5000, 'entrada', null],
  ['PIX RECEBIDO FULANO', 50, 'entrada', null],
  ['SALARIO EMPRESA EXEMPLO', 3000, 'entrada', null],
  ['BOLSA RESIDENCIA MEDICA', 4100, 'entrada', null],
  ['Recebimento de Proventos', 2500, 'entrada', null],
  ['Cashback com pontos', 12, 'entrada', null],
  ['Resgate pontos Livelo', 80, 'entrada', null],
  ['Estorno - Compra no débito - Loja Exemplo', 19.9, 'estorno', 'compras'],
  ['Reembolso recebido pelo Pix - IFOOD.COM AGENCIA DE RESTAURANTES ONLINE S.A.', 30, 'estorno', 'comida'],
  ['Pix enviado devolvido', 50, 'estorno', 'outros'],
  ['Estorno Uber *Trip', 23.9, 'estorno', 'transp'],
  ['Desconto Antecipação Netflix', 5, 'estorno', 'role']
];

test(`classificar: ${CLASSES.length} descrições reais`, () => {
  const erros = [];
  for (const [desc, valor, tipo, cat, assin] of CLASSES) {
    const c = C(desc, valor);
    const ok = c.tipo === tipo && c.cat === cat && (assin === undefined || c.assinatura === assin);
    if (!ok) erros.push(`${desc} (${valor}): esperado ${tipo}/${cat}${assin ? '/A' : ''}, veio ${c.tipo}/${c.cat}${c.assinatura ? '/A' : ''}`);
    assert.equal(c.chave, X.chave(desc));
    assert.ok(['regra', 'dicionario', 'palpite'].includes(c.confianca));
    if (c.tipo === 'gasto' || c.tipo === 'estorno') assert.ok(c.cat); else assert.equal(c.cat, null);
    if (c.tipo !== 'gasto') assert.equal(c.assinatura, false);
  }
  igual(erros, []);
});

test('classificar: confiança', () => {
  assert.equal(C('Pix enviado para Beltrana Souza', -150).confianca, 'palpite');
  assert.equal(C('LOJINHA SEM NOME', -10).confianca, 'palpite');
  assert.equal(C('LOJINHA SEM NOME', -10).cat, 'outros');
  assert.equal(C('DROGASIL 1455', -10).confianca, 'dicionario');
  assert.equal(C('CREDITO XYZ', 10).tipo, 'entrada');
  assert.equal(C('CREDITO XYZ', 10).confianca, 'palpite');
  assert.equal(C('Pix recebido de Fulano', 10).confianca, 'dicionario');
});

test('classificar: "pagamento recebido" na conta corrente é entrada; na fatura é fatura', () => {
  assert.equal(C('Pagamento recebido', 200, { conta: 'corrente' }).tipo, 'entrada');
  assert.equal(C('Pagamento recebido', 200, { conta: 'cartao' }).tipo, 'fatura');
});

test('classificar: categoria do banco (CSV Inter/C6) vira palpite quando o dicionário não sabe', () => {
  const c = C('JIM COM LA GIO', -20, { dica: 'RESTAURANTES' });
  assert.equal(c.cat, 'comida');
  assert.equal(c.confianca, 'palpite');
});

test('classificar: entrada nunca lança erro', () => {
  for (const t of [null, undefined, {}, { desc: null, valor: 'abc' }, { valor: -5 }]) {
    const c = X.classificar(t);
    assert.ok(c.tipo);
  }
});

/* ───────────── regras aprendidas ───────────── */

test('regras: a correção do usuário vence o dicionário e vale para as variantes', () => {
  const regras = { 'ifood restaurante sabor': 'mercado', 'beltrana souza': 'transferencia', 'hospital exemplo': 'entrada',
    'loja exemplo': 'role', 'netflix': 'investimento' };
  const c1 = X.classificar({ desc: 'IFD*RESTAURANTE SABOR SAO PAULO BR', valor: -42.5 }, regras);
  igual(plano(c1), { tipo: 'gasto', cat: 'mercado', assinatura: false, confianca: 'regra', chave: 'ifood restaurante sabor' });
  const c2 = X.classificar({ desc: 'Pix enviado: "Cp :60701190-Beltrana Souza"', valor: -150 }, regras);
  assert.equal(c2.tipo, 'transferencia');
  assert.equal(c2.cat, null);
  assert.equal(c2.confianca, 'regra');
  assert.equal(X.classificar({ desc: 'Transferência recebida pelo Pix - BELTRANA SOUZA - •••.123.456-•• - NU PAGAMENTOS - IP (0260) Agência: 1 Conta: 1-1', valor: 150 }, regras).tipo, 'transferencia');
  assert.equal(X.classificar({ desc: 'Loja Exemplo - Parcela 2/3', valor: -66.67 }, regras).cat, 'role');
  // estorno de algo com regra de categoria herda a categoria
  const e = X.classificar({ desc: 'Estorno Loja Exemplo', valor: 19.9 }, regras);
  assert.equal(e.tipo, 'estorno'); assert.equal(e.cat, 'role');
  assert.equal(X.classificar({ desc: 'NETFLIX.COM', valor: -55.9 }, regras).tipo, 'investimento');
  // sem regra, volta ao dicionário
  assert.equal(X.classificar({ desc: 'IFD*RESTAURANTE SABOR', valor: -42.5 }, {}).cat, 'comida');
  assert.equal(X.classificar({ desc: 'IFD*RESTAURANTE SABOR', valor: -42.5 }).confianca, 'dicionario');
});

test('regras: chaves herdadas do protótipo não contam como regra', () => {
  const c = X.classificar({ desc: 'constructor', valor: -10 }, {});
  assert.equal(c.confianca, 'palpite');
});

test('API exposta', () => {
  for (const f of ['decodificar', 'ler', 'lerTexto', 'chave', 'classificar']) assert.equal(typeof X[f], 'function');
  igual(Object.keys(X.CATEGORIAS).sort(), ['comida', 'compras', 'diaria', 'mercado', 'outros', 'role', 'saude', 'transp']);
});

test('lerTexto: farmácia "Pague Menos" e academia no texto da fatura; parcela da formatura', () => {
  const r = X.lerTexto('Vencimento: 15/11/2026\n19/10 PAGUE MENOS 0123 28,00\n20/10 TOTALPASS 99,90\n21/10 FORMATURA MEDICINA 03/12 450,00\nPague até 15/11 o valor de R$ 100,00');
  igual(r.transacoes.map(t => [t.data, t.valor]), [['2026-10-19', -28], ['2026-10-20', -99.9], ['2026-10-21', -450]]);
  igual(r.transacoes.map(t => X.classificar(t).cat), ['saude', 'saude', 'outros']);
  assert.equal(X.classificar(r.transacoes[1]).assinatura, true);
  igual(r.transacoes[2].parcela, { k: 3, n: 12 });
});

test('lerTexto: PDF por dia com descrição quebrada em duas linhas', () => {
  const r = X.lerTexto('03 OUT 2026 Total de saídas - 160,00\nTransferência enviada pelo Pix\nBeltrana Souza - •••.123.456-•• - ITAÚ UNIBANCO S.A. (0341) Agência: 1234 Conta: 56789-0 150,00\nCompra no débito Padaria 10,00\nSaldo do dia 1,00');
  igual(r.transacoes.map(t => [t.data, t.valor, X.chave(t.desc)]), [['2026-10-03', -150, 'beltrana souza'], ['2026-10-03', -10, 'padaria']]);
});

test('OFX 2.x (XML com <?OFX ...?>)', () => {
  const ofx = '<?xml version="1.0"?>\n<?OFX OFXHEADER="200" VERSION="220"?>\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>0260</BANKID><ACCTID>9</ACCTID></BANKACCTFROM>' +
    '<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261019</DTPOSTED><TRNAMT>-9.99</TRNAMT><FITID>x-1</FITID><NAME>Spotify</NAME></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>';
  const r = X.ler(ofx, 'a.ofx');
  assert.equal(r.banco, 'Nubank');
  assert.equal(r.transacoes[0].valor, -9.99);
  const c = X.classificar(r.transacoes[0]);
  assert.equal(c.cat, 'role'); assert.equal(c.assinatura, true);
});
