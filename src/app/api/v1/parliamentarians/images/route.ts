import type { NextRequest } from 'next/server'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { apiHandler, DomainError } from '@/lib/server/errors'
import { resolveActor, resolveTenantScope } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { IMAGE_MAX_BYTES, parliamentarianImageRoot, imageUrl } from '@/lib/server/parliamentarian-images'

export const dynamic = 'force-dynamic'

export const POST = apiHandler(async (req: NextRequest) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'parliamentarian.write')
  const tenantId = await resolveTenantScope(req, actor)
  const body = await req.formData()
  const file = body.get('file')
  const kind = body.get('kind')
  if (!(file instanceof File) || (kind !== 'photo' && kind !== 'partyEmblem')) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Imagem inválida', 'Informe uma foto ou emblema do partido.')
  }
  if (file.size < 1 || file.size > IMAGE_MAX_BYTES || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new DomainError('VALIDATION_ERROR', 422, 'Imagem inválida', 'Use JPG, PNG ou WebP de até 5 MB.')
  }
  const input = Buffer.from(await file.arrayBuffer())
  let output: Buffer
  try {
    const image = sharp(input, { limitInputPixels: 20_000_000, failOn: 'error' })
    const metadata = await image.metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height) throw new Error('Formato inválido')
    output = await image.rotate().resize({ width: kind === 'photo' ? 800 : 500, height: kind === 'photo' ? 800 : 500, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
  } catch {
    throw new DomainError('VALIDATION_ERROR', 422, 'Imagem inválida', 'Não foi possível processar esta imagem.')
  }
  const fileName = `${randomUUID()}.webp`
  const directory = join(parliamentarianImageRoot(), tenantId)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await writeFile(join(directory, fileName), output, { flag: 'wx', mode: 0o600 })
  return Response.json({ url: imageUrl(tenantId, fileName) }, { status: 201 })
})
