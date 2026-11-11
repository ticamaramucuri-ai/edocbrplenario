# 103 — Jornada local de modelos de documento e versionamento

**Estado:** L1 parcial executada em build e SQLite descartáveis · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Cobrir o ciclo editorial principal de modelos: criar um modelo, visualizar o Markdown, renderizar placeholders no servidor, publicar uma nova versão com nota obrigatória e restaurar uma versão anterior sem reescrever o histórico.

## Execução e evidência

Comando: `bun run test:workflow:browser` (build standalone e Chromium local requeridos). O runner cria banco/tenant de demonstração temporários e limpa os recursos ao encerrar. Na interface “Modelos de Documento”, Playwright criou uma ata em Markdown com `{{camara}}`, conferiu a aba Preview do editor e abriu o preview renderizado no servidor sem alerta de token conhecido não resolvido.

Na edição do corpo, o botão “Salvar nova versão” permaneceu desabilitado enquanto faltava a nota obrigatória. Com a nota preenchida, a versão 2 foi criada e o corpo atualizado apareceu no render do servidor. No Histórico, a restauração da versão 1 criou a versão 3; o render voltou ao conteúdo inicial e a API preservou a sequência 1, 2 e 3. Desativar e reativar também passou pela API, preservando a versão 3 e o estado ativo final. Saída do runner: `ok: true`, `synthetic: true`, browser `Playwright Chromium`.

## Limites

O fluxo visual cobriu o tipo “Ata de sessão” e um placeholder conhecido. Desativar/reativar foi verificado por API, sem exercício dos diálogos de confirmação. Continuam pendentes outros tipos, limites/validações, acessos de leitura e escrita por papel/tenant, tokens de sessão/matéria com contexto real, publicação gerada vinculada e sua trilha, histórico sob concorrência e mensagens de erro da interface.
