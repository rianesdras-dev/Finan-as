// Testes adversariais de robustez de formato: decodificar(), ler(), lerTexto().
// Rodar: node --test testes/ataque-formatos.test.mjs
// Todos os dados são inventados (nomes, valores, contas, FITIDs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregar } from './carregar.mjs';

const X = carregar();
const plano = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const igual = (a, b, msg) => assert.deepEqual(plano(a), plano(b), msg);
const cp1252 = s => {
  // codifica em windows-1252 (latin1 + alguns da faixa 0x80-0x9F)
  const extra = { '–': 0x96, '—': 0x97, '€': 0x80, '“': 0x93, '”': 0x94 };
  return Uint8Array.from([...s].map(c => extra[c] ?? c.charCodeAt(0)));
};
const utf8 = s => new TextEncoder().encode(s);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const linhas = r => r.transacoes.map(t => `${t.data} ${t.valor.toFixed(2)}`);
const valores = r => r.transacoes.map(t => +t.valor.toFixed(2));
const acha = (r, re) => r.transacoes.find(t => re.test(t.desc));
const crlf = s => s.replace(/\n/g, '\r\n');

function formaValida(r) {
  assert.ok(['ofx', 'csv', 'texto'].includes(r.formato), 'formato');
  assert.ok(r.banco === null || typeof r.banco === 'string', 'banco');
  assert.ok(r.conta === null || r.conta === 'corrente' || r.conta === 'cartao', 'conta');
  assert.ok(Array.isArray(r.transacoes), 'transacoes');
  assert.ok(Array.isArray(r.avisos), 'avisos');
  for (const t of r.transacoes) {
    assert.match(t.data, ISO);
    assert.ok(!Number.isNaN(Date.parse(t.data + 'T00:00:00Z')), 'data válida ' + t.data);
    assert.ok(Number.isFinite(t.valor), 'valor finito');
    assert.equal(typeof t.id, 'string'); assert.ok(t.id.length > 0);
    assert.equal(typeof t.desc, 'string'); assert.equal(typeof t.original, 'string');
    assert.ok(!/\r/.test(t.desc) && !/\r/.test(t.original), 'sem \\r em desc/original');
    assert.ok(t.parcela === null || (Number.isInteger(t.parcela.k) && Number.isInteger(t.parcela.n)));
  }
}

/* ───────────────────────── decodificar ───────────────────────── */

test('decodificar: windows-1252 com acentos (Descrição, São Paulo, Pão de Açúcar)', () => {
  const s = X.decodificar(cp1252('Descrição;Cidade\nPão de Açúcar;São Paulo\n'));
  assert.ok(s.includes('Descrição'), s);
  assert.ok(s.includes('Pão de Açúcar'), s);
  assert.ok(s.includes('São Paulo'), s);
  assert.ok(!s.includes('�'));
});

test('decodificar: windows-1252 faixa 0x80-0x9F (travessão 0x96, € 0x80)', () => {
  const s = X.decodificar(cp1252('Compra – Loja € 10'));
  assert.equal(s, 'Compra – Loja € 10');
});

test('decodificar: UTF-8 com BOM tem o BOM removido', () => {
  const b = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Data;Descrição\n')]);
  assert.equal(X.decodificar(b), 'Data;Descrição\n');
});

test('decodificar: UTF-8 válido sem BOM permanece UTF-8 (não vira mojibake)', () => {
  assert.equal(X.decodificar(utf8('Pão de Açúcar São Paulo')), 'Pão de Açúcar São Paulo');
});

test('decodificar: aceita ArrayBuffer e Uint8Array (inclusive subarray com offset)', () => {
  const u = utf8('xxPadaria Pão');
  const sub = u.subarray(2);
  assert.equal(X.decodificar(sub), 'Padaria Pão');
  const ab = utf8('Padaria Pão').buffer;
  assert.equal(X.decodificar(ab), 'Padaria Pão');
});

