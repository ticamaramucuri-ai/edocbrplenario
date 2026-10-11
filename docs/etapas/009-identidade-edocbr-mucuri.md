# Etapa 009 — Identidade edocBR e cadastro inicial de Mucuri

**Data:** 11/10/2026 · **Estado:** concluída no ambiente local para identidade e cadastro mínimo; implantação e homologação institucional pendentes.

## Objetivo e entrega

A marca exibida no aplicativo passa a ser **edocBR Plenário**, com marinho e dourado da identidade edocBR e brasão de Mucuri. As telas de entrada, navegação, portal público, telão, metadados e favicon foram atualizados. O tenant `camara-mucuri-ba` foi registrado na base local com nome, cidade, UF, fuso, cores e brasão. A seleção padrão usa Mucuri fora do modo demo; o modo demo continua abrindo a Câmara fictícia para não confundir testes com dados oficiais.

O cadastro não cria usuário, parlamentar, legislatura, sessão, matéria, assinatura ou dado oficial. O script `bun run db:register:mucuri` é idempotente e preserva o registro existente. O seed de demonstração agora recusa limpar uma base que contenha qualquer Câmara fora das duas fictícias. O backup da base local antes do cadastro está em `db/custom.db.backup.mucuri-20261011`.

Arquivos principais: `public/brand/`, `src/components/brand/brand-logo.tsx`, `src/app/globals.css`, `src/lib/server/default-tenant.ts`, `scripts/register-mucuri.ts`, `prisma/seed.ts` e o [preview aprovado](../previews/edocbr-mucuri/PROPOSTA.md).

## Verificação

- Cadastro repetido em cópia isolada: a segunda execução não alterou o registro. Integridade SQLite `ok`; nenhum usuário/sessão criado.
- Seed demo na mesma cópia falhou antes de apagar dados, como exigido.
- A base local recebeu somente o tenant institucional. Verificar com `bun run db:register:mucuri` e consulta por slug.
- `bun run typecheck`, `bun run lint` e `bun run build` passaram após a alteração visual e de seleção padrão. `bun run test:security`, `bun run test:media:domain` e `bun run test:media:integration` passaram. Conferência visual no navegador local mostrou o brasão/nome de Mucuri e a entrada institucional; a troca de perfil demo e a mensagem de demonstração foram ocultadas fora desse modo.

## Limites e etapa seguinte

A marca usa ativos locais existentes. Cores, brasão, redação institucional e dados reais de Mucuri dependem de aceite da Câmara antes de uso público. O logo no cadastro e na interface não equivale a autorização para publicação oficial. A Câmara ainda precisa fornecer regimento, composição vigente, responsáveis, perfis, contas de transmissão, equipamentos e confirmação do fluxo de documentos. Nenhuma sessão oficial deve ser aberta com o cadastro vazio.

A próxima frente é o [plano funcional](../PLANO-FUNCIONAL-EDOCBR-PLENARIO.md): regimento, criação e condução de sessão, presença, votação e transmissão. A integração descrita em [arquitetura-edocbr.md](../integracoes/arquitetura-edocbr.md) fica para a fase final, após o piloto funcional. A frente de mídia mantém como bloqueios a medição do sinal/gravação com hardware real, alertas, recuperação de falhas e homologação por destino social.
