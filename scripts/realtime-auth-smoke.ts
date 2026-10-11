/** Smoke manual com API e realtime ativos; TEST_TOKEN_PATH aponta para JSON {token}. */
import { readFileSync } from 'fs'
import { io } from 'socket.io-client'

const tokenPath = process.env.TEST_TOKEN_PATH
if (!tokenPath) throw new Error('Defina TEST_TOKEN_PATH com o arquivo JSON do token.')
const { token } = JSON.parse(readFileSync(tokenPath, 'utf8')) as { token: string }
const [body] = token.split('.')
const grant = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { tenantId: string }
const url = process.env.REALTIME_URL ?? 'http://127.0.0.1:3003'

type Outcome = 'subscribed' | 'subscribe_error'

function attempt(tenantId: string, scope: 'public' | 'internal', authToken: string): Promise<Outcome> {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      path: '/',
      transports: ['websocket'],
      reconnection: false,
      auth: { tenantId, scope, token: authToken },
    })
    const timer = setTimeout(() => finish(new Error('Tempo esgotado ao assinar sala.')), 5000)
    function finish(result: Outcome | Error) {
      clearTimeout(timer)
      socket.disconnect()
      if (result instanceof Error) reject(result)
      else resolve(result)
    }
    socket.once('subscribed', () => finish('subscribed'))
    socket.once('subscribe_error', () => finish('subscribe_error'))
    socket.once('connect_error', (error) => finish(error))
  })
}

const results = {
  public: await attempt(grant.tenantId, 'public', ''),
  internalWithoutToken: await attempt(grant.tenantId, 'internal', ''),
  internalWrongTenant: await attempt('c99999999999999999999', 'internal', token),
  internalValid: await attempt(grant.tenantId, 'internal', token),
}

if (
  results.public !== 'subscribed' ||
  results.internalWithoutToken !== 'subscribe_error' ||
  results.internalWrongTenant !== 'subscribe_error' ||
  results.internalValid !== 'subscribed'
) {
  throw new Error(`Falha no isolamento do realtime: ${JSON.stringify(results)}`)
}
console.log('Salas públicas e internas: autorização validada.')
