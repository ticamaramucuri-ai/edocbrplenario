# 047 — Canal de convocação, prazos e comprovante de ciência

**Câmara:** ______________________________
**Assina:** Secretaria legislativa.

O sistema emite a convocação junto com cada revisão da pauta e guarda um
SHA-256 do conteúdo: qualquer alteração posterior gera nova revisão, com novo
hash, sem apagar a anterior. O que falta decidir é o canal, os prazos e a forma
do comprovante.

---

## 1. Prazos regimentais

| Prazo | Horas | Observação |
|---|---|---|
| Antecedência mínima da convocação | `_____` | O sistema recusa publicar pauta abaixo deste prazo, salvo exceção do item 2 |
| Antecedência mínima para emenda à pauta | `_____` | Prazo para incluir, retirar ou reordenar matéria depois da publicação |
| Aviso antecipado de prazo a vencer | `_____` | Quantas horas antes o sistema abre o alerta interno (1 a 168) |

## 2. Exceção de urgência

Tipos de sessão que **podem** ser convocados abaixo do prazo mínimo, com motivo
público obrigatório:

- [ ] Ordinária
- [ ] Extraordinária
- [ ] Solene
- [ ] Especial
- [ ] Nenhum: o prazo mínimo nunca é excepcionado

## 3. Quem é convocado

- [ ] **Parlamentares ativos** — todos os ativos recebem convocação
- [ ] **Mandato e licença** — considera mandato vigente, exclui licenciado e
      inclui o suplente em exercício

## 4. Canal de entrega

O que o sistema faz hoje: emite e publica a convocação, lista destinatários por
revisão e registra entrega e ciência. O envio pelo canal escolhido e o
comprovante são **registrados** no sistema; o sistema não é o canal.

Marque o canal oficial:

- [ ] **Presencial** — entrega em mãos com recibo assinado
- [ ] **E-mail institucional** — envio pela Secretaria, comprovante por registro de envio
- [ ] **Mensagem externa** (aplicativo de mensagens institucional)
- [ ] **Publicação no portal** como forma de convocação válida por si
- [ ] Outro: ______________________________________________

**4.1 Há canal secundário obrigatório?**

- [ ] Não
- [ ] Sim: ______________________________________________

## 5. Comprovante de entrega

Para cada destinatário e cada revisão, o sistema guarda canal, referência da
evidência, data/hora, quem registrou e um identificador que impede registro
duplicado. Defina o que vale como referência de evidência:

- [ ] Número do recibo assinado em papel, arquivado na Secretaria
- [ ] Identificador da mensagem enviada (ID do e-mail ou protocolo do envio)
- [ ] Número de protocolo interno da Secretaria
- [ ] Outro: ______________________________________________

## 6. Comprovante de ciência

Ciência é ato do destinatário, distinto da entrega.

- [ ] **Ciência no sistema**: o parlamentar entra e confirma — fica data/hora e autor
- [ ] **Ciência em papel**, registrada pela Secretaria em nome do parlamentar
- [ ] **A entrega comprovada dispensa a ciência** pelo regimento
- [ ] Outro: ______________________________________________

**6.1 A falta de ciência impede a abertura da sessão?**

- [ ] Não — fica registrada como pendência
- [ ] Sim → **NÃO IMPLEMENTADO** como bloqueio; vira ajuste de desenvolvimento

## 7. Retificação da convocação

Quando a pauta muda depois de publicada, o sistema emite nova revisão com novo
hash e novos destinatários, preservando a anterior.

**7.1 A retificação reabre o prazo de antecedência?**

- [ ] Sim, o prazo conta da nova revisão
- [ ] Não, conta da convocação inicial
- [ ] Depende do tipo de alteração: ______________________________________

**7.2 Motivo público da retificação é obrigatório?**

- [ ] Sim, sempre
- [ ] Só quando a alteração inclui ou retira matéria

---

## Assinatura

| Nome | Cargo | Data | Assinatura |
|---|---|---|---|
| | | | |
