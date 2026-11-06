// Quando sacar da reserva: dia útil, colchão, janela até o próximo dinheiro grande, entradas incertas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const ctx = { console, Date, Math, JSON }; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../app/caixa.js', import.meta.url), 'utf8'), ctx);
const C = ctx.Caixa;
const J = x => JSON.parse(JSON.stringify(x));

test('saldo negativo hoje: resgate hoje, urgente, cobrindo a fatura e o dia a dia da janela', () => {
  const r = J(C.planejar({ hoje: '2026-11-06', saldo: -30.42, colchao: 200, janela: 14, eventos: [
    { d: '2026-11-10', v: -2190.22, n: 'Fatura' }, { d: '2026-11-13', v: -109, n: 'Internet' },
  ] }));
  assert.equal(r.saques.length, 1);
  assert.equal(r.saques[0].d, '2026-11-06');
  assert.equal(r.saques[0].urgente, true);
  // −30,42 − 2.190,22 − 109 = −2.329,64 → precisa de 2.529,64 → arredonda para 2.550
  assert.equal(r.saques[0].v, 2550);
  assert.deepEqual(r.saques[0].cobre.map(x => x.n), ['Fatura', 'Internet']);
  assert.ok(r.dias.every(d => d.saldo >= 200));
});

test('conta que vence numa segunda: o resgate é na sexta antes', () => {
  const r = J(C.planejar({ hoje: '2026-11-25', saldo: 300, eventos: [{ d: '2026-11-30', v: -1000, n: 'Aluguel' }] }));
  assert.equal(r.saques[0].d, '2026-11-27');          // 30/11/2026 é segunda
  assert.equal(r.saques[0].v, 900);                   // 300 − 1000 = −700 → precisa 900 para ficar em 200
});

test('a janela para na véspera do próximo dinheiro grande; depois dele não precisa de saque', () => {
  const ev = [{ d: '2026-11-26', v: -2583, n: 'Aluguel' }, { d: '2026-12-03', v: 1500, n: 'Tio e avó' }];
  for (let d = 21; d <= 30; d++) ev.push({ d: '2026-11-' + d, v: -40, n: 'dia a dia' });
  for (let d = 1; d <= 6; d++) ev.push({ d: '2026-12-0' + d, v: -60, n: 'dia a dia' });
  const r = J(C.planejar({ hoje: '2026-11-20', saldo: 250, janela: 14, eventos: ev }));
  assert.equal(r.saques.length, 1);
  assert.equal(r.saques[0].d, '2026-11-20');           // o colchão acaba no sábado 21/11 → resgate na sexta 20
  const ate = r.dias.filter(d => d.d < '2026-12-03');
  assert.ok(ate.every(d => d.saldo >= 200), 'cobre até a véspera do dinheiro');
  assert.ok(r.dias.every(d => d.saldo >= 200), 'e depois a entrada segura o resto');
});

test('entrada incerta não conta para pagar: vira lista de "se vier, devolva"', () => {
  const r = J(C.planejar({ hoje: '2026-12-01', saldo: 500, eventos: [
    { d: '2026-12-05', v: 5600, n: 'Empresa', incerto: true }, { d: '2026-12-10', v: -2000, n: 'Fatura' },
  ] }));
  assert.deepEqual(r.incertos, [{ d: '2026-12-05', n: 'Empresa', v: 5600 }]);
  assert.equal(r.saques.length, 1);
  assert.equal(r.saques[0].d, '2026-12-09');
  assert.equal(r.saques[0].v, 1700);
});

test('sem falta de dinheiro, sem saque; valores redondos em 50; o que já venceu sai hoje', () => {
  assert.equal(J(C.planejar({ hoje: '2026-11-06', saldo: 5000, eventos: [{ d: '2026-11-10', v: -1000, n: 'x' }] })).saques.length, 0);
  const r = J(C.planejar({ hoje: '2026-11-06', saldo: 0, colchao: 100, eventos: [{ d: '2026-11-01', v: -12.34, n: 'atrasada' }] }));
  assert.equal(r.saques[0].d, '2026-11-06');
  assert.equal(r.saques[0].v, 150);                    // 0 − 12,34 → precisa 112,34 → 150
  assert.equal(r.saques[0].cobre[0].d, '2026-11-06');
});

