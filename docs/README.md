# Documentação do edocBR Plenário

**Índice vigente em 07/11/2026.** Comece pelo [plano mestre](PLANO-MESTRE.md). Ele define escopo, estado, ordem de desenvolvimento e gates. O código e a prova datada prevalecem sobre afirmações antigas de conclusão; aceite institucional exige assinatura ou registro equivalente da Câmara.

## Onde encontrar a informação

| Pergunta | Fonte principal | Natureza |
|---|---|---|
| O que construiremos, em que ordem e com qual saída? | [Plano mestre](PLANO-MESTRE.md) | **Vigente**; atualizar em mudança de escopo/gate |
| Qual requisito tem código, teste, prova e gate? | [Matriz viva de entrega](MATRIZ-ENTREGA.md) | **Vigente**; atualizar em cada incremento |
| O que uma entrega realmente provou? | [Registro de etapas](etapas/README.md) e arquivos numerados | Evidência datada; não sobrescrever resultados antigos |
| Por que a arquitetura foi escolhida? | [ADRs](adr/) — sobretudo [núcleo local](adr/ADR-027-saas-nucleo-local-operacao-offline.md) | Decisão; criar novo ADR quando houver substituição |
| O que a Câmara precisa aprovar? | [Formulários de aceite](aceite/README.md) e [pacote de homologação](HOMOLOGACAO-PACOTE-EXECUCAO.md) | Modelo/roteiro, não aceite preenchido |
| Como entregar local → GitHub → VPS? | [Fluxo de entrega](FLUXO-ENTREGA-LOCAL-GITHUB-VPS.md) e [topologia de staging](../deploy/staging/README.md) | Procedimento operacional da homologação sintética |
| Como operar e recuperar? | [Runbook](runbook.md), [corte PostgreSQL](runbook-postgres-cutover.md) e provas da [etapa 045](etapas/045-recuperacao-stack-postgres.md) | O runbook geral contém trechos históricos de SQLite; verificar ambiente antes de executar |
| Como funciona o produto para cada papel? | [Manual do usuário](user-manual.md) | **Requer revisão antes do piloto**: ainda usa nome/contas da demonstração antiga |
| Como serão Nextcloud e Alfresco? | [Contrato de integração](integracoes/arquitetura-edocbr.md) | Proposta; ativação só após piloto e matriz de autoridade aprovada |
| Como será a transmissão? | [Documentos de transmissão](transmissao/) e [etapa 052](etapas/052-transmissao-social-assistida.md) | Técnica ensaiada; canal institucional pendente |
| Quais dados de Mucuri vieram de fonte pública? | [Levantamento público](LEVANTAMENTO-PUBLICO-MUCURI-2026-11-05.md) | Cadastro preparatório; conferir com a Câmara |
| Como registrar entrega e decisão de aceite? | [Modelo de etapa](modelos/REGISTRO-ETAPA.md) e [modelo de gate](modelos/DECISAO-GATE.md) | Copiar e preencher por rodada, sem segredos |

## Hierarquia e documentos históricos

1. **Escopo e prioridade atuais:** este índice + [PLANO-MESTRE.md](PLANO-MESTRE.md).
2. **Decisões técnicas:** ADRs. O ADR-027 registra a decisão posterior de incluir servidor desktop e sincronização local; essa decisão prevalece sobre planos antigos que adiavam o desktop.
3. **Implementação e operação:** código, configuração versionada, testes, runbooks e CI.
4. **Evidência:** `etapas/` e provas JSON com data, SHA, ambiente e limites. Uma evidência não é uma promessa de funcionamento futuro.
5. **Aceite:** `aceite/` preenchido por responsável, conforme escopo; formulário vazio não libera uso oficial.

Os documentos abaixo são **histórico de planejamento**, mantidos no mesmo caminho para não quebrar links. Consulte suas decisões e contexto, mas use o plano mestre para status e sequência atuais:

