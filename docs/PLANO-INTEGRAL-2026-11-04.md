# edocBR Plenário — diagnóstico e plano integral de conclusão

> Revisão histórica de 04/11/2026. Para estado e ordem de trabalho após o cadastro público de Mucuri e os ensaios de 05/11, usar o [plano atualizado](PLANO-DESENVOLVIMENTO-ATUAL-2026-11-05.md).

**Revisão:** 04/11/2026. **Escopo:** produto SaaS multi-Câmara, piloto assistido de Mucuri/BA e integração posterior ao ecossistema edocBR. Este documento atualiza a prioridade dos planos anteriores; os registros numerados em `docs/etapas/` continuam sendo a prova de cada entrega. Uma implementação local não equivale a homologação institucional.

**Atualização local de 05/11/2026:** a base de Mucuri recebeu 13 vereadores, partidos, legislatura 2025–2028 sem ordinal presumido, mandatos, Mesa atual e Mesa eleita para 2027–2028 com posse pendente, além de contatos institucionais e 13 fotos públicas com origem verificada. O ciclo de eleição futura, confirmação e cancelamento foi concluído na interface e API ([etapa 053b](etapas/053b-ciclo-eleicao-mesa.md)); a importação das fotos está na [etapa 053c](etapas/053c-fotos-publicas-mucuri.md). Emblemas de partido aguardam arquivos verificáveis. O pré-voo segue negativo por regras regimentais/aprovação, responsáveis, infraestrutura e canal social; nenhuma sessão oficial ou integração externa foi ativada.

**Prova operacional local em 05/11/2026:** a [etapa 045 de auditoria e réplica](etapas/045-auditoria-imagens-replica.md) conciliou 78 tabelas/526 linhas em PostgreSQL descartável, passou por escrita e recuperação HTTP e restaurou um pacote SQLite + imagens + public com 14 imagens referenciadas íntegras. O pré-voo de Mucuri permanece `automaticReady: false`: faltam responsável e política de votação aprovados, perfis institucionais, PostgreSQL operacional, SMTP e canal público. A prova local não fecha a homologação em host separado.

## 1. Base analisada e regra de leitura

Foram confrontados `README.md`, `docs/ROADMAP.md`, `docs/DIAGNOSTICO-E-PLANO-DE-CONCLUSAO.md`, `docs/PLANO-ATUALIZADO-2026-10-13.md`, `docs/PLANO-CONTINUIDADE-2026-10-20.md`, `docs/PENDENCIAS-PRIORIZADAS.md`, ADRs, índice e registros das etapas 001–053, contrato de integração, módulos, rotas, esquema Prisma, testes, CI e estrutura de homologação. O inventário atual mostra **186 rotas** `/api/v1`, **78 modelos** Prisma e **53 arquivos de teste** `.test.ts`/`.test.py`; são contagens de arquivos, não cobertura ou aprovação. A documentação de integração institucional foi consultada em `/home/suporte/Work/integracao-edocbr/documentacao/ESTADO-ATUAL.md` (atualização parcial de 04/11), `README.md` e na skill operacional edocBR/CMM. Seu estado é específico daquele ambiente e deve ser reconfirmado antes de conectar serviços.

O pré-voo somente leitura de Mucuri, executado em 04/11/2026, retornou `automaticReady: false`: Câmara ativa, porém legislatura/mandatos/partidos/Mesa/quórum/política de votação incompletos; configuração sem aprovação vigente; nenhum usuário de administração, Mesa ou mídia; banco local SQLite; transporte SMTP ausente; nenhum destino de mídia com URL pública; nenhuma sessão oficial. Esse resultado é o marco de entrada do plano, não um defeito a contornar com dados presumidos.

## 2. O que existe hoje

