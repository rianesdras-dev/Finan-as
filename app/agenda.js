/* agenda.js: gera um arquivo de calendário (.ics, iCalendar / RFC 5545) com os lembretes das contas.
   Script clássico (sem módulos), carregado pela página com <script src="agenda.js">.
   Tudo roda no aparelho; o arquivo é baixado e importado pela pessoa no Google Agenda ou no
   Calendário do iPhone. Com TDAH, lembrete externo (que apita sozinho) vale mais que memória.

   API (globalThis.Agenda):
     gerar({ nome, eventos, agora? })        -> texto .ics (linhas CRLF, dobradas em 75 octetos)
     lembretesPadrao({ contas, fatura?, revisaoSemanal?, marcos?, hoje, meses? }) -> Evento[]
     tipoMime                                -> 'text/calendar;charset=utf-8'

   Evento = {
     uid: 'conta-c7@financeiro',             // estável: reimportar atualiza em vez de duplicar (quando o app suporta)
     titulo, descricao?,
     data: 'AAAA-MM-DD',                     // primeira ocorrência; evento de DIA INTEIRO
     repetir?: { freq:'MONTHLY'|'WEEKLY', ate?:'AAAA-MM-DD', vezes?:number,
                 diaSemana?:'MO'..'SU',      // WEEKLY; padrão = dia da semana de `data`
                 dia?:1..31 },               // MONTHLY; padrão = dia de `data` (útil quando `data` caiu
                                             //   num mês curto, ex.: conta do dia 31 começando em fevereiro)
     alarmes?: [{ diasAntes, hora:'HH:MM' }] // {1,'09:00'} -> 09:00 da véspera; {0,'08:00'} -> 08:00 do dia
   }

   Decisões de interoperabilidade (Google Agenda + Calendário da Apple):
   • Contas mensais em dia > 28. Pela RFC, BYMONTHDAY=31 PULA os meses sem dia 31 (e o 30 pula
     fevereiro) — e conta que vence "dia 30" vence no fim de fevereiro, não some. Então:
       dia 1..28 -> RRULE:FREQ=MONTHLY;BYMONTHDAY=d
       dia 31    -> RRULE:FREQ=MONTHLY;BYMONTHDAY=-1          ("último dia do mês"; é exatamente o
                    que os próprios Google Agenda e Calendário da Apple gravam para "todo último dia")
       dia 29/30 -> RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1   (dia 30)
                    RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1      (dia 29)
                    = "dia d, ou o último dia do mês se ele for mais curto". BYSETPOS é RFC 5545 puro,
                    lido por Google, Apple, Outlook e dateutil; não há forma mais simples de dizer isso.
     DTSTART é sempre ajustado para a primeira ocorrência real da regra (RFC 5545 §3.8.5.3: um
     DTSTART fora da regra vira uma ocorrência extra em alguns apps).
   • UNTIL vai como DATE (AAAAMMDD), do mesmo tipo do DTSTART de dia inteiro. COUNT quando `vezes`.
     Se vierem os dois, vale UNTIL (a RFC proíbe ambos na mesma regra).
   • Alarmes: TRIGGER relativo ao início do dia (00:00 local), ex.: -PT15H = 09:00 da véspera,
     PT8H = 08:00 do dia, -P1DT15H = 09:00 de dois dias antes. O Calendário da Apple respeita;
     o Google Agenda IGNORA os VALARM de arquivos importados e usa as "notificações padrão para
     eventos de dia inteiro" da agenda — a tela deve lembrar a pessoa de ativá-las.
   • Eventos de dia inteiro vão como TRANSP:TRANSPARENT (não marcam a pessoa como ocupada). */
