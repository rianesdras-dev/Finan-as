/* comprovantes.js: cofre de comprovantes de pagamento, guardado NO APARELHO (IndexedDB).
   Script clássico (sem módulos), carregado pela página com <script src="comprovantes.js">.
   Nada é enviado para fora: os arquivos ficam só no navegador do celular.
   (A única coisa baixada da internet é o leitor de PDF, pdf.js, e só quando um PDF é lido.)

   API (globalThis.Comprovantes) — tudo assíncrono, exceto sugerir e os auxiliares _*:
     abrir()                         -> Promise<void>   abre/cria o banco 'financeiro-comprovantes'
     salvar(arquivo, meta)           -> Promise<Registro>
         meta = { ref, mes:'AAAA-MM', nome?, valor?, data?:'AAAA-MM-DD', nota? }
         imagens: reduzidas a no máx. 1600px no lado maior e regravadas em JPEG (q=0,82)
         SÓ se ficarem menores que o original; PDF e outros arquivos ficam como vieram.
     listar(filtro?)                 -> Promise<Registro[]>   só os dados (sem o arquivo), mais novo primeiro
     obter(id)                       -> Promise<{ registro, blob } | null>
     apagar(id)                      -> Promise<void>
     uso()                           -> Promise<{ n, bytes }>
     lerInfo(arquivo)                -> Promise<{ valor, data, nomes, texto, aviso? }>
     sugerir(info, candidatos)       -> [{ ref, pontos }]   (síncrono) contas que este comprovante provavelmente paga
     exportarZip(registros?)         -> Promise<Blob>   ZIP com os arquivos + comprovantes.csv

   Registro = { id, ref, mes, nome, tipo, tamanho, criado, valor?, data?, nota?, miniatura?: dataURL|null }

   Erros: as funções assíncronas nunca lançam; rejeitam com Error de mensagem em pt-BR,
   pronta para mostrar na tela. */