test('decodificar: OFX CHARSET:1252 / ENCODING:USASCII com bytes altos', () => {
  const ofx = 'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nSECURITY:NONE\nENCODING:USASCII\nCHARSET:1252\n\n<OFX><MEMO>Pão de Açúcar São Paulo</OFX>';
  const s = X.decodificar(cp1252(ofx));
  assert.ok(s.includes('Pão de Açúcar São Paulo'), s);
});

test('decodificar: nunca lança (vazio, lixo binário, BOM sozinho, UTF-8 truncado)', () => {
  const lixo = new Uint8Array(512); for (let i = 0; i < lixo.length; i++) lixo[i] = (i * 73 + 41) & 255;
  for (const b of [new Uint8Array(0), new ArrayBuffer(0), lixo, new Uint8Array([0xef, 0xbb, 0xbf]), new Uint8Array([0x50, 0xc3])]) {
    let s; assert.doesNotThrow(() => { s = X.decodificar(b); });
    assert.equal(typeof s, 'string');
  }
  assert.equal(X.decodificar(new Uint8Array(0)), '');
  assert.equal(X.decodificar(new Uint8Array([0xef, 0xbb, 0xbf])), '');
});

/* ───────────────────────── OFX ───────────────────────── */

const OFX_SGML = crlf(`OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>20261031120000[-3:BRT]
<LANGUAGE>POR
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1

<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0999
<ACCTID>12345-6
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261001000000[-3:BRT]
<DTEND>20261031000000[-3:BRT]

<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261019120000[-3:BRT]
<TRNAMT>-42.50
<FITID>A0001
<MEMO>Compra no debito Padaria Pao Quente

<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261020000000[-03:EST]
<TRNAMT>5000.00
<FITID>A0002
<MEMO>Pix recebido Fulano Ficticio

<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261021233000[-3:BRT]
<TRNAMT>-150.00
<FITID>A0003
<MEMO>Pix enviado Beltrano Inventado

</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>4807.50
<DTASOF>20261031
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`);

test('OFX SGML sem tags de fechamento, CRLF e linhas em branco', () => {
  const r = X.ler(OFX_SGML, 'extrato.ofx');
  formaValida(r);
  assert.equal(r.formato, 'ofx');
  assert.equal(r.conta, 'corrente');
  igual(linhas(r), ['2026-10-19 -42.50', '2026-10-20 5000.00', '2026-10-21 -150.00']);
});

test('OFX: DTPOSTED com fuso [-3:BRT] às 23:30 não muda de dia (sem conversão UTC)', () => {
  const r = X.ler(OFX_SGML, 'extrato.ofx');
  assert.equal(r.transacoes[2].data, '2026-10-21');
});

test('OFX: sem quebras de linha (tudo em uma linha só)', () => {
  const uma = OFX_SGML.replace(/\r\n/g, '').replace('NEWFILEUID:NONE', 'NEWFILEUID:NONE ');
  const r = X.ler(uma, 'extrato.ofx');
  assert.equal(r.formato, 'ofx');
  igual(linhas(r), ['2026-10-19 -42.50', '2026-10-20 5000.00', '2026-10-21 -150.00']);
});

test('OFX: lido duas vezes gera exatamente os mesmos ids', () => {
  const a = X.ler(OFX_SGML, 'extrato.ofx').transacoes.map(t => t.id);
  const b = X.ler(OFX_SGML, 'outro-nome.ofx').transacoes.map(t => t.id);
  igual(a, b);
  assert.equal(new Set(a).size, a.length, 'ids únicos');
});

