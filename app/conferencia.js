/* conferencia.js: confere UMA fatura do cartão contra o que a pessoa esperava.
   Script clássico (sem módulos), carregado pela página depois de extrato.js.
   Função pura: não mexe na página nem no armazenamento; tudo roda no aparelho.

   API (globalThis.Conferencia):
     conferir(entrada)        -> Relatorio
     taxaTipo(desc)           -> 'iof'|'juros'|'anuidade'|'multa'|'tarifa'|'encargos'|'seguro'|null
     parecido(a, b, chave?)   -> número de palavras fortes em comum entre dois nomes (0 = nada em comum)

   entrada = {
     transacoes:  Transacao[]            linhas de UMA fatura (Extrato.ler/lerTexto): cobrança < 0, crédito > 0
     classificar: t => Classificacao     a página passa t => Extrato.classificar(t, regras)
     chave?:      desc => string         a página passa Extrato.chave
     esperados:   [{ id, nome, v, tipo:'assinatura'|'parcela'|'compra', k?, n? }]   itens do plano nesta fatura
     lancados:    [{ id, d:'AAAA-MM-DD', v, t }]   compras lançadas à mão neste cartão
     totalImpresso?: number|null         total impresso na fatura
     tolerancia?: number                 tolerância relativa de "mesmo valor" (padrão 0,03; nunca menos de R$ 0,50)
   }
   Sem `classificar`/`chave`, usa Extrato.classificar(t, {})/Extrato.chave se extrato.js estiver
   carregado; senão, versões simples daqui mesmo.

   Relatorio: ver `vazio()` no fim do arquivo. Cada cobrança (linha < 0) cai em UM só destes grupos:
     batem | valorMudou | lancadosAchados   casou com um item do plano ou com um lançamento à mão
     duplicadas (como `b`)                  a cobrança que parece repetida (a `a` segue o caminho normal)
     taxas                                  IOF, juros, anuidade... que não casaram com o plano
     parcelasNovas | assinaturasNovas       fora do plano, mas com cara de parcela/assinatura
     naoReconhecidos                        o resto: a pessoa confirma "é minha"
   `taxas` também lista as taxas que casaram com o plano ou ficaram em `duplicadas` (para o total de taxas).
   Créditos (> 0) vão para `pagamentos` (pagamento de fatura anterior, fora dos totais) ou `creditos`.

   Tudo é determinístico e não depende da ordem das listas: as linhas e os itens são ordenados
   antes de casar, e os empates se resolvem por essa ordem. */
