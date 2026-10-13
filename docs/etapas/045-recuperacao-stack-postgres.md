# Etapa 045 — Recuperação do stack de homologação

**Estado:** ensaio local sintético aprovado; recuperação institucional ainda pendente.

`scripts/staging-recovery-drill.py` verifica que o banco contém somente `staging-example`, interrompe Next.js e os três trabalhadores, gera um pacote verificável com `pg_dump` e cópia dos volumes de fotos, gravações e replay, e restaura o pacote em um banco novo e diretórios temporários. Usa `pg_dump` e `pg_restore` do contêiner PostgreSQL 16 para evitar incompatibilidade de versão com ferramentas instaladas no host. O banco ativo não é substituído. O script remove marcadores temporários, elimina o banco restaurado de prova e religa os serviços mesmo diante de falha. O ensaio exige que não exista outro escritor ligado diretamente à porta 55432 durante o snapshot.

`scripts/staging-worker-failure-drill.py` para o realtime, grava um evento sintético pendente, reinicia o serviço e confirma que o evento chega ao estado `published`. Reinicia webhooks e scheduler e consulta a aplicação. O evento de prova é apagado no fim. Isso verifica retomada de um publicador, não entrega externa de webhook ou correio.

```bash
python3 scripts/staging-recovery-drill.py
python3 scripts/staging-worker-failure-drill.py
python3 scripts/staging-smoke.py
```

Na [prova local](045-prova-recuperacao-stack-postgres.json), o pacote teve nove arquivos; tenant, sessão em rascunho e três marcadores de volume foram restaurados e verificados. O snapshot durou 1,854 s e restauração/verificação 2,158 s para esse pequeno conjunto de dados. O realtime publicou o evento após reinício em um ensaio de 8,767 s. Esses números **não são RTO/RPO institucionais**: não há incidente real, volume representativo, trânsito externo ou segundo host.

**Próxima ordem:** exercitar gravação/replay com mídia sintética e restauração dos bytes referenciados pelo banco; depois medir falhas de banco e workers com cargas representativas, observar fila de correio em relay de homologação e fechar o pré-voo institucional. Só então piloto acompanhado. Nextcloud e Alfresco seguem para as últimas fases, após estabilizar a operação do plenário.
