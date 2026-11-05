/** Importação reproduzível das fotos vinculadas aos perfis públicos dos vereadores de Mucuri. */
import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { db } from '../src/lib/db'
import { IMAGE_MAX_BYTES, imageUrl, parliamentarianImageRoot } from '../src/lib/server/parliamentarian-images'

const base = 'https://camaramucuri.ba.gov.br/arquivos/2021/02/'
const photos = [
  ['Hélio Alvarenga Penha', 'dr-helio.jpg', '47ce909adb64b3f0ee120812c59503e683061481d83c82fa279665e444f8e208'],
  ['Carlos de Jesus Brito', 'carlos-brito.jpg', '18e7dbe12a1ff7d64596c34c9be9971d803e92b328f9b6c82e84767c062f771b'],
  ['Willian Crisma da Cruz', 'willian-crisma-1.jpg', '1f2f966ea6ac2ed611e3493fccc86d4eab099838a35972d343a7eb15ce789cdd'],
  ['Fernando Batista dos Santos', 'Fernando-Batista.jpg', 'e407b9acbb9bb54afa2c1f9549290fb42e55b6e0ba2d13e45f3023d4427fa0c9'],
  ['Ademilson Ferreira Neves', 'ademilson-ferreira.jpg', 'd33ed767b1280006e22d96056f9772ec0a1d73f28d08eb8147a3a20f4a9c48c8'],
  ['Douglas Souto Buchacra', 'dodo.jpg', 'a0a868d5a85d042b2e815021527043fb30f6c1fe432650b712a0d7fe0d70d233'],
  ['Ediney Alves de Oliveira', 'diney.jpg', '2d6513de86ececce7d7bc8bd616bcf365b88afa1cfe45a4758b16b7e9d801120'],
  ['Edison Silva de Mattos', 'sula-policial.jpg', 'a9e01febdefab0af4bd738749885d17fe9a2aaf724cd4e9e4ba2d25c95f53079'],
  ['Felipe Pereira Tigre', 'felipe-onibus.jpg', 'f21203300dcac44840cbf000ca0b54c05ac9e4e33b1385ef6bbebaaa7443c275'],
  ['Geneval Pereira Miranda', 'val-embalador.jpg', '7eb70012b5e6acaac16d437bfde79d15c8823232536add8484306957b8f672ef'],
  ['Pamela Honorato Bremer Seixas', 'pamela-seixas.jpg', '871303582201db977d2a9397c076b44eeed41eef2879c705a310c07358dda0b2'],
  ['Paulo Gomes Mota', 'paulo-gomes.jpg', '299a40ce63da7780db1269d27e01914e45a3fff3b16c19fcc866b941e0c1fbc1'],
  ['Roberto Silva dos Santos Junior', 'roberto-2.jpg', '332974b0f384ccfd3b29ff18533df582643b33476416b1c5ed2018fabac4a99e'],
] as const

function fileNameFor(hash: string): string {
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}.webp`
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL obrigatória.')
  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: 'camara-mucuri-ba' } })
  const people = await db.parliamentarian.findMany({ where: { tenantId: tenant.id, active: true } })
  const byName = new Map(people.map((p) => [p.name, p]))
  if (byName.size !== people.length) throw new Error('Nomes duplicados no cadastro ativo.')
  const pending = photos.map(([name, source, hash]) => {
    const person = byName.get(name)
    if (!person) throw new Error(`Parlamentar ativo ausente: ${name}`)
    const fileName = fileNameFor(hash)
    const url = imageUrl(tenant.id, fileName)
    if (person.photoUrl && person.photoUrl !== url) throw new Error(`Foto já definida para ${name}; revisar manualmente.`)
    return { person, source, hash, fileName, url }
  }).filter(({ person }) => !person.photoUrl)
  if (!process.argv.includes('--apply')) {
    process.stdout.write(`Prévia: ${pending.length} fotos oficiais a importar; ${photos.length - pending.length} já cadastradas. Use --apply para executar.\n`)
    return
  }
  const directory = join(parliamentarianImageRoot(), tenant.id)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const created: string[] = []
  try {
    for (const item of pending) {
      const response = await fetch(base + item.source, { signal: AbortSignal.timeout(20_000) })
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/jpeg')) throw new Error(`Fonte inválida: ${item.source}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length < 1 || bytes.length > IMAGE_MAX_BYTES || createHash('sha256').update(bytes).digest('hex') !== item.hash) {
        throw new Error(`Conteúdo da foto mudou: ${item.source}; verificar a origem antes de importar.`)
      }
      const image = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'error' })
      const metadata = await image.metadata()
      if (metadata.format !== 'jpeg' || !metadata.width || !metadata.height) throw new Error(`JPEG inválido: ${item.source}`)
      const output = await image.rotate().resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer()
      const path = join(directory, item.fileName)
      try {
        await writeFile(path, output, { flag: 'wx', mode: 0o600 })
        created.push(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !Buffer.from(await readFile(path)).equals(output)) throw error
      }
    }
    await db.$transaction(async (tx) => {
      for (const item of pending) {
        const result = await tx.parliamentarian.updateMany({
          where: { id: item.person.id, tenantId: tenant.id, active: true, photoUrl: null },
          data: { photoUrl: item.url },
        })
        if (result.count !== 1) throw new Error(`Cadastro mudou durante a importação: ${item.person.name}`)
      }
    })
  } catch (error) {
    await Promise.all(created.map((path) => unlink(path).catch(() => undefined)))
    throw error
  }
  process.stdout.write(`Aplicado: ${pending.length} fotos; ${photos.length - pending.length} já cadastradas. Nenhum emblema, regra ou usuário alterado.\n`)
}

try { await main() } finally { await db.$disconnect() }
