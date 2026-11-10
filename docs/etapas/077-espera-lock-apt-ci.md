# 077 — espera pelo bloqueio do APT na CI

**Estado em 10/11/2026:** correção em validação.

## Problema e mudança

A primeira CI do `main` após a correção das fontes falhou no job `media-smoke` ao instalar FFmpeg. O log identificou o processo `unattended-upgr` do Ubuntu segurando `/var/lib/dpkg/lock-frontend`; a falha não ocorreu no código de mídia. Os três jobs da CI executam no runner próprio e podem encontrar a atualização automática do sistema.

As três instalações `apt-get` do workflow agora usam `DPkg::Lock::Timeout=300` para aguardar a liberação normal do bloqueio. Não interrompem o processo de atualização nem removem arquivos de lock. O limite de cinco minutos mantém uma falha persistente visível, em vez de esperar indefinidamente.

## Próximo gate

Exigir os três jobs verdes no PR e depois no SHA exato de `main`. A promoção à VPS permanece bloqueada até esse resultado; o domínio continua sendo homologação sintética.
