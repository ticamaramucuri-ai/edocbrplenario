# Pacote de execução da homologação — edocBR Plenário

**Preparado em:** 05/11/2026. **Estado em 07/11:** roteiro pronto; provas sintéticas externas de monitoramento e restauração executadas, mas rodada integral e aceite institucional não realizados. Referências: [plano mestre](PLANO-MESTRE.md), [topologia de staging](../deploy/staging/README.md), [recuperação](etapas/045-recuperacao-stack-postgres.md), [piloto Mucuri](etapas/053-preparacao-piloto-mucuri.md) e [formulários institucionais](aceite/README.md).

## 1. Abertura da rodada

Registrar em uma ficha privada da rodada: identificador, data/hora, host e domínio de teste, SHA do build, responsável de cada área, Câmara de ensaio, escopo, janela, metas de capacidade/RTO/RPO acordadas e local das evidências. Guardar credenciais no cofre do host, fora da ficha e do Git. A primeira execução usa **somente dados fictícios**, inclusive contas e canal de mídia de teste. A stack `staging-example` não deve compartilhar banco ou volumes com Mucuri.

| Entrada | Conferência antes de iniciar | Se faltar |
|---|---|---|
| Host separado e observador em outra máquina/rede | Domínio/TLS, relógio, proxy 443 e portas privadas; build imutável identificado | Manter fase 045 como ensaio local |
| Banco e acervo | PostgreSQL, Redis, workers, volumes duráveis para imagens, documentos, segmentos e replay; pacote de backup conjunto em destino separado | Não iniciar sessão assistida |
| Pessoas e regras | Secretaria/Presidência conferem composição, regimento e [casos de votação](aceite/048-049-casos.md); usuários nominais por papel | Não criar ato oficial |
| Audiovisual | Câmera, microfone, encoder, energia, banda, canal de teste e observador na página pública em outra rede | Não publicar link de transmissão |
| Comunicação e publicação | SMTP/canal de teste, responsáveis pela ata e segundo publicador; textos e retenção revisados | Manter entrega/publicação como pendência |

## 2. Diagnóstico técnico, antes das mutações

Os comandos de `staging-*` abaixo **escrevem ou interrompem a stack sintética** onde indicado; conferir a Câmara alvo e reservar a janela antes de executá-los. `staging-remote-check.py` deve rodar na máquina observadora, com credenciais de `platform_monitor` recebidas por `EDOCBR_PLATFORM_EMAIL` e `EDOCBR_PLATFORM_PASSWORD` em ambiente privado. O seed fictício cria `stage-platform-observer@example.invalid` para o laboratório. O serviço `mail` só deve constar em `--expect-services` após configurar SMTP/URL pública no app e iniciar o perfil `mail-lab`, conforme a [topologia de staging](../deploy/staging/README.md). Nunca passar senha na linha de comando nem publicar a saída integral do pré-voo sem revisão.

```bash
python3 scripts/staging-build.py --check
python3 scripts/staging-image-proof.py --include-mail
python3 scripts/staging-postgres.py stack-status
curl -fsS https://DOMINIO-DE-TESTE/api/v1/health?ready=1
python3 scripts/staging-remote-check.py \
  --base-url https://DOMINIO-DE-TESTE \
  --expect-services app,realtime,webhooks,scheduler,mail \
  --expected-version SHA-DO-BUILD \
  --output PROVA-PRIVADA/saude-externa.json
bun run pilot:preflight --tenant=SLUG-DA-CAMARA
```

O primeiro comando mostra o commit **fixado para o build**, que pode diferir de `HEAD`. A prova de imagem confere esse SHA na imagem e nos contêineres em execução; ela é local e não substitui a sonda da máquina observadora. Use `--include-mail` somente quando o perfil de correio estiver ativo. O pré-voo usa `DATABASE_URL` já injetada pelo ambiente/gerenciador de segredos do host, sem deixar URL e senha no histórico do shell. Ele retorna **2** quando há bloqueio, como esperado hoje para Mucuri. Guardar o JSON em local privado, registrar apenas contagens e códigos de verificação no relatório compartilhável. Conferir a seção `asset_references` e os hashes do pacote banco+arquivos. A sonda externa tem saídas 0 (saudável), 1 (degradado) e 2 (inacessível ou não verificável); qualquer resultado diferente de 0 bloqueia a rodada.

## 3. Roteiro de ensaio longo, com dados fictícios

