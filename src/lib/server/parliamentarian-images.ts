import { isAbsolute, join } from 'node:path'

export function parliamentarianImageRoot(): string {
  const configured = process.env.PARLIAMENTARIAN_IMAGES_ROOT
  if (!configured) return join(process.cwd(), 'upload', 'parliamentarian-images')
  if (!isAbsolute(configured)) throw new Error('PARLIAMENTARIAN_IMAGES_ROOT deve ser absoluto')
  return configured
}
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024

export function imageUrl(tenantId: string, fileName: string): string {
  return `/api/v1/public/parliamentarian-images/${tenantId}/${fileName}`
}

export function isTenantImageUrl(value: string | null | undefined, tenantId: string): boolean {
  if (value == null) return true
  const prefix = `/api/v1/public/parliamentarian-images/${tenantId}/`
  return value.startsWith(prefix) && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.webp$/.test(value.slice(prefix.length))
}
