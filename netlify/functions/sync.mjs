// Caixa cifrada para sincronizar o app entre aparelhos (Netlify Functions + Netlify Blobs).
// Guarda só bytes já cifrados no aparelho (app/sincronia.js); não sabe ler nada.
//   GET    /api/sync?id=<64 hex>&k=estado|c-<id>   -> bytes (X-Versao: n)  | 404
//   PUT    /api/sync?id=...&k=...   (X-Token, X-Base em 'estado') -> 204 (X-Versao) | 409 versão mudou | 403 token
//   DELETE /api/sync?id=...&k=c-<id> (X-Token) -> 204
import { getStore } from '@netlify/blobs';

const MAX = 25 * 1024 * 1024;
const hexOk = s => /^[a-f0-9]{64}$/.test(s || '');
const chaveOk = k => k === 'estado' || /^c-[a-z0-9_]{1,40}$/.test(k || '');
async function sha(texto) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const resp = (status, corpo, extra) => new Response(corpo ?? null, { status,
  headers: Object.assign({ 'Cache-Control': 'no-store', 'Access-Control-Expose-Headers': 'X-Versao' }, extra || {}) });

export function criar(loja) {
  return async (req) => {
    const u = new URL(req.url), id = u.searchParams.get('id'), k = u.searchParams.get('k') || 'estado';
    if (!hexOk(id) || !chaveOk(k)) return resp(400, 'pedido inválido');
    const nome = id + '/' + k, nomeEstado = id + '/estado';
    if (req.method === 'GET') {
      const r = await loja.getWithMetadata(nome, { type: 'arrayBuffer' });
      if (!r) return resp(404);
      return resp(200, r.data, { 'Content-Type': 'application/octet-stream', 'X-Versao': String((r.metadata && r.metadata.v) || 0) });
    }
    if (req.method !== 'PUT' && req.method !== 'DELETE') return resp(405);
    const token = req.headers.get('x-token') || '';
    if (!hexOk(token)) return resp(403, 'sem token');
    const hashToken = await sha(token);
    const meta = await loja.getMetadata(nomeEstado);
    const dono = meta && meta.metadata && meta.metadata.w;
    if (dono && dono !== hashToken) return resp(403, 'token errado');
    if (!dono && k !== 'estado') return resp(409, 'envie o estado primeiro');
    if (req.method === 'DELETE') { if (k === 'estado') return resp(400); await loja.delete(nome); return resp(204); }
    const corpo = await req.arrayBuffer();
    if (!corpo.byteLength || corpo.byteLength > MAX) return resp(413, 'tamanho inválido');
    if (k === 'estado') {
      const v = (meta && meta.metadata && meta.metadata.v) || 0, base = Number(req.headers.get('x-base') || 0);
      if (base !== v) return resp(409, 'versão mudou', { 'X-Versao': String(v) });
      await loja.set(nome, corpo, { metadata: { v: v + 1, w: hashToken } });
      return resp(204, null, { 'X-Versao': String(v + 1) });
    }
    await loja.set(nome, corpo);
    return resp(204);
  };
}

export default async (req) => criar(getStore({ name: 'financeiro', consistency: 'strong' }))(req);
export const config = { path: '/api/sync' };
