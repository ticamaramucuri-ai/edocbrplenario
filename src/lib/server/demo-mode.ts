/** O acesso por perfil só existe em desenvolvimento quando habilitado explicitamente. */
export function demoModeEnabled(
  nodeEnv = process.env.NODE_ENV,
  demoFlag = process.env.LEGIS_DEMO_MODE,
): boolean {
  return nodeEnv !== 'production' && demoFlag === 'true'
}
