# Etapa 053c — Fotos públicas dos parlamentares de Mucuri

**Data:** 05/11/2026. **Estado:** importação local concluída; conferência institucional pendente.

Os 13 perfis da legislatura atual no [portal da Câmara de Mucuri](https://camaramucuri.ba.gov.br/vereadores/) vinculam retratos individuais. O cadastro local recebeu essas fotos sem alterar nome, partido, mandato, regra regimental ou usuários. A tela de parlamentares e o telão já exibiam `photoUrl`; agora há arquivos locais para os 13 vereadores de Mucuri.

O script `scripts/import-mucuri-photos.ts` associa cada nome ao arquivo publicado pelo portal, fixa o SHA-256 do JPEG, valida formato e tamanho e produz WebP com os mesmos parâmetros do upload de fotos. Usa URL e diretório do tenant; não substitui uma foto diferente já cadastrada. A execução padrão mostra prévia; `--apply` só grava após conferir todos os perfis e arquivos. Uma falha antes da transação remove arquivos recém-criados. A execução repetida é idempotente.

**Comandos de verificação local:**

```bash
DATABASE_URL='file:../db/custom.db?connection_limit=1&socket_timeout=30' bun scripts/import-mucuri-photos.ts
bun run typecheck
bun run test:images:parliamentarian
```

**Evidência de 05/11:** prévia inicial 13/13 pendentes; após `--apply`, 13/13 URLs no banco e 13/13 WebP presentes; nova prévia 0 pendentes. Backup SQLite anterior à importação em `/tmp/edocbr-mucuri-pre-fotos.db` (arquivo local temporário, não solução de backup de produção).

**Pendente:** a Câmara deve conferir identidade, atualidade e autorização de uso das fotos para o piloto. Os emblemas dos partidos continuam vazios: os perfis públicos consultados identificam as siglas, mas não fornecem arquivos oficiais verificáveis para todos os sete partidos. O cadastro e o telão já aceitam emblemas quando a Câmara fornecer os arquivos. O armazenamento das imagens precisa migrar para volume durável na homologação fora deste computador.
