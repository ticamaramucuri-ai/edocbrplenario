# Meta de entrega em produção — edocBR Plenário

**Estado em 07/11/2026:** meta ativa. A implantação atual em `edocbrplenario.com.br` é **homologação sintética**. Este documento define o resultado a alcançar; o [plano mestre](PLANO-MESTRE.md) governa escopo, sequência P0–P13 e gates técnicos, e a [matriz de entrega](MATRIZ-ENTREGA.md) registra a evidência por função.

## Resultado exigido

Entregar o edocBR Plenário como SaaS configurável para várias Câmaras, com preparação integral da sessão pela web, operação da sessão em servidor local Windows/Linux conectado ou temporariamente sem internet, dispositivos da Mesa e parlamentares sincronizados pela LAN, votação e telão sob autoridade única, ata e transparência reconciliadas, transmissão/gravação assistidas e operação recuperável. Mucuri será o primeiro piloto institucional após aceites próprios. Nextcloud e Alfresco entram nas fases finais, com fonte de verdade e autorização definidas; a segunda Câmara comprova que o produto não depende de regras codificadas para Mucuri.

**Marco R3 — piloto institucional em produção delimitada:** uma Câmara usa uma release identificada, com escopo oficial aprovado, contas nominais, infraestrutura, suporte, monitoramento, backup, contingência e suspensão definidos. Um piloto R3 não autoriza automaticamente outras Câmaras nem afirma que todas as integrações estão prontas.

**Marco R4 — produto completo em produção multi-Câmara:** P1–P13 fechadas, integrações aceitas, operação local e SaaS testadas, segunda Câmara instalada sem alteração específica de código, releases e recuperação recorrentes comprovados. É este o objetivo de conclusão da meta.

## Marcos na ordem de entrega

| Marco | Fases | Evidência para avançar |
|---|---|---|
| **M1 — base operável** | P0–P1 | Documentos e CI coerentes; backup cifrado agendado em destino durável, alerta recebido, restauração em host novo e metas RTO/RPO pactuadas e medidas. P0 está concluída; P1 ainda está aberta. |
| **M2 — preparação por Câmara** | P2–P3 | Duas configurações distintas sem vazamento; sessão web completa com pauta versionada, documentos em bytes e hash, convocação e prontidão verificadas. Dados/regimento de Mucuri só contam após conferência institucional. |
| **M3 — núcleo local** | P4–P6 | Contrato de pacote e eventos versionado; serviço Windows/Linux, importação integral, dispositivos LAN e autoridade única; perda/retorno de WAN e energia sem perda ou duplicação de ato confirmado. |
| **M4 — sessão e registro** | P7–P8 | Presença, fala, voto nominal/simbólico, apuração, telão, ata, retificação e publicação conferidos contra matriz regimental aprovada, inclusive recomposição e acessibilidade. |
| **M5 — audiovisual** | P9 | Câmera e áudio observados em rede externa; destinos sociais independentes, gravação local e replay íntegros; falha de transmissão não altera votação. |
| **M6 — segurança local** | P10 | Instaladores assinados, atualização/rollback fora de sessão, proteção e recuperação do acervo local, certificados/dispositivos e revisão de segurança aprovados. |
| **M7 — piloto Mucuri** | P11 | Pré-voo, sessão fictícia longa, treinamento, sessão assistida, plano de suspensão e aceites técnico, legislativo, jurídico, acessibilidade e audiovisual registrados. Este gate libera apenas o R3 delimitado. |
| **M8 — integração e expansão** | P12–P13 | Fluxos Nextcloud/Alfresco com ACL, ACK, reconciliação e reversão homologados; segunda Câmara entra sem código próprio; capacidade, suporte e recuperação contínua demonstrados. Este gate libera R4. |

P9 pode avançar em laboratório enquanto M2–M4 são construídos. Nenhum ensaio paralelo substitui o gate anterior. O voto secreto permanece fora da liberação até projeto e revisão próprios. A decisão sobre voto offline no primeiro piloto deve constar do escopo R3 antes de sua homologação.

## Definição de pronto para produção

Uma release só muda de “ensaiada” para “em operação” quando há:

1. SHA, imagem e instaladores identificados; CI e migrações aprovadas; ambientes de homologação e produção segregados, domínio/DNS e segredos de produção preparados; promoção local → GitHub → VPS e rollback documentados.
2. Jornada completa no ambiente alvo com regras e pessoas autorizadas, comparação humana independente de quórum/voto/ata e segregação de publicação.
3. Isolamento entre Câmaras, MFA e papéis, proteção de dados/segredos, auditoria, política de privacidade/retenção e revisão de segurança; nenhum dado oficial na staging sintética.
4. Backup íntegro em destino independente, restauração de banco + arquivos + aplicação + servidor local quando aplicável, alerta entregue e ensaio de indisponibilidade dentro de RTO/RPO acordados.
5. Dispositivos, rede, energia, câmeras, áudio, banda e observador externo ensaiados; operação assistida, treinamento e plantão com responsáveis nomeados.
6. Aceites e limites de uso registrados pela Câmara e pela operação. Falha bloqueante reabre o gate e suspende a ampliação.

## Dependências que exigem responsáveis externos

| Entrada | Bloqueia |
|---|---|
| Destino durável de backup, custódia da chave, canal de alerta e metas RTO/RPO | Fechamento de P1 e R3 |
| Regimento, composição, quóruns, papéis, contas e canais oficiais de Mucuri | Aceite P2/P3/P7/P8/P11 |
| Computador local e reserva, Windows/Linux, energia, LAN e política de dispositivos | P5/P6/P10/P11 |
| Câmeras, mesa de áudio, banda, canal social e operador audiovisual | P9/P11 |
| Contratos de autoridade, ambiente de teste e responsáveis Nextcloud/Alfresco | P12 |

Essas entradas não serão presumidas. O trabalho com dados fictícios pode avançar até o ponto em que o gate exigir decisão ou aceite institucional.

## Controle da meta

Cada incremento deve registrar no `docs/etapas/` objetivo, mudança, teste, SHA, ambiente, resultado, limite e próximo passo; atualizar a matriz e o plano mestre quando o estado mudar. PR e CI verde precedem promoção à VPS. Acompanharemos **gate fechado**, não porcentagem subjetiva. A meta só será concluída quando o R4 tiver evidência e aceites, e a release estiver operando com monitoramento, backup, suporte e revisão periódica. Datas e orçamento serão definidos depois de equipe, escopo do primeiro piloto, hardware e dependências externas confirmados.
