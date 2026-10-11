import { createHmac } from 'crypto'
import { expect, test } from 'bun:test'
import { deliverWebhook } from '../mini-services/webhooks/http-delivery'

test('remetente HTTP preserva corpo, assinatura e identificador entre tentativas', async () => {
  const payload = '{"tenantId":"camara-a","data":{"vote":1}}'
  const captures: Array<{ url: string; init: RequestInit }> = []
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    captures.push({ url: String(input), init: init! })
    return new Response('', { status: captures.length === 1 ? 503 : 204 })
  }
  const args = ['https://example.invalid/hook', 'segredo-teste', 'voting.result', payload, 'delivery-123'] as const
  expect(await deliverWebhook(...args, fakeFetch)).toMatchObject({ kind: 'failure', responseStatus: 503 })
  expect(await deliverWebhook(...args, fakeFetch)).toEqual({ kind: 'success', responseStatus: 204 })
  expect(captures).toHaveLength(2)
  const expected = `sha256=${createHmac('sha256', 'segredo-teste').update(payload).digest('hex')}`
  for (const capture of captures) {
    expect(capture.url).toBe(args[0])
    expect(capture.init.method).toBe('POST')
    expect(capture.init.body).toBe(payload)
    const headers = capture.init.headers as Record<string, string>
    expect(headers['x-legis-signature']).toBe(expected)
    expect(headers['x-legis-delivery-id']).toBe('delivery-123')
    expect(headers['x-legis-event']).toBe('voting.result')
  }
})
