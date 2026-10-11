import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { apiHandler, notFound } from '@/lib/server/errors'
import { parliamentarianImageRoot } from '@/lib/server/parliamentarian-images'

export const dynamic = 'force-dynamic'

export const GET = apiHandler(async (_req, ctx) => {
  const { tenantId, fileName } = await ctx.params
  if (!/^[a-z0-9]{15,35}$/.test(tenantId) || !/^[a-f0-9-]{36}\.webp$/.test(fileName)) throw notFound('Imagem não encontrada.')
  let image: Buffer
  try {
    image = await readFile(join(parliamentarianImageRoot(), tenantId, fileName))
  } catch {
    throw notFound('Imagem não encontrada.')
  }
  return new Response(new Uint8Array(image), {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
  })
})
