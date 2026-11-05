# Levantamento público para cadastro — Câmara Municipal de Mucuri

**Consulta e importação local:** 05/11/2026. As fontes abaixo são páginas públicas da própria Câmara. A composição, os partidos e os cargos precisam de conferência institucional antes da homologação.

**Execução:** tenant `camara-mucuri-ba` já existente; cadastrados 7 partidos e 13 parlamentares na base SQLite local por `bun scripts/import-mucuri-public-roster.ts --apply`, após backup `db/custom.db.backup.mucuri-public-roster-20261105T210908Z`. Os quatro cargos da Mesa exibida atualmente foram preenchidos em `Parliamentarian.boardRole`. A segunda execução foi idempotente: 0 novos registros. A API de parlamentar passou a aceitar `segundo_secretario`, já previsto na interface. Na sequência, `bun scripts/import-mucuri-terms.ts --apply` cadastrou uma legislatura 2025–2028 sem número ordinal, 13 mandatos e 8 posições temporais da Mesa (4 confirmadas para 2025–2026 e 4 eleitas para 2027–2028, ainda sem posse). As duas execuções foram repetidas sem duplicar registros. Antes das mudanças do modelo e da base, foram criados os backups `db/custom.db.backup.mucuri-terms-20261105T212317Z` e `db/custom.db.backup.mucuri-board-status-20261105T212615Z`. Nenhum usuário ou sessão foi criado. O pré-voo segue com `automaticReady: false`.

## 1. Identificação e atendimento

| Campo candidato | Valor encontrado | Uso no edocBR Plenário |
| --- | --- | --- |
| Nome | Câmara Municipal de Mucuri | Nome do tenant, sujeito à conferência da denominação oficial |
| Município / UF | Mucuri / BA | Cadastro do tenant |
| Endereço | Rua Oscar Teixeira de Siqueira, nº 290, Bairro Malvinas, CEP 45.930-000, Mucuri/BA | Contato institucional/portal, se o produto dispuser de campo próprio |
| Atendimento | Segunda a sexta, das 07h às 13h, ressalvados feriados e pontos facultativos | Informação pública; não determina calendário de sessões |
| Sessões plenárias | Terça-feira, 09h | Sugestão para agenda; confirmar exceções e calendário oficial |
| Telefones gerais | (73) 3206-1077; (73) 99827-1105 | Contato institucional |
| Ouvidoria | (73) 99926-5271 | Contato específico |
| E-mails | camara@camaramucuri.ba.gov.br; protocolo@camaramucuri.ba.gov.br; ouvidoria@camaramucuri.ba.gov.br | Contatos públicos, não credenciais de usuário |
| Portal | https://camaramucuri.ba.gov.br/ | Referência pública |
| Legislatura | 2025–2028 | Período candidato; **número ordinal não encontrado nessa página** |

