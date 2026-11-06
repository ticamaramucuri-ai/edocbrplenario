# Etapa 045 — Avaliação de host compartilhado para desenvolvimento

**Data:** 06/11/2026. **Escopo:** inventário remoto somente leitura de VPS indicada pelo responsável. Não houve implantação, alteração de arquivo, rede, proxy, contêiner ou serviço. O endereço e as credenciais do host não constam deste documento. O acesso por chave SSH já disponível funcionou; a senha informada para a análise não foi utilizada.

## Observado

| Item | Estado observado |
|---|---|
| Sistema e arquitetura | Ubuntu 26.04 LTS, x86_64 |
| Capacidade | 6 vCPU; 11 GiB de RAM, cerca de 8,3 GiB disponíveis no instante da coleta; swap 4 GiB, cerca de 1 GiB em uso |
| Armazenamento | Volume raiz ext4 de 193 GiB, cerca de 66 GiB livres (67% usado); inodes com 10% de uso |
| Contêineres | Docker 29.6.2 e Compose 5.3.1; doze contêineres de aplicações existentes em execução, além do construtor; serviços com healthcheck estavam saudáveis na coleta |
| Entrada pública | Proxy existente ocupa 80/443; SSH e outro serviço existente também têm portas públicas. Bancos e serviços internos observados usam loopback ou rede Docker |
| Pressão instantânea | CPU com carga aproximada de 1,3/1,0/0,7; sem pressão de memória registrada na janela de 10 segundos da consulta. Essa leitura pontual não representa pico ou capacidade contratual |

## Conclusão técnica

**Pode receber um ambiente de desenvolvimento/ensaio sintético do Plenário**, desde que inteiramente isolado da aplicação existente: projeto Compose, diretório, rede, banco, Redis, volumes, segredos, backup e contas próprios; portas apenas em `127.0.0.1`; acesso inicialmente por túnel SSH; limites de CPU/memória, logs e retenção de mídia. A imagem deve ser construída fora do host e transferida por digest/versão verificável para reduzir carga de build e consumo de disco na VPS. O sistema atual e o proxy público não precisam ser modificados para esse primeiro ensaio.

**Não há prova de capacidade para o SaaS de todas as Câmaras** com esses números. Medir sessões simultâneas, conexões de dispositivos, votação, portal e transmissão, crescimento do acervo, latência e restauração antes de dimensionar produção. As gravações exigem limite e destino de backup próprios; 66 GiB livres podem desaparecer rapidamente sob vídeo e imagens de build.

**Não usar esta VPS para os testes host-wide da fase 045** enquanto o sistema existente tiver de permanecer intacto: reinício do host, queda de rede global, saturação deliberada e falha do proxy compartilhado afetariam a outra aplicação. Falhas confinadas aos contêineres do Plenário podem ser estudadas em janela controlada, sem compartilhar recursos. A homologação de recuperação do host inteiro ainda exige host dedicado ou ambiente autorizado para esse tipo de interrupção, com observador externo.

## Próxima ação segura

1. Preparar localmente um Compose separado para desenvolvimento, com portas de loopback não usadas, limites de recursos e volumes próprios. Revisar o arquivo gerado sem segredos antes de instalar.
2. Transferir imagem versionada e subir **somente** o projeto isolado. Conferir que os contêineres, portas, logs e saúde da aplicação existente permaneceram iguais antes/depois.
3. Acessar o Plenário por túnel SSH, executar smoke e restauração **apenas dos volumes dele**, medir consumo e interromper o ensaio se houver pressão no host.
4. Para domínio público/TLS ou homologação de falha do host, usar infraestrutura separada ou planejar alteração/reinício com o responsável pela aplicação existente; a análise presente não autoriza essa mudança.

**Limites:** inventário pontual, sem carga representativa, sem teste de backup externo, sem medição de pico e sem execução do Plenário na VPS. A saúde dos contêineres existentes não comprova o fluxo de negócio deles.
