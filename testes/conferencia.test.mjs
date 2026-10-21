// Testes da conferência da fatura do cartão (app/conferencia.js).
// Rodar: node --test testes/
// extrato.js e conferencia.js rodam no MESMO contexto, como na página: classificar/chave são os de verdade.
// Todos os dados são inventados (lojas, valores, datas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function carregarScripts(arquivos) {
  const ctx = { TextDecoder, Uint8Array, ArrayBuffer, console, Date, Math, JSON, Intl };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of arquivos) vm.runInContext(readFileSync(new URL('../app/' + f, import.meta.url), 'utf8'), ctx, { filename: f });
  return ctx;
}
const ctx = carregarScripts(['extrato.js', 'conferencia.js']);
const X = ctx.Extrato, C = ctx.Conferencia;

// objetos criados dentro do vm têm outro protótipo: compara pela forma JSON
const plano = x => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const igual = (a, b, msg) => assert.deepEqual(plano(a), plano(b), msg);
const dir = new URL('./fixtures/', import.meta.url);
const textoDe = nome => X.decodificar(readFileSync(new URL(nome, dir)));

// Fatura no formato do CSV do Nubank: compra positiva, pagamento/estorno negativo.
function fatura(...linhas) {
  const r = X.ler('date,title,amount\n' + linhas.join('\n') + '\n', 'Nubank_2026-11-14.csv', { ano: 2026 });
  assert.equal(r.conta, 'cartao');
  return r.transacoes;
}
function conferir(transacoes, extra) {
  return C.conferir(Object.assign({ transacoes, classificar: t => X.classificar(t, {}), chave: X.chave,
    esperados: [], lancados: [] }, extra || {}));
}
// resumos legíveis de cada grupo
const descs = l => plano(l.map(o => o.t.desc));
const nomes = l => plano(l.map(o => o.esperado.nome));
const GRUPOS = ['batem', 'valorMudou', 'faltando', 'lancadosAchados', 'lancadosFaltando', 'naoReconhecidos', 'duplicadas',
  'taxas', 'assinaturasNovas', 'parcelasNovas', 'creditos', 'pagamentos'];

// Cada cobrança cai em no máximo um grupo de decisão; se em nenhum, é taxa. Cada crédito é crédito ou pagamento.
function conferirInvariantes(R, transacoes) {
  const decisao = new Map();
  const conta = id => decisao.set(id, (decisao.get(id) || 0) + 1);
  ['batem', 'valorMudou', 'lancadosAchados', 'assinaturasNovas', 'parcelasNovas', 'naoReconhecidos'].forEach(g => R[g].forEach(o => conta(o.t.id)));
  R.duplicadas.forEach(o => conta(o.b.id));
  const taxas = new Set(R.taxas.map(o => o.t.id));
  const creditos = new Set(R.creditos.map(o => o.t.id)), pagos = new Set(R.pagamentos.map(o => o.t.id));
  transacoes.forEach(t => {
    if (t.valor < 0) {
      const n = decisao.get(t.id) || 0;
      assert.ok(n <= 1, 'cobrança em mais de um grupo: ' + t.desc);
      if (!n) assert.ok(taxas.has(t.id) || R.duplicadas.some(d => d.a.id === t.id), 'cobrança sem grupo: ' + t.desc);
    } else assert.ok(creditos.has(t.id) !== pagos.has(t.id), 'crédito sem grupo: ' + t.desc);
  });
  const p = R.valorMudou.length + R.faltando.length + R.naoReconhecidos.length + R.duplicadas.length +
    R.assinaturasNovas.length + R.parcelasNovas.length + (R.diferencaTotal != null && Math.abs(R.diferencaTotal) > 1 ? 1 : 0);
  assert.equal(R.pendencias, p, 'pendencias');
}

/* ───────────── uma fatura completa ───────────── */

const FATURA_OUT = [
  '2026-10-02,Spotify,23.90',
  '2026-10-03,Netflix.com,44.90',
  '2026-10-05,Claude.ai Subscription,110.00',
  '2026-10-06,Apple.com/bill,14.90',
  '2026-10-07,Microsoft*Xbox,59.00',
  '2026-10-08,Loja Exemplo - Parcela 3/6,66.67',
  '2026-10-10,Ifd*Restaurante Sabor,42.50',
  '2026-10-11,Padaria Pao Quente,12.00',
  '2026-10-12,Uber *Trip,23.90',
  '2026-10-14,Amazon Marketplace,89.90',
  '2026-10-14,Amazon Marketplace,89.90',
  '2026-10-15,Openai *Chatgpt Subscr,105.00',
  '2026-10-15,"IOF de ""Openai *Chatgpt Subscr""",3.67',
  '2026-10-18,Drogasil - Parcela 1/3,40.00',
  '2026-10-20,Anuidade 3/12,35.00',
  '2026-10-25,Pagamento recebido,-1250.00',
  '2026-10-26,Estorno Loja Teste,-19.90',
  '2026-10-27,Paramount+,29.90'
];
const ESPERADOS_OUT = [
  { id: 'e1', nome: 'Spotify', v: 21.90, tipo: 'assinatura' },
  { id: 'e2', nome: 'Netflix', v: 44.90, tipo: 'assinatura' },
  { id: 'e3', nome: 'Claude', v: 110, tipo: 'assinatura' },
  { id: 'e4', nome: 'iCloud', v: 14.90, tipo: 'assinatura' },
  { id: 'e5', nome: 'Game Pass', v: 59, tipo: 'assinatura' },
  { id: 'e6', nome: 'Loja Exemplo', v: 66.67, tipo: 'parcela', k: 2, n: 6 },
  { id: 'e7', nome: 'Notebook', v: 350, tipo: 'parcela', k: 4, n: 10 },
  { id: 'e8', nome: 'Streaming de filmes', v: 29.90, tipo: 'assinatura' }
];
const LANCADOS_OUT = [
  { id: 'l1', d: '2026-10-09', v: 42.5, t: 'ifood' },
  { id: 'l2', d: '2026-10-20', v: 23.9, t: 'Uber' }   // 8 dias depois da corrida: não é ela
];

