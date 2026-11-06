import { expect, test } from 'bun:test'
import { assertTenantScope, resolveTenantScope, type ResolvedActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'

const monitor: ResolvedActor = {
  id: 'monitor-fixture', name: 'Monitor', role: 'platform_monitor',
  jobTitle: null, tenantId: null, parliamentarianId: null, isPlatform: false,
}

test('monitor lê saúde sem acesso a gestão, impersonação ou dados de Câmara', async () => {
  expect(() => requirePermission(monitor, 'system.status.read')).not.toThrow()
  for (const action of ['platform.read', 'platform.manage', 'impersonation.manage',
                        'session.create', 'voting.write', 'user.manage']) {
    expect(() => requirePermission(monitor, action)).toThrow()
  }
  expect(() => assertTenantScope(monitor, 'another-tenant')).toThrow()
  await expect(resolveTenantScope(new Request('http://localhost/api/v1/sessions?tenant=any'), monitor))
    .rejects.toThrow()
})
