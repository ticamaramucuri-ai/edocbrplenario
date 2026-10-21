/**
 * Endereço do serviço de tempo real.
 *
 * O cliente aponta, por padrão, para o gateway Caddy (`/?XTransformPort=3003`).
 * Sem o gateway de pé, esse caminho não resolve e a topbar ficava em
 * "Conectando…" para sempre, sem erro visível — por isso `NEXT_PUBLIC_REALTIME_URL`
 * é obrigatória quando não há Caddy, e a falha passou a ter rótulo próprio.
 */

export const GATEWAY_PADRAO = '/?XTransformPort=3003'

/** Tempo sem entrar na sala antes de declarar o tempo real indisponível. */
export const ATRASO_INDISPONIVEL_MS = 15_000

/** Vai no selo, que divide a linha com o resto da topbar e do app móvel. */
export const ROTULO_TEMPO_REAL_INDISPONIVEL_CURTO = 'Tempo real indisponível'

/** Causa provável, no título e no rótulo acessível do selo. */
export const ROTULO_TEMPO_REAL_INDISPONIVEL =
  `${ROTULO_TEMPO_REAL_INDISPONIVEL_CURTO} — verifique o gateway ou NEXT_PUBLIC_REALTIME_URL`

export interface AmbienteRealtime {
  NEXT_PUBLIC_REALTIME_URL?: string
  NEXT_PUBLIC_REALTIME_GATEWAY?: string
}

const PROTOCOLOS_ACEITOS = new Set(['http:', 'https:', 'ws:', 'wss:'])

function urlAbsolutaValida(valor: string): boolean {
  try {
    return PROTOCOLOS_ACEITOS.has(new URL(valor).protocol)
  } catch {
    return false
  }
}

/**
 * Devolve a URL explícita quando houver, senão o gateway.
 * Valor só com espaços é ignorado; valor presente e inválido lança erro
 * nomeando a variável — configuração errada falha alto, não em silêncio.
 */
export function realtimeEndpoint(env: AmbienteRealtime): string {
  const explicita = (env.NEXT_PUBLIC_REALTIME_URL ?? '').trim()
  if (explicita) {
    if (!urlAbsolutaValida(explicita)) {
      throw new Error(
        `NEXT_PUBLIC_REALTIME_URL inválida (${explicita}): use URL absoluta http(s) ou ws(s), ` +
          'por exemplo http://localhost:3003.',
      )
    }
    return explicita
  }

  const gateway = (env.NEXT_PUBLIC_REALTIME_GATEWAY ?? '').trim()
  if (gateway) {
    if (!gateway.startsWith('/') && !urlAbsolutaValida(gateway)) {
      throw new Error(
        `NEXT_PUBLIC_REALTIME_GATEWAY inválida (${gateway}): use caminho começando com "/" ` +
          `ou URL absoluta. O padrão é ${GATEWAY_PADRAO}.`,
      )
    }
    return gateway
  }

  return GATEWAY_PADRAO
}

/**
 * Mesma decisão, sem lançar: valor inválido registra o erro e cai no gateway.
 *
 * `realtimeEndpoint` falha alto porque é lida por quem configura. No cliente,
 * porém, ela é chamada dentro do efeito do hook: lançar ali desmontava a
 * árvore React e o plenário ficava em tela branca — uma configuração errada
 * tirava o sistema do ar em vez de só não conectar. Aqui o vigia de 15 s faz o
 * diagnóstico, que é o canal criado para isso.
 */
export function realtimeEndpointTolerante(env: AmbienteRealtime): string {
  try {
    return realtimeEndpoint(env)
  } catch (erro) {
    console.error(`[tempo real] ${(erro as Error).message}`)
    return GATEWAY_PADRAO
  }
}