- [Plano de desenvolvimento de 05/11](PLANO-DESENVOLVIMENTO-ATUAL-2026-11-05.md) e [meta de execução](META-EXECUCAO-PLENARIO-2026-11-05.md);
- [Plano integral de 04/11](PLANO-INTEGRAL-2026-11-04.md) e [matriz de rastreabilidade de 04/11](MATRIZ-RASTREABILIDADE-2026-11-04.md);
- [Plano funcional](PLANO-FUNCIONAL-EDOCBR-PLENARIO.md), [plano diretor inicial](PLANO-DESENVOLVIMENTO-PLENARIO.md), [ROADMAP](ROADMAP.md), [plano de continuidade](PLANO-CONTINUIDADE-2026-10-20.md), [plano de 13/10](PLANO-ATUALIZADO-2026-10-13.md), [diagnóstico anterior](DIAGNOSTICO-E-PLANO-DE-CONCLUSAO.md), [pendências anteriores](PENDENCIAS-PRIORIZADAS.md) e [fases sem conta social](FASES-SEM-CONTA-SOCIAL.md).

O [CHANGELOG](CHANGELOG.md) é histórico de mudanças, não indicador de homologação. O [relatório de testes](test-report.md) registra execuções específicas; CI atual e evidências de etapa devem ser consultadas para estado recente.

## Conjunto documental exigido para produto real

| Artefato | Situação em 07/11 | Quando fechar / responsável funcional |
|---|---|---|
| Matriz viva requisito → código → teste → evidência → aceite | [Matriz de entrega](MATRIZ-ENTREGA.md) criada; contratos e provas do desktop entram conforme implementação | Atualizar em cada fase; engenharia e produto |
| Contrato de pacote web → desktop e sincronização bidirecional | ADR-027 define invariantes; esquema/API versionados não existem | P4; engenharia de domínio e desktop |
| Modelo de ameaça SaaS/LAN/desktop/dispositivos | Fragmentos em ADR e testes; revisão unificada pendente | Antes da API LAN e do voto offline; segurança |
| Matriz de autoridade e contingência sem internet | ADR-027 é direção; procedimento regimental/operacional precisa de aprovação | P4/P6/P10; Mesa, jurídico e operação |
| Guia de instalação Windows/Linux, certificados, atualização e reserva | Não existe | P5/P10; operação local |
| Runbook de backup recorrente e comutação com RTO/RPO | Restore sintético independente provado; destino durável e comutação pendentes | P1/P10; operação SaaS e Câmara |
| Catálogo de configuração por Câmara e migrações | Campos espalhados em código/etapas; falta referência única com padrões e versões | P2; produto e engenharia |
| Manual por papel com capturas e fluxo atual | Manual legado existe; nome e demonstração antiga precisam revisão | P7–P11; produto e suporte |
| Matriz regimental, composição, entrega, voto e ata aprovadas | [Modelos](aceite/README.md) disponíveis; ainda não preenchidos | P2/P3/P7/P8/P11; Câmara |
| Plano de testes de hardware, acessibilidade e mídia institucional | Ensaios sintéticos e roteiro existem; provas reais pendentes | P9/P11; operação, audiovisual e acessibilidade |
| Matriz de fonte de verdade, ACL e estados Nextcloud/Alfresco/assinatura | [Contrato proposto](integracoes/arquitetura-edocbr.md); inventário precisa reconfirmação | P12; TI, secretaria e jurídico |
| Política de privacidade, retenção, suporte, SLA e resposta a incidente | Pontos distribuídos em docs; versão contratual pendente | Antes de R3/R4; responsável institucional e operação |

## Regra de manutenção

- Toda mudança de escopo ou prioridade atualiza **primeiro** o plano mestre; ADR novo registra decisões estruturais. Não criar outro “plano atualizado” datado como concorrente.
- Cada incremento altera o arquivo de etapa existente ou cria um novo com: objetivo, arquivos, prova, versão, ambiente, resultado, limites, risco, próximo gate e responsável. Provas JSON não contêm credenciais ou dados pessoais desnecessários.
- Mudança que afeta operador atualiza runbook; mudança de interface atualiza manual; mudança de regra atualiza matriz de rastreabilidade e casos de aceite. Entrega sem esses artefatos permanece incompleta.
- Arquivos históricos continuam legíveis, com aviso de precedência. Evitar mover `etapas/`, ADRs e formulários: vários links cruzados dependem desses caminhos.
- Revisar links internos e referências de status a cada release. Em documentos compartilhados, distinguir “implementado”, “ensaiado”, “homologado” e “em operação” como no plano mestre.
