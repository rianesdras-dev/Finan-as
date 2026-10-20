// Testes adversariais: classificacao e dupla contagem. Dados sinteticos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregar } from './carregar.mjs';

const E = carregar();
const CATS = ['comida', 'mercado', 'role', 'transp', 'diaria', 'compras', 'saude', 'outros'];

function tx(desc, valor = -10, extra = {}) {
  return { id: 'x', data: '2026-10-10', valor, desc, original: desc, parcela: null, ...extra };
}
function cl(desc, valor = -10, regras) {
  return E.classificar(tx(desc, valor), regras);
}
function gasto(desc, cat, valor = -25.9) {
  const c = cl(desc, valor);
  assert.equal(c.tipo, 'gasto', `${desc}: tipo`);
  assert.equal(c.cat, cat, `${desc}: cat`);
  return c;
}

// ---------- Desambiguacao de comerciantes ----------
test('UBER *EATS e comida, UBER *TRIP e transporte', () => {
  gasto('UBER *EATS PENDING', 'comida');
  gasto('UBER *TRIP HELP.UBER.COM', 'transp');
});

test('chave de UBER *EATS difere de UBER *TRIP', () => {
  assert.notEqual(E.chave('UBER *EATS'), E.chave('UBER *TRIP'));
});

test('99 FOOD / 99FOOD e comida; 99 POP / 99APP e transporte', () => {
  gasto('99 FOOD', 'comida');
  gasto('99FOOD *LANCHES BOM', 'comida');
  gasto('99 POP', 'transp');
  gasto('99APP *99APP', 'transp');
});

test('MERCADOLIVRE*VENDEDOR e compras, nao mercado', () => {
  gasto('MERCADOLIVRE*LOJAXYZ', 'compras');
  gasto('MERCADO LIVRE', 'compras');
});

test('SUPERMERCADO X e mercado', () => {
  gasto('SUPERMERCADO BOA COMPRA', 'mercado');
});

test('MERCADO PAGO nao vira categoria mercado', () => {
  const c = cl('MP *MERCADOPAGO', -30);
  assert.notEqual(c.cat, 'mercado');
});

test('IFD*BURGER KING e comida e chave agrupa com iFood', () => {
  gasto('IFD*BURGER KING', 'comida');
  assert.equal(E.chave('IFD*BURGER KING SAO PAULO BR'), E.chave('iFood *Burger King'));
});

test('BARBEARIA nao e role por causa de "bar"', () => {
  const c = cl('BARBEARIA DO ZE', -45);
  assert.notEqual(c.cat, 'role');
});

test('BARRA SHOPPING / BARBOSA nao viram role', () => {
  assert.notEqual(cl('FARMACIA BARBOSA', -20).cat, 'role');
});

test('BAR DO ZECA e role', () => {
  gasto('BAR DO ZECA', 'role');
});

test('POSTO SHELL, IPIRANGA e BR sao transporte', () => {
  gasto('POSTO SHELL JARDINS', 'transp');
  gasto('AUTO POSTO IPIRANGA', 'transp');
  gasto('POSTO PETROBRAS BR 101', 'transp');
});

test('DROGASIL, DROGARIA SAO PAULO e RAIA sao saude', () => {
  gasto('DROGASIL 1234', 'saude');
  gasto('DROGARIA SAO PAULO', 'saude');
  gasto('DROGA RAIA 0456', 'saude');
});

test('DROGARIA SAO PAULO nao perde a palavra drogaria na chave', () => {
  const k = E.chave('DROGARIA SAO PAULO');
  assert.ok(k.includes('drogaria'), k);
});

test('SMART FIT e saude e assinatura', () => {
  const c = gasto('SMARTFIT *MENSALIDADE', 'saude');
  assert.equal(c.assinatura, true);
  const d = gasto('SMART FIT', 'saude');
  assert.equal(d.assinatura, true);
});

test('Wellhub / TotalPass sao saude e assinatura', () => {
  assert.equal(gasto('WELLHUB GYMPASS', 'saude').assinatura, true);
  assert.equal(gasto('TOTALPASS', 'saude').assinatura, true);
});