Fonte: [portal institucional](https://camaramucuri.ba.gov.br/) e [página de vereadores](https://camaramucuri.ba.gov.br/vereadores/). O `slug` interno `camara-mucuri-ba` é escolha técnica do projeto, não dado extraído do portal. O fuso já configurado é `America/Bahia` e deve ser confirmado na implantação. A etapa [053a](etapas/053a-contatos-institucionais.md) acrescentou campos próprios para endereço, CEP, telefones, e-mails, site e horários por Câmara. Os 11 campos foram preenchidos na base local de Mucuri, sem alterar as demais Câmaras.

A [notícia oficial da Prefeitura sobre a posse de 01/01/2025](https://mucuri.ba.gov.br/posse-historica-robertinho-e-empossado-na-prefeitura-de-mucuri-pela-4a-vez/) confirma a posse dos 13 vereadores e a eleição da Mesa atual nessa data. É a fonte das datas iniciais dos mandatos e da Mesa cadastrados.

## 2. Vereadores da legislatura 2025–2028

Os nomes de urna/apresentação aparecem na [página inicial](https://camaramucuri.ba.gov.br/). Os partidos aparecem na [listagem institucional de vereadores](https://camaramucuri.ba.gov.br/vereadores/), complementada pela [notícia oficial de junho de 2026](https://camaramucuri.ba.gov.br/tudo-pronto-para-a-votacao-da-ldo-2027/) para Fernando Batista dos Santos. A grafia de “Júnior” e a capitalização das siglas devem ser revisadas antes da importação.

| Nome publicado | Nome de apresentação | Partido publicado |
| --- | --- | --- |
| Hélio Alvarenga Penha | Dr. Hélio da Fisioterapia | PSDB |
| Carlos de Jesus Brito | Carlinhos da Ótica | PSB |
| Willian Crisma da Cruz | Willian Crisma | Podemos |
| Fernando Batista dos Santos | Fernando da Gazzinelli | Republicanos |
| Ademilson Ferreira Neves | Dema | PP |
| Douglas Souto Buchacra | Dodô | Republicanos |
| Ediney Alves de Oliveira | Diney Drinks | PP |
| Edison Silva de Mattos | Sula Policial | Podemos |
| Felipe Pereira Tigre | Felipe do Ônibus | PSD |
| Geneval Pereira Miranda | Valzinho Embalador | União Brasil |
| Pamela Honorato Bremer Seixas | Pamela Seixas | Podemos |
| Paulo Gomes Mota | Paulo do Carvão | PSB |
| Roberto Silva dos Santos Junior | Roberto Júnior | União Brasil |

O sistema tem campos para `Parliamentarian.name`, `displayName`, `party`, `photoUrl` e `partyEmblemUrl`, além de cadastro de `Party` e `Mandate`. A listagem pública permite preparar os nomes e partidos; **mandatos efetivos, suplências, afastamentos, blocos e comissões vigentes exigem fonte e conferência próprias**. Páginas individuais, por exemplo [Hélio Alvarenga Penha](https://camaramucuri.ba.gov.br/vereadores/helio-alvarenga-penha/) e [Pamela Seixas](https://camaramucuri.ba.gov.br/vereadores/pamela-honorato-bremer-seixas/), oferecem contatos de gabinete e imagens públicas. Importar fotos e emblemas exige verificar arquivo, qualidade, atribuição e correspondência com o partido vigente. Dados biográficos pessoais não são necessários ao cadastro operacional.

## 3. Mesa Diretora com vigência

| Período | Presidente | Vice-presidente | 1º secretário | 2º secretário | Estado em 05/11/2026 |
| --- | --- | --- | --- | --- | --- |
| Mesa exibida no portal atual | Hélio Alvarenga Penha | Carlos de Jesus Brito | Willian Crisma da Cruz | Fernando Batista dos Santos | Atual segundo o portal; confirmar datas formais de início/fim |
| 01/01/2027 a 31/12/2028 | Pamela Honorato Bremer Seixas | Ademilson Ferreira Neves | Carlos de Jesus Brito | Felipe Pereira Tigre | Eleita; posse prevista para 01/01/2027 |

Fontes: [portal institucional](https://camaramucuri.ba.gov.br/) e [notícia oficial da eleição da Mesa 2027–2028](https://camaramucuri.ba.gov.br/por-unanimidade-pamela-seixas-e-escolhida-para-presidir-a-camara-de-mucuri-no-bienio-2027-2028/). O cadastro de `BoardPosition` precisa respeitar datas. A Mesa eleita para 2027 **não deve substituir a Mesa atual antes da posse**.

## 4. Processo legislativo e transmissão

- O portal disponibiliza pauta, atas, Diário Oficial, transparência, e-SIC, Regimento Interno e Lei Orgânica. São fontes para mapear tipos documentais e o fluxo de publicação, não para ativar uma integração automática sem contrato de dados e homologação.
- A [página de perguntas frequentes](https://camaramucuri.ba.gov.br/institucional/perguntas-frequentes/) informa transmissão das sessões por YouTube, Instagram e rádio. Isso apoia o levantamento de destinos de transmissão. **Ainda faltam os URLs dos canais oficiais confirmados, responsáveis, autorização de uso e chaves de ingestão** para configurar ou testar a retransmissão do edocBR Plenário.
- Há um [PDF de Regimento Interno publicado no portal](https://camaramucuri.ba.gov.br/arquivos/2021/03/RegimentoInterno_MucuriBA_ATUALIZADO-23-12-20.pdf). Como pode haver alterações posteriores, seus parâmetros de quórum, votação, prazos e tipos de sessão só devem entrar após revisão de versão consolidada e aprovação institucional.

## 5. Ordem sugerida para o cadastro posterior

1. Validar nome, endereço, contatos, fuso e identidade visual com a Câmara.
2. Confirmar número da legislatura, lista e situação dos 13 mandatos; cadastrar partidos e parlamentares, com imagens verificadas.
3. Registrar a Mesa vigente e a Mesa eleita como períodos separados, com atos e datas de vigência.
4. Validar versão atual do Regimento, Lei Orgânica, comissões e políticas de sessão/votação com a secretaria legislativa.
5. Criar usuários nominais e permissões mediante indicação dos responsáveis; endereço público de gabinete não autoriza criação de conta.
6. Homologar canais oficiais, URL pública e autorização para transmissão; cadastrar chaves de ingestão em armazenamento de segredos.
7. Reexecutar o pré-voo do piloto e registrar o aceite dos responsáveis.

Até essa validação, o cadastro local serve como **base de conferência**, sem declarar o piloto institucional pronto. O número ordinal segue `null` e aparece na interface apenas como período. A Mesa eleita para 2027–2028 está marcada como `elected`: não passa a ser vigente pela passagem do tempo; sua posse requer confirmação com referência ao ato. As datas finais representam os limites dos biênios/quadriênio publicados e precisam ser revistas se houver afastamento, substituição ou alteração. O pré-voo ainda aponta responsável institucional, política de votação, aprovação, usuários, PostgreSQL, SMTP e mídia pendentes.
