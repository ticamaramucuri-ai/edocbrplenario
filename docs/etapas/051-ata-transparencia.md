# Etapa 051 — Ata e transparência

**Data:** 11/10/2026 · **Estado:** incremento técnico entregue; aprovação institucional do texto, assinatura e retenção pendente.

A minuta estruturada deixou de afirmar que foi “lida e aprovada” apenas por a sessão ter sido encerrada. A publicação do tipo `ata_sessao` exige vínculo com sessão da mesma Câmara. Após o encerramento, uma pessoa revisa o rascunho integral e registra referência da conferência; o servidor grava SHA-256 de título, conteúdo e sessão. A publicação exige outra identidade e compara novamente o texto com o hash aprovado. Editar o rascunho apaga a revisão. O documento publicado recebe SHA-256 próprio do conteúdo e mantém o texto imutável. Uma sessão só pode ter uma ata publicada vigente; correção ocorre por revogação justificada e novo ato numerado, preservando o histórico do anterior.

O portal relaciona a sessão à ata publicada, ao código de verificação e ao hash do texto. Quando há replay publicado, expõe também o SHA-256 do vídeo e do manifesto. A leitura pública da ata confere o hash gravado, além da cadeia de assinaturas; alteração indevida do conteúdo marca a integridade como inválida e bloqueia novas assinaturas. As assinaturas existentes continuam vinculadas à publicação original. Essa associação usa o ID da sessão, sem depender ainda de Nextcloud ou Alfresco.

**Verificação:** `bun run test:official:closure` cobre Câmara divergente, revisão com hash obsoleto, exigência de duas pessoas, edição que invalida a revisão, publicação, consulta pública, assinatura, adulteração detectada, revogação e nova ata. A suíte passou em SQLite e PostgreSQL. `bun run test:postgres:foundation` aplica a migração 0011, copia e reconcilia 75 tabelas e restaura backup. Lint, tipos, jornada e build passam.

**Limites:** a referência da conferência é digitada pelo responsável, sem validação externa. A assinatura atual é eletrônica interna com HMAC e atesta o documento publicado; não é assinatura qualificada ICP-Brasil. Não há aceite regimental do texto, dos signatários exigidos, prazo de publicação ou retenção. O hash do vídeo vincula os artefatos na mesma sessão, mas não comprova observação da rede social. Publicações legadas sem `publishedContentSha256` aparecem com integridade não comprovada e exigem revisão/migração assistida; o sistema não inventa hash retroativo.

**Próximo trabalho:** obter a matriz institucional de aprovação/assinatura e ensaiar a jornada com usuários reais. A fase 052 depende de canal social, equipamentos e observação externa; Nextcloud/Alfresco permanecem nas fases 054–056.
