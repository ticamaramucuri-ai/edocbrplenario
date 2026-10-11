/**
 * POST /api/v1/platform/billing/invoices/:id/cancel — cancela uma fatura ABERTA
 * com justificativa obrigatória (mín. 10 caracteres): status → canceled e a
 * justificativa gravada em notes. Auditoria billing.invoice_canceled com a
 * justificativa na cadeia do tenant ALVO.
 * 404 fatura inexistente; 409 INVOICE_INVALID_TRANSITION se não está aberta.
 * RBAC: platform.manage (somente platform_owner).
 */
import { z } from 'zod'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { cancelInvoice, invoiceView } from '@/lib/server/billing'

export const dynamic = 'force-dynamic'

const cancelSchema = z.object({
  justification: z
    .string()
    .trim()
    .min(10, 'Informe uma justificativa com ao menos 10 caracteres.')
    .max(2000, 'Justificativa muito longa (máx. 2000 caracteres).'),
})

export const POST = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')
    const { id } = await ctx.params
    const body = cancelSchema.parse(await req.json())

    const result = await withTransaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id },
        include: { tenant: { select: { name: true } } },
      })
      if (!invoice) throw notFound(`Fatura "${id}" não encontrada.`)
      const canceled = await cancelInvoice(tx, invoice, body.justification, actor, correlationId)
      return { invoice: canceled, tenantName: invoice.tenant.name }
    })

    return Response.json({ invoice: invoiceView(result.invoice, result.tenantName) })
  }
)
