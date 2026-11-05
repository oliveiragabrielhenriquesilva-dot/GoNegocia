# GO Negocia v0.3.0

Atendimento do Balbino Chat com cobrança escolar incorporada. A página inicial está em `/` e o painel em `/app`.

## Rodar e testar

Use Node.js 24. Na raiz do repositório, rode `npm ci`, `npm test` e `npm start`.
A carga `npm run seed:cobranca` é exclusiva de um runtime de teste vazio. Os exemplos são gerados em memória.

## Hostinger

Configure app Node.js 24 na raiz, com entrada `server.js`, inicialização `npm start` e implantação GitHub na branch autorizada para o ambiente.
A Hostinger define `PORT`. Use `HOST=0.0.0.0`, `HOSTED=1`, `COOKIE_SECURE=true` em HTTPS, `APP_MARCA=go-negocia` e `GO_NEGOCIA_ENVIO_REAL=0` para homologação.
O login e a senha existentes em `GO_NEGOCIA_ADMIN_LOGIN` e `GO_NEGOCIA_ADMIN_SENHA` também são aceitos para inicialização de um banco vazio.
Use `BALBINO_RUNTIME_DIR` para uma pasta privada persistente, fora dos diretórios de publicação. A variável `GO_NEGOCIA_RUNTIME_DIR` serve de alias quando a nova não estiver definida.
A integração ativa deste pacote usa WhatsApp Web. A configuração de WhatsApp Cloud API da versão 0.2.1 exige integração específica antes de migrar uma operação oficial ativa.

## Migração da v0.2.1

Confirme o arquivo SQLite usado pelo site atual. Faça uma cópia consistente com SQLite Backup API ou pare a aplicação antes de copiar o banco e seus arquivos WAL/SHM associados. Guarde o original. Use uma **nova** pasta de runtime persistente e execute:

```bash
npm run migrar:go -- /caminho/snapshot/go-negocia.sqlite /caminho/runtime-integrado
```

O destino deve estar vazio. O migrador cria `data/balbino-chat.sqlite` e `data/cobranca.sqlite` em uma pasta temporária e só publica os dois bancos no destino após a validação. O snapshot de origem é aberto apenas para leitura. Conexões oficiais ativas bloqueiam o procedimento para evitar perda de canal. Usuários mantêm os hashes da senha, e sessões antigas exigem um novo login. Conexões de teste, conversas, histórico, títulos, lotes e acessos são importados.

No ambiente novo, aponte `BALBINO_RUNTIME_DIR` para o destino. Confira `/healthz`, login, instituições, saldos, histórico e separação de escolas antes de promover. O retorno consiste em restaurar o commit anterior e a configuração original de runtime, preservados na migração.

Mais detalhes sobre a implementação de origem em [COBRANCA-GO-NEGOCIA.md](COBRANCA-GO-NEGOCIA.md).