| Capacidade | Evidência principal | Estado real |
|---|---|---|
| SaaS e isolamento | `src/modules/console`, `settings`, RBAC, tenants, API keys, auditoria, testes de isolamento | Implementado e ensaiado localmente; operação multi-Câmara em infraestrutura definitiva pendente |
| Cadastro institucional | Legislaturas, mandatos, suplência, Mesa, partidos, fotos/emblemas e configuração versionada | Implementado; dados e regimento de Mucuri não aprovados |
| Preparação da sessão | Rascunho, numeração, pauta, emendas, revisão, convocação, ciência e alertas | Fluxo interno implementado; entrega externa comprovada e regras locais pendentes |
| Plenário | Presença, quórum, fala, telão durável/reconectável, nominal e simbólica, recibos, anulação | Ensaios sintéticos; validação regimental, equipamentos e conferência humana pendentes |
| Encerramento | Ata revisada/versionada, publicação separada, portal e vínculo ao replay | Fluxo técnico local; texto, assinatura e publicação institucionais pendentes |
| Transmissão | RTMP/RTMPS local, múltiplos destinos, controle/observação, gravação e replay verificável | Prova local; canal social real, áudio/vídeo externo, banda, hardware e aceite pendentes |
| Operação | Stack PostgreSQL/Redis/serviços, cargas, falhas, backup/restore e sonda remota | Laboratório local; homologação fora do host, armazenamento durável e recuperação institucional pendentes |
| Integrações | API/webhooks/outbox e arquitetura Nextcloud/Alfresco | Contratos preparatórios; adaptadores institucionais não implementados nem ativados |

**Limites funcionais explícitos:** voto secreto oficial está bloqueado porque a escolha ainda pode ser relacionada ao votante no modelo atual; votação offline não existe. Ambos requerem projetos próprios, revisão independente e decisão institucional, e não compõem o primeiro piloto. O caminho de assinatura interna do Plenário não deve ser anunciado como assinatura qualificada ou conclusão do fluxo LibreSign/Alfresco.

## 3. Arquitetura alvo e princípios de SaaS

Manter Next.js/React/TypeScript e domínio transacional do Plenário; usar PostgreSQL como base operacional, Redis para distribuição/limites, trabalhadores separados para tempo real, agenda, webhooks e mídia, armazenamento durável para fotos, documentos e gravações, e observação fora do host. Toda entidade de negócio, evento, arquivo, chave e job tem escopo de `tenantId`; configurações regimentais, mídia, publicação, retenção, identidade visual e permissões são versionadas por Câmara. Mudanças de plano comercial nunca alteram um resultado deliberativo já confirmado. Toda ação crítica tem auditoria, idempotência e teste positivo/negativo entre dois tenants.

Há três níveis de conclusão: **incremento técnico** (código, teste, prova local); **produto piloto** (jornada institucional aprovada, operação e recuperação medidas); **produto integrado** (Nextcloud/Alfresco e identidade/assinatura contratadas, reconciliadas e aceitas). O roteiro de trabalho preserva essa distinção no painel e nos documentos.

## 4. Ordem de execução

