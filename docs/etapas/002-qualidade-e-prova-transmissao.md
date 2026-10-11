# Etapa 002 — Qualidade e prova de transmissão

**Data:** 10/10/2026 · **Estado:** em andamento. O escopo local foi implementado e testado; CI remoto, equipamentos reais, destinos sociais e falhas de rede aguardam execução/homologação.

## Objetivo e entregas

Tornar os controles de qualidade verificáveis e provar a cadeia técnica de transmissão antes de expor controles ao operador.

1. Corrigida a assinatura genérica de `apiHandler`, eliminando 115 erros de tipo comuns às rotas sem enfraquecer `NextRequest`. Tipos explícitos corrigidos em board, licença, protocolo e tarefas; erros de contrato corrigidos em migração, relatórios, cliente de API, notificação e webhooks. Os mini-serviços passaram a usar os tipos de `Statement` do Bun. `tsconfig.json` inclui os tipos Bun e exclui exemplos e o cliente de teste antigo do realtime, que não integra o produto. `bun run typecheck` passou; `next.config.ts` deixou de ignorar falhas de TypeScript.
2. Criado [CI](../../.github/workflows/ci.yml) para instalação congelada, geração Prisma, lint, tipos, testes de segurança, build e prova de mídia em job separado. A pasta `.git` desta cópia está vazia/read-only: o workflow ainda não rodou em GitHub.
3. Criada [prova de mídia reproduzível](../transmissao/prova-local.md): fonte sintética H.264/AAC, ingestão RTMP, encaminhamento RTMPS com certificado temporário verificado, métricas e gravações em dois servidores MediaMTX v1.21.2. O [script](../../scripts/media-smoke.sh) usa arquivos temporários e não exige chaves sociais.
4. Especificado o [contrato inicial do Painel de Transmissão](../transmissao/painel-operacao.md): papéis, estados, destinos independentes, gravação, incidentes e isolamento do motor deliberativo.

## Evidência local

- `bun run typecheck`: **passou**, sem erros (baseline anterior: 186 erros).
- `bun run lint`: **passou**.
- `bun run test:security`: **3 testes, 0 falhas**.
- `MEDIAMTX_BIN=/tmp/legis-mediamtx-1.21.2/mediamtx scripts/media-smoke.sh`: **passou**; origem e destino RTMPS `ready`; gravações H.264/AAC confirmadas por `ffprobe`. Binário oficial validado por SHA-256 da release.
- `bun run build`: **passou** com TypeScript habilitado. O sandbox local bloqueou a busca de `next/font/google`; repetido com rede, compilou em 11,7 s, gerou as páginas e o pacote standalone. O CI terá de alcançar `fonts.googleapis.com` enquanto essas fontes forem obtidas no build.

## Limites e próxima etapa

O teste local não demonstra estabilidade de uma rede social nem operação real de plenário. Também faltam cenário de reconexão, perda de WAN/energia, áudio real, retorno da plataforma e medição de qualidade/latência. Não há credenciais no projeto. A presença do workflow não equivale a execução remota.

**Etapa seguinte, 003 — Painel e homologação de mídia:** implementar modelo/API de transmissão com autorização, idempotência, auditoria e adaptador MediaMTX; colocar métricas e estados no painel; automatizar recuperação/falha local e validar gravação contínua; depois ensaiar com câmeras, mesa de som, rede e canal institucional autorizados da Câmara piloto. A saída exige operação completa por usuário de comunicação e evidência de gravação/reconciliação em falha controlada.
