# 046 — Matriz regimental

**Câmara:** ______________________________ **Legislatura:** ____________
**Assinam:** Secretaria legislativa **e** Presidência.

Marque uma opção por pergunta. Cada opção listada é uma que o sistema já cumpre.
Onde marcar **Outro**, descreva — isso vira ajuste de desenvolvimento antes de
qualquer cadastro, não cadastro imediato.

---

## 1. Tipos de sessão em uso

Marque **todos** os que a Câmara realiza (o sistema recusa criar sessão de tipo
não habilitado):

- [ ] Ordinária
- [ ] Extraordinária
- [ ] Solene
- [ ] Especial

## 2. Quórum

**2.1 Quórum mínimo de instalação** (número de parlamentares presentes para
abrir a sessão): `_____`

> O sistema registra a abertura com quórum insuficiente como alerta, não como
> bloqueio — a decisão de abrir é da Presidência e fica auditada.

**2.2 O quórum de deliberação é o mesmo da instalação?**

- [ ] Sim, o mesmo número
- [ ] Não — por tipo de matéria, conforme a tabela do item 3

## 3. Maioria exigida por tipo de matéria

Uma linha por tipo. Regra: **maioria simples** (mais votos entre quem votou),
**maioria absoluta** (mais da metade da composição) ou **unanimidade**.
Quórum mínimo é o número de presentes exigido para abrir a votação daquele tipo.

| Tipo de matéria | Maioria simples | Maioria absoluta | Unanimidade | Quórum mínimo |
|---|:---:|:---:|:---:|---|
| Projeto de lei | [ ] | [ ] | [ ] | `_____` |
| Decreto legislativo | [ ] | [ ] | [ ] | `_____` |
| Requerimento | [ ] | [ ] | [ ] | `_____` |
| Indicação | [ ] | [ ] | [ ] | `_____` |
| Moção | [ ] | [ ] | [ ] | `_____` |
| Emenda | [ ] | [ ] | [ ] | `_____` |

Tipo de matéria que a Câmara usa e não está na lista: ______________________

## 4. Desempate pela Presidência

O sistema apura empate como **empate** e **não** aplica desempate automático:
o voto de desempate (Minerva) é ato manual da Presidência, registrado e
auditado — hoje por nova votação ou por registro em ata.

- [ ] Está correto: o desempate é ato manual da Presidência, registrado em ata
- [ ] A Presidência vota sempre, junto com os demais
- [ ] A Presidência só vota para desempatar, e isso deve ser automático no
      sistema → **NÃO IMPLEMENTADO**, vira ajuste de desenvolvimento
- [ ] Outro: ______________________________________________

## 5. Base de quem pode votar

O sistema congela a lista de votantes na abertura de cada votação. Escolha o
critério:

- [ ] **Parlamentares ativos** — todo parlamentar ativo compõe a base
- [ ] **Mandato e licença** — a base considera mandato vigente na legislatura e
      exclui quem está licenciado, incluindo o suplente em exercício

## 6. Impedimentos

Quando um parlamentar está impedido de votar certa matéria:

- [ ] A Câmara **não** usa registro de impedimento no sistema (desabilitado)
- [ ] **Mantém a base**: o impedido não vota, e o denominador da maioria absoluta
      continua o mesmo
- [ ] **Reduz a base**: o impedido sai do denominador da maioria absoluta

O impedimento exige justificativa escrita de, no mínimo, 10 caracteres, visível
a quem tem papel de condução, auditoria ou direção legislativa.

## 7. Licenças e suplência

Tipos que a Câmara registra (marque todos):

- [ ] Licença
- [ ] Afastamento
- [ ] Suplência

**7.1 Suplente em exercício conta para o quórum e vota?**

- [ ] Sim, como qualquer parlamentar durante o período de exercício
- [ ] Não
- [ ] Outro: ______________________________________________

## 8. Alteração de voto

- [ ] O parlamentar **pode** alterar o voto enquanto a votação está aberta
- [ ] Não pode: o primeiro registro é definitivo

## 9. Resultado parcial durante a votação

- [ ] O painel público **mostra** a contagem parcial
- [ ] O painel público **oculta** a parcial por padrão, e a Mesa libera quando quiser

## 10. Modalidades indisponíveis — ciência

Assinale para registrar ciência de que, neste piloto:

- [ ] **Voto secreto oficial está bloqueado em código.** A modalidade não pode ser
      usada em sessão oficial. Liberá-la exige redesenho criptográfico, revisão
      independente e nova decisão da Câmara.
- [ ] **Votação offline não existe.** Sem rede entre o plenário e o servidor, a
      votação não ocorre pelo sistema.

---

## Assinaturas

| Papel | Nome | Cargo | Data | Assinatura |
|---|---|---|---|---|
| Secretaria legislativa | | | | |
| Presidência | | | | |

> Sem as duas assinaturas, a configuração oficial não é cadastrada e a fase 046
> permanece aberta.
