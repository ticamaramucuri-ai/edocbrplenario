# Fases que podem avançar sem conta institucional de rede social

**Data:** 11/10/2026 · **Estado:** roteiro em execução. As etapas 028, 029 e 032 têm prova local; 030 e 031 continuam em andamento para homologação operacional.

O ensaio local da etapa 027 comprovou RTMP→RTMPS, recuperação e segmentos H.264/AAC. A conta de YouTube, Facebook ou outra plataforma só é necessária para verificar ingestão, página pública, permissões, latência percebida e replay **nessa plataforma**. O desenvolvimento do núcleo legislativo, do SaaS e da gravação local pode continuar agora, usando Câmaras e sessões fictícias. O cadastro de Mucuri permanece institucional, sem inventar usuários ou fatos oficiais.

| Ordem | Fase proposta | Entrega verificável sem conta social | Critério de saída | Dependência externa ainda pendente |
|---|---|---|---|---|
| [028](etapas/028-replay-local-verificavel.md) | Integridade da gravação e replay local — implementada localmente | Manifesto por sessão com segmentos, duração, tamanho, SHA-256, codec e lacunas; vínculo auditável ao registro da sessão; publicação/retirada de replay com autorização e visibilidade configurável por Câmara. | Arquivo restaurado e reproduzido com áudio; alteração de segmento detectada; outra Câmara não acessa o original; portal mostra apenas replay autorizado. | Política de retenção e aceite do vídeo oficial pela Câmara. |
| [029](etapas/029-jornada-completa-ensaio.md) | Jornada completa de sessão em ensaio — verificada localmente | Criação, pauta, convocação, presença, fala, votação nominal/simbólica, correção, ata e encerramento, com queda simulada da mídia; duas Câmaras no mesmo teste. | Estado final, apuração, auditoria, portal e relatórios coincidem; voto e transição repetidos não duplicam atos. Concorrência/reconexão reais seguem para homologação. | Cenários regimentais reais para homologar resultado oficial. |
| [030](etapas/030-base-operacional-saas.md) | Base operacional do SaaS — em andamento | DDL e backup/restauração PostgreSQL em contêiner efêmero; aplicação e mini-serviços ainda exigem adaptação. Preservar o piloto SQLite até a migração ser demonstrada. | Instalação limpa, restauração, isolamento e reversão de falha testados com a aplicação. | Infraestrutura definitiva e metas contratuais de RTO/RPO. |
| [031](etapas/031-operacao-acessibilidade-capacidade.md) | Operação, acessibilidade e capacidade — em andamento | Checklist da sessão e mídia no painel; estados e ações textuais; teclado na aba; 21 votos e 40 leituras públicas simultâneas em SQLite/PostgreSQL. | Leitor de tela e carga HTTP/WebSocket em equipamento real ainda pendentes. | Equipamentos reais e equipe da Câmara para o aceite final. |
| [032](etapas/032-multiplos-destinos-locais.md) | Preparação técnica de múltiplos destinos — prova local concluída | Dois receptores RTMPS, falha independente, reativação e armazenamento medido; metadados de evento sem credenciais reais. | Uma falha não derruba o outro destino ou a gravação; comandos repetidos idempotentes e segredos ausentes da API. Votação sob falha simulada comprovada separadamente. | Contas, stream keys e regras atuais de cada rede para homologação externa. |

## Trabalho técnico que pode começar, mas não pode ser liberado como regra oficial

- **Políticas regimentais especiais:** preparar contratos, validação, versionamento e testes para voto da Presidência, desempate e casos de quórum. Manter desativado para uso oficial até receber o regimento, casos de exemplo e aceite da Casa.
- **Voto secreto:** revisar modelo de ameaça e separar elegibilidade da escolha. O modelo atual ainda associa `Vote.value` ao parlamentar no banco; portanto, não prometer sigilo oficial antes de revisão independente e redesenho aprovado.
- **Continuidade deliberativa sem internet:** desenhar autoridade local exclusiva, reconciliação e ensaios de conflito. Não anunciar votação offline como pronta antes de demonstrar ausência de divergências sob falha de rede/energia.

## O que realmente espera a conta institucional

Criação e permissões do evento na rede social, configuração da chave/URL real de ingestão, ensaio privado/não listado, confirmação de vídeo e áudio na página pública, medição de latência do espectador, estabilidade durante sessão longa e validação do replay hospedado na plataforma. A integração com Nextcloud e Alfresco continua reservada para a fase final do projeto, conforme a decisão de escopo do [plano funcional](PLANO-FUNCIONAL-EDOCBR-PLENARIO.md).

**Sequência em execução:** 030 ainda precisa migrar os mini-serviços e dados; 031 precisa homologação assistiva e carga em ambiente dedicado. A prova local de 032 está concluída, mas redes sociais e banda prolongada dependem de conta e infraestrutura. Cada fase recebe registro numerado em `docs/etapas/` com resultado e limites reais.