test('fatura completa: cada cobrança vai para o grupo certo', () => {
  const T = fatura(...FATURA_OUT);
  const R = conferir(T, { esperados: ESPERADOS_OUT, lancados: LANCADOS_OUT, totalImpresso: 900 });
  igual(R.batem.map(b => [b.t.desc, b.esperado.nome, b.nota || '']), [
    ['Netflix.com', 'Netflix', ''],
    ['Claude.ai Subscription', 'Claude', ''],
    ['Apple.com/bill', 'iCloud', ''],
    ['Microsoft*Xbox', 'Game Pass', ''],
    ['Loja Exemplo - Parcela 3/6', 'Loja Exemplo', 'parcela 3/6 na fatura, esperado 2/6'],
    ['Paramount+', 'Streaming de filmes', 'casado pelo valor']]);
  igual(R.valorMudou.map(m => [m.t.desc, m.esperado.nome, m.diferenca]), [['Spotify', 'Spotify', 2]]);
  igual(nomes(R.faltando), ['Notebook']);
  igual(R.lancadosAchados.map(l => [l.t.desc, l.lancado.id]), [['Ifd*Restaurante Sabor', 'l1']]);
  igual(R.lancadosFaltando.map(l => l.lancado.id), ['l2']);
  igual(descs(R.naoReconhecidos), ['Padaria Pao Quente', 'Uber *Trip', 'Amazon Marketplace']);
  igual(R.naoReconhecidos.map(o => o.c.cat), ['diaria', 'transp', 'compras']);
  igual(R.duplicadas.map(d => [d.a.desc, d.b.desc, d.a.id !== d.b.id]), [['Amazon Marketplace', 'Amazon Marketplace', true]]);
  igual(R.taxas.map(o => [o.t.desc, o.tipo, o.de ? o.de.desc : null]), [
    ['IOF de "Openai *Chatgpt Subscr"', 'iof', 'Openai *Chatgpt Subscr'], ['Anuidade 3/12', 'anuidade', null]]);
  assert.equal(R.totalTaxas, 38.67);
  igual(descs(R.assinaturasNovas), ['Openai *Chatgpt Subscr']);
  igual(descs(R.parcelasNovas), ['Drogasil - Parcela 1/3']);
  igual(descs(R.creditos), ['Estorno Loja Teste']);
  igual(descs(R.pagamentos), ['Pagamento recebido']);
  // 791,14 em compras - 19,90 de estorno; o pagamento de 1.250,00 fica de fora
  assert.equal(R.totalCalculado, 771.24);
  assert.equal(R.totalImpresso, 900);
  assert.equal(R.diferencaTotal, 128.76);
  assert.equal(R.esperadoTotal, 763.67);
  // 1 valor mudou + 1 faltando + 3 não reconhecidas + 1 duplicada + 1 assinatura + 1 parcela + total que não bate
  assert.equal(R.pendencias, 9);
  igual(R.avisos, []);
  conferirInvariantes(R, T);
});

