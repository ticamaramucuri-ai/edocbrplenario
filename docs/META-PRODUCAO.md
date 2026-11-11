# Meta de entrega em produção — edocBR Plenário

**Estado em 10/11/2026:** meta ativa, revista após o [comparativo do PainelDesk](../reports/parecer-comparativo-paineldesk-edocbr-2026-11-10.docx). A implantação em `edocbrplenario.com.br` continua **homologação sintética**; o último SHA de staging explicitamente verificado neste conjunto documental é `7f15f65b4fecb5835ab644ea0610bc39cc78adbb` em 09/11. O repositório local está em `1422b5f`, sem nova promoção ou sessão executada nesta revisão. P4/P5 já ensaiam importação verificada, identidade do desktop, ACK de pacote, processo de sincronização, inventário local e diário assinado; P6 tem contrato e reserva transacional exclusiva em teste. Ainda não há serviço de plenário instalável com API LAN, atos locais, cercamento web, sincronização de retorno ou voto offline oficial. O [plano mestre](PLANO-MESTRE.md) governa fases P0–P13; a [matriz](MATRIZ-ENTREGA.md) registra a prova por função.

## Resultado exigido

Entregar o edocBR Plenário como SaaS configurável para várias Câmaras, com preparação integral da sessão pela web, operação da sessão em servidor local Windows/Linux conectado ou temporariamente sem internet, dispositivos da Mesa e parlamentares sincronizados pela LAN, votação e telão sob autoridade única, ata e transparência reconciliadas, transmissão/gravação assistidas e operação recuperável. Mucuri será o primeiro piloto institucional após aceites próprios. Nextcloud e Alfresco entram nas fases finais, com fonte de verdade e autorização definidas; a segunda Câmara comprova que o produto não depende de regras codificadas para Mucuri.

**Marco R2 — piloto local técnico:** uma Câmara executa sessão **fictícia** de ponta a ponta em equipamento, LAN, dispositivos e telões reais, com cortes de WAN/LAN/energia controlados e reconciliação. Este marco não libera ato oficial.

**Marco R3 — piloto institucional em produção delimitada:** uma Câmara usa release identificada, com modalidades e regras aprovadas, contas nominais, infraestrutura, suporte, monitoramento, backup, contingência e suspensão definidos. Operação sem internet só integra o escopo se os gates P5/P6/P7/P10 e o aceite específico da Câmara estiverem fechados. R3 não autoriza outra Câmara nem afirma que as integrações finais estão prontas.

**Marco R4 — produto completo em produção multi-Câmara:** P1–P13 fechadas, integrações aceitas, operação local e SaaS testadas, segunda Câmara instalada sem alteração específica de código, releases e recuperação recorrentes comprovados. É este o objetivo de conclusão da meta.

## Marcos e provas de avanço

| Marco | Fases | Evidência para avançar |
|---|---|---|
| **M1 — base operável** | P0–P1 | Documentos e CI coerentes; backup cifrado agendado em destino durável, alerta recebido, restauração em host novo e metas RTO/RPO pactuadas e medidas. P0 está concluída; P1 ainda está aberta. |
| **M2 — preparação por Câmara** | P2–P3 | Duas configurações distintas sem vazamento; sessão web completa com pauta versionada, documentos em bytes e hash, convocação e prontidão verificadas. Dados/regimento de Mucuri só contam após conferência institucional. |
| **M3 — servidor local operável** | P4–P5/P10 parcial | Contrato versionado; serviço supervisionado em Windows/Linux; revisão e bytes íntegros; API LAN/TLS, identidade, documentos, dispositivos e duas TVs; fechar janela e reiniciar não derruba o estado persistido. |
| **M4 — autoridade e sessão** | P6–P7 | Escritor único, comandos locais, recibos, outbox/ACK, reconciliação; perda/retorno de WAN, LAN e energia sem perda ou duplicação de ato confirmado; presença, fala, voto nominal/simbólico, apuração e telão conferidos. |
| **M5 — ata e público** | P8 | Resultado reconciliado, ata, retificação, assinatura aplicável e publicação segregada conferidos contra matriz aprovada, com versão/hash e replay associado. |
| **M6 — audiovisual** | P9 | Câmera e áudio observados em rede externa; destinos sociais independentes, gravação local e replay íntegros; falha de transmissão não altera votação. |
| **M7 — segurança e recuperação local** | P10 | Instaladores assinados, atualização/rollback fora de sessão, backup/restauração local, certificados/dispositivos, reserva e revisão de segurança aprovados. |
| **M8 — piloto Mucuri** | P11 | Pré-voo, sessão fictícia longa, treinamento, sessão assistida, plano de suspensão e aceites técnico, legislativo, jurídico, acessibilidade e audiovisual registrados. Libera apenas R3 delimitado. |
| **M9 — integração e expansão** | P12–P13 | Nextcloud/Alfresco com ACL, ACK, reconciliação e reversão homologados; segunda Câmara sem código próprio; capacidade, suporte e recuperação contínua demonstrados. Libera R4. |