| Ordem | Fase | Trabalho e entrega concreta | Gate de saída |
|---|---|---|---|
| 0 | Linha de base e documentação | Atualizar README/ROADMAP/índice das etapas para refletir 046–053; inventariar requisito → rota → teste → evidência; classificar pendências por bloqueio técnico/institucional; estabilizar lint, typecheck e CI. Não alterar dados oficiais. | Mapa único de status publicado, comandos reproduzíveis, nenhuma afirmação de homologação baseada só em teste local. |
| 1 | Operação SaaS fora do host (fechar 045) | Implantar stack de homologação em host separado com PostgreSQL persistente, Redis, app, workers, TLS, relógio, volumes duráveis, versão em `/health`, logs correlacionados, alertas externos, SMTP de teste controlado. Ensaiar perda de rede app↔banco, restart de worker, fila/outbox, telão em duas telas físicas, transmissão simultânea, backup conjunto banco+arquivos e restore isolado. | RTO/RPO, retenção e limiares acordados; tempos medidos; hashes e referências íntegros; observador externo; runbook de suspensão e retorno aprovado. Sem host disponível, executar apenas preparação/automação local e manter o gate aberto. |
| 2 | Configuração oficial por Câmara (fechar 046) | Usar o assistente existente para receber legislatura, mandatos/licenças, suplentes, partidos, Mesa, perfis, tipos de sessão, quórum, maiorias, impedimentos, desempate, prazos e publicações. Importar somente dados fornecidos; gerar matriz de casos anônimos e aprovação versionada. | Secretaria/Presidência validam versão, responsáveis e casos; pré-voo reconhece configuração vigente. |
| 3 | Preparação e convocação (fechar 047) | Concluir canal institucional de entrega com comprovante técnico, destinatário, revisão/versão, data e ciência; validar anexos/PDFs/hashes, correções, urgência e cancelamento. Exibir falhas e reenvios sem duplicar ato. | Uma sessão fictícia preparada, publicada e convocada com evidências completas e conferência legislativa. |
| 4 | Condução e votação (fechar 048–049) | Ensaiar login nominal, dispositivo, presença, suplência, impedimento, quórum por ato, fala, votação nominal/simbólica, empate, reconta, anulação e reconexão. Conferir resultados com cálculo manual independente e carga multi-instância. | Casos regimentais aprovados batem com resultado e ata; nenhum comando duplicado ou vazamento entre Câmaras; Mesa/secretaria assinam o ensaio. |
| 5 | Ata e transparência (fechar 051) | Homologar modelo e revisão de ata, assinatura aplicável, segregação de revisão/publicação, retificação por novo ato, portal, dados abertos e vínculo ao vídeo. Definir prazos de retenção e regra de indisponibilidade. | Texto, autoria, hashes, assinatura e publicação conferidos pela Câmara; consulta pública mostra apenas conteúdo autorizado. |
| 6 | Transmissão social assistida (fechar 052) | Testar câmera→áudio/encoder→MediaMTX→RTMPS→canal institucional; credenciais segregadas por tenant/destino; operador publica link somente após observar vídeo **e áudio** na página pública por outra rede/dispositivo. Testar duas plataformas, perda/retorno, gravação, replay e incidentes. | Responsável audiovisual registra observação externa, horários, qualidade, falha/retorno, integridade e autorização de publicação. Sem conta institucional, mantém-se somente prova local. |
| 7 | Piloto Mucuri (fechar 053) | Criar usuários nominais por papel, treinar Mesa/secretaria/mídia/suporte, ensaiar sessão longa fictícia com leitor de tela e TVs; depois operar sessão assistida com plano de suspensão. Repetir pré-voo e comparar ata, apuração, portal, vídeo e restauração. | Aceites legislativo, técnico, acessibilidade e audiovisual explícitos, com versão, incidentes e correções registradas. |
| 8 | Contratos de integração (054) | Confirmar fluxos atuais do edocBR, fonte de verdade por campo, IDs, ACLs, papéis, retenção e estados de aprovação/assinatura/arquivamento. Criar modelo aditivo de referência externa por tenant, versão/etag/hash, correlação, outbox e divergência; testar com sistemas simulados. | Matriz de autoridade e contrato de eventos aprovados; nenhuma escrita real. |
| 9 | Leitura Nextcloud e Alfresco (055) | Adaptadores isolados: Nextcloud WebDAV/OCS para arquivo/versionamento; Alfresco API/CMIS conforme instalação para nó/processo/metadados. Primeiro leitura somente, cursor, prévia de importação, ACL e reconciliação; não inferir ID por nome/caminho. | Em homologação, vínculos corretos e negativos de permissão/tenant, divergências visíveis e nenhum arquivo alterado. |
| 10 | Publicação integrada (056) | Só após ato aprovado, entregar ata/deliberação e, se definido, mídia ao destino dono do acervo via outbox; guardar ACK, ID, versão, hash e estado de assinatura/arquivamento distintos. Retry, dedupe, fila de falhas, reconciliação e reversão assistida. | Rodada ponta a ponta aprovada pela TI e área legislativa; falha externa deixa pendência visível sem mudar votação. |
| 11 | Operação do produto integrado (057) | Runbooks, monitoramento, testes periódicos de restore, gestão de versões e migração por tenant, suporte auditável, contrato/SLA, treinamento de novas Câmaras e expansão de capacidade. | Aceite integrado, indicadores operacionais e processo repetível de entrada de outra Câmara. |

As fases 2–6 têm incrementos de código existentes; o trabalho principal é fechar os gates de operação e uso institucional. A fase 1 é o principal bloqueio técnico transversal. Preparação de dados e responsabilidades institucionais pode correr em paralelo, sem antecipar atos oficiais. A fase 0 é a próxima entrega puramente local; em seguida, automatizar o máximo da fase 1 enquanto se define o host.

**Direção de execução em 04/11/2026:** ainda não há host separado e a configuração oficial de Mucuri será feita depois, por decisão do responsável pelo projeto. Enquanto esses gates aguardam, avançar nos incrementos funcionais locais de 047–052 em ordem de dependência: recuperação de comandos e segurança da sessão, votação e apuração, ata/publicação e transmissão assistida em laboratório. Registrar cada incremento sem declarar o gate institucional concluído. O primeiro reforço dessa linha é a [repetição segura do auto check-in](etapas/048-repeticao-checkin-navegador.md). As integrações Nextcloud/Alfresco permanecem nas fases 054–056.

