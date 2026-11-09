import { createHash } from 'node:crypto'

export const MAX_PRIVATE_MATTER_ATTACHMENT_BYTES = 50 * 1024 * 1024

export function verifyPrivateMatterAttachment(attachment: {
  content: Uint8Array | null; sizeBytes: number; sha256: string | null; mimeType: string | null
}): Uint8Array {
  const { content, sizeBytes, sha256, mimeType } = attachment
  if (!content || !sha256 || mimeType !== 'application/pdf' ||
      sizeBytes < 8 || sizeBytes > MAX_PRIVATE_MATTER_ATTACHMENT_BYTES ||
      content.byteLength !== sizeBytes ||
      createHash('sha256').update(content).digest('hex') !== sha256) {
    throw new Error('Arquivo privado ausente ou com integridade divergente.')
  }
  return content
}

export function validatePrivateMatterPdf(content: Uint8Array): void {
  if (content.byteLength < 8 || content.byteLength > MAX_PRIVATE_MATTER_ATTACHMENT_BYTES ||
      Buffer.from(content.subarray(0, 5)).toString('ascii') !== '%PDF-' ||
      !Buffer.from(content).includes(Buffer.from('%%EOF'))) {
    throw new Error('PDF privado inválido ou fora do limite de 50 MB.')
  }
}
