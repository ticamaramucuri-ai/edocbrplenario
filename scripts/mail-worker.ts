/** Worker SMTP; credenciais e URL pública são lidas do ambiente, nunca do banco. */
import nodemailer from 'nodemailer'
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
let running = true
process.on('SIGTERM', () => { running = false })
process.on('SIGINT', () => { running = false })
try {
  while (running) {
    await processMailBatch(db, send, baseUrl)
    if (running) await Bun.sleep(5000)
  }
} finally {
  transporter.close()
  await db.$disconnect()
}
