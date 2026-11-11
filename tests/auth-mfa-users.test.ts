import { afterAll, expect, test } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { POST as rawLogin } from '@/app/api/v1/auth/login/route'
import { POST as rawLoginMfa } from '@/app/api/v1/auth/login/mfa/route'
import { GET as rawMe } from '@/app/api/v1/auth/me/route'
import { GET as rawMfaStatus } from '@/app/api/v1/auth/mfa/status/route'
import { POST as rawMfaSetup } from '@/app/api/v1/auth/mfa/setup/route'
import { POST as rawMfaEnable } from '@/app/api/v1/auth/mfa/enable/route'
import { POST as rawMfaDisable } from '@/app/api/v1/auth/mfa/disable/route'
import { POST as rawCreateUser, GET as rawListUsers } from '@/app/api/v1/users/route'
import { PATCH as rawUpdateUser } from '@/app/api/v1/users/[id]/route'
import { hashPassword } from '@/lib/server/session'
import { totpCode } from '@/lib/server/totp'

const login = (req: NextRequest, ctx: any = {}, _corr?: string) => rawLogin(req, ctx)
const loginMfa = (req: NextRequest, ctx: any = {}, _corr?: string) => rawLoginMfa(req, ctx)
const me = (req: NextRequest, ctx: any = {}, _corr?: string) => rawMe(req, ctx)
const mfaStatus = (req: NextRequest, ctx: any = {}, _corr?: string) => rawMfaStatus(req, ctx)
const mfaSetup = (req: NextRequest, ctx: any = {}, _corr?: string) => rawMfaSetup(req, ctx)
const mfaEnable = (req: NextRequest, ctx: any = {}, _corr?: string) => rawMfaEnable(req, ctx)
const mfaDisable = (req: NextRequest, ctx: any = {}, _corr?: string) => rawMfaDisable(req, ctx)
const createUser = (req: NextRequest, ctx: any = {}, _corr?: string) => rawCreateUser(req, ctx)
const listUsers = (req: NextRequest, ctx: any = {}, _corr?: string) => rawListUsers(req, ctx)
const updateUser = (req: NextRequest, ctx: any = {}, _corr?: string) => rawUpdateUser(req, ctx)

afterAll(async () => { await db.$disconnect() })

const post = (url: string, body: unknown, cookie?: string) => new NextRequest(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
})
const get = (url: string, cookie: string) => new NextRequest(url, { headers: { cookie } })
const patch = (url: string, body: unknown, cookie: string) => new NextRequest(url, {
  method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body),
})
function sessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie') ?? ''
  const token = setCookie.match(/legis_session=([^;]+)/)?.[1]
  if (!token) throw new Error('Login não definiu cookie legis_session.')
  return `legis_session=${token}`
}

