# Etapa 092 — Jornada visual de matérias, protocolo e tarefas

**Data:** 10/11/2026 · **Estado:** executada localmente em build e banco descartáveis · **Comando:** `bun run test:workflow:browser`

## Objetivo

Cobrir a integração entre telas e API em um fluxo legislativo curto, ampliando a evidência existente de API/domínio para matéria, protocolo, tramitação e tarefa. Todos os registros usam dados sintéticos, com identificador aleatório, em uma instalação descartável; nenhuma instância de desenvolvimento, homologação ou produção é alterada.

## Jornada executada

Com Chromium headless via Playwright, o roteiro autenticou o usuário fictício seedado e percorreu:

1. cadastro de matéria urgente com autora;
2. registro de protocolo vinculado à matéria;
3. distribuição do protocolo para a matéria;
4. abertura da matéria em tramitação e registro de “Inclusão em pauta”, com destino “Incluída em pauta”;
5. criação de tarefa com prazo e vínculo à matéria e sua conclusão;
6. criação de uma nova versão integral da matéria com autoria;
7. vínculo tipado “Emenda” com outra matéria e nota explicativa;
8. upload de PDF privado da espécie “Parecer”, listagem no drawer e download com bytes conferidos.

Após as ações, o roteiro consultou as APIs locais e confirmou numeração/regime/autoria da matéria, estado e um andamento persistido, tarefa concluída, texto/autor da versão, alvo/tipo do relacionamento e metadados do anexo. O incremento de versões e vínculos é detalhado na [etapa 099](099-jornada-navegador-versoes-relacionamentos.md); o anexo privado, na [etapa 102](102-jornada-navegador-anexo-privado-materia.md).

## Reprodutibilidade e artefatos

- `scripts/test-workflow-browser.sh` prepara build standalone, banco SQLite temporário, seed sintético e servidor local isolado, limpando os recursos ao terminar.
- `scripts/local-workflow-browser.mjs` executa a jornada Playwright e as verificações de persistência.
- `package.json`: `test:workflow:browser` chama o wrapper.
- Reexecução nesta etapa: **passou**.

## Limites

É uma jornada representativa, não cobre todas as telas, campos, combinações de permissões ou estados. Permanecem pendentes, entre outros, busca e filtros visuais, demais operações de relação, histórico de múltiplas versões, pareceres independentes, modelos, veto/sanção na UI, cancelamento de tarefa, validações de erro, mobile e matriz de papéis. A etapa não atesta conformidade regimental nem substitui homologação pelos servidores da Câmara.
