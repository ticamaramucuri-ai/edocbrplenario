# P6 — contrato de autoridade da sessão

**Estado em 09/11/2026:** contrato criptográfico local implementado em branch; sem concessão operacional e sem votação offline.

## Entrega e evidência

`src/lib/session-authority-contract.ts` define grant Ed25519 para Câmara, sessão, dispositivo, revisão, hash do manifesto, época e janela máxima de 15 minutos. A verificação exige chave confiável, escopo exato, época mínima e tempo válido. `tests/session-authority-contract.test.ts` cobre concessão válida, dispositivo e hash alheios, época obsoleta, antes/depois da janela, adulteração, chave alheia e duração excessiva. Dois testes e nove asserções passaram com `DATABASE_URL=file:/tmp/edocbr-authority-contract.db`; tipos e lint passaram. O primeiro `bun test` sem banco descartável foi recusado pela guarda da base de desenvolvimento, conforme esperado.

## Próximo gate

Implementar emissão transacional no SaaS, exclusividade e incremento de época; persistir maior época no servidor local e exigir o grant para comandos de domínio. Provar comutação entre dois desktops, perda de WAN e reconciliação. O contrato sozinho não autoriza sessão oficial.