test('APPLE.COM/BILL e assinatura', () => {
  const c = cl('APPLE.COM/BILL', -14.9);
  assert.equal(c.tipo, 'gasto');
  assert.equal(c.assinatura, true);
});

test('GOOGLE *YOUTUBEPREMIUM e assinatura; GOOGLE PLAY APP nao necessariamente', () => {
  assert.equal(cl('GOOGLE *YOUTUBEPREMIUM', -24.9).assinatura, true);
  assert.notEqual(E.chave('GOOGLE *YOUTUBEPREMIUM'), E.chave('GOOGLE *GOOGLE PLAY APP'));
});

test('AMAZON PRIME e assinatura; AMAZON MARKETPLACE e compras sem assinatura', () => {
  assert.equal(cl('AMAZON PRIME BR', -19.9).assinatura, true);
  const m = gasto('AMAZON MARKETPLACE', 'compras');
  assert.equal(m.assinatura, false);
  assert.notEqual(E.chave('AMAZON PRIME'), E.chave('AMAZON MARKETPLACE'));
});

test('Streaming e IA sao assinatura', () => {
  for (const d of ['NETFLIX.COM', 'SPOTIFY', 'DISNEY PLUS', 'CLAUDE.AI SUBSCRIPTION', 'OPENAI *CHATGPT SUBSCR', 'GLOBOPLAY']) {
    assert.equal(cl(d, -39.9).assinatura, true, d);
  }
});

test('Compra comum nao e assinatura', () => {
  assert.equal(cl('PADARIA REAL', -12).assinatura, false);
  assert.equal(cl('SUPERMERCADO BOA COMPRA', -120).assinatura, false);
});

test('SYMPLA*SHOW e role', () => {
  gasto('SYMPLA*SHOW BANDA X', 'role');
});

test('PADARIA REAL e dia a dia', () => {
  gasto('PADARIA REAL', 'diaria');
});

test('Cafeteria e comida (coffee shop)', () => {
  gasto('CAFETERIA GRAO NOBRE', 'comida');
  gasto('STARBUCKS', 'comida');
});

test('Pizzaria / hamburgueria / sushi sao comida', () => {
  gasto('PIZZARIA BELLA', 'comida');
  gasto('HAMBURGUERIA DO BAIRRO', 'comida');
  gasto('SUSHI KAZU', 'comida');
});

test('Shein / Shopee / Renner sao compras', () => {
  gasto('SHEIN *PEDIDO', 'compras');
  gasto('SHOPEE *LOJA', 'compras');
  gasto('LOJAS RENNER', 'compras');
});

test('Estacionamento e pedagio sao transporte', () => {
  gasto('ESTAPAR ESTACIONAMENTO', 'transp');
  gasto('SEM PARAR', 'transp');
});

// ---------- Tarifas, impostos ----------
test('IOF COMPRA INTERNACIONAL e gasto/outros', () => {
  gasto('IOF COMPRA INTERNACIONAL', 'outros', -3.5);
});

test('DAS - Simples Nacional e gasto/outros', () => {
  gasto('DAS - Simples Nacional', 'outros', -76.6);
});

test('Tarifa e juros sao gasto/outros', () => {
  gasto('TARIFA PACOTE SERVICOS', 'outros');
  gasto('JUROS ROTATIVO', 'outros');
});

// ---------- Estorno ----------
test('ESTORNO IFOOD e estorno com cat comida', () => {
  const c = cl('ESTORNO IFOOD *RESTAURANTE SABOR', 42.5);
  assert.equal(c.tipo, 'estorno');
  assert.equal(c.cat, 'comida');
});

test('Estorno sem comerciante conhecido tem cat nao nula', () => {
  const c = cl('ESTORNO DE COMPRA', 30);
  assert.equal(c.tipo, 'estorno');
  assert.ok(CATS.includes(c.cat));
});

// ---------- Fatura ----------
test('Pagamento de fatura no corrente e fatura', () => {
  for (const d of ['Pagamento de fatura', 'NU PAGAMENTO', 'PAGTO CARTAO CREDITO', 'Pagamento fatura cartão']) {
    const c = cl(d, -1500);
    assert.equal(c.tipo, 'fatura', d);
    assert.equal(c.cat, null, d);
  }
});

