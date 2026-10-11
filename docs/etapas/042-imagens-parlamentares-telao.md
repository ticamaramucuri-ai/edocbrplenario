# Etapa 042 — Foto do parlamentar e emblema do partido

**Data:** 11/10/2026 · **Estado:** implementação local concluída.

O cadastro e a edição de parlamentares aceitam foto e emblema do partido opcionais (JPG, PNG ou WebP de até 5 MB). A interface pré-visualiza as imagens, permite removê-las e mantém iniciais/sigla quando não existem. A foto e o emblema aparecem nos cartões de parlamentares, na presença da mesa e no telão: presença, orador e lista de votação nominal divulgável. Votações secretas continuam sem lista nominal.

O endpoint de upload exige `parliamentarian.write`, resolve a Câmara do ator e converte as imagens para WebP com limite de pixels e dimensões. Os arquivos são gravados por tenant em `upload/parliamentarian-images/`, com nomes aleatórios; a API de cadastro aceita apenas URLs desse tenant. O endpoint de leitura é público porque o telão e o portal não exigem login. O campo `photoUrl` já existia; `partyEmblemUrl` foi acrescentado ao SQLite e à migração PostgreSQL `0003_parliamentarian_images.sql`.

**Validação:** typecheck, lint e build de produção aprovados; upload HTTP autorizado retornou 201, sem credencial retornou 401, URL de outro tenant foi recusada (422), e a imagem pública foi servida como WebP (200). O arquivo de ensaio foi removido. A suíte de isolamento de URL cobre tenant diferente e tentativa de travessia de caminho. O diff da migração PostgreSQL 0003 corresponde ao DDL gerado pelo Prisma. A base SQLite local recebeu a coluna nova após backup.

**Operação:** para implantação com múltiplas instâncias, `upload/parliamentarian-images/` precisa ser um volume persistente compartilhado ou migrado para armazenamento de objetos. O backup do banco, isoladamente, não guarda as imagens. Arquivos enviados e não vinculados ao cadastro ainda exigem limpeza periódica. Como o emblema é associado ao registro do parlamentar nesta etapa, duas pessoas do mesmo partido podem ter imagens diferentes; a gestão de identidade partidária centralizada deve ser tratada antes da implantação institucional.

**Próxima etapa:** homologar imagens e arquivos persistentes com o backup/restauração PostgreSQL e serviços auxiliares, incluindo recuperação após falha de processo e revisão da gestão centralizada de partidos. Integrações Nextcloud/Alfresco continuam reservadas para o fim do projeto.