(function (raiz) {
  'use strict';

  /* ── datas (tudo em UTC para não depender do fuso do aparelho) ── */

  const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
  const DIAS_SEMANA = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']; // índice = getUTCDay()

  // 'AAAA-MM-DD' -> Date em UTC à meia-noite; lança erro se a data não existir (ex.: 2026-02-30).
  function lerData(s) {
    const m = RE_DATA.exec(String(s || ''));
    if (!m) throw new Error('Data inválida (esperado AAAA-MM-DD): ' + s);
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCMonth() !== +m[2] - 1) throw new Error('Data inexistente: ' + s);
    return d;
  }
  const doisDig = n => String(n).padStart(2, '0');
  const isoData = d => d.getUTCFullYear() + '-' + doisDig(d.getUTCMonth() + 1) + '-' + doisDig(d.getUTCDate());
  const icsData = d => isoData(d).replace(/-/g, '');                      // 20261031
  const icsCarimbo = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20261020T123000Z
  const somarDias = (d, n) => new Date(d.getTime() + n * 86400000);
  const diasNoMes = (ano, mes0) => new Date(Date.UTC(ano, mes0 + 1, 0)).getUTCDate();

  // Dia em que uma conta "do dia `dia`" vence no mês dado: o próprio dia ou o último dia do mês.
  const diaEfetivo = (ano, mes0, dia) => Math.min(dia, diasNoMes(ano, mes0));

  // Primeira data >= `inicio` em que cai a conta mensal do dia `dia`.
  function proximaMensal(inicio, dia) {
    let ano = inicio.getUTCFullYear(), mes0 = inicio.getUTCMonth();
    if (inicio.getUTCDate() > diaEfetivo(ano, mes0, dia)) { mes0++; if (mes0 > 11) { mes0 = 0; ano++; } }
    return new Date(Date.UTC(ano, mes0, diaEfetivo(ano, mes0, dia)));
  }
  // Primeira data >= `inicio` no dia da semana pedido ('MO'..'SU').
  function proximaSemanal(inicio, diaSemana) {
    const alvo = DIAS_SEMANA.indexOf(diaSemana);
    return somarDias(inicio, (alvo - inicio.getUTCDay() + 7) % 7);
  }
  // Soma meses mantendo o dia quando possível (31/jan + 1 -> 28 ou 29/fev).
  function somarMeses(d, n) {
    const total = d.getUTCMonth() + n, ano = d.getUTCFullYear() + Math.floor(total / 12), mes0 = ((total % 12) + 12) % 12;
    return new Date(Date.UTC(ano, mes0, diaEfetivo(ano, mes0, d.getUTCDate())));
  }

  /* ── texto iCalendar ── */

  // Escapa um valor TEXT (RFC 5545 §3.3.11): \ ; , e quebras de linha.
  function escapar(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n');
  }

  // Bytes UTF-8 de um único caractere (code point).
  function octetos(cp) { return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; }

  // Dobra uma linha em pedaços de no máximo 75 OCTETOS (RFC 5545 §3.1). As continuações começam
  // com um espaço, que conta nos 75. Percorre por code point, então nunca parte um caractere
  // multibyte (acento, emoji) nem um par substituto do JavaScript.
  function dobrar(linha) {
    const partes = [];
    let atual = '', tam = 0, limite = 75;
    for (const ch of linha) {
      const n = octetos(ch.codePointAt(0));
      if (tam + n > limite) {
        partes.push(atual);
        atual = ''; tam = 0; limite = 74; // 74 + o espaço inicial = 75
      }
      atual += ch; tam += n;
    }
    partes.push(atual);
    return partes.join('\r\n ');
  }

  // Duração RFC 5545 a partir de minutos (pode ser negativa): -PT15H, PT8H, -P1DT15H, PT0S.
  function duracao(min) {
    const sinal = min < 0 ? '-' : '';
    let resto = Math.abs(min);
    if (resto === 0) return 'PT0S';
    const d = Math.floor(resto / 1440); resto %= 1440;
    const h = Math.floor(resto / 60), m = resto % 60;
    let s = sinal + 'P' + (d ? d + 'D' : '');
    if (h || m) s += 'T' + (h ? h + 'H' : '') + (m ? m + 'M' : '');
    return s;
  }

  // Alarme -> minutos relativos ao início do evento de dia inteiro (00:00 do dia).
  function minutosDoAlarme(a) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(a.hora || ''));
    if (!m || +m[1] > 23 || +m[2] > 59) throw new Error('Hora de alarme inválida (esperado HH:MM): ' + a.hora);
    const dias = Math.max(0, Math.floor(Number(a.diasAntes) || 0));
    return +m[1] * 60 + +m[2] - dias * 1440;
  }

  /* ── recorrência ── */

  // Monta a RRULE e devolve também o DTSTART ajustado à primeira ocorrência real da regra.
  function recorrencia(inicio, rep) {
    let partes, primeira;
    if (rep.freq === 'MONTHLY') {
      const dia = rep.dia != null ? Math.floor(Number(rep.dia)) : inicio.getUTCDate();
      if (!(dia >= 1 && dia <= 31)) throw new Error('Dia do mês inválido: ' + rep.dia);
      primeira = proximaMensal(inicio, dia);
      let por;
      if (dia <= 28) por = 'BYMONTHDAY=' + dia;
      else if (dia === 31) por = 'BYMONTHDAY=-1';
      else por = 'BYMONTHDAY=' + [28, 29, 30].filter(x => x <= dia).join(',') + ';BYSETPOS=-1';
      partes = ['FREQ=MONTHLY', por];
    } else if (rep.freq === 'WEEKLY') {
      const ds = rep.diaSemana || DIAS_SEMANA[inicio.getUTCDay()];
      if (DIAS_SEMANA.indexOf(ds) < 0) throw new Error('Dia da semana inválido: ' + rep.diaSemana);
      primeira = proximaSemanal(inicio, ds);
      partes = ['FREQ=WEEKLY', 'BYDAY=' + ds];
    } else {
      throw new Error('Frequência não suportada: ' + rep.freq);
    }
    if (rep.ate) partes.push('UNTIL=' + icsData(lerData(rep.ate)));
    else if (rep.vezes) partes.push('COUNT=' + Math.max(1, Math.floor(Number(rep.vezes))));
    return { rrule: 'RRULE:' + partes.join(';'), primeira };
  }

  /* ── gerar o arquivo ── */

  function linhasDoEvento(ev, carimbo) {
    if (!ev || !ev.uid) throw new Error('Evento sem uid');
    let inicio = lerData(ev.data), rrule = null;
    if (ev.repetir) ({ rrule, primeira: inicio } = recorrencia(inicio, ev.repetir));
    const L = [
      'BEGIN:VEVENT',
      'UID:' + escapar(ev.uid),
      'DTSTAMP:' + carimbo,
      'DTSTART;VALUE=DATE:' + icsData(inicio),
      'DTEND;VALUE=DATE:' + icsData(somarDias(inicio, 1)), // fim exclusivo: o dia seguinte
      'SUMMARY:' + escapar(ev.titulo),
    ];
    if (ev.descricao) L.push('DESCRIPTION:' + escapar(ev.descricao));
    if (rrule) L.push(rrule);
    L.push('TRANSP:TRANSPARENT');
    for (const a of ev.alarmes || []) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY',
        'DESCRIPTION:' + escapar(ev.titulo),
        'TRIGGER:' + duracao(minutosDoAlarme(a)),
        'END:VALARM');
    }
    L.push('END:VEVENT');
    return L;
  }

  function gerar(op) {
    op = op || {};
    const carimbo = icsCarimbo(op.agora instanceof Date ? op.agora : new Date());
    const L = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Financeiro//Lembretes de contas//PT-BR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:' + escapar(op.nome || 'Financeiro'),
    ];
    for (const ev of op.eventos || []) L.push(...linhasDoEvento(ev, carimbo));
    L.push('END:VCALENDAR');
    return L.map(dobrar).join('\r\n') + '\r\n';
  }

  /* ── lembretes prontos a partir dos dados do app ── */

  // 2583.4 -> 'R$ 2.583' (valor redondo: o título é para bater o olho, não para conferir centavos).
  function reais(v) {
    const n = Math.round(Math.abs(Number(v)));
    return 'R$ ' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  const temValor = v => v != null && v !== '' && isFinite(Number(v)) && Number(v) !== 0;

  // Hash FNV-1a curto, para uid estável dos marcos (que não têm id).
  function hash(s) {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }

  const ALARMES_CONTA = [{ diasAntes: 2, hora: '09:00' }, { diasAntes: 0, hora: '08:00' }];

  function lembretesPadrao(op) {
    op = op || {};
    const hoje = lerData(op.hoje);
    const meses = Math.max(1, Math.floor(Number(op.meses) || 12));
    const ate = isoData(somarMeses(hoje, meses));
    const eventos = [];

    // Uma recorrência mensal por conta, a partir do próximo vencimento (inclusive hoje).
    const mensal = (uid, titulo, dia, descricao) => {
      eventos.push({
        uid, titulo, descricao,
        data: isoData(proximaMensal(hoje, dia)),
        repetir: { freq: 'MONTHLY', dia, vezes: meses },
        alarmes: ALARMES_CONTA.map(a => ({ ...a })),
      });
    };
    const lerDia = d => { const n = Math.floor(Number(d)); return d != null && d !== '' && n >= 1 && n <= 31 ? n : null; };
    const textoDia = dia => 'Vence todo dia ' + dia + (dia > 28 ? ' (nos meses mais curtos, no último dia)' : '') + '.';

    for (const c of op.contas || []) {
      const dia = lerDia(c && c.dia);
      if (!dia) continue; // conta sem dia de vencimento: não dá para lembrar
      const titulo = 'Pagar ' + (c.nome || 'conta') + (temValor(c.v) ? ' (' + reais(c.v) + ')' : '');
      mensal('conta-' + c.id + '@financeiro', titulo, dia,
        textoDia(dia) + '\nDepois de pagar, guarde o comprovante no Financeiro.');
    }

    const diaFatura = op.fatura && lerDia(op.fatura.dia);
    if (diaFatura) {
      mensal('fatura-cartao@financeiro',
        'Pagar fatura do cartão' + (temValor(op.fatura.v) ? ' (' + reais(op.fatura.v) + ')' : ''), diaFatura,
        textoDia(diaFatura) + '\nAntes de pagar, importe a fatura no Financeiro e confira os gastos.' +
        '\nDepois de pagar, guarde o comprovante.');
    }

    // Revisão semanal: ligada por padrão (domingo 19:00); `revisaoSemanal: false` desliga.
    if (op.revisaoSemanal !== false) {
      const r = op.revisaoSemanal || {};
      const diaSemana = r.diaSemana || 'SU', hora = r.hora || '19:00';
      eventos.push({
        uid: 'revisao-semanal@financeiro',
        titulo: 'Revisão de 5 min do Financeiro',
        descricao: 'Só 5 minutos: importe o extrato ou a fatura, confira o que é novo e guarde os comprovantes da semana.',
        data: isoData(proximaSemanal(hoje, diaSemana)),
        repetir: { freq: 'WEEKLY', diaSemana, ate },
        alarmes: [{ diasAntes: 0, hora }],
      });
    }

    // Marcos: eventos únicos (de hoje em diante), com aviso na véspera e no dia.
    for (const m of op.marcos || []) {
      if (!m || !RE_DATA.test(m.d || '') || !m.t) continue;
      if (lerData(m.d) < hoje) continue;
      eventos.push({
        uid: 'marco-' + hash(m.d + '|' + m.t) + '@financeiro',
        titulo: m.t, data: m.d,
        alarmes: [{ diasAntes: 1, hora: '09:00' }, { diasAntes: 0, hora: '08:00' }],
      });
    }
    return eventos;
  }

  raiz.Agenda = {
    gerar, lembretesPadrao,
    tipoMime: 'text/calendar;charset=utf-8',
    // partes internas expostas para os testes
    _dobrar: dobrar, _escapar: escapar, _duracao: duracao, _proximaMensal: (d, dia) => isoData(proximaMensal(lerData(d), dia)),
  };
})(globalThis);