test('senha, MFA TOTP, usuários e revogação de sessões percorrem os handlers reais', async () => {
  const suffix = crypto.randomUUID()
  const tenant = await db.tenant.create({ data: { slug: `auth-${suffix}`, name: 'Câmara de Teste', city: 'Teste', uf: 'BA' } })
  const otherTenant = await db.tenant.create({ data: { slug: `auth-out-${suffix}`, name: 'Outra Câmara', city: 'Teste', uf: 'BA' } })
  const password = 'Senha-forte-teste-123'
  const admin = await db.user.create({ data: { tenantId: tenant.id, name: 'Admin Autenticação', email: `auth-${suffix}@example.invalid`, role: 'tenant_admin', passwordHash: hashPassword(password) } })
  const outside = await db.user.create({ data: { tenantId: otherTenant.id, name: 'Admin Externo', email: `auth-out-${suffix}@example.invalid`, role: 'tenant_admin', passwordHash: hashPassword(password) } })

  const loginUrl = 'http://localhost/api/v1/auth/login'
  expect((await login(post(loginUrl, { email: admin.email, password: 'senha-incorreta-123' }), {}, 'corr-bad')).status).toBe(401)
  const firstLogin = await login(post(loginUrl, { email: admin.email.toUpperCase(), password }), {}, 'corr-login')
  expect(firstLogin.status).toBe(200)
  const firstCookie = sessionCookie(firstLogin)
  expect(firstLogin.headers.get('set-cookie')).toContain('HttpOnly')
  expect((await (await me(get('http://localhost/api/v1/auth/me', firstCookie), {}, 'corr-me')).json()).actor.id).toBe(admin.id)

  const setup = await mfaSetup(post('http://localhost/api/v1/auth/mfa/setup', {}, firstCookie), {}, 'corr-mfa-setup')
  expect(setup.status).toBe(200)
  const setupBody = await setup.json()
  expect(setupBody.secret).toMatch(/^[A-Z2-7]{32}$/)
  expect(setupBody.otpauthUrl).toContain(setupBody.secret)
  const invalidTotp = totpCode(setupBody.secret, Date.now() + 120_000)
  expect((await mfaEnable(post('http://localhost/api/v1/auth/mfa/enable', { totp: invalidTotp }, firstCookie), {}, 'corr-mfa-bad-enable')).status).toBe(401)
  expect((await mfaEnable(post('http://localhost/api/v1/auth/mfa/enable', { totp: totpCode(setupBody.secret) }, firstCookie), {}, 'corr-mfa-enable')).status).toBe(200)
  expect(await db.user.findUniqueOrThrow({ where: { id: admin.id } })).toMatchObject({ mfaEnabled: true, mfaSecret: setupBody.secret })
  const status = await mfaStatus(get('http://localhost/api/v1/auth/mfa/status', firstCookie), {}, 'corr-mfa-status')
  expect(await status.json()).toEqual({ mfaEnabled: true })
  expect((await mfaSetup(post('http://localhost/api/v1/auth/mfa/setup', {}, firstCookie), {}, 'corr-mfa-re-setup')).status).toBe(422)

  const passwordOnly = await login(post(loginUrl, { email: admin.email, password }), {}, 'corr-mfa-required')
  expect(passwordOnly.status).toBe(401)
  expect(passwordOnly.headers.get('set-cookie')).toBeNull()
  const mfaLoginUrl = 'http://localhost/api/v1/auth/login/mfa'
  expect((await loginMfa(post(mfaLoginUrl, { email: admin.email, password, totp: invalidTotp }), {}, 'corr-mfa-login-bad')).status).toBe(401)
  const secondLogin = await loginMfa(post(mfaLoginUrl, { email: admin.email, password, totp: totpCode(setupBody.secret) }), {}, 'corr-mfa-login')
  expect(secondLogin.status).toBe(200)
  const mfaCookie = sessionCookie(secondLogin)
  const currentSession = await db.authSession.findFirstOrThrow({ where: { userId: admin.id, mfaVerifiedAt: { not: null } } })
  expect(currentSession.mfaVerifiedAt).not.toBeNull()

  const usersUrl = 'http://localhost/api/v1/users'
  const users = await listUsers(get(usersUrl, mfaCookie), {}, 'corr-users')
  const userList = await users.json()
  expect(users.status).toBe(200)
  expect(userList.users.map((user: { id: string }) => user.id)).toContain(admin.id)
  expect(userList.users.map((user: { id: string }) => user.id)).not.toContain(outside.id)
  expect(JSON.stringify(userList)).not.toContain('passwordHash')
  const created = await createUser(post(usersUrl, { name: 'Nova Operadora', email: `new-${suffix}@example.invalid`, password: 'Outra-senha-123', role: 'session_operator' }, mfaCookie), {}, 'corr-user-create')
  expect(created.status).toBe(201)
  const newUser = (await created.json()).user
  expect(newUser).toMatchObject({ role: 'session_operator', active: true, tenantId: tenant.id })
  expect(newUser.passwordHash).toBeUndefined()
  const newSessionToken = await (await login(post(loginUrl, { email: newUser.email, password: 'Outra-senha-123' }), {}, 'corr-new-user-login')).headers.get('set-cookie')
  expect(newSessionToken).toContain('HttpOnly')
  expect((await createUser(post(usersUrl, { name: 'Duplicada', email: newUser.email, password: 'Outra-senha-123', role: 'session_operator' }, mfaCookie), {}, 'corr-user-duplicate')).status).toBe(409)
  expect((await createUser(post(usersUrl, { name: 'Parlamentar sem vínculo', email: `parl-${suffix}@example.invalid`, password: 'Outra-senha-123', role: 'parliamentarian' }, mfaCookie), {}, 'corr-user-parl')).status).toBe(422)
  expect((await updateUser(patch(`${usersUrl}/${admin.id}`, { active: false }, mfaCookie), { params: Promise.resolve({ id: admin.id }) }, 'corr-self-disable')).status).toBe(422)

  const oldSessionId = (await db.authSession.findFirstOrThrow({ where: { userId: newUser.id } })).id
  expect((await updateUser(patch(`${usersUrl}/${newUser.id}`, { password: 'Senha-resetada-456' }, mfaCookie), { params: Promise.resolve({ id: newUser.id }) }, 'corr-user-reset')).status).toBe(200)
  expect((await db.authSession.findUniqueOrThrow({ where: { id: oldSessionId } })).revokedAt).not.toBeNull()
  expect((await login(post(loginUrl, { email: newUser.email, password: 'Outra-senha-123' }), {}, 'corr-old-pass')).status).toBe(401)
  expect((await login(post(loginUrl, { email: newUser.email, password: 'Senha-resetada-456' }), {}, 'corr-new-pass')).status).toBe(200)
  expect((await updateUser(patch(`${usersUrl}/${outside.id}`, { name: 'Tentativa cruzada' }, mfaCookie), { params: Promise.resolve({ id: outside.id }) }, 'corr-cross-user')).status).toBe(403)

  expect((await mfaDisable(post('http://localhost/api/v1/auth/mfa/disable', { password: 'senha-incorreta-123', totp: totpCode(setupBody.secret) }, mfaCookie), {}, 'corr-mfa-disable-password')).status).toBe(401)
  expect((await mfaDisable(post('http://localhost/api/v1/auth/mfa/disable', { password, totp: invalidTotp }, mfaCookie), {}, 'corr-mfa-disable-totp')).status).toBe(401)
  expect((await mfaDisable(post('http://localhost/api/v1/auth/mfa/disable', { password, totp: totpCode(setupBody.secret) }, mfaCookie), {}, 'corr-mfa-disable')).status).toBe(200)
  expect(await db.user.findUniqueOrThrow({ where: { id: admin.id } })).toMatchObject({ mfaEnabled: false, mfaSecret: null })
  expect((await login(post(loginUrl, { email: admin.email, password }), {}, 'corr-login-after-disable')).status).toBe(200)
})