test('Pagamento recebido dentro da fatura do cartao e fatura (nao entrada)', () => {
  const r = E.lerTexto('15 OUT Pagamento recebido 1.500,00\n16 OUT IFOOD *RESTAURANTE 42,50', { ano: 2026, conta: 'cartao' });
  const pag = r.transacoes.find(t => /pagamento/i.test(t.desc));
  assert.ok(pag, 'linha de pagamento lida');
  assert.ok(pag.valor > 0, 'pagamento recebido positivo');
  assert.equal(E.classificar(pag).tipo, 'fatura');
  const ifood = r.transacoes.find(t => /ifood/i.test(t.desc));
  assert.ok(ifood.valor < 0, 'compra negativa no cartao');
});

test('Nubank CSV de cartao: Pagamento recebido vira fatura e compras negativas', () => {
  const csv = 'date,title,amount\n2026-10-05,Restaurante Sabor,42.50\n2026-10-06,Pagamento recebido,-1500.00\n';
  const r = E.ler(csv, 'Nubank_2026-10-20.csv');
  const pag = r.transacoes.find(t => /pagamento/i.test(t.desc));
  const rest = r.transacoes.find(t => /restaurante/i.test(t.desc));
  assert.ok(rest.valor < 0);
  assert.ok(pag.valor > 0);
  assert.equal(E.classificar(pag).tipo, 'fatura');
});

// ---------- Investimento ----------
test('Aplicacao/Resgate/Caixinha/Guardar/Porquinho/Rendimento sao investimento', () => {
  const casos = [
    ['Aplicação RDB', -1000], ['Resgate RDB', 500], ['Dinheiro guardado na Caixinha', -200],
    ['Guardar dinheiro', -300], ['PORQUINHO INTER', -100], ['Rendimento', 12.34],
    ['APLICACAO CDB', -2000], ['RESGATE POUPANCA', 800], ['Tesouro Direto', -500],
  ];
  for (const [d, v] of casos) {
    const c = cl(d, v);
    assert.equal(c.tipo, 'investimento', d);
    assert.equal(c.cat, null, d);
  }
});

// ---------- Transferencia ----------
test('Transferencia entre contas mesma titularidade e transferencia', () => {
  for (const [d, v] of [['Transferência entre contas mesma titularidade', -500], ['TED MESMA TITULARIDADE', 500], ['Transferência para conta própria', -100]]) {
    const c = cl(d, v);
    assert.equal(c.tipo, 'transferencia', d);
    assert.equal(c.cat, null, d);
  }
});

// ---------- Pix pessoa ----------
test('Pix recebido de pessoa e entrada', () => {
  const c = cl('Transferência recebida pelo Pix - MARIA SOUZA - •••.123.456-••', 150);
  assert.equal(c.tipo, 'entrada');
  assert.equal(c.cat, null);
});

test('Pix enviado a pessoa e gasto/outros/palpite', () => {
  const c = cl('Transferência enviada pelo Pix - JOAO LIMA - •••.987.654-•• - BANCO FICTICIO (0999) Agência: 1 Conta: 12345-6', -80);
  assert.equal(c.tipo, 'gasto');
  assert.equal(c.cat, 'outros');
  assert.equal(c.confianca, 'palpite');
});

test('chave do Pix mantem o nome da pessoa e remove CPF/banco', () => {
  const k = E.chave('Transferência enviada pelo Pix - JOAO LIMA - •••.987.654-•• - BANCO FICTICIO (0999) Agência: 1 Conta: 12345-6');
  assert.ok(k.includes('joao') && k.includes('lima'), k);
  assert.ok(!/\d/.test(k), k);
  assert.ok(!k.includes('ficticio'), k);
});

test('Pix para pessoas diferentes geram chaves diferentes', () => {
  const a = E.chave('PIX ENVIADO JOAO LIMA');
  const b = E.chave('PIX ENVIADO ANA COSTA');
  assert.notEqual(a, b);
});

