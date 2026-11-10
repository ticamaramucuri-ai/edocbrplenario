# 076 — build reproduzível com fontes locais

**Estado em 10/11/2026:** alteração local validada; CI e promoção pendentes.

## Problema e entrega

A CI do `main` no SHA `4804c72` falhou no job de aplicação durante `next build`: `next/font/google` tentou acessar `fonts.googleapis.com` para Geist e Geist Mono e a VM do runner não conseguiu conexão. Os jobs de fundação PostgreSQL e mídia passaram. A falha impediu a promoção controlada do incremento 075 à VPS sintética.

`src/app/layout.tsx` agora carrega os dois arquivos WOFF2 variáveis por `next/font/local`, mantendo as variáveis CSS e a faixa de peso 100–900. O build não precisa buscar essas fontes em serviços externos.

Os arquivos vieram do pacote oficial [`geist@1.9.2`](https://www.npmjs.com/package/geist/v/1.9.2), publicado pelo projeto [Vercel Geist](https://github.com/vercel/geist-font), com licença SIL Open Font License em `src/assets/fonts/OFL.txt`. Integridade do pacote npm: `sha512-UU1x2q5Khob0+i4csFvXk1Ki4DePdu7xISuXyEcj1tzQMg64oN7Kbuy4e5z5QhcUWbbvOMJNs3ZxYQqpsEMV3w==`.

| Arquivo | SHA-256 |
|---|---|
| `Geist-Variable.woff2` | `3626eba547294501c8a4d662c7d9ea3b49734409a4c5a1ccf12fa86429b1687e` |
| `GeistMono-Variable.woff2` | `5d93ee62680bbec1abc5405c2658311f9396f6f9a821ef8551ec463887e600d4` |

## Verificação e próximo gate

`bun run typecheck`, `bun run lint` e `bun run build` passaram localmente. A CI do PR e do `main` deve passar no runner isolado antes de promover exatamente o SHA aprovado. Depois, conferir `/api/v1/health` e manter a VPS classificada como homologação sintética. Esta correção não fecha P6 nem habilita sessão offline.
