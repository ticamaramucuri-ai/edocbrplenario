/** Identificador da revisão implantada, fornecido pelo processo de build/deploy. */
export function buildVersion(): string {
  const value = process.env.EDOCBR_BUILD_VERSION?.trim()
  return value || 'local-unversioned'
}
