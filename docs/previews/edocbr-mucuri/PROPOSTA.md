# Prévia — edocBR Plenário para a Câmara Municipal de Mucuri

**Estado:** proposta para revisão, 11/10/2026. Nenhuma mudança foi feita nas telas da aplicação ou no cadastro da base.

Abra [a prévia navegável](index.html) para conferir marca, cores, acesso, Mesa do Plenário, portal público e ficha inicial. A [imagem completa](preview-completo.png) registra a renderização desktop; [captura móvel](preview-mobile.png) registra a adaptação de layout.

## Decisões propostas

- Nome do produto: **edocBR Plenário**. O wordmark existente usa a grafia visual **e-docBR** e recebe o descritor **PLENÁRIO**.
- Paleta do produto: azul `#062F63`, azul profundo `#031F43`, ouro `#D9A441`, vermelho do logotipo `#BD3D4B` e fundo `#F5F8FB`. Estados de sucesso, falha, alerta e voto devem conservar significados semânticos próprios.
- A Câmara é identificada pelo brasão e pelo nome completo; a marca edocBR aparece como produto na área interna e como crédito discreto no portal público.
- Cadastro inicial proposto: nome **Câmara Municipal de Mucuri**, cidade **Mucuri**, UF **BA**, slug **camara-mucuri-ba**, fuso **America/Bahia** a confirmar. Não foram propostos usuários, parlamentares, legislatura, regimento, quórum ou credenciais de transmissão.

## Referências usadas

- Marca e paleta: cópias locais da identidade em `/home/suporte/Work/integracao-edocbr/edocbr-login/` e dos portais em `/home/suporte/Work/integracao-edocbr/preview-portais-20261010/`.
- Brasão: recurso local já usado na prévia institucional dos portais. O README do login edocBR informa que o brasão veio do site público da Câmara; confirmar autorização institucional de uso no Plenário antes da publicação.
- Identificação pública da Câmara: [site institucional](https://camaramucuri.ba.gov.br/).

## Aplicação após revisão

Adaptar componentes de marca, tokens de cor, título/metadados e telas; cadastrar o tenant em migração/rotina não destrutiva e idempotente, mantendo os tenants demonstrativos isolados; usar parâmetros regimentais apenas depois da validação da Casa. Verificar contraste, desktop/celular, portal, telão, autenticação e transmissão antes de liberar o ambiente piloto.