test('Pix enviado e recebido da mesma pessoa compartilham chave', () => {
  assert.equal(E.chave('Pix enviado JOAO LIMA'), E.chave('Pix recebido JOAO LIMA'));
});

test('PAG*JOSEDASILVA e gasto e a chave preserva o recebedor', () => {
  const c = cl('PAG*JOSEDASILVA', -35);
  assert.equal(c.tipo, 'gasto');
  assert.ok(E.chave('PAG*JOSEDASILVA').includes('josedasilva'));
});

// ---------- Entradas ----------
test('Salario, Bolsa e PROVENTOS sao entrada', () => {
  for (const d of ['Salário', 'CREDITO SALARIO EMPRESA FICTICIA', 'Bolsa residência', 'PROVENTOS']) {
    const c = cl(d, 3000);
    assert.equal(c.tipo, 'entrada', d);
    assert.equal(c.cat, null, d);
  }
});

test('Valor positivo desconhecido e entrada', () => {
  assert.equal(cl('CREDITO DIVERSO XPTO', 99).tipo, 'entrada');
});

test('Valor negativo desconhecido e gasto/outros/palpite', () => {
  const c = cl('QWERTY ZXCV LTDA', -50);
  assert.deepEqual([c.tipo, c.cat, c.confianca], ['gasto', 'outros', 'palpite']);
});

test('Dicionario retorna confianca dicionario', () => {
  assert.equal(cl('DROGASIL', -20).confianca, 'dicionario');
});

// ---------- Regras aprendidas ----------
test('Regra aprendida mercado sobrepoe dicionario', () => {
  const k = E.chave('PADARIA REAL');
  const c = cl('PADARIA REAL', -80, { [k]: 'mercado' });
  assert.deepEqual([c.tipo, c.cat, c.confianca], ['gasto', 'mercado', 'regra']);
});

test('Regra aprendida transferencia faz Pix proprio nao contar como gasto', () => {
  const d = 'Transferência enviada pelo Pix - RIAN TESTE FICTICIO - •••.111.222-••';
  const k = E.chave(d);
  const c = cl(d, -1000, { [k]: 'transferencia' });
  assert.equal(c.tipo, 'transferencia');
  assert.equal(c.cat, null);
  assert.equal(c.confianca, 'regra');
});

test('Regra aprendida vale para variante da mesma loja (cidade/mascara/data)', () => {
  const regras = { [E.chave('IFD*RESTAURANTE SABOR SAO PAULO BR')]: 'mercado' };
  const c = cl('iFood *Restaurante Sabor', -30, regras);
  assert.equal(c.cat, 'mercado');
  assert.equal(c.confianca, 'regra');
});

test('Regra aprendida nao vaza para outro comerciante', () => {
  const regras = { [E.chave('PADARIA REAL')]: 'mercado' };
  const c = cl('PADARIA BOM PAO', -10, regras);
  assert.notEqual(c.confianca, 'regra');
});

test('classificar retorna chave = chave(desc)', () => {
  const d = 'UBER* TRIP SAO PAULO BR';
  assert.equal(cl(d).chave, E.chave(d));
});

// ---------- chave: agrupamento ----------
test('chave agrupa variantes do Uber', () => {
  const a = E.chave('UBER *TRIP HELP.UBER.COM');
  assert.equal(E.chave('Uber *Trip'), a);
  assert.equal(E.chave('UBER* TRIP SAO PAULO BR'), a);
});

test('chave agrupa iFood IFD* com cidade', () => {
  assert.equal(E.chave('IFD*RESTAURANTE SABOR SAO PAULO BR'), E.chave('iFood *Restaurante Sabor'));
});

test('chave remove parcela, data, mascara de cartao e cidade/UF', () => {
  const base = E.chave('LOJA FICTICIA MODA');
  assert.equal(E.chave('LOJA FICTICIA MODA - Parcela 2/3'), base);
  assert.equal(E.chave('LOJA FICTICIA MODA PARC 02/10'), base);
  assert.equal(E.chave('LOJA FICTICIA MODA 19/10'), base);
  assert.equal(E.chave('LOJA FICTICIA MODA RIO DE JANEIRO RJ'), base);
  assert.equal(E.chave('Compra no débito LOJA FICTICIA MODA'), base);
  assert.equal(E.chave('LOJA FICTICIA MODA **** 1234'), base);
});

