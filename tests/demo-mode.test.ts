import { describe, expect, test } from 'bun:test'
import { demoModeEnabled } from '../src/lib/server/demo-mode'

describe('modo demonstração', () => {
  test('só abre com opção explícita fora de produção', () => {
    expect(demoModeEnabled('development', undefined)).toBe(false)
    expect(demoModeEnabled('development', 'true')).toBe(true)
    expect(demoModeEnabled('production', 'true')).toBe(false)
  })
})
