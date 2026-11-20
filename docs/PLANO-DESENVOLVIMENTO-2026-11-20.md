# Plano de Desenvolvimento Atualizado — edocBR Plenário (v3.0)

**Data da revisão:** 20/11/2026  
**Repositório oficial:** `ticamaramucuri-ai/edocbrplenario`  
**Ambiente ativo de homologação:** `https://edocbrplenario.com.br` (VPS `5.183.35.108`)  
**Base considerada:** Diagnósticos, matriz de entrega, parecer comparativo PainelDesk, plano mestre v2.0 e etapas concluídas até a **Etapa 125**.

---

## 1. Linha de Base Real em 20/11/2026

### O que já está sólido e operante
1. **Infraestrutura e Repositório (Novo Ciclo):**
   - Código migrado integralmente (branch `main`, histórico, tags e 33 branches) para `ticamaramucuri-ai/edocbrplenario`, sem vínculo com a antiga organização.
   - Deploy isolado ativo na VPS (`5.183.35.108`) via Docker Compose (`postgres:16`, `redis:7.4`, `app`, `realtime`, `webhooks`, `scheduler`, `gateway` Caddy), exposto via Nginx + Certbot SSL + Cloudflare em `https://edocbrplenario.com.br`, coexistindo sem interferência com Hermes, Paperclip e OpenBot.
   - 26 migrações PostgreSQL aplicadas com sucesso.

2. **Núcleo Web / SaaS (Etapas 078–125):**
   - **Landing & Entrada:** Landing page institucional unificada e Login Split Vault estabilizados (etapa 123).
   - **Deliberação & Votação:** Fluxo web de sessão, pauta, presença, quórum, cronômetro de fala, votação nominal e simbólica (inclusive opções customizadas, empate e anulação), testado sob concorrência em SQLite e PostgreSQL com duas instâncias HTTP (etapas 086–118).
   - **Telão & PWA:** Comunicação em tempo real via Socket.io + Redis Streams, perfis de tela, congelamento/descongelamento e retentativa idempotente no PWA do parlamentar após erros 429/503 e ACK perdido.
   - **Relatórios & Auditoria:** Geração de atas e espelhos em PDF A4 paginados sem cabeçalhos órfãos, pauta separada e cadeia de auditoria verificável (etapas 119–122, 125).
   - **Matérias, Protocolos & Busca:** Cadastro, protocolo, anexos privados em PDF com hash, grafo de matérias relacionadas, modelos versionados, busca unificada e analytics.

3. **Fundações do Núcleo Local / Offline (Etapas 050, 058–075, 124):**
   - Contrato de transferência de sessão v1, exportação de contexto congelado com anexos privados, assinatura digital, identidade criptográfica do equipamento, CLI de sincronização Linux/Windows, diário local de eventos assinado, reserva transacional de autoridade e persistência da maior época (`etapa 124`).

### Principais Lacunas (Gaps) para Produção
1. **Motor Local e Autoridade Operacional (P4–P6, P10):** Ainda não há API LAN executando atos oficiais (presença, fala, voto) no servidor desktop, nem cercamento efetivo dos escritores web durante concessão local, nem reconciliação automática desktop → SaaS.
2. **Operação Contínua da Nova VPS (P1):** Deploy inicial subiu com tag `local-unversioned`; falta ativar promoção versionada por SHA, rotina de backup automatizado off-host (banco + volumes de mídia/fotos) e observabilidade externa apontada para a nova VPS.
3. **Fechamento Web/Relatórios (P7–P8):** Faltam retificação de ata, tratamento de falha de download, validação de impressão física, matriz completa de permissões (RBAC) em todas as rotas e revisão visual humana.
4. **Insumos Institucionais (P2–P3, P9, P11):** Validação oficial da Câmara de Mucuri (regimento, composição, contas, equipamentos locais, canal audiovisual e termos de aceite).

---

## 2. Novo Plano de Desenvolvimento (Trilhas e Marcos)

O desenvolvimento passa a ser organizado em **5 Trilhas Executáveis**, permitindo avanço paralelo entre infraestrutura, web e núcleo local, respeitando os gates de dependência até o piloto institucional (**R3**) e produto integrado (**R4**).

