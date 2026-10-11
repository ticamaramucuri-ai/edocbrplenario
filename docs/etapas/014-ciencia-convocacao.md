# Etapa 014 — Ciência da convocação

**Data:** 11/10/2026 · **Estado:** concluída localmente para o registro interno de ciência; entrega externa e efeitos jurídicos dependem de homologação institucional.

## Objetivo e entrega

Ao publicar a pauta ou confirmar uma emenda, a mesma transação congela os parlamentares **ativos daquela Câmara** como destinatários da revisão e associa cada linha ao SHA-256 da convocação. Uma retificação cria nova lista: a ciência anterior não passa automaticamente para a nova revisão. O nome é copiado para preservar o retrato da emissão; o vínculo ao usuário exige `parliamentarianId` ativo na Câmara. Parlamentares sem conta aparecem pendentes no acompanhamento.

O App do Parlamentar mostra a revisão vigente, o link para ler a convocação completa e o hash. A confirmação exige o número da revisão e o hash vistos pelo cliente; o servidor revalida a revisão vigente e registra horário, ator e auditoria encadeada. Repetir a confirmação é idempotente. A Mesa vê total, confirmados e pendentes, apenas em sua Câmara.

Arquivos: [modelo](../../prisma/schema.prisma), [migração](../../prisma/sql/014-session-notice-recipients.sql), [emissão](../../src/lib/server/session-notice-recipients.ts), [API de ciência](../../src/app/api/v1/me/notices/route.ts), [API da Mesa](../../src/app/api/v1/sessions/[id]/notice-recipients/route.ts), [App do Parlamentar](../../src/modules/pwa/index.tsx), [painel da pauta](../../src/modules/sessions/agenda-panel.tsx) e [teste](../../tests/session-notice-ack.test.ts).

## Decisões e limites

O registro é de **ciência declarada dentro do sistema**. Ele não demonstra entrega por e-mail, WhatsApp ou outro canal; não é voto, assinatura digital qualificada ou ciência regimental automaticamente válida. Nesta etapa o universo de destinatários usava `active=true`; a [etapa 018](018-destinatarios-mandato-licenca.md) acrescentou política opcional de mandato, afastamento e suplência por Câmara. Revisões anteriores não são recalculadas. Revisões anteriores à migração não são preenchidas retrospectivamente. A interface de ciência cobre a sessão-alvo do PWA; o histórico completo segue disponível no banco e na auditoria.

## Verificação

`bun run test:session:preparation` passou, cobrindo publicação, emenda, isolamento multi-Câmara, hash, idempotência e ciência nova após retificação. `bun run typecheck`, `bun run lint` e `bun run build` passaram. Migração ensaiada em cópia com `integrity_check=ok`, sem chaves estrangeiras inválidas e sem diferença no schema Prisma. A base local recebeu a migração após backup `db/custom.db.backup.notice-recipients-20261011`, com os mesmos resultados.

## Próxima etapa

Definir por Câmara, com regimento homologado, os destinatários elegíveis, prazo para retificação e exceções de urgência por tipo de sessão. Implementar calendário de vencimentos e comprovação de envio por canal quando o meio de entrega for escolhido. Depois, aprofundar regras de quórum e maioria. Integrações com Nextcloud e Alfresco permanecem no fim do projeto.
