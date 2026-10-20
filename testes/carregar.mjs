import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const caminho = new URL('../app/extrato.js', import.meta.url);
export function carregar() {
  const ctx = { TextDecoder, Uint8Array, ArrayBuffer, console, Date, Math, JSON, Intl };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(caminho, 'utf8'), ctx, { filename: 'extrato.js' });
  return ctx.Extrato;
}