test('chave e minuscula, sem acentos, sem digitos, max 3 palavras', () => {
  const k = E.chave('AÇOUGUE SÃO JOÃO CARNES NOBRES 123');
  assert.equal(k, k.toLowerCase());
  assert.ok(!/[̀-ͯ]|[áéíóúçãõâê]/.test(k), k);
  assert.ok(!/\d/.test(k), k);
  assert.ok(k.split(' ').length <= 3, k);
});

test('chave nao agrupa comerciantes diferentes com prefixo comum', () => {
  assert.notEqual(E.chave('RESTAURANTE SABOR'), E.chave('RESTAURANTE MAR'));
  assert.notEqual(E.chave('IFD*PIZZARIA BELLA'), E.chave('IFD*SUSHI KAZU'));
  assert.notEqual(E.chave('PAG*JOSEDASILVA'), E.chave('PAG*MARIACOSTA'));
});

test('chave e estavel (idempotente para mesma entrada)', () => {
  const d = 'MERCADOLIVRE*VENDEDORX';
  assert.equal(E.chave(d), E.chave(d));
});

// ---------- Parcelas ----------
test('Linha parcelada estilo Nubank mantem parcela e valor da parcela', () => {
  const r = E.lerTexto('19 OUT Formatura Eventos - Parcela 2/10 R$ 450,00', { ano: 2026, conta: 'cartao' });
  assert.equal(r.transacoes.length, 1);
  const t = r.transacoes[0];
  assert.deepEqual({ ...t.parcela }, { k: 2, n: 10 });
  assert.equal(t.valor, -450);
});

test('PARC 02/10 e "2 de 10" geram parcela', () => {
  const r = E.lerTexto('05/10 LOJA FICTICIA PARC 03/06 99,90\n06/10 LOJA OUTRA 2 de 5 50,00', { ano: 2026, conta: 'cartao' });
  const [a, b] = r.transacoes;
  assert.deepEqual({ ...a.parcela }, { k: 3, n: 6 });
  assert.equal(a.valor, -99.9);
  assert.deepEqual({ ...b.parcela }, { k: 2, n: 5 });
  assert.equal(b.valor, -50);
});

test('Parcelas da mesma compra compartilham chave e ficam classificadas igual', () => {
  const a = E.chave('LOJA FICTICIA MODA - Parcela 1/3');
  const b = E.chave('LOJA FICTICIA MODA - Parcela 3/3');
  assert.equal(a, b);
});

// ---------- Dupla contagem ----------
test('Extrato corrente: fatura paga nao e gasto (evita contar cartao duas vezes)', () => {
  const r = E.lerTexto('10/10/2026 PAGAMENTO FATURA CARTAO -1.234,56\n11/10/2026 PADARIA REAL -8,50', { conta: 'corrente' });
  const tipos = Array.from(r.transacoes, t => E.classificar(t).tipo);
  assert.deepEqual(tipos, ['fatura', 'gasto']);
});

test('Aplicacao e resgate nao contam como gasto/entrada', () => {
  const r = E.lerTexto('10/10/2026 APLICACAO RDB -5.000,00\n12/10/2026 RESGATE RDB 2.000,00', { conta: 'corrente' });
  const tipos = Array.from(r.transacoes, t => E.classificar(t).tipo);
  assert.deepEqual(tipos, ['investimento', 'investimento']);
});

test('ids iguais para mesmo arquivo reimportado e distintos para linhas identicas', () => {
  const txt = '10/10/2026 PADARIA REAL -8,50\n10/10/2026 PADARIA REAL -8,50';
  const a = E.lerTexto(txt, { conta: 'corrente' }).transacoes.map(t => t.id);
  const b = E.lerTexto(txt, { conta: 'corrente' }).transacoes.map(t => t.id);
  assert.deepEqual(a, b);
  assert.notEqual(a[0], a[1]);
});

