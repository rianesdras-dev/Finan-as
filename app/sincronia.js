/* ════════════════════════════════════════════════════════════════════
   sincronia.js — usar o app em mais de um aparelho (celular, computador)

   Um código aleatório (ex.: K7Q2M-9XPDA-4TRWZ-H3NBE) é a única chave.
   Dele saem, por PBKDF2, três coisas: a chave AES-GCM que cifra os dados
   AQUI no aparelho, o id da “caixa” no servidor e um token de escrita.
   O servidor (netlify/functions/sync.mjs) só guarda bytes cifrados: sem o
   código ninguém lê nada, nem o Netlify.

     Sincronia.novoCodigo()                  -> 'XXXXX-XXXXX-XXXXX-XXXXX'
     Sincronia.normalizar(texto)             -> código limpo ou null (aceita o link inteiro)
     Sincronia.derivar(codigo)               -> Promise<{ chave, id, token }>
     Sincronia.cifrar(chave, bytes|string)   -> Promise<Uint8Array>   (IV de 12 bytes + texto cifrado)
     Sincronia.decifrar(chave, bytes)        -> Promise<Uint8Array>
     Sincronia.mesclar(local, remoto)        -> estado juntando os dois (para quando os dois mudaram)
   ════════════════════════════════════════════════════════════════════ */
(function (raiz) {
  'use strict';
  const ALFA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';           // sem 0/O, 1/I/L
  const enc = new TextEncoder();

  function novoCodigo() {
    const b = raiz.crypto.getRandomValues(new Uint8Array(20));
    let s = '';
    for (let i = 0; i < 20; i++) s += ALFA[b[i] % ALFA.length];   // 20 × log2(31) ≈ 99 bits
    return s.match(/.{5}/g).join('-');
  }
  function normalizar(texto) {
    let t = String(texto == null ? '' : texto).trim();
    const m = t.match(/[#&?]sync=([^&\s]+)/i);
    if (m) t = decodeURIComponent(m[1]);
    t = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (t.length !== 20 || [...t].some(c => !ALFA.includes(c))) return null;
    return t.match(/.{5}/g).join('-');
  }
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

  async function derivar(codigo) {
    const c = normalizar(codigo);
    if (!c) throw new Error('Código inválido.');
    const base = await raiz.crypto.subtle.importKey('raw', enc.encode(c), 'PBKDF2', false, ['deriveBits']);
    const bits = new Uint8Array(await raiz.crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode('financeiro-sync-v1'), iterations: 120000 }, base, 768));
    const chave = await raiz.crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
    return { chave, id: hex(bits.slice(32, 64)), token: hex(bits.slice(64, 96)) };
  }
  async function cifrar(chave, dados) {
    const bytes = typeof dados === 'string' ? enc.encode(dados) : new Uint8Array(dados);
    const iv = raiz.crypto.getRandomValues(new Uint8Array(12));
    const c = new Uint8Array(await raiz.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, chave, bytes));
    const out = new Uint8Array(12 + c.length); out.set(iv); out.set(c, 12);
    return out;
  }
  async function decifrar(chave, dados) {
    const b = new Uint8Array(dados);
    if (b.length < 29) throw new Error('Dados da nuvem incompletos.');
    try { return new Uint8Array(await raiz.crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12) }, chave, b.slice(12))); }
    catch (e) { throw new Error('Não deu pra abrir os dados da nuvem com este código.'); }
  }

  /* Junta dois estados quando os dois aparelhos mudaram desde a última vez.
     Listas de registros com id: união por id (o registro do aparelho atual
     vence). Objetos: união das chaves, recursiva. O resto: o do aparelho atual.
     Em comprovantes (compSync) o 0 marca apagado e vence o 1. */
  const ehObj = x => x && typeof x === 'object' && !Array.isArray(x);
  function mesclarValor(a, b, caminho) {
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.every(x => ehObj(x) && x.id != null) && b.every(x => ehObj(x) && x.id != null)) {
        const ids = new Set(a.map(x => x.id));
        return a.concat(b.filter(x => !ids.has(x.id)));
      }
      if (a.every(x => typeof x !== 'object') && b.every(x => typeof x !== 'object'))
        return [...new Set(a.concat(b))].sort();
      return a;
    }
    if (ehObj(a) && ehObj(b)) {
      const out = Object.assign({}, b);
      for (const k of Object.keys(a)) {
        if (caminho === 'compSync' && (a[k] === 0 || b[k] === 0)) { out[k] = 0; continue; }
        out[k] = k in b ? mesclarValor(a[k], b[k], caminho || k) : a[k];
      }
      return out;
    }
    return a === undefined ? b : a;
  }
  function mesclar(local, remoto) {
    if (!ehObj(remoto)) return local;
    if (!ehObj(local)) return remoto;
    const out = mesclarValor(local, remoto, '');
    if (local.novo === false || remoto.novo === false) out.novo = false;
    if (Array.isArray(out.lanc)) out.lanc.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
    return out;
  }

  raiz.Sincronia = { novoCodigo, normalizar, derivar, cifrar, decifrar, mesclar, _hex: hex };
})(typeof globalThis !== 'undefined' ? globalThis : this);
