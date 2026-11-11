# Proposta de landing page — edocBR Plenário

**Estado:** prévia visual para decisão, 10/11/2026. Não altera a aplicação, a rota pública ou o ambiente de homologação.

## Objetivo

Apresentar o edocBR Plenário a dirigentes, equipes legislativas e áreas de tecnologia de Câmaras Municipais. A visita deve permitir entender o fluxo do produto, distinguir o que já foi ensaiado do que ainda depende de homologação e solicitar uma demonstração contextualizada.

## Direção visual

- **Marca:** usar o wordmark edocBR Plenário existente, sem brasão de nenhuma Câmara na comunicação comercial.
- **Cores:** azul profundo `#031F43`, azul institucional `#062F63`, fundo claro `#F5F8FB`, texto `#15263E`, dourado `#D9A441` e branco. Dourado indica marcos do fluxo, não estados de sucesso ou falha.
- **Tipografia:** Geist para conteúdo e controles; Georgia para as chamadas principais, em diálogo com a identidade já aprovada no produto.
- **Composição:** conteúdo alinhado à esquerda, grades com assimetria controlada e telas ilustrativas grandes. A sequência operacional ocupa o centro da narrativa.
- **Imagem:** quadros de interface ilustrativos, desenhados com a terminologia real do sistema. Não usar fotos genéricas de plenários, brasões de clientes, métricas ou depoimentos sem autorização e comprovação.

## Conteúdo e navegação

1. **Abertura:** promessa direta sobre preparar, conduzir e documentar sessões; imagem da Mesa com pauta, presença e votação. Ações: “Solicitar demonstração” e “Conhecer o fluxo”.
2. **Fluxo legislativo:** quatro etapas com resultado concreto de cada uma: preparação, sessão, registro e transparência.
3. **Operação em detalhe:** pauta e convocação; presença, quórum e votação; discursos e telões; transmissão e gravação; ata, publicações e portal; auditoria e permissões.
4. **Portal público:** visual separado da área interna para explicar o que o cidadão poderá consultar quando a Câmara aprovar os dados e canais.
5. **Confiança e implantação:** isolamento por Câmara, perfis de acesso, registros auditáveis, revisão humana de conteúdo assistido por IA e preparação para homologação institucional. Explicar o estado do servidor local e da operação sem internet com precisão.
6. **Demonstração:** formulário ou canal comercial a definir antes da implementação; indicação de que a demonstração usa dados fictícios e não equivale a sessão oficial.
7. **FAQ e rodapé:** dúvidas de implantação, equipamentos, dados e acesso público; política de privacidade, contato institucional e acesso ao sistema quando os destinos forem confirmados.

## Funcionalidade prevista na implementação

- Navegação por âncoras, menu móvel acessível e estados de foco visíveis.
- CTA com destino real a ser definido; formulário, se escolhido, com consentimento específico, proteção contra abuso e aviso de privacidade.
- Capturas reais do sistema ou ilustrações marcadas como demonstração; conteúdo e metadados em português brasileiro.
- Layout responsivo, contraste, teclado, movimento reduzido, texto alternativo, SEO básico e carregamento rápido. Usar [WCAG 2.2 nível AA](https://www.w3.org/TR/wcag/) como meta técnica de verificação e considerar as recomendações do [eMAG 3.1](https://www.gov.br/governodigitallogin/pt-br/acessibilidade-e-usuario/acessibilidade-digital/modelo-de-acessibilidade) para o contexto brasileiro; não alegar conformidade antes de auditoria.
- Eventos mínimos de conversão sem dados pessoais em analytics; links de política e contato válidos.
- Se houver formulário, coletar apenas os dados necessários ao contato, informar finalidade e tratamento em aviso claro e definir retenção e responsável antes de ativá-lo, em linha com os princípios de [finalidade, necessidade e transparência da LGPD](https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_tratamento_de_dados_pessoais_pelo_poder_publico).

## Critérios editoriais

O sistema web, a votação, os relatórios, o portal e a auditoria possuem implementação e ensaios com dados fictícios. O domínio atual é homologação sintética. O piloto de Mucuri não está liberado como sessão oficial. A operação local completa sem internet, os conectores institucionais e a homologação audiovisual real permanecem pendentes. Essas capacidades não devem aparecer como disponibilidade atual irrestrita. Não usar selos de conformidade, percentuais, quantidade de Câmaras atendidas nem depoimentos não comprovados.

## Etapas após aprovação desta prévia

1. Definir canal de contato e destino do CTA, conteúdo de privacidade e autorização dos ativos de marca.
2. Produzir a landing na aplicação existente, preservando a entrada atual e separando a página pública da área autenticada.
3. Substituir telas ilustrativas por capturas atualizadas de um ambiente fictício, com dados revisados.
4. Revisar redação e capacidades com a matriz de entrega vigente.
5. Verificar desktop e celular, navegação por teclado, contraste, formulário/CTA, metadados e desempenho antes de publicação.

## Fontes internas

- `README.md`, `docs/PLANO-MESTRE.md` e `docs/MATRIZ-ENTREGA.md`.
- `docs/previews/edocbr-mucuri/PROPOSTA.md` e `src/app/globals.css` para identidade existente.
- Módulos em `src/modules/` e rotas públicas em `src/app/api/v1/public/`.
