# P3/P4 — leitura seletiva e limite do pacote local

**Estado em 09/11/2026:** implementado e ensaiado localmente com dados fictícios. PR, CI e staging serão registrados após revisão.

## Entrega

A emissão agora persiste o manifesto canônico em `LocalSessionTransferIssue.manifestJson`, junto ao SHA-256 e aos recibos já existentes. O GET de um artefato confere emissão, Câmara, dispositivo, revisão publicada corrente, hash do manifesto e recibos; lê somente o documento ou anexo congelado solicitado e compara nome, MIME, tamanho e SHA-256 com o manifesto. Emissões anteriores à migração `0025_transfer_issue_manifest.sql`, sem esse campo, mantêm o caminho de pacote integral. O cliente continua a verificar a assinatura Ed25519 e todos os bytes antes de preparar a revisão e enviar ACK.

O plano SaaS pode definir `maxTransferPackageMiB` entre 1 e 512 MiB. O console exibe e aceita o limite na criação do plano; a API de planos valida criação e atualização. A emissão rejeita com `PLAN_LIMIT` (402) quando a soma dos artefatos ultrapassa o limite do plano da Câmara. Sem valor no plano, vale o teto técnico de 512 MiB e 500 artefatos. O limite controla **um pacote por sessão**, não o armazenamento total da Câmara.

## Prova e limites

`bash scripts/test-session-transfer-export.sh` passou com emissão e GET seletivo, adulteração do artefato pedido, manutenção de outro arquivo íntegro, manifesto persistido inválido, compatibilidade com emissão legada e limite de plano de 1/2 MiB. `bash scripts/test-postgres-foundation.sh` passou com 25 migrações, scheduler, backup/restauração e 83 tabelas. `bun run typecheck`, `bun run lint` e `bun run build` passaram. **CI e promoção:** pendentes nesta redação inicial.

O ensaio de quota usou cerca de 1 MiB em banco descartável. Ainda faltam medição com PDFs representativos, duas Câmaras concorrentes, observador externo e teste de pico de memória. A emissão inicial continua a materializar o pacote completo para assinar o manifesto; este incremento reduz o custo dos GETs seguintes. Não estabelece quota agregada de armazenamento, largura de banda ou retenção institucional. A política comercial e os valores por Câmara exigem aprovação antes do piloto.

## Próxima prova

Medir a preparação e os GETs sob carga com duas Câmaras e documentos grandes; definir capacidade e alertas de armazenamento. Depois, construir o serviço local supervisionado Windows/Linux e a API LAN protegida conforme P5/P10.
