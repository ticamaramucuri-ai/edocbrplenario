# Plano atualizado de conclusão — edocBR Plenário

**Revisão:** 13/10/2026. Este documento atualiza o [diagnóstico de base](DIAGNOSTICO-E-PLANO-DE-CONCLUSAO.md) com os incrementos executados depois da etapa 042. “Implementado” significa código e prova técnica local; “homologado” exige evidência e responsáveis da Câmara. A sequência 054–056 permanece no final, conforme a decisão de deixar Nextcloud e Alfresco para depois do plenário.

## Estado verificado

O repositório contém 27 diretórios de módulos, 186 rotas `route.ts` em `/api/v1`, 78 modelos Prisma e 48 arquivos `*.test.ts` no momento desta revisão. Esses números são inventário, não cobertura. A aplicação local principal usa SQLite; a stack sintética separada usa PostgreSQL persistente, Redis e serviços de tempo real, webhooks e scheduler. As migrações PostgreSQL 0001–0015 estão aplicadas na homologação local. O ensaio do telão percorreu três navegadores e dois nós, com congelamento, reconexão e troca de sessão. Nenhuma dessas provas declara produção ou uso oficial apto.

O pré-voo somente leitura de Mucuri executado nesta revisão retornou `automaticReady: false` (código de saída 2 esperado): a Câmara está ativa, porém faltam legislatura, mandatos, partidos, Mesa, responsáveis e políticas aprovadas; há zero usuários nos papéis de administração, Mesa e mídia, zero destinos sociais e zero sessões oficiais. A instalação consultada ainda usa SQLite e não tem transporte SMTP configurado. Nenhum desses dados foi preenchido por suposição.

| Fase | Situação do desenvolvimento | O que falta para encerrar |
|---|---|---|
| 043 — Linha de base | Concluída no repositório: inventário, CI e diagnóstico | Manter o inventário e a documentação sincronizados a cada mudança |
| 044 — Partidos e arquivos | Implementação local: emblema por partido/Câmara, fotos, inventário e restore sintético | Persistência e retenção aprovadas, restauração de acervo institucional |
| 045 — Fundação SaaS | Em andamento: PostgreSQL persistente de laboratório, leases, rate limit, SMTP capturado, backup/restore, carga, fanout, telão versionado e provas de falha | Infraestrutura fora do host de desenvolvimento, armazenamento durável, observador externo, SMTP institucional, RTO/RPO acordados e medidos, ensaio em equipamentos físicos |
| 046 — Configuração oficial | Código de checklist, versão, aprovação e bloqueio entregue | Regimento, composição, responsáveis e casos de Mucuri conferidos e aprovados |
| 047 — Preparação formal | PDFs/revisões, destinatários, convocações e auditoria implementados | Canal homologado, comprovante técnico de entrega/ciência, critérios regimentais validados |
| 048 — Condução e presença | Comandos idempotentes e isolamento por Câmara implementados; telão reconstruído em navegador | Dispositivos, acessibilidade e substituições/quórum testados no plenário |
| 049 — Votação oficial | Fluxos nominal e simbólico, confirmação independente, recibos e testes concorrentes implementados | Matriz regimental aprovada e conferência humana de casos reais anonimizados |
| 050 — Sigilo e continuidade | Proteção entregue: voto secreto oficial bloqueado e sem votação offline | Se necessários, redesenho criptográfico e arquitetura de contingência com revisão independente |
| 051 — Ata e transparência | Revisão/hash, publicação por outra pessoa, retificação e vínculo público implementados | Texto, assinaturas, retenção e publicação aprovados pela Câmara |
| 052 — Transmissão social | Controle de destinos, gravação/replay e conferência humana do link implementados; RTMPS local ensaiado | Conta/canal, câmera/áudio/banda, observador externo e sessão longa aceitos |
| 053 — Piloto Mucuri | Roteiro e pré-voo automatizado preparados | Dados oficiais, equipe, ambiente e aceite legislativo/técnico/audiovisual; piloto não iniciado |
| 054–056 — Nextcloud e Alfresco | Contratos e arquitetura propostos | Conectores, contas de serviço, leitura, reconciliação, escrita autorizada e reversão; iniciar só após 053 |
| 057 — Operação integral | Critérios de saída planejados | Aceite do fluxo integrado e rotina de monitoração/restore/suporte por Câmara |

## Próximas entregas na ordem de execução

1. **Fechar os ensaios técnicos que independem da Câmara:** expandir auditoria de acessibilidade para votação, presença com dados e telas móveis; testar jornada HTTP/WebSocket e telão sob carga simultânea; medir atraso e integridade do quadro em mudanças concorrentes. Cada prova deve usar dados sintéticos, falhar em divergência e ter comando repetível.
2. **Consolidar a implantação de homologação da fase 045:** separar host e armazenamento do desenvolvimento, documentar topologia, rotacionar segredos, verificar backup de banco e bytes com escritores pausados, restaurar em ambiente isolado e medir tempos. Registrar RTO/RPO observado sem anunciar meta institucional ainda não aprovada. Exercitar queda de Redis, banco, worker e rede, com observação externa.
3. **Preparar o pacote de validação institucional 046–049 e 051:** formulário de matriz regimental, casos de presença/voto/ata, papéis nominais e evidência de conferência humana. Não inserir nomes, mandatos, regras ou sessões oficiais por suposição. Implementar ajustes identificados na matriz depois de aprovada.
4. **Homologar comunicação e transmissão:** quando a Câmara fornecer relay, canais e equipamentos, provar entrega/ciência de convocação, transmissão privada em cada rede social, áudio/vídeo visto de fora, falha/retorno, gravação e replay. O link público só deve ser publicado após observação separada.
5. **Executar o piloto 053:** sessão fictícia longa com equipe real, leitor de tela e TVs, depois sessões assistidas, conferência independente de apuração/ata e aceite por área. Manter voto secreto oficial e votação offline indisponíveis até desenho e revisão próprios.
6. **Integrar Nextcloud e Alfresco no final:** iniciar por leitura e mapeamento de identidade externa/versão/hash/ACL; só depois publicar saídas aprovadas com outbox, idempotência e reconciliação. Encerrar com operação contínua da fase 057.

## Critério de acompanhamento

Cada próxima entrega precisa de código ou procedimento executável, prova reproduzível, resultado com data, limite explícito e atualização de `docs/etapas/README.md`, do [registro de pendências](PENDENCIAS-PRIORIZADAS.md) e deste plano. Nenhum teste local substitui assinatura de responsável institucional. Para a primeira operação oficial, 045–049 e 051–053 precisam de aceites aplicáveis; 050 permanece restrita se a modalidade secreta/contingência offline não fizer parte do escopo. As integrações 054–056 só entram após o piloto, conforme decisão do projeto.