test('dia útil antes: segunda volta para sexta, nunca antes de hoje', () => {
  assert.equal(C.diaUtilAntes('2026-11-09', '2026-11-01'), '2026-11-06');
  assert.equal(C.diaUtilAntes('2026-11-09', '2026-11-08'), '2026-11-08');
});

test('dinheiro parado fora da reserva vai primeiro; a reserva só cobre o resto', () => {
  const ev = [{ d: '2026-11-06', v: -500, n: 'Parcela' }, { d: '2026-11-10', v: -2000, n: 'Fatura', id: 'fatura' }];
  const r = J(C.planejar({ hoje: '2026-11-06', saldo: -50, eventos: ev, fontes: [{ n: 'Saldo na corretora', v: 400, id: 'k1' }] }));
  assert.equal(r.saques.length, 1);
  assert.equal(r.saques[0].d, '2026-11-06');
  assert.deepEqual(r.saques[0].usa, [{ n: 'Saldo na corretora', v: 400, id: 'k1' }]);
  // −50 + 400 − 500 − 2.000 = −2.150 → precisa 2.350 (sem a fonte seriam 2.750)
  assert.equal(r.saques[0].v, 2350);
  assert.equal(r.total, 2350);
  assert.equal(r.usado, 400);
  assert.equal(r.saques[0].cobre.find(x => x.n === 'Fatura').id, 'fatura');
  assert.ok(r.dias.every(d => d.saldo >= 200));
  const sem = J(C.planejar({ hoje: '2026-11-06', saldo: -50, eventos: ev }));
  assert.equal(sem.saques[0].v, 2750);
});

test('se a fonte basta, o "saque" é só passar o dinheiro (nada da reserva)', () => {
  const r = J(C.planejar({ hoje: '2026-11-06', saldo: 300, eventos: [{ d: '2026-11-12', v: -250, n: 'Conta' }], fontes: [{ n: 'Caixinha', v: 400 }] }));
  assert.equal(r.saques.length, 1);
  assert.equal(r.saques[0].d, '2026-11-11');
  assert.equal(r.saques[0].v, 0);
  assert.equal(r.saques[0].usa[0].v, 400);
  assert.equal(r.total, 0);
  assert.ok(r.dias.every(d => d.saldo >= 200));
});

test('sem aperto, a fonte fica onde está', () => {
  const r = J(C.planejar({ hoje: '2026-11-06', saldo: 5000, eventos: [{ d: '2026-11-10', v: -1000, n: 'x' }], fontes: [{ n: 'Caixinha', v: 400 }] }));
  assert.equal(r.saques.length, 0);
  assert.equal(r.usado, 0);
});

test('feriado bancário: o resgate volta para o dia útil anterior', () => {
  assert.equal(C._pascoa(2026), '2026-04-05');
  assert.equal(C._pascoa(2027), '2027-03-28');
  assert.equal(C.diaUtilAntes('2026-11-21', '2026-11-01'), '2026-11-19');   // 20/11 (sexta) é feriado
  assert.equal(C.diaUtilAntes('2026-12-26', '2026-12-01'), '2026-12-23');   // 24 e 25/12 sem banco
  assert.equal(C.diaUtilAntes('2027-02-10', '2027-02-01'), '2027-02-05');   // carnaval 8 e 9/02/2027
  assert.equal(C.diaUtil('2027-03-26'), false);                              // sexta-feira santa
  assert.equal(C.diaUtil('2026-11-19'), true);
  const r = J(C.planejar({ hoje: '2026-11-16', saldo: 300, eventos: [{ d: '2026-11-21', v: -1000, n: 'Conta' }] }));
  assert.equal(r.saques[0].d, '2026-11-19');
});
