/* ════════════════════════════════════════════════════════════════════
   nuvem-claude.js — quando o app é aberto como página do Claude (claude.ai)

   Guarda o estado no banco da página (capacidade `db`, coleção `fin`, que
   só a dona lê e escreve) e os comprovantes nos arquivos da página
   (`assets`). Assim celular e computador, com o mesmo login do Claude,
   veem os mesmos dados. Fora do Claude (Netlify) não faz nada.

   O estado vai em partes de até 180 mil caracteres, com versão:
     fin/estado        { versao, partes, em }
     fin/v<versao>_p<i> { t: pedaço do JSON }
   Quem lê pega primeiro `estado` e depois as partes daquela versão, então
   nunca mistura duas gravações.
   ════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const N = window.NuvemClaude = {
    ativo: false, downloads: null,
    mudou() {}, compMudou() {}, compApagado() {}, agora: async () => {},
    texto: () => 'Abra pelo Claude para salvar na sua conta',
    baixar: async () => {},
  };
  if (!(window.claude && typeof window.claude.use === 'function')) return;

  const TAM = 180000, KEY_SUJO = 'financeiro-claude-sujo';
  let db = null, assets = null, versao = 0, gravando = false, deNovo = false, t = null, erro = null, em = null, pronto = false;
  const sujo = () => { try { return localStorage.getItem(KEY_SUJO) === '1'; } catch (_) { return false; } };
  const marca = v => { try { v ? localStorage.setItem(KEY_SUJO, '1') : localStorage.removeItem(KEY_SUJO); } catch (_) {} };
  const cache = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {} };

  async function ler() {
    const e = await db.doc('fin/estado').get();
    if (!e.exists) return null;
    const d = e.data() || {}, partes = [];
    for (let i = 0; i < (d.partes || 0); i++) {
      const p = await db.doc(`fin/v${d.versao}_p${i}`).get();
      if (!p.exists) throw new Error('Dados da conta incompletos. Tente de novo em instantes.');
      partes.push(p.data().t);
    }
    return { versao: d.versao || 0, estado: JSON.parse(partes.join('')) };
  }
  async function gravar() {
    if (gravando) { deNovo = true; return; }
    gravando = true;
    try {
      const json = JSON.stringify(S), n = Math.max(1, Math.ceil(json.length / TAM)), nova = versao + 1, antiga = versao;
      for (let i = 0; i < n; i++) await db.doc(`fin/v${nova}_p${i}`).set({ t: json.slice(i * TAM, (i + 1) * TAM) });
      const velho = (await db.doc('fin/estado').get()).data();
      await db.doc('fin/estado').set({ versao: nova, partes: n, em: new Date().toISOString() });
      versao = nova; marca(false); erro = null; em = new Date();
      // limpa as partes da versão anterior
      const nv = velho && velho.partes || 0;
      for (let i = 0; i < nv; i++) db.doc(`fin/v${antiga}_p${i}`).delete().catch(() => {});
    } catch (e) { erro = (e && (e.message || e.code)) || 'sem conexão'; }
    finally {
      gravando = false;
      if (deNovo) { deNovo = false; gravar(); }
    }
  }
  function aplicar(remoto) {
    S = normaliza(remoto);
    cache(); renderView();
    if (!UI.sheet || ['sync', 'ajustes'].includes(UI.sheet)) renderSheet();
  }

  // comprovantes: o arquivo vai para os assets da página; S.compAssets guarda { a: id do asset, r: dados } (0 = apagado)
  async function syncComp() {
    if (!assets || !window.Comprovantes) return;
    S.compAssets = S.compAssets || {};
    let mudou = false;
    try {
      const locais = await Comprovantes.listar(), aqui = new Set(locais.map(r => r.id));
      for (const r of locais) {
        const x = S.compAssets[r.id];
        if (x === 0) { await Comprovantes.apagar(r.id); continue; }
        if (!x) {
          const o = await Comprovantes.obter(r.id); if (!o) continue;
          const up = await assets.upload(o.blob);
          S.compAssets[r.id] = { a: up.id, r: Object.assign({}, o.registro) };
          mudou = true;
        }
      }
      for (const [id, x] of Object.entries(S.compAssets)) {
        if (!x || aqui.has(id)) continue;
        const res = await fetch('/_blob/' + x.a);
        if (!res.ok) continue;
        await Comprovantes.importar(x.r, new Uint8Array(await res.arrayBuffer()));
        if (typeof atualizaSemComp === 'function') atualizaSemComp(true);
      }
    } catch (e) { console.warn('comprovantes na conta', e); }
    if (mudou) { cache(); N.mudou(); }
  }

  N.mudou = () => {
    if (!pronto) { marca(true); return; }
    marca(true); clearTimeout(t); t = setTimeout(gravar, 1200);
  };
  N.agora = async () => { clearTimeout(t); await gravar(); await syncComp(); };
  N.compMudou = () => { if (pronto) syncComp(); };
  N.compApagado = id => {
    S.compAssets = S.compAssets || {};
    const x = S.compAssets[id];
    if (x && x.a && assets) assets.delete(x.a).catch(() => {});
    S.compAssets[id] = 0; save();
  };
  N.texto = () => !pronto ? 'Conectando à sua conta…'
    : erro ? '⚠ Não deu pra salvar na conta: ' + erro
    : sujo() ? 'Salvando na sua conta…'
    : '✓ Salvo na sua conta do Claude' + (em ? ' · ' + em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '');
  N.baixar = async (nome, dados) => {
    try { await N.downloads.save({ filename: nome, data: dados }); return true; }
    catch (e) {
      if (e && e.code === 'declined') return false;
      toast(e && e.code === 'rejected_extension' ? 'Esse tipo de arquivo não pode ser baixado aqui' : 'Não deu pra baixar o arquivo aqui');
      return false;
    }
  };

  (async () => {
    db = await window.claude.use('db');
    if (!db) return;
    N.ativo = true;
    [assets, N.downloads] = await Promise.all([window.claude.use('assets'), window.claude.use('downloads')]);
    try {
      const r = await ler();
      if (r) {
        versao = r.versao;
        if (sujo() && !S.novo) { S = normaliza(Sincronia.mesclar(S, r.estado)); cache(); renderView(); pronto = true; await gravar(); }
        else { aplicar(r.estado); pronto = true; }
      } else {
        pronto = true;
        if (!S.novo) await gravar();
      }
      em = new Date();
    } catch (e) { erro = (e && (e.message || e.code)) || 'sem conexão'; pronto = true; }
    if (typeof render === 'function') render();
    // outro aparelho gravou: traz (ou junta, se aqui também mudou)
    db.doc('fin/estado').onSnapshot(async snap => {
      if (!snap.exists) return;
      const d = snap.data() || {};
      if ((d.versao || 0) <= versao || gravando) return;
      try {
        const r = await ler(); if (!r || r.versao <= versao) return;
        versao = r.versao;
        if (sujo()) { S = normaliza(Sincronia.mesclar(S, r.estado)); cache(); renderView(); gravar(); }
        else aplicar(r.estado);
        syncComp();
      } catch (_) {}
    }, () => {});
    syncComp();
  })();
})();
