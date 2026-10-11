/**
 * POST /api/v1/platform/billing/invoices/:id/pay — registra o pagamento de uma
 * fatura ABERTA { method: pix|boleto|cartao|transferencia }: status → paid com
 * paidAt/paidMethod; se a assinatura do tenant está past_due → active.
 * Auditoria billing.invoice_paid + evento outbox `billing.invoice_paid`.
 * 404 fatura inexistente; 409 INVOICE_INVALID_TRANSITION se não está aberta.
 * RBAC: platform.manage (somente platform_owner).
 */
import { z } from 'zod'
import { withTransaction } from '@/lib/server/tx'
import { apiHandler, notFound } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { payInvoice, invoiceView } from '@/lib/server/billing'

export const dynamic = 'force-dynamic'

const paySchema = z.object({
  method: z.enum(['pix', 'boleto', 'cartao', 'transferencia']),
})

export const POST = apiHandler(
  async (req: Request, ctx: { params: Promise<Record<string, string>> }, correlationId) => {
    const actor = await resolveActor(req)
    requirePermission(actor, 'platform.manage')
    const { id } = await ctx.params
    const body = paySchema.parse(await req.json())

    const result = await withTransaction(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id },
        include: { tenant: { select: { name: true } } },
      })
      if (!invoice) throw notFound(`Fatura "${id}" não encontrada.`)
      const paid = await payInvoice(tx, invoice, body.method, actor, correlationId)
      return { invoice: paid, tenantName: invoice.tenant.name }
    })

    return Response.json({ invoice: invoiceView(result.invoice, result.tenantName) })
  }
)
