# Etapa 045 — Acessibilidade de presença, votação, telão de TV e app do parlamentar

**Data:** 21/10/2026 · **Estado:** incremento técnico local concluído; leitor de tela humano e TV física continuam na fase 053.

Estende a [auditoria de acessibilidade em navegador](045-auditoria-acessibilidade-navegador.md),
que cobria entrada, painel e telão de boas-vindas/presença/pauta, para as telas
que a Mesa opera durante a sessão. Tarefa 11 da trilha C de
[`PLANO-CONTINUIDADE-2026-10-20.md`](../PLANO-CONTINUIDADE-2026-10-20.md).

## Cobertura e gate

`bun run test:a11y:plenario` audita oito telas com axe-core e as regras WCAG 2 A/AA,
2.1 AA e 2.2 AA:

| Tela | Viewport | Regras aprovadas | Inconclusivas |
|---|---|---:|---:|
| Presença — check-in aberto, quórum insuficiente | 1366×768 | 29 | 3 |
| Presença — quórum alcançado | 1366×768 | 29 | 3 |
| Votação aberta com parcial visível | 1366×768 | 29 | 3 |
| Votação encerrada com resultado | 1366×768 | 31 | 3 |
| Votação aberta com parcial oculto | 1366×768 | 29 | 3 |
| Telão em viewport de TV | 1920×1080 | 21 | 1 |
| Telão em viewport de TV | 3840×2160 | 21 | 1 |
| App do parlamentar | 390×844 | 25 | 1 |

**Gate:** zero violações de impacto `critical` ou `serious` por tela — qualquer uma
derruba o roteiro. Violações `moderate`/`minor` não derrubam e sairiam no JSON para
constar aqui com justificativa; na execução de 21/10/2026 **não houve nenhuma**, de
nenhum impacto. As regras inconclusivas (3 por tela da Mesa, 1 por telão e app)
exigem revisão humana e **não** contam como aprovação.

Números em [`045-prova-acessibilidade-votacao-presenca.json`](045-prova-acessibilidade-votacao-presenca.json).

## Achados e correções

A auditoria falhou três vezes antes de passar. Cada falha era defeito real:

1. **Selo de presença**: `bg-emerald-600` com texto branco dá **3,77:1**, abaixo do
   4,5:1 exigido para texto pequeno. Apareceu no cartão de cada parlamentar presente.
   Passou a `emerald-700` (**5,48:1**). O mesmo defeito existia em `amber-600` com
   texto branco (**3,2:1** → `amber-700`, **5,1:1**), e a troca foi aplicada a todo
   selo e botão do repositório com esse par de classes — oito arquivos além dos
   componentes de selo. `rose-600` com texto branco fica em **4,70:1** e permaneceu.
2. **Título do aviso (toast)**: as cores vivas do sonner (`richColors`) usam, no tema
   claro, texto em 45% de luminosidade sobre fundo quase branco — entre **3,3:1** e
   **4,4:1**. `src/components/ui/sonner.tsx` passou a escurecer só o texto do tema
   claro, mantendo a identidade de cor por tipo: sucesso **5,98:1**, informação
   **6,6:1**, atenção **5,4:1**, erro **6,1:1**. O tema escuro já passava e não é
   sobrescrito.
3. **Texto secundário do telão**: `text-zinc-500` sobre o fundo quase preto dá
   **4,12:1** (e um `text-zinc-600`, menos). Treze ocorrências em
   `src/modules/display/profiles.tsx` passaram a `text-zinc-400` (**7,76:1**),
   mantendo a hierarquia visual — é a mesma correção que a etapa anterior já havia
   aplicado ao rodapé da pauta.

## Navegação por teclado

O roteiro percorre check-in → abrir votação → votar → encerrar sem mouse, por foco
e `Enter`, e registra a sequência de foco observada:

| Passo | Elemento que recebeu foco |
|---|---|
| Check-in | `Registrar check-in — Antônio Ferraz` |
| Abrir votação | `Abrir votação` |
| Votar | `Registrar voto Sim de Antônio Ferraz` |
| Encerrar votação | `Encerrar votação` |
| Confirmar apuração | `Encerrar e apurar` |

Cada passo foi confirmado pelo efeito na tela — o quórum subiu, a votação abriu, o
voto entrou na contagem e o resultado foi apurado —, não apenas pelo foco.

## Como reproduzir

```bash
bun run build            # a auditoria serve o bundle de produção
bun run test:a11y:plenario
```

O roteiro sobe uma instância descartável: SQLite temporário, `prisma db push`,
seed de demonstração e `.next/standalone/server.js` em porta própria (3210 por
padrão, `A11Y_PORT` ajusta). A base de desenvolvimento não é tocada e a sessão
sintética morre com o banco. O navegador é o Chromium do Playwright quando
baixado; nesta máquina caiu no `/usr/bin/chromium` do sistema, e sem nenhum dos
dois o roteiro falha dizendo o que instalar. O gate entrou no job `application`
do CI, depois do build.

> O plano previa o par `scripts/staging-a11y-audit.mjs` + `test:staging:a11y`.
> O roteiro é esse arquivo, mas o comando chama-se `test:a11y:plenario` porque
> **não** depende da stack de homologação em contêiner: roda contra instância
> descartável local e por isso serve de gate no CI.

## Limites

- Ferramenta automática não avalia compreensão de mensagem, uso real por leitor de
  tela, legibilidade em TV distante nem operação por parlamentar com tecnologia
  assistiva. Isso continua na **fase 053**, com registro de achados e aceite da Câmara.
- Viewport de TV não é TV: 1920×1080 e 3840×2160 em Chromium headless não medem
  distância de leitura, brilho, nem o dimensionamento real do painel.
- Os dados são do tenant fictício `camara-vila-nova`. Nenhum dado de Mucuri foi usado.
- Três regras inconclusivas por tela da Mesa permanecem para revisão humana.
- A votação do ensaio é nominal. Votação simbólica oficial e voto secreto (bloqueado)
  não entram nesta auditoria.
