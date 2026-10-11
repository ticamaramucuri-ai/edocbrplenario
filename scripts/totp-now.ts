import { totpCode } from '../src/lib/server/totp'
const secret = process.argv[2]
console.log(totpCode(secret, Date.now()))
