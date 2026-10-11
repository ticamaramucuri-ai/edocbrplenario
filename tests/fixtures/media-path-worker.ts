import { db } from '../../src/lib/db'
import { setDestinationEnabled } from '../../src/lib/server/media-control'
import { withMediaPathLease } from '../../src/lib/server/media-path-lease'

const [tenantId, path, destinationId] = process.argv.slice(2)
if (!tenantId || !path || !destinationId) throw new Error('Argumentos insuficientes')
try {
  await withMediaPathLease(path, () => setDestinationEnabled(tenantId, path, destinationId, true))
} finally {
  await db.$disconnect()
}