## 5. Encaixe no ecossistema edocBR

| Domínio | Autoridade a confirmar | Regra de integração proposta |
|---|---|
| Pessoas e vínculo | AD/diretório institucional | Identidade federada e grupos chegam como vínculo externo; papel deliberativo é confirmado na Câmara e versionado no Plenário. Login federado depende de contrato e prova de revogação. |
| Minutas e colaboração | Nextcloud/ONLYOFFICE | Referenciar arquivo por ID imutável, etag/versão, hash e permissão; edição continua no repositório. Pauta/ata do Plenário não sobrescrevem minuta silenciosamente. |
| Processo e arquivo institucional | Alfresco/GED | Guardar nó/processo, classificação, versão e recibo; publicação só após o estado exigido pela instituição. |
| Aprovação e assinatura | Fluxo institucional/LibreSign/GED | Distinguir aprovação de conteúdo, assinatura concluída e arquivamento validado. O Plenário acompanha estados e provas, sem assinar por pessoa. |
| Sessão e deliberação | edocBR Plenário | Presença, quórum, votos, resultado e ato de encerramento permanecem fatos locais versionados; repositório externo não comanda votação. |
| Arquivos de rede | SMB/NTFS | Acesso ao compartilhamento não substitui ACL de Nextcloud/Alfresco. Não usar caminho UNC como identidade documental. |

O projeto institucional já possui um fluxo de ATA/PAUTA no Nextcloud com numeração anual, aprovação funcional, assinatura coletiva e arquivamento no Alfresco, registrado em 06/10/2026, mas sua rodada institucional completa ainda estava pendente naquela evidência. Antes da fase 8, decidir com a Câmara **qual sistema numera cada espécie documental**, quando a ata do Plenário vira minuta institucional, qual aprovação antecede assinatura, e qual evento comprova arquivo definitivo. Essa decisão evita duas séries de ATA/PAUTA ou dois documentos “finais”. O estado de rede/serviços de 04/11 é parcial e não comprova disponibilidade fim a fim desses fluxos.

## 6. Segurança, qualidade e prova por fase

Cada entrega deve trazer: mudança de código e migração aditiva quando aplicável; teste de regra e de isolamento entre dois tenants; cenário de falha/retry para operação externa; logs sem segredos; prova reproduzível com data, versão, ambiente e limites; atualização de `docs/etapas/README.md`, `CHANGELOG.md`, manual/runbook e pendências. Para atos oficiais, acrescentar conferência humana e aprovação da Câmara. A CI deve executar os testes críticos de sessão, voto, mídia, autenticação, isolamento e migração, sem escrever em `db/custom.db`.

Indicadores mínimos do piloto: disponibilidade das rotas críticas e workers; atraso da outbox e convocações; comandos de presença/voto rejeitados ou repetidos; divergência de apuração; tempo de recomposição do telão; perda de quadros/áudio por destino e tempo de recuperação; integridade de replay; idade do último backup íntegro; tempo real de restore; incidentes de acessibilidade. Metas numéricas de SLA, RTO/RPO, banda, retenção e carga devem ser pactuadas com operação/Câmara antes do aceite, sem inventar valor nesta revisão.

## 7. Dependências externas e decisões

1. **Infraestrutura:** host de homologação separado, domínio/TLS, volumes/backup externo, monitoramento e acesso administrativo para fechar 045.
2. **Câmara:** regimento, composição, responsáveis, textos, regras de assinatura/publicação e casos para fechar 046–051.
3. **Audiovisual:** equipamentos, banda, conta/chave institucional e observador externo para fechar 052.
4. **Integração:** inventário real de Nextcloud/Alfresco/AD/LibreSign, contas de serviço de menor privilégio, ambiente de homologação e decisão de autoridade de ATA/PAUTA para 054–056.
5. **Fora do primeiro piloto:** voto secreto, votação offline, idiomas adicionais, marketplace, CKAN, cliente desktop e GraphQL. Reavaliar após o piloto e somente mediante necessidade; nunca usar esses itens como substituto dos gates 045–053.

**Próxima execução recomendada:** fase 0 (documentação e matriz de rastreabilidade), depois preparação automatizada da fase 1 e coleta institucional da fase 2. A ativação do piloto e das integrações continua condicionada às evidências específicas acima.
