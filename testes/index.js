// Ponto de entrada para `node --test testes/`: o Node 22 trata a pasta como módulo
// e roda este arquivo, que carrega TODOS os testes. (`node --test testes/*.test.mjs` também funciona.)
import './extrato.test.mjs';
import './ataque-classificacao.test.mjs';
import './ataque-formatos.test.mjs';
import './comprovantes.test.mjs';
import './agenda.test.mjs';
import './conferencia.test.mjs';
import './sincronia.test.mjs';