---

### Trilha 1 — Consolidação da Infraestrutura, CI/CD e Backups (Curto Prazo / Imediato)
*Objetivo: Tornar o ambiente `edocbrplenario.com.br` auditável, versionado por SHA e recuperável.*

1. **Promoção Versionada na VPS:**
   - Integrar a branch de trabalho atual (`codex/autoridade-epoca-local`, incluindo etapa 125) à `main` após revisão/testes.
   - Atualizar `.github/workflows/ci.yml` e `staging-observer.yml` para operar no repositório `ticamaramucuri-ai/edocbrplenario`.
   - Configurar `STAGE_BUILD_VERSION=<SHA>` na VPS e validar `scripts/promote-vps.sh` ponta a ponta.
2. **Backup Durável e Recuperação:**
   - Configurar rotina agendada (systemd timer ou cron) executando `scripts/backup-bundle.py` para banco PostgreSQL + volumes (`parliamentarian_images`, `media_recordings`, `media_replay`) com envio cifrado para destino externo (off-host).
   - Realizar 1 ensaio cronometrado de restauração completa (medindo RTO/RPO).
3. **Observabilidade e Segurança de Host:**
   - Garantir alertas de queda de containers/serviços ou disco sem interferir com Hermes, Paperclip e OpenBot.
   - Definir limites (`deploy.resources.limits`) no Compose do edocBR para proteger a RAM da VPS.

**Gate de Saída (M1):** Build versionado por SHA ativo em `/api/v1/health`, backup externo automatizado testado com restore limpo e observador externo verde.

---

### Trilha 2 — Fechamento da Camada Web, Relatórios e RBAC (Curto/Médio Prazo)
*Objetivo: Eliminar pendências funcionais da interface web, atas e segurança multi-tenant.*

1. **Atas, Retificação e Portal Público (P8):**
   - Implementar e testar fluxo de retificação de ata por novo ato (append-only com vínculo à ata original).
   - Cobrir falhas de exportação/download de PDF e JSON na UI, além de conferência em impressão física A4.
   - Validar segregação estrita entre minuta interna e publicação oficial no portal público (apenas após aprovação de segundo papel).
2. **Matriz Completa de Papéis e Multi-tenancy (P2):**
   - Percorrer todas as famílias de API e telas testando acesso negativo entre dois tenants distintos e entre todos os perfis (Admin, Secretaria, Mesa, Parlamentar, Audiovisual, Público).
3. **Resiliência Telão + Mesa + PWA (P7 Web):**
   - Consolidar suíte E2E cobrindo comandos visuais completos da Mesa, alertas sonoros de fala, queda/reconexão de WebSocket com recomposição de estado por cursor/snapshot e múltiplos perfis de telão simultâneos.

**Gate de Saída (M2):** Zero falhas críticas em matriz RBAC/multi-tenant, retificação de ata operante e suíte E2E de sessão web verde na VPS.

---

### Trilha 3 — Núcleo Local, Autoridade Única e Operação LAN (Médio Prazo — Foco Crítico)
*Objetivo: Entregar o servidor local designado por Câmara capaz de conduzir a sessão na LAN com ou sem internet e reconciliar com o SaaS sem perda ou duplicação.*

1. **Fase 3.1 — Cercamento (Fencing) e Concessão de Autoridade (P6):**
   - Cercar escritores web no SaaS: enquanto uma sessão tiver concessão ativa para um servidor local (época vigente), mutações deliberativas na web são bloqueadas.
   - Expor endpoints de concessão, renovação, revogação e promoção controlada de reserva.
2. **Fase 3.2 — Motor de Execução Local e Diário Criptográfico (P4/P6):**
   - Extrair regras determinísticas de presença, quórum, fala e votação para um núcleo compartilhado (mesmo resultado no web e no local).
   - Ligar comandos de presença, fala e voto ao diário local (`local-event-journal.ts`), exigindo época válida e gerando recibo persistido com ACK.