test('OFX: dois arquivos sobrepostos com o mesmo FITID geram o mesmo id', () => {
  const b = OFX_SGML
    .replace(/<STMTTRN>\r\n<TRNTYPE>DEBIT\r\n<DTPOSTED>20261019[\s\S]*?(?=<STMTTRN>)/, '')
    + '';
  const extra = crlf(`<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261025120000[-3:BRT]
<TRNAMT>-80.00
<FITID>A0004
<MEMO>Compra no debito Farmacia Ficticia
`);
  const b2 = b.replace('</BANKTRANLIST>', extra + '</BANKTRANLIST>');
  const ra = X.ler(OFX_SGML, 'out.ofx'), rb = X.ler(b2, 'out-nov.ofx');
  assert.equal(rb.transacoes.length, 3);
  const idsA = new Map(ra.transacoes.map(t => [t.data + ' ' + t.valor, t.id]));
  for (const t of rb.transacoes) {
    if (idsA.has(t.data + ' ' + t.valor)) assert.equal(t.id, idsA.get(t.data + ' ' + t.valor), 'mesmo FITID → mesmo id');
  }
  const novo = rb.transacoes.find(t => t.valor === -80);
  assert.ok(![...idsA.values()].includes(novo.id));
});

test('OFX: TRNAMT com vírgula decimal ("-42,50", "1.234,56")', () => {
  const s = OFX_SGML.replace('<TRNAMT>-42.50', '<TRNAMT>-42,50').replace('<TRNAMT>5000.00', '<TRNAMT>1.234,56');
  const r = X.ler(s, 'extrato.ofx');
  igual(valores(r), [-42.5, 1234.56, -150]);
});

test('OFX: TRNAMT com sinal "+" explícito é positivo', () => {
  const r = X.ler(OFX_SGML.replace('<TRNAMT>5000.00', '<TRNAMT>+5000.00'), 'x.ofx');
  assert.equal(r.transacoes[1].valor, 5000);
});

test('OFX: DTPOSTED só com AAAAMMDD e com fração de segundos', () => {
  const s = OFX_SGML.replace('20261019120000[-3:BRT]', '20261019').replace('20261020000000[-03:EST]', '20261020101500.000[-3]');
  const r = X.ler(s, 'x.ofx');
  igual(r.transacoes.map(t => t.data), ['2026-10-19', '2026-10-20', '2026-10-21']);
});

test('OFX: FITID repetido dentro do mesmo arquivo não colapsa duas transações diferentes num id só', () => {
  const s = OFX_SGML.replace('<FITID>A0002', '<FITID>A0001').replace('<FITID>A0003', '<FITID>A0001');
  const ids = X.ler(s, 'x.ofx').transacoes.map(t => t.id);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids).size, 3);
});

const OFX_XML = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="220" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <CREDITCARDMSGSRSV1>
    <CCSTMTTRNRS>
      <TRNUID>1</TRNUID>
      <CCSTMTRS>
        <CURDEF>BRL</CURDEF>
        <CCACCTFROM><ACCTID>cc-ficticio-01</ACCTID></CCACCTFROM>
        <BANKTRANLIST>
          <DTSTART>20261001000000[-3:BRT]</DTSTART>
          <DTEND>20261031000000[-3:BRT]</DTEND>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20261019000000[-3:BRT]</DTPOSTED>
            <TRNAMT>-42.50</TRNAMT>
            <FITID>c-0001</FITID>
            <MEMO>Pão de Açúcar &amp; Cia</MEMO>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>CREDIT</TRNTYPE>
            <DTPOSTED>20261025000000[-3:BRT]</DTPOSTED>
            <TRNAMT>1250.00</TRNAMT>
            <FITID>c-0002</FITID>
            <MEMO>Pagamento recebido</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </CCSTMTRS>
    </CCSTMTTRNRS>
  </CREDITCARDMSGSRSV1>
