# Etapa 013 — Convocação pública por Câmara

**Data:** 11/10/2026 · **Estado:** concluída localmente para emissão e consulta verificável da convocação; entrega externa aos destinatários ainda pendente.

## Entrega

Cada Câmara configura a antecedência mínima da **primeira** convocação em horas, de 0 a 720. O padrão 0 preserva instalações existentes, mas a sessão ainda precisa estar no futuro. A regra é validada no servidor ao agendar e publicar a pauta, com escopo do tenant. Mudanças posteriores da configuração não reescrevem a política aplicada ao ato.

Ao publicar a pauta e ao confirmar cada emenda, a transação salva um conteúdo de convocação com identidade da Câmara, número/tipo/data/local/mesa da sessão, revisão da pauta, política, horário de emissão e justificativa da retificação. O SHA-256 é calculado sobre esse JSON e armazenado na revisão, auditoria e evento de atualização. `GET /api/v1/public/sessions/:id/notices?tenant=slug&revision=n` devolve conteúdo e hash para conferência; o portal apresenta o link e o identificador da revisão atual. O histórico interno devolve o mesmo conteúdo. Revisões anteriores à etapa permanecem sem comprovante retrospectivo.

O fluxo de transição da sessão passou a usar comparação de versão na atualização transacional, fechando a janela de publicação concorrente. A sessão demonstrativa publicada ganhou convocação sintética coerente com seu seed; dados institucionais de Mucuri não foram inventados.

Arquivos principais: [configuração](../../src/modules/settings/index.tsx), [política](../../src/lib/server/domain.ts), [emissão](../../src/lib/server/session-notice.ts), [publicação](../../src/app/api/v1/sessions/[id]/transition/route.ts), [retificação](../../src/app/api/v1/sessions/[id]/agenda-amendments/route.ts), [consulta pública](../../src/app/api/v1/public/sessions/[id]/notices/route.ts), [migração](../../prisma/sql/013-session-notices.sql) e [testes](../../tests/session-notice.test.ts).

## Verificação

- Migração ensaiada em cópia: SQLite `integrity_check=ok`, nenhuma FK inválida e `prisma migrate diff` sem diferença. Base local respaldada em `db/custom.db.backup.session-notices-20261011` antes da aplicação.
- `bun run test:session:preparation`: publicação, emenda, isolamento multi-Câmara, antecedência e hash verificável em banco descartável.
- Seed demonstrativo, `bun run typecheck`, `bun run lint` e `bun run build` integram a conferência final da etapa.

## Limites e próxima etapa

O SHA-256 prova que o JSON retornado corresponde ao registrado pelo sistema, **não** constitui assinatura digital qualificada nem carimbo de tempo independente. Quem administra o banco ainda pode substituir conteúdo e hash; custódia externa e assinatura são etapas futuras. O portal publica o comprovante, mas a entrega individual e o aceite de recebimento por vereadores/secretaria ainda não estão implementados. A antecedência mínima aplica-se à publicação inicial; prazos de retificação e exceções de urgência devem ser configurados por Câmara após validação do regimento. Sessões legadas sem revisão/convocação não recebem prova artificial.

**Próxima fase:** destinatários e comprovantes de ciência, calendário de envio, regras de retificação e exceção por tipo de sessão; depois motor regimental de quórum/maioria. Integrações Nextcloud/Alfresco continuam reservadas ao final do desenvolvimento.
