# Plano de Telas — edocBR Plenário Desktop

**Data:** 21/11/2026  
**Objetivo:** Definir todas as telas, fluxos e estados do aplicativo desktop (`edocBR Plenário Desktop`), cobrindo desde o pareamento inicial do servidor local da Câmara até a condução offline na LAN e reconciliação pós-sessão com a nuvem.

---

## Mapa das 6 Telas do App Desktop

| # | Tela | Papel Principal | Quando é usada | Prévia |
|---|---|---|---|---|
| 1 | **Pareamento, Identidade e Cofre** | TI / Operador | Instalação inicial ou troca de chave/serviço | `01-pareamento-identidade.png` |
| 2 | **Central de Sessões Importadas** | Secretaria / Operador | Antes da sessão, para baixar e verificar pacotes | `02-central-sessoes.png` |
| 3 | **Pré-Voo e Autoridade Local** | Operador / Mesa | Imediatamente antes de abrir a sessão na LAN | `03-pre-voo-autoridade.png` |
| 4 | **Mesa de Condução Local (LAN)** | Mesa Diretora / Operador | Durante toda a sessão deliberativa (com ou sem internet) | `04-mesa-conducao-local.png` |
| 5 | **Monitor de Rede LAN e Telões** | Operador / TI | Para parear tablets/TVs e diagnosticar quedas na LAN | `05-monitor-lan-teloes.png` |
| 6 | **Diário Assinado, Reconciliação e Backup** | Operador / Auditoria | Após a sessão ou retorno da internet, para enviar atos ao SaaS | `06-diario-reconciliacao.png` |

---

## Detalhamento Funcional por Tela

### Tela 1 — Pareamento, Identidade e Cofre Local
* **Objetivo:** Vincular o computador local à Câmara (tenant) no SaaS e proteger as chaves criptográficas.
* **Componentes principais:**
  * Estado do Serviço Residente (`systemd` Linux / `Windows Service`) — indica se continua ativo mesmo com a janela fechada.
  * Identidade do Dispositivo (`deviceId`, impressão digital SHA-256 SPKI da chave Ed25519 local, status `Registrado e Designado`).
  * Configuração de Rede: URL HTTPS do SaaS (`https://edocbrplenario.com.br`), porta e certificado TLS local na LAN (`https://192.168.x.x:3443`).
  * Chaves confiáveis do SaaS (`trust`) para validar assinaturas de pacotes e concessões.

### Tela 2 — Central de Sessões Importadas
* **Objetivo:** Baixar sessões preparadas na web e garantir 100% de integridade dos documentos antes da sessão.
* **Componentes principais:**
  * Indicador de conectividade WAN (Online vs Offline).
  * Lista de sessões preparadas com revisão da pauta, data/hora e status do pacote (`Íntegro`, `Pendente`, `Adulterado/Incompleto`).
  * Conferência item a item de manifesto e hashes SHA-256 dos PDFs privados das matérias.
  * Botão **"Sincronizar Pacotes Agora"** e **"Confirmar Importação (ACK)"**.

### Tela 3 — Pré-Voo e Concessão de Autoridade
* **Objetivo:** Garantir que nenhum ato oficial comece sem integridade, autoridade única e dispositivos prontos.
* **Componentes principais:**
  * Semáforo de Prontidão (Verde / Bloqueado) com motivo explícito de cada bloqueio.
  * **Checklist obrigatório:**
    1. Pacote e PDFs verificados (SHA-256 OK).
    2. Concessão de Autoridade Única obtida do SaaS (Época vigente + validade).
    3. Dispositivos conectados na LAN (Tablets dos vereadores + Telões).
    4. Gravação local / disco com espaço livre verificado.
  * Botões **"Assumir Autoridade Local"** (chama `grant`) e **"Abrir Sessão na Rede Local"** (liberado apenas quando todos os requisitos passarem).

### Tela 4 — Mesa de Condução Local (LAN)
* **Objetivo:** Conduzir presença, pauta, votação, fala/apartes e telões localmente, com zero dependência de internet.
* **Componentes principais:**
  * Barra fixa superior: Sessão ativa, Quórum atual (`Presentes / Exigido`), selo **"Operando em Rede Local (LAN)"** e contador de eventos no diário (`X eventos gravados localmente`).
  * Abas operacionais idênticas à Mesa web: **Presença**, **Pauta** (com vista, destaque, bloco), **Votação** (nominal/simbólica com recibos locais), **Discursos & Apartes** e **Telão**.
  * Nunca exibe "sincronizado com a nuvem" enquanto estiver offline — distingue claramente *Gravado no Diário Local* de *Confirmado no SaaS*.

### Tela 5 — Monitor de Rede LAN e Telões
* **Objetivo:** Facilitar a conexão de celulares/tablets dos parlamentares e TVs do plenário na rede interna.
* **Componentes principais:**
  * Endereço local + **QR Code** de acesso rápido para o Terminal do Vereador (PWA LAN) e para o Telão 1 / Telão 2.
  * Tabela em tempo real dos dispositivos conectados (Nome do vereador/tela, IP na LAN, último sinal/latência, versão do snapshot recebido).
  * Ações rápidas: **"Congelar Telões"**, **"Forçar Reenvio de Snapshot"** e **"Desconectar Dispositivo"**.

### Tela 6 — Diário Criptográfico, Reconciliação e Backup
* **Objetivo:** Garantir envio ordenado e auditável de todos os atos locais para a nuvem e cópia de segurança local.
* **Componentes principais:**
  * Resumo do Diário Assinado (`local-event-journal.ts`): último sequencial gravado, último sequencial confirmado pelo SaaS (`lastAckedSeq`), eventos pendentes e eventos em quarentena.
  * Tabela de eventos locais com `seq`, hora, comando, `commandId`, hash da cadeia e status (`Pendente` / `ACK SaaS` / `Quarentena`).
  * Ações: **"Verificar Integridade do Diário"**, **"Reconciliar Pendentes com SaaS"** (`pushLocalJournalBatch`), **"Devolver Autoridade para Web"** (`release`) e **"Exportar Backup Local (Banco + Mídia)"**.

