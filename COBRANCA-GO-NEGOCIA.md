# Cobrança escolar (GO Negocia) dentro do atendimento

Branch `balbino/cobranca-go` · data 05/11/2026.

## Base usada (o que foi efetivamente examinado)

| Código | O que pedi | O que estava disponível | Usado |
|---|---|---|---|
| Atendimento (anfitrião) | `Redebalbino` `main`, `apps/chat` | GitHub não conectado nesta sessão. Zip `Rede_Balbino_Chat_v0.15.0_GitHub_3modos.zip` (só `apps/chat` + `package-lock.json`) | commit local `e2c4bf6` = zip v0.15.0 |
| Regras financeiras | `GoNegocia` `main`, v0.2.1 | v0.2.1 não recebida. GO Negocia v0.2.0 feita nesta conversa | commit local `a9e0ac1` (v0.2.0) |

**Divergências possíveis:** se a `main` do Redebalbino tiver mudado `server.js`, `store.js` ou `app.js` depois da v0.15.0,
os pontos de integração (lista abaixo) precisam ser reaplicados; se a v0.2.1 mudou regras em `src/`, comparar com `src/cobranca/`.

## Onde fica cada coisa

| Parte | Quem é responsável | Arquivo |
|---|---|---|
| Contatos, conversas, mensagens, filas, triagem, assumir/transferir/finalizar, Pendências | Atendimento original (sem mudança de regra) | `src/store.js`, `server.js`, `src/automation-engine.js` |
| Escolas, unidades, acessos, carteira, lotes, títulos, casos, contatos de cobrança | Cobrança — banco próprio `data/cobranca.sqlite` | `src/cobranca/*.js` |
| **Vínculo escola ↔ conexão** | tabela `conexoes` (`instance_id` → `organizacao_id`, modo TESTE/REAL) | `src/cobranca/admin.js` |
| **Vínculo conversa ↔ caso** | tabela `vinculos_conversa` (conexão + contato + escola → caso, verificada_em) | `src/cobranca/integracao.js` |
| Pendência ↔ caso/títulos | tabela `pendencias_cobranca` (id da pendência do atendimento) | `src/cobranca/integracao.js` |
| Módulos por usuário (Mensagens / Cobrança) | tabela `modulos_usuario` | `src/cobranca/migracao-002.js`, `rotas.js`, `server.js` |
| Marca por ambiente (GO Negocia) | `APP_MARCA=go-negocia` | `src/marca.js`, `public/home.html`, `public/marca/go-negocia/` |

### Portado da GO Negocia v0.2.0
`util.js`, `planilha.js` (CSV/XLSX), `importacao.js` (prévia, lotes, reimportação), `escopo.js` (escola/unidade/permissão),
`carteira.js` (carteira, caso, trava, contatos, fila), regras do contato ativo e da confirmação de identidade.
Adaptações: usuários são os do atendimento (`ponte.js`), sem tabelas de usuários/sessões/conversas próprias.

### Pontos de integração no código existente (todos marcados com "Cobrança")
- `server.js`: imports; abertura do banco da cobrança e `registrarPonte`; listener de `message.received` (receptivo → caso);
  rota `/api/cobranca/*`; bloqueio de módulos; bloqueio de valores antes da confirmação no envio; envio `SIMULATED` em conexão de teste;
  home/`/app` e marca em `serveFile`; textos de erro com `nomeProduto()`.
- `src/providers/whatsapp-web.js` e `src/automation-engine.js`: rodapé padrão dos botões usa `nomeProduto()`.
- `public/app.js`: rótulos `SIMULATED`/`NOT_SENT`; `loadPage` chama páginas `cob*`; ficha do contato chama o painel; ponte `window.BalbinoApp`.
- `public/index.html`: grupo de menu "Cobrança" e seções `cob*`; `cobranca.css`/`cobranca.js`.

## Regras de isolamento
- A escola de uma conversa vem **da conexão** (`conexoes`) ou de **associação manual explícita** (conexão sem escola). Nunca do telefone.
- O contato do atendimento continua único por telefone (como já era); a cobrança separa por conexão + contato + escola.
- Títulos, saldo e alunos só aparecem no painel depois de **confirmar a identidade** (matrícula de aluno vinculado).
- Toda rota da cobrança passa por: sessão do atendimento → módulo Cobrança liberado → acesso à escola → unidade → permissão.
  O painel da conversa também exige a permissão original de ver a conversa.