test('ordem das listas não muda o resultado', () => {
  const T = fatura(...FATURA_OUT);
  const resumo = R => plano(Object.fromEntries(GRUPOS.map(g => [g, R[g].map(o =>
    [o.t && o.t.id, o.a && o.a.id, o.b && o.b.id, o.esperado && o.esperado.id, o.lancado && o.lancado.id, o.nota, o.tipo, o.de && o.de.id].join('|'))])));
  const base = conferir(T, { esperados: ESPERADOS_OUT, lancados: LANCADOS_OUT });
  // embaralhador determinístico (sem Math.random: o teste tem de ser repetível)
  let semente = 7;
  const sorteio = () => (semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648;
  const embaralhar = a => a.map(x => [sorteio(), x]).sort((p, q) => p[0] - q[0]).map(p => p[1]);
  for (let i = 0; i < 8; i++) {
    const R = conferir(embaralhar(T), { esperados: embaralhar(ESPERADOS_OUT), lancados: embaralhar(LANCADOS_OUT) });
    igual(resumo(R), resumo(base), 'rodada ' + i);
    assert.equal(R.totalCalculado, base.totalCalculado);
    assert.equal(R.pendencias, base.pendencias);
  }
  // e duas chamadas iguais dão o mesmo relatório
  igual(conferir(T, { esperados: ESPERADOS_OUT, lancados: LANCADOS_OUT }), base);
});

/* ───────────── assinaturas ───────────── */

test('assinatura: aumento de preço vira valorMudou; dentro da tolerância, bate', () => {
  const esp = [{ id: 's', nome: 'Spotify', v: 21.90, tipo: 'assinatura' }];
  let R = conferir(fatura('2026-10-02,Spotify P2A1B2C3,23.90'), { esperados: esp });
  igual(R.valorMudou.map(m => [m.esperado.id, m.diferenca]), [['s', 2]]);
  assert.equal(R.batem.length, 0);
  assert.equal(R.faltando.length, 0);
  assert.equal(R.assinaturasNovas.length, 0);
  assert.equal(R.pendencias, 1);
  // ficou mais barato também é valorMudou (diferença negativa)
  R = conferir(fatura('2026-10-02,Spotify,19.90'), { esperados: esp });
  igual(R.valorMudou.map(m => m.diferenca), [-2]);
  // 3% de 21,90 = 0,657: 22,40 ainda é o mesmo valor
  R = conferir(fatura('2026-10-02,Spotify,22.40'), { esperados: esp });
  igual(nomes(R.batem), ['Spotify']);
  assert.equal(R.pendencias, 0);
  // tolerância 0 ainda aceita R$ 0,50
  R = conferir(fatura('2026-10-02,Spotify,22.30'), { esperados: esp, tolerancia: 0 });
  igual(nomes(R.batem), ['Spotify']);
  R = conferir(fatura('2026-10-02,Spotify,22.50'), { esperados: esp, tolerancia: 0 });
  igual(nomes(R.valorMudou), ['Spotify']);
  // preço que mais que dobrou (fim de promoção) já não é "o mesmo item": falta + assinatura nova
  R = conferir(fatura('2026-10-02,Spotify,49.90'), { esperados: [{ id: 's', nome: 'Spotify', v: 1.99, tipo: 'assinatura' }] });
  igual(nomes(R.faltando), ['Spotify']);
  igual(descs(R.assinaturasNovas), ['Spotify']);
});

test('assinatura: nomes diferentes do mesmo serviço (iCloud x APPLE.COM/BILL, Game Pass x XBOX, Claude)', () => {
  const T = fatura('2026-10-05,APPLE.COM/BILL,4.90', '2026-10-05,Apple.com/bill,14.90', '2026-10-07,MICROSOFT*XBOX,59.99',
    '2026-10-09,CLAUDE.AI SUBSCRIPTION,110.00', '2026-10-10,Google *YouTube Premium,24.90', '2026-10-11,DL*SPOTIFYBR,21.90');
  const R = conferir(T, { esperados: [
    { id: 'a', nome: 'iCloud 50 GB', v: 4.90, tipo: 'assinatura' },
    { id: 'b', nome: 'Apple Music', v: 14.90, tipo: 'assinatura' },
    { id: 'c', nome: 'Game Pass', v: 59.99, tipo: 'assinatura' },
    { id: 'd', nome: 'Claude', v: 110, tipo: 'assinatura' },
    { id: 'e', nome: 'YouTube', v: 24.90, tipo: 'assinatura' },
    { id: 'f', nome: 'Spotify', v: 21.90, tipo: 'assinatura' }] });
  igual(R.batem.map(b => [b.t.valor, b.esperado.id, b.nota || '']).sort(), [
    [-110, 'd', ''], [-14.9, 'b', ''], [-21.9, 'f', ''], [-24.9, 'e', ''], [-4.9, 'a', ''], [-59.99, 'c', '']]);
  assert.equal(R.pendencias, 0);
  conferirInvariantes(R, T);
});

test('assinatura: casar só pelo valor exige cobrança de assinatura e perde para o nome', () => {
  // 'Paramount+' é assinatura (dicionário) e o nome no plano é outro: casa pelo valor, com nota
  let R = conferir(fatura('2026-10-03,Paramount+,29.90'), { esperados: [{ id: 'x', nome: 'Streaming do namorado', v: 29.90, tipo: 'assinatura' }] });
  igual(R.batem.map(b => b.nota), ['casado pelo valor']);
  // compra comum com o mesmo valor não casa pelo valor
  R = conferir(fatura('2026-10-03,Loja Qualquer,29.90'), { esperados: [{ id: 'x', nome: 'Streaming do namorado', v: 29.90, tipo: 'assinatura' }] });
  igual(nomes(R.faltando), ['Streaming do namorado']);
  igual(descs(R.naoReconhecidos), ['Loja Qualquer']);
  // com duas assinaturas do mesmo valor, a do mesmo nome fica com o item do plano
  R = conferir(fatura('2026-10-03,Paramount+,29.90', '2026-10-04,Deezer,29.90'), { esperados: [{ id: 'x', nome: 'Deezer', v: 29.90, tipo: 'assinatura' }] });
  igual(descs(R.batem), ['Deezer']);
  assert.equal(R.batem[0].nota, undefined);
  igual(descs(R.assinaturasNovas), ['Paramount+']);
  // parcela nunca casa com assinatura
  R = conferir(fatura('2026-10-03,Netflix - Parcela 1/3,44.90'), { esperados: [{ id: 'n', nome: 'Netflix', v: 44.90, tipo: 'assinatura' }] });
  igual(nomes(R.faltando), ['Netflix']);
  igual(descs(R.parcelasNovas), ['Netflix - Parcela 1/3']);
});

test('compra planejada: casa pelo nome e valor; valor um pouco diferente vira valorMudou', () => {
  const esp = [{ id: 'c1', nome: 'Tênis Nike', v: 400, tipo: 'compra' }];
  let R = conferir(fatura('2026-10-12,Nike.com Br,399.90'), { esperados: esp });
  igual(nomes(R.batem), ['Tênis Nike']);
  R = conferir(fatura('2026-10-12,Nike.com Br,450.00'), { esperados: esp });
  igual(R.valorMudou.map(m => m.diferenca), [50]);
  // compra comum de mesmo valor e nome diferente: não casa
  R = conferir(fatura('2026-10-12,Loja Exemplo,400.00'), { esperados: esp });
  igual(nomes(R.faltando), ['Tênis Nike']);
  // compra planejada que veio parcelada com o mesmo valor por parcela: bate, com a parcela na nota
  R = conferir(fatura('2026-10-12,Nike.com Br - Parcela 1/3,400.00'), { esperados: esp });
  igual(R.batem.map(b => b.nota), ['parcela 1/3']);
});

/* ───────────── parcelas ───────────── */

test('parcela: alinhamento k±1, parcela que faltou, n diferente e valor mudado', () => {
  const T = fatura('2026-10-08,Loja Exemplo - Parcela 3/6,66.67', '2026-10-09,Magazine Teste - Parcela 2/10,120.00',
    '2026-10-10,Colchao Bom - Parcela 4/5,212.00', '2026-10-11,Otica Visao - Parcela 2/4,90.00');
  const R = conferir(T, { esperados: [
    { id: 'p1', nome: 'Loja Exemplo', v: 66.67, tipo: 'parcela', k: 2, n: 6 },        // k vem 1 à frente
    { id: 'p2', nome: 'Magazine Teste', v: 120, tipo: 'parcela', k: 2, n: 10 },       // igualzinho
    { id: 'p3', nome: 'Colchão Bom', v: 200, tipo: 'parcela', k: 4, n: 5 },           // valor mudou (juros?)
    { id: 'p4', nome: 'Ótica Visão', v: 90, tipo: 'parcela', k: 2, n: 3 },            // n diferente: outra compra
    { id: 'p5', nome: 'Notebook', v: 350, tipo: 'parcela', k: 4, n: 10 }] });         // não veio
  igual(R.batem.map(b => [b.esperado.id, b.nota || '']), [['p1', 'parcela 3/6 na fatura, esperado 2/6'], ['p2', '']]);
  igual(R.valorMudou.map(m => [m.esperado.id, m.diferenca]), [['p3', 12]]);
  igual(R.faltando.map(f => f.esperado.id).sort(), ['p4', 'p5']);
  igual(descs(R.parcelasNovas), ['Otica Visao - Parcela 2/4']);
  assert.equal(R.pendencias, 4);
  conferirInvariantes(R, T);
});

test('parcela: k longe do plano só casa com nome e valor; sem nome, casa pelo valor e nº de parcelas', () => {
  // plano dessincronizado (esperava 2/6, veio 5/6): mesma loja, mesmo valor -> bate, avisando
  let R = conferir(fatura('2026-10-08,Loja Exemplo - Parcela 5/6,66.67'), { esperados: [{ id: 'p', nome: 'Loja Exemplo', v: 66.67, tipo: 'parcela', k: 2, n: 6 }] });
  igual(R.batem.map(b => b.nota), ['parcela 5/6 na fatura, esperado 2/6']);
  // ... mas valor diferente com k longe não é "o mesmo item"
  R = conferir(fatura('2026-10-08,Loja Exemplo - Parcela 5/6,80.00'), { esperados: [{ id: 'p', nome: 'Loja Exemplo', v: 66.67, tipo: 'parcela', k: 2, n: 6 }] });
  assert.equal(R.valorMudou.length, 0);
  igual(nomes(R.faltando), ['Loja Exemplo']);
  // nome no plano é livre ('Celular'), a fatura traz a loja: mesmo n, mesmo valor, k ±1
  R = conferir(fatura('2026-10-08,Samsung Galaxy - Parcela 3/10,250.00'), { esperados: [{ id: 'c', nome: 'Celular', v: 250, tipo: 'parcela', k: 3, n: 10 }] });
  igual(R.batem.map(b => b.nota), ['casado pelo valor e nº de parcelas']);
  // ... e se houver a loja com o nome certo e outro valor, o nome ganha
  R = conferir(fatura('2026-10-08,Samsung Galaxy - Parcela 3/10,250.00', '2026-10-09,Celular Shop - Parcela 3/10,270.00'),
    { esperados: [{ id: 'c', nome: 'Celular Shop', v: 250, tipo: 'parcela', k: 3, n: 10 }] });
  igual(descs(R.valorMudou), ['Celular Shop - Parcela 3/10']);
  igual(descs(R.parcelasNovas), ['Samsung Galaxy - Parcela 3/10']);
  // fatura sem 'k/n' (alguns PDFs): casa por nome e valor, com nota
  R = conferir([{ id: 'z', data: '2026-10-08', valor: -66.67, desc: 'Loja Exemplo', parcela: null }],
    { esperados: [{ id: 'p', nome: 'Loja Exemplo', v: 66.67, tipo: 'parcela', k: 2, n: 6 }] });
  igual(R.batem.map(b => b.nota), ['a fatura não mostra o número da parcela']);
});

test('parcela: duas compras iguais no plano casam com as duas linhas, sem duplicada', () => {
  const T = fatura('2026-10-08,Loja Exemplo - Parcela 2/3,66.67', '2026-10-08,Loja Exemplo - Parcela 2/3,66.67');
  const R = conferir(T, { esperados: [
    { id: 'p1', nome: 'Loja Exemplo (camisa)', v: 66.67, tipo: 'parcela', k: 2, n: 3 },
    { id: 'p2', nome: 'Loja Exemplo (calça)', v: 66.67, tipo: 'parcela', k: 2, n: 3 }] });
  assert.equal(R.batem.length, 2);
  assert.equal(R.duplicadas.length, 0);
  assert.equal(R.pendencias, 0);
});

/* ───────────── duplicadas ───────────── */

test('duplicadas: mesma loja e valor em até 3 dias; parcelas de k diferente não contam', () => {
  const T = fatura(
    '2026-10-05,Loja Y - Parcela 2/5,80.00', '2026-10-05,Loja Y - Parcela 3/5,80.00',   // k diferente: não
    '2026-10-06,Loja Z - Parcela 2/5,50.00', '2026-10-06,Loja Z - Parcela 2/5,50.00',   // mesma parcela: sim
    '2026-10-07,Cinema Exemplo,60.00', '2026-10-10,Cinema Exemplo,60.00',               // 3 dias: sim
    '2026-10-11,Pizzaria Boa,70.00', '2026-10-15,Pizzaria Boa,70.00',                   // 4 dias: não
    '2026-10-12,Livraria Letra,45.00', '2026-10-12,Livraria Letra,45.50');              // valor diferente: não
  const R = conferir(T);
  igual(R.duplicadas.map(d => [d.a.desc, d.a.data, d.b.data]), [
    ['Loja Z - Parcela 2/5', '2026-10-06', '2026-10-06'], ['Cinema Exemplo', '2026-10-07', '2026-10-10']]);
  // a primeira do par segue o caminho normal; a segunda fica só em duplicadas
  igual(descs(R.parcelasNovas), ['Loja Y - Parcela 2/5', 'Loja Y - Parcela 3/5', 'Loja Z - Parcela 2/5']);
  igual(descs(R.naoReconhecidos).sort(), ['Cinema Exemplo', 'Livraria Letra', 'Livraria Letra', 'Pizzaria Boa', 'Pizzaria Boa']);
  conferirInvariantes(R, T);
});

test('duplicadas: estorno do mesmo valor desfaz a suspeita', () => {
  const T = fatura('2026-10-07,Cinema Exemplo,60.00', '2026-10-07,Cinema Exemplo,60.00', '2026-10-09,Estorno Cinema Exemplo,-60.00');
  const R = conferir(T);
  assert.equal(R.duplicadas.length, 0);
  igual(descs(R.creditos), ['Estorno Cinema Exemplo']);
  assert.equal(R.creditos[0].estorna.desc, 'Cinema Exemplo');
  assert.equal(R.totalCalculado, 60);
  conferirInvariantes(R, T);
  // estorno genérico ('Crédito de ajuste') do mesmo valor também desfaz
  const T2 = fatura('2026-10-07,Cinema Exemplo,60.00', '2026-10-07,Cinema Exemplo,60.00', '2026-10-09,Credito de ajuste,-60.00');
  assert.equal(conferir(T2).duplicadas.length, 0);
  // estorno de outro valor ou de outra loja não desfaz
  const T3 = fatura('2026-10-07,Cinema Exemplo,60.00', '2026-10-07,Cinema Exemplo,60.00', '2026-10-09,Estorno Cinema Exemplo,-30.00',
    '2026-10-09,Estorno Teatro Bom,-60.00');
  assert.equal(conferir(T3).duplicadas.length, 1);
});

test('duplicadas: a cobrança que casou com o plano é a "a"; a outra não casa pelo valor com outro item', () => {
  const T = fatura('2026-10-02,Netflix.com,44.90', '2026-10-03,Netflix.com,44.90', '2026-10-04,Paramount+,29.90');
  const R = conferir(T, { esperados: [
    { id: 'n', nome: 'Netflix', v: 44.90, tipo: 'assinatura' },
    { id: 'o', nome: 'Outro streaming', v: 44.90, tipo: 'assinatura' }] });   // mesmo valor: não pode "casar" com a repetida
  igual(nomes(R.batem), ['Netflix']);
  assert.equal(R.duplicadas.length, 1);
  assert.equal(R.duplicadas[0].a.id, R.batem[0].t.id);
  assert.notEqual(R.duplicadas[0].b.id, R.batem[0].t.id);
  igual(nomes(R.faltando), ['Outro streaming']);
  igual(descs(R.assinaturasNovas), ['Paramount+']);
  conferirInvariantes(R, T);
  // a corrida de app lançada à mão casa com uma; a outra igual vira suspeita
  const T2 = fatura('2026-10-12,Uber *Trip,18.40', '2026-10-12,Uber *Trip,18.40');
  const R2 = conferir(T2, { lancados: [{ id: 'l', d: '2026-10-12', v: 18.4, t: 'uber' }] });
  assert.equal(R2.lancadosAchados.length, 1);
  assert.equal(R2.duplicadas.length, 1);
  assert.equal(R2.duplicadas[0].a.id, R2.lancadosAchados[0].t.id);
  // ... e duas lançadas à mão são duas corridas
  const R3 = conferir(T2, { lancados: [{ id: 'l1', d: '2026-10-12', v: 18.4, t: 'uber' }, { id: 'l2', d: '2026-10-12', v: 18.4, t: 'uber volta' }] });
  assert.equal(R3.lancadosAchados.length, 2);
  assert.equal(R3.duplicadas.length, 0);
});

test('duplicadas: o café de todo dia não é suspeita; duas vezes no mesmo dia é', () => {
  const dias = ['01', '02', '05', '08', '13', '16', '16'];
  const T = fatura(...dias.map(d => `2026-10-${d},Cafe Exemplo,8.50`));
  const R = conferir(T);
  igual(R.duplicadas.map(d => [d.a.data, d.b.data]), [['2026-10-16', '2026-10-16']]);
  // três cobranças iguais em três dias seguidos (sem hábito) continuam suspeitas
  const R2 = conferir(fatura('2026-10-10,Loja Exemplo,99.00', '2026-10-11,Loja Exemplo,99.00', '2026-10-12,Loja Exemplo,99.00'));
  igual(R2.duplicadas.map(d => [d.a.data, d.b.data]), [['2026-10-10', '2026-10-11'], ['2026-10-10', '2026-10-12']]);
});

/* ───────────── lançados à mão ───────────── */

test('lançados à mão: valor igual e data perto; tolerância só quando o nome bate', () => {
  const T = fatura('2026-10-10,Padaria Pao Quente,12.00', '2026-10-11,Restaurante Sabor,57.30', '2026-10-12,Posto Exemplo,150.00');
  const R = conferir(T, { lancados: [
    { id: 'a', d: '2026-10-08', v: 12.30, t: 'padaria' },     // 0,30 de diferença, mas o nome bate
    { id: 'b', d: '2026-10-14', v: 57.30, t: 'almoço' },      // nome diferente, valor exato, 3 dias
    { id: 'c', d: '2026-10-12', v: 149.00, t: 'gasolina' },   // nome diferente, valor diferente: não
    { id: 'd', d: '2026-10-20', v: 12.00, t: 'padaria' }] }); // longe demais
  igual(R.lancadosAchados.map(l => [l.t.desc, l.lancado.id]), [['Padaria Pao Quente', 'a'], ['Restaurante Sabor', 'b']]);
  igual(R.lancadosFaltando.map(l => l.lancado.id), ['c', 'd']);
  igual(descs(R.naoReconhecidos), ['Posto Exemplo']);
  assert.equal(R.esperadoTotal, 230.6);
  // lançamentos à mão não contam como pendência
  assert.equal(R.pendencias, 1);
});

test('lançados à mão: usa a data da compra (dataCompra) da fatura C6', () => {
  const r = X.ler(textoDe('Fatura_2026-11-15.csv'), 'Fatura_2026-11-15.csv', { ano: 2026 });
  const R = conferir(r.transacoes, {
    esperados: [{ id: 'm', nome: 'Loja Exemplo', v: 66.67, tipo: 'parcela', k: 3, n: 6 }],
    lancados: [{ id: 'd', d: '2026-10-16', v: 31.2, t: 'farmácia' }, { id: 'i', d: '2026-10-19', v: 42.5, t: 'Comida fora' }] });
  igual(R.batem.map(b => [b.t.desc, b.esperado.id]), [['Magalu*Loja Exemplo', 'm']]);
  igual(R.lancadosAchados.map(l => [l.t.desc, l.lancado.id]), [['Drogasil 1455', 'd'], ['Ifd*Restaurante Sabor', 'i']]);
  igual(descs(R.pagamentos), ['Inclusao de Pagamento']);
  assert.equal(R.totalCalculado, 140.37);
  assert.equal(R.pendencias, 0);
  conferirInvariantes(R, r.transacoes);
});

test('lançado à mão com valor exato e nome diferente não toma a cobrança do plano', () => {
  // Spotify subiu para 23,90 e a pessoa lançou uma corrida de 23,90 no mesmo dia que não veio
  const T = fatura('2026-10-12,Spotify,23.90');
  const R = conferir(T, { esperados: [{ id: 's', nome: 'Spotify', v: 21.90, tipo: 'assinatura' }],
    lancados: [{ id: 'u', d: '2026-10-12', v: 23.90, t: 'Uber' }] });
  igual(nomes(R.valorMudou), ['Spotify']);
  igual(R.lancadosFaltando.map(l => l.lancado.id), ['u']);
});

/* ───────────── taxas, créditos e totais ───────────── */

test('IOF: liga à compra internacional e entra no total de taxas', () => {
  const T = fatura('2026-10-15,Openai *Chatgpt Subscr,105.00', '2026-10-15,"IOF de ""Openai *Chatgpt Subscr""",3.67',
    '2026-10-18,Steam Purchase,50.00', '2026-10-18,IOF compra internacional,1.75', '2026-10-18,Padaria Pao Quente,9.00');
  let R = conferir(T);
  igual(R.taxas.map(o => [o.t.desc, o.tipo, o.de && o.de.desc]), [
    ['IOF de "Openai *Chatgpt Subscr"', 'iof', 'Openai *Chatgpt Subscr'],
    ['IOF compra internacional', 'iof', 'Steam Purchase']]);   // genérico: a compra do mesmo dia na proporção do IOF
  assert.equal(R.totalTaxas, 5.42);
  assert.equal(R.naoReconhecidos.some(o => /IOF/.test(o.t.desc)), false);
  conferirInvariantes(R, T);
  // o plano guardou o valor com IOF (105,00 + 3,67): bate, com nota
  R = conferir(T, { esperados: [{ id: 'g', nome: 'ChatGPT Plus', v: 108.67, tipo: 'assinatura' }] });
  igual(R.batem.map(b => [b.t.desc, b.nota]), [['Openai *Chatgpt Subscr', 'com IOF de R$ 3,67']]);
  // o fixture do Nubank (PDF): IOF e compra em linhas separadas
  const pdf = X.lerTexto(textoDe('nubank-fatura-pdf.txt'), { conta: 'cartao' });
  R = conferir(pdf.transacoes);
  igual(R.taxas.map(o => [o.tipo, o.de && o.de.valor]), [['iof', -108.8]]);
  igual(descs(R.pagamentos), ['Pagamento em 25 OUT']);
  assert.equal(R.totalCalculado, 222.09);
});

test('anuidade e outras taxas: ficam em taxas, não em "não reconheço"; estorno de anuidade abate', () => {
  const T = fatura('2026-10-20,Anuidade 3/12,35.00', '2026-10-21,Juros de rotativo,48.10', '2026-10-21,Multa por atraso,9.62',
    '2026-10-21,Encargos financeiros,12.00', '2026-10-21,Seguro Cartao Protegido,6.90', '2026-10-21,Tarifa avaliacao emergencial de credito,22.00',
    '2026-10-22,Estorno de anuidade,-35.00', '2026-10-23,Detran Multa de transito,195.23');
  const R = conferir(T);
  igual(R.taxas.map(o => o.tipo).sort(), ['anuidade', 'encargos', 'juros', 'multa', 'seguro', 'tarifa']);
  igual(descs(R.naoReconhecidos), ['Detran Multa de transito']);   // multa de trânsito é compra, não taxa do cartão
  assert.equal(R.parcelasNovas.length, 0);                          // 'Anuidade 3/12' não é parcelamento novo
  igual(R.creditos.map(o => [o.t.desc, o.taxa, o.estorna && o.estorna.desc]), [['Estorno de anuidade', 'anuidade', 'Anuidade 3/12']]);
  assert.equal(R.totalTaxas, 98.62);   // 133,62 de taxas - 35,00 estornados
  assert.equal(R.totalCalculado, 293.85);
  conferirInvariantes(R, T);
  // anuidade que está no plano bate
  const R2 = conferir(fatura('2026-10-20,Anuidade 3/12,35.00'), { esperados: [{ id: 'an', nome: 'Anuidade do cartão', v: 35, tipo: 'assinatura' }] });
  igual(nomes(R2.batem), ['Anuidade do cartão']);
  igual(R2.taxas.map(o => o.tipo), ['anuidade']);
  assert.equal(R2.totalTaxas, 35);
  assert.equal(R2.pendencias, 0);
});

test('"Pagamento recebido" fica fora do total; estorno e cashback abatem', () => {
  const T = fatura('2026-10-02,Mercado Bom,200.00', '2026-10-05,Pagamento recebido,-1500.00', '2026-10-06,Estorno Mercado Bom,-20.00',
    '2026-10-07,Cashback,-5.00', '2026-10-08,Pagamento antecipado,-100.00');
  const R = conferir(T);
  igual(descs(R.pagamentos), ['Pagamento recebido', 'Pagamento antecipado']);
  igual(descs(R.creditos), ['Estorno Mercado Bom', 'Cashback']);
  assert.equal(R.totalCalculado, 175);
  assert.equal(R.creditos[0].estorna, undefined);   // estorno parcial: não aponta para a compra de 200
  conferirInvariantes(R, T);
});

test('total impresso: diferença e pendência quando passa de R$ 1', () => {
  const T = fatura('2026-10-02,Mercado Bom,200.00', '2026-10-05,Loja Exemplo,50.00');
  let R = conferir(T, { totalImpresso: 285 });
  assert.equal(R.diferencaTotal, 35);
  assert.equal(R.pendencias, 3);
  R = conferir(T, { totalImpresso: 250.5 });
  assert.equal(R.diferencaTotal, 0.5);
  assert.equal(R.pendencias, 2);
  R = conferir(T, { totalImpresso: '1.250,00' });
  assert.equal(R.totalImpresso, 1250);
  assert.equal(R.diferencaTotal, 1000);
  R = conferir(T, { totalImpresso: null });
  assert.equal(R.totalImpresso, null);
  assert.equal(R.diferencaTotal, null);
  R = conferir(T, { totalImpresso: 'abc' });
  assert.equal(R.diferencaTotal, null);
  R = conferir(T, { totalImpresso: 249.99 });
  assert.equal(R.diferencaTotal, -0.01);
});

test('fixture do Nubank (CSV): parcela repetida, IOF solto, estorno e pagamento', () => {
  const r = X.ler(textoDe('nubank-cartao.csv'), 'nubank-cartao.csv');
  const R = conferir(r.transacoes);
  igual(R.duplicadas.map(d => [d.a.desc, d.a.id !== d.b.id]), [['Loja Exemplo - Parcela 2/3', true]]);
  igual(descs(R.parcelasNovas), ['Loja Exemplo - Parcela 2/3']);
  igual(R.taxas.map(o => [o.tipo, o.de || null]), [['iof', null]]);   // a compra do IOF não está nesta fatura
  igual(descs(R.naoReconhecidos), ['Ifd*Restaurante Sabor']);
  igual(descs(R.creditos), ['Estorno Loja Exemplo']);
  igual(descs(R.pagamentos), ['Pagamento recebido']);
  assert.equal(R.totalCalculado, 160.06);
  assert.equal(R.pendencias, 3);
  conferirInvariantes(R, r.transacoes);
});

/* ───────────── entradas vazias ou estranhas ───────────── */

test('entradas vazias ou quebradas nunca dão erro', () => {
  const vazio = C.conferir();
  igual(Object.keys(vazio).sort(), ['assinaturasNovas', 'avisos', 'batem', 'creditos', 'diferencaTotal', 'duplicadas', 'esperadoTotal',
    'faltando', 'lancadosAchados', 'lancadosFaltando', 'naoReconhecidos', 'pagamentos', 'parcelasNovas', 'pendencias', 'taxas',
    'totalCalculado', 'totalImpresso', 'totalTaxas', 'valorMudou']);
  assert.equal(vazio.totalCalculado, 0);
  assert.equal(vazio.pendencias, 0);
  assert.equal(vazio.totalImpresso, null);
  for (const e of [null, undefined, 0, 'texto', [], {}, { transacoes: null }, { transacoes: 'x', esperados: {}, lancados: 7 }]) {
    const R = C.conferir(e);
    GRUPOS.forEach(g => assert.ok(Array.isArray(R[g]), g));
    assert.equal(R.pendencias, 0);
  }
  // só o plano, sem fatura: tudo falta
  const R = C.conferir({ esperados: [{ id: 'a', nome: 'Spotify', v: 21.9, tipo: 'assinatura' }, null, { v: 'abc' }, { nome: 'sem valor' }],
    lancados: [null, 1, { v: 'x' }, { id: 'l', d: 'ontem', v: 10, t: 'algo' }] });
  igual(nomes(R.faltando), ['Spotify']);
  igual(R.lancadosFaltando.map(l => l.lancado.id), ['l']);
  assert.equal(R.esperadoTotal, 31.9);
  assert.equal(R.pendencias, 1);
  // linhas quebradas, classificar e chave que dão erro
  const R2 = C.conferir({
    transacoes: [null, 5, { valor: 'abc' }, { valor: 0, desc: 'zero' }, { id: '1', valor: -10, desc: 'Loja Exemplo' },
      { id: '2', valor: -10, desc: null, data: 'xx' }, { id: '3', valor: 30, desc: 'Pagamento recebido', data: '2026-10-01' }],
    classificar: () => { throw new Error('quebrou'); }, chave: () => { throw new Error('quebrou'); },
    esperados: [{ id: 'e', nome: 'Loja Exemplo', v: 10 }], lancados: [{ id: 'l', d: '2026-10-01', v: 10, t: 'x' }] });
  igual(R2.batem.map(b => b.t.id), ['1']);
  igual(R2.pagamentos.map(p => p.t.id), ['3']);
  igual(R2.naoReconhecidos.map(o => o.t.id), ['2']);
  assert.equal(R2.totalCalculado, 20);
  assert.ok(R2.avisos.length >= 2);
  // classificar que devolve lixo
  const R3 = C.conferir({ transacoes: fatura('2026-10-02,Spotify,21.90'), classificar: () => 42 });
  assert.equal(R3.assinaturasNovas.length, 1);
});

test('sem extrato.js carregado: classificação e chave simples de reserva', () => {
  const so = carregarScripts(['conferencia.js']).Conferencia;
  const T = [
    { id: 'a', data: '2026-10-02', valor: -14.9, desc: 'APPLE.COM/BILL', parcela: null },
    { id: 'b', data: '2026-10-03', valor: -59, desc: 'Netflix.com', parcela: null },
    { id: 'c', data: '2026-10-04', valor: -66.67, desc: 'Loja Exemplo - Parcela 2/3', parcela: { k: 2, n: 3 } },
    { id: 'd', data: '2026-10-04', valor: -66.67, desc: 'Loja Exemplo - Parcela 2/3', parcela: { k: 2, n: 3 } },
    { id: 'e', data: '2026-10-05', valor: 500, desc: 'Pagamento recebido', parcela: null },
    { id: 'f', data: '2026-10-06', valor: 10, desc: 'Estorno Padaria', parcela: null }];
  const R = so.conferir({ transacoes: T, esperados: [{ id: 'i', nome: 'iCloud', v: 14.9, tipo: 'assinatura' }] });
  igual(R.batem.map(b => b.t.id), ['a']);
  igual(R.assinaturasNovas.map(o => o.t.id), ['b']);
  igual(R.duplicadas.map(d => [d.a.id, d.b.id]), [['c', 'd']]);
  igual(R.pagamentos.map(o => o.t.id), ['e']);
  igual(R.creditos.map(o => o.t.id), ['f']);
  assert.equal(R.totalCalculado, 197.24);
  assert.ok(so.parecido('Game Pass', 'MICROSOFT*XBOX') > 0);
});

/* ───────────── funções auxiliares ───────────── */

test('taxaTipo', () => {
  const casos = [
    ['IOF de "Openai *Chatgpt Subscr"', 'iof'], ['I.O.F. compra no exterior', 'iof'], ['IOF rotativo', 'iof'],
    ['Anuidade 3/12', 'anuidade'], ['ANUIDADE DIFERENCIADA', 'anuidade'], ['Juros de rotativo', 'juros'], ['Juros de mora', 'juros'],
    ['Multa por atraso', 'multa'], ['Encargos financeiros', 'encargos'], ['Encargo rotativo', 'encargos'],
    ['Seguro Cartão Protegido', 'seguro'], ['Seguro prestamista', 'seguro'], ['Tarifa de saque', 'tarifa'],
    ['Avaliação emergencial de crédito', 'tarifa'], ['Taxa de emissão de 2ª via', 'tarifa'],
    ['Estorno de anuidade', null], ['Estorno IOF', null], ['Porto Seguro Cartao', null], ['DETRAN MULTA', null],
    ['Spotify', null], ['Mapfre Seguros Auto', null], ['', null], [null, null], [undefined, null], [42, null]];
  for (const [d, tipo] of casos) assert.equal(C.taxaTipo(d), tipo, String(d));
});

test('parecido', () => {
  const p = (a, b) => C.parecido(a, b, X.chave);
  assert.ok(p('Claude', 'CLAUDE.AI SUBSCRIPTION') > 0);
  assert.ok(p('iCloud', 'APPLE.COM/BILL') > 0);
  assert.ok(p('Apple Music', 'Apple.com/bill') > 0);
  assert.ok(p('Game Pass', 'MICROSOFT*XBOX') > 0);
  assert.ok(p('Smart Fit', 'SMARTFIT SAO PAULO') > 0);
  assert.ok(p('Loja Exemplo', 'Magalu*Loja Exemplo - Parcela 3/6') > 0);
  assert.ok(p('ChatGPT Plus', 'OPENAI *CHATGPT SUBSCR') > 0);
  assert.ok(p('Spotify', 'DL*SPOTIFYBR') > 0);
  // palavras genéricas sozinhas não bastam
  assert.equal(p('Microsoft 365', 'MICROSOFT*XBOX'), 0);
  assert.equal(p('Amazon Prime', 'AMAZON MARKETPLACE'), 0);
  assert.equal(p('Assinatura', 'Netflix Assinatura'), 0);
  assert.equal(p('Restaurante Sabor', 'Padaria Sao Paulo'), 0);
  assert.equal(p('', ''), 0);
  assert.equal(C.parecido(null, undefined), 0);
  // sem chave: usa Extrato.chave do mesmo contexto
  assert.ok(C.parecido('iCloud', 'APPLE.COM/BILL') > 0);
  // chave que quebra não derruba
  assert.ok(C.parecido('Spotify', 'Spotify', () => { throw new Error('x'); }) > 0);
});
