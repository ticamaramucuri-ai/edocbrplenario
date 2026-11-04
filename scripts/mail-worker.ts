/** Worker SMTP; credenciais e URL pública são lidas do ambiente, nunca do banco. */
import nodemailer from 'nodemailer'
import { readFileSync } from 'node:fs'
import { db } from '../src/lib/db'
import { confirmationUrl, mailTransportConfigured, processMailBatch } from '../src/lib/server/mail-delivery'

if (!mailTransportConfigured()) throw new Error('Configure SMTP_HOST, SMTP_FROM e PUBLIC_BASE_URL antes de iniciar o worker.')
if (Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASSWORD)) throw new Error('SMTP_USER e SMTP_PASSWORD devem ser configurados juntos.')
const baseUrl = process.env.PUBLIC_BASE_URL!
confirmationUrl(baseUrl, 'verificacao-de-configuracao')
const port = Number(process.env.SMTP_PORT || 587)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT inválida.')
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  requireTLS: port !== 465,
  tls: process.env.SMTP_TLS_CA_FILE ? { ca: readFileSync(process.env.SMTP_TLS_CA_FILE) } : undefined,
  connectionTimeout: 20_000,
  greetingTimeout: 20_000,
  socketTimeout: 45_000,
  auth: process.env.SMTP_USER && process.env.SMTP_PASSWORD
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
  disableFileAccess: true,
  disableUrlAccess: true,
})
const send = async ({ to, subject, text }: { to: string; subject: string; text: string }) => {
  await transporter.sendMail({ from: process.env.SMTP_FROM, to, subject, text })
}
const healthPort = Number(process.env.MAIL_WORKER_HEALTH_PORT || 3006)
if (!Number.isInteger(healthPort) || healthPort < 1 || healthPort > 65535) throw new Error('MAIL_WORKER_HEALTH_PORT inválida.')
const healthHost = process.env.MAIL_WORKER_HEALTH_HOST || '127.0.0.1'
if (!['127.0.0.1', '0.0.0.0'].includes(healthHost)) throw new Error('MAIL_WORKER_HEALTH_HOST inválido.')
const health = Bun.serve({ hostname: healthHost, port: healthPort, fetch(req) {
  return new Response(new URL(req.url).pathname === '/health' ? JSON.stringify({ ok: true, service: 'mail', version: process.env.EDOCBR_BUILD_VERSION?.trim() || 'local-unversioned' }) : 'not found', {
    status: new URL(req.url).pathname === '/health' ? 200 : 404,
    headers: { 'Content-Type': 'application/json' },
  })
} })
let running = true
let sleepTimer: ReturnType<typeof setTimeout> | undefined
let wakeSleep: (() => void) | undefined
const stop = () => {
  running = false
  if (sleepTimer) clearTimeout(sleepTimer)
  wakeSleep?.()
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
try {
  while (running) {
    await processMailBatch(db, send, baseUrl)
    if (running) await new Promise<void>((resolve) => {
      wakeSleep = resolve
      sleepTimer = setTimeout(resolve, 5000)
    })
    sleepTimer = undefined
    wakeSleep = undefined
  }
} finally {
  health.stop()
  transporter.close()
  await db.$disconnect()
}
