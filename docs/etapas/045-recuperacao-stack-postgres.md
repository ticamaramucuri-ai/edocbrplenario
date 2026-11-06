# Etapa 045 — Recuperação do stack de homologação

**Estado:** ensaio local sintético aprovado; recuperação institucional ainda pendente.

`scripts/staging-recovery-drill.py` verifica que o banco contém somente `staging-example`, interrompe Next.js e os três trabalhadores, gera um pacote verificável com `pg_dump` e cópia dos volumes de fotos, gravações e replay, e restaura o pacote em um banco novo e diretórios temporários. Usa `pg_dump` e `pg_restore` do contêiner PostgreSQL 16 para evitar incompatibilidade de versão com ferramentas instaladas no host. O banco ativo não é substituído. O script remove marcadores temporários, elimina o banco restaurado de prova e religa os serviços mesmo diante de falha. O ensaio exige que não exista outro escritor ligado diretamente à porta 55432 durante o snapshot.

Após conferir hashes do banco e dos arquivos, o roteiro sobe uma **segunda
instância temporária** do app ligada apenas ao banco restaurado e com os três
diretórios de mídia montados em modo de leitura. Confere bootstrap da Câmara
sintética, login do administrador de ensaio e listagem autenticada das sessões.
Mede o tempo entre iniciar esse contêiner e o primeiro bootstrap 200. Remove o
contêiner antes de eliminar o banco de prova; a instância ativa não é apontada
para o restore.

`scripts/staging-worker-failure-drill.py` para o realtime, grava um evento sintético pendente, reinicia o serviço e confirma que o evento chega ao estado `published`. Reinicia webhooks e scheduler e consulta a aplicação. O evento de prova é apagado no fim. Isso verifica retomada de um publicador, não entrega externa de webhook ou correio.

```bash
python3 scripts/staging-recovery-drill.py
python3 scripts/staging-worker-failure-drill.py
python3 scripts/staging-smoke.py
```

Na [prova local inicial](045-prova-recuperacao-stack-postgres.json), o pacote teve nove arquivos; tenant, sessão em rascunho e três marcadores de volume foram restaurados e verificados. O snapshot durou 1,854 s e restauração/verificação 2,158 s para esse pequeno conjunto de dados. O realtime publicou o evento após reinício em um ensaio de 8,767 s.

Em 04/11/2026, a [prova reproduzível com `--require-media`](045-prova-recuperacao-app-restaurado.json)
produziu pacote de 12 arquivos, conferiu uma gravação, dois segmentos e o
replay, abriu a segunda instância em **1,494 s** até o bootstrap e leu **52
sessões** após login. Snapshot: **1,129 s**; restauração e verificação,
incluindo a leitura pelo app: **4,246 s**. O teste do pacote também recusa
um manifesto com hash adulterado. Esses números **não são RTO/RPO institucionais**: o banco restaurado
ainda usa o mesmo servidor PostgreSQL, não há segundo host, volume
representativo nem falha real seguida de restauração operacional.

Em 05/11/2026, repeti `python3 scripts/staging-recovery-drill.py --require-media` sobre a stack fictícia atual, após as correções de deliberação em duas instâncias. A primeira execução verificou pacote de **12 arquivos**, **uma gravação**, **dois segmentos**, três volumes e **105 sessões autenticadas** na aplicação restaurada; snapshot em **1,367 s**, restauração/verificação em **4,054 s** e bootstrap da instância restaurada em **1,258 s**. A segunda execução, depois de alterar o nome do arquivo temporário para um identificador aleatório e resolver o contêiner ativo na limpeza, passou com os mesmos itens; snapshot em **1,273 s**, restauração/verificação em **3,939 s** e bootstrap em **1,225 s**. A base ativa não foi substituída. Após o ensaio, todos os serviços voltaram a saudáveis e não restou marcador temporário nos três volumes. Os hashes dos pacotes variam porque cada rodada cria marcadores aleatórios; cada manifesto foi verificado dentro da própria execução.

Esses tempos medem apenas a rotina sintética nesta máquina. Não incluem cópia para outro host, volume representativo, acordo de RTO/RPO nem aceite da operação institucional.

**Incremento seguinte:** gravação/replay com mídia sintética referenciada pelo banco e falha controlada do PostgreSQL foram executados; veja [a prova de mídia e falha do banco](045-midia-referenciada-falha-banco.md). Ainda faltam carga representativa, correio em relay de homologação e pré-voo institucional antes do piloto acompanhado. Nextcloud e Alfresco seguem para as últimas fases.