// ---------- Mais ataques ----------
test('Pagamento de boleto/conta nao e fatura de cartao', () => {
  for (const d of ['PAGAMENTO DE BOLETO CONDOMINIO FICTICIO', 'PAGAMENTO CONTA LUZ', 'PAGTO TITULO ESCOLA FICTICIA']) {
    const c = cl(d, -300);
    assert.equal(c.tipo, 'gasto', d);
  }
});

test('MERCADO PAGO como intermediario nao vira mercado', () => {
  assert.notEqual(cl('MERCADO PAGO *LOJAXYZ', -40).cat, 'mercado');
  assert.notEqual(cl('MERCADOPAGO*RESTAURANTESABOR', -40).cat, 'mercado');
});

test('Pix recebido de pessoa com prefixo curto e entrada', () => {
  assert.equal(cl('PIX RECEBIDO ANA COSTA', 200).tipo, 'entrada');
  assert.equal(cl('TED RECEBIDA PEDRO ALVES', 200).tipo, 'entrada');
});

test('Rappi e comida; Cinemark e Booking sao role', () => {
  gasto('RAPPI*RESTAURANTE', 'comida');
  gasto('CINEMARK SHOPPING', 'role');
  gasto('BOOKING.COM HOTEL', 'role');
});

test('Amazon.com.br e compras; Prime Video e assinatura', () => {
  gasto('AMAZON.COM.BR', 'compras');
  assert.equal(cl('PRIME VIDEO', -19.9).assinatura, true);
});

test('Estorno de Uber Trip tem cat transp', () => {
  const c = cl('ESTORNO UBER *TRIP', 23.9);
  assert.equal(c.tipo, 'estorno');
  assert.equal(c.cat, 'transp');
});

test('Regra de categoria em estorno positivo nao vira gasto', () => {
  const k = E.chave('LOJA FICTICIA MODA');
  const c = cl('ESTORNO LOJA FICTICIA MODA', 50, { [k]: 'compras' });
  assert.notEqual(c.tipo, 'gasto');
});

test('Regra investimento sobrepoe dicionario', () => {
  const k = E.chave('PIX ENVIADO CORRETORA FICTICIA');
  const c = cl('PIX ENVIADO CORRETORA FICTICIA', -1000, { [k]: 'investimento' });
  assert.equal(c.tipo, 'investimento');
  assert.equal(c.confianca, 'regra');
});

test('Regra entrada sobrepoe palpite para Pix recebido de pagador recorrente', () => {
  const d = 'PIX RECEBIDO HOSPITAL FICTICIO LTDA';
  const c = cl(d, 1800, { [E.chave(d)]: 'entrada' });
  assert.equal(c.tipo, 'entrada');
  assert.equal(c.confianca, 'regra');
});

test('Conveniencia e dia a dia, lavanderia e dia a dia', () => {
  gasto('CONVENIENCIA 24H', 'diaria');
  gasto('LAVANDERIA FICTICIA', 'diaria');
});

test('Academia generica e saude', () => {
  gasto('ACADEMIA CORPO SAO', 'saude');
});

test('Hortifruti e acougue sao mercado', () => {
  gasto('HORTIFRUTI FRESCO', 'mercado');
  gasto('ACOUGUE BOI BOM', 'mercado');
});

test('Parcela "2 de 10" em texto de app', () => {
  const r = E.lerTexto('06/10 FORMATURA EVENTOS 2 de 10 450,00', { ano: 2026, conta: 'cartao' });
  assert.deepEqual({ ...r.transacoes[0].parcela }, { k: 2, n: 10 });
  assert.equal(r.transacoes[0].valor, -450);
});

test('Parcela "Parcela 2/3" no desc e valor da parcela', () => {
  const r = E.lerTexto('19 OUT Restaurante X - Parcela 2/3 R$ 66,67', { ano: 2026, conta: 'cartao' });
  const t = r.transacoes[0];
  assert.deepEqual({ ...t.parcela }, { k: 2, n: 3 });
  assert.equal(t.valor, -66.67);
});