- Mensagem com valor/débito numa conversa de cobrança ainda não confirmada é recusada pelo servidor (409).
- Conexão marcada TESTE: nada é enviado e nada fica `QUEUED` (o atendimento reenviaria `QUEUED` ao reconectar).
- Pendências criadas pela cobrança não levam valores no título/descrição (o quadro de Pendências segue as regras de visibilidade do atendimento).
  Concluir a pendência **não** libera nem quita títulos; liberar é ação do supervisor da escola.

## Módulos por usuário
Cobrança › Escolas e acessos › **Módulos por usuário**: Mensagens e/ou Cobrança. Sem linha, os dois ficam liberados (comportamento atual).
- Sem Mensagens: servidor recusa `/api/conversations`, `/api/contacts`, `/api/events`, `/api/pendencias` etc.; contato ativo bloqueado.
- Sem Cobrança: servidor recusa todo `/api/cobranca/*` (exceto `/eu`, que volta vazio); painel Cobrança some.
- O administrador geral sempre tem os dois.

## Marca e home
- `APP_MARCA=go-negocia`: `/` = home de apresentação; `/app` = sistema; nenhum "Balbino" visível (textos trocados na entrega de
  `index.html`/`app.js`; identificadores técnicos `BALBINO_*`, cookie e pastas não mudam).
- Sem `APP_MARCA` (produção atual): nada muda, `/` continua sendo o sistema e `/home.html` não é servida.
- Com `CENTRAL_BALBINO_EMBEDDED=1` (embutido no portal), `/` continua sendo o sistema.

## Rodar localmente (ambiente de TESTE)
```bash
cd apps/chat
BALBINO_RUNTIME_DIR=./runtime-teste npm run seed:cobranca          # pasta nova; recusa pasta com conversas
APP_MARCA=go-negocia BALBINO_RUNTIME_DIR=./runtime-teste PORT=3001 COOKIE_SECURE=false npm start
# http://localhost:3001 (home)  ·  http://localhost:3001/app (sistema)
```
Usuários (senha `balbino-demo-2026`): `admin`, `supervisora`, `atendente.horizonte`, `atendente.centro` (só Unidade Centro), `atendente.valeverde`.
Conexões `hz-teste` e `vv-teste` (modo TESTE, nunca conectadas). Para simular resposta: Cobrança › Fila › "Ambiente de teste".

## Migrações e restauração
- `data/cobranca.sqlite` é criado e migrado na inicialização (`001_cobranca_base`, `002_modulos_usuario`). O banco principal
  (`balbino-chat.sqlite`) não recebe tabelas novas (verificado no teste).
- **Restaurar o estado anterior:** pare o servidor, volte o código para `e2c4bf6` e remova/arquive `data/cobranca.sqlite`.
  Dados de atendimento não são alterados pela cobrança, exceto: contatos/conversas/mensagens criados por contato ativo ou simulação
  (como qualquer conversa) e pendências criadas pela cobrança (ficam no quadro de Pendências).
- Reverter só a última migração: `db.reverterUltima()` em `src/cobranca/db.js` (copie o arquivo antes).

## Testes
`npm run test:cobranca` — 11 testes contra o servidor real (processo `server.js`) em pasta temporária:
home separada e sem nome anterior · cadastro de escola e importação com reimportação sem duplicidade · fluxo
mensagem → painel sem títulos → confirmação → títulos · mesmo telefone em duas escolas · acesso cruzado (escola, unidade, permissão
do atendimento, supervisor do atendimento sem acesso à escola) · atendimento original preservado (triagem, assumir, responder,
finalizar) · contato ativo pela conexão certa e resposta no mesmo caso · pendência pausa título e concluir não libera ·
migração reversível · marca por ambiente · módulos por usuário.

## Executado × depende de validação
- **Executado aqui:** testes acima (Node 22.23; o `package.json` pede Node 24) e roteiro no navegador com capturas.
- **Depende de validação:** a `main` atual do Redebalbino e a v0.2.1 da GO Negocia; envio real por WhatsApp (QR) com
  `modo_envio=REAL` e `BALBINO_COBRANCA_ENVIO_REAL=1`; o `server.js`/portal da raiz (não enviados); a API oficial da Meta
  (o atendimento v0.15.0 não tem mais; a GO Negocia v0.2.0 tinha); acordos, retorno de pagamento, baixas e relatórios (próximas etapas).
