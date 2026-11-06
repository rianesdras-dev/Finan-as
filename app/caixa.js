/* ════════════════════════════════════════════════════════════════════
   caixa.js — quando tirar dinheiro da reserva

   Simula o saldo da conta corrente dia a dia (saídas com data, entradas
   com data, gasto do dia a dia) e diz em que dia útil resgatar quanto,
   para a conta nunca ficar abaixo de um colchão (o cheque especial cobra
   juros e IOF todo dia; a reserva rende). Junta os saques: cada um cobre
   até `janela` dias ou até o próximo dinheiro grande que entra.

   Caixa.planejar({
     hoje:     'YYYY-MM-DD',
     saldo:    número       saldo da conta hoje (pode ser negativo)
     eventos:  [{ d:'YYYY-MM-DD', v: número (+ entra, − sai), n: texto, incerto?: bool }]
     colchao?: 200, janela?: 14, arredonda?: 50, ate?: 'YYYY-MM-DD'
   }) -> {
     saques:   [{ d, v, cobre: [{ d, n, v }], urgente: bool }],   d = dia útil para resgatar
     saldoFinal, total,
     incertos: [{ d, n, v }],      entradas incertas: não entram na conta; se vierem, devolva à reserva
     dias:     [{ d, saldo }]      saldo previsto no fim de cada dia, já com os saques
   }
   Puro: sem DOM e sem relógio (tudo vem por parâmetro).
   ════════════════════════════════════════════════════════════════════ */
(function (raiz) {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const iso = dt => dt.getUTCFullYear() + '-' + pad(dt.getUTCMonth() + 1) + '-' + pad(dt.getUTCDate());
  const data = s => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  const soma = (s, k) => { const d = data(s); d.setUTCDate(d.getUTCDate() + k); return iso(d); };
  const fimDeSemana = s => { const w = data(s).getUTCDay(); return w === 0 || w === 6; };
  const centavos = v => Math.round(v * 100) / 100;

  // último dia útil antes de `d` (sábado/domingo voltam para sexta), nunca antes de hoje
  function diaUtilAntes(d, hoje) {
    let x = soma(d, -1);
    while (fimDeSemana(x)) x = soma(x, -1);
    if (x < hoje) x = hoje;
    return x;
  }

  function planejar(entrada) {
    const e = entrada || {};
    const hoje = e.hoje, colchao = e.colchao != null ? e.colchao : 200, janela = e.janela || 14, arred = e.arredonda || 50;
    const eventos = (e.eventos || []).filter(x => x && x.d && isFinite(x.v) && x.v !== 0);
    const certos = eventos.filter(x => !(x.incerto && x.v > 0));
    const incertos = eventos.filter(x => x.incerto && x.v > 0).map(x => ({ d: x.d < hoje ? hoje : x.d, n: x.n, v: centavos(x.v) }));
    const ultimo = e.ate || certos.reduce((m, x) => (x.d > m ? x.d : m), hoje);
    // dias do período e o movimento previsto de cada um
    const dias = [];
    for (let d = hoje; d <= ultimo; d = soma(d, 1)) dias.push(d);
    const mov = {}, itens = {};
    for (const x of certos) {
      const d = x.d < hoje ? hoje : x.d;       // o que já devia ter saído e não saiu, sai hoje
      if (d > ultimo) continue;
      mov[d] = (mov[d] || 0) + x.v;
      (itens[d] = itens[d] || []).push({ d, n: x.n, v: centavos(x.v) });
    }
    const resgates = {};                       // dia -> valor já planejado
    const saldoNoFim = () => {                 // saldo no fim de cada dia com os saques planejados até agora
      let s = e.saldo || 0; const out = {};
      for (const d of dias) { s += (mov[d] || 0) + (resgates[d] || 0); out[d] = s; }
      return out;
    };
    const saques = [];
    for (let guarda = 0; guarda < 400; guarda++) {
      const sf = saldoNoFim();
      const falta = dias.find(d => sf[d] < colchao - 0.005);
      if (!falta) break;
      // cobre até `janela` dias, ou até a véspera do próximo dinheiro grande que entra (≥ R$ 300)
      let fim = soma(falta, janela - 1);
      const proxEntrada = dias.find(d => d > falta && (mov[d] || 0) >= 300);
      if (proxEntrada && soma(proxEntrada, -1) < fim) fim = soma(proxEntrada, -1);
      if (fim > ultimo) fim = ultimo;
      let menor = Infinity;
      for (const d of dias) if (d >= falta && d <= fim && sf[d] < menor) menor = sf[d];
      const v = Math.ceil((colchao - menor) / arred) * arred;
      const quando = diaUtilAntes(falta, hoje);
      resgates[quando] = (resgates[quando] || 0) + v;
      const cobre = [];
      for (const d of dias) if (d >= quando && d <= fim) (itens[d] || []).filter(x => x.v < 0).forEach(x => cobre.push(x));
      const ja = saques.find(s => s.d === quando);
      if (ja) { ja.v += v; cobre.forEach(c => { if (!ja.cobre.some(o => o.d === c.d && o.n === c.n && o.v === c.v)) ja.cobre.push(c); }); }
      else saques.push({ d: quando, v, cobre, urgente: quando === hoje && (e.saldo || 0) < 0 });
    }
    saques.sort((a, b) => (a.d < b.d ? -1 : 1));
    const sf = saldoNoFim();
    return {
      saques,
      total: saques.reduce((s, x) => s + x.v, 0),
      saldoFinal: centavos(dias.length ? sf[dias[dias.length - 1]] : (e.saldo || 0)),
      incertos,
      dias: dias.map(d => ({ d, saldo: centavos(sf[d]) })),
    };
  }

  raiz.Caixa = { planejar, diaUtilAntes, _soma: soma };
})(typeof globalThis !== 'undefined' ? globalThis : this);
