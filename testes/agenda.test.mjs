// Testes de app/agenda.js (gerador de .ics). Contas, valores e datas abaixo são INVENTADOS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

function carregar() {
  const ctx = { console, Date, Math, JSON, Intl };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(new URL('../app/agenda.js', import.meta.url), 'utf8'), ctx, { filename: 'agenda.js' });
  return ctx.Agenda;
}
const A = carregar();
const AGORA = new Date(Date.UTC(2026, 9, 20, 12, 30, 5));
const enc = new TextEncoder();

// Desdobra (RFC 5545 §3.1) e devolve as linhas lógicas.
const desdobrar = ics => ics.replace(/\r\n[ \t]/g, '').split('\r\n').filter(Boolean);
// Linhas lógicas de cada VEVENT.
function eventosDe(ics) {
  const out = []; let atual = null;
  for (const l of desdobrar(ics)) {
    if (l === 'BEGIN:VEVENT') atual = [];
    else if (l === 'END:VEVENT') { out.push(atual); atual = null; }
    else if (atual) atual.push(l);
  }
  return out;
}
const prop = (linhas, nome) => (linhas.find(l => l.startsWith(nome + ':') || l.startsWith(nome + ';')) || '').replace(/^[^:]*:/, '');
const um = (ev, agora = AGORA) => eventosDe(A.gerar({ nome: 'Teste', eventos: [ev], agora }))[0];

/* ── estrutura ── */

