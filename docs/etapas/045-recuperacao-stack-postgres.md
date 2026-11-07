# Etapa 045 — Recuperação do stack de homologação

**Estado em 07/11/2026:** ensaio local, repetição na VPS sintética e restauração de banco + arquivos em computador independente aprovados; recuperação operacional completa e institucional ainda pendentes.

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

## Repetição na VPS dedicada em 07/11/2026

Após promover o SHA `9ae0e774515a1e1c42bc53f3ab85318cf27d5d5b`, gerei uma sessão encerrada e uma gravação fictícias na Câmara sintética `staging-example`. A primeira execução da etapa de mídia revelou que o roteiro dependia de `ffmpeg` instalado no host; como ele só existe no contêiner da aplicação, o roteiro foi corrigido para gerar e limpar o arquivo temporário dentro desse contêiner. O ensaio de mídia então publicou um replay H.264/AAC de 60.810 bytes, conferiu hash e manifesto e recebeu HTTP 206 para leitura parcial.

`python3 scripts/staging-recovery-drill.py --require-media` passou na VPS. O pacote reuniu 12 arquivos; restaurou um tenant, uma sessão, uma gravação, dois segmentos e três volumes, validou hashes e abriu uma segunda aplicação isolada ligada ao banco restaurado. Snapshot: **2,567 s**; restauração e verificação: **7,619 s**; app restaurado até bootstrap: **2,916 s**. A base ativa não foi substituída. A rotina parou brevemente app e workers enquanto produzia o snapshot e os religou ao final.

Em seguida, `staging-worker-failure-drill.py` passou: o realtime foi interrompido com evento pendente e o publicou após reinício; webhooks e scheduler também reiniciaram, com app acessível em **6,551 s** de ensaio. A sonda externa do GitHub (run [42394264032](https://github.com/e-docBR/edocBRplenario/actions/runs/42394264032)) conferiu a nova versão `9ae0e77`, HTTPS, readiness PostgreSQL, `noindex` e redirecionamento de `www`.

A [evidência estruturada](045-prova-recuperacao-vps-sintetica.json) registra os resultados e limites. Os arquivos de backup e o banco restaurado estavam no mesmo host físico e foram removidos ao fim do ensaio; não foi testada perda total da VPS, cópia off-host, restauração após falha global ou RTO/RPO institucional. Os tempos acima são medidas de laboratório, não metas contratadas.

## Prova de transferência cifrada e restauração em outro computador

O PR [#6](https://github.com/e-docBR/edocBRplenario/pull/6) acrescentou `--export-bundle` ao ensaio sintético. A opção só aceita destino absoluto inexistente sob diretório privado (modo 0700); a cópia ocorre **depois** da verificação do banco, mídia e app restaurado, e o manifesto é conferido novamente no destino. O ensaio local passou com 12 arquivos exportados em diretório 0700. A CI do PR e do `main` `b8d137e304c1305782d91bc23880f6fb6c86e0af` passou antes da promoção à VPS.

Na VPS dedicada, `staging-recovery-drill.py --require-media --export-bundle <diretório privado>/bundle` produziu 12 arquivos e manifesto SHA-256 `98390256edf5c2195293eb5b7cedf197df4fbe63213d4a59277c370088bad9fe`. O snapshot levou **2,742 s**, a restauração e verificação isoladas na própria VPS **7,295 s**, e o app restaurado respondeu ao bootstrap em **2,626 s**. Havia um tenant, uma sessão, uma gravação e dois segmentos sintéticos.

Para a prova fora do host, criei uma chave e certificado RSA temporários **no computador local**. Enviei apenas o certificado público à VPS. Um `tar` do pacote foi cifrado na VPS com `openssl cms -encrypt -binary -aes-256-cbc -outform DER` e transmitido por SSH ao computador local. O objeto cifrado recebido tinha **512.572 bytes** e SHA-256 `7414c6739f6c6ee2cbda94c5715d64778f80a5a0c46231757628a356d9009d97`. Depois de decifrar localmente, `backup-bundle.py verify` confirmou os 12 arquivos e o mesmo hash do manifesto. Um contêiner descartável PostgreSQL 16, independente da VPS e dos bancos ativos deste computador, recebeu `pg_restore --exit-on-error`; consultas confirmaram `staging-example`, uma sessão e uma gravação. Conferi os hashes dos dois segmentos e do replay referenciados pelo banco. A subida do banco, restauração e verificação levaram **3,462 s**. O `staging-smoke.py` na VPS e a prontidão HTTPS pública voltaram a passar. Materiais e chave temporários foram removidos dos dois computadores. A [evidência estruturada](045-prova-recuperacao-offhost-sintetica.json) resume as medidas.

**Limites:** esta foi uma transferência cifrada de ensaio, não um serviço de backup recorrente. O pacote existiu temporariamente em claro sob diretório privado na VPS e após a decifragem local. O host independente validou PostgreSQL e arquivos, mas não iniciou uma aplicação restaurada nem assumiu tráfego oficial; a aplicação restaurada foi provada somente na VPS. A carga é pequena e fictícia. Não se mediu perda total do servidor, atraso de cópia, RPO, RTO operacional nem restauração de identidade/segredos em máquina nova. A base ativa nunca foi substituída.

**Incremento seguinte:** implantar cópia recorrente cifrada em destino independente com retenção, verificação e alerta de falha; ensaiar restauração completa da aplicação em host limpo; medir RTO/RPO com carga sintética representativa; instalar sonda autenticada externa dos cinco serviços e definir canal de alerta. Depois, ensaiar matriz de falhas e obter pré-voo/aceite institucional. Nextcloud e Alfresco seguem para as últimas fases.