(function (raiz) {
  'use strict';

  /* ── utilidades ── */

  const semAcento = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  // minúsculas, sem acento, espaço entre letra e número, só [a-z0-9] (mesma forma do extrato.js)
  function normalizar(s) {
    return semAcento(s).toLowerCase().replace(/\bi\.o\.f\b\.?/g, 'iof')
      .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const centavos = v => Math.round(v * 100);
  const arred = v => (Math.round(v * 100) / 100) || 0;   // '|| 0' evita -0
  const lista = x => (Array.isArray(x) ? x : []);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const texto = x => (x == null ? '' : String(x));

  // número de verdade, ou texto '1.234,56' / 'R$ 21,90'; NaN quando não dá
  function numero(x) {
    if (typeof x === 'number') return isFinite(x) ? x : NaN;
    if (typeof x !== 'string') return NaN;
    let s = x.replace(/R\$|\s/g, '').replace(/[−–]/g, '-');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    return /^[+-]?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
  }
  const inteiro = x => { const n = numero(x); return isFinite(n) && Math.floor(n) === n ? n : null; };
  // 'AAAA-MM-DD' -> número do dia (para contar dias entre datas); NaN se não for data
  function diaNum(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto(d));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN;
  }
  function brl(v) {
    const [i, c] = Math.abs(v).toFixed(2).split('.');
    return (v < 0 ? '-' : '') + 'R$ ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + c;
  }
  const juntarNotas = (...n) => n.filter(Boolean).join('; ');
  function parcelaDe(p) {
    if (!p || typeof p !== 'object') return null;
    const k = inteiro(p.k), n = inteiro(p.n);
    return n >= 2 && k >= 1 && k <= n ? { k, n } : null;
  }

  /* ── taxas do cartão ── */

  // [tipo, padrão, exceções]. A ordem decide: 'IOF rotativo' é iof, 'Juros e encargos' é juros.
  const TAXAS = [
    ['iof', / iof |imposto sobre operac/],
    ['anuidade', / anuidade/],
    ['multa', / multa /, / (detran|transito|infracao|denatran) /],   // multa de trânsito paga no cartão é compra
    ['juros', / juros /],
    ['encargos', / encargos? | rotativo /],
    ['seguro', / seguro (cartao|prestamista|fatura|perda|protecao|super ?protegido|compra protegida)|cartao protegido|protecao (perda|cartao|premiada)|bolsa protegida|fatura protegida/, / porto seguro /],
    ['tarifa', / tarifas? |taxa (de )?(saque|emissao|manutencao|servicos?|segunda via|2 via|avaliacao|adesao|cadastro)|avaliacao emergencial|cesta (de )?servicos|pacote (de )?servicos|envio (de )?fatura|segunda via|adiantamento a depositante/]
  ];
  // crédito que devolve a taxa ('Estorno de anuidade'): não é taxa cobrada
  const RE_DEVOLVE = / (estorno|estornad[oa]s?|estornos|devolucao|devolvid[oa]|reembolso|cancelad[oa]|cancelamento|isencao|isent[oa]|credito de|ajuste a credito) /;

  function tipoTaxaBruto(desc) {
    const N = ' ' + normalizar(desc) + ' ';
    for (const [tipo, re, nao] of TAXAS) if (re.test(N) && !(nao && nao.test(N))) return tipo;
    return null;
  }
  function taxaTipo(desc) {
    try {
      if (RE_DEVOLVE.test(' ' + normalizar(desc) + ' ')) return null;
      return tipoTaxaBruto(desc);
    } catch (e) { return null; }
  }

  /* ── nomes parecidos ── */

  // Palavras que sozinhas não dizem quem é o comerciante: 'Microsoft 365' e 'MICROSOFT*XBOX' não são a mesma coisa.
  const FRACAS = new Set(('microsoft google amazon amzn bill subscription subscr subscri assinatura assinaturas mensalidade mensal ' +
    'anual plano planos premium plus pro family familia individual basico padrao compra compras loja lojas store shop online digital ' +
    'digitais servico servicos brasil brazil com www ltda pagamento pagamentos parcela parcelas parcelado parcelada parcelamento ' +
    'cartao credito debito conta fatura estorno ajuste reembolso devolucao cancelamento iof internacional nacional exterior transacao ' +
    'transacoes operacao pay app apps help payment payments purchase intl international inc llc ltd eireli the and entretenimento ' +
    'tecnologia comercio card gift').split(' '));
  // Mesmo serviço com nomes diferentes na fatura e no plano ('iCloud' x 'APPLE.COM/BILL', 'Game Pass' x 'MICROSOFT*XBOX').
  // Testado no texto normalizar(); quem casa ganha a palavra '#...' dos dois lados.
  const APELIDOS = [
    ['#apple', /\bapple\b|apple ?com ?bill|itunes|icloud/],
    ['#xbox', /xbox|game ?pass/],
    ['#prime', /amazon ?prime|prime ?video|amzn ?prime|amazon ?music|kindle ?unl/],
    ['#youtube', /youtube|yt ?premium/],
    ['#hbomax', /\bhbo\b|hbo ?max|\bmax com\b/],
    ['#disney', /disney/],
    ['#chatgpt', /openai|chat ?gpt/],
    ['#claude', /claude|anthropic/],
    ['#googleone', /google ?(one|storage|drive)/],
    ['#office', /microsoft ?365|office ?365|\bm ?365\b|onedrive/],
    ['#playstation', /playstation|\bpsn\b|\bps ?plus\b/],
    ['#smartfit', /smart ?fit/],
    ['#wellhub', /gympass|wellhub/],
    ['#totalpass', /total ?pass/],
    ['#ifood', /ifood|\bifd\b/],
    ['#mercadolivre', /mercado ?livre|mercado ?libre|\bmeli\b/],
    ['#globoplay', /globo ?play/],
    ['#uber', /\buber\b|\bubr\b/],
    ['#99', /\b99 ?(app|pop|taxi|food|ride|moto)\b/]
  ];
  // marcas que aparecem grudadas em outras letras ('DL*SPOTIFYBR'): procuradas no texto sem espaços
  const MARCAS = ('netflix spotify deezer crunchyroll duolingo dropbox linkedin paramount telecine audible headspace strava ' +
    'tinder bumble patreon discord twitch medway medcurso medgrupo sanarflix whitebook uptodate amboss canva adobe').split(' ');

  // chave simples, para quando extrato.js não está carregado
  const PREF_SIMPLES = new Set('compra compras pagamento pag pg pgto mp ec dl pp ebn ebanx paypal pix debito credito cartao no na de do da via'.split(' '));
  const PARADAS_SIMPLES = new Set('de da do das dos e a o em no na para pelo pela com ltda sa me eireli ip the of inc llc br bra parcela parc'.split(' '));
  function chaveSimples(desc) {
    let tok = normalizar(texto(desc).replace(/\.(com|net|org)(\.br)?\b|\.(br|ai|io|app|tv)\b/gi, ' '))
      .split(' ').filter(w => w && !/^\d+$/.test(w));
    while (tok.length && PREF_SIMPLES.has(tok[0])) tok.shift();
    tok = tok.filter(w => w.length > 1 && !PARADAS_SIMPLES.has(w));
    return tok.slice(0, 3).join(' ');
  }
  function escolherChave(fn) {
    if (typeof fn === 'function') return fn;
    const X = raiz.Extrato;
    return X && typeof X.chave === 'function' ? X.chave : chaveSimples;
  }
  function chaveSegura(fn, s) {
    try { const r = fn(s); return r == null ? '' : String(r); } catch (e) { return chaveSimples(s); }
  }

  // Palavras fortes de um nome: as da chave (sem as fracas), os pares grudados ('smart fit' -> 'smartfit')
  // e os apelidos de marca.
  function tokensDe(s, fnChave) {
    const set = new Set();
    const base = chaveSegura(fnChave, s).split(/\s+/).filter(w => w.length >= 2);
    base.forEach((w, i) => {
      if (w.length >= 3 && !/^\d+$/.test(w) && !FRACAS.has(w)) set.add(w);
      const prox = base[i + 1];
      if (prox && (w + prox).length >= 6 && !(FRACAS.has(w) && FRACAS.has(prox))) set.add(w + prox);
    });
    const N = ' ' + normalizar(s) + ' ', junto = N.replace(/ /g, '');
    APELIDOS.forEach(([tok, re]) => { if (re.test(N)) set.add(tok); });
    MARCAS.forEach(m => { if (junto.includes(m)) set.add('#' + m); });
    return set;
  }
  function contarComuns(A, B) {
    let n = 0;
    A.forEach(w => { if (B.has(w)) n++; });
    return n;
  }
  function parecido(a, b, chave) {
    try {
      const fn = escolherChave(chave);
      return contarComuns(tokensDe(texto(a), fn), tokensDe(texto(b), fn));
    } catch (e) { return 0; }
  }

  /* ── classificação de reserva ── */

  // crédito que é pagamento de fatura anterior (fica fora dos totais)
  const RE_PAGAMENTO = / (pagamento|pgto|pagto) (recebido|efetuado|antecipado|on line|online|da fatura|de fatura|fatura|obrigado|em \d|debito)|inclusao de pagamento|pagamentos validos/;
  const RE_ASSIN_SIMPLES = /assinatura|subscription|subscr|recorrente|netflix|spotify|disney|hbo|prime video|amazon prime|youtube premium|apple com bill|icloud|google one|game pass|deezer|globoplay|paramount|claude|openai|chatgpt|microsoft 365|office 365|canva|duolingo|adobe|dropbox|smart fit|wellhub|gympass|totalpass/;
  function classificarSimples(t) {
    const N = ' ' + normalizar(t && t.desc) + ' ', v = Number(t && t.valor) || 0;
    const tipo = v > 0 ? (RE_PAGAMENTO.test(N) ? 'fatura' : 'estorno') : 'gasto';
    return { tipo, cat: tipo === 'fatura' ? null : 'outros', assinatura: tipo === 'gasto' && RE_ASSIN_SIMPLES.test(N), confianca: 'palpite', chave: '' };
  }
  function escolherClassificar(fn) {
    if (typeof fn === 'function') return fn;
    const X = raiz.Extrato;
    return X && typeof X.classificar === 'function' ? (t => X.classificar(t, {})) : classificarSimples;
  }

  /* ── casamento ── */

  // Força de cada casamento (maior ganha). Os de nível <= SO_PELO_VALOR só entram depois de
  // procurar duplicadas, para uma cobrança repetida não "casar" com outro item só porque o valor bate.
  const NIVEL = { BATE: 100, LANC_EXATO: 95, BATE_IOF: 90, LANC_TOL: 85, PARC_SEM_N: 80, PARC_K_LONGE: 75, MUDOU: 50, LANC_SEM_NOME: 45,
    PARC_VALOR: 40, SO_VALOR: 30 };
  const SO_PELO_VALOR = 40;
  const JANELA_DUP = 3, JANELA_LANC = 3;   // dias

  // Quanto o valor pode ter mudado e ainda ser "o mesmo item, com outro preço".
  const limiteMudou = e => (e.tipo === 'assinatura' ? Math.max(e.v, 10) : Math.max(e.v * 0.5, 5));

  function ordemLinha(a, b) {
    return cmp(a.data, b.data) || cmp(texto(a.t.dataCompra), texto(b.t.dataCompra)) || (a.valor - b.valor) ||
      cmp(a.desc, b.desc) || cmp(texto(a.t.id), texto(b.t.id)) || cmp(texto(a.t.original), texto(b.t.original));
  }
  function ordemPar(a, b) {
    return (b.nivel - a.nivel) || (b.nome - a.nome) || (a.dv - b.dv) || (a.dk - b.dk) || (a.dd - b.dd) ||
      (a.x.i - b.x.i) || (a.item.ord - b.item.ord);
  }

  function conferir(entrada) {
    try {
      return montar(entrada && typeof entrada === 'object' ? entrada : {});
    } catch (e) {
      const r = vazio();
      r.avisos.push('Não consegui conferir a fatura (' + ((e && e.message) || 'erro') + ').');
      return r;
    }
  }

  function montar(entrada) {
    const R = vazio();
    const tolRel = typeof entrada.tolerancia === 'number' && isFinite(entrada.tolerancia) && entrada.tolerancia >= 0 ? entrada.tolerancia : 0.03;
    const tolC = v => Math.max(50, tolRel * v * 100) + 1e-6;   // tolerância em centavos
    const fnChave = escolherChave(entrada.chave);
    const fnClass = escolherClassificar(entrada.classificar);

    const cacheTok = new Map(), cacheCh = new Map();
    const tokens = s => { let r = cacheTok.get(s); if (!r) { r = tokensDe(s, fnChave); cacheTok.set(s, r); } return r; };
    const nomeComum = (a, b) => contarComuns(tokens(a), tokens(b));
    const chaveDe = s => { let r = cacheCh.get(s); if (r == null) { r = chaveSegura(fnChave, s).trim(); cacheCh.set(s, r); } return r; };

    /* 1. linhas da fatura, em ordem fixa */
    const linhas = [];
    let ignoradas = 0, semClasse = 0;
    lista(entrada.transacoes).forEach(t => {
      const valor = t && typeof t === 'object' ? numero(t.valor) : NaN;
      if (!isFinite(valor) || centavos(valor) === 0) { ignoradas++; return; }
      const desc = texto(t.desc != null ? t.desc : t.original);
      linhas.push({ t, valor: arred(valor), abs: Math.abs(arred(valor)), desc, data: texto(t.data),
        dia: diaNum(t.dataCompra || t.data), parcela: parcelaDe(t.parcela) });
    });
    linhas.sort(ordemLinha);
    linhas.forEach((x, i) => { x.i = i; });
    if (ignoradas) R.avisos.push(ignoradas + (ignoradas > 1 ? ' linhas sem valor ficaram de fora.' : ' linha sem valor ficou de fora.'));

    /* 2. separa cobranças, créditos e pagamentos da fatura anterior */
    const cobrancas = [], creditos = [], pagamentos = [];
    linhas.forEach(x => {
      let c = null;
      try { c = fnClass(x.t); } catch (e) { c = null; }
      if (!c || typeof c !== 'object') { semClasse++; c = classificarSimples(x.t); }
      x.c = c;
      if (x.valor > 0) {
        if (c.tipo === 'fatura' || RE_PAGAMENTO.test(' ' + normalizar(x.desc) + ' ')) pagamentos.push(x);
        else { x.taxa = tipoTaxaBruto(x.desc); creditos.push(x); }
      } else {
        x.taxa = taxaTipo(x.desc);
        cobrancas.push(x);
      }
    });
    if (semClasse) R.avisos.push('Não consegui classificar ' + semClasse + (semClasse > 1 ? ' linhas' : ' linha') + '; usei uma regra simples.');

    /* 3. IOF: liga cada linha de IOF à compra internacional dela */
    const normais = cobrancas.filter(x => x.taxa !== 'iof');
    const iofDe = new Map();
    cobrancas.filter(x => x.taxa === 'iof').forEach(f => {
      let alvo = null;
      if (tokens(f.desc).size) {   // 'IOF de "Openai *Chatgpt Subscr"': procura pelo nome
        alvo = normais.map(x => ({ x, n: nomeComum(f.desc, x.desc) })).filter(o => o.n > 0)
          .sort((a, b) => (b.n - a.n) || (Math.abs(a.x.dia - f.dia) || 0) - (Math.abs(b.x.dia - f.dia) || 0) || (a.x.i - b.x.i))
          .map(o => o.x)[0] || null;
      }
      if (!alvo) {                 // 'IOF COMPRA INTERNACIONAL': só se houver uma compra no mesmo dia com o IOF na proporção certa
        const c = normais.filter(x => x.dia === f.dia && f.abs / x.abs >= 0.02 && f.abs / x.abs <= 0.08);
        if (c.length === 1) alvo = c[0];
      }
      if (alvo) { f.de = alvo; iofDe.set(alvo, arred((iofDe.get(alvo) || 0) + f.abs)); }
    });

    /* 4. o que a pessoa esperava: itens do plano e lançamentos à mão */
    const esperados = [];
    lista(entrada.esperados).forEach(e => {
      if (!e || typeof e !== 'object') return;
      const v = Math.abs(numero(e.v));
      if (!isFinite(v) || centavos(v) === 0) return;
      const n = inteiro(e.n), k = inteiro(e.k);
      let tipo = e.tipo;
      if (tipo !== 'parcela' && tipo !== 'compra' && tipo !== 'assinatura') tipo = n >= 2 ? 'parcela' : 'assinatura';
      if (tipo === 'parcela' && !(n >= 2)) tipo = 'compra';   // parcela sem total de parcelas: casa como compra
      esperados.push({ e, v: arred(v), nome: texto(e.nome), tipo, n: tipo === 'parcela' ? n : null,
        k: tipo === 'parcela' && k >= 1 ? k : null });
    });
    esperados.sort((a, b) => cmp(normalizar(a.nome), normalizar(b.nome)) || (a.v - b.v) || cmp(a.tipo, b.tipo) ||
      ((a.k || 0) - (b.k || 0)) || ((a.n || 0) - (b.n || 0)) || cmp(texto(a.e.id), texto(b.e.id)) || cmp(a.nome, b.nome));
    const lancados = [];
    lista(entrada.lancados).forEach(l => {
      if (!l || typeof l !== 'object') return;
      const v = Math.abs(numero(l.v));
      if (!isFinite(v) || centavos(v) === 0) return;
      lancados.push({ l, v: arred(v), d: texto(l.d), dia: diaNum(l.d), nome: texto(l.t) });
    });
    lancados.sort((a, b) => cmp(a.d, b.d) || (a.v - b.v) || cmp(a.nome, b.nome) || cmp(texto(a.l.id), texto(b.l.id)));
    esperados.forEach((e, i) => { e.ord = i; });
    lancados.forEach((l, i) => { l.ord = esperados.length + i; });
    R.esperadoTotal = arred([...esperados, ...lancados].reduce((s, x) => s + centavos(x.v), 0) / 100);

    // Uma cobrança x contra um item do plano e: devolve o casamento possível ou null.
    function avaliarEsperado(x, e) {
      const nome = nomeComum(x.desc, e.nome);
      const dC = Math.abs(centavos(x.abs) - centavos(e.v)), ok = dC <= tolC(e.v);
      let dk = 0;
      const par = (nivel, grupo, nota, dCusado) => ({ x, item: e, nivel, nome, dv: (dCusado != null ? dCusado : dC) / centavos(e.v),
        dk, dd: 0, grupo, nota: nota || '' });
      if (e.tipo === 'parcela') {
        const p = x.parcela;
        // a fatura não trouxe 'k/n': só pelo nome e pelo valor
        if (!p) return nome > 0 && ok ? par(NIVEL.PARC_SEM_N, 'batem', 'a fatura não mostra o número da parcela') : null;
        if (p.n !== e.n) return null;
        dk = e.k ? Math.abs(p.k - e.k) : 0;
        const notaK = dk ? 'parcela ' + p.k + '/' + p.n + ' na fatura, esperado ' + e.k + '/' + e.n : '';
        if (ok && nome > 0) return par(dk <= 1 ? NIVEL.BATE : NIVEL.PARC_K_LONGE, 'batem', notaK);
        if (dk > 1) return null;
        if (!ok && nome > 0 && dC <= limiteMudou(e) * 100) return par(NIVEL.MUDOU, 'valorMudou');
        if (ok) return par(NIVEL.PARC_VALOR, 'batem', juntarNotas('casado pelo valor e nº de parcelas', notaK));
        return null;
      }
      // assinatura ou compra (uma taxa parcelada, como 'Anuidade 3/12', pode ser item fixo do plano)
      const p = x.taxa ? null : x.parcela;
      if (p && e.tipo === 'assinatura') return null;
      const iof = iofDe.get(x) || 0;
      const dIof = Math.abs(centavos(x.abs + iof) - centavos(e.v)), okIof = iof > 0 && dIof <= tolC(e.v);
      const notaP = p ? 'parcela ' + p.k + '/' + p.n : '', notaIof = 'com IOF de ' + brl(iof);
      if (nome > 0) {
        if (ok) return par(NIVEL.BATE, 'batem', notaP);
        if (okIof) return par(NIVEL.BATE_IOF, 'batem', juntarNotas(notaIof, notaP), dIof);
        if (!p && dC <= limiteMudou(e) * 100) return par(NIVEL.MUDOU, 'valorMudou');
        return null;
      }
      // nome diferente: só uma assinatura da fatura pode casar pelo valor
      if (x.c.assinatura && !p) {
        if (ok) return par(NIVEL.SO_VALOR, 'batem', 'casado pelo valor');
        if (okIof) return par(NIVEL.SO_VALOR, 'batem', juntarNotas('casado pelo valor', notaIof), dIof);
      }
      return null;
    }
    // Uma cobrança x contra um lançamento à mão l: data perto e valor igual (ou quase, se o nome bate).
    function avaliarLancado(x, l) {
      if (!isFinite(x.dia) || !isFinite(l.dia)) return null;
      const dd = Math.abs(x.dia - l.dia);
      if (dd > JANELA_LANC) return null;
      const dC = Math.abs(centavos(x.abs) - centavos(l.v)), nome = nomeComum(x.desc, l.nome);
      let nivel;
      // valor exato com nome diferente ('almoço' x 'RESTAURANTE X') ainda casa, mas perde para o nome no plano
      if (dC <= 1) nivel = nome > 0 ? NIVEL.LANC_EXATO : NIVEL.LANC_SEM_NOME;
      else if (nome > 0 && dC <= tolC(l.v)) nivel = NIVEL.LANC_TOL;
      else return null;
      return { x, item: l, nivel, nome, dv: dC / centavos(l.v), dk: 0, dd, grupo: 'lancado', nota: '' };
    }

    /* 5. casamentos fortes (nome, parcela, lançamento à mão), do melhor para o pior */
    const pares = [];
    normais.forEach(x => {
      esperados.forEach(e => { const p = avaliarEsperado(x, e); if (p) pares.push(p); });
      lancados.forEach(l => { const p = avaliarLancado(x, l); if (p) pares.push(p); });
    });
    pares.sort(ordemPar);
    const casou = new Map(), itemUsado = new Set();
    const casar = aceita => pares.forEach(p => {
      if (!aceita(p) || casou.has(p.x) || itemUsado.has(p.item)) return;
      casou.set(p.x, p); itemUsado.add(p.item);
    });
    casar(p => p.nivel > SO_PELO_VALOR);

    /* 6. duplicadas: mesma loja, mesmo valor (e mesma parcela), até 3 dias de distância */
    const grupos = new Map();
    normais.forEach(x => {
      const ch = chaveDe(x.desc);
      if (!ch || !isFinite(x.dia)) return;
      const g = ch + '|' + centavos(x.abs) + '|' + (x.parcela ? x.parcela.k + '/' + x.parcela.n : '');
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push(x);
    });
    const suspeitas = [], ehB = new Set();
    [...grupos.keys()].sort().forEach(g => {
      const xs = grupos.get(g);
      if (xs.length < 2) return;
      xs.sort((a, b) => (a.dia - b.dia) || (a.i - b.i));
      // hábito (o café de todo dia, mesmo preço em 3+ dias ao longo de mais de uma semana): só o mesmo dia conta
      const habito = new Set(xs.map(x => x.dia)).size >= 3 && xs[xs.length - 1].dia - xs[0].dia > 7;
      const janela = habito ? 0 : JANELA_DUP;
      const ficam = [], ehA = new Set();   // ficam: cobranças que podem ser a 'a' de um par
      xs.forEach(y => {
        const x = ficam.find(a => y.dia - a.dia <= janela && !(casou.has(a) && casou.has(y)));
        if (!x) { ficam.push(y); return; }
        if (!casou.has(y)) { suspeitas.push({ a: x, b: y }); ehB.add(y); ehA.add(x); }
        else if (!ehA.has(x)) {   // y casou com o plano e x não: x é a cobrança a mais
          suspeitas.push({ a: y, b: x }); ehB.add(x); ehA.add(y); ficam.splice(ficam.indexOf(x), 1, y);
        } else ficam.push(y);
      });
    });
    // um estorno do mesmo valor (e da mesma loja, ou sem loja) desfaz a suspeita
    const credUsado = new Set(), estornadas = new Set();
    const pertoDe = (c, x) => Math.abs(c.dia - x.dia) || 0;
    const duplicadas = [];
    suspeitas.sort((p, q) => (p.a.i - q.a.i) || (p.b.i - q.b.i)).forEach(p => {
      const cr = creditos.filter(c => !credUsado.has(c) && centavos(c.valor) === centavos(p.b.abs) &&
        (nomeComum(c.desc, p.b.desc) > 0 || tokens(c.desc).size === 0))
        .sort((m, n) => (nomeComum(n.desc, p.b.desc) - nomeComum(m.desc, p.b.desc)) || (pertoDe(m, p.b) - pertoDe(n, p.b)) || (m.i - n.i))[0];
      if (cr) { credUsado.add(cr); cr.estorna = p.b; estornadas.add(p.b); ehB.delete(p.b); return; }
      duplicadas.push(p);
    });

    /* 7. casamentos só pelo valor, com o que sobrou (sem as duplicadas) */
    casar(p => p.nivel <= SO_PELO_VALOR && !ehB.has(p.x));

    /* 8. outros créditos: qual cobrança cada estorno devolve (mesmo valor e mesma loja) */
    creditos.forEach(cr => {
      if (cr.estorna) return;
      const alvo = normais.filter(x => !estornadas.has(x) && centavos(x.abs) === centavos(cr.valor) && nomeComum(x.desc, cr.desc) > 0)
        .sort((m, n) => (nomeComum(n.desc, cr.desc) - nomeComum(m.desc, cr.desc)) || (pertoDe(cr, m) - pertoDe(cr, n)) || (m.i - n.i))[0];
      if (alvo) { cr.estorna = alvo; estornadas.add(alvo); }
    });

    /* 9. monta o relatório */
    let taxasC = 0;
    cobrancas.forEach(x => {
      if (x.taxa) {
        R.taxas.push(x.de ? { t: x.t, tipo: x.taxa, de: x.de.t } : { t: x.t, tipo: x.taxa });
        taxasC += centavos(x.abs);
      }
      if (x.taxa === 'iof') return;
      const p = casou.get(x);
      if (p) {
        if (p.grupo === 'lancado') R.lancadosAchados.push({ t: x.t, lancado: p.item.l });
        else if (p.grupo === 'valorMudou') R.valorMudou.push({ t: x.t, esperado: p.item.e, diferenca: arred((centavos(x.abs) - centavos(p.item.v)) / 100) });
        else R.batem.push(p.nota ? { t: x.t, esperado: p.item.e, nota: p.nota } : { t: x.t, esperado: p.item.e });
        return;
      }
      if (ehB.has(x) || x.taxa) return;   // a 'b' da duplicada fica só em duplicadas; taxa solta fica só em taxas
      if (x.parcela && x.parcela.n > 1) R.parcelasNovas.push({ t: x.t });
      else if (x.c.assinatura) R.assinaturasNovas.push({ t: x.t });
      else R.naoReconhecidos.push({ t: x.t, c: x.c });
    });
    R.duplicadas = duplicadas.map(p => ({ a: p.a.t, b: p.b.t }));
    esperados.forEach(e => { if (!itemUsado.has(e)) R.faltando.push({ esperado: e.e }); });
    lancados.forEach(l => { if (!itemUsado.has(l)) R.lancadosFaltando.push({ lancado: l.l }); });
    creditos.forEach(cr => {
      const o = { t: cr.t };
      if (cr.estorna) o.estorna = cr.estorna.t;
      if (cr.taxa) { o.taxa = cr.taxa; taxasC -= centavos(cr.valor); }   // 'Estorno de anuidade' abate do total de taxas
      R.creditos.push(o);
    });
    R.pagamentos = pagamentos.map(x => ({ t: x.t }));
    R.totalTaxas = arred(Math.max(0, taxasC) / 100);

    // total = cobranças - créditos; o pagamento da fatura anterior não entra
    const totalC = cobrancas.reduce((s, x) => s + centavos(x.abs), 0) - creditos.reduce((s, x) => s + centavos(x.valor), 0);
    R.totalCalculado = arred(totalC / 100);
    const impresso = entrada.totalImpresso == null || entrada.totalImpresso === '' ? NaN : numero(entrada.totalImpresso);
    R.totalImpresso = isFinite(impresso) ? arred(impresso) : null;
    R.diferencaTotal = R.totalImpresso == null ? null : arred((centavos(R.totalImpresso) - totalC) / 100);

    R.pendencias = R.valorMudou.length + R.faltando.length + R.naoReconhecidos.length + R.duplicadas.length +
      R.assinaturasNovas.length + R.parcelasNovas.length + (R.diferencaTotal != null && Math.abs(R.diferencaTotal) > 1 ? 1 : 0);
    if (!linhas.length) R.avisos.push('A fatura não tem lançamentos.');
    return R;
  }

  // Relatório vazio: também é a forma completa do resultado.
  function vazio() {
    return {
      totalCalculado: 0,       // cobranças - créditos, sem o pagamento da fatura anterior
      totalImpresso: null,
      diferencaTotal: null,    // totalImpresso - totalCalculado (null sem total impresso)
      esperadoTotal: 0,        // soma de esperados[].v + lancados[].v
      batem: [],               // { t, esperado, nota? }
      valorMudou: [],          // { t, esperado, diferenca }  diferenca = valor na fatura - valor no plano
      faltando: [],            // { esperado }
      lancadosAchados: [],     // { t, lancado }
      lancadosFaltando: [],    // { lancado }
      naoReconhecidos: [],     // { t, c }
      duplicadas: [],          // { a, b }  b = a cobrança que parece a mais
      taxas: [],               // { t, tipo, de? }  de = a compra a que o IOF se refere
      totalTaxas: 0,
      assinaturasNovas: [],    // { t }
      parcelasNovas: [],       // { t }
      creditos: [],            // { t, estorna?, taxa? }  estorna = a cobrança que esse crédito devolve
      pagamentos: [],          // { t }
      pendencias: 0,
      avisos: []
    };
  }

  raiz.Conferencia = {
    versao: '1.0.0',
    conferir, taxaTipo, parecido
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
