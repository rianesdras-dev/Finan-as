/* extrato.js: leitor de extratos de banco e classificador de transações.
   Script clássico (sem módulos), carregado pela página com <script src="extrato.js">.
   Tudo roda no aparelho; nada é enviado para fora.

   API (globalThis.Extrato):
     decodificar(bytes)              -> texto (UTF-8, ou windows-1252 quando o UTF-8 não serve)
     ler(texto, nomeArquivo?, op?)   -> Resultado  (OFX, CSV ou texto livre)
     lerTexto(texto, op?)            -> Resultado  (linhas coladas do app ou tiradas de um PDF)
     chave(desc)                     -> chave estável do comerciante, para aprender correções
     classificar(t, regras?)         -> { tipo, cat, assinatura, confianca, chave }

   Resultado  = { formato, banco, conta, transacoes, avisos }
   Transacao  = { id, data:'AAAA-MM-DD', valor, desc, original, parcela:{k,n}|null, conta }
   valor < 0 é dinheiro saindo; valor > 0 é dinheiro entrando. */
(function (raiz) {
  'use strict';

  /* ── utilidades de texto ── */

  const semAcento = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Forma usada para casar palavras-chave: minúsculas, sem acento, espaço entre letra e número,
  // tudo o que não é [a-z0-9] vira espaço. Ex.: 'RAIA123' -> 'raia 123', '99FOOD' -> '99 food'.
  function normalizar(s) {
    return semAcento(s).toLowerCase().replace(/\bi\.o\.f\b\.?/g, 'iof')
      .replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const temLetras = s => /[a-zA-ZÀ-ÿ]{2,}/.test(s || '');
  const espacos = s => String(s || '').replace(/[\u00a0\t]/g, ' ').replace(/\s+/g, ' ').trim();

  // Título em caixa alta vira "Título Normal" (só quando não há nenhuma minúscula).
  const MINUSC = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'para', 'por', 'com']);
  function tituloSeCaixaAlta(s) {
    if (/[a-zà-ÿ]/.test(s) || !/[A-ZÀ-Þ]{4,}/.test(s)) return s;
    return s.toLowerCase().replace(/[a-zà-ÿ][^\s*/.\-:"(]*/g, (w, i) =>
      (i > 0 && MINUSC.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1));
  }

  // Hash FNV-1a de 32 bits, duas sementes -> id curto e estável.
  function hash(str, h) {
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    return h.toString(36);
  }
  const hashCurto = s => hash(s, 2166136261) + hash(s, 0x9747b28c).slice(0, 4);

  /* ── decodificação de bytes ── */

  const CP1252 = [0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
    0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178];
  function decod1252(u8) {
    try {   // alguns Node decodificam 'windows-1252' como latin-1: corrige a faixa 0x80-0x9F
      return new TextDecoder('windows-1252').decode(u8).replace(/[\u0080-\u009f]/g, c => String.fromCharCode(CP1252[c.charCodeAt(0) - 0x80]));
    } catch (e) { /* sem ICU: faz à mão */ }
    let s = '';
    for (let i = 0; i < u8.length; i++) { const b = u8[i]; s += String.fromCharCode(b >= 0x80 && b < 0xA0 ? CP1252[b - 0x80] : b); }
    return s;
  }
  function paraBytes(b) {
    if (b == null) return new Uint8Array(0);
    if (typeof b === 'string') return null;
    if (b.buffer && typeof b.byteLength === 'number') return new Uint8Array(b.buffer, b.byteOffset || 0, b.byteLength);
    if (typeof b.byteLength === 'number') return new Uint8Array(b);
    if (Array.isArray(b)) return Uint8Array.from(b);
    return new Uint8Array(0);
  }
  // Tenta UTF-8 primeiro (há OFX que dizem CHARSET:1252 mas vêm em UTF-8) e cai para windows-1252.
  function decodificar(bytes) {
    try {
      if (typeof bytes === 'string') return bytes.replace(/^\ufeff/, '');
      let u8 = paraBytes(bytes);
      if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) u8 = u8.subarray(3);
      else if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
      else if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
      let alto = false;
      for (let i = 0; i < u8.length; i++) if (u8[i] > 0x7F) { alto = true; break; }
      if (!alto) return new TextDecoder('utf-8').decode(u8);
      try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return decod1252(u8); }
    } catch (e) {
      return '';
    }
  }
  // 'lanÃ§amento' (UTF-8 lido como Latin-1) -> 'lançamento'
  function consertarMojibake(s) {
    if (!/Ã[\u0080-¿]|Ã§|Ã£|Ã©|Ã¡|Ãª|Ã³|Ãº|Ã\u00ad/.test(s)) return s;
    const u8 = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c > 0xFF) { const j = CP1252.indexOf(c); if (j < 0) return s; c = 0x80 + j; }
      u8[i] = c;
    }
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); } catch (e) { return s; }
  }

  /* ── números e datas ── */

  // Lê '1.234,56', '-1.234,56', '1234.56', 'R$ 1.234,56', '-R$ 318,19', 'R$ -48,51', '- 4.049,78',
  // '(1.234,56)', '150,00-', '150,00 D', '127,00 C', '\u2212R$ 16,00', '+R$ 5,00'. Devolve NaN se não for número.
  function lerValor(txt) {
    let s = String(txt == null ? '' : txt).replace(/[\u2212\u2013\u2014]/g, '-').replace(/\u00a0/g, ' ').trim();
    if (!s) return NaN;
    let neg = false;
    const cd = s.match(/\s*\b([DC])$/i);
    if (cd && /\d/.test(s.slice(0, cd.index))) { s = s.slice(0, cd.index); if (cd[1].toUpperCase() === 'D') neg = true; }
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/R\$|US\$|BRL/gi, '').replace(/\s+/g, '');
    if (/-$/.test(s)) { neg = !neg; s = s.slice(0, -1); }
    let m = s.match(/^([+-]*)(.*)$/);
    if (m[1].includes('-')) neg = !neg;
    s = m[2];
    if (/^[+-]/.test(s)) { if (s[0] === '-') neg = !neg; s = s.slice(1); }
    if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return NaN;
    // en-US ('1,234.56', '2,000.00', '1,234,567.8'): vírgula como milhar quando há ponto depois dela
    if (/^\d{1,3}(,\d{3})+\.\d+$/.test(s) || /^\d+(,\d{3})*\.\d{1,2}$/.test(s) && s.includes(',')) s = s.replace(/,/g, '');
    else if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s) && (s.match(/\./g).length > 1 || /^\d{1,3}\.\d{3}$/.test(s))) s = s.replace(/\./g, '');
    else if ((s.match(/\./g) || []).length > 1) { const k = s.lastIndexOf('.'); s = s.slice(0, k).replace(/\./g, '') + s.slice(k); }
    const v = parseFloat(s);
    return isFinite(v) ? Math.round((neg ? -v : v) * 100) / 100 : NaN;
  }

  const pad = n => (n < 10 ? '0' : '') + n;
  function dataValida(a, m, d) {
    if (!(a >= 1990 && a <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(Date.UTC(a, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return null;
    return a + '-' + pad(m) + '-' + pad(d);
  }
  const ano4 = a => (a < 100 ? 2000 + a : a);
  // Datas completas: DD/MM/AAAA, DD/MM/AA, AAAA-MM-DD, DD-MM-AAAA, DD.MM.AAAA (com hora opcional depois).
  function lerData(txt) {
    const s = String(txt || '').trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return dataValida(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?!\d)/);
    if (m) return dataValida(ano4(+m[3]), +m[2], +m[1]);
    m = s.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) return dataValida(+m[1], +m[2], +m[3]);
    return null;
  }
  const iso = (a, m, d) => dataValida(a, m, d);
  function somarMeses(dataIso, n) {
    const [a, m, d] = dataIso.split('-').map(Number);
    const t = (a * 12 + (m - 1)) + n, na = Math.floor(t / 12), nm = t % 12 + 1;
    const ult = new Date(Date.UTC(na, nm, 0)).getUTCDate();
    return na + '-' + pad(nm) + '-' + pad(Math.min(d, ult));
  }
  const diasEntre = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);
  function hojeIso() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  const MESES = { jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7, ago: 8, aug: 8,
    set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12 };
  const MES_EXTENSO = { janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8,
    setembro: 9, outubro: 10, novembro: 11, dezembro: 12 };
  function mesDe(palavra) {
    const p = semAcento(palavra).toLowerCase().replace(/\.$/, '');
    if (MES_EXTENSO[p]) return MES_EXTENSO[p];
    return p.length === 3 ? (MESES[p] || 0) : 0;
  }

  /* ── parcelas ── */

  // ' - Parcela 2/3', 'PARC 05/06', '(Parcela 02 de 05)', 'Parcela 6 de 10'.
  const RE_PARCELA = /\bparc(?:ela)?\.?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i;
  function parcelaOk(k, n) { return n >= 2 && n <= 48 && k >= 1 && k <= n ? { k, n } : null; }
  // soltas: só para fatura de cartão ('LOJA EXEMPLO 02/03', 'ROUPA03/06', 'RAIA2349 03/03 SAO PAULO')
  function lerParcela(desc, cartao, coluna) {
    const s = String(desc || '');
    if (coluna) {
      const c = s.trim().match(/^(?:parc(?:ela)?\.?\s*)?(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})$/i);
      if (c) return parcelaOk(+c[1], +c[2]);
    }
    let m = s.match(RE_PARCELA);
    if (m) return parcelaOk(+m[1], +m[2]);
    // 'LOJA EXEMPLO 3 de 12' (sem 'parc'): só número de 1-2 dígitos, não seguido de outro 'de' (data por extenso)
    m = s.match(/(?:^|\s)(\d{1,2})\s+de\s+(\d{1,2})(?!\s*(?:de\b|\/|\d))(?=\s|$|[)\]-])/i);
    if (m) { const p = parcelaOk(+m[1], +m[2]); if (p) return p; }
    if (cartao) {
      const re = /(?:^|[\sA-Za-z*])(\d{2})\/(\d{2})(?=\s|$)/g;
      while ((m = re.exec(s))) { const p = parcelaOk(+m[1], +m[2]); if (p) return p; }
      m = s.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})$/);
      if (m) return parcelaOk(+m[1], +m[2]);
    }
    return null;
  }

  /* ── chave do comerciante ── */

  // bancos e instituições que aparecem no meio de Pix/TED e não são a contraparte
  const RE_BANCOS = /\b(nu pagamentos?( s\.?a\.?)?( - ip| ip)?|itau unibanco( s\.?a\.?)?|itau|bco do brasil|banco do brasil|caixa economica federal|banco inter( s\.?a\.?)?|picpay( servicos)?|mercado pago( ip| instituicao de pagamento)?|pagseguro internet( ip)?|c6 bank|banco c6|banco bradesco( s\.?a\.?)?|bradesco|santander|banco santander|bco [a-z ]{2,30}?s\.?a\.?|ebanx( ip)?( ltda\.?)?|cora scd|stone ip|neon pagamentos|banco btg pactual|xp investimentos)\b/g;
  const RE_TRANSF = /\bpix\b|\btransf|\bted\b|\bdoc\b|\btev\b/;

  // "Transferência enviada pelo Pix - NOME - \u2022\u2022\u2022.123.456-\u2022\u2022 - BANCO (0341) Agência: 1 Conta: 12345-6"
  // -> mantém o rótulo e o NOME; tira CPF/CNPJ, banco, agência e conta.
  function limparContraparte(s) {
    const partes = s.split(/\s+[-\u2013]\s+/).filter(p => {
      const t = p.trim();
      if (/\(\d{3,4}\)|\bag(encia|\.)?\s*:|\bconta\s*:/.test(t)) return false;   // banco (0341) Agência: 1 Conta: 2
      if (!/[a-z]{2,}/.test(t) || t.length <= 2) return false;                         // CPF/CNPJ mascarado, 'IP'
      return t.replace(RE_BANCOS, ' ').replace(/[^a-z]/g, '').length >= 2;              // só o nome do banco
    });
    return partes.join(' ').replace(RE_BANCOS, ' ');
  }

  // palavras genéricas que abrem a descrição e não dizem quem é o comerciante
  const PREFIXOS = new Set(('compra compras no na debito credito via nupay cartao cart com pagamento pagamentos pagto pgto pag pg de do da ' +
    'pix transferencia transf ted doc tev enviado enviada enviou recebido recebida recebimento pelo pela para envio cred saida entrada ' +
    'qrs qr code dinamico estatico realizada efetuado efetuada boleto ec mp dl dlocal ebn ebanx paypal pp picpay pic zp htm sumup ton ' +
    'mercadopago stone cielo getnet pagseguro pagbank pagbk shpp bd dm ppro des rem aut automatico elo visa mastercard maestro electron estorno ' +
    'reembolso devolucao devolvido pay eletron cobranca agendado internacional nacional operacao').split(' '));
  const PARADAS = new Set('de da do das dos e a o em no na para pelo pela com ltda sa me eireli epp cia ip the of ltd inc llc s/a'.split(' '));
  const PAISES = new Set(['br', 'bra', 'usa', 'us', 'brazil']);
  const UFS = new Set('ac al ap am ba ce df es go ma mt ms mg pa pb pr pe pi rj rn rs ro rr sc sp se to'.split(' '));
  const CIDADES = ('sao paulo|rio de janeiro|belo horizonte|brasilia|curitiba|porto alegre|salvador|recife|fortaleza|campinas|goiania|' +
    'manaus|belem|florianopolis|vitoria|vila velha|niteroi|santos|osasco|guarulhos|sao jose dos campos|sao jose dos|sao jose|ribeirao preto|' +
    'uberlandia|sorocaba|juiz de fora|londrina|joinville|natal|maceio|joao pessoa|teresina|aracaju|cuiaba|campo grande|sao luis|' +
    'porto velho|macapa|boa vista|palmas|rio branco|barueri|sao bernardo do campo|sao bernardo|santo andre|sao caetano do sul|contagem|' +
    'betim|maringa|cascavel|blumenau|petropolis|sao goncalo|duque de caxias|nova iguacu|porto seguro|jundiai|piracicaba|bauru|' +
    'mogi das cruzes|taubate|franca|limeira|santana de parnaiba|cotia|diadema|carapicuiba|praia grande|sao vicente|guaruja|' +
    'san francisco|mountain view|dublin|amsterdam|london|luxembourg|seattle|new york|los gatos|cupertino|palo alto|miami|internet|online').split('|').map(c => c.split(' ')).sort((a, b) => b.length - a.length);

  function tirarLocal(tok) {
    for (let volta = 0; volta < 4 && tok.length > 1; volta++) {
      const antes = tok.length, ult = tok[tok.length - 1];
      if (PAISES.has(ult) || UFS.has(ult)) { tok.pop(); continue; }
      for (const c of CIDADES) {
        if (tok.length <= c.length) continue;
        const cauda = tok.slice(tok.length - c.length);
        const ok = cauda.every((w, i) => w === c[i] || (c.length > 1 && i === c.length - 1 && w.length >= 3 && c[i].startsWith(w)));
        if (ok) { tok.splice(tok.length - c.length); break; }
      }
      if (tok.length === antes) break;
    }
    return tok;
  }

  // Chave normalizada usada para aprender as correções do usuário.
  function chave(desc) {
    let s = semAcento(desc).toLowerCase().replace(/[\u2212\u2013]/g, '-').replace(/[\u2022\u00b7\u25cf]/g, ' ');
    if (RE_TRANSF.test(s)) s = limparContraparte(s);
    s = s
      .replace(/\(\s*parc[^)]*\)/g, ' ')
      .replace(/\bparc(?:ela)?\.?\s*\d{1,2}\s*(?:\/|de)\s*\d{1,2}\b/g, ' ')
      .replace(/(^|\s)\d{1,2}\s+de\s+\d{1,2}(?=\s|$)/g, ' ')
      .replace(/\bmercado\s*pago\b/g, ' mercadopago ')
      .replace(/cp\s*:\s*\d+\s*-?/g, ' ')
      .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
      .replace(/\b\d{1,2} (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/g, ' ')
      .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, ' ')
      .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ')
      .replace(/help\.u[\w.]*/g, ' ').replace(/\bwww\./g, ' ')
      .replace(/\.(com|net|org)(\.br)?\b|\.(br|ai|io|app|tv)\b/g, ' ')
      .replace(/\bpay\s*-\s*ifd\b/g, ' ifood ').replace(/\bifd\b\s*\*?/g, ' ifood ').replace(/\bifood\s*\*/g, ' ifood ')
      .replace(/\b99\s*\*?\s*(?:99\s*)?(app|pop|taxi|food|ride|moto)\b/g, ' 99$1 ')
      .replace(/[^a-z0-9]+/g, ' ');
    let tok = s.split(' ').filter(Boolean);
    while (tok.length && PREFIXOS.has(tok[0])) tok.shift();
    tok = tok.map(w => (/^99(app|pop|taxi|food|ride|moto)$/.test(w) ? w : w.replace(/\d+/g, '')))
      .filter(w => w.length > 1 && !PARADAS.has(w));
    while (tok.length && PREFIXOS.has(tok[0])) tok.shift();
    tok = tirarLocal(tok).filter((w, i, a) => w !== a[i - 1]);
    if (!tok.length) {   // só sobrou palavra genérica ('PIX ENVIADO'): devolve ela mesma, estável
      tok = normalizar(desc).replace(/\bmercado ?pago\b/g, 'mercadopago').split(' ').filter(w => w.length > 1 && !/\d/.test(w) && !PARADAS.has(w));
      if (tok.includes('mercadopago')) tok = ['mercadopago'];
    }
    return tok.slice(0, 3).join(' ');
  }
  // true quando a chave só tem palavras genéricas: aprender regra nela pegaria todo Pix/TED igual
  function generica(ch) {
    const w = String(ch || '').split(' ').filter(Boolean);
    return !w.length || w.every(x => PREFIXOS.has(x) || PARADAS.has(x) || x === 'fatura' || x === 'saque');
  }

  /* ── dicionário ──
     Palavras já na forma normalizar(). '_' marca borda de palavra: '_bar_' = palavra inteira,
     '_posto' = começo de palavra, sem '_' = pedaço em qualquer lugar. Palavras sem '_' com até
     4 letras viram palavra inteira automaticamente. */
  const DIC = {
    comida: 'ifood|_ifd_|rappi|99 food|uber eats|ubereats|aiqfome|james delivery|delivery much|keeta|goomer|anota ai|delivery|' +
      'restaurante|restaurant|_restaur|_rest_|lanchonete|_lanch|pizza|hamburg|burger|burguer|sushi|temaki|yakisoba|_poke_|' +
      'japones|churrascaria|churrasco|steakhouse|_grill|parrilla|galeto|espetinho|cantina|trattoria|bistro|brasserie|' +
      'gastrobar|cozinha|kitchen|comida|marmita|marmitex|quentinha|self service|food truck|foodtruck|_food_|rotisserie|' +
      'cafeteria|_cafe_|_cafes_|coffee|starbucks|sorvet|gelato|gelateria|_acai|doceria|chocolate|kopenhagen|cacau show|' +
      'pastelaria|_pastel_|esfiha|esfirra|_crepe|tapioca|churros|hot dog|hotdog|cachorro quente|outback|madero|habib|' +
      'burger king|_bk_|mcdonald|_bobs_|subway|spoleto|_kfc_|pizza hut|dominos|_buffet_|ifood club',
    mercado: 'supermercado|supermerc|hipermercado|_hiper_|mercad|mercadinho|mercearia|atacad|atacarejo|assai|carrefour|pao de acucar|' +
      'paodeacucar|_gpa_|_extra_|extra hiper|extra super|mini extra|dia brasil|supermercado dia|_horti|hortifruti|_zona sul_|' +
      'guanabara|mambo|hirota|sams club|_coop_|_daki_|shopper|jokr|sacolao|varejao|quitanda|feira livre|armazem|_acougue|' +
      'peixaria|emporio|ceasa|supermercados pague menos',
    role: '_bar_|hostel|resort|_motel|smiles|hbomax|primevideo|amazonprime|youtubepremium|gamepass|kindle unltd|globo play|boteco|' +
      '_pub_|_chopp|_chope|cervejaria|_brew|_beer|adega|wine|ze delivery|balada|boate|nightclub|_lounge|cinema|cinemark|' +
      'cinepolis|kinoplex|_uci_|_cine_|ingresso|sympla|eventim|ticketmaster|_zig_|_show_|_shows_|festival|teatro|museu|' +
      'carnaval|hotel|pousada|airbnb|booking|decolar|_cvc_|latam|gol linhas|voegol|azul linhas|voeazul|_ibis_|netflix|spotify|' +
      'disney|hbo max|max com|_hbo_|prime video|amazon prime|amazon music|kindle unlimited|audible|deezer|globoplay|telecine|' +
      'paramount|crunchyroll|_tidal|_mubi_|apple music|apple tv|youtube premium|youtube music|google youtube|dazn|premiere|' +
      'steam|epic games|nintendo|riot games|roblox|playstation|_psn_|xbox|microsoft xbox|game pass|google play|twitch',
    transp: '_uber_|_ubr_|uber trip|uber do brasil|uber one|uber flash|99 app|99 pop|99 taxi|99 tecnologia|99 ride|99 moto|cabify|' +
      'indriver|taxi|_posto|auto posto|autoposto|combustiv|_shell_|shellbox|posto ipiranga|abastece ai|petrobras|posto br|' +
      'raizen|texaco|_graal|_gnv_|etanol|gasolina|estacionamento|estacion|_estac_|estapar|zona azul|zul digital|parking|' +
      '_valet|manobrista|_indigo_|sem parar|semparar|conectcar|veloe|pedagio|_ccr_|ecovias|_metro_|metro rio|cptm|sptrans|' +
      'bilhete unico|riocard|_jae_|onibus|rodoviaria|buser|viacao|_brt_|_vlt_|_localiza_|_movida_|_unidas_|hertz|_avis_|' +
      'rent a car|locadora de veiculos|aluguel de carro|lava rapido|lava jato|oficina|mecanica|auto center|autocenter|' +
      'autopecas|auto pecas|_pneu|transporte|recarga bilhete unico',
    diaria: 'padaria|panificadora|panificacao|_panif|padoca|_pao_|paes e doces|confeitaria|cafe da manha|conveniencia|_conv_|' +
      '_am pm_|ampm|br mania|shell select|oxxo|_banca_|banca de jornal|banca de revista|jornaleiro|revistaria|' +
      'jornais e revistas|tabacaria|lavanderia|5 asec|lava e leva|laundry|chaveiro|sapataria|sapateiro|costureira|xerox|' +
      'copiadora|quiosque|agua mineral|_gelo_',
    compras: '_amazon_|amazonmkt|amazon marketplace|_amzn|mercadolivre|mercado livre|mercadolibre|_meli_|shopee|aliexpress|_temu_|' +
      'shein|_ebay|_olx_|magalu|magazine luiza|magazineluiza|americanas|submarino|casas bahia|casasbahia|pontofrio|ponto frio|' +
      'extra com|fast shop|fastshop|kabum|samsung|apple store|_apple com_|xiaomi|_dell_|lenovo|saraiva|livraria|papelaria|' +
      'kalunga|leroy merlin|tok stok|tokstok|madeiramadeira|casa e video|casaevideo|miniso|havan|lojas marisa|renner|' +
      'c a modas|_cea_|riachuelo|_zara_|hering|pernambucanas|_farm_|arezzo|schutz|havaianas|_vans_|mizuno|asics|adidas|_nike_|' +
      'nike com|_puma_|lacoste|levis|_lupo_|dafiti|zattini|netshoes|centauro|decathlon|victoria s secret|sephora|boticario|' +
      '_natura_|_avon_|beleza na web|granado|perfumaria|cosmetico|vivara|pandora|chilli beans|petz|cobasi|petlove|pet shop|' +
      'petshop|ri happy|rihappy|_lego_|floricultura|_presente|brinquedo|duty free|dufry|magazine|outlet|calcados|modas|' +
      'confeccoes|vestuario|_eletro|informatica|celulares|material de construcao|materiais de construcao|home center|' +
      'decoracao|utilidades|bazar|relojoaria|joalheria|_loja_|_lojas_',
    saude: 'farmac|drogaria|drogarias|_droga_|drogasil|droga raia|drogaraia|_raia_|raia drogasil|pague menos|paguemenos|panvel|' +
      'drogaria sao paulo|big ben|farma|pharma|manipulacao|clinica|_clin_|consultorio|laborat|_lab_|exame|diagnostic|' +
      'radiologia|ultrassom|tomografia|ressonancia|fleury|_dasa_|delboni|_sabin_|pardini|odonto|dentist|ortodont|psicolog|' +
      'psiquiatr|psicanal|terapia|terapeut|fisioterap|nutricion|fonoaudiolog|_medic|hospital|pronto socorro|' +
      'pronto atendimento|unimed|_amil_|bradesco saude|sulamerica saude|hapvida|intermedica|cartao de todos|dr consulta|' +
      'einstein|sirio libanes|rede dor|oftalmo|_otica|vacina|doctoralia|zenklub|_saude_|plano de saude|posto de saude|' +
      'academia|smart fit|smartfit|bluefit|bodytech|selfit|bio ritmo|bioritmo|just fit|justfit|fitness|crossfit|cross fit|' +
      '_gym_|gympass|wellhub|totalpass|total pass|pilates|_yoga|pacheco',
    outros: 'imposto|_das_|simples nacional|darf|ipva|iptu|licenciamento|detran|_gru_|_gps_|_inss|receita federal|sefaz|cartorio|' +
      'correios|sedex|_taxa_|_enel_|eletropaulo|_light sa|light servicos|cemig|copel|neoenergia|equatorial|cpfl|energisa|' +
      'amazonas energia|energia|sabesp|cedae|copasa|sanepar|comgas|ultragaz|telefonica|_vivo_|_claro_|_tim_|_oi_|_sky_|' +
      'recarga|aluguel|condominio|quintoandar|imobiliaria|_segur|mapfre|allianz|faculdade|universidade|mensalidade|escola|' +
      'colegio|curso|udemy|alura|hotmart|medcurso|medgrupo|medcel|estrategia med|estrategiamed|_sanar|_aristo_|hardwork|' +
      'medcof|medway|afya|whitebook|uptodate|amboss|residencia medica|_enare_|ebserh|_fgv_|vunesp|cebraspe|inscricao|_fies_|' +
      'pravaler|cremesp|cremerj|cremers|_crm_|conselho regional|_cfm_|formatura|formandos|colacao de grau|barbearia|barber|' +
      'salao de beleza|_salao_|cabeleireir|manicure|esmalteria|estetica|depilacao|depyl|espacolaser|espaco laser|veterinari|' +
      'contabil|advocacia|advogad|despachante|doacao|loterica|_saque|boleto|pix enviado|transferencia enviada|ted enviada|' +
      'doc enviado|pagto eletron|_pix_|microsoft|_msft|google|_aws_|_luz_|conta de luz|conta de agua|apple com bill|icloud|' +
      'itunes|google one|google storage|claude ai|_claude_|anthropic|openai|chatgpt|microsoft 365|office 365|onedrive|canva|' +
      'duolingo|babbel|dropbox|adobe|notion|linkedin'
  };
  const ASSINATURAS = 'netflix|spotify|disney|hbo max|hbomax|max com|_hbo_|prime video|primevideo|amazon prime|amazonprime|amazon music|' +
    'kindle unlimited|kindle unltd|audible|apple com bill|itunes|icloud|apple music|apple tv|apple one|google one|google storage|' +
    'youtube premium|youtubepremium|youtube music|google youtube|yt premium|xbox game pass|game pass|gamepass|playstation plus|ps plus|' +
    'psn plus|ea play|deezer|globoplay|globo play|telecine|paramount|crunchyroll|_tidal|_mubi_|dazn|premiere|claude ai|_claude_|' +
    'anthropic|openai|chatgpt|microsoft 365|office 365|onedrive|canva|duolingo|babbel|dropbox|adobe|notion|linkedin|tinder|bumble|' +
    'discord|twitch|patreon|skeelo|ubook|storytel|headspace|strava|smart fit|smartfit|bluefit|bodytech|selfit|bio ritmo|bioritmo|' +
    'just fit|justfit|academia|crossfit|gympass|wellhub|totalpass|total pass|ifood club|uber one|_meli_|rappi prime|' +
    'whitebook|uptodate|amboss|sanarflix|zenklub|assinatura|subscription|subscr|recorrente|streaming';
  const ESPECIAIS = {
    fatura: 'pagamento de fatura|pagamento da fatura|pagamento fatura|pagto fatura|pgto fatura|pag fatura|_pag fat_|_pgto fat_|_pagto fat_|' +
      'fatura cartao|fatura do cartao|fatura de cartao|pagamento cartao|pagamento de cartao|pagamento do cartao|pagto cartao|pgto cartao|' +
      'pag cartao|deb aut cartao|deb aut fat|debito aut fat|debito automatico fatura|nubank fatura|boleto nubank|boleto nu pagamentos|' +
      'cobranca nu pagamentos|pagto nu pagamentos|pagamento nu pagamentos|cobranca nubank|ourocard|itaucard|bradescard|credicard|' +
      'porto seguro cartao|saldo restante da fatura|parcelamento de fatura|parcelamento da fatura|parcela fatura|parcel fatura|' +
      'credito refinanciamento|encerramento de divida|credito de atraso|fatura paga|faturaazul|pagamento obrigado',
    // só valem com valor > 0 (crédito do pagamento dentro da fatura do cartão)
    faturaCredito: 'pagamento recebido|pagamento efetuado|pagamento antecipado|pagamento on line|pagamento online|inclusao de pagamento|' +
      'pagamentos validos|pgto debito conta|pagto debito conta|pagamento debito em conta',
    transferencia: 'transferencia entre contas|transf entre contas|entre contas|mesma titularidade|mesma titular|mesmo titular|' +
      'conta propria|contas proprias|transf propria|transferencia propria|entre c c|_tbi_|saldo separado|separar saldo|' +
      'valor adicionado na conta por cartao|valor adicionado para pix no credito|pix no credito|limite convertido em saldo|' +
      'transf saldo c sal|conta salario p cc',
    investimento: 'aplicacao|_aplic_|_apl_|aplic aut|resgate|_resg|rendimento|_rend_|rend pago|remuneracao aplic|remuneracao basica|' +
      '_rem basica|cred juros|_cdb_|_rdb_|_lci_|_lca_|_cri_|_cra_|debenture|tesouro|_selic|poupanca|_poup_|caixinha|porquinho|_porq_|cofrinho|' +
      'guardar dinheiro|dinheiro guardado|guardado|dinheiro resgatado|dinheiro reservado|dinheiro retirado|rende facil|invest facil|' +
      'investfacil|inv facil|contamax|fundo de investimento|fundos de investimento|aplic fundo|resg fundo|_fii_|renda fixa|renda variavel|' +
      'corretora de valores|home broker|_dtvm|_ccvm|investimento|nuinvest|nu reserva|xp investimentos|btg pactual|rico investimentos|' +
      'clear corretora|toro investimentos|genial investimentos|_warren_|_avenue_|binance|mercado bitcoin|foxbit|bitcoin|cripto|' +
      'previdencia privada|pgbl|vgbl|brasilprev|capitalizacao|ourocap|_jscp_|dividendo|_sdo aplic',
    estorno: 'estorno|estornado|estornada|_estor_|reembolso|_reemb|devolucao|devolvido|devolvida|cancelamento|cancelado|cancelada|' +
      'chargeback|contestacao|ajuste a credito|ajuste credito|credito de ajuste|credito ajuste|credito provisorio|credito por contestacao|' +
      'pix devolvido|devolucao pix|credito estorno|desconto|abatimento|credito concedido|_credito de_',
    pontos: 'resgate de pontos|resgate pontos|resgate livelo|resgate esfera',
    entrada: 'salario|credito salario|cred salario|folha de pagamento|_folha_|pagamento de salario|proventos|provento|vencimentos|' +
      '13 salario|decimo terceiro|_ferias_|adiantamento salarial|_bolsa_|bolsa residencia|bolsa auxilio|auxilio|beneficio|pro labore|' +
      'prolabore|honorario|repasse|plantao|plantoes|_rpa_|pix recebido|recebimento pix|transferencia recebida|transf recebida|ted recebida|' +
      'ted recebido|doc recebido|credito ted|cred ted|credito pix|cred pix|credito doc|deposito|_dep_|recebimento|recebido|recebida|' +
      'cashback|bonus|premio|premiacao|restituicao|pensao|mesada|fgts|credito em conta|cred em conta|sispag|entrada pix|entrada ted|' +
      'remuneracao|salario',
    tarifa: 'tarifa|_tar_|cesta de servicos|cesta servicos|pacote de servicos|pacote servicos|manutencao de conta|mensalidade pacote|' +
      '_iof|juros|_multa_|anuidade|encargo|taxa de saque|tarifa saque|seguro cartao|seguro prestamista|cartao protegido|' +
      'protecao perda e roubo|avaliacao emergencial|adiantamento a depositante|cheque especial|credito rotativo|custas|taxa de manutencao|' +
      'irrf|deb cesta|seguro superprotegido'
  };
  // palavras fracas: valem 1 ponto, então qualquer comerciante ou tipo de loja ganha delas
  const FRACAS = new Set(('ifood|_ifd_|rappi|delivery|james delivery|delivery much|deliverymuch|_pix_|pix enviado|transferencia enviada|' +
    'ted enviada|doc enviado|boleto|google|microsoft|guanabara|_zona sul_|_extra_|_condor_|riachuelo|transporte|energia|recarga|_taxa_|' +
    'comida|cozinha|kitchen|_food_|magazine|utilidades|modas|mercad|_saude_|_loja_|_lojas_|fitness|mensalidade|curso').split('|').map(k => k.replace(/_/g, ' ')));
  // sobrenomes/nomes que também são marcas: não valem quando a linha é Pix/TED para uma pessoa
  const SOBRENOMES = new Set(('hirota nagumo mizuno angeloni muffato savegnago zaffari giassi bretas dalben villefort pardini delboni fleury ' +
    'granado hering schutz renner einstein sabin lupo raia amil mambo cometa pacheco').split(' '));
  const ORDEM = ['saude', 'comida', 'mercado', 'transp', 'role', 'diaria', 'compras', 'outros'];
  const CATEGORIAS = { comida: 'Comida fora', mercado: 'Mercado', role: 'Rolê', transp: 'Transporte', diaria: 'Dia a dia',
    compras: 'Compras', saude: 'Saúde', outros: 'Outros' };

  const lista = txt => txt.split('|').filter(Boolean).map(k => (!/[ _]/.test(k) && k.length <= 4 ? ' ' + k + ' ' : k.replace(/_/g, ' ')));
  const L_CAT = {}, L_ESP = {};
  ORDEM.forEach(c => { L_CAT[c] = lista(DIC[c]); });
  Object.keys(ESPECIAIS).forEach(k => { L_ESP[k] = lista(ESPECIAIS[k]); });
  const L_ASS = lista(ASSINATURAS);
  const casa = (N, l) => l.some(kw => N.includes(kw));

  // Texto usado para escolher categoria: sem a parte do banco/CPF no Pix, sem o prefixo da
  // adquirente (PG *, MP *, EC *...), sem cidade/UF/país no fim.
  const PROCESSADORAS = new Set(('pag pagseguro pagbank pg ec mp mercadopago sumup zp dl dlocal ebn ebanx paypal pp picpay stone ton cielo getnet ' +
    'infinitepay safrapay moip iugu asaas vindi adyen stripe nupay compra debito credito cartao visa elo mastercard maestro electron no via ' +
    'pic htm shpp bd dm ppro realizada').split(' '));
  function textoCategoria(desc) {
    let s = semAcento(desc).toLowerCase().replace(/[\u2022\u00b7\u25cf]/g, ' ');
    if (RE_TRANSF.test(s)) s = limparContraparte(s);
    s = s.replace(/^\s*mercado\s*\*/, 'mercadolivre ').replace(/\bmercado\s*pago\b/g, ' mp ');
    let tok = normalizar(s).split(' ').filter(Boolean);
    while (tok.length > 1 && PROCESSADORAS.has(tok[0])) tok.shift();
    tok = tirarLocal(tok);
    return ' ' + tok.join(' ') + ' ';
  }
  function melhorCategoria(N, transf) {
    let melhor = null, pts = 0, fraca = false;
    for (const c of ORDEM) {
      for (const kw of L_CAT[c]) {
        if (!N.includes(kw)) continue;
        const k = kw.trim();
        if (transf && SOBRENOMES.has(k)) continue;
        const p = FRACAS.has(kw) ? 1 : k.length;
        if (p > pts) { melhor = c; pts = p; fraca = p === 1; }
      }
    }
    return melhor ? { cat: melhor, fraca } : null;
  }
  function dicaBanco(dica) {
    const d = normalizar(dica);
    if (!d || d === 'outros') return null;
    if (/restaurante|lanchonete|alimenta|fast food/.test(d)) return 'comida';
    if (/supermercado|mercearia|hipermercado/.test(d)) return 'mercado';
    if (/drogaria|farmacia|medic|hospital|saude|odonto/.test(d)) return 'saude';
    if (/transporte|posto|combustiv|estacionamento|veicul|automotiv/.test(d)) return 'transp';
    if (/viage|turismo|hotel|lazer|entretenimento|aere|cia aerea|bar\b/.test(d)) return 'role';
    if (/vestuario|departamento|eletro|varejo|moda|loja|calcad|artigos|compras|desconto/.test(d)) return 'compras';
    if (/padaria|conveniencia/.test(d)) return 'diaria';
    return null;
  }

  /* ── classificação ── */

  const TIPOS_ESP = { entrada: 1, fatura: 1, transferencia: 1, investimento: 1, estorno: 1, gasto: 1 };

  function classificar(t, regras) {
    t = t || {};
    const desc = String(t.desc != null ? t.desc : (t.original || ''));
    const valor = Number(t.valor) || 0;
    const ch = chave(desc);
    const N = ' ' + normalizar(desc) + ' ';
    const transf = RE_TRANSF.test(N) || / transferencia /.test(N);
    const ehAssin = casa(N, L_ASS);
    const sai = (tipo, cat, confianca, assin) => ({
      tipo, cat: (tipo === 'gasto' || tipo === 'estorno') ? (cat || 'outros') : null,
      assinatura: tipo === 'gasto' && !!assin, confianca, chave: ch
    });
    const catDic = () => {
      const r = melhorCategoria(textoCategoria(desc), transf);
      if (r) return r;
      if (ehAssin) return { cat: 'outros', fraca: false };
      return null;
    };

    // 1. regra aprendida com o usuário
    if (regras && typeof regras === 'object' && ch && Object.prototype.hasOwnProperty.call(regras, ch)) {
      let v = regras[ch];
      if (v && typeof v === 'object') v = v.cat || v.tipo;
      if (L_CAT[v]) return sai(valor > 0 ? 'estorno' : 'gasto', v, 'regra', ehAssin);
      if (v === 'gasto' || v === 'estorno') { const r = catDic(); return sai(v, r ? r.cat : 'outros', 'regra', ehAssin); }
      if (TIPOS_ESP[v]) return sai(v, null, 'regra', false);
    }
    // Pix no Crédito: o Pix pareado com o crédito do cartão já vai aparecer na fatura
    if (t.pixCredito) return sai('transferencia', null, 'dicionario');
    // 'Cartão de Todos' é plano de saúde, não pagamento de cartão
    const cartaoDeTodos = N.includes(' cartao de todos ');
    // 2. fatura do cartão
    if (!cartaoDeTodos) {
      if (casa(N, L_ESP.fatura)) return sai('fatura', null, 'dicionario');
      if (valor > 0 && (casa(N, L_ESP.faturaCredito) || /^ pagamento em \d/.test(N))) {
        if (t.conta === 'corrente' && / pagamento recebido /.test(N)) return sai('entrada', null, 'dicionario');
        return sai('fatura', null, 'dicionario');
      }
      if (!transf && / nu pagamento/.test(N)) return sai('fatura', null, 'dicionario');
      if (/ (boleto|cobranca) /.test(N) && / (nu pagamentos|nubank|bradescard|itaucard|banco inter|c 6 bank|mercado pago|picpay|banco xp) /.test(N) && !/ pix /.test(N))
        return sai('fatura', null, 'dicionario');
      if (valor < 0 && / (itau|pers) (black|uniclass|platinum|gold|infinite|personnalite|click|azul|visa|master|mastercard)( \d+)+ $/.test(N))
        return sai('fatura', null, 'dicionario');
    }
    // 3. entre contas da mesma pessoa
    if (casa(N, L_ESP.transferencia)) return sai('transferencia', null, 'dicionario');
    // 4. estorno (crédito que devolve um gasto)
    if (valor > 0 && casa(N, L_ESP.estorno)) {
      const r = melhorCategoria(textoCategoria(desc), transf);
      return sai('estorno', r ? r.cat : 'outros', 'dicionario');
    }
    // 5. pontos de fidelidade resgatados
    if (valor > 0 && casa(N, L_ESP.pontos)) return sai('entrada', null, 'dicionario');
    // 6. investimento (aplicação, resgate, rendimento)
    if (casa(N, L_ESP.investimento)) return sai('investimento', null, 'dicionario');
    // 7. tarifas, IOF, juros, multa, anuidade
    if (valor < 0 && casa(N, L_ESP.tarifa)) return sai('gasto', 'outros', 'dicionario', false);
    // 8. dinheiro que entrou
    if (valor > 0) return sai('entrada', null, casa(N, L_ESP.entrada) ? 'dicionario' : 'palpite');
    // 9. gasto por palavra-chave
    if (cartaoDeTodos) return sai('gasto', 'saude', 'dicionario', ehAssin);
    const r = catDic();
    if (r && !(r.fraca && r.cat === 'outros')) return sai('gasto', r.cat, 'dicionario', ehAssin);
    const dica = t.dica ? dicaBanco(t.dica) : null;
    if (dica) return sai('gasto', dica, 'palpite', ehAssin);
    // 10. sem pista: outros, para o usuário conferir
    return sai('gasto', 'outros', 'palpite', ehAssin);
  }

  /* ── montagem do resultado ── */

  const BANCOS_ID = { 1: 'Banco do Brasil', 33: 'Santander', 77: 'Banco Inter', 104: 'Caixa', 208: 'BTG Pactual', 237: 'Bradesco',
    260: 'Nubank', 323: 'Mercado Pago', 336: 'C6 Bank', 341: 'Itaú', 380: 'PicPay', 102: 'XP', 655: 'Neon' };
  const BANCOS_NOME = [[/nubank|nu pagamentos|\bnu_\w+_\d/i, 'Nubank'], [/banco inter\b|intermedium|inter&co|\binter\b.*cart|cart.*\binter\b/i, 'Banco Inter'],
    [/ita[uú]|personnalit/i, 'Itaú'], [/bradesco/i, 'Bradesco'], [/banco do brasil|ourocard|\bbb rende/i, 'Banco do Brasil'],
    [/caixa econ[oô]mica|\bcaixa\b/i, 'Caixa'], [/santander/i, 'Santander'], [/\bc6 ?(bank|carbon)\b/i, 'C6 Bank'], [/picpay/i, 'PicPay'],
    [/mercado ?pago/i, 'Mercado Pago'], [/\bbtg\b/i, 'BTG Pactual'], [/\bxp\b/i, 'XP'], [/\bneon\b/i, 'Neon']];
  function bancoPorTexto(s) { for (const [re, nome] of BANCOS_NOME) if (re.test(s)) return nome; return null; }

  function novaTransacao(data, valor, desc, original, parcela, extra) {
    let d = espacos(desc);
    if (/^".*"$/.test(d) && d.indexOf('"', 1) === d.length - 1) d = d.slice(1, -1).trim();
    d = tituloSeCaixaAlta(d);
    const t = { id: '', data, valor: Math.round(valor * 100) / 100, desc: d, original: espacos(original != null ? original : desc), parcela: parcela || null };
    if (extra) Object.keys(extra).forEach(k => { if (extra[k] != null) t[k] = extra[k]; });
    return t;
  }

  // Ids estáveis: id externo forte (FITID/Identificador) quando é único no arquivo; senão hash de
  // data|valor|chave mais o número da ocorrência de linhas iguais dentro do arquivo.
  function finalizar(res, transacoes, prefixo) {
    const conta = res.conta;
    const contagemExt = {};
    transacoes.forEach(t => { if (t._ext) contagemExt[t._ext] = (contagemExt[t._ext] || 0) + 1; });
    const vistos = {};
    transacoes.forEach(t => {
      let base;
      if (t._ext && contagemExt[t._ext] === 1 && !t._extFraco) base = prefixo + ':' + t._ext;
      else if (t._ext && !t._extFraco) base = prefixo + ':' + t._ext + ':' + hashCurto(t.data + '|' + t.valor.toFixed(2));
      else base = 'h' + hashCurto(t.data + '|' + t.valor.toFixed(2) + '|' + chave(t.desc));
      vistos[base] = (vistos[base] || 0) + 1;
      t.id = vistos[base] > 1 ? base + '-' + vistos[base] : base;
      delete t._ext; delete t._extFraco;
      if (conta) t.conta = conta;
    });
    // Pix no Crédito: crédito "valor adicionado..." + Pix enviado no mesmo dia e valor
    transacoes.forEach(c => {
      if (c.valor <= 0 || !/valor adicionado|pix no cr[eé]dito/i.test(semAcento(c.desc))) return;
      const par = transacoes.find(p => p.valor === -c.valor && p.data === c.data && !p.pixCredito && /\bpix\b/i.test(p.desc));
      if (par) par.pixCredito = true;
    });
    res.transacoes = transacoes.map((t, i) => [t, i])
      .sort((a, b) => (a[0].data < b[0].data ? -1 : a[0].data > b[0].data ? 1 : a[1] - b[1])).map(x => x[0]);
    if (!res.transacoes.length && !res.avisos.length) res.avisos.push('Não encontrei lançamentos neste arquivo.');
    return res;
  }

  // Parcela de cartão que veio com a data da compra original (C6, Ourocard, Mercado Pago):
  // move para o mês em que a parcela é cobrada, para a projeção dos próximos meses.
  function ajustarDataParcela(t, ref, sempre) {
    if (!t.parcela || t.parcela.k < 2) return false;
    if (!sempre && !(ref && diasEntre(ref, t.data) > 62)) return false;
    t.dataCompra = t.data;
    t.data = somarMeses(t.data, t.parcela.k - 1);
    return true;
  }
  function refDoNome(nome) {
    const s = String(nome || '');
    let m = s.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
    if (m) return iso(+m[1], +m[2], +m[3]);
    const todos = s.match(/(\d{2})([A-Za-z]{3})(20\d{2})/g);
    if (todos) {   // NU_..._01OUT2026_31OUT2026: usa o fim do período
      const u = todos[todos.length - 1].match(/(\d{2})([A-Za-z]{3})(20\d{2})/); const mm = mesDe(u[2]); if (mm) return iso(+u[3], mm, +u[1]); }
    return null;
  }

  /* ── OFX ── */

  const tagOfx = (bloco, tag) => {
    const m = bloco.match(new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i'));
    return m ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").trim() : '';
  };
  function lerOFX(texto, opcoes) {
    const res = { formato: 'ofx', banco: null, conta: null, transacoes: [], avisos: [] };
    const cartao = /<(CREDITCARDMSGSRSV1|CCSTMTRS|CCACCTFROM)>/i.test(texto);
    res.conta = opcoes.conta || (cartao ? 'cartao' : (/<(BANKMSGSRSV1|STMTRS|BANKACCTFROM)>/i.test(texto) ? 'corrente' : null));
    const org = tagOfx(texto, 'ORG'), bankid = tagOfx(texto, 'BANKID'), fid = tagOfx(texto, 'FID');
    res.banco = (org && bancoPorTexto(org)) || BANCOS_ID[parseInt(bankid, 10)] || BANCOS_ID[parseInt(fid, 10)] || (org && !/^\d+$/.test(org) ? org : null) ||
      bancoPorTexto(opcoes.nome || '');
    const acct = tagOfx(texto, 'ACCTID').replace(/\s+/g, '');
    const blocos = texto.split(/<STMTTRN>/i).slice(1).map(b => b.split(/<\/STMTTRN>|<\/BANKTRANLIST>|<\/CCSTMTRS>|<\/STMTRS>/i)[0]);
    const lista = [];
    let invalidas = 0;
    for (const b of blocos) {
      const dt = tagOfx(b, 'DTPOSTED').replace(/\D/g, '').slice(0, 8);
      const data = dt.length === 8 ? iso(+dt.slice(0, 4), +dt.slice(4, 6), +dt.slice(6, 8)) : null;
      const amt = tagOfx(b, 'TRNAMT').replace(/\s/g, '');
      const valor = /,/.test(amt) ? lerValor(amt) : parseFloat(amt);   // Santander usa vírgula
      if (!data || !isFinite(valor)) { invalidas++; continue; }
      if (valor === 0) continue;
      const memo = tagOfx(b, 'MEMO'), nome = tagOfx(b, 'NAME');
      let desc;
      const nm = normalizar(nome), mm = normalizar(memo.replace(/^\d{2}\/\d{2}\s+\d{2}:\d{2}\s+/, ''));
      if (!nm) desc = memo; else if (!mm) desc = nome;
      else if (mm.includes(nm)) desc = memo;
      else if (nm.includes(mm)) desc = nome;
      else desc = nome + ' - ' + memo.replace(/^\d{2}\/\d{2}\s+\d{2}:\d{2}\s+/, '');
      if (!desc) desc = tagOfx(b, 'TRNTYPE') || 'Lançamento';
      const fitid = tagOfx(b, 'FITID');
      const t = novaTransacao(data, valor, desc, [nome, memo].filter(Boolean).join(' | '), lerParcela(desc, res.conta === 'cartao'));
      if (fitid && !/^[0.\-]+$/.test(fitid)) {
        // FITID posicional (AAAAMMDD + sequência do dia: Itaú, Inter) muda entre exportações: usa hash
        t._extFraco = fitid.replace(/\D/g, '').startsWith(dt) && /^\d{9,14}$/.test(fitid.replace(/\D/g, ''));
        t._ext = (acct ? acct + ':' : '') + fitid;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(fitid) && res.banco === 'Nubank') t._ext = fitid;
      }
      lista.push(t);
    }
    if (invalidas && !lista.length) res.avisos.push('O OFX não tem lançamentos com data válida.');
    const prefixo = res.banco === 'Nubank' ? 'nu' : 'ofx';
    return finalizar(res, lista, prefixo);
  }

  /* ── CSV ── */

  // Divide uma linha: aspas só abrem campo quando estão no começo dele (Inter põe aspas no meio do texto).
  function dividir(linha, sep) {
    const campos = [];
    let i = 0;
    const n = linha.length;
    while (i <= n) {
      let j = i;
      while (j < n && linha[j] === ' ') j++;
      if (linha[j] === '"') i = j;
      if (linha[i] === '"') {
        let v = ''; i++;
        while (i < n) {
          if (linha[i] === '"') { if (linha[i + 1] === '"') { v += '"'; i += 2; continue; } i++; break; }
          v += linha[i++];
        }
        const fim = linha.indexOf(sep, i);
        v += fim < 0 ? linha.slice(i) : linha.slice(i, fim);
        campos.push(v);
        if (fim < 0) break;
        i = fim + 1;
      } else {
        const fim = linha.indexOf(sep, i);
        if (fim < 0) { campos.push(linha.slice(i)); break; }
        campos.push(linha.slice(i, fim));
        i = fim + 1;
      }
    }
    return campos.map(c => c.trim());
  }
  const normCab = s => normalizar(String(s || '').replace(/^\ufeff/, ''));
  const ehColData = n => (/^(data|date|dt)\b/.test(n) && !/contabil|balancete|vencimento|hora/.test(n)) || n === 'release date';
  const ehColValor = n => /^(valor|amount|value|transaction net amount|vlr|montante|quantia)\b/.test(n) && !/\b(us|usd|dolar|cotacao|saldo|original)\b/.test(n);
  const ehColCred = n => /^(credito|creditos|entrada|entradas)\b/.test(n);
  const ehColDeb = n => /^(debito|debitos|saida|saidas)\b/.test(n);
  const ehColDesc = n => /^(descricao|description|title|titulo|lancamento|lancamentos|historico|estabelecimento|detalhes|transaction type|memo|origem destino|beneficiario|favorecido|nome|loja|movimentacao|complemento|tipo)$/.test(n) ||
    /^(descricao|historico|lancamento) /.test(n);

  function mapearCabecalho(campos) {
    const nomes = campos.map(normCab);
    const col = { nomes, data: -1, valor: -1, cred: -1, deb: -1, desc: [], dir: -1, parcela: -1, id: -1, cat: -1, saldo: -1, tipo: -1 };
    nomes.forEach((n, i) => {
      if (!n) return;
      if (ehColData(n)) {
        if (col.data < 0 || /lancamento|compra|movimento/.test(n)) col.data = i;
      } else if (/^(tipo lancamento|tipo de lancamento|natureza|d c|c d|credito debito)$/.test(n)) col.dir = i;
      else if (n === 'tipo') { col.tipo = i; }
      else if (/^parcela/.test(n)) col.parcela = i;
      else if (/^(identificador|reference id|id|id da operacao|fitid|codigo da transacao)$/.test(n)) col.id = i;
      else if (/^categoria/.test(n)) col.cat = i;
      else if (/saldo|balance/.test(n)) col.saldo = i;
      else if (ehColValor(n)) { if (col.valor < 0 || (/\br\b/.test(n) && !/\br\b/.test(nomes[col.valor]))) col.valor = i; }
      else if (ehColCred(n)) col.cred = i;
      else if (ehColDeb(n)) col.deb = i;
      else if (ehColDesc(n)) col.desc.push(i);
    });
    col.ok = col.data >= 0 && (col.valor >= 0 || (col.cred >= 0 && col.deb >= 0));
    return col;
  }
  function acharCabecalho(linhas) {
    for (let i = 0; i < Math.min(linhas.length, 40); i++) {
      let melhor = null;
      for (const sep of [';', '\t', ',', '|']) {
        if (!linhas[i].includes(sep)) continue;
        const campos = dividir(linhas[i], sep);
        if (campos.filter(Boolean).length < 3) continue;
        const col = mapearCabecalho(campos);
        if (col.ok && (col.desc.length || col.tipo >= 0) && (!melhor || campos.length > melhor.n)) melhor = { i, sep, col, n: campos.length };
      }
      if (melhor) return melhor;
    }
    return null;
  }

  const RE_IGNORAR_DESC = /^(saldos?\b(?! separado)|s a l d o|sdo\b|(sub ?)?total\b(?! ?pass)|cod lanc|movimento do dia|lancamentos futuros|ultimos lancamentos|saldo anterior)/;
  const RE_FUTURO = /^(proxima fatura|proximas faturas|compras parceladas proximas faturas|lancamentos futuros|saidas futuras|parcelas futuras|saldos invest facil|compras parceladas)/;

  function limparPedaco(p, nomeCol) {
    let s = espacos(p);
    if (/detalhes|complemento/.test(nomeCol || '')) s = s.replace(/^\d{2}\/\d{2}(\/\d{2,4})?\s+\d{2}:\d{2}(:\d{2})?\s*/, '').replace(/^\d{8,}\s+/, '');
    return s;
  }
  function juntarDesc(pedacos) {
    const out = [];
    pedacos.forEach(p => {
      if (!p || p === '-') return;
      const np = normalizar(p);
      if (!np) return;
      const j = out.findIndex(o => normalizar(o).includes(np) || np.includes(normalizar(o)));
      if (j >= 0) { if (np.length > normalizar(out[j]).length) out[j] = p; return; }
      out.push(p);
    });
    return out.join(' - ');
  }

  function lerCSV(texto, nome, opcoes) {
    const res = { formato: 'csv', banco: null, conta: null, transacoes: [], avisos: [] };
    const linhas = texto.split(/\r\n|\r|\n/);
    const cab = acharCabecalho(linhas);
    if (!cab) return null;
    const sep = cab.sep;
    let col = cab.col;
    const n = col.nomes, tem = re => n.some(x => re.test(x));
    const preambulo = linhas.slice(0, cab.i).join(' ');
    const sinal = n.join(',');
    // banco pelo cabeçalho ou pelo preâmbulo
    if (sinal === 'data,valor,identificador,descricao' || /^date,(category,)?title,amount$/.test(sinal)) res.banco = 'Nubank';
    else if (tem(/^release date$/)) res.banco = 'Mercado Pago';
    else if (tem(/^origem destino$/)) res.banco = 'PicPay';
    else if (tem(/^tipo lancamento$/) || tem(/^dependencia origem$/)) res.banco = 'Banco do Brasil';
    else if (tem(/^estabelecimento$/) && tem(/^portador$/)) res.banco = 'XP';
    else if (tem(/^nome no cartao$/) || (tem(/^titulo$/) && tem(/^saldo do dia/))) res.banco = 'C6 Bank';
    else if (sinal === 'data,lancamento,categoria,tipo,valor') res.banco = 'Banco Inter';
    res.banco = res.banco || bancoPorTexto(preambulo) || bancoPorTexto(nome || '');
    if (!res.banco && tem(/^docto$/) && tem(/^credito/)) res.banco = 'Bradesco';
    if (!res.banco && tem(/^data lancamento$/) && tem(/^saldo$/)) res.banco = 'Banco Inter';

    // conta: cartão (fatura) ou corrente
    const ehCartao = tem(/^(title|estabelecimento|portador|final do cartao|nome no cartao|data de compra)$/) || col.parcela >= 0 ||
      (col.cat >= 0 && col.tipo >= 0 && col.saldo < 0);
    const ehCorrente = col.saldo >= 0 || col.cred >= 0 || col.id >= 0 || col.dir >= 0 || tem(/^(release date|origem destino|historico|docto|data lancamento)$/);
    let conta = opcoes.conta || (ehCartao ? 'cartao' : ehCorrente ? 'corrente' : null);
    if (!conta && /fatura|nubank_\d{4}/i.test(nome || '') && col.saldo < 0) conta = 'cartao';
    const dataDeCompra = tem(/^data de compra$/);
    const ref = refDoNome(nome);

    const lista = [];
    let ativo = true, ultimo = null;
    for (let i = cab.i + 1; i < linhas.length; i++) {
      const linha = linhas[i];
      if (!linha || !linha.trim()) continue;
      const campos = dividir(linha, sep);
      const primeiro = normCab(campos.find(c => c && c.trim()) || '');
      if (RE_FUTURO.test(primeiro)) { ativo = false; continue; }
      // cabeçalho repetido (Bradesco 'Últimos Lançamentos') ou bloco sem valores
      if (ehColData(normCab(campos[0])) && !lerData(campos[0])) {
        const c2 = mapearCabecalho(campos);
        if (c2.ok) { col = c2; ativo = true; } else ativo = false;
        continue;
      }
      if (!ativo) continue;
      const data = lerData(campos[col.data]);
      // pedaços de descrição da coluna (ou colunas) de texto
      const nomesCol = col.nomes;
      let pedacos = [];
      let parcelaTxt = col.parcela >= 0 ? campos[col.parcela] : '';
      if (col.tipo >= 0) {
        const tp = campos[col.tipo] || '';
        if (/parcela|a vista|avista|unica|parcelad/i.test(semAcento(tp))) parcelaTxt = parcelaTxt || tp; else if (tp) pedacos.push(tp);
      }
      col.desc.forEach((j, k) => {
        let v = campos[j];
        // descrição na última coluna com vírgulas sem aspas (Nubank conta): junta o resto
        if (k === col.desc.length - 1 && j === nomesCol.length - 1 && campos.length > nomesCol.length) v = campos.slice(j).join(sep === ',' ? ',' : ' ');
        pedacos.push(limparPedaco(v, nomesCol[j]));
      });
      const descBruta = juntarDesc(pedacos);
      if (!data) {
        // linha de continuação (Bradesco antigo: ';Des: NOME;;' ou ';Rem: NOME;;')
        const cont = espacos(campos.filter(Boolean).join(' '));
        if (ultimo && /^(des|rem)\s*:/i.test(cont) && !/\d+,\d{2}/.test(cont)) {
          ultimo.desc = espacos(ultimo.desc + ' - ' + cont.replace(/^(des|rem)\s*:\s*/i, ''));
          ultimo.original += ' ' + cont;
        }
        continue;
      }
      if (RE_IGNORAR_DESC.test(normalizar(descBruta))) continue;
      let valor;
      if (col.valor >= 0) valor = lerValor(campos[col.valor]);
      if ((col.valor < 0 || !isFinite(valor)) && (col.cred >= 0 || col.deb >= 0)) {
        const c = Math.abs(lerValor(campos[col.cred])) || 0, d = Math.abs(lerValor(campos[col.deb])) || 0;
        valor = c - d;
      }
      if (!isFinite(valor) || valor === 0) continue;
      if (col.dir >= 0) {
        const d = normalizar(campos[col.dir]);
        if (/^(saida|debito|d|deb)\b/.test(d)) valor = -Math.abs(valor);
        else if (/^(entrada|credito|c|cred)\b/.test(d)) valor = Math.abs(valor);
      }
      const desc = descBruta || 'Lançamento';
      const parcela = lerParcela(parcelaTxt, true, true) || lerParcela(desc, conta === 'cartao');
      const t = novaTransacao(data, valor, desc, pedacos.filter(Boolean).join(' | ') || desc, parcela,
        { dica: col.cat >= 0 && campos[col.cat] && campos[col.cat] !== '-' ? campos[col.cat] : null });
      if (col.id >= 0 && campos[col.id] && !/^0+$/.test(campos[col.id])) t._ext = campos[col.id];
      lista.push(t); ultimo = t;
    }
    // sem pistas no cabeçalho ('data,lançamento,valor'): fatura de cartão costuma ter quase tudo positivo
    if (!conta && lista.length) conta = lista.filter(t => t.valor > 0).length / lista.length > 0.6 ? 'cartao' : 'corrente';
    res.conta = conta;
    // nos CSV de fatura a compra vem positiva: inverte para compra negativa e pagamento/estorno positivo
    if (conta === 'cartao') lista.forEach(t => { t.valor = -t.valor || 0; });
    if (conta === 'cartao') {
      let movidas = 0;
      lista.forEach(t => { if (ajustarDataParcela(t, ref, dataDeCompra)) movidas++; });
      if (movidas) res.avisos.push(movidas + (movidas > 1 ? ' parcelas vieram' : ' parcela veio') + ' com a data da compra original; usei o mês da cobrança.');
    }
    const prefixo = res.banco === 'Nubank' ? 'nu' : res.banco === 'Mercado Pago' ? 'mp' : 'id';
    return finalizar(res, lista, prefixo);
  }

  /* ── texto livre (app, PDF) ── */

  // Data no começo da linha. Devolve { d, m, a|null, resto, hora }.
  function dataNoInicio(L) {
    let m = L.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\s*/);
    if (m) return { d: +m[3], m: +m[2], a: +m[1], resto: L.slice(m[0].length) };
    m = L.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})(?!\d)\s*(?:-?\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*)?/);
    if (m) return { d: +m[1], m: +m[2], a: ano4(+m[3]), resto: L.slice(m[0].length), hora: !!m[4] };
    m = L.match(/^(\d{1,2})\s+de\s+([A-Za-zçÇ]{3,9})\.?(?:\s+de)?\s+(\d{4})\b\s*/i);
    if (m && mesDe(m[2])) return { d: +m[1], m: mesDe(m[2]), a: +m[3], resto: L.slice(m[0].length) };
    m = L.match(/^(\d{1,2})\/(\d{1,2})(?![/\d])\s*(?:(\d{1,2}\/\d{1,2})(?![/\d])\s*)?(?:(\d{1,2}:\d{2})(?::\d{2})?\s*)?/);
    if (m) return { d: +m[1], m: +m[2], a: null, resto: L.slice(m[0].length), hora: !!m[4] };
    m = L.match(/^(\d{1,2})\s+([A-Za-z]{3})\.?(?:\s+(\d{4}))?(?![A-Za-z])\s*/);
    if (m && mesDe(m[2])) return { d: +m[1], m: mesDe(m[2]), a: m[3] ? +m[3] : null, resto: L.slice(m[0].length) };
    return null;
  }
  // 'D de Mês de AAAA' em qualquer lugar da linha (Inter conta: cabeçalho do dia)
  function dataExtensoEm(L) {
    const m = L.match(/(\d{1,2})\s+de\s+([A-Za-zçÇ]{3,9})\.?\s+(?:de\s+)?(\d{4})/i);
    return m && mesDe(m[2]) ? { d: +m[1], m: mesDe(m[2]), a: +m[3] } : null;
  }
  // data completa em qualquer forma, para achar vencimento/emissão no cabeçalho
  function dataCompletaEm(s) {
    let m = s.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2})/);
    if (m) return iso(+m[3], +m[2], +m[1]);
    m = s.match(/(\d{1,2})\s+(?:de\s+)?([A-Za-zçÇ]{3,9})\.?\s+(?:de\s+)?(20\d{2})/);
    if (m && mesDe(m[2])) return iso(+m[3], mesDe(m[2]), +m[1]);
    return null;
  }

  const RE_IGNORAR_TXT = new RegExp('^(' + [
    'saldos?\\b(?! separado)', 's a l d o', 'sdo\\b', '(sub ?)?total\\b(?! ?pass)', 'limite', 'vencimento', 'data de vencimento',
    'pagamento minimo', 'valor minimo', 'melhor dia', 'fechamento', 'emissao', 'postagem', 'periodo', 'cod lanc', 'movimento do dia',
    'lancamentos no cartao', 'pagamentos e financiamentos', 'dolar de conversao', 'conversao', 'cotacao', 'usd\\b', 'us\\b',
    'cet\\b', 'taxa de juros', 'valor da fatura', 'o total da sua fatura', 'consumos de', 'resumo', 'entradas\\b',
    'saidas\\b', 'demais faturas', 'fale com', 'sac\\b', 'ouvidoria', 'tem alguma duvida', 'deficiente', '0800', 'central de',
    'valor saldo por transacao', 'movimentacoes', 'data\\b', 'creditos? e debitos', 'encargos financeiros', 'compras nacionais',
    'compras internacionais', 'estornos credito na fatura', 'parcelamento de fatura disponivel', 'anuidade diferenciada disponivel',
    'pagamento total', 'total a pagar', 'pague (ate|o valor|a fatura|com)', 'proximo vencimento', 'lancamentos atuais', 'titular', 'cartao (final|adicional)'
  ].join('|') + ')');
  const RE_RETOMA = /^(lancamentos|despesas|pagamentos efetuados|transacoes de|movimentacoes|detalhe|cartao \d|pagamento e demais)/;
  const RE_RECEITA = /\b(recebid[oa]s?|recebimento|cred(ito)? (em conta|salario|pix|ted|doc)|cred pix|salario|proventos|estorno|reembolso|devolu|resgate|rendimentos?|rend pago|remuneracao|cashback|deposito|entrada (pix|ted)|pix recebido|rem basica|cred juros|plantao|bolsa)\b/;
  const RE_CREDITO_CARTAO = /\b(pagamento recebido|pagamento da fatura|pagamento de fatura|pagamento efetuado|pagamento on ?line|pagamento em \d|pagamento obrigado|credito concedido|credito de|estorno|pgto debito conta|inclusao de pagamento|pagamentos validos|desconto|reembolso|devolucao|cancelamento)\b/;

  // Primeiro valor monetário depois da descrição. Linhas de conta com dois valores trazem o saldo no fim.
  const RE_DINHEIRO = /(\()?((?:[-+]\s?){0,2})(R\$\s?)?([-+]\s?)?(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(?![\d%,])(\))?(-(?=\s|$)|\s-$)?(\s?[DC](?![A-Za-z0-9]))?/gi;
  function acharValor(resto) {
    // apaga (mantendo o tamanho) valores em moeda estrangeira e cotações
    const limpo = resto
      .replace(/\b(?:USD|US\$|EUR|€|GBP)\s*[\d.,]+/gi, x => ' '.repeat(x.length))
      .replace(/cota[cç][aã]o[^|]*?R\$\s*[\d.,]+/gi, x => ' '.repeat(x.length))
      .replace(/\|/g, ' ');
    RE_DINHEIRO.lastIndex = 0;
    let m = RE_DINHEIRO.exec(limpo);
    if (!m) {
      const p = limpo.match(/(R\$\s?)([-+]?)\s?(\d+\.\d{2})(?!\d)|(?:^|\s)([-+]?\d+\.\d{2})$/);
      if (!p) return null;
      const num = p[3] || p[4];
      const v = parseFloat(num);
      const neg = p[2] === '-' || /^-/.test(num);
      return { limpo, indice: p.index, abs: Math.abs(v), sinal: neg ? -1 : (p[2] === '+' || /^\+/.test(num)) ? 1 : 0, sinalC: neg || /^\+/.test(num) ? 1 : 0, cd: null };
    }
    const pre = (m[2] || '') + (m[4] || '');
    const parenteses = !!(m[1] && m[6]);
    const fimMenos = !!m[7];
    const abs = Math.abs(lerValor(m[5]));
    const mais = pre.includes('+'), menos = pre.includes('-') || parenteses || fimMenos;
    // na fatura, '- R$ 12,30' (traço solto antes do R$) é separador de coluna, não sinal
    const tracoSolto = /-\s+$/.test(m[2] || '') && m[3] && !m[4];
    const sinalC = mais ? 1 : (parenteses || fimMenos || (pre.includes('-') && !tracoSolto)) ? 1 : 0;
    const cd = m[8] ? m[8].trim().toUpperCase() : null;
    return { limpo, indice: m.index, abs, sinal: mais ? 1 : menos ? -1 : 0, sinalC, cd };
  }
  function limparDescTexto(s) {
    return espacos(String(s || '')
      .replace(/[\u2022*\u00b7\u25cf]{2,}\s?\d{4}/g, ' ').replace(/\b\d{4,6}\*{2,}\d{4}\b/g, ' ')
      .replace(/R\$\s*$/, ''))
      .replace(/^(?:\d{3,}\s+)+/, '').replace(/(?:\s+\d{5,})+$/, '')
      .replace(/^[-\u2013|:\s]+|[-\u2013|:\s]+$/g, '');
  }

  const DICA_PDF = 'Se for um PDF escaneado (imagem), exporte o extrato em OFX ou CSV.';
  function detectarConta(linhas) {
    let c = 0, k = 0;
    linhas.slice(0, 400).forEach(L => {
      const n = normalizar(L);
      if (/\b(vencimento|total da fatura|transacoes de \d|pagamento minimo|limite (disponivel|total|de credito)|despesas da fatura|lancamentos compras e saques|detalhamento da fatura|fatura do cartao|emissao e envio|^fatura \d+|valor da fatura|resumo da fatura|proxima fatura|total desta fatura|subtotal deste cartao)\b/.test(n)) c++;
      if (/\b(saldo do dia|saldo anterior|saldo inicial|saldo final|total de entradas|total de saidas|saldo em conta|extrato (de )?conta|conta corrente|periodo de visualizacao|saldo dia|movimentacoes \d|detalhe dos movimentos|saldo disponivel)\b/.test(n)) k++;
    });
    return c > k ? 'cartao' : k > c ? 'corrente' : null;
  }

  function lerTexto(texto, opcoes) {
    opcoes = opcoes || {};
    const res = { formato: 'texto', banco: null, conta: null, transacoes: [], avisos: [] };
    try {
      if (texto != null && typeof texto !== 'string') texto = decodificar(texto);
      texto = consertarMojibake(String(texto || '').replace(/^\ufeff/, ''));
      const linhas = texto.split(/\r\n|\r|\n/)
        .map(L => espacos(L.replace(/[\u2212\u2013\u2014]/g, '-').replace(/[\u200b\u00ad]/g, '')))
        .filter(Boolean);
      if (!linhas.length) { res.avisos.push('O texto está vazio. ' + DICA_PDF); return res; }
      const conta = opcoes.conta === 'cartao' || opcoes.conta === 'corrente' ? opcoes.conta : detectarConta(linhas);
      res.conta = conta;
      res.banco = bancoPorTexto(linhas.slice(0, 15).join(' ')) || bancoPorTexto(opcoes.nome || '');

      // referência (vencimento/emissão da fatura, ou fim do período) para o ano e a virada de ano
      let ref = null;
      for (const L of linhas.slice(0, 80)) {
        const n = semAcento(L).toLowerCase();
        const p = n.match(/(vencimento|fatura|emissao|postagem|fechamento)\b[^0-9]{0,30}(.*)$/);
        if (p) { const d = dataCompletaEm(p[2]); if (d) { ref = d; break; } }
      }
      if (!ref) {
        for (const L of linhas.slice(0, 40)) {
          const n = semAcento(L).toLowerCase();
          const p = n.match(/(periodo|transacoes de|movimentacoes|extrato de)\b.*\b(?:ate|a|al)\s+(.*)$/);
          if (p) { const d = dataCompletaEm(p[2]); if (d) { ref = d; break; } }
        }
      }
      if (!ref && opcoes.ref) ref = opcoes.ref;
      let anoCab = null;
      if (!ref) {
        for (const L of linhas.slice(0, 60)) {
          const m = L.match(/\b(20\d{2})\b/);
          if (m && (/[A-Za-z]{3}/.test(L) || /\d{1,2}[/.\-]\d{1,2}[/.\-]20\d{2}/.test(L))) { anoCab = +m[1]; break; }
        }
      }
      const temDatas = linhas.some(L => dataNoInicio(L));

      const brutos = [];
      let modo = 0, futuro = false, dataAtual = null, pendente = null, buffer = [], esperaCauda = false, ultimo = null, usouHoje = false;
      for (const L0 of linhas) {
        const n0 = normalizar(L0);
        if (!n0) continue;
        if (RE_FUTURO.test(n0)) { futuro = true; continue; }
        if (futuro) { if (RE_RETOMA.test(n0) && !/futur|proxima/.test(n0)) futuro = false; else continue; }
        if (/total de entradas/.test(n0)) modo = 1; else if (/total de saidas/.test(n0)) modo = -1;
        const L = L0.replace(/^(?:\[\s*\d\s*\]|□|\d)\s+(?=\d{1,2}\/\d{1,2}\b)/, '');
        const d = dataNoInicio(L);
        if (!d && /saldo do dia/.test(n0)) { const x = dataExtensoEm(L); if (x) dataAtual = x; continue; }
        const resto = d ? d.resto : L;
        const nr = normalizar(resto);
        if (d && (!nr || /^(total de (entradas|saidas)|saldos?\b(?! separado)|s a l d o|sdo\b)/.test(nr))) {
          if (!nr || /^total de|^saldo do dia/.test(nr) || d.a) dataAtual = { d: d.d, m: d.m, a: d.a };
          continue;
        }
        if (RE_IGNORAR_TXT.test(nr) || /divididos em|parcelas de r|em ate \d+ ?x|\d+[,.]?\d* ?% ?(a m|ao mes|a a)/.test(nr)) continue;
        if (!d && /^\d{1,2} de [a-z]+ (de )?\d{4}$/.test(nr)) { const x = dataExtensoEm(L); if (x) dataAtual = x; continue; }
        const v = acharValor(resto);
        if (!v) {
          const txt = limparDescTexto(resto);
          if (!temLetras(txt)) continue;
          if (ultimo && /^(des|rem)\s*:/i.test(txt)) { ultimo.desc += ' - ' + txt.replace(/^(des|rem)\s*:\s*/i, ''); continue; }
          if (d && d.hora && ultimo && !d.a) { ultimo.desc += ' - ' + txt; continue; }       // BB: 'DD/MM HH:MM nome'
          if (d) { pendente = { data: d, desc: txt, linha: L0 }; continue; }
          if (esperaCauda && ultimo) { ultimo.desc += ' ' + txt; esperaCauda = false; continue; }
          buffer.push(txt); if (buffer.length > 2) buffer.shift();
          continue;
        }
        let desc = limparDescTexto(v.limpo.slice(0, v.indice));
        let data = d ? { d: d.d, m: d.m, a: d.a } : null;
        let linhaOrig = L0;
        let cauda = false;
        if (!temLetras(desc)) {
          if (pendente && !d) { desc = pendente.desc; data = pendente.data; linhaOrig = pendente.linha + ' ' + L0; }
          else if (buffer.length) { desc = buffer.join(' '); cauda = true; }
          else continue;
        }
        // PDF com blocos por dia (Nubank, Inter): a descrição pode começar na linha de cima
        else if (!d && dataAtual && buffer.length) { desc = buffer.join(' ') + ' ' + desc; linhaOrig = buffer.join(' ') + ' ' + L0; }
        pendente = null; buffer = [];
        if (!data) {
          if (dataAtual) data = dataAtual;
          else if (conta === 'cartao') { if (/\biof\b/i.test(desc) && ultimo) data = ultimo.data; else continue; }
          else if (ultimo) data = ultimo.data;
          else if (!temDatas) { const h = hojeIso().split('-').map(Number); data = { d: h[2], m: h[1], a: h[0] }; usouHoje = true; }
          else continue;
        }
        esperaCauda = cauda;
        ultimo = { data, desc, abs: v.abs, sinal: v.sinal, sinalC: v.sinalC, cd: v.cd, modo, linha: linhaOrig };
        brutos.push(ultimo);
      }

      // sinal de cada lançamento
      const assinado = brutos.some(b => b.sinal < 0 && !b.cd);
      const lista = [];
      // ano das datas sem ano
      const hoje = hojeIso();
      const Y = ref ? +ref.slice(0, 4) : (opcoes.ano || anoCab || +hoje.slice(0, 4));
      const M = ref ? +ref.slice(5, 7) : null;
      const semAno = brutos.filter(b => !b.data.a).map(b => b.data.m);
      const vira = M == null && semAno.some(m => m >= 10) && semAno.some(m => m <= 3);
      for (const b of brutos) {
        const nd = normalizar(b.desc);
        let valor;
        if (b.cd) valor = b.cd === 'D' ? -b.abs : b.abs;
        else if (conta === 'cartao') valor = (b.sinalC || RE_CREDITO_CARTAO.test(nd)) ? b.abs : -b.abs;   // na fatura, sinal = crédito
        else if (b.sinal) valor = b.sinal * b.abs;
        else if (b.modo) valor = b.modo * b.abs;
        else if (conta === 'corrente' && assinado) valor = b.abs;
        else valor = RE_RECEITA.test(nd) ? b.abs : -b.abs;
        if (!valor) continue;
        let a = b.data.a;
        if (!a) {
          a = Y;
          if (M != null && b.data.m > M) a = Y - 1;
          else if (vira && b.data.m >= 7) a = Y - 1;
        }
        let data = iso(a, b.data.m, b.data.d);
        if (!data) continue;
        if (!b.data.a && !ref && !opcoes.ano && !anoCab && diasEntre(data, hoje) > 62) data = iso(a - 1, b.data.m, b.data.d) || data;
        const parcela = lerParcela(b.desc, conta === 'cartao');
        const t = novaTransacao(data, valor, b.desc, b.linha, parcela);
        lista.push(t);
      }
      if (conta === 'cartao' && ref) {
        let movidas = 0;
        lista.forEach(t => { if (ajustarDataParcela(t, ref, false)) movidas++; });
        if (movidas) res.avisos.push(movidas + (movidas > 1 ? ' parcelas vieram' : ' parcela veio') + ' com a data da compra original; usei o mês da cobrança.');
      }
      if (usouHoje) res.avisos.push('Algumas linhas não tinham data; usei a data de hoje.');
      if (!lista.length) res.avisos.push('Não encontrei lançamentos no texto. Cada linha precisa ter data, descrição e valor. ' + DICA_PDF);
      return finalizar(res, lista, 'tx');
    } catch (e) {
      res.transacoes = [];
      res.avisos.push('Não consegui ler o texto (' + ((e && e.message) || 'erro') + ').');
      return res;
    }
  }

  /* ── entrada principal ── */

  function ler(texto, nomeArquivo, opcoes) {
    opcoes = Object.assign({}, opcoes || {});
    const nome = typeof nomeArquivo === 'string' ? nomeArquivo : '';
    try {
      if (texto != null && typeof texto !== 'string') texto = decodificar(texto);
      texto = consertarMojibake(String(texto || '').replace(/^\ufeff/, ''));
      if (!texto.trim()) return { formato: 'texto', banco: null, conta: null, transacoes: [], avisos: ['O arquivo está vazio.'] };
      if (/^\s*%PDF/.test(texto)) return { formato: 'texto', banco: null, conta: null, transacoes: [], avisos: ['Isto é um PDF: extraia o texto dele (lerTexto) ou exporte o extrato em OFX ou CSV.'] };
      if (/OFXHEADER|<OFX>|<OFC>|<STMTTRN>/i.test(texto.slice(0, 4000)) || /<STMTTRN>/i.test(texto)) {
        const r = lerOFX(texto, Object.assign({ nome }, opcoes));
        if (!r.banco) r.banco = bancoPorTexto(nome);
        return r;
      }
      const c = lerCSV(texto, nome, opcoes);
      if (c && c.transacoes.length) return c;
      const t = lerTexto(texto.replace(/;/g, '  ').replace(/\t/g, '  '), Object.assign({ nome, ref: refDoNome(nome) }, opcoes));
      if (c && !t.transacoes.length) return c;
      if (!t.banco) t.banco = bancoPorTexto(nome);
      return t;
    } catch (e) {
      return { formato: 'texto', banco: null, conta: null, transacoes: [], avisos: ['Não consegui ler o arquivo (' + ((e && e.message) || 'erro') + ').'] };
    }
  }

  raiz.Extrato = {
    versao: '1.0.0',
    decodificar, ler, lerTexto, chave, classificar,
    generica, normalizar, lerValor, lerData,
    CATEGORIAS
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
