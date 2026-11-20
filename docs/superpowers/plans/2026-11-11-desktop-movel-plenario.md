# Plano de desenvolvimento — desktop e móvel do edocBR Plenário

**Data:** 11/11/2026  
**Estado:** proposta para revisão; mockups conceituais, sem habilitação de atos oficiais locais.

## Objetivo e ponto de partida

Entregar a jornada **web → desktop da Câmara → Mesa, parlamentares e telões na LAN → reconciliação → ata/portal**, mantendo uma única autoridade por sessão. A interface móvel inicial será a evolução da experiência parlamentar web existente; uma distribuição nativa só será escolhida quando uma necessidade concreta não couber na PWA.

O repositório já contém importação e verificação de pacotes, identidade do equipamento, processo Linux ensaiado, executável Windows compilado sem execução nesse sistema, contrato assinado de autoridade, reserva transacional e diário local com maior época persistida. Não há instalador validado, API LAN operacional, comandos oficiais locais nem reconciliação de atos. O módulo `src/modules/pwa` é mobile-first, mas a instalação PWA ainda não foi comprovada. O domínio público atual é homologação sintética.

Fontes: `docs/PLANO-MESTRE.md`, `docs/MATRIZ-ENTREGA.md`, `docs/adr/ADR-027-saas-nucleo-local-operacao-offline.md`, `docs/adr/ADR-009-pwa-parlamentar.md`, `docs/etapas/124-maior-epoca-autoridade-local.md`.

## Papéis e telas

| Papel | Primeira tela útil | Ações e feedback essenciais |
|---|---|---|
| Operador/Mesa no desktop | Pré-voo da sessão | Revisão e documentos verificados; dispositivos, telões e gravação; autoridade; último envio; bloqueios com ação concreta; iniciar somente quando todos os gates aplicáveis passarem. |
| Parlamentar no celular/tablet | Sessão atual | Pauta, documentos, presença, fala, votação quando aberta e recibo; estado da LAN e do servidor local sempre visível. |
| Telão | Estado público da sessão | Pauta, orador, quórum e apuração autorizada; recomposição por snapshot após desconexão. |
| Secretaria no SaaS | Preparação | Publicar revisão imutável, conferir importação e acompanhar reconciliação; nova revisão durante sessão não substitui a ativa silenciosamente. |

Os mockups em `docs/previews/desktop-mobile-plan/` representam essas intenções. Textos, posições e fluxos serão validados com Mesa, secretaria e usuários parlamentares. A tela nunca deve confundir “conectado” com “sincronizado”, nem exibir “voto registrado” antes de ACK durável.

## Sequência de desenvolvimento intercalada

Cada ciclo termina em software demonstrável com dados fictícios, testes, registro de limites e decisão sobre o próximo bloqueio. A sequência é por dependência, não por calendário fixo.