3. **Fase 3.3 — API LAN, Tempo Real Local e Pré-Voo (P5):**
   - Disponibilizar servidor HTTP/WebSocket local no processo desktop para atender Mesa, PWA dos parlamentares e até 2 Telões na rede local (LAN), com TLS local/certificado e descoberta estável.
   - Implementar tela/painel de **Pré-Voo da Sessão**: verifica pacote baixado, hashes dos PDFs, autoridade ativa, conectividade dos dispositivos e espaço de gravação. Bloqueio claro se o pacote estiver incompleto.
4. **Fase 3.4 — Reconciliação Desktop → SaaS (P6):**
   - Implementar envio sequencial de eventos do diário local + arquivos gravados para o SaaS, com deduplicação por `commandId`, ACK durável e quarentena de eventuais conflitos.
   - Exibir no SaaS/Portal o indicador real de sincronização (online/em lote/atraso).
5. **Fase 3.5 — Empacotamento e Segurança Local (P5/P10):**
   - Empacotar serviço residente independente de janela (Systemd no Linux / Windows Service ou wrapper Tauri 2) com armazenamento protegido, atualização fora de sessão e backup local rápido.

**Gate de Saída (M3/M4):** Ensaio ponta a ponta em hardware real na LAN: preparar na web → importar no desktop → pré-voo → conduzir presença/fala/voto/telão com corte proposital de internet → restaurar internet → reconciliar 100% dos votos/ata sem duplicidade.

---

### Trilha 4 — Audiovisual, Gravação Local e Replay (Paralelo)
*Objetivo: Garantir gravação contínua independente de internet e transmissão social segura.*

1. **Integração Encoder / MediaMTX / Replay (P9):**
   - Validar captura contínua local em disco durante queda de internet, com geração de hash de integridade ao encerrar a sessão.
   - Validar envio simultâneo RTMPS para canais institucionais (YouTube/redes) sem acoplar ou atrasar a votação em caso de falha de rede.
   - Vincular o replay público autenticado/validado à página da sessão encerrada e à ata publicada.

**Gate de Saída (M6):** Sessão teste com câmera e áudio reais gravada localmente, transmitida para destino externo e reproduzida via replay após encerramento.

---

### Trilha 5 — Homologação Institucional, Piloto Mucuri e Expansão (P11–P13)
*Objetivo: Validar em uso real assistido e preparar escala para outras Câmaras.*

1. **Configuração e Aceite de Mucuri (P2/P3/P11):**
   - Preencher e validar com a Secretaria/Presidência de Mucuri os formulários em `docs/aceite/`: composição da legislatura, fotos oficiais, matriz regimental, usuários nominais e canal de convocação.
   - Treinamento presencial/remoto com Mesa Diretora, Secretaria e equipe Audiovisual.
   - Execução de **Sessão Simulada Completa (Ensaio Geral / R2)** e posterior **Piloto Institucional Assistido (R3)** com plano de contingência.
2. **Integrações Institucionais e Multi-Câmara (P12–P13 / R4):**
   - Ativar conectores Nextcloud / Alfresco (leitura e arquivamento de atas/pautas assinadas via outbox com ACK e reversão).
   - Validar onboarding de uma segunda Câmara sem nenhuma alteração de código específico.
   - Nota de segurança: **Voto secreto** permanece desabilitado até projeto criptográfico de sigilo e auditoria independente específicos.

---

## 3. Próximos Passos Imediatos (Sprint Atual)

1. **Consolidar o Git Local:** Revisar e integrar as alterações de `codex/autoridade-epoca-local` (incluindo Etapa 125) na `main` e atualizar a VPS com build versionado pelo SHA oficial (saindo de `local-unversioned`).
2. **Atualizar Workflows:** Ajustar `.github/workflows/` para o novo repositório `ticamaramucuri-ai/edocbrplenario` e validar CI verde.
3. **Configurar Backup da VPS:** Implantar o timer de backup off-host do PostgreSQL e volumes Docker na VPS `5.183.35.108`.
4. **Iniciar Trilha 3 (Fase 3.1):** Implementar o cercamento (fencing) dos escritores web quando houver concessão de autoridade local ativa.
