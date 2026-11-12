# 126 — Pauta e documentos no app local de leitura

**Estado em 11/11/2026:** incremento P5 de laboratório, somente em loopback.

O app local agora mostra, sob ação do operador, a pauta e os nomes/MIME dos documentos de uma sessão cujo pacote foi importado, assinado e conferido integralmente. `GET /api/sessions/:sessionId` exige que a sessão pertença ao inventário da Câmara e esteja em estado `ready`; antes de responder, reabre e verifica a assinatura e todos os bytes. Pacote incompleto, adulterado ou de outra Câmara não produz resumo. A interface exibe os dados como texto e continua sem voto, presença ou leitura de PDFs.

O resumo é derivado do manifesto versionado já existente; não adiciona conteúdo a um pacote antigo nem cria estado de autoridade. Testes locais cobrem pacote real sintético, isolamento de Câmara, rota para sessão pronta/incompleta e navegação em 1440×900 e 390×844. O ciclo ainda não testa celular físico, TLS LAN ou download de documentos.

**Próximo gate:** identidade nominal e do dispositivo, certificado TLS na LAN, autorização de leitura por papel e só então bytes de PDF/snapshot distribuídos a clientes reais.
