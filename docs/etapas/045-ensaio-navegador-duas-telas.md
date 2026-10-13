# Etapa 045 — Telão em navegadores, dois nós e reconexão

**Data:** 13/10/2026 · **Estado:** ensaio sintético local concluído; homologação no plenário pendente.

## Entrega

O roteiro reproduzível `bun run test:staging:display-browser` usa a stack PostgreSQL persistente de homologação e o tenant exclusivo `staging-example`. Ele recusa outra base ou uma sessão em andamento. Cria duas sessões fictícias temporárias, autentica um operador sintético e abre duas telas Chromium independentes: uma com WebSocket no nó principal e outra no segundo nó Redis Streams. Um terceiro navegador entra depois do congelamento, sem cache local. O roteiro encerra o nó adicional e remove as sessões de prova ao terminar.

O ensaio confirma que as duas telas exibem a sessão, recebem o comando de congelar e preservam a presidência originalmente capturada após uma alteração no banco. A tela tardia reconstrói o quadro salvo no servidor. Uma tela perde a rede, reconecta e reinicia sem mostrar a alteração posterior. Quando a sessão selecionada muda, as três telas deixam de exibir o quadro antigo e o aviso de congelamento. A rota pública de quadro verificável e os testes de estado da etapa anterior continuam cobrindo versão, SHA-256 e isolamento entre Câmaras.

## Evidência em 13/10/2026

- `python3 scripts/staging-postgres.py stack-up`: migrações 0014 e 0015 aplicadas na base sintética, imagem atual recompilada e serviços iniciados.
- `bun run test:staging:display-browser`: **3 telas, 2 nós, quadro preservado após mutação, reconexão, entrada tardia e troca de sessão aprovados**.
- `bun scripts/staging-realtime-fanout.ts`: quatro assinantes nos dois nós receberam o evento correto; a outbox aguardou a volta do Redis e então publicou.
- `python3 scripts/staging-smoke.py`: login sintético, sessão rascunho e isolamento da listagem pública aprovados.

O teste usa Chromium headless no mesmo host, rede local e dados fictícios. Os dois navegadores iniciam WebSockets em portas distintas; a prova de fanout valida as assinaturas e a entrega em ambos os nós separadamente. Não equivale a duas TVs físicas, links de rede independentes ou público externo.

## Reprodução e próximo passo

Preparar a stack com `python3 scripts/staging-postgres.py stack-up` e executar `bun run test:staging:display-browser`. O Chromium local é procurado em `/usr/bin/chromium`; outro caminho pode ser passado em `CHROMIUM_PATH`. O roteiro não usa a base SQLite de desenvolvimento nem qualquer Câmara cadastrada nela.

Prosseguir com teste em dois equipamentos reais e observador fora do host. Medir atraso de atualização e recuperação com perda de rede no plenário, carga simultânea de votação/transmissão e sessão de duração representativa. Registrar aceite institucional antes de publicar dados oficiais. Nextcloud e Alfresco continuam reservados para as fases finais.