(function (raiz) {
  'use strict';

  const NOME_BANCO = 'financeiro-comprovantes';
  const VERSAO = 1;
  const LOJA = 'arquivos';        // dados (Registro) — o que listar() lê
  const LOJA_CONTEUDO = 'conteudo'; // { id, bytes:ArrayBuffer } — separado para listar não carregar os arquivos
  const LADO_MAX = 1600, LADO_MINI = 200, QUALIDADE = 0.82, QUALIDADE_MINI = 0.7;
  const TAMANHO_MAX = 40 * 1024 * 1024;   // 40 MB por arquivo: mais que isso quase sempre é engano

  // Erro com mensagem para o usuário; a marca `amigavel` diz que pode ir direto para a tela.
  const erro = msg => Object.assign(new Error(msg), { amigavel: true });
  const semAcento = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = s => semAcento(s).toLowerCase().replace(/\s+/g, ' ').trim();
  const ehBlob = x => typeof Blob !== 'undefined' && x instanceof Blob;

  /* ══════════════ datas e números ══════════════ */

  const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12,
    janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };

  const dois = n => String(n).padStart(2, '0');
  function dataValida(a, m, d) {
    if (!(a >= 1990 && a <= 2100 && m >= 1 && m <= 12 && d >= 1)) return null;
    const dt = new Date(Date.UTC(a, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;   // 31/02 etc.
    return a + '-' + dois(m) + '-' + dois(d);
  }
  const ehDataISO = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && dataValida(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10)) === s;
  const ehMes = s => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

  // Valor em reais: "R$ 1.234,56", "1234,56", "- R$ 50,00", "R$ 50" (inteiro só com R$ na frente).
  const RE_DINHEIRO = /(R\$\s*)?(-\s*)?(?:R\$\s*)?(\d{1,3}(?:\.\d{3})+|\d+)(,\d{2})?(?![\d,]|\.\d)/g;
  function valoresNaLinha(linha) {
    const res = [];
    RE_DINHEIRO.lastIndex = 0;
    let m;
    while ((m = RE_DINHEIRO.exec(linha))) {
      const antes = linha.charAt(m.index - 1);
      if (/[\d.,/:]/.test(antes)) continue;            // pedaço de outro número, data ou hora
      const temRS = !!m[1] || /R\$\s*$/.test(linha.slice(0, m.index)) || /R\$/.test(m[0]);
      if (!m[4] && !temRS) continue;                    // sem centavos e sem R$: é um número qualquer
      const depois = linha.slice(m.index + m[0].length, m.index + m[0].length + 2);
      if (/^\s?%/.test(depois)) continue;               // porcentagem
      const v = Number(m[3].replace(/\./g, '') + (m[4] ? '.' + m[4].slice(1) : ''));
      if (isFinite(v)) res.push(v);
    }
    return res;
  }

  /* ══════════════ leitura do texto do comprovante ══════════════ */

  const linhasDe = texto => String(texto == null ? '' : texto).normalize('NFC').replace(/\r/g, '\n').split('\n')
    .map(l => l.replace(/[ \t]/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);

  // Linhas que têm número com cara de valor mas NÃO são o valor pago.
  const RE_NAO_VALOR = /\b(saldo|limite|tarifa|juros|multa|desconto|abatimento|encargo|iof|cashback|disponivel|minimo|mora|acrescimo|deducao|outras deducoes|taxa|cotacao|parcela minima)/;
  // Rótulos de valor, do mais forte (1) ao mais fraco (4).
  const ROTULOS_VALOR = [
    [1, /\b(valor (total )?pago|total pago|valor do pagamento|valor pagamento|pagamento efetuado|valor debitado|valor cobrado)\b/],
    [2, /\b(valor total|valor da transferencia|valor transferido|valor do pix|valor enviado|valor recebido|valor da transacao|valor da operacao|valor do debito)\b/],
    [3, /\b(valor do documento|valor original|valor nominal|valor do boleto|valor a pagar|total a pagar|valor da fatura|total da fatura)\b/],
    [4, /\b(valor|total|quantia|montante|importancia)\b/],
  ];
  function rotuloValor(ln) {
    for (const [nivel, re] of ROTULOS_VALOR) if (re.test(ln)) return nivel;
    return 0;
  }

  /** Acha o valor pago. Prefere valor com rótulo ("Valor pago", "Valor", "Valor total"...) ao
      primeiro R$ do texto; ignora saldo, limite, tarifa, juros, desconto. */
  function achaValor(texto) {
    const linhas = linhasDe(texto);
    const ln = linhas.map(norm);
    let melhor = null;   // { nivel, v }
    for (let i = 0; i < linhas.length; i++) {
      if (RE_NAO_VALOR.test(ln[i])) continue;
      const nivel = rotuloValor(ln[i]);
      if (!nivel) continue;
      let vals = valoresNaLinha(linhas[i]).filter(v => v > 0);
      // rótulo sozinho na linha: o valor vem na(s) linha(s) seguinte(s)
      for (let j = i + 1; !vals.length && j <= i + 2 && j < linhas.length; j++) {
        if (RE_NAO_VALOR.test(ln[j]) || (rotuloValor(ln[j]) && !/^[-r$\s\d.,]+$/.test(ln[j]))) break;
        vals = valoresNaLinha(linhas[j]).filter(v => v > 0);
      }
      if (vals.length && (!melhor || nivel < melhor.nivel)) melhor = { nivel, v: vals[0] };
    }
    if (melhor) return melhor.v;
    // sem rótulo: primeiro valor com R$ fora das linhas a ignorar
    for (let i = 0; i < linhas.length; i++) {
      if (RE_NAO_VALOR.test(ln[i]) || !/R\$/.test(linhas[i])) continue;
      const vals = valoresNaLinha(linhas[i]).filter(v => v > 0);
      if (vals.length) return vals[0];
    }
    return null;
  }

  // Todas as datas de uma linha, em AAAA-MM-DD.
  function datasNaLinha(linha, anoPadrao) {
    const res = [], s = semAcento(linha).toLowerCase();
    let m;
    const reNum = /(^|[^\d])(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?(?![\d/])/g;
    while ((m = reNum.exec(s))) {
      if (!m[4] && /^\s*h\b|^:\d/.test(s.slice(m.index + m[0].length))) continue;   // "14.30h"
      if (!m[4] && /[\d,]/.test(s.charAt(m.index + m[0].length))) continue;
      let a = m[4] ? +m[4] : anoPadrao;
      if (m[4] && m[4].length === 2) a += 2000;
      const d = a ? dataValida(a, +m[3], +m[2]) : null;
      if (d) res.push({ i: m.index, d });
    }
    const reIso = /(\d{4})-(\d{2})-(\d{2})/g;
    while ((m = reIso.exec(s))) { const d = dataValida(+m[1], +m[2], +m[3]); if (d) res.push({ i: m.index, d }); }
    // "15 de março de 2025", "15 mar 2025", "15 MAR. 25", "15/mar/2025"
    const reExt = /(\d{1,2})(?:\s+de\s+|\s*[/ -]\s*)([a-z]{3,9})\.?(?:(?:\s+de\s+|\s*[/ -]\s*)(\d{4}|\d{2}))?(?![a-z])/g;
    while ((m = reExt.exec(s))) {
      const mes = MESES[m[2]] || MESES[m[2].slice(0, 3)];
      if (!mes || (m[2].length > 3 && !MESES[m[2]])) continue;
      let a = m[3] ? +m[3] : anoPadrao;
      if (m[3] && m[3].length === 2) a += 2000;
      const d = a ? dataValida(a, mes, +m[1]) : null;
      if (d) res.push({ i: m.index, d });
    }
    return res.sort((x, y) => x.i - y.i).map(x => x.d);
  }

  // Datas que NÃO são a do pagamento.
  const RE_NAO_DATA = /\b(vencimento|vence|validade|emissao|emitido|nascimento|competencia|periodo de apuracao|apuracao|gerado em|documento gerado|limite para|agendad[oa] para|previsao|consulta)/;
  const RE_DATA_PAGTO = /\b(data do pagamento|data de pagamento|data pagamento|pago em|paga em|data da transferencia|data da transacao|data da operacao|data e hora|realizad[oa] em|efetuad[oa] em|data do debito|debitado em|data da efetivacao|transferid[oa] em|enviad[oa] em|data do pix|data)\b/;

  /** Acha a data do pagamento ('AAAA-MM-DD'); sem ano no texto, usa anoPadrao. */
  function achaData(texto, anoPadrao) {
    const linhas = linhasDe(texto);
    const ano = Number.isInteger(anoPadrao) ? anoPadrao : null;
    let primeira = null;
    for (let i = 0; i < linhas.length; i++) {
      const ln = norm(linhas[i]);
      if (RE_NAO_DATA.test(ln)) continue;
      let ds = datasNaLinha(linhas[i], ano);
      const rotulo = RE_DATA_PAGTO.test(ln);
      if (rotulo && !ds.length && i + 1 < linhas.length && !RE_NAO_DATA.test(norm(linhas[i + 1]))) ds = datasNaLinha(linhas[i + 1], ano);
      if (!ds.length) continue;
      if (rotulo) return ds[0];
      if (!primeira) primeira = ds[0];
    }
    return primeira;
  }

  /* ── nomes de quem recebeu ── */

  // Rótulos de quem RECEBEU o dinheiro (não de quem pagou).
  const RE_ROTULO_NOME = /^(para|destino|destinatario|quem recebeu|recebedor|favorecido|beneficiario(?: final)?|nome do (?:favorecido|recebedor|beneficiario|destinatario)|cedente|razao social(?: do beneficiario)?|empresa|estabelecimento|loja|pago a|enviado para|transferido para)\b\s*[:\-–]?\s*(.*)$/;
  // Linhas de dados de conta que aparecem embaixo do nome (não são nome).
  const RE_DADO_CONTA = /^(cpf|cnpj|cpf\/cnpj|instituicao|banco|agencia|conta|chave|tipo de (?:conta|chave)|tipo|id|identificador|autenticacao|codigo|e-?mail|telefone|valor|data|cnpj\/cpf)\b/;
  const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o']);

  function limpaNome(s) {
    return String(s || '')
      .replace(/\b(CPF|CNPJ)\b.*$/i, '')
      .replace(/[•*]+[\d.\-/•*]*/g, ' ')
      .replace(/\d{2,3}\.\d{3}\.\d{3}[/-][\d-]+/g, ' ')
      .replace(/^nome( completo)?\s*[:\-]?\s*/i, '')
      .replace(/\s+[-–|]\s*$/, '')
      .replace(/\s+/g, ' ').trim();
  }
  function pareceNome(s, exigeMaiuscula) {
    if (!s || s.length < 3 || s.length > 70 || !/[A-Za-zÀ-ÿ]{3}/.test(s)) return false;
    if (/https?:|www\.|@/.test(s) || /[,;!?]/.test(s)) return false;
    if ((s.match(/\d/g) || []).length > s.length / 3) return false;
    if (RE_DADO_CONTA.test(norm(s))) return false;
    if (exigeMaiuscula) return s.split(' ').every(w => CONECTIVOS.has(w.toLowerCase()) || /^[A-ZÀ-Þ0-9]/.test(w));
    return true;
  }
  // "MARIA DA SILVA" -> "Maria da Silva" (só se estiver todo em maiúsculas).
  function titulo(s) {
    if (/[a-zà-ÿ]/.test(s)) return s;
    return s.split(' ').map((w, i) => {
      const min = w.toLowerCase();
      if (i > 0 && CONECTIVOS.has(min)) return min;
      if (/^[A-Z](?:[./][A-Z])+\.?$/.test(w) || /^[A-Z]{1,2}$/.test(w)) return w;   // S.A., S/A, ME
      return min.replace(/(^|[-.'])([a-zà-ÿ])/g, (x, p, c) => p + c.toUpperCase());
    }).join(' ');
  }

  /** Nomes de quem recebeu ("Para", "Destino", "Quem recebeu", "Favorecido", "Beneficiário"...),
      mais 'Fatura' para pagamento de fatura de cartão e 'DAS' para o Simples Nacional. */
  function achaNomes(texto) {
    const linhas = linhasDe(texto), achados = [];
    const poe = (s, cru) => {
      s = cru ? s : titulo(limpaNome(s));
      if (s && !achados.some(a => norm(a) === norm(s))) achados.push(s);
    };
    for (let i = 0; i < linhas.length; i++) {
      const m = norm(linhas[i]).match(RE_ROTULO_NOME);
      if (!m) continue;
      // o resto da linha no texto original (mesmo comprimento: norm só tira acentos e espaços repetidos)
      const resto = limpaNome(linhas[i].replace(/\s+/g, ' ').slice(linhas[i].length - m[2].length));
      const exige = m[1] === 'para' || m[1] === 'destino';
      if (resto && pareceNome(resto, exige)) { poe(resto); continue; }
      if (resto && !/^nome$/i.test(resto)) continue;    // "Para dúvidas, ligue..." etc.
      // rótulo sozinho: o nome vem nas próximas linhas (pulando "Nome", CPF, instituição...)
      for (let j = i + 1; j < Math.min(linhas.length, i + 4); j++) {
        const lj = norm(linhas[j]);
        if (RE_ROTULO_NOME.test(lj) || /^(origem|quem pagou|pagador|dados do pagador|de)\b/.test(lj)) break;
        if (/^nome$/.test(lj)) continue;
        if (/^nome\b/.test(lj)) { const n = limpaNome(linhas[j]); if (pareceNome(n)) poe(n); break; }
        if (RE_DADO_CONTA.test(lj)) continue;
        const n = limpaNome(linhas[j]);
        if (pareceNome(n)) { poe(n); break; }
      }
    }
    const tudo = norm(texto);
    if (/pagamento (de|da) fatura|fatura do cartao|pagamento de cartao/.test(tudo)) poe('Fatura', true);
    if (/\bdas\b|simples nacional|documento de arrecadacao/.test(tudo)) poe('DAS', true);
    return achados.slice(0, 6);
  }

  /* ══════════════ sugestão: qual conta este comprovante paga ══════════════ */

  const PALAVRAS_VAZIAS = new Set(['ltda', 'eireli', 'me', 'sa', 'cia', 'pagamento', 'pagto', 'banco', 'conta', 'servicos', 'comercio',
    'brasil', 'para', 'com', 'dos', 'das', 'del', 'the', 'fatura', 'cartao', 'boleto', 'pix', 'ip', 'instituicao']);
  const fichas = s => norm(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length >= 3 && !PALAVRAS_VAZIAS.has(w));

  /** Ordena as contas que este comprovante provavelmente paga. O valor igual pesa mais; depois nome
      parecido; depois data perto do vencimento. Sem valor nem nome parecidos: fica de fora. */
  function sugerir(info, candidatos) {
    if (!info || !Array.isArray(candidatos)) return [];
    const valor = typeof info.valor === 'number' && isFinite(info.valor) ? Math.abs(info.valor) : null;
    const nomes = Array.isArray(info.nomes) ? info.nomes : [];
    const fInfo = new Set(nomes.flatMap(fichas));
    const ehFatura = nomes.some(n => norm(n) === 'fatura'), ehDas = nomes.some(n => norm(n) === 'das');
    const data = ehDataISO(info.data) ? info.data : null;
    const res = [];
    for (const c of candidatos) {
      if (!c || c.ref == null) continue;
      let pv = 0, pn = 0, pd = 0;
      const v = typeof c.v === 'number' && isFinite(c.v) ? Math.abs(c.v) : null;
      if (valor != null && v) {
        const dif = Math.abs(valor - v);
        if (dif < 0.005) pv = 60;
        else if (dif <= Math.max(1, v * 0.01)) pv = 35;
        else if (dif <= v * 0.05) pv = 12;
      }
      const nomeC = norm(c.nome) + ' ' + norm(c.ref);
      const fC = fichas(c.nome || '');
      let iguais = 0;
      for (const f of fInfo) if (fC.some(g => g === f || (f.length >= 4 && g.length >= 4 && (g.startsWith(f) || f.startsWith(g))))) iguais++;
      pn = Math.min(30, iguais * 15);
      if (ehFatura && /fatura|cartao/.test(nomeC)) pn = Math.max(pn, 20);
      if (ehDas && /\bdas\b|simples|mei/.test(nomeC)) pn = Math.max(pn, 20);
      if (!pv && !pn) continue;   // só a data não basta
      if (data && ehMes(c.mes)) {
        const [a, m, d] = data.split('-').map(Number), [ca, cm] = c.mes.split('-').map(Number);
        const difMes = (a * 12 + m) - (ca * 12 + cm);
        if (difMes === 0) pd = 8; else if (Math.abs(difMes) === 1) pd = 3;
        const dia = Number(c.dia);
        if (Number.isInteger(dia) && dia >= 1 && dia <= 31) {
          const ultimo = new Date(Date.UTC(ca, cm, 0)).getUTCDate();   // dia 31 em mês de 30 -> dia 30
          const venc = Date.UTC(ca, cm - 1, Math.min(dia, ultimo)), pg = Date.UTC(a, m - 1, d);
          const dias = Math.abs(pg - venc) / 86400000;
          if (dias <= 3) pd += 8; else if (dias <= 7) pd += 4;
        }
      }
      res.push({ ref: c.ref, pontos: pv + pn + pd });
    }
    return res.sort((x, y) => y.pontos - x.pontos);
  }

  /* ══════════════ ZIP (sem compressão, sem dependências) ══════════════ */

  let TABELA_CRC = null;
  /** CRC-32 (IEEE 802.3), o mesmo do ZIP e do PNG. */
  function crc32(bytes) {
    if (!TABELA_CRC) {
      TABELA_CRC = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        TABELA_CRC[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // Data e hora no formato do MS-DOS (hora local, resolução de 2 s; o ZIP não aceita antes de 1980).
  function horaDos(dt) {
    const d = dt instanceof Date && !isNaN(dt) ? dt : new Date();
    const a = Math.min(2107, Math.max(1980, d.getFullYear()));
    return {
      hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      data: ((a - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  /** Monta um .zip "store" (sem compressão): cabeçalhos locais, diretório central e fim.
      Nomes em UTF-8 (bit 11 do campo de flags). Entradas: [{ nome, bytes:Uint8Array, data?:Date }]. */
  function zip(entradas) {
    if (!Array.isArray(entradas)) throw erro('Lista de arquivos inválida para o ZIP.');
    const enc = new TextEncoder(), partes = [], central = [];
    let pos = 0;
    for (const e of entradas) {
      if (!e || typeof e.nome !== 'string' || !e.nome || !(e.bytes instanceof Uint8Array)) throw erro('Arquivo inválido para o ZIP.');
      const nome = enc.encode(e.nome), dados = e.bytes, crc = crc32(dados), t = horaDos(e.data);
      if (pos + dados.length > 0xFFFFFFF0) throw erro('Comprovantes demais para um ZIP só (mais de 4 GB). Exporte um mês por vez.');
      const loc = new DataView(new ArrayBuffer(30));
      loc.setUint32(0, 0x04034b50, true);   // assinatura do cabeçalho local
      loc.setUint16(4, 20, true);           // versão necessária: 2.0
      loc.setUint16(6, 0x0800, true);       // flags: nome em UTF-8
      loc.setUint16(8, 0, true);            // método 0 = guardado, sem compressão
      loc.setUint16(10, t.hora, true);
      loc.setUint16(12, t.data, true);
      loc.setUint32(14, crc, true);
      loc.setUint32(18, dados.length, true); // tamanho comprimido
      loc.setUint32(22, dados.length, true); // tamanho original
      loc.setUint16(26, nome.length, true);
      loc.setUint16(28, 0, true);           // campo extra: nenhum
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);   // assinatura do diretório central
      cen.setUint16(4, 20, true);           // feito por: 2.0 (MS-DOS)
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, t.hora, true);
      cen.setUint16(14, t.data, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, dados.length, true);
      cen.setUint32(24, dados.length, true);
      cen.setUint16(28, nome.length, true);
      // 30: extra, 32: comentário, 34: disco, 36: atributos internos, 38: externos -> todos 0
      cen.setUint32(42, pos, true);         // onde começa o cabeçalho local
      partes.push(new Uint8Array(loc.buffer), nome, dados);
      central.push(new Uint8Array(cen.buffer), nome);
      pos += 30 + nome.length + dados.length;
    }
    const tamCentral = central.reduce((s, p) => s + p.length, 0);
    const fim = new DataView(new ArrayBuffer(22));
    fim.setUint32(0, 0x06054b50, true);
    fim.setUint16(8, entradas.length, true);
    fim.setUint16(10, entradas.length, true);
    fim.setUint32(12, tamCentral, true);
    fim.setUint32(16, pos, true);
    const tudo = [...partes, ...central, new Uint8Array(fim.buffer)];
    const out = new Uint8Array(tudo.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of tudo) { out.set(p, o); o += p.length; }
    return out;
  }

  /* ══════════════ IndexedDB ══════════════ */

  let promessaBanco = null;

  const req2p = r => new Promise((ok, falha) => { r.onsuccess = () => ok(r.result); r.onerror = () => falha(r.error); });
  const fimTx = tx => new Promise((ok, falha) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => falha(tx.error);
    tx.onabort = () => falha(tx.error || erro('Operação cancelada.'));
  });

  function traduz(e, padrao) {
    const n = e && e.name;
    if (n === 'QuotaExceededError') return erro('Acabou o espaço para guardar comprovantes neste aparelho. Exporte um ZIP e apague os antigos.');
    if (n === 'InvalidStateError' || n === 'UnknownError') return erro('O armazenamento do navegador falhou. Feche e abra o app de novo.');
    if (e && e.amigavel) return e;   // já é uma das nossas
    return erro(padrao);
  }

  /** Abre (ou cria) o banco. Pode ser chamada várias vezes: abre só uma. */
  function abrir() {
    if (promessaBanco) return promessaBanco.then(() => {});
    promessaBanco = new Promise((ok, falha) => {
      let idb;
      try { idb = raiz.indexedDB; } catch (e) { idb = null; }
      if (!idb) return falha(erro('Este navegador não deixa guardar arquivos (modo anônimo?). Abra o app normalmente para usar os comprovantes.'));
      let r;
      try { r = idb.open(NOME_BANCO, VERSAO); } catch (e) { return falha(erro('Não consegui abrir o cofre de comprovantes neste navegador.')); }
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(LOJA)) {
          const s = db.createObjectStore(LOJA, { keyPath: 'id' });
          s.createIndex('ref', 'ref', { unique: false });
          s.createIndex('mes', 'mes', { unique: false });
        }
        if (!db.objectStoreNames.contains(LOJA_CONTEUDO)) db.createObjectStore(LOJA_CONTEUDO, { keyPath: 'id' });
      };
      r.onsuccess = () => {
        const db = r.result;
        // outra aba atualizou o banco: fecho este para não travar, e reabro na próxima chamada
        db.onversionchange = () => { db.close(); promessaBanco = null; };
        db.onclose = () => { promessaBanco = null; };
        ok(db);
      };
      r.onblocked = () => falha(erro('O app está aberto em outra aba. Feche as outras abas e tente de novo.'));
      r.onerror = () => falha(traduz(r.error, 'Não consegui abrir o cofre de comprovantes.'));
    });
    promessaBanco.catch(() => { promessaBanco = null; });   // deixa tentar de novo depois
    return promessaBanco.then(() => {});
  }
  const banco = () => abrir().then(() => promessaBanco);

  /* ── imagens ── */

  const ehImagem = tipo => /^image\/(jpeg|jpg|png|webp|bmp|heic|heif|avif)$/i.test(tipo || '');

  async function decodificaImagem(blob) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* tenta pelo <img> */ }
      try { return await createImageBitmap(blob); } catch (e) { /* idem */ }
    }
    if (typeof Image === 'undefined' || typeof URL === 'undefined') return null;
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise(ok => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = () => ok(null);
        img.src = url;
      });
    } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
  }

  function tela(l, a) {
    if (typeof OffscreenCanvas === 'function') {
      try { const c = new OffscreenCanvas(l, a); if (c.getContext('2d')) return c; } catch (e) { /* cai no <canvas> */ }
    }
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = l; c.height = a;
    return c;
  }
  function paraBlob(c, tipo, q) {
    if (c.convertToBlob) return c.convertToBlob({ type: tipo, quality: q }).catch(() => null);
    return new Promise(ok => { try { c.toBlob(b => ok(b), tipo, q); } catch (e) { ok(null); } });
  }
  function blobParaDataURL(b) {
    return new Promise(ok => {
      if (!b || typeof FileReader === 'undefined') return ok(null);
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.onerror = () => ok(null);
      fr.readAsDataURL(b);
    });
  }
  // Desenha a imagem com o lado maior <= max; fundo branco (PNG transparente vira JPEG sem fundo preto).
  async function redesenha(img, max, q) {
    const l0 = img.width || img.naturalWidth, a0 = img.height || img.naturalHeight;
    if (!l0 || !a0) return null;
    const f = Math.min(1, max / Math.max(l0, a0));
    const l = Math.max(1, Math.round(l0 * f)), a = Math.max(1, Math.round(a0 * f));
    const c = tela(l, a);
    if (!c) return null;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, l, a);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, l, a);
    const b = await paraBlob(c, 'image/jpeg', q);
    return b && b.size ? { blob: b, largura: l, altura: a } : null;
  }

  // Reduz a imagem (se valer a pena) e faz a miniatura. Nunca falha: no pior caso, fica o original.
  async function preparaImagem(arquivo) {
    const img = await decodificaImagem(arquivo);
    if (!img) return { blob: arquivo, miniatura: null, regravada: false };
    try {
      let blob = arquivo, regravada = false;
      const r = await redesenha(img, LADO_MAX, QUALIDADE);
      if (r && r.blob.size < arquivo.size) { blob = r.blob; regravada = true; }
      const mini = await redesenha(img, LADO_MINI, QUALIDADE_MINI);
      return { blob, miniatura: mini ? await blobParaDataURL(mini.blob) : null, regravada };
    } catch (e) {
      return { blob: arquivo, miniatura: null, regravada: false };
    } finally { if (img.close) img.close(); }
  }

  /* ── salvar, listar, obter, apagar ── */

  const novoId = () => 'cp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const extensao = nome => { const m = /\.([A-Za-z0-9]{1,5})$/.exec(nome || ''); return m ? m[1].toLowerCase() : ''; };
  const EXT_TIPO = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
    heif: 'image/heif', txt: 'text/plain', csv: 'text/csv', html: 'text/html', ofx: 'application/x-ofx', xml: 'text/xml' };
  const TIPO_EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic',
    'image/heif': 'heif', 'text/plain': 'txt', 'text/csv': 'csv', 'text/html': 'html', 'text/xml': 'xml' };
  const tipoDe = (blob, nome) => (blob.type || EXT_TIPO[extensao(nome)] || 'application/octet-stream').toLowerCase();

  async function lerBytes(blob) {
    if (blob.arrayBuffer) return blob.arrayBuffer();
    return new Promise((ok, falha) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result);
      fr.onerror = () => falha(erro('Não consegui ler o arquivo.'));
      fr.readAsArrayBuffer(blob);
    });
  }

  function validaMeta(meta) {
    if (!meta || typeof meta !== 'object') return 'Faltam os dados do comprovante.';
    if (typeof meta.ref !== 'string' || !meta.ref.trim()) return 'Escolha a qual conta este comprovante pertence.';
    if (!ehMes(meta.mes)) return 'Mês inválido (use AAAA-MM).';
    if (meta.valor != null && !(typeof meta.valor === 'number' && isFinite(meta.valor))) return 'Valor inválido.';
    if (meta.data != null && meta.data !== '' && !ehDataISO(meta.data)) return 'Data inválida (use AAAA-MM-DD).';
    if (meta.nome != null && typeof meta.nome !== 'string') return 'Nome do arquivo inválido.';
    if (meta.nota != null && typeof meta.nota !== 'string') return 'Anotação inválida.';
    return null;
  }

  /** Guarda o arquivo como comprovante de `meta.ref` no mês `meta.mes`. */
  async function salvar(arquivo, meta) {
    try {
      if (!ehBlob(arquivo)) throw erro('Escolha um arquivo (foto ou PDF) para guardar.');
      if (!arquivo.size) throw erro('Este arquivo está vazio.');
      if (arquivo.size > TAMANHO_MAX) throw erro('Arquivo grande demais (máx. 40 MB). Tire um print ou mande o PDF.');
      const problema = validaMeta(meta);
      if (problema) throw erro(problema);
      const db = await banco();
      let nome = String(meta.nome || arquivo.name || 'comprovante').trim().slice(0, 120) || 'comprovante';
      let tipo = tipoDe(arquivo, nome), blob = arquivo, miniatura = null;
      if (ehImagem(tipo)) {
        const p = await preparaImagem(arquivo);
        blob = p.blob; miniatura = p.miniatura;
        if (p.regravada) { tipo = 'image/jpeg'; nome = nome.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.jpg'; }
      }
      const bytes = await lerBytes(blob);
      const reg = { id: novoId(), ref: meta.ref.trim(), mes: meta.mes, nome, tipo, tamanho: bytes.byteLength, criado: new Date().toISOString(), miniatura };
      if (meta.valor != null) reg.valor = Math.round(meta.valor * 100) / 100;
      if (meta.data) reg.data = meta.data;
      if (meta.nota) reg.nota = meta.nota.slice(0, 2000);
      const tx = db.transaction([LOJA, LOJA_CONTEUDO], 'readwrite');
      tx.objectStore(LOJA).put(reg);
      tx.objectStore(LOJA_CONTEUDO).put({ id: reg.id, bytes });
      await fimTx(tx);
      // pede ao navegador para não apagar estes dados quando faltar espaço (sem custo se negar)
      try { if (raiz.navigator && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {}); } catch (e) { /* ok */ }
      return Object.assign({}, reg);
    } catch (e) { throw traduz(e, 'Não consegui guardar o comprovante. Tente de novo.'); }
  }

  /** Grava um comprovante que veio de outro aparelho (sincronização), com o mesmo id e dados. */
  async function importar(registro, bytes) {
    try {
      if (!registro || typeof registro.id !== 'string' || !registro.id || typeof registro.ref !== 'string') throw erro('Comprovante inválido.');
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const db = await banco();
      const tx = db.transaction([LOJA, LOJA_CONTEUDO], 'readwrite');
      tx.objectStore(LOJA).put(Object.assign({}, registro, { tamanho: b.byteLength }));
      tx.objectStore(LOJA_CONTEUDO).put({ id: registro.id, bytes: b });
      await fimTx(tx);
    } catch (e) { throw traduz(e, 'Não consegui gravar o comprovante sincronizado.'); }
  }

  /** Dados dos comprovantes (sem os arquivos), mais novo primeiro. filtro = { ref?, mes? } */
  async function listar(filtro) {
    try {
      const f = filtro && typeof filtro === 'object' ? filtro : {};
      const db = await banco();
      const loja = db.transaction(LOJA, 'readonly').objectStore(LOJA);
      let regs;
      if (f.ref != null) regs = await req2p(loja.index('ref').getAll(String(f.ref)));
      else if (f.mes != null) regs = await req2p(loja.index('mes').getAll(String(f.mes)));
      else regs = await req2p(loja.getAll());
      if (f.mes != null) regs = regs.filter(r => r.mes === String(f.mes));
      return regs.sort((a, b) => (a.criado < b.criado ? 1 : a.criado > b.criado ? -1 : (a.id < b.id ? 1 : -1)));
    } catch (e) { throw traduz(e, 'Não consegui ler os comprovantes guardados.'); }
  }

  /** O comprovante e o arquivo; null se não existe. */
  async function obter(id) {
    try {
      if (typeof id !== 'string' || !id) return null;
      const db = await banco();
      const tx = db.transaction([LOJA, LOJA_CONTEUDO], 'readonly');
      const [registro, conteudo] = await Promise.all([req2p(tx.objectStore(LOJA).get(id)), req2p(tx.objectStore(LOJA_CONTEUDO).get(id))]);
      if (!registro || !conteudo) return null;
      return { registro, blob: new Blob([conteudo.bytes], { type: registro.tipo }) };
    } catch (e) { throw traduz(e, 'Não consegui abrir o comprovante.'); }
  }

  /** Apaga o comprovante (não reclama se ele já não existe). */
  async function apagar(id) {
    try {
      if (typeof id !== 'string' || !id) throw erro('Comprovante inválido.');
      const db = await banco();
      const tx = db.transaction([LOJA, LOJA_CONTEUDO], 'readwrite');
      tx.objectStore(LOJA).delete(id);
      tx.objectStore(LOJA_CONTEUDO).delete(id);
      await fimTx(tx);
    } catch (e) { throw traduz(e, 'Não consegui apagar o comprovante.'); }
  }

  /** Quantos comprovantes e quantos bytes ocupam. */
  async function uso() {
    const regs = await listar();
    return { n: regs.length, bytes: regs.reduce((s, r) => s + (r.tamanho || 0), 0) };
  }

  /* ══════════════ lerInfo: texto do PDF ══════════════ */

  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  let promessaPdfjs = null;
  function carregaPdfjs() {
    if (raiz.pdfjsLib) return Promise.resolve(raiz.pdfjsLib);
    if (promessaPdfjs) return promessaPdfjs;
    promessaPdfjs = new Promise((ok, falha) => {
      if (typeof document === 'undefined') return falha(erro('Leitor de PDF indisponível.'));
      const s = document.createElement('script');
      s.src = PDFJS + 'pdf.min.js';
      s.async = true;
      s.onload = () => raiz.pdfjsLib ? ok(raiz.pdfjsLib) : falha(erro('Leitor de PDF indisponível.'));
      s.onerror = () => falha(erro('Leitor de PDF indisponível.'));
      document.head.appendChild(s);
    }).then(lib => {
      try { if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; } catch (e) { /* ok */ }
      return lib;
    });
    promessaPdfjs.catch(() => { promessaPdfjs = null; });
    return promessaPdfjs;
  }

  // Junta os pedaços de texto do pdf.js em linhas (mesma altura = mesma linha).
  async function textoDoPdf(bytes) {
    const lib = await carregaPdfjs();
    if (lib.GlobalWorkerOptions && !lib.GlobalWorkerOptions.workerSrc) lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    const doc = await lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false }).promise;
    const paginas = [];
    try {
      for (let p = 1; p <= Math.min(doc.numPages, 10); p++) {
        const pg = await doc.getPage(p), tc = await pg.getTextContent();
        const linhas = [];
        for (const it of tc.items) {
          if (typeof it.str !== 'string') continue;
          const y = it.transform ? it.transform[5] : 0, x = it.transform ? it.transform[4] : 0;
          let l = linhas.find(q => Math.abs(q.y - y) < Math.max(2, (it.height || 8) * 0.4));
          if (!l) { l = { y, partes: [] }; linhas.push(l); }
          l.partes.push({ x, s: it.str });
        }
        linhas.sort((a, b) => b.y - a.y);
        paginas.push(linhas.map(l => l.partes.sort((a, b) => a.x - b.x).map(q => q.s).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
      }
    } finally { try { doc.destroy(); } catch (e) { /* ok */ } }
    return paginas.join('\n');
  }

  function decodificaTexto(bytes) {
    const u8 = new Uint8Array(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { /* não é UTF-8 */ }
    try { return new TextDecoder('windows-1252').decode(u8); } catch (e) { return new TextDecoder().decode(u8); }
  }

  /** Lê valor, data e nomes do comprovante. PDF e texto: sim. Foto: não (sem OCR) -> tudo vazio.
      Se o leitor de PDF não carregar (sem internet), devolve vazio com `aviso`. */
  async function lerInfo(arquivo) {
    const vazio = { valor: null, data: null, nomes: [], texto: '' };
    if (!ehBlob(arquivo)) throw erro('Escolha um arquivo para ler.');
    let bytes;
    try { bytes = await lerBytes(arquivo); } catch (e) { throw erro('Não consegui ler o arquivo.'); }
    const u8 = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 1024));
    const cabeca = String.fromCharCode.apply(null, u8);
    const tipo = tipoDe(arquivo, arquivo.name);
    let texto = '';
    if (tipo === 'application/pdf' || cabeca.indexOf('%PDF-') >= 0) {
      try { texto = await textoDoPdf(bytes); } catch (e) {
        const semRede = /indispon/.test(e && e.message);
        return Object.assign(vazio, { aviso: semRede ? 'Sem internet para abrir o leitor de PDF. Preencha valor e data à mão.' : 'Não consegui ler o texto deste PDF. Preencha valor e data à mão.' });
      }
      if (!texto.trim()) return Object.assign(vazio, { aviso: 'Este PDF parece ser uma imagem escaneada; preencha valor e data à mão.' });
    } else if (/^text\/|json|xml|ofx/.test(tipo) || /^(txt|csv|html?|ofx|xml|json)$/.test(extensao(arquivo.name))) {
      texto = decodificaTexto(bytes);
      if (/^text\/html/.test(tipo) || /<\/?(html|body|div|td|p)\b/i.test(texto)) texto = texto.replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
    } else {
      return vazio;   // foto: sem OCR
    }
    const valor = achaValor(texto);
    return { valor, data: achaData(texto, new Date().getFullYear()), nomes: achaNomes(texto), texto: texto.slice(0, 20000) };
  }

  /* ══════════════ exportar ZIP ══════════════ */

  // Nome seguro para arquivo dentro do ZIP (mantém acentos; tira / \ : * ? " < > | e controles).
  function nomeLimpo(s) {
    const base = String(s || '').replace(/\.[A-Za-z0-9]{1,5}$/, '').normalize('NFC')
      .replace(/[\u0000-\u001f\u007f/\\:*?"<>|#%]+/g, ' ').replace(/\s+/g, '-').replace(/-+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '').slice(0, 60);
    return base || 'comprovante';
  }
  function celulaCsv(v, texto) {
    let s = v == null ? '' : String(v);
    if (texto && /^[=+\-@\t\r]/.test(s)) s = "'" + s;   // evita fórmula ao abrir no Excel
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** ZIP com os comprovantes (todos, ou os passados) em pastas por mês, mais um comprovantes.csv. */
  async function exportarZip(registros) {
    try {
      if (registros != null && !Array.isArray(registros)) throw erro('Lista de comprovantes inválida.');
      const regs = registros || await listar();
      const entradas = [], usados = new Set();
      const csv = ['mes;ref;nome;valor;data;arquivo;nota'];
      const ordem = regs.slice().sort((a, b) => (a.mes + a.criado < b.mes + b.criado ? -1 : 1));
      for (const r0 of ordem) {
        if (!r0 || typeof r0.id !== 'string') continue;
        const o = await obter(r0.id);
        if (!o) continue;
        const r = o.registro;
        const ext = extensao(r.nome) || TIPO_EXT[r.tipo] || 'bin';
        const quando = r.data || String(r.criado || '').slice(0, 10) || 'sem-data';
        const mes = ehMes(r.mes) ? r.mes : 'sem-mes';
        let caminho = mes + '/' + nomeLimpo(r.nome) + '_' + quando + '.' + ext;
        for (let k = 2; usados.has(caminho); k++) caminho = mes + '/' + nomeLimpo(r.nome) + '_' + quando + '-' + k + '.' + ext;
        usados.add(caminho);
        const dt = r.criado ? new Date(r.criado) : new Date();
        entradas.push({ nome: caminho, bytes: new Uint8Array(await lerBytes(o.blob)), data: dt });
        const valor = typeof r.valor === 'number' ? r.valor.toFixed(2).replace('.', ',') : '';
        csv.push([celulaCsv(r.mes), celulaCsv(r.ref, true), celulaCsv(r.nome, true), valor, celulaCsv(r.data || ''), celulaCsv(caminho), celulaCsv(r.nota || '', true)].join(';'));
      }
      // BOM para o Excel entender os acentos
      entradas.push({ nome: 'comprovantes.csv', bytes: new TextEncoder().encode('﻿' + csv.join('\r\n') + '\r\n'), data: new Date() });
      return new Blob([zip(entradas)], { type: 'application/zip' });
    } catch (e) { throw traduz(e, 'Não consegui montar o ZIP dos comprovantes.'); }
  }

  raiz.Comprovantes = {
    abrir, salvar, listar, obter, apagar, uso, lerInfo, sugerir, exportarZip, importar,
    _crc32: crc32, _zip: zip, _achaValor: achaValor, _achaData: achaData, _achaNomes: achaNomes,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
