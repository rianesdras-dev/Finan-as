/* ════════════════════════════════════════════════════════════════════
   caixa.js — quando tirar dinheiro da reserva

   Simula o saldo da conta corrente dia a dia (saídas com data, entradas
   com data, gasto do dia a dia) e diz em que dia útil (sem fim de semana
   nem feriado bancário) resgatar quanto,
   para a conta nunca ficar abaixo de um colchão (o cheque especial cobra
   juros e IOF todo dia; a reserva rende). Junta os saques: cada um cobre
   até `janela` dias ou até o próximo dinheiro grande que entra.

   Caixa.planejar({
     hoje:     'YYYY-MM-DD',
     saldo:    número       saldo da conta hoje (pode ser negativo)
     eventos:  [{ d:'YYYY-MM-DD', v: número (+ entra, − sai), n: texto, id?, incerto?: bool }]
     fontes?:  [{ n: texto, v: número, id? }]   dinheiro fora da reserva e sem destino
               (caixinha livre, saldo parado na corretora): vai inteiro para a conta
               no primeiro aperto, antes de mexer na reserva
     colchao?: 200, janela?: 14, arredonda?: 50, ate?: 'YYYY-MM-DD'
   }) -> {
     saques:   [{ d, v, usa: [{ n, v, id }], cobre: [{ d, n, v, id }], urgente: bool }]
               d = dia útil; v = quanto resgatar da reserva (pode ser 0 se as fontes bastam);
               usa = fontes para passar para a conta nesse dia
     total,    só o que sai da reserva
     usado,    o que sai das fontes
     saldoFinal,
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

  // Páscoa (algoritmo de Meeus) para os feriados que mudam de data
  function pascoa(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const n = h + l - 7 * m + 114;
    return iso(new Date(Date.UTC(y, Math.floor(n / 31) - 1, (n % 31) + 1)));
  }
  // dias sem banco: feriados nacionais, carnaval, sexta-feira santa, Corpus Christi e 24 e 31/12
  const FIXOS = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '11-20', '12-24', '12-25', '12-31'];
  const moveis = {};
  function feriado(s) {
    if (FIXOS.includes(s.slice(5))) return true;
    const y = +s.slice(0, 4);
    if (!moveis[y]) { const p = pascoa(y); moveis[y] = [-48, -47, -2, 60].map(k => soma(p, k)); }
    return moveis[y].includes(s);
  }
  const diaUtil = s => !fimDeSemana(s) && !feriado(s);

  // último dia útil antes de `d` (fim de semana e feriado voltam para o dia útil anterior), nunca antes de hoje
  function diaUtilAntes(d, hoje) {
    let x = soma(d, -1);
    while (!diaUtil(x)) x = soma(x, -1);
    if (x < hoje) x = hoje;
    return x;
  }

  function planejar(entrada) {
    const e = entrada || {};
    const hoje = e.hoje, colchao = e.colchao != null ? e.colchao : 200, janela = e.janela || 14, arred = e.arredonda || 50;
    const eventos = (e.eventos || []).filter(x => x && x.d && isFinite(x.v) && x.v !== 0);
    const certos = eventos.filter(x => !(x.incerto && x.v > 0));
    const incertos = eventos.filter(x => x.incerto && x.v > 0).map(x => ({ d: x.d < hoje ? hoje : x.d, n: x.n, v: centavos(x.v) }));
    let fontes = (e.fontes || []).filter(f => f && isFinite(f.v) && f.v > 0).map(f => ({ n: f.n, v: centavos(f.v), id: f.id }));
    const ultimo = e.ate || certos.reduce((m, x) => (x.d > m ? x.d : m), hoje);
    // dias do período e o movimento previsto de cada um
    const dias = [];
    for (let d = hoje; d <= ultimo; d = soma(d, 1)) dias.push(d);
    const mov = {}, itens = {};
    for (const x of certos) {
      const d = x.d < hoje ? hoje : x.d;       // o que já devia ter saído e não saiu, sai hoje
      if (d > ultimo) continue;
      mov[d] = (mov[d] || 0) + x.v;
      const it = { d, n: x.n, v: centavos(x.v) };
      if (x.id != null) it.id = x.id;
      (itens[d] = itens[d] || []).push(it);
    }
    const resgates = {}, extra = {};           // dia -> valor já planejado (da reserva / das fontes)
    const saldoNoFim = () => {                 // saldo no fim de cada dia com o que já foi planejado
      let s = e.saldo || 0; const out = {};
      for (const d of dias) { s += (mov[d] || 0) + (resgates[d] || 0) + (extra[d] || 0); out[d] = s; }
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
      const quando = diaUtilAntes(falta, hoje);
      let s = saques.find(x => x.d === quando);
      if (!s) { s = { d: quando, v: 0, usa: [], cobre: [], urgente: quando === hoje && (e.saldo || 0) < 0 }; saques.push(s); }
      for (const d of dias) if (d >= quando && d <= fim) (itens[d] || []).filter(x => x.v < 0).forEach(c => {
        if (!s.cobre.some(o => o.d === c.d && o.n === c.n && o.v === c.v)) s.cobre.push(c);
      });
      // primeiro o dinheiro parado fora da reserva; depois, se ainda faltar, a reserva
      if (fontes.length) {
        for (const f of fontes) { extra[quando] = (extra[quando] || 0) + f.v; s.usa.push(f); }
        fontes = [];
        continue;
      }
      let menor = Infinity;
      for (const d of dias) if (d >= falta && d <= fim && sf[d] < menor) menor = sf[d];
      const v = Math.ceil((colchao - menor) / arred) * arred;
      resgates[quando] = (resgates[quando] || 0) + v;
      s.v += v;
    }
    saques.sort((a, b) => (a.d < b.d ? -1 : 1));
    const sf = saldoNoFim();
    return {
      saques,
      total: saques.reduce((t, x) => t + x.v, 0),
      usado: centavos(saques.reduce((t, x) => t + x.usa.reduce((u, f) => u + f.v, 0), 0)),
      saldoFinal: centavos(dias.length ? sf[dias[dias.length - 1]] : (e.saldo || 0)),
      incertos,
      dias: dias.map(d => ({ d, saldo: centavos(sf[d]) })),
    };
  }

  raiz.Caixa = { planejar, diaUtilAntes, diaUtil, _soma: soma, _pascoa: pascoa };
})(typeof globalThis !== 'undefined' ? globalThis : this);
