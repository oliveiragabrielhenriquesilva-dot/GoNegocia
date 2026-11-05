// Entrada do app. A hospedagem pode executar ou carregar este arquivo.
import { iniciar } from './app.js';
import { config, VERSAO, NOME_PRODUTO } from './src/config.js';

iniciar().then(servidor => {
  const endereco = servidor.address();
  const local = typeof endereco === 'string' ? endereco : `${endereco.address}:${endereco.port}`;
  console.log(`${NOME_PRODUTO} ${VERSAO} em ${local} — envio real: ${config().envioReal ? 'LIGADO' : 'desligado'}`);
}).catch(erro => {
  console.error('[go-negocia] Falha ao inicializar o servidor:', erro);
  process.exitCode = 1;
});