| Ciclo | Desktop/servidor local | Móvel/telão | SaaS/contratos | Prova de saída |
|---|---|---|---|---|
| 0 — linha de base | Inventário de binário, processo, importação, banco e chaves; protótipo de empacotamento Windows/Linux e comparação Tauri 2/alternativa | Inventário de `/me`, acessibilidade, instalação PWA e navegação em celular/tablet | Fixar contratos versionados e fixtures de duas Câmaras | Matriz do que realmente executa em cada SO/dispositivo; decisão técnica fundamentada. |
| 1 — leitura local | Serviço independente da janela, pacote completo verificado, pré-voo e API LAN/TLS de leitura para snapshot e PDFs | Sessão, pauta, documentos e estados de conexão consumindo servidor local; telão recompõe snapshot | Revisões publicadas e importadas sem troca silenciosa | Fechar janela não derruba serviço; pacote incompleto bloqueia prontidão; celular e telão recompõem após perda da LAN. |
| 2 — autoridade | Chave sob custódia, concessão assinada recebida, maior época e relógio verificados; comandos ainda em laboratório | Identidade nominal e autorização por papel, dispositivo vinculado; UX de bloqueio clara | Cercar todas as escritas web durante lease local e provar dois processos | Uma sessão tem um escritor; época antiga, tenant alheio, prazo vencido e concorrência são recusados. |
| 3 — atos locais | Executor determinístico de presença/fala/voto nominal e simbólico, diário e recibos persistidos | Comandos idempotentes; confirmação somente após ACK; reconexão por cursor/snapshot | Mesmo domínio/regras do executor web; matriz regimental independente | ACK perdido/repetição não duplica ato; dispositivo isolado não vota; resultado web/local coincide nos casos aprovados. |
| 4 — retorno ao centro | Outbox durável, arquivos com hash, retry, quarentena e recuperação de reserva | Fila e estado sincronizado compreensíveis; telão e Mesa mostram atraso real | ACK sequencial, dedupe, conferência, ata/portal após reconciliação | Queda/retorno de WAN e serviço não perde ato confirmado, não cria dupla autoridade e não publica resultado divergente. |
| 5 — produto instalável | Serviço/instalador assinados, atualização fora da sessão, backup conjunto e restauração em Windows/Linux | PWA instalável se seus requisitos forem atendidos; avaliar nativo com evidência de lacuna | Monitoramento, suporte e release por versão/SHA | Instalação limpa e restore em ambos os SO, dispositivos físicos e duas TVs; acessibilidade e operação longa aprovadas. |

O desenvolvimento de audiovisual/gravação local e o ensaio institucional acompanham os ciclos 4–5, com gate próprio P9/P10/P11. Voto secreto continua fora do escopo até projeto específico de sigilo. A decisão sobre votação offline no primeiro piloto institucional precisa ser tomada antes do escopo R3.

## Primeiro incremento executável

1. Inventariar `scripts/local-server.ts`, bibliotecas de transferência, diário, autoridade, `src/modules/pwa`, `/api/v1/me/*` e testes existentes; documentar exatamente o que o protótipo reutiliza.
2. Definir um contrato de leitura local versionado para identidade da Câmara, sessão/revisão, integridade do pacote, prontidão, snapshot/cursor e manifesto de documentos; separar estado de conectividade, autoridade e sincronização.
3. Implementar o serviço de leitura autenticada na LAN com TLS e identidade de dispositivo em ambiente de laboratório. O serviço deve sobreviver ao fechamento da janela; pacote parcial ou adulterado não ganha estado pronto.
4. Conectar uma tela de pré-voo desktop e uma tela móvel de sessão a esse contrato, com estados vazio, carregando, pronto, incompleto e conexão perdida. Não liberar escrita local nesse incremento.
5. Ensaiar Linux e Windows reais quando disponíveis, celular/tablet reais e duas telas; automatizar contratos, isolamento entre Câmaras, adulteração, reinício, perda/retorno de LAN e acessibilidade. Registrar ambiente, versão, resultados e limitações.

## Gates de qualidade e decisão

- **Domínio:** resultados da web e do futuro executor local usam as mesmas regras versionadas; duas Câmaras em todos os testes de autorização relevantes.
- **Segurança:** TLS LAN utilizável sem DNS externo, dispositivo e usuário nominais, credencial offline com prazo, chaves fora do banco, revogação, logs sem segredos e proteção de backup.
- **Operação:** serviço independente da interface, suspensão explícita quando falta autoridade, pacote ou servidor; atualização e promoção de reserva nunca automáticas durante sessão.
- **Experiência:** pré-voo explica bloqueios; parlamentar distingue comando enviado, ACK confirmado e reconciliação com SaaS; uso por teclado/leitor de tela e contraste conferidos.
- **Evidência:** teste automatizado, ensaio reproduzível, prova em hardware/SO real para afirmações correspondentes, SHA, CI e registro em `docs/etapas/` e `docs/MATRIZ-ENTREGA.md`.

**Decisões de produto a validar com a Câmara:** tempo máximo sem WAN, atos permitidos sem conexão, equipamento e operador de reserva, identidade/certificados dos dispositivos, política de instalação do móvel e aceite das regras regimentais. Até lá, o laboratório usa dados fictícios e não libera sessão oficial offline.