</OFX>`;

test('OFX XML de cartão: conta cartao, sinais e entidade &amp; decodificada', () => {
  const r = X.ler(OFX_XML, 'fatura.ofx');
  formaValida(r);
  assert.equal(r.formato, 'ofx');
  assert.equal(r.conta, 'cartao');
  igual(linhas(r), ['2026-10-19 -42.50', '2026-10-25 1250.00']);
  assert.ok(r.transacoes[0].desc.includes('&') && !r.transacoes[0].desc.includes('&amp;'), r.transacoes[0].desc);
  assert.ok(r.transacoes[0].desc.includes('Açúcar'));
});

test('OFX windows-1252 inteiro: bytes → decodificar → ler mantém "Pão de Açúcar"', () => {
  const s = OFX_SGML.replace('Padaria Pao Quente', 'Pão de Açúcar São Paulo');
  const r = X.ler(X.decodificar(cp1252(s)), 'x.ofx');
  assert.ok(r.transacoes[0].desc.includes('Pão de Açúcar'), r.transacoes[0].desc);
});

/* ───────────────────────── CSV ───────────────────────── */

test('CSV ponto-e-vírgula, vírgula decimal e separador de milhar', () => {
  const csv = 'Data;Descrição;Valor\n19/10/2026;Loja Ficticia Eletro;-1.234,56\n20/10/2026;Salario Empresa Exemplo;12.345,67\n21/10/2026;Padaria Pao;-8,90\n';
  const r = X.ler(csv, 'extrato.csv');
  formaValida(r);
  assert.equal(r.formato, 'csv');
  igual(linhas(r), ['2026-10-19 -1234.56', '2026-10-20 12345.67', '2026-10-21 -8.90']);
});

test('CSV com campo entre aspas contendo o delimitador e aspas escapadas', () => {
  const csv = 'Data;Descrição;Valor\n19/10/2026;"Restaurante Sabor; Filial 2";-42,50\n20/10/2026;"Loja ""Exemplo"" Ltda";-10,00\n';
  const r = X.ler(csv, 'extrato.csv');
  igual(valores(r), [-42.5, -10]);
  assert.ok(r.transacoes[0].desc.includes('Filial 2'), r.transacoes[0].desc);
  assert.ok(r.transacoes[1].desc.includes('"Exemplo"'), r.transacoes[1].desc);
});

test('CSV vírgula com valores pt-BR entre aspas ("-42,50", "1.234,56")', () => {
  const csv = 'Data,Descrição,Valor\n19/10/2026,Mercado Exemplo,"-42,50"\n20/10/2026,Pix recebido Fulano,"1.234,56"\n';
  const r = X.ler(csv, 'extrato.csv');
  igual(valores(r), [-42.5, 1234.56]);
});

test('CSV vírgula com valores en-US entre aspas ("-1,234.56")', () => {
  const csv = 'Date,Description,Amount\n2026-10-19,Loja Ficticia,"-1,234.56"\n2026-10-20,Pix recebido Fulano,"2,000.00"\n';
  const r = X.ler(csv, 'extrato.csv');
  igual(valores(r), [-1234.56, 2000]);
});

test('CSV separado por TAB', () => {
  const csv = 'Data\tHistórico\tValor\n19/10/2026\tCompra Padaria Pao\t-12,50\n20/10/2026\tPix recebido Fulano\t300,00\n';
  const r = X.ler(csv, 'extrato.txt');
  assert.equal(r.formato, 'csv');
  igual(linhas(r), ['2026-10-19 -12.50', '2026-10-20 300.00']);
});

test('CSV com colunas separadas Débito/Crédito', () => {
  const csv = 'Data;Histórico;Débito;Crédito;Saldo\n19/10/2026;Compra Padaria Pao;42,50;;957,50\n20/10/2026;Pix recebido Fulano;;5.000,00;5.957,50\n21/10/2026;Tarifa pacote;-19,90;;5.937,60\n';
  const r = X.ler(csv, 'extrato.csv');
  igual(linhas(r), ['2026-10-19 -42.50', '2026-10-20 5000.00', '2026-10-21 -19.90']);
});

test('CSV com preâmbulo (dados da conta) antes do cabeçalho', () => {
  const csv = [
    'Banco Exemplo S.A.',
    'Cliente: Fulano Ficticio',
    'Agência: 0001;Conta: 12345-6',
    'Período: 01/10/2026 a 31/10/2026',
    '',
    'Data;Descrição;Valor;Saldo',
    '19/10/2026;Compra Padaria Pao;-12,50;987,50',
    '20/10/2026;Pix recebido Fulano;300,00;1.287,50',
  ].join('\n');
  const r = X.ler(csv, 'extrato.csv');
  assert.equal(r.formato, 'csv');
  igual(linhas(r), ['2026-10-19 -12.50', '2026-10-20 300.00']);
});

test('CSV com linhas de saldo anterior e total no fim são ignoradas', () => {
  const csv = [
    'Data;Descrição;Valor',
    '18/10/2026;Saldo anterior;1.000,00',
    '19/10/2026;Compra Padaria Pao;-12,50',
    '20/10/2026;Pix recebido Fulano;300,00',
    ';Total;287,50',
    'Total de lançamentos;;287,50',
    '31/10/2026;Saldo final;1.287,50',
  ].join('\n');
  const r = X.ler(csv, 'extrato.csv');
  igual(linhas(r), ['2026-10-19 -12.50', '2026-10-20 300.00']);
});

test('CSV com BOM + CRLF: sem \\r na descrição e cabeçalho reconhecido', () => {
  const csv = '﻿Data;Descrição;Valor\r\n19/10/2026;Compra Padaria Pao;-12,50\r\n20/10/2026;Pix recebido Fulano;300,00\r\n';
  const r = X.ler(X.decodificar(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(csv.slice(1))])), 'extrato.csv');
  formaValida(r);
  igual(linhas(r), ['2026-10-19 -12.50', '2026-10-20 300.00']);
});

test('CSV windows-1252 (cabeçalho "Descrição", "Pão de Açúcar") via decodificar', () => {
  const csv = 'Data;Descrição;Valor\r\n19/10/2026;Pão de Açúcar São Paulo;-99,90\r\n';
  const r = X.ler(X.decodificar(cp1252(csv)), 'extrato.csv');
  assert.equal(r.transacoes.length, 1);
  assert.equal(r.transacoes[0].valor, -99.9);
  assert.ok(r.transacoes[0].desc.includes('Pão de Açúcar'), r.transacoes[0].desc);
});

test('CSV com "R$" e sinal em posições diferentes no campo valor', () => {
  const csv = 'Data;Descrição;Valor\n19/10/2026;Loja A;R$ -10,00\n19/10/2026;Loja B;-R$ 20,00\n19/10/2026;Loja C;- R$ 30,00\n19/10/2026;Pix recebido Fulano;R$ 40,00\n';
  const r = X.ler(csv, 'extrato.csv');
  igual(valores(r), [-10, -20, -30, 40]);
});

const NUBANK_CARTAO = 'date,title,amount\n2026-10-19,Ifd*Restaurante Sabor,42.50\n2026-10-20,Loja Ficticia - Parcela 2/10,150.00\n2026-10-25,Pagamento recebido,-1250.00\n2026-10-26,Estorno Loja Ficticia,-19.90\n';

test('CSV Nubank cartão (date,title,amount): compras positivas viram negativas, pagamento vira positivo', () => {
  const r = X.ler(NUBANK_CARTAO, 'Nubank_2026-11-14.csv');
  formaValida(r);
  assert.equal(r.conta, 'cartao');
  igual(linhas(r), ['2026-10-19 -42.50', '2026-10-20 -150.00', '2026-10-25 1250.00', '2026-10-26 19.90']);
});

test('CSV Nubank cartão sem nome de arquivo também inverte sinais', () => {
  const r = X.ler(NUBANK_CARTAO);
  igual(valores(r), [-42.5, -150, 1250, 19.9]);
});

test('CSV Nubank cartão com CRLF + BOM continua invertendo sinais', () => {
  const r = X.ler(X.decodificar(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8(crlf(NUBANK_CARTAO))])), 'Nubank_2026-11-14.csv');
  igual(valores(r), [-42.5, -150, 1250, 19.9]);
});

test('CSV: parcela "Parcela 2/10" → parcela {k:2,n:10} e valor da parcela', () => {
  const t = X.ler(NUBANK_CARTAO, 'Nubank_2026-11-14.csv').transacoes[1];
  igual(t.parcela, { k: 2, n: 10 });
  assert.equal(t.valor, -150);
});

test('CSV: variantes de parcela "PARC 02/10" e "2 de 10"', () => {
  const csv = 'Data;Descrição;Valor\n19/10/2026;LOJA FICTICIA PARC 02/10;-50,00\n20/10/2026;Loja Exemplo 3 de 12;-30,00\n';
  const r = X.ler(csv, 'fatura.csv', { ano: 2026 });
  igual(r.transacoes[0].parcela, { k: 2, n: 10 });
  igual(r.transacoes[1].parcela, { k: 3, n: 12 });
});

test('CSV: desc limpa (trim, espaço único) e original preserva o texto bruto', () => {
  const csv = 'Data;Descrição;Valor\n19/10/2026;   Padaria    Pao   Quente  ;-12,50\n';
  const t = X.ler(csv, 'x.csv').transacoes[0];
  assert.ok(!/\s{2,}/.test(t.desc) && t.desc === t.desc.trim(), JSON.stringify(t.desc));
  assert.ok(/Padaria\s+Pao\s+Quente/i.test(t.original));
});

test('CSV: duas linhas idênticas no mesmo arquivo → ids distintos e estáveis', () => {
  const csv = 'Data;Descrição;Valor\n19/10/2026;Cafe Ficticio;-7,00\n19/10/2026;Cafe Ficticio;-7,00\n';
  const a = X.ler(csv, 'x.csv').transacoes.map(t => t.id);
  const b = X.ler(csv, 'x.csv').transacoes.map(t => t.id);
  assert.equal(a.length, 2);
  assert.notEqual(a[0], a[1]);
  igual(a, b);
});

test('CSV: arquivos sobrepostos da mesma origem → mesmas transações têm os mesmos ids', () => {
  const cab = 'Data;Descrição;Valor\n';
  const l1 = '05/10/2026;Padaria Pao Quente;-12,50\n';
  const l2 = '08/10/2026;Cafe Ficticio;-7,00\n08/10/2026;Cafe Ficticio;-7,00\n';
  const l3 = '12/10/2026;Pix recebido Fulano Ficticio;300,00\n';
  const a = X.ler(cab + l1 + l2, 'out-a.csv').transacoes;
  const b = X.ler(cab + l2 + l3, 'out-b.csv').transacoes;
  igual(b.slice(0, 2).map(t => t.id), a.slice(1, 3).map(t => t.id));
  assert.ok(!a.map(t => t.id).includes(b[2].id));
});

test('CSV: formatos de data dd/mm/aaaa, aaaa-mm-dd e dd/mm/aa → AAAA-MM-DD', () => {
  const csv = 'Data;Descrição;Valor\n19/10/2026;Loja A;-1,00\n2026-10-20;Loja B;-2,00\n21/10/26;Loja C;-3,00\n';
  igual(X.ler(csv, 'x.csv').transacoes.map(t => t.data), ['2026-10-19', '2026-10-20', '2026-10-21']);
});

/* ───────────────────────── texto (app / PDF) ───────────────────────── */

test('texto: "19/10 IFOOD *RESTAURANTE 42,50" em fatura → 2026-10-19, -42.50', () => {
  const r = X.lerTexto('19/10 IFOOD *RESTAURANTE 42,50', { ano: 2026, conta: 'cartao' });
  formaValida(r);
  assert.equal(r.formato, 'texto');
  igual(linhas(r), ['2026-10-19 -42.50']);
});

test('texto: "19 OUT iFood 42,50" e "02 NOV  NETFLIX.COM  55,90"', () => {
  const r = X.lerTexto('19 OUT iFood 42,50\n02 NOV  NETFLIX.COM  55,90', { ano: 2026, conta: 'cartao' });
  igual(linhas(r), ['2026-10-19 -42.50', '2026-11-02 -55.90']);
  assert.ok(!/\s{2,}/.test(r.transacoes[1].desc));
});

test('texto: "19/10/2026 Pix enviado Fulano -150,00" em conta corrente', () => {
  const r = X.lerTexto('19/10/2026 Pix enviado Fulano Ficticio -150,00', { conta: 'corrente' });
  igual(linhas(r), ['2026-10-19 -150.00']);
});

test('texto: linha Nubank "19 OUT Restaurante X - Parcela 2/3 R$ 66,67"', () => {
  const r = X.lerTexto('19 OUT Restaurante X - Parcela 2/3 R$ 66,67', { ano: 2026, conta: 'cartao' });
  igual(linhas(r), ['2026-10-19 -66.67']);
  igual(r.transacoes[0].parcela, { k: 2, n: 3 });
});

test('texto: "Uber *Trip R$ 23,90" sob um cabeçalho de dia', () => {
  const r = X.lerTexto('19 OUT 2026\nUber *Trip R$ 23,90\n', { conta: 'cartao' });
  igual(linhas(r), ['2026-10-19 -23.90']);
});

test('texto conta corrente: "R$" e "-" em posições diferentes', () => {
  const txt = [
    '19/10/2026 Compra Loja A -R$ 10,00',
    '19/10/2026 Compra Loja B R$ -20,00',
    '19/10/2026 Compra Loja C - R$ 30,00',
    '19/10/2026 Compra Loja D -R$1.040,00',
    '20/10/2026 Pix recebido Fulano Ficticio + R$ 500,00',
  ].join('\n');
  igual(valores(X.lerTexto(txt, { conta: 'corrente' })), [-10, -20, -30, -1040, 500]);
});

test('texto conta corrente: sinal de menos à direita ("150,00-")', () => {
  const r = X.lerTexto('19/10/2026 Compra Loja Ficticia 150,00-\n20/10/2026 Pix recebido Fulano 80,00', { conta: 'corrente' });
  igual(valores(r), [-150, 80]);
});

test('texto PDF de conta: coluna de saldo à direita não vira o valor', () => {
  const txt = [
    'Data Lançamento Valor Saldo',
    '19/10/2026 Compra Padaria Pao Quente -12,50 1.987,50',
    '20/10/2026 Pix recebido Fulano Ficticio 300,00 2.287,50',
  ].join('\n');
  igual(linhas(X.lerTexto(txt, { conta: 'corrente' })), ['2026-10-19 -12.50', '2026-10-20 300.00']);
});

test('texto: ignora cabeçalho/rodapé, Saldo, Total, Limite, Vencimento, Pagamento mínimo, paginação', () => {
  const txt = [
    'Banco Exemplo S.A. - Fatura do cartão',
    'Vencimento 10/11/2026',
    'Limite disponível R$ 3.000,00',
    'Total da fatura R$ 108,40',
    'Pagamento mínimo R$ 21,68',
    'Saldo anterior R$ 0,00',
    '19 OUT iFood 42,50',
    'Página 1 de 2',
    'Banco Exemplo S.A. - Fatura do cartão',
    '20 OUT Padaria Pao Quente 10,00',
    '21 OUT Loja Ficticia 55,90',
    'Total R$ 108,40',
    'Saldo R$ 108,40',
  ].join('\n');
  const r = X.lerTexto(txt, { conta: 'cartao' });
  igual(linhas(r), ['2026-10-19 -42.50', '2026-10-20 -10.00', '2026-10-21 -55.90']);
});

test('texto: CRLF não quebra o reconhecimento de linhas', () => {
  const r = X.lerTexto(crlf('19/10 IFOOD *RESTAURANTE 42,50\n20/10 Padaria Pao 10,00\n'), { ano: 2026, conta: 'cartao' });
  formaValida(r);
  igual(linhas(r), ['2026-10-19 -42.50', '2026-10-20 -10.00']);
});

test('texto: ano inferido de cabeçalho com ano (sem opcoes.ano)', () => {
  const txt = 'Extrato de 01/10/2025 a 31/10/2025\n19/10 Compra Padaria Pao -12,50\n';
  igual(X.lerTexto(txt, { conta: 'corrente' }).transacoes.map(t => t.data), ['2025-10-19']);
});

test('texto: fatura dezembro→janeiro com cabeçalho de vencimento em 2027', () => {
  const txt = [
    'Fatura com vencimento em 10/01/2027',
    '20 DEZ Loja Ficticia 100,00',
    '28 DEZ Restaurante Exemplo 50,00',
    '03 JAN Padaria Pao 10,00',
  ].join('\n');
  const r = X.lerTexto(txt, { conta: 'cartao' });
  igual(r.transacoes.map(t => t.data), ['2026-12-20', '2026-12-28', '2027-01-03']);
});

test('texto: fatura de janeiro com opcoes.ano=2027 — compras de dezembro ficam em 2026', () => {
  const txt = '20/12 Loja Ficticia 100,00\n03/01 Padaria Pao 10,00\n';
  const r = X.lerTexto(txt, { ano: 2027, conta: 'cartao' });
  igual(r.transacoes.map(t => t.data), ['2026-12-20', '2027-01-03']);
});

test('texto: mesmo texto lido duas vezes → mesmos ids; linhas idênticas → ids distintos', () => {
  const txt = '19/10 Cafe Ficticio 7,00\n19/10 Cafe Ficticio 7,00\n20/10 Padaria Pao 10,00\n';
  const a = X.lerTexto(txt, { ano: 2026, conta: 'cartao' }).transacoes.map(t => t.id);
  const b = X.lerTexto(txt, { ano: 2026, conta: 'cartao' }).transacoes.map(t => t.id);
  igual(a, b);
  assert.equal(new Set(a).size, 3);
});

/* ───────────────────────── vazio / lixo ───────────────────────── */

test('arquivo vazio / só espaços: não lança e devolve 0 transações', () => {
  for (const s of ['', '   ', '\r\n\r\n', '﻿']) {
    let r; assert.doesNotThrow(() => { r = X.ler(s, 'vazio.csv'); });
    formaValida(r); assert.equal(r.transacoes.length, 0);
    assert.doesNotThrow(() => { r = X.lerTexto(s); });
    formaValida(r); assert.equal(r.transacoes.length, 0);
  }
});

test('lixo: binário decodificado, texto aleatório, HTML, JSON → não lança, 0 transações', () => {
  const bin = new Uint8Array(2048); for (let i = 0; i < bin.length; i++) bin[i] = (i * 197 + 13) & 255;
  const entradas = [
    X.decodificar(bin),
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit.\nSed do eiusmod tempor.',
    '<html><body><h1>Erro 404</h1></body></html>',
    '{"transactions":[{"a":1}]}',
    '%PDF-1.7\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog >>\nendobj\n',
  ];
  for (const s of entradas) {
    let r; assert.doesNotThrow(() => { r = X.ler(s, 'lixo.bin'); });
    formaValida(r);
    assert.equal(r.transacoes.length, 0, JSON.stringify(s.slice(0, 40)));
  }
});

test('OFX truncado no meio de uma transação: não lança e não inventa valores', () => {
  const cortado = OFX_SGML.slice(0, OFX_SGML.indexOf('<FITID>A0003') - 30);
  let r; assert.doesNotThrow(() => { r = X.ler(cortado, 'x.ofx'); });
  formaValida(r);
  for (const t of r.transacoes) assert.ok([-42.5, 5000, -150].includes(t.valor), String(t.valor));
});

test('CSV só com cabeçalho: não lança e devolve 0 transações', () => {
  const r = X.ler('Data;Descrição;Valor\n', 'x.csv');
  formaValida(r);
  assert.equal(r.transacoes.length, 0);
});

test('CSV com data inválida (31/02) não gera data impossível', () => {
  const r = X.ler('Data;Descrição;Valor\n31/02/2026;Loja Ficticia;-10,00\n19/10/2026;Padaria Pao;-5,00\n', 'x.csv');
  formaValida(r);
  assert.ok(r.transacoes.every(t => t.data !== '2026-02-31'));
});

test('texto: parcela no formato "2 de 10" em linha de fatura', () => {
  const r = X.lerTexto('19/10 Loja Ficticia 2 de 10 30,00', { ano: 2026, conta: 'cartao' });
  igual(linhas(r), ['2026-10-19 -30.00']);
  igual(r.transacoes[0].parcela, { k: 2, n: 10 });
});