P1, P2/P3 e P9 podem avançar em paralelo com M3/M4. Nenhum ensaio paralelo substitui o gate institucional. A prioridade de engenharia é M3/M4 junto com backup e segurança: o comparativo mostrou que é o trecho em que o edocBR ainda não entrega a operação local observável. O voto secreto permanece fora da liberação até projeto e revisão próprios.

## Sequência executável a partir da linha de base

| Ordem | Entrega seguinte | Prova de conclusão | Estado em 10/11 |
|---|---|---|---|
| **1 — autoridade do ato** | Cercar escritores web, expor concessão exclusiva, persistir época local, ligar comandos de presença/voto ao diário e definir eventos de retorno | Dois processos, época vencida, ACK perdido e WAN ausente não criam dupla autoridade nem voto sem recibo persistido | Contrato, diário e reserva interna ensaiados; atos e reconciliação pendentes |
| **2 — servidor utilizável na Câmara** | Serviço supervisionado e instalador Windows/Linux, armazenamento/segredo, API LAN/TLS, login, snapshots, documentos, telão e pré-voo | Instalação limpa, reinício, janela fechada, pacote incompleto e tablet/celular/notebook/duas TVs com estado coerente | Binário Linux exercitado e Windows apenas compilado; sem API LAN |
| **3 — sessão local completa** | Presença, quórum por ato, fala, votação nominal/simbólica, apuração, anulação e telão sobre o executor autorizado | Matriz regimental aprovada bate com cálculo humano; Wi-Fi e WAN caem/retornam sem duplicar atos; tela atrasada é detectada | Web ensaiada; executor local pendente |
| **4 — operação recuperável** | Backup SaaS/local durável, alerta, restauração, reserva, atualização fora de sessão e suporte | Host novo recupera app, banco e acervo; RTO/RPO pactuados e medidos; suspensão/retorno registrados | Staging e restore sintético pontual; P1/P10 abertos |
| **5 — registro e público** | Reconciliar eventos/arquivos, revisar ata, assinatura aplicável, retificação, portal e replay; mídia com áudio/vídeo institucional | Publicação só após conferência e autorização; vídeo/áudio vistos externamente; falha de destino não muda votação | Ata e mídia em ensaios técnicos; P8/P9 institucionais pendentes |
| **6 — piloto Mucuri** | Configuração, contas, equipamentos, treinamento, sessão fictícia longa e sessão assistida | Pré-voo e aceites por área para release e modalidades expressas; contingência e suporte ativos | `automaticReady: false`; insumos da Câmara pendentes |
| **7 — integrar e escalar** | Nextcloud/Alfresco por contrato de autoridade e ACL; segunda Câmara sem alteração de código | ACK, divergência e reversão homologados; isolamento e operação recorrente comprovados | P12/P13 posteriores ao piloto |

Cada ordem pode conter vários PRs. P1, configuração e audiovisual podem avançar em paralelo, mas recuperação, segurança e regras oficiais precisam estar fechadas antes do piloto. O avanço depende da prova indicada, não do número de commits.

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

**Operação no plano gratuito em 09/11/2026:** os jobs hospedados foram recusados por cobrança ou limite, mas o [PR #41](https://github.com/e-docBR/edocBRplenario/pull/41) passou nos três jobs de CI em runner próprio isolado e foi integrado. O repositório privado executa CI no PR e em `main`; a sonda externa foi reduzida para uma execução por hora. A [estratégia GitHub Free](OPERACAO-GITHUB-FREE.md) registra o custo de detecção e o ciclo do runner. Nenhuma promoção é liberada sem CI verde no SHA correspondente.

Cada incremento deve registrar no `docs/etapas/` objetivo, mudança, teste, SHA, ambiente, resultado, limite e próximo passo; atualizar a matriz e o plano mestre quando o estado mudar. PR e CI verde precedem promoção à VPS. Acompanharemos **gate fechado**, não porcentagem subjetiva. A meta só será concluída quando o R4 tiver evidência e aceites, e a release estiver operando com monitoramento, backup, suporte e revisão periódica. Datas e orçamento serão definidos depois de equipe, escopo do primeiro piloto, hardware e dependências externas confirmados.

**Ritmo de controle:** ao final de cada incremento, registrar o gate P afetado como aberto ou fechado, falhas bloqueantes, responsável e próxima prova. Antes de R3, realizar uma revisão de prontidão com produto, engenharia, operação e representantes da Câmara. Após R3, acompanhar incidentes, atraso de sincronização, idade do backup íntegro, restauração exercitada, disponibilidade e suporte; qualquer falha bloqueante suspende a ampliação até nova prova.