| Ordem | Operação | Evidência mínima | Critério de parada |
|---:|---|---|---|
| 1 | Implantar e autenticar contas separadas em dois tenants; inspecionar permissões e versão | Saúde externa, versão, acesso permitido/negado por Câmara | Vazamento ou serviço crítico não verificável |
| 2 | Criar sessão, matérias, anexos, pauta e convocação; revisar e reenviar | Revisões, hashes, destinatários e recibo do canal de teste | Destinatário, versão ou anexo divergente |
| 3 | Abrir sessão; registrar presença, licença/suplência, impedimento, fala; desconectar/reconectar mesa e duas TVs | Quórum por ato, comandos únicos, estado reconstituído e fotos/emblemas corretos | Presença/base incorreta ou TV divergente |
| 4 | Votar casos nominais e simbólicos aprovados pela Câmara, inclusive empate e anulação; conferir por pessoa independente | Livro de apuração, votos/recibos, snapshot, ata e portal | Qualquer divergência de resultado ou quebra de sigilo |
| 5 | Transmitir vídeo/áudio para dois destinos de teste, perder um, recuperar e gravar; observar página externa | Horários, observação por destino, áudio/vídeo, link publicado/retirado, segmentos e replay | Publicação sem observação ou perda sem aviso/retirada |
| 6 | Encerrar sessão, revisar ata, colher assinatura aplicável e publicar por outra conta; retificar por novo ato | Versionamento, hashes, responsáveis e verificação pública | Ato publicado por papel indevido ou conteúdo divergente |
| 7 | Sustentar a jornada por período combinado, com leitores simultâneos e observador externo; executar matriz de falhas controladas | Latência/erros, eventos de degradação/recuperação e decisão de continuidade | Voto perdido/duplicado, recibo ou auditoria inconsistente |
| 8 | Fazer backup conjunto e restaurar em alvo isolado; ler foto, anexo, ata e replay por HTTP | Inventário, integridade, RPO/RTO observados e hashes dos bytes servidos | Arquivo ausente, hash divergente ou tempo acima da meta acordada |
| 9 | Ensaiar teclado, leitor de tela humano, TVs e suporte; registrar achados e correções | Ata de acessibilidade e operação assinada por cada área | Impedimento de operação por qualquer papel |

Para a carga sintética prévia, com a stack **exclusiva `staging-example`**, ativar `mail_worker` e `mailpit` com `docker compose --env-file deploy/staging/.env -f deploy/staging/compose.yaml --profile mail-lab up -d mail_worker mailpit`. Executar `python3 scripts/staging-media-drill.py`, `python3 scripts/staging-live-mixed-drill.py` e `python3 scripts/staging-fault-matrix.py --output PROVA-PRIVADA/falhas.json`. Para recuperação, usar `python3 scripts/staging-recovery-drill.py --require-media`; ele interrompe escritores e deve ter janela própria. A prova de duas telas está em `bun scripts/staging-display-browser.mjs`. A auditoria automatizada descartável roda com `bun run test:a11y:plenario`; a avaliação por pessoa permanece necessária. Os roteiros locais não substituem host, canal ou observador externos.

## 4. Matriz de evidências e aceite

| Área responsável | Confere e assina | Artefatos mínimos da rodada |
|---|---|---|
| Operação SaaS/TI | Rede/TLS, versão, isolamento, alertas, backup/restore, RTO/RPO e suspensão | Sonda externa, logs de mudança, inventário, hashes, tempos, topologia e runbook |
| Secretaria legislativa | Cadastro, pauta, convocação, prazos, presença, ata e publicação | Formulários 046/047/051, revisões e comparação com os registros do sistema |
| Mesa/Presidência | Regra, quórum, impedimento, suplência, votação e anulação | Matriz 046, 10–15 casos 048–049 anonimizados, livro de apuração assinado |
| Audiovisual | Vídeo/áudio em outra rede, dois destinos, falha/retorno, link e replay | Observações nominativas por destino, horários, arquivo, SHA-256 e decisão de publicação |
| Acesso e segurança | Contas nominais, papéis, trilha de auditoria, tenant e resposta a incidente | Matriz de permissões, negativas observadas e incidentes da rodada |
| Acessibilidade e suporte | Operação por teclado/leitor de tela, TVs e instruções de contingência | Lista de achados, correções e aceite de cada papel testado |

**Decisão da rodada:** cada área marca `aprovado`, `aprovado com restrição` ou `reprovado`, com nome, cargo, data, versão e referência de evidência. Uma restrição que afete resultado, identidade, acesso, transmissão ou recuperação bloqueia ato oficial. Registrar correção, repetir o passo afetado e colher novo aceite; não converter teste verde em assinatura institucional. A fase 053 só encerra com os aceites exigidos e pré-voo coerente. As integrações Nextcloud/Alfresco começam depois do piloto, nas fases 054–056.
