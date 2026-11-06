import { brotliCompressSync, gzipSync } from 'node:zlib'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const assets = '../pkg/server/dist/assets'
const files = readdirSync(assets).filter(name => /\.(js|css)$/.test(name))
const limits = {
  'entry gzip': 130 * 1024,
  // WebGL (25 Kio gzip) est chargé à la demande sur desktop ; Unicode 11,
  // le Mur et À traiter augmentent aussi le budget global. Marge d’environ 5 %.
  'xterm gzip': 97 * 1024,
  'total brotli': 237 * 1024,
}
let entryGzip = 0
let xtermGzip = 0
let totalBrotli = 0
for (const name of files) {
  const raw = readFileSync(join(assets, name))
  const gzip = gzipSync(raw, { level: 9 }).length
  totalBrotli += brotliCompressSync(raw).length
  if (name.startsWith('index-')) entryGzip += gzip
  if (name.startsWith('xterm-') || name.startsWith('Terminal-')) xtermGzip += gzip
}
const measurements = {
  'entry gzip': entryGzip,
  'xterm gzip': xtermGzip,
  'total brotli': totalBrotli,
}
for (const [name, size] of Object.entries(measurements)) {
  console.log(`${name}: ${size} / ${limits[name]} bytes`)
  if (size > limits[name]) process.exitCode = 1
}
