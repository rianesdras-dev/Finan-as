// Sincronização: código, chaves, cifra, mescla e a função do servidor (com uma loja em memória).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { criar } from '../netlify/functions/sync.mjs';

const ctx = { crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array, console };
ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(readFileSync(new URL('../app/sincronia.js', import.meta.url), 'utf8'), ctx);
const S = ctx.Sincronia;

test('código novo tem 20 caracteres sem letras ambíguas e volta igual pelo normalizar', () => {
  for (let i = 0; i < 50; i++) {
    const c = S.novoCodigo();
    assert.match(c, /^[A-HJKMNP-Z2-9]{5}(-[A-HJKMNP-Z2-9]{5}){3}$/);
    assert.equal(S.normalizar(c.toLowerCase().replace(/-/g, ' ')), c);
    assert.equal(S.normalizar('https://site.netlify.app/#sync=' + c), c);
  }
  assert.equal(S.normalizar('abc'), null);
  assert.equal(S.normalizar('O0000-11111-IIIII-LLLLL'), null);
});

test('mesmo código dá a mesma chave e id; cifra e decifra; código errado não abre', async () => {
  const c = S.novoCodigo(), a = await S.derivar(c), b = await S.derivar(c);
  assert.equal(a.id, b.id); assert.equal(a.token, b.token); assert.match(a.id, /^[a-f0-9]{64}$/); assert.notEqual(a.id, a.token);
  const x = await S.cifrar(a.chave, '{"oi":"ção"}');
  assert.equal(new TextDecoder().decode(await S.decifrar(b.chave, x)), '{"oi":"ção"}');
  const outro = await S.derivar(S.novoCodigo());
  await assert.rejects(() => S.decifrar(outro.chave, x), /código/);
});

test('mesclar junta listas por id, une objetos e respeita apagados de comprovantes', () => {
  const local = { novo: false, metas: { dia: 900 }, lanc: [{ id: 'a', d: '2026-10-02', v: 1 }, { id: 'b', d: '2026-10-05', v: 2 }],
    pagos: { '2026-10': { c7: '2026-10-20' } }, revisoes: ['2026-10-19'], compSync: { x1: 1, x2: 0 } };
  const remoto = { novo: false, metas: { dia: 1000, out: 1100 }, lanc: [{ id: 'b', d: '2026-10-05', v: 99 }, { id: 'c', d: '2026-10-01', v: 3 }],
    pagos: { '2026-10': { c9: '2026-10-04' }, '2026-11': { c1: true } }, revisoes: ['2026-10-12'], compSync: { x1: 0, x2: 1, x3: 1 } };
  const m = JSON.parse(JSON.stringify(S.mesclar(local, remoto)));
  assert.deepEqual(m.lanc.map(l => l.id), ['c', 'a', 'b']);
  assert.equal(m.lanc.find(l => l.id === 'b').v, 2, 'o aparelho atual vence');
  assert.deepEqual(m.metas, { dia: 900, out: 1100 });
  assert.deepEqual(m.pagos, { '2026-10': { c9: '2026-10-04', c7: '2026-10-20' }, '2026-11': { c1: true } });
  assert.deepEqual(m.revisoes, ['2026-10-12', '2026-10-19']);
  assert.deepEqual(m.compSync, { x1: 0, x2: 0, x3: 1 });
});

function lojaMemoria() {
  const m = new Map();
  return {
    async getWithMetadata(k) { const r = m.get(k); return r ? { data: r.data, metadata: r.metadata } : null; },
    async getMetadata(k) { const r = m.get(k); return r ? { metadata: r.metadata } : null; },
    async set(k, data, o) { m.set(k, { data, metadata: (o && o.metadata) || {} }); },
    async delete(k) { m.delete(k); },
  };
}
const pedido = (metodo, id, k, cab, corpo) => new Request(`https://x/api/sync?id=${id}&k=${k}`, { method: metodo, headers: cab || {}, body: corpo });

test('servidor: versão, token de escrita, conflito e comprovantes', async () => {
  const h = criar(lojaMemoria()), id = 'a'.repeat(64), tok = 'b'.repeat(64), outro = 'c'.repeat(64);
  assert.equal((await h(pedido('GET', id, 'estado'))).status, 404);
  assert.equal((await h(pedido('PUT', id, 'c-x1', { 'X-Token': tok }, 'zz'))).status, 409, 'comprovante antes do estado');
  let r = await h(pedido('PUT', id, 'estado', { 'X-Token': tok, 'X-Base': '0' }, 'um'));
  assert.equal(r.status, 204); assert.equal(r.headers.get('X-Versao'), '1');
  r = await h(pedido('GET', id, 'estado'));
  assert.equal(await r.text(), 'um'); assert.equal(r.headers.get('X-Versao'), '1');
  assert.equal((await h(pedido('PUT', id, 'estado', { 'X-Token': tok, 'X-Base': '0' }, 'dois'))).status, 409, 'base velha');
  assert.equal((await h(pedido('PUT', id, 'estado', { 'X-Token': outro, 'X-Base': '1' }, 'dois'))).status, 403, 'token de outra pessoa');
  assert.equal((await h(pedido('PUT', id, 'estado', { 'X-Token': tok, 'X-Base': '1' }, 'dois'))).status, 204);
  assert.equal((await h(pedido('PUT', id, 'c-x1', { 'X-Token': tok }, 'arquivo'))).status, 204);
  assert.equal(await (await h(pedido('GET', id, 'c-x1'))).text(), 'arquivo');
  assert.equal((await h(pedido('DELETE', id, 'c-x1', { 'X-Token': outro }))).status, 403);
  assert.equal((await h(pedido('DELETE', id, 'c-x1', { 'X-Token': tok }))).status, 204);
  assert.equal((await h(pedido('GET', id, 'c-x1'))).status, 404);
  assert.equal((await h(pedido('GET', 'xyz', 'estado'))).status, 400);
  assert.equal((await h(pedido('GET', id, '../etc'))).status, 400);
});
