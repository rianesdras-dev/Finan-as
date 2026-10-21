// Testes das partes puras de app/comprovantes.js (CRC-32, ZIP, leitura de valor/data/nomes, sugerir).
// Todos os comprovantes abaixo são INVENTADOS (nomes, CPFs, valores e códigos sintéticos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

function carregar() {
  const ctx = { TextDecoder, TextEncoder, Uint8Array, Uint32Array, ArrayBuffer, DataView, console, Date, Math, JSON, Intl, setTimeout };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../app/comprovantes.js', import.meta.url), 'utf8'), ctx, { filename: 'comprovantes.js' });
  return ctx.Comprovantes;
}
const C = carregar();
const enc = new TextEncoder();

/* ── CRC-32 ── */

test('crc32: vetores conhecidos', () => {
  assert.equal(C._crc32(enc.encode('123456789')), 0xCBF43926);
  assert.equal(C._crc32(new Uint8Array(0)), 0);
  assert.equal(C._crc32(enc.encode('a')), 0xE8B7BE43);
  assert.equal(C._crc32(enc.encode('The quick brown fox jumps over the lazy dog')), 0x414FA339);
});

/* ── ZIP conferido pelo zipfile do Python ── */

test('zip: o Python abre, confere CRC e lê nomes UTF-8 e conteúdo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zip-teste-'));
  try {
    const binario = new Uint8Array(3000).map((_, i) => (i * 37) & 255);
    const entradas = [
      { nome: '2025-03/Conta-de-luz_2025-03-10.txt', bytes: enc.encode('olá, comprovante\n'), data: new Date(2025, 2, 10, 14, 30, 22) },
      { nome: '2025-03/Condomínio_São-João_2025-03-05.bin', bytes: binario },
      { nome: 'vazio.txt', bytes: new Uint8Array(0) },
      { nome: 'comprovantes.csv', bytes: enc.encode('mes;ref\n2025-03;c7\n') },
    ];
    const z = C._zip(entradas);
    const arq = join(dir, 't.zip');
    writeFileSync(arq, z);
    execFileSync('python3', ['-I', '-m', 'zipfile', '-t', arq]);
    const py = `
import zipfile, sys, json, zlib
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
out = []
for i in z.infolist():
    d = z.read(i)
    out.append({"nome": i.filename, "tam": len(d), "crc": zlib.crc32(d), "metodo": i.compress_type, "utf8": bool(i.flag_bits & 0x800), "data": list(i.date_time)})
print(json.dumps(out))`;
    const info = JSON.parse(execFileSync('python3', ['-I', '-c', py, arq]).toString());
    assert.deepEqual(info.map(i => i.nome), entradas.map(e => e.nome));
    assert.deepEqual(info.map(i => i.tam), entradas.map(e => e.bytes.length));
    assert.ok(info.every(i => i.metodo === 0 && i.utf8));
    info.forEach((i, k) => assert.equal(i.crc, C._crc32(entradas[k].bytes)));
    assert.deepEqual(info[0].data, [2025, 3, 10, 14, 30, 22]);
    // conteúdo extraído byte a byte
    const conteudo = execFileSync('python3', ['-I', '-c', 'import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))', arq, entradas[1].nome]);
    assert.deepEqual(new Uint8Array(conteudo), binario);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('zip: lista vazia vira um ZIP válido (só o fim do diretório)', () => {
  const z = C._zip([]);
  assert.equal(z.length, 22);
  assert.equal(new DataView(z.buffer).getUint32(0, true), 0x06054b50);
});

test('zip: entrada inválida lança erro em português', () => {
  assert.throws(() => C._zip([{ nome: '', bytes: new Uint8Array(1) }]), /inválido/);
  assert.throws(() => C._zip('x'), /inválida/);
});

/* ── comprovantes sintéticos ── */

const CASOS = [
  {
    banco: 'Nubank Pix', ano: 2025,
    texto: `Comprovante de transferência
14 MAR 2025 - 09:41:07
Valor R$ 1.250,00
Tipo de transferência Pix
Destino
Nome Maria Aparecida Teste
CPF •••.123.456-••
Instituição BANCO INTER S.A.
Agência 0001
Conta 1234567-8
Origem
Nome João Exemplo Silva
Instituição NU PAGAMENTOS - IP
Saldo disponível R$ 3.402,11`,
    valor: 1250, data: '2025-03-14', nomes: ['Maria Aparecida Teste'],
  },
  {
    banco: 'Inter Pix',
    texto: `Pix enviado
R$ 89,90
Data e hora
Sexta, 07/02/2025 às 18:22
Quem recebeu
Nome: LOJA FICTICIA COMERCIO LTDA
CNPJ: 12.345.678/0001-90
Instituição: PAGSEGURO INTERNET IP S.A.
Quem pagou
Nome: João Exemplo Silva
ID da transação: E00416968202502071822abcdEFGH`,
    valor: 89.9, data: '2025-02-07', nomes: ['Loja Ficticia Comercio Ltda'],
  },
  {
    banco: 'Itaú boleto',
    texto: `Comprovante de pagamento de boleto
Beneficiário: ENERGIA FICTICIA DISTRIBUIDORA S.A.
CNPJ: 11.222.333/0001-44
Data de vencimento: 10/03/2025
Valor do documento: R$ 312,45
(-) Desconto: R$ 0,00
(+) Juros/Multa: R$ 6,25
(=) Valor pago: R$ 318,70
Data do pagamento: 12/03/2025
Autenticação mecânica: A1B2.C3D4.E5F6`,
    valor: 318.7, data: '2025-03-12', nomes: ['Energia Ficticia Distribuidora S.A.'],
  },
  {
    banco: 'Bradesco Pix',
    texto: `BRADESCO
Comprovante de Transação Pix
Data: 03/01/2025 - 11:05:33
Valor: R$ 2.000,00
Tarifa: 0,00
Dados de quem recebeu
Favorecido: CLINICA EXEMPLO SAUDE LTDA
CPF/CNPJ: 98.765.432/0001-10
Instituição: ITAU UNIBANCO S.A.
Dados de quem pagou
Nome: JOAO EXEMPLO SILVA`,
    valor: 2000, data: '2025-01-03', nomes: ['Clinica Exemplo Saude Ltda'],
  },
  {
    banco: 'Banco do Brasil boleto',
    texto: `BANCO DO BRASIL
COMPROVANTE DE PAGAMENTO DE TITULOS
CLIENTE: JOAO E SILVA
AGENCIA: 1234-5 CONTA: 98765-4
=========================================
BENEFICIARIO:
CONDOMINIO RESIDENCIAL FICTICIO
NOME FANTASIA:
CNPJ: 01.234.567/0001-89
DATA DE VENCIMENTO 05/04/2025
DATA DO PAGAMENTO 04/04/2025
VALOR DO DOCUMENTO 850,00
VALOR COBRADO 850,00
=========================================
NR.AUTENTICACAO 9.ABC.DEF.123.456.789`,
    valor: 850, data: '2025-04-04', nomes: ['Condominio Residencial Ficticio'],
  },
  {
    banco: 'Caixa Pix',
    texto: `CAIXA
Comprovante de Pix
Dados do recebedor
Recebedor: ACADEMIA FICTICIA FITNESS
Chave: academia@example.com
Valor: R$ 129,00
Data/Hora: 15/05/2025 07:12
Saldo após a transação: R$ 4.870,55
Código da operação: 11223344`,
    valor: 129, data: '2025-05-15', nomes: ['Academia Ficticia Fitness'],
  },
  {
    banco: 'C6 Pix',
    texto: `C6 BANK
Comprovante
Pix enviado
Valor
R$ 45,50
Para
Padaria Pão Quente Teste
CPF ***.987.654-**
Data da transferência
21/06/2025, 08:03
ID da transação E3141234202506210803`,
    valor: 45.5, data: '2025-06-21', nomes: ['Padaria Pão Quente Teste'],
  },
  {
    banco: 'PicPay Pix',
    texto: `PicPay
Comprovante de Pix
Você pagou
R$ 37,80
Para: Ana Beatriz Teste
Instituição: Nu Pagamentos S.A.
De: João Exemplo
Realizado em 02 de julho de 2025 às 19:44
Limite Pix disponível: R$ 5.000,00`,
    valor: 37.8, data: '2025-07-02', nomes: ['Ana Beatriz Teste'],
  },
  {
    banco: 'Mercado Pago Pix',
    texto: `Mercado Pago
Comprovante de transferência
Sábado, 9 de agosto de 2025, às 12:10
$
R$ 250
Motivo: aluguel garagem
De
João Exemplo Silva
CPF: ***.111.222-**
Para
Carlos Eduardo Teste
CPF: ***.333.444-**
Mercado Pago IP Ltda.
Número da transação 99887766554`,
    valor: 250, data: '2025-08-09', nomes: ['Carlos Eduardo Teste'],
  },
  {
    banco: 'Mercado Pago boleto',
    texto: `Pagamento aprovado
Boleto pago
Beneficiário
OPERADORA FICTICIA DE INTERNET LTDA
Vencimento 15/08/2025
Valor pago R$ 119,90
Pago em 14/08/2025
Código de barras 34191.79001 01043.510047 91020.150008 1 97890000011990`,
    valor: 119.9, data: '2025-08-14', nomes: ['Operadora Ficticia de Internet Ltda'],
  },
  {
    banco: 'DAS (Receita Federal)',
    texto: `Documento de Arrecadação do Simples Nacional
Comprovante de Pagamento
CNPJ: 55.666.777/0001-88
Razão Social: JOAO EXEMPLO SILVA SERVICOS MEDICOS LTDA
Período de Apuração: Fevereiro/2025
Data de Vencimento: 20/03/2025
Principal 640,50
Multa 0,00
Juros 0,00
Valor Total 640,50
Pago em: 18/03/2025
Banco arrecadador: 001`,
    valor: 640.5, data: '2025-03-18', nomes: ['Joao Exemplo Silva Servicos Medicos Ltda', 'DAS'],
  },
  {
    banco: 'Nubank pagamento de fatura',
    texto: `Pagamento de fatura
Você pagou R$ 3.871,22 da fatura do seu cartão
Data do pagamento 06 SET 2025
Forma de pagamento Saldo em conta
Limite disponível após pagamento R$ 7.500,00`,
    valor: 3871.22, data: '2025-09-06', nomes: ['Fatura'],
  },
  {
    banco: 'Itaú pagamento de fatura',
    texto: `Itaú
comprovante de pagamento
pagamento de fatura de cartão de crédito
cartão final 4321
valor da fatura: R$ 5.102,80
valor pago: R$ 2.000,00
data: 10/09/2025
saldo restante da fatura: R$ 3.102,80`,
    valor: 2000, data: '2025-09-10', nomes: ['Fatura'],
  },
  {
    banco: 'Inter boleto',
    texto: `Banco Inter
Comprovante de pagamento
Pagamento de boleto
Valor
R$ 1.980,00
Data do pagamento
01/10/2025
Beneficiário
Nome Escola Ficticia de Idiomas
CNPJ 22.333.444/0001-55
Pagador
Nome João Exemplo Silva`,
    valor: 1980, data: '2025-10-01', nomes: ['Escola Ficticia de Idiomas'],
  },
  {
    banco: 'Santander Pix (data sem ano)', ano: 2025,
    texto: `Santander
Pix realizado com sucesso!
Valor da transferência
R$ 72,00
Data
23/10 às 13:15
Para
Lavanderia Teste Ltda
CNPJ 33.444.555/0001-66`,
    valor: 72, data: '2025-10-23', nomes: ['Lavanderia Teste Ltda'],
  },
  {
    banco: 'BB Pix com tarifa e saldo antes',
    texto: `BB
Saldo anterior: R$ 10.000,00
Comprovante Pix
Pagamento efetuado em 30.11.2025
Valor: R$ 1.500,00
Tarifa: R$ 0,00
Favorecido: PROPRIETARIO FICTICIO DE IMOVEIS
Chave Pix: +55 11 90000-0000`,
    valor: 1500, data: '2025-11-30', nomes: ['Proprietario Ficticio de Imoveis'],
  },
  {
    banco: 'Bradesco boleto (rótulos em linhas separadas)',
    texto: `Bradesco
Comprovante de Pagamento
Beneficiário Final
UNIVERSIDADE FICTICIA S/A
Data de Vencimento
05/12/2025
Valor
R$ 2.345,67
Desconto
R$ 100,00
Valor Pago
R$ 2.245,67
Data do Pagamento
04/12/2025`,
    valor: 2245.67, data: '2025-12-04', nomes: ['Universidade Ficticia S/A'],
  },
];

for (const caso of CASOS) {
  test(`comprovante ${caso.banco}: valor, data e nomes`, () => {
    assert.equal(C._achaValor(caso.texto), caso.valor, 'valor');
    assert.equal(C._achaData(caso.texto, caso.ano || 2025), caso.data, 'data');
    const nomes = C._achaNomes(caso.texto);
    for (const n of caso.nomes) assert.ok(nomes.includes(n), `nomes ${JSON.stringify(nomes)} deveria ter ${n}`);
    assert.ok(!nomes.some(n => /joão exemplo|joao exemplo silva$/i.test(n)), `não deve pegar o pagador: ${JSON.stringify(nomes)}`);
  });
}

test('achaValor: casos de borda', () => {
  assert.equal(C._achaValor(''), null);
  assert.equal(C._achaValor(null), null);
  assert.equal(C._achaValor('Saldo: R$ 100,00\nLimite: R$ 2.000,00'), null);
  assert.equal(C._achaValor('Compra aprovada R$ 12,34 em 3x'), 12.34);
  assert.equal(C._achaValor('Tarifa: 0,00\nTotal: 99,99'), 99.99);
  assert.equal(C._achaValor('Juros: 5%\nValor: R$ 10.000,00'), 10000);
});

test('achaData: formatos e datas a ignorar', () => {
  assert.equal(C._achaData('Pago em 5 de março de 2024'), '2024-03-05');
  assert.equal(C._achaData('data 2024-02-29'), '2024-02-29');
  assert.equal(C._achaData('data 30/02/2024'), null);
  assert.equal(C._achaData('Vencimento: 10/01/2025'), null);
  assert.equal(C._achaData('Data: 01/02/25'), '2025-02-01');
  assert.equal(C._achaData('Data 15/03', 2026), '2026-03-15');
  assert.equal(C._achaData('Data 15/03'), null);   // sem ano e sem ano padrão
  assert.equal(C._achaData(''), null);
});

test('achaNomes: "Para dúvidas..." não é nome; nada no texto -> []', () => {
  assert.deepEqual([...C._achaNomes('Para dúvidas, ligue 0800 000 0000')], []);
  assert.deepEqual([...C._achaNomes('')], []);
});

/* ── sugerir ── */

test('sugerir: valor igual vem primeiro; nome e data desempatam; nada plausível -> []', () => {
  const contas = [
    { ref: 'c1', nome: 'Aluguel', v: 1500, mes: '2025-11', dia: 30 },
    { ref: 'c2', nome: 'Luz - Energia Ficticia', v: 318.7, mes: '2025-03', dia: 10 },
    { ref: 'c3', nome: 'Internet', v: 119.9, mes: '2025-03', dia: 15 },
    { ref: 'c4', nome: 'Água', v: 318.7, mes: '2025-02', dia: 10 },
    { ref: 'fatura', nome: 'Fatura do cartão', v: 3871.22, mes: '2025-09', dia: 7 },
  ];
  const info = { valor: 318.7, data: '2025-03-12', nomes: ['Energia Ficticia Distribuidora S.A.'] };
  const s = C.sugerir(info, contas);
  assert.equal(s[0].ref, 'c2');
  assert.equal(s[1].ref, 'c4');
  assert.ok(!s.some(x => x.ref === 'c3'));
  assert.ok(s[0].pontos > s[1].pontos);

  const f = C.sugerir({ valor: 3871.22, data: '2025-09-06', nomes: ['Fatura'] }, contas);
  assert.equal(f[0].ref, 'fatura');

  // só o nome bate (valor diferente: pagou com juros)
  const n = C.sugerir({ valor: 130, data: null, nomes: ['Internet Fibra'] }, contas);
  assert.deepEqual([...n.map(x => x.ref)], ['c3']);

  assert.deepEqual([...C.sugerir({ valor: 7, data: '2025-03-12', nomes: [] }, contas)], []);
  assert.deepEqual([...C.sugerir(null, contas)], []);
  assert.deepEqual([...C.sugerir(info, null)], []);
});
