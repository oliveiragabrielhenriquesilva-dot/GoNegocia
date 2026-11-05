// Ponto de entrada da Hostinger. Resolve persistência e migração antes de abrir os bancos.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const base of new Set([process.cwd(), appDir])) {
  const envFile = path.join(base, '.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
}

function raizBuilds(dir) {
  for (let atual = fs.realpathSync(dir); atual !== path.dirname(atual); atual = path.dirname(atual)) {
    if (path.basename(atual) === 'hbuilds') return atual;
  }
  return null;
}

const builds = raizBuilds(appDir) || raizBuilds(process.cwd());
const legadoDir = process.env.GO_NEGOCIA_RUNTIME_DIR || process.env.OLIVELO_RUNTIME_DIR;
const destino = process.env.BALBINO_RUNTIME_DIR || legadoDir ||
  (builds && path.join(path.dirname(builds), 'go-negocia-runtime'));
if (destino) process.env.BALBINO_RUNTIME_DIR = path.resolve(appDir, destino);

function bancoAnterior() {
  const explicito = process.env.GO_NEGOCIA_DB_FILE || process.env.OLIVELO_DB_FILE;
  if (explicito) return fs.realpathSync(path.resolve(appDir, explicito));
  const nomes = ['go-negocia.sqlite', 'olivelo.sqlite'];
  for (const dir of [legadoDir, destino].filter(Boolean)) {
    for (const nome of nomes) {
      const arquivo = path.resolve(appDir, dir, nome);
      if (fs.existsSync(arquivo)) return arquivo;
    }
  }
  if (!builds) return null;
  const versions = path.join(builds, 'versions');
  const dirs = fs.existsSync(versions)
    ? fs.readdirSync(versions, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(versions, e.name, 'nodejs', 'runtime'))
    : [];
  dirs.push(path.join(path.dirname(builds), 'nodejs', 'runtime'));
  const arquivos = dirs.flatMap(dir => nomes.map(nome => path.join(dir, nome)));
  return arquivos.map(arquivo => ({
    arquivo,
    atualizado: Math.max(fs.statSync(arquivo, { throwIfNoEntry: false })?.mtimeMs || 0,
      fs.statSync(arquivo + '-wal', { throwIfNoEntry: false })?.mtimeMs || 0),
  })).filter(x => x.atualizado && fs.existsSync(x.arquivo)).sort((a, b) => b.atualizado - a.atualizado)[0]?.arquivo || null;
}

function migrarSeNecessario() {
  if (!destino || process.env.CENTRAL_BALBINO_EMBEDDED === '1') return;
  const runtime = process.env.BALBINO_RUNTIME_DIR;
  const data = path.join(runtime, 'data');
  if (process.env.BALBINO_DATA_DIR || process.env.BALBINO_COBRANCA_DB) return;
  const pronto = () => ['balbino-chat.sqlite', 'cobranca.sqlite'].every(nome => fs.existsSync(path.join(data, nome)));
  if (pronto()) return;
  const origem = bancoAnterior();
  if (!origem) return;
  fs.mkdirSync(runtime, { recursive: true });
  const lock = path.join(runtime, '.migracao-go.lock');
  try { fs.mkdirSync(lock); }
  catch (erro) {
    if (erro.code !== 'EEXIST') throw erro;
    const espera = new Int32Array(new SharedArrayBuffer(4));
    for (let i = 0; i < 16 && !pronto(); i++) Atomics.wait(espera, 0, 0, 100);
    if (pronto()) return;
    throw new Error('Migração concorrente ainda em andamento. Confira o log antes de reiniciar.');
  }
  try {
    if (!pronto()) execFileSync(process.execPath, [path.join(appDir, 'scripts/migrar-go-negocia.js'), origem, runtime], { stdio: 'inherit' });
  } finally {
    fs.rmdirSync(lock);
  }
}

migrarSeNecessario();
