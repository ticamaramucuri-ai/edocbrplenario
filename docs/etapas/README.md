# Registro de execução do plano

Cada etapa do [plano diretor](../PLANO-DESENVOLVIMENTO-PLENARIO.md) terá um arquivo numerado neste diretório. O registro deve conter: objetivo, mudança entregue, arquivos principais, verificações com resultado, limitações conhecidas, decisão técnica e critérios de entrada/saída da etapa seguinte. Uma etapa só recebe estado **concluída** quando os critérios de saída foram demonstrados; trabalho parcial permanece **em andamento**.

| Etapa | Estado | Entrega | Próxima dependência |
|---|---|---|---|
| [001 — Segurança de acesso e base de mídia](001-seguranca-acesso-midia.md) | Concluída para o escopo definido | Perfil demo isolado, token de tempo real, pesquisa de software de transmissão | Baseline de tipos/CI e prova de mídia com equipamentos reais |
| [002 — Qualidade e prova de transmissão](002-qualidade-e-prova-transmissao.md) | Em andamento | Tipos e CI local, RTMP→RTMPS com gravação/métricas, contrato do painel | CI remoto e homologação com mídia real |
| [003 — Painel de transmissão: fonte local](003-painel-transmissao-local.md) | Em andamento | API/aba de acompanhamento local com RBAC, idempotência, auditoria e perda de sinal | Controlador, destinos sociais e operador audiovisual dedicado |
| [004 — Destinos RTMPS](004-destinos-rtmps.md) | Em andamento | Papel audiovisual, API de controle MediaMTX e prova local RTMP→RTMPS com gravação | Contas reais e homologação audiovisual |
| [005 — Gravação e resiliência](005-gravacao-e-resiliencia.md) | Em andamento | Catálogo de segmentos no painel e prova local de arquivos H.264/AAC | Alertas, falhas prolongadas e hardware real |
| [006 — Intenção e reconciliação](006-intencao-reconciliacao-midia.md) | Em andamento | Comando 202 durável, worker com lease/retry, notificações e recuperação após reinício | Supervisão, monitoramento externo, falhas prolongadas e PostgreSQL |
| [007 — Saúde operacional da mídia](007-saude-operacional-midia.md) | Em andamento | Heartbeat persistido, verificador com código de saída e timer de exemplo | Alertas externos, ensaios de falha e homologação no piloto |
| [008 — Concorrência entre destinos](008-concorrencia-destinos-midia.md) | Concluída para o escopo definido | Lease por caminho entre processos evita sobrescrita de destinos | Teste com réplicas reais e infraestrutura piloto |
| [009 — Identidade edocBR e Mucuri](009-identidade-edocbr-mucuri.md) | Concluída localmente para o escopo definido | Identidade visual aplicada e tenant institucional mínimo, com seed demo protegido | Plano funcional e dados regimentais de Mucuri; piloto audiovisual. Integrações externas só ao final |
| [010 — Preparação da sessão](010-preparacao-sessao.md) | Concluída localmente para rascunho/numeração | Criação não publica pauta, confirmação explícita, contador anual transacional e teste da jornada | Pauta versionada, checklist institucional e homologação com Mucuri |
| [011 — Política de publicação por Câmara](011-politica-publicacao-saas.md) | Concluída para o escopo inicial | Tipos, secretário e mínimo de matérias por tenant; edição de rascunho; revisão 1 | Emendas versionadas à pauta |
| [012 — Emendas à pauta publicada](012-emendas-pauta-publicada.md) | Concluída localmente para o escopo definido | Prévia e confirmação de inclusão, reordenação e retirada, com revisão e motivo públicos | Convocação formal e política regimental por Câmara |

O plano diretor define a direção do produto; este diretório registra o que foi realmente implementado e testado. Evidências e limites devem ser atualizados no mesmo arquivo quando surgir uma correção da etapa.
