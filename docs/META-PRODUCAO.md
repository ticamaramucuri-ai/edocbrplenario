# Meta de entrega em produção — edocBR Plenário

**Estado em 09/11/2026:** meta ativa. A implantação atual em `edocbrplenario.com.br` é **homologação sintética**, no commit `12cc4a710ffed84fd7717c224f158ae61e2073f7` (saúde pública consultada em 09/11). P4/P5 já ensaiam manifesto, matérias/anexos congelados, importação, assinatura por Câmara, identidade do desktop designado, descoberta, download autenticado, ACK integral e recuperação de ACK perdido sem novo download. Um ensaio local com duas Câmaras e 48 MiB de PDFs sintéticos passou após corrigir conflito de nonce; [evidência 070](etapas/070-concorrencia-transferencia-duas-camaras.md). Ainda não existem chave institucional provisionada, serviço desktop instalável, autoridade local ou sincronização dos atos. Este documento define o resultado a alcançar; o [plano mestre](PLANO-MESTRE.md) governa escopo, sequência P0–P13 e gates técnicos, e a [matriz de entrega](MATRIZ-ENTREGA.md) registra a evidência por função.

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

## Sequência executável a partir da linha de base

| Ordem | Entrega seguinte | Prova de conclusão | Estado em 09/11 |
|---|---|---|---|
| **1 — estabilizar a preparação** | Congelar na revisão publicada a composição, as regras e a versão usadas no manifesto; bloquear exportação de revisão incompleta; concluir a retomada de transferência por artefato e o acervo privado | O mesmo `revisionId` produz os mesmos hashes mesmo após mudança de cadastro; transferência interrompida retoma sem aceitar bytes adulterados; dois tenants isolados | Contexto/MIME, PDF privado, retomada, retenção, leitura seletiva, quota por pacote e 48 MiB em duas Câmaras fictícias ensaiados; HTTP/TLS na VPS, quota agregada e homologação pendentes em P3/P4 |
| **2 — tornar o núcleo instalável** | Serviço supervisionado Windows/Linux, armazenamento local, importação automática, prontidão, certificado LAN e acesso de Mesa, parlamentar e telão | Instalação limpa nos dois sistemas, reinício e fechamento da janela sem derrubar serviço; tablet, celular e notebook recebem a mesma revisão e documentos | P5 pendente |
| **3 — definir a autoridade do ato** | Executor local com escritor único, comandos idempotentes, eventos sequenciados, ACK durável, reconciliação e promoção de reserva | Voto/presença confirmados permanecem após falha de energia; WAN perdida e restaurada não cria dupla autoridade nem duplica ato; conflito fica em quarentena | P4/P6 pendentes |
| **4 — concluir a sessão de ponta a ponta** | Presença, fala, votação, telão, ata, publicação e replay no fluxo local ↔ SaaS; acessibilidade e ensaio audiovisual | Casos regimentais aprovados conferidos por pessoa independente; publicação só após reconciliação; áudio e vídeo observados externamente; gravação íntegra | P7–P9 pendentes |
| **5 — preparar a operação real** | Segurança do desktop, segredos e MFA, backup SaaS/local, alerta com responsável, restauração e suporte | Host novo recupera aplicação, banco e acervo a partir de cópia durável; RTO/RPO medidos contra metas pactuadas; atualização/rollback e suspensão ensaiados | P1/P10 abertos |
| **6 — liberar Mucuri com escopo assinado** | Configuração oficial, equipamentos, contas, treinamento, ensaio longo e sessão assistida | Todos os aceites e o pré-voo de P11 fechados para uma release identificada; registro explícito da contingência e do escopo de voto offline | P2/P3/P11 aguardam insumos da Câmara |
| **7 — integrar e escalar** | Nextcloud e Alfresco por contrato de autoridade e ACL; segunda Câmara configurada sem mudança de código | Leitura, entrega, ACK, divergência e reversão homologados; segunda Câmara isolada; releases e recuperação recorrentes em operação | P12/P13 posteriores ao piloto |

Cada ordem pode conter vários PRs. O avanço depende da prova indicada, não do número de commits. A ordem 5 pode ser trabalhada em paralelo com 1–4, mas precisa estar fechada antes do piloto.

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

**Bloqueio de entrega em 09/11/2026:** a CI do [PR #41](https://github.com/e-docBR/edocBRplenario/pull/41) não iniciou os jobs. O GitHub informou pagamento recente com falha **ou** limite de gastos insuficiente na conta. A regularização em **Billing & plans** é necessária para retomar o gate GitHub → VPS; o ensaio local não substitui CI verde. Ver [etapa 070](etapas/070-concorrencia-transferencia-duas-camaras.md).

Cada incremento deve registrar no `docs/etapas/` objetivo, mudança, teste, SHA, ambiente, resultado, limite e próximo passo; atualizar a matriz e o plano mestre quando o estado mudar. PR e CI verde precedem promoção à VPS. Acompanharemos **gate fechado**, não porcentagem subjetiva. A meta só será concluída quando o R4 tiver evidência e aceites, e a release estiver operando com monitoramento, backup, suporte e revisão periódica. Datas e orçamento serão definidos depois de equipe, escopo do primeiro piloto, hardware e dependências externas confirmados.

**Ritmo de controle:** ao final de cada incremento, registrar o gate P afetado como aberto ou fechado, falhas bloqueantes, responsável e próxima prova. Antes de R3, realizar uma revisão de prontidão com produto, engenharia, operação e representantes da Câmara. Após R3, acompanhar incidentes, atraso de sincronização, idade do backup íntegro, restauração exercitada, disponibilidade e suporte; qualquer falha bloqueante suspende a ampliação até nova prova.
