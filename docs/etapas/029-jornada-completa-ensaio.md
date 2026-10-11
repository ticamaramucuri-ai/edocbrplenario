# Etapa 029 — Ensaio de jornada legislativa com duas Câmaras

**Data:** 11/10/2026 · **Estado:** concluída localmente para cenário fictício; homologação regimental pendente.

Um teste integrado percorre criação do rascunho, publicação da pauta e da convocação verificável, credenciamento, presença, abertura, fala, votação nominal, voto repetido com o mesmo comando, apuração, anulação justificada, nova votação simbólica, ata e encerramento. Duas Câmaras fictícias coexistem no mesmo banco descartável; a segunda não altera nem lê sessão ou convocação da primeira. A primeira mantém deliberação e apuração enquanto o status de mídia acusa `signal_lost`. Comandos de fechamento repetidos com versão antiga recebem conflito e não duplicam atos.

**Execução:** `bun run test:session:journey` cria um banco temporário e executa `tests/session-journey.test.ts`; a CI inclui o comando. Resultado local: 1 teste, 39 verificações; `bun run typecheck` e `bun run lint` passaram. O teste não altera o banco da Câmara de Mucuri e não usa credenciais sociais.

**Limites:** o ensaio usa uma presidência presente, quórum mínimo fictício de um, um voto nominal e uma contagem simbólica. A falha da mídia é simulada pela resposta de métricas do MediaMTX; os testes físicos de RTMP/RTMPS estão na etapa 027. Concorrência de múltiplos clientes reais, reconexão SSE em rede degradada e aprovação do regimento dependem de homologação adicional. O código de verificação e a ata são gerados por dados persistidos, mas este ensaio não equivale a aprovação oficial da ata.

**Próxima fase:** base operacional PostgreSQL, migrações verificáveis, backup/restauração e isolamento SaaS sob implantação de homologação.
