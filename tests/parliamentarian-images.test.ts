import { describe, expect, test } from 'bun:test'
import { imageUrl, isTenantImageUrl } from '@/lib/server/parliamentarian-images'

const tenant = 'cmv2mcouh0000myez58b0ke17'
const file = '26a61cee-368b-43f0-b690-9f8a1b8137b4.webp'

describe('imagens de parlamentares entre Câmaras', () => {
  test('aceita somente arquivo gerado no tenant atual', () => {
    expect(isTenantImageUrl(imageUrl(tenant, file), tenant)).toBe(true)
    expect(isTenantImageUrl(imageUrl('outrotenant1234567890', file), tenant)).toBe(false)
    expect(isTenantImageUrl(`/api/v1/public/parliamentarian-images/${tenant}/../segredo.webp`, tenant)).toBe(false)
    expect(isTenantImageUrl('https://site-externo.test/foto.png', tenant)).toBe(false)
  })

  test('permite limpar a imagem opcional', () => {
    expect(isTenantImageUrl(null, tenant)).toBe(true)
    expect(isTenantImageUrl(undefined, tenant)).toBe(true)
  })
})
