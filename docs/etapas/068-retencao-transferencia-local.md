# P4 — retenção de emissões e cache de transferência

**Estado em 09/11/2026:** implementado e ensaiado localmente com dados fictícios. PR, CI e promoção à staging serão registrados após a revisão. P4/P5 permanecem abertos.

## Entrega

O agendador passa a executar `transfer.issue_cleanup` a cada hora. Ele remove no máximo 500 emissões de pacote **sem ACK** por execução, somente quando `issuedAt` tem mais de 30 dias. Emissões confirmadas permanecem como evidência de importação; uma emissão recente continua disponível para retomada. O job é criado de forma idempotente na inicialização do agendador PostgreSQL e no seed de demonstração. A migração `0024_transfer_issue_retention.sql` cria apenas o índice de busca, sem inserir dados de operação na migração, preservando a cópia e restauração de banco vazio.

No desktop, cada tentativa de transferência validada mantém o cache do manifesto atual e até dois caches interrompidos de revisões recentes. Outros caches de manifesto são removidos; os com mais de sete dias são removidos mesmo quando há menos de dois. A limpeza atua só na Câmara e sessão correspondentes. O cache jamais torna a revisão preparada: todos os bytes ainda precisam passar por assinatura, tamanho e SHA-256 e pela importação integral antes do ACK.

## Prova e limites

O teste PostgreSQL cobre criação idempotente do job e preservação de emissão confirmada ou recente enquanto remove uma antiga sem ACK. O teste de cache cobre manifesto atual, dois recentes, um antigo, excesso de revisões e isolamento entre Câmaras. `bash scripts/test-postgres-foundation.sh` passou com 24 migrações, scheduler PostgreSQL, backup/restauração e 83 tabelas; o teste de cache local passou. **CI, build e staging:** pendentes nesta redação inicial.

O período de 30 dias e o limite de dois caches são políticas técnicas provisórias para a staging sintética. Antes do piloto, operação e Câmara devem aprovar retenção, espaço em disco, custódia e procedimento de recuperação. Uma transferência retomada após limpeza obtém nova emissão e pode precisar baixar bytes novamente; um ACK nunca é inferido do cache. Ainda faltam medição de carga/volume, quota por Câmara e ensaio Windows/Linux em computadores separados.

## Próxima prova

Medir sessões com documentos representativos e duas Câmaras concorrentes, otimizar a leitura de artefatos sem reconstruir o pacote inteiro a cada GET e estabelecer quotas. Depois, implementar serviço local supervisionado e API LAN protegida em P5/P10.
