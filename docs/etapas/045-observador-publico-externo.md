# 045 — Observador público externo

**Estado em 07/11/2026:** observador público e sonda autenticada dos quatro serviços base aprovados em runner externo; agendamento de 15 minutos ativo. Canal de notificação operacional ainda pendente.

## Objetivo

Observar a instalação de staging a partir de uma máquina fora da VPS e detectar falhas públicas de HTTPS, prontidão do banco, cabeçalho `noindex` e redirecionamento de `www`, além da saúde dos workers relatada pelo app a uma conta restrita de plataforma.

## Implementação

O workflow [`staging-observer.yml`](../../.github/workflows/staging-observer.yml) executa a cada 15 minutos e também pode ser iniciado manualmente. A primeira etapa não usa credenciais nem consulta dados de tenant. A execução valida:

- `https://edocbrplenario.com.br/` com resposta HTTP 200 e `X-Robots-Tag` contendo `noindex`;
- `/api/v1/health?ready=1` com `ok=true`, `database=ready` e versão no formato de SHA Git;
- `https://www.edocbrplenario.com.br/` redirecionando para o domínio principal.

A segunda etapa usa a conta sintética `platform_monitor` com senha armazenada como segredo `STAGING_MONITOR_PASSWORD` no GitHub Actions. `staging-remote-check.py` consulta `platform/system-status` pelo HTTPS público e exige `app,realtime,webhooks,scheduler` saudáveis na mesma versão Git da aplicação. As portas privadas não são publicadas. O workflow tem apenas `contents: read` para baixar o script do repositório privado. O User-Agent fixo evita a recusa 1010 da Cloudflare observada com o padrão do `urllib`.

Uma falha encerra o job com erro e deixa o registro no histórico de Actions. Isso ainda não configura envio garantido a um responsável. Redis é verificado indiretamente pela saúde do realtime; `mail` não está configurado na VPS e não entra nesta passagem. O observador não mede desempenho prolongado nem substitui a restauração ou o monitor de infraestrutura.

## Evidência inicial

Na promoção de 06/11/2026, a partir do ambiente de desenvolvimento:

- Homepage: HTTP 200;
- prontidão: HTTP 200, `ok=true`, `database=ready`;
- versão respondida: `ceb885856cf160735dcb86401e5a0585279744b9`;
- `X-Robots-Tag: noindex, nofollow, noarchive`;
- CI do SHA: sucesso nos três jobs (`application`, `postgres-foundation`, `media-smoke`);
- VPS: checkout no mesmo SHA; app, realtime, webhooks e scheduler saudáveis.

Essas verificações iniciais confirmaram a promoção do commit `ceb8858` no mesmo fluxo operacional.

Primeira execução independente, via workflow manual, em 07/11/2026:

- Run do GitHub Actions: [42390489098](https://github.com/e-docBR/edocBRplenario/actions/runs/42390489098), commit de configuração `b180afa4dda07614df01d1c13184273fe51590d1`;
- resultado: sucesso em 4 segundos no runner hospedado pelo GitHub;
- versão da aplicação observada: `ceb885856cf160735dcb86401e5a0585279744b9`;
- HTTPS, banco pronto, `noindex` e redirecionamento de `www`: todos aprovados.

O agendamento periódico está instalado; a primeira passagem manual valida o workflow e o caminho externo, mas ainda não constitui histórico de disponibilidade nem prova de alertas.

Após a promoção da versão `9ae0e774515a1e1c42bc53f3ab85318cf27d5d5b` e o ensaio de restauração, a segunda execução externa manual [42394264032](https://github.com/e-docBR/edocBRplenario/actions/runs/42394264032) também passou. O runner confirmou a versão `9ae0e77`, HTTPS, banco pronto, `noindex` e redirecionamento para o domínio principal.

## Sonda autenticada externa e falha controlada

Em 07/11/2026, a sonda autenticada rodou deste computador contra `https://edocbrplenario.com.br` e retornou saída 0, `remoto: true`: app, realtime, webhooks e scheduler saudáveis, todos na versão `b8d137e304c1305782d91bc23880f6fb6c86e0af`. A primeira execução do novo workflow falhou no checkout do repositório privado porque `permissions: {}` não dava leitura ao token. Ajustei para `contents: read`; o [runner da branch](https://github.com/e-docBR/edocBRplenario/actions/runs/42398866739) passou com os quatro serviços e mesma versão. Após CI verde e merge do PR [#9](https://github.com/e-docBR/edocBRplenario/pull/9), o [runner no `main`](https://github.com/e-docBR/edocBRplenario/actions/runs/42399353559) também passou.

Em ensaio controlado na VPS **somente sintética**, parei `webhooks`, consultei a sonda de fora e religuei o serviço em bloco de limpeza. Ela passou de saída 0 a **1**, relatando `webhooks` doente, e voltou a **0** após o reinício. O app continuou acessível. Essa prova valida detecção e recuperação do worker na sonda, mas não mede tempo de entrega de aviso a pessoas. A [evidência estruturada](045-prova-observador-autenticado.json) registra os resultados sem credenciais.

## Próxima ação e limites

1. Acompanhar histórico agendado e definir canal e responsável por alertas de falha sem expor credenciais.
2. Incluir `mail` na sonda apenas quando o transporte institucional for configurado e homologado; preservar teste de falha/recuperação.
3. Fazer backup recorrente cifrado em destino durável fora da VPS, restaurar também a aplicação em host limpo e medir RPO/RTO acordados.

O domínio continua sendo ambiente de staging sintético, marcado `noindex`. O workflow não configura produção nem constitui aceite institucional.
