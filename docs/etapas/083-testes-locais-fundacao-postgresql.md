# Etapa 083 — Fundação PostgreSQL e serviços

**Fase:** L1/L2, persistência, serviços e jornadas locais  
**Data:** 10/11/2026  
**Ambiente:** Linux, Bun 1.4.2, Docker 29.9.2, imagem `postgres:16-alpine`; banco em contêiner temporário e portas loopback  
**Comando:** `bash scripts/test-postgres-foundation.sh`

## Escopo exercitado

O wrapper cria PostgreSQL descartável, constrói e valida o schema de teste, compara o baseline histórico, aplica/reverte migração, verifica comportamento com schema incompleto e roda provas de migração, backup/cópia/restauração. Ao final, remove o contêiner e diretório temporário e regenera o cliente Prisma configurado para SQLite.

Foram observados 29 testes aprovados e 390 assertions nos grupos executados pelo wrapper:

- health, outbox concorrente, webhook com retry/dead-letter e scheduler;
- assinatura HTTP simulada, integração entre serviços, identidade local, concessão de autoridade e rate limit;
- scheduler PostgreSQL via HTTP em loopback;
- avisos, jornada da sessão, presença, votação simbólica, fechamento/ata, link de mídia pública, telão, fila de e-mail, prontidão e capacidade concorrente.

Também foram observadas evidências de cópia/restauração de 84 tabelas, reconciliação de cinco arquivos e ensaio de transferência com dois tenants, quatro artefatos e 48 MiB de PDFs sintéticos. Esses ensaios não dependem de dados reais de Câmara.

## Observações

Mensagens de conflito/deadlock do Prisma apareceram nos casos de concorrência da concessão de autoridade e do nonce de dispositivo. Os casos terminaram aprovados ao validar a exclusão mútua, a resposta de replay e a retomada; não foram falhas de teste.

O wrapper concluiu suas provas e a limpeza: não restou contêiner `edocbr-pg-foundation`; `prisma/schema.prisma` permaneceu no provider SQLite. Nenhum SMTP ou endpoint externo foi contatado.

## Limites e saída

Este resultado comprova os caminhos cobertos pelos testes do wrapper, não todas as funções do sistema. Permanecem pendentes migração operacional do produto com dados representativos, jornadas completas de telas, comandos no executor desktop/LAN, Windows, SMTP real controlado e integrações institucionais. Próximo passo: auditar funções com lacunas altas no mapa (matérias/tramitação, permissões/MFA e migração/recuperação), depois expandir cobertura por interface.
