# Estudo de telão para 13 cadeiras

Prévia conceitual de duas cenas 1920×1080 com Câmara, nomes, partidos e regras **fictícios**. O mínimo de quórum de 7 é apenas um valor ilustrativo: a regra real virá da configuração regimental aprovada para a Câmara e para o ato.

- `telao-presenca-13.png`: mostra todas as 13 cadeiras, inclusive ausentes, total e último horário confirmado.
- `telao-resultado-13.png`: exemplo de resultado **nominal já encerrado**, com 8 favoráveis, 2 contrários e 3 sem voto registrado. A divulgação individual depende da modalidade e da política pública aprovada; durante a votação, não mostrar escolhas parciais.
- `mockup.html`: fonte editável dos estudos; parâmetros `?view=presenca` e `?view=resultado`.

O código atual em `src/modules/display/` já possui perfis de boas-vindas, presença, pauta, votação, discurso e encerramento, além de estado durável para perfil manual, tela congelada/limpa e recomposição. A presença atual lista somente `presentMembers`; a grade completa de 13 cadeiras é uma proposta de produto, dependente de uma lista pública de composição com situação de cada cadeira. O serviço LAN do desktop e o ensaio em TVs físicas continuam pendentes.
