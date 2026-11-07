# 045 — Observador público externo

**Estado em 07/11/2026:** workflow publicado na branch padrão e primeira execução externa concluída com sucesso; agendamento de 15 minutos ativo.

## Objetivo

Observar a instalação de staging a partir de uma máquina fora da VPS e detectar falhas públicas de HTTPS, prontidão do banco, cabeçalho `noindex` e redirecionamento de `www`.

## Implementação

O workflow [`staging-observer.yml`](../../.github/workflows/staging-observer.yml) executa a cada 15 minutos e também pode ser iniciado manualmente. Não usa credenciais nem consulta dados de tenant. A execução valida:

- `https://edocbrplenario.com.br/` com resposta HTTP 200 e `X-Robots-Tag` contendo `noindex`;
- `/api/v1/health?ready=1` com `ok=true`, `database=ready` e versão no formato de SHA Git;
- `https://www.edocbrplenario.com.br/` redirecionando para o domínio principal.

Uma falha encerra o job com erro e deixa o registro no histórico de Actions. O observador comprova o caminho público e o estado do banco reportado pelo app; não mede Redis, realtime, webhooks, scheduler, SMTP, desempenho prolongado, nem cria por si só um canal de alerta operacional.

## Evidência inicial

Na promoção de 06/11/2026, a partir do ambiente de desenvolvimento:

- Homepage: HTTP 200;
- prontidão: HTTP 200, `ok=true`, `database=ready`;
- versão respondida: `ceb885856cf160735dcb86401e5a0585279744b9`;
- `X-Robots-Tag: noindex, nofollow, noarchive`;
- CI do SHA: sucesso nos três jobs (`application`, `postgres-foundation`, `media-smoke`);
- VPS: checkout no mesmo SHA; app, realtime, webhooks e scheduler saudáveis.

Essas verificações confirmam a promoção daquele commit, mas foram feitas no mesmo fluxo operacional. A prova de monitoramento independente começará quando o workflow estiver na branch padrão e tiver ao menos uma execução concluída no histórico do GitHub.

Primeira execução independente, via workflow manual, em 07/11/2026:

- Run do GitHub Actions: [42390489098](https://github.com/e-docBR/edocBRplenario/actions/runs/42390489098), commit de configuração `b180afa4dda07614df01d1c13184273fe51590d1`;
- resultado: sucesso em 4 segundos no runner hospedado pelo GitHub;
- versão da aplicação observada: `ceb885856cf160735dcb86401e5a0585279744b9`;
- HTTPS, banco pronto, `noindex` e redirecionamento de `www`: todos aprovados.

O agendamento periódico está instalado; a primeira passagem manual valida o workflow e o caminho externo, mas ainda não constitui histórico de disponibilidade nem prova de alertas.

## Próxima ação e limites

1. Acompanhar execuções agendadas e definir destino para alertas de falha sem expor credenciais.
2. Instalar ou escolher um coletor para a sonda autenticada de `platform_monitor`, em máquina independente, para verificar os cinco serviços internos sem abrir suas portas.
3. Executar backup PostgreSQL + arquivos de sessão e fazer restauração limpa fora do volume ativo; medir RPO/RTO.

O domínio continua sendo ambiente de staging sintético, marcado `noindex`. O workflow não configura produção nem constitui aceite institucional.
