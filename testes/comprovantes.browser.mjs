// Teste de navegador de app/comprovantes.js (IndexedDB, imagens, ZIP) no Chromium do Playwright.
// NÃO tem o sufixo .test.mjs, então `node --test testes/` não roda este arquivo.
// Rodar com:  node testes/comprovantes.browser.mjs
// Sobe `python3 -m http.server` em app/ numa porta livre entre 8800 e 8899 e derruba no fim.
// Dados 100% sintéticos (PNG desenhado no canvas, PDF montado aqui).
import { execSync, spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const PW = execSync('npm root -g').toString().trim() + '/playwright/index.mjs';
const { chromium } = await import(PW);
const APP = fileURLToPath(new URL('../app/', import.meta.url));

/* ── PDF mínimo com texto (Helvetica), xref com posições corretas ── */
function pdfSintetico(linhas) {
  const fluxo = 'BT /F1 12 Tf 50 780 Td 16 TL\n' + linhas.map(l => '(' + l.replace(/[\\()]/g, '\\$&') + ") '").join('\n') + '\nET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(fluxo, 'latin1')} >>\nstream\n${fluxo}\nendstream`,
  ];
  let s = '%PDF-1.4\n';
  const pos = [];
  objs.forEach((o, i) => { pos.push(Buffer.byteLength(s, 'latin1')); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(s, 'latin1');
  s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + pos.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('');
  s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}

const portaLivre = p => new Promise(ok => { const s = net.createServer().once('error', () => ok(false)).listen(p, '127.0.0.1', () => s.close(() => ok(true))); });
let porta = 0;
for (let p = 8800 + Math.floor(Math.random() * 50); p < 8900; p++) if (await portaLivre(p)) { porta = p; break; }
if (!porta) throw new Error('nenhuma porta livre entre 8800 e 8899');

const servidor = spawn('python3', ['-m', 'http.server', String(porta), '--bind', '127.0.0.1'], { cwd: APP, stdio: 'ignore' });
const base = `http://127.0.0.1:${porta}/`;
for (let i = 0; i < 50; i++) { try { await fetch(base + 'comprovantes.js'); break; } catch (e) { await new Promise(r => setTimeout(r, 100)); } }

const browser = await chromium.launch();
let falhas = 0;
const ok = (nome, f) => f().then(() => console.log('ok   ' + nome), e => { falhas++; console.log('FALHOU ' + nome + '\n   ' + (e && e.stack || e)); });
const tmp = mkdtempSync(join(tmpdir(), 'comprovantes-browser-'));

try {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('[pageerror]', e.message));
  // página vazia na mesma origem do app (não carrega o index.html, que está sendo reescrito)
  await page.route(base + '__teste.html', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><script src="comprovantes.js"></script>' }));
  // pdf.js vem do cdnjs: o Node baixa (curl respeita o proxy da máquina) e entrega ao navegador.
  // Sem internet, a página recebe erro de rede e lerInfo deve devolver o aviso.
  await page.route('https://cdnjs.cloudflare.com/**', r => {
    try {
      const corpo = execFileSync('curl', ['-sSfL', '--max-time', '60', r.request().url()], { maxBuffer: 1 << 26 });
      return r.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: corpo });
    } catch (e) { return r.abort(); }
  });
  await page.goto(base + '__teste.html');
  await page.waitForFunction(() => !!window.Comprovantes);

  const pdf = pdfSintetico(['Comprovante de transferencia', 'Pix enviado', 'Valor: R$ 1.234,56', 'Data e hora: 12/03/2025 14:32', 'Para', 'Nome Clinica Ficticia Teste', 'CPF ***.123.456-**', 'Saldo: R$ 9.999,99']);

  await ok('abrir() cria o banco com as lojas e índices', async () => {
    const r = await page.evaluate(async () => {
      await Comprovantes.abrir();
      await Comprovantes.abrir();   // segunda vez não reabre
      const db = await new Promise(ok => { const q = indexedDB.open('financeiro-comprovantes'); q.onsuccess = () => ok(q.result); });
      const tx = db.transaction('arquivos'), s = tx.objectStore('arquivos');
      const out = { versao: db.version, lojas: [...db.objectStoreNames], chave: s.keyPath, indices: [...s.indexNames] };
      db.close();
      return out;
    });
    assert.equal(r.versao, 1);
    assert.ok(r.lojas.includes('arquivos'));
    assert.equal(r.chave, 'id');
    assert.deepEqual(r.indices.sort(), ['mes', 'ref']);
  });

  await ok('salvar() imagem grande: reduz para 1600px em JPEG e faz miniatura <= 200px', async () => {
    const r = await page.evaluate(async () => {
      // PNG 3000x2000 "fotográfico" (ruído + gradiente): pesado em PNG, bem menor em JPEG
      const c = document.createElement('canvas'); c.width = 3000; c.height = 2000;
      const g = c.getContext('2d'), img = g.createImageData(3000, 2000);
      let x = 12345;
      for (let i = 0; i < img.data.length; i += 4) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        const p = i / 4, col = p % 3000, lin = (p / 3000) | 0;
        img.data[i] = (col / 12 + (x & 31)) & 255; img.data[i + 1] = (lin / 8 + ((x >> 5) & 31)) & 255; img.data[i + 2] = (x >> 10) & 255; img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      const png = await new Promise(ok => c.toBlob(ok, 'image/png'));
      const arq = new File([png], 'print-pix.png', { type: 'image/png' });
      const reg = await Comprovantes.salvar(arq, { ref: 'c7', mes: '2025-03', valor: 150, data: '2025-03-12', nota: 'conta de luz' });
      const o = await Comprovantes.obter(reg.id);
      const bm = await createImageBitmap(o.blob);
      const mini = await new Promise(ok => { const i = new Image(); i.onload = () => ok([i.width, i.height]); i.src = reg.miniatura; });
      return { reg, original: png.size, guardado: o.blob.size, tipoBlob: o.blob.type, dim: [bm.width, bm.height], mini };
    });
    assert.equal(r.reg.tipo, 'image/jpeg');
    assert.equal(r.reg.nome, 'print-pix.jpg');
    assert.equal(r.tipoBlob, 'image/jpeg');
    assert.deepEqual(r.dim, [1600, 1067]);
    assert.ok(r.guardado < r.original, `${r.guardado} < ${r.original}`);
    assert.equal(r.reg.tamanho, r.guardado);
    assert.match(r.reg.miniatura, /^data:image\/jpeg;base64,/);
    assert.deepEqual(r.mini, [200, 133]);
    assert.equal(r.reg.ref, 'c7'); assert.equal(r.reg.mes, '2025-03'); assert.equal(r.reg.valor, 150);
    assert.equal(r.reg.data, '2025-03-12'); assert.equal(r.reg.nota, 'conta de luz');
    assert.match(r.reg.criado, /^\d{4}-\d\d-\d\dT/);
  });

  await ok('salvar() imagem pequena e simples: mantém o PNG original (JPEG não ficaria menor)', async () => {
    const r = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 120; c.height = 80;
      const g = c.getContext('2d'); g.fillStyle = '#0a7'; g.fillRect(0, 0, 120, 80);
      const png = await new Promise(ok => c.toBlob(ok, 'image/png'));
      const reg = await Comprovantes.salvar(png, { ref: 'c8', mes: '2025-03' });
      const o = await Comprovantes.obter(reg.id);
      const iguais = new Uint8Array(await o.blob.arrayBuffer()).join() === new Uint8Array(await png.arrayBuffer()).join();
      return { reg, iguais };
    });
    assert.equal(r.reg.tipo, 'image/png');
    assert.equal(r.reg.nome, 'comprovante');
    assert.ok(r.iguais);
    assert.match(r.reg.miniatura, /^data:image\/jpeg/);
  });

  await ok('salvar() PDF: guarda os bytes iguais, sem miniatura', async () => {
    const r = await page.evaluate(async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      await new Promise(r => setTimeout(r, 5));
      const reg = await Comprovantes.salvar(new File([bytes], 'Comprovante Pix.pdf', { type: 'application/pdf' }), { ref: 'fatura', mes: '2025-04', valor: 1234.56 });
      const o = await Comprovantes.obter(reg.id);
      return { reg, igual: new Uint8Array(await o.blob.arrayBuffer()).join() === bytes.join() };
    }, pdf.toString('base64'));
    assert.equal(r.reg.tipo, 'application/pdf');
    assert.equal(r.reg.miniatura, null);
    assert.equal(r.reg.tamanho, pdf.length);
    assert.ok(r.igual);
  });

  await ok('listar() sem blobs, mais novo primeiro, com filtros; uso()', async () => {
    const r = await page.evaluate(async () => ({
      todos: await Comprovantes.listar(),
      porRef: await Comprovantes.listar({ ref: 'c7' }),
      porMes: await Comprovantes.listar({ mes: '2025-03' }),
      ambos: await Comprovantes.listar({ ref: 'c8', mes: '2025-04' }),
      uso: await Comprovantes.uso(),
    }));
    assert.deepEqual(r.todos.map(x => x.ref), ['fatura', 'c8', 'c7']);
    assert.ok(r.todos.every(x => !('blob' in x) && !('bytes' in x)));
    assert.deepEqual(r.porRef.map(x => x.ref), ['c7']);
    assert.deepEqual(r.porMes.map(x => x.ref), ['c8', 'c7']);
    assert.deepEqual(r.ambos, []);
    assert.equal(r.uso.n, 3);
    assert.equal(r.uso.bytes, r.todos.reduce((s, x) => s + x.tamanho, 0));
  });

  await ok('erros em português, sem lançar exceção síncrona', async () => {
    const r = await page.evaluate(async () => {
      const msg = p => p.then(() => 'resolveu', e => e.message);
      return {
        semArquivo: await msg(Comprovantes.salvar(null, { ref: 'a', mes: '2025-01' })),
        vazio: await msg(Comprovantes.salvar(new Blob([]), { ref: 'a', mes: '2025-01' })),
        semRef: await msg(Comprovantes.salvar(new Blob(['x']), { mes: '2025-01' })),
        mesRuim: await msg(Comprovantes.salvar(new Blob(['x']), { ref: 'a', mes: '2025-13' })),
        dataRuim: await msg(Comprovantes.salvar(new Blob(['x']), { ref: 'a', mes: '2025-01', data: '2025-02-30' })),
        obterNada: await Comprovantes.obter('nao-existe'),
        obterRuim: await Comprovantes.obter(42),
        apagarRuim: await msg(Comprovantes.apagar(undefined)),
        lerRuim: await msg(Comprovantes.lerInfo('texto')),
        zipRuim: await msg(Comprovantes.exportarZip('x')),
      };
    });
    assert.match(r.semArquivo, /Escolha um arquivo/);
    assert.match(r.vazio, /vazio/);
    assert.match(r.semRef, /qual conta/);
    assert.match(r.mesRuim, /Mês inválido/);
    assert.match(r.dataRuim, /Data inválida/);
    assert.equal(r.obterNada, null);
    assert.equal(r.obterRuim, null);
    assert.match(r.apagarRuim, /inválido/);
    assert.match(r.lerRuim, /Escolha um arquivo/);
    assert.match(r.zipRuim, /inválida/);
  });

  await ok('exportarZip(): o Python abre, CRC confere, pastas por mês e CSV', async () => {
    const b64 = await page.evaluate(async () => {
      const z = await Comprovantes.exportarZip();
      if (z.type !== 'application/zip') throw new Error('tipo ' + z.type);
      const u8 = new Uint8Array(await z.arrayBuffer());
      let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
      return btoa(s);
    });
    const arq = join(tmp, 'comprovantes.zip');
    writeFileSync(arq, Buffer.from(b64, 'base64'));
    execFileSync('python3', ['-I', '-m', 'zipfile', '-t', arq]);
    const py = 'import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({"nomes":z.namelist(),"csv":z.read("comprovantes.csv").decode("utf-8-sig")}))';
    const r = JSON.parse(execFileSync('python3', ['-I', '-c', py, arq]).toString());
    assert.equal(r.nomes.length, 4);
    assert.ok(r.nomes.includes('2025-03/print-pix_2025-03-12.jpg'), r.nomes.join(', '));
    assert.ok(r.nomes.some(n => /^2025-03\/comprovante_\d{4}-\d\d-\d\d\.png$/.test(n)), r.nomes.join(', '));
    assert.ok(r.nomes.some(n => /^2025-04\/Comprovante-Pix_\d{4}-\d\d-\d\d\.pdf$/.test(n)), r.nomes.join(', '));
    const linhas = r.csv.trim().split(/\r\n/);
    assert.equal(linhas[0], 'mes;ref;nome;valor;data;arquivo;nota');
    assert.ok(linhas.includes('2025-03;c7;print-pix.jpg;150,00;2025-03-12;2025-03/print-pix_2025-03-12.jpg;conta de luz'), linhas.join('\n'));
    assert.ok(linhas.some(l => l.startsWith('2025-04;fatura;Comprovante Pix.pdf;1234,56;;')));
  });

  await ok('lerInfo(): texto, imagem (sem OCR) e PDF (pdf.js do cdnjs)', async () => {
    const r = await page.evaluate(async () => {
      const txt = await Comprovantes.lerInfo(new File(['Comprovante\nValor pago: R$ 99,90\nPago em: 05/02/2025\nBeneficiário: Teste Ltda'], 'c.txt', { type: 'text/plain' }));
      const img = await Comprovantes.lerInfo(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }));
      return { txt, img };
    });
    assert.equal(r.txt.valor, 99.9); assert.equal(r.txt.data, '2025-02-05'); assert.deepEqual(r.txt.nomes, ['Teste Ltda']);
    assert.deepEqual(r.img, { valor: null, data: null, nomes: [], texto: '' });
    const p = await page.evaluate(async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return Comprovantes.lerInfo(new File([bytes], 'x.pdf', { type: 'application/pdf' }));
    }, pdf.toString('base64'));
    if (p.aviso && /internet/.test(p.aviso)) { console.log('     (aviso: sem acesso ao cdnjs; leitura de PDF não conferida: ' + p.aviso + ')'); return; }
    assert.equal(p.valor, 1234.56, JSON.stringify(p));
    assert.equal(p.data, '2025-03-12');
    assert.deepEqual(p.nomes, ['Clinica Ficticia Teste']);
    const s = await page.evaluate(info => Comprovantes.sugerir(info, [{ ref: 'c1', nome: 'Clínica', v: 1234.56, mes: '2025-03', dia: 10 }, { ref: 'c2', nome: 'Luz', v: 80, mes: '2025-03' }]), p);
    assert.equal(s.length, 1); assert.equal(s[0].ref, 'c1');
  });

  await ok('apagar() remove registro e arquivo; uso() acompanha', async () => {
    const r = await page.evaluate(async () => {
      const [primeiro] = await Comprovantes.listar({ ref: 'c7' });
      await Comprovantes.apagar(primeiro.id);
      await Comprovantes.apagar(primeiro.id);   // de novo: não reclama
      const conteudo = await new Promise(ok => { const q = indexedDB.open('financeiro-comprovantes'); q.onsuccess = () => { const g = q.result.transaction('conteudo').objectStore('conteudo').count(); g.onsuccess = () => { ok(g.result); q.result.close(); }; }; });
      return { obter: await Comprovantes.obter(primeiro.id), uso: await Comprovantes.uso(), conteudo };
    });
    assert.equal(r.obter, null);
    assert.equal(r.uso.n, 2);
    assert.equal(r.conteudo, 2);
  });

  await ok('dados continuam lá depois de recarregar a página', async () => {
    await page.reload();
    await page.waitForFunction(() => !!window.Comprovantes);
    const n = await page.evaluate(async () => (await Comprovantes.uso()).n);
    assert.equal(n, 2);
  });
} finally {
  await browser.close();
  servidor.kill();
  rmSync(tmp, { recursive: true, force: true });
}

console.log(falhas ? `\n${falhas} teste(s) falharam` : '\ntodos os testes de navegador passaram');
process.exit(falhas ? 1 : 0);
