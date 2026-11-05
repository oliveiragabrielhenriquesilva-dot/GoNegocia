// Marca por ambiente (white-label).
// APP_MARCA=go-negocia  -> o produto aparece como GO Negocia: nenhum "Balbino" visível, home de apresentação em "/"
//                          e sistema logado em "/app".
// APP_MARCA vazio       -> comportamento original do Balbino Chat (produção atual não muda).
// Os textos são trocados só na resposta HTTP de index.html/app.js; o código-fonte e os identificadores técnicos
// (variáveis BALBINO_*, cookie, pastas, chaves) continuam iguais para não quebrar instalações existentes.
import fs from 'node:fs';
import path from 'node:path';

export const MARCAS = {
  'go-negocia': {
    id: 'go-negocia',
    nome: 'GO Negocia',
    assinatura: 'Atendimento financeiro para escolas',
    pasta: '/marca/go-negocia',
    corBase: '#123E56', corDetalhe: '#CE795F',
  },
};

// Nome visível do produto (textos que saem do servidor, inclusive rodapé de botões no WhatsApp).
export const nomeProduto = () => marcaAtual()?.nome || 'Balbino Chat';

export function marcaAtual() { return MARCAS[String(process.env.APP_MARCA || 'go-negocia').trim().toLowerCase()] || null; }
export const homeSeparada = () => Boolean(marcaAtual()) && process.env.CENTRAL_BALBINO_EMBEDDED !== '1';

// Ordem importa: frases mais longas primeiro. O padrão final só pega "Balbino" como palavra solta
// (não toca identificadores como BalbinoApp, initBalbinoViewport, balbino:pronto).
function trocas(m) {
  return [
    [/Voltar ao Portal da Rede Balbino/g, 'Voltar ao início'],
    [/Restaurar cores da Rede Balbino/g, `Restaurar cores da ${m.nome}`],
    [/mesma paleta e fonte da Rede Balbino/g, `mesma paleta e fonte da ${m.nome}`],
    [/Rede Balbino/g, m.nome],
    [/Balbino Chat 2\.0/g, m.nome],
    [/Balbino Chat/g, m.nome],
    [/Balbino IA/g, 'Assistente IA'],
    [/\bO Balbino\b(?![A-Za-z])/g, 'O sistema'],
    [/\bo Balbino\b(?![A-Za-z])/g, 'o sistema'],
    [/\bBalbino\b(?=[\s.,!?:;)'"<])/g, m.nome],
  ];
}

export function aplicarMarca(texto, tipo, m = marcaAtual()) {
  if (!m) return texto;
  let s = texto;
  if (tipo === 'html') {
    s = s.replace(/\/brand\/monograma-rede-balbino-branco\.webp/g, `${m.pasta}/monograma-go-negativo.png`)
      .replace(/href="\/balbino-chat\.ico[^"]*"/g, `href="${m.pasta}/favicon-32.png"`)
      .replace(/href="\/favicon-32x32\.png[^"]*"/g, `href="${m.pasta}/favicon-32.png"`)
      .replace(/href="\/favicon-192x192\.png[^"]*"/g, `href="${m.pasta}/icone-192.png"`)
      .replace(/href="\/apple-touch-icon\.png[^"]*"/g, `href="${m.pasta}/apple-touch-icon.png"`)
      .replace(/<meta name="theme-color" content="[^"]*">/, `<meta name="theme-color" content="${m.corBase}">`)
      .replace(/(class="btn small portal-link"[^>]*>)Portal</g, '$1Início<')
      .replace('</head>', `<link rel="stylesheet" href="${m.pasta}/marca.css?v=1"></head>`);
  }
  for (const [de, para] of trocas(m)) s = s.replace(de, para);
  return s;
}

// Entrega index.html/app.js com a marca aplicada. Retorna true se respondeu.
export function servirComMarca(res, arquivo, publicDir) {
  const m = marcaAtual();
  if (!m) return false;
  const rel = path.relative(publicDir, arquivo).replace(/\\/g, '/');
  const tipo = rel === 'index.html' ? 'html' : rel === 'app.js' ? 'js' : null;
  if (!tipo) return false;
  const corpo = aplicarMarca(fs.readFileSync(arquivo, 'utf8'), tipo, m);
  res.writeHead(200, { 'Content-Type': tipo === 'html' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(corpo);
  return true;
}
