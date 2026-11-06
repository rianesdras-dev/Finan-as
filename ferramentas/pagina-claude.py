"""Gera a versão do app para publicar como página do Claude (claude.ai).

O Claude monta o <head> sozinho, então tiro o esqueleto (doctype, html, head,
body e as metas de PWA) e deixo o resto igual. Os .js vão junto como arquivos.
Uso: python3 ferramentas/pagina-claude.py <pasta-de-saída>
"""
import pathlib, re, shutil, sys

raiz = pathlib.Path(__file__).resolve().parent.parent / 'app'
saida = pathlib.Path(sys.argv[1]); saida.mkdir(parents=True, exist_ok=True)
html = (raiz / 'index.html').read_text(encoding='utf-8')

inicio = html.index('<style>')
fontes = re.search(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]*>', html).group(0)
cabeca = '<title>Financeiro Rian</title>\n' + fontes + '\n'
html = cabeca + html[inicio:]
html = html.replace('</head>\n<body>\n', '\n').replace('</body>\n</html>', '')
assert '<head>' not in html and '<body>' not in html and '<html' not in html.lower()

(saida / 'index.html').write_text(html, encoding='utf-8')
for js in ['extrato.js', 'conferencia.js', 'comprovantes.js', 'agenda.js', 'caixa.js', 'sincronia.js', 'nuvem-claude.js']:
    shutil.copy(raiz / js, saida / js)
print('ok', saida)
