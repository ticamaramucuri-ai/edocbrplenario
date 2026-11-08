# P5 — identidade cifrada e processo de sincronização local

**Estado em 08/11/2026:** PR #27 integrada no SHA `3bb3a0a2899bd71138f7a6cbc50400a568396ae1`, CI da `main` 42492450964 aprovada e promoção à VPS sintética confirmada. Ainda não há instalador, serviço supervisionado pelo sistema operacional, custódia institucional de segredo ou API LAN.

## Operação entregue

`bun run local:server -- init <raiz-absoluta> <tenantId> <https-baseUrl>` cria uma raiz privada fora do repositório e gera chave Ed25519 no equipamento. A chave privada PKCS#8 é cifrada com AES-256-GCM e chave derivada por scrypt (N=65536, r=8, p=1, sal e IV aleatórios). A frase secreta tem no mínimo 20 caracteres e entra por terminal sem eco ou por stdin; ela não entra em argumentos, configuração ou saída. O comando imprime somente chave pública SPKI e impressão SHA-256 para cadastro nominal pelo administrador da Câmara.

Depois do cadastro/designação no SaaS, `enroll <raiz> <deviceId>` vincula a identidade uma única vez. `trust <raiz> <keyId> <chave-publica.pem> <sha256-spki>` confere a impressão digital obtida por canal administrativo independente e registra a chave pública Ed25519 da Câmara. O mesmo keyId com bytes diferentes é recusado. Diretório e arquivos privados exigem modo restrito em Unix; symlinks são recusados. O conteúdo da chave privada permanece cifrado também em Windows, mas ACL e custódia de segredo naquele sistema ainda precisam de ensaio próprio.

`sync <raiz>` executa um ciclo de descoberta e importação. `run <raiz> [intervalo-segundos]` repete o ciclo em processo contínuo, com intervalo de 30 a 3600 segundos, sem execução simultânea e com parada por SIGINT/SIGTERM. Falha de rede não modifica a última revisão preparada. O operador informa a frase secreta ao iniciar; reinício automático sem presença humana exige integração futura com gestor de segredos do sistema operacional. O processo **não** recebe autoridade para abrir sessão, presença, voto ou telão.

## Prova e limite

`tests/local-device-keystore.test.ts` verifica cifra em repouso, frase errada, alteração de Câmara, vínculo único, impressão divergente, permissões e symlink. `tests/local-server-cli.test.ts` executa os comandos reais `init`, `enroll` e `trust` e confirma que a saída não contém a frase secreta. CI aprovou aplicação, PostgreSQL e mídia; o promotor confirmou quatro serviços saudáveis e 20 migrações na VPS. A URL pública `/api/v1/health?ready=1` respondeu 200 com o SHA e `/api/v1/local-preparations` sem identidade respondeu 401. Ensaios em máquina Windows/Linux real, supervisão, backup/restauração, rotação de frase e proteção de RAM continuam pendentes.

**Próximo passo:** pacote instalável para os dois sistemas, credenciais entregues por mecanismo seguro de serviço, inicialização automática e observabilidade local; [ACK integral](063-confirmacao-transferencia-local.md) foi acrescentado em laboratório, mas retomada por artefato, API LAN/TLS e autoridade única seguem pendentes. O piloto institucional depende de custódia e aceites próprios.
