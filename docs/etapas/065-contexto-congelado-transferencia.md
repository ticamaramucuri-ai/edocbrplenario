# P3/P4 — contexto congelado da revisão para transferência local

**Estado em 09/11/2026:** implementado e ensaiado localmente; [PR #31](https://github.com/e-docBR/edocBRplenario/pull/31) incorporada, CI de `main` [42624250694](https://github.com/e-docBR/edocBRplenario/actions/runs/42624250694) verde e homologação sintética promovida ao SHA `1dc41dc20b79cc93308a429bd60f1e6d954438f9`.

## Objetivo

Um mesmo `revisionId` publicado deve produzir o mesmo manifesto de preparação local após alterações comuns no cadastro da Câmara. Antes desta etapa, matérias e anexos já eram congelados, mas a exportação ainda consultava a composição, as regras deliberativas e `session.version` atuais. O tipo MIME do documento também vinha do cadastro atual sem constar do manifesto histórico.

## Mudança

- A publicação inicial e a emenda de pauta agora gravam `transferContextJson` na mesma transação da revisão: versão da sessão, ID da configuração oficial, composição e regras deliberativas. O contexto é validado pelo contrato v1 e não pode ser congelado duas vezes.
- Para sessão oficial, a composição e as regras vêm da configuração aprovada com hash conferido; para sessão não oficial, vêm do cadastro da Câmara no instante da publicação.
- O manifesto de documentos da revisão inclui `mimeType`. O exportador confere ID, tipo, versão, nome, MIME, tamanho, hash e bytes antes de entregar o pacote.
- A descoberta só marca como pronta uma revisão que possua snapshots de matérias e de contexto. Revisões anteriores sem contexto, ou sem MIME nos documentos, exigem nova publicação; não são preenchidas retroativamente com dados atuais.
- A migração PostgreSQL `0022_session_transfer_context.sql` é aditiva e mantém o campo nulo nas revisões legadas.

## Prova e limite

`typecheck`, `lint`, exportação de pacote e preparação formal passaram localmente. O teste altera parlamentar, política da Câmara e versão da sessão após a publicação e compara o manifesto canônico completo; também comprova rejeição de MIME divergente, contexto ausente, bytes alterados e isolamento entre Câmaras. O ensaio PostgreSQL aplicou 22 migrações, repetiu a aplicação, copiou 83 tabelas e restaurou banco e arquivos em ambiente descartável.

Na VPS, a migração 0022 foi aplicada; app, realtime, webhooks e scheduler ficaram saudáveis. O health público `GET /api/v1/health?ready=1` respondeu 200 com `database: ready` e o SHA promovido. `GET /api/v1/local-preparations` sem identidade respondeu 401. Essas observações comprovam a promoção técnica, não uma sessão institucional nem o funcionamento de um desktop real.

Este passo estabiliza a **preparação**; não concede autoridade local, não confirma voto e não resolve a retomada por artefato. O acervo privado de anexos, o serviço desktop Windows/Linux e a sincronização de atos permanecem nos gates P4–P6. A VPS atual continua sintética; nenhuma revisão institucional legada será completada por suposição.

## Próxima etapa

Implementar armazenamento privado e transferência recuperável de artefatos por hash, com limites de tamanho, cancelamento e limpeza de emissões. Depois, instalar e supervisionar o serviço local nos dois sistemas operacionais e provar LAN/TLS com dispositivos reais.