test('estrutura: cabeçalho, CRLF, DTSTAMP UTC, dia inteiro com DTEND no dia seguinte', () => {
  const ics = A.gerar({ nome: 'Contas', agora: AGORA, eventos: [{ uid: 'x@financeiro', titulo: 'Oi', data: '2026-12-31' }] });
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'toda quebra é CRLF');
  const L = desdobrar(ics);
  assert.equal(L[0], 'BEGIN:VCALENDAR');
  assert.equal(L.at(-1), 'END:VCALENDAR');
  for (const p of ['VERSION:2.0', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Contas']) assert.ok(L.includes(p), p);
  assert.ok(L.some(l => /^PRODID:.+/.test(l)));
  const ev = eventosDe(ics)[0];
  assert.equal(prop(ev, 'UID'), 'x@financeiro');
  assert.equal(prop(ev, 'DTSTAMP'), '20261020T123005Z');
  assert.ok(ev.includes('DTSTART;VALUE=DATE:20261231'));
  assert.ok(ev.includes('DTEND;VALUE=DATE:20270101'));
  assert.ok(!ev.some(l => l.startsWith('RRULE')));
});

test('datas inválidas são recusadas', () => {
  assert.throws(() => A.gerar({ eventos: [{ uid: 'a', titulo: 't', data: '2026-02-30' }] }));
  assert.throws(() => A.gerar({ eventos: [{ uid: 'a', titulo: 't', data: '20/10/2026' }] }));
  assert.throws(() => A.gerar({ eventos: [{ titulo: 't', data: '2026-10-20' }] }));
});

/* ── dobra e escape ── */

test('dobra: nenhuma linha física passa de 75 octetos, nem parte acento ou emoji', () => {
  const titulo = 'Pagar condomínio e água ação 💸🏥 ' + 'ção🎉é'.repeat(40) + ' 👨‍⚕️ fim';
  const ics = A.gerar({ nome: 'Lembretes do Financeiro — médica 🩺', agora: AGORA, eventos: [{ uid: 'u', titulo, descricao: titulo, data: '2026-11-05' }] });
  for (const l of ics.split('\r\n')) {
    assert.ok(enc.encode(l).length <= 75, 'linha com ' + enc.encode(l).length + ' octetos');
    assert.ok(!l.includes('�'));
    // nenhum pedaço começa/termina no meio de um par substituto
    assert.ok(!/^[\uDC00-\uDFFF]/.test(l.replace(/^ /, '')) && !/[\uD800-\uDBFF]$/.test(l));
  }
  assert.equal(prop(eventosDe(ics)[0], 'SUMMARY'), titulo);
  // os octetos de cada linha formam UTF-8 válido sozinhos
  for (const l of ics.split('\r\n')) new TextDecoder('utf-8', { fatal: true }).decode(enc.encode(l));
});

test('dobra: limites exatos de 75 e continuação com espaço', () => {
  const l75 = 'X'.repeat(75);
  assert.equal(A._dobrar(l75), l75);
  assert.equal(A._dobrar('X'.repeat(76)), 'X'.repeat(75) + '\r\n X');
  // 'é' tem 2 octetos: 74 'a' + 'é' = 76 -> o 'é' inteiro vai para a próxima linha
  assert.equal(A._dobrar('a'.repeat(74) + 'é'), 'a'.repeat(74) + '\r\n é');
  // emoji de 4 octetos
  assert.equal(A._dobrar('a'.repeat(73) + '💸'), 'a'.repeat(73) + '\r\n 💸');
});

test('escape de TEXT: \\ ; , e quebras de linha', () => {
  assert.equal(A._escapar('a\\b;c,d\ne\r\nf'), 'a\\\\b\\;c\\,d\\ne\\nf');
  const ev = um({ uid: 'u', titulo: 'Luz; água, gás', descricao: 'linha 1\nlinha 2', data: '2026-11-05' });
  assert.equal(prop(ev, 'SUMMARY'), 'Luz\\; água\\, gás');
  assert.equal(prop(ev, 'DESCRIPTION'), 'linha 1\\nlinha 2');
  const ics = A.gerar({ nome: 'A, B; C', eventos: [] });
  assert.ok(ics.includes('X-WR-CALNAME:A\\, B\\; C\r\n'));
});

/* ── RRULE ── */

test('RRULE mensal: dias 5, 15, 29, 30, 31', () => {
  const r = (data, dia) => { const ev = um({ uid: 'u', titulo: 't', data, repetir: { freq: 'MONTHLY', dia } }); return [prop(ev, 'RRULE'), prop(ev, 'DTSTART')]; };
  assert.deepEqual(r('2026-10-20', 5), ['FREQ=MONTHLY;BYMONTHDAY=5', '20261105']);
  assert.deepEqual(r('2026-10-15', 15), ['FREQ=MONTHLY;BYMONTHDAY=15', '20261015']);
  assert.deepEqual(r('2027-02-01', 29), ['FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1', '20270228']);
  assert.deepEqual(r('2026-10-20', 30), ['FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1', '20261030']);
  assert.deepEqual(r('2027-02-10', 30), ['FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1', '20270228']);
  assert.deepEqual(r('2026-11-01', 31), ['FREQ=MONTHLY;BYMONTHDAY=-1', '20261130']);
  // sem `dia`: usa o dia de `data`
  assert.equal(prop(um({ uid: 'u', titulo: 't', data: '2026-10-31', repetir: { freq: 'MONTHLY' } }), 'RRULE'), 'FREQ=MONTHLY;BYMONTHDAY=-1');
});

test('RRULE semanal, UNTIL como DATE e COUNT', () => {
  const ev = um({ uid: 'u', titulo: 't', data: '2026-10-20', repetir: { freq: 'WEEKLY', diaSemana: 'SU', ate: '2027-10-20' } });
  assert.equal(prop(ev, 'RRULE'), 'FREQ=WEEKLY;BYDAY=SU;UNTIL=20271020');
  assert.equal(prop(ev, 'DTSTART'), '20261025'); // primeiro domingo a partir de 20/10/2026 (terça)
  const c = um({ uid: 'u', titulo: 't', data: '2026-10-20', repetir: { freq: 'MONTHLY', vezes: 12 } });
  assert.equal(prop(c, 'RRULE'), 'FREQ=MONTHLY;BYMONTHDAY=20;COUNT=12');
  const ambos = um({ uid: 'u', titulo: 't', data: '2026-10-20', repetir: { freq: 'MONTHLY', vezes: 3, ate: '2027-01-01' } });
  assert.equal(prop(ambos, 'RRULE'), 'FREQ=MONTHLY;BYMONTHDAY=20;UNTIL=20270101');
  assert.throws(() => um({ uid: 'u', titulo: 't', data: '2026-10-20', repetir: { freq: 'DAILY' } }));
});

/* ── alarmes ── */

test('alarmes: TRIGGER relativo ao início do dia inteiro', () => {
  assert.equal(A._duracao(-15 * 60), '-PT15H');
  assert.equal(A._duracao(8 * 60), 'PT8H');
  assert.equal(A._duracao(0), 'PT0S');
  assert.equal(A._duracao(-(2 * 1440 - 540)), '-P1DT15H');
  assert.equal(A._duracao(19 * 60 + 30), 'PT19H30M');
  const ev = um({ uid: 'u', titulo: 'Pagar luz', data: '2026-11-05', alarmes: [
    { diasAntes: 1, hora: '09:00' }, { diasAntes: 0, hora: '08:00' }, { diasAntes: 2, hora: '09:00' }, { diasAntes: 3, hora: '23:45' }] });
  const triggers = ev.filter(l => l.startsWith('TRIGGER:')).map(l => l.slice(8));
  assert.deepEqual(triggers, ['-PT15H', 'PT8H', '-P1DT15H', '-P2DT15M']);
  assert.equal(ev.filter(l => l === 'BEGIN:VALARM').length, 4);
  assert.equal(ev.filter(l => l === 'ACTION:DISPLAY').length, 4);
  assert.equal(ev.filter(l => l === 'DESCRIPTION:Pagar luz').length, 4);
  assert.throws(() => um({ uid: 'u', titulo: 't', data: '2026-11-05', alarmes: [{ diasAntes: 0, hora: '25:00' }] }));
});

/* ── lembretesPadrao ── */

const CONTAS = [
  { id: 'c7', nome: 'Aluguel + condomínio', dia: 5, v: 2583.4 },
  { id: 'c8', nome: 'Internet', dia: 15, v: 99.9 },
  { id: 'c9', nome: 'Plano de saúde', dia: 30, v: 1234 },
  { id: 'c10', nome: 'Conselho (anuidade parcelada)', dia: 31, v: 87 },
  { id: 'c11', nome: 'Sem dia', v: 50 },
  { id: 'c12', nome: 'Doação', dia: 20 },
];

test('lembretesPadrao: contas, fatura, revisão semanal e marcos', () => {
  const evs = A.lembretesPadrao({ contas: CONTAS, fatura: { dia: 10, v: 3456.78 }, marcos: [
    { d: '2026-12-01', t: 'Prova de título' }, { d: '2026-01-01', t: 'passado' }], hoje: '2026-10-20' });
  const porUid = Object.fromEntries(evs.map(e => [e.uid, e]));
  assert.ok(!Object.values(porUid).some(e => /Sem dia/.test(e.titulo)), 'conta sem dia é ignorada');
  const aluguel = porUid['conta-c7@financeiro'];
  assert.equal(aluguel.titulo, 'Pagar Aluguel + condomínio (R$ 2.583)');
  assert.equal(aluguel.data, '2026-11-05');
  assert.deepEqual(JSON.parse(JSON.stringify(aluguel.repetir)), { freq: 'MONTHLY', dia: 5, vezes: 12 });
  assert.deepEqual(JSON.parse(JSON.stringify(aluguel.alarmes)), [{ diasAntes: 2, hora: '09:00' }, { diasAntes: 0, hora: '08:00' }]);
  assert.equal(porUid['conta-c9@financeiro'].data, '2026-10-30');
  assert.equal(porUid['conta-c10@financeiro'].data, '2026-10-31');
  assert.equal(porUid['conta-c12@financeiro'].titulo, 'Pagar Doação');
  assert.equal(porUid['conta-c12@financeiro'].data, '2026-10-20', 'vence hoje: entra hoje');
  assert.equal(porUid['fatura-cartao@financeiro'].titulo, 'Pagar fatura do cartão (R$ 3.457)');
  assert.equal(porUid['fatura-cartao@financeiro'].data, '2026-11-10');
  const rev = porUid['revisao-semanal@financeiro'];
  assert.equal(rev.titulo, 'Revisão de 5 min do Financeiro');
  assert.deepEqual(JSON.parse(JSON.stringify(rev.repetir)), { freq: 'WEEKLY', diaSemana: 'SU', ate: '2027-10-20' });
  assert.equal(rev.data, '2026-10-25');
  assert.deepEqual(JSON.parse(JSON.stringify(rev.alarmes)), [{ diasAntes: 0, hora: '19:00' }]);
  const marcos = evs.filter(e => e.uid.startsWith('marco-'));
  assert.equal(marcos.length, 1);
  assert.equal(marcos[0].titulo, 'Prova de título');
  assert.ok(!marcos[0].repetir);
  // uid estável entre chamadas
  const de_novo = A.lembretesPadrao({ contas: [], marcos: [{ d: '2026-12-01', t: 'Prova de título' }], hoje: '2026-10-20' });
  assert.equal(de_novo.find(e => e.uid.startsWith('marco-')).uid, marcos[0].uid);
  // opções
  const sem = A.lembretesPadrao({ contas: [], revisaoSemanal: false, hoje: '2026-10-20' });
  assert.equal(sem.length, 0);
  const seis = A.lembretesPadrao({ contas: CONTAS.slice(0, 1), revisaoSemanal: { diaSemana: 'WE', hora: '20:30' }, hoje: '2026-10-20', meses: 6 });
  assert.equal(seis[0].repetir.vezes, 6);
  assert.equal(seis[1].data, '2026-10-21');
  assert.equal(seis[1].repetir.ate, '2027-04-20');
  // gera um .ics válido
  assert.match(A.gerar({ nome: 'Financeiro', eventos: evs, agora: AGORA }), /BEGIN:VCALENDAR/);
});

/* ── validação com um parser de verdade (icalendar + dateutil do Python) ── */

const temPython = (() => {
  try { execFileSync('python3', ['-c', 'import icalendar, dateutil'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

const SCRIPT_PY = String.raw`
import sys, json
from icalendar import Calendar
from dateutil.rrule import rrulestr
cal = Calendar.from_ical(open(sys.argv[1], 'rb').read())
out = {'nome': str(cal.get('X-WR-CALNAME')), 'eventos': {}}
for ev in cal.walk('VEVENT'):
    ini = ev.decoded('DTSTART'); fim = ev.decoded('DTEND')
    item = {'titulo': str(ev.get('SUMMARY')), 'descricao': str(ev.get('DESCRIPTION', '')),
            'ini': ini.isoformat(), 'fim': fim.isoformat(),
            'alarmes': [a.decoded('TRIGGER').total_seconds() for a in ev.walk('VALARM')]}
    if ev.get('RRULE'):
        from datetime import datetime
        regra = ev.get('RRULE').to_ical().decode()
        r = rrulestr(regra, dtstart=datetime(ini.year, ini.month, ini.day))
        item['ocorrencias'] = [d.date().isoformat() for d in list(r[:14]) if True]
        item['total'] = r.count() if ('COUNT' in regra or 'UNTIL' in regra) else None
    out['eventos'][str(ev.get('UID'))] = item
print(json.dumps(out, ensure_ascii=False))
`;

function analisarNoPython(ics) {
  const dir = mkdtempSync(join(tmpdir(), 'agenda-'));
  try {
    writeFileSync(join(dir, 'a.ics'), ics);
    writeFileSync(join(dir, 'ler.py'), SCRIPT_PY);
    return JSON.parse(execFileSync('python3', ['-I', join(dir, 'ler.py'), join(dir, 'a.ics')], { encoding: 'utf8' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('parser real: icalendar lê o arquivo e dateutil expande as 14 primeiras ocorrências', { skip: !temPython && 'python3 com icalendar/dateutil indisponível' }, () => {
  const evs = A.lembretesPadrao({
    contas: [
      { id: 'd5', nome: 'Luz; água, gás', dia: 5, v: 300 },
      { id: 'd15', nome: 'Internet', dia: 15, v: 100 },
      { id: 'd29', nome: 'Seguro', dia: 29, v: 80 },
      { id: 'd30', nome: 'Plano de saúde 🏥 com acentuação longa para forçar a dobra da linha no arquivo', dia: 30, v: 1234 },
      { id: 'd31', nome: 'Anuidade', dia: 31, v: 87 },
    ],
    fatura: { dia: 10 }, marcos: [{ d: '2027-01-15', t: 'Residência: inscrição' }], hoje: '2026-10-20', meses: 14,
  });
  const ics = A.gerar({ nome: 'Financeiro — contas 🩺', eventos: evs, agora: AGORA });
  const r = analisarNoPython(ics);
  assert.equal(r.nome, 'Financeiro — contas 🩺'); // (o icalendar não desescapa X-WR-CALNAME; o escape já é testado acima)
  const E = r.eventos;
  assert.equal(E['conta-d5@financeiro'].titulo, 'Pagar Luz; água, gás (R$ 300)');
  assert.equal(E['conta-d30@financeiro'].titulo, 'Pagar Plano de saúde 🏥 com acentuação longa para forçar a dobra da linha no arquivo (R$ 1.234)');
  assert.ok(E['conta-d5@financeiro'].descricao.includes('\n'));

  // Datas esperadas calculadas de forma independente: dia d ou último dia do mês.
  const esperadas = (dia, desde) => {
    const out = []; let [a, m] = desde;
    while (out.length < 14) {
      const ult = new Date(Date.UTC(a, m, 0)).getUTCDate(); // m é 1..12
      const d = Math.min(dia, ult);
      const iso = a + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      if (iso >= '2026-10-20') out.push(iso);
      if (++m > 12) { m = 1; a++; }
    }
    return out;
  };
  for (const dia of [5, 15, 29, 30, 31]) {
    const e = E['conta-d' + dia + '@financeiro'];
    assert.deepEqual(e.ocorrencias, esperadas(dia, [2026, 10]), 'dia ' + dia);
    assert.equal(e.total, 14);
    assert.equal(e.ini, e.ocorrencias[0]);
    assert.deepEqual(e.alarmes, [-(39 * 3600), 8 * 3600]); // 09:00 de 2 dias antes; 08:00 do dia
  }
  // Conferências explícitas do fim de mês
  const d31 = E['conta-d31@financeiro'].ocorrencias;
  assert.ok(d31.includes('2026-11-30') && d31.includes('2027-02-28') && d31.includes('2027-04-30') && d31.includes('2027-01-31'));
  const d30 = E['conta-d30@financeiro'].ocorrencias;
  assert.ok(d30.includes('2027-02-28') && d30.includes('2027-03-30') && d30.includes('2027-01-30'));
  assert.ok(E['conta-d29@financeiro'].ocorrencias.includes('2027-02-28'));

  // Revisão semanal: todo domingo; 19:00 do dia; termina por UNTIL (14 meses ≈ 61 domingos).
  const rev = E['revisao-semanal@financeiro'];
  assert.equal(rev.ocorrencias[0], '2026-10-25');
  rev.ocorrencias.forEach((d, i) => {
    const dt = new Date(d + 'T00:00:00Z');
    assert.equal(dt.getUTCDay(), 0, d);
    if (i) assert.equal((dt - new Date(rev.ocorrencias[i - 1] + 'T00:00:00Z')) / 86400000, 7);
  });
  assert.deepEqual(rev.alarmes, [19 * 3600]);
  assert.ok(rev.total >= 60 && rev.total <= 62, 'total ' + rev.total);

  // Dia inteiro: DTEND = dia seguinte; marco sem recorrência, aviso na véspera 09:00 e no dia 08:00.
  const marco = Object.entries(E).find(([k]) => k.startsWith('marco-'))[1];
  assert.equal(marco.titulo, 'Residência: inscrição');
  assert.equal(marco.ini, '2027-01-15');
  assert.equal(marco.fim, '2027-01-16');
  assert.ok(!marco.ocorrencias);
  assert.deepEqual(marco.alarmes, [-15 * 3600, 8 * 3600]);
  assert.deepEqual(E['fatura-cartao@financeiro'].ocorrencias.slice(0, 3), ['2026-11-10', '2026-12-10', '2027-01-10']);
});

test('parser real: UNTIL e COUNT em eventos avulsos', { skip: !temPython && 'python3 com icalendar/dateutil indisponível' }, () => {
  const ics = A.gerar({ nome: 'X', agora: AGORA, eventos: [
    { uid: 'u1', titulo: 'até', data: '2026-01-31', repetir: { freq: 'MONTHLY', ate: '2026-06-30' } },
    { uid: 'u2', titulo: 'vezes', data: '2026-10-20', repetir: { freq: 'WEEKLY', diaSemana: 'FR', vezes: 3 } },
  ] });
  const E = analisarNoPython(ics).eventos;
  assert.deepEqual(E.u1.ocorrencias, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
  assert.deepEqual(E.u2.ocorrencias, ['2026-10-23', '2026-10-30', '2026-11-06']);
});
