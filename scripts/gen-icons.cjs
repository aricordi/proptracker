// Generates PNG icons from the SVG design using pure-JS pngjs
// Run: node scripts/gen-icons.cjs

const { PNG } = require('pngjs')
const fs      = require('fs')
const path    = require('path')
const zlib    = require('zlib')

function hex(h) {
  return { r: parseInt(h.slice(1,3),16), g: parseInt(h.slice(3,5),16), b: parseInt(h.slice(5,7),16) }
}

const BG     = hex('#1C1917')
const BODY   = hex('#44403C')
const LID    = hex('#57534E')
const LABEL  = hex('#292524')
const AMBER  = hex('#F59E0B')
const MUTED  = hex('#78716C')

function setPixel(data, width, x, y, c, a = 255) {
  if (x < 0 || y < 0 || x >= width || y >= width) return
  const i = (y * width + x) * 4
  // simple alpha blend over whatever is there
  const aa = a / 255
  data[i]   = Math.round(data[i]   * (1 - aa) + c.r * aa)
  data[i+1] = Math.round(data[i+1] * (1 - aa) + c.g * aa)
  data[i+2] = Math.round(data[i+2] * (1 - aa) + c.b * aa)
  data[i+3] = 255
}

function fillRect(data, w, x1, y1, x2, y2, c) {
  x1 = Math.round(x1); y1 = Math.round(y1)
  x2 = Math.round(x2); y2 = Math.round(y2)
  for (let y = y1; y < y2; y++)
    for (let x = x1; x < x2; x++)
      setPixel(data, w, x, y, c)
}

// Draw a circle (for the arch handle) using midpoint circle, only top half
function drawArch(data, w, cx, cy, rx, ry, stroke, thick) {
  // Approximate ellipse arch using filled scanlines for top half
  for (let dy = -ry; dy <= 0; dy++) {
    const dx = Math.round(rx * Math.sqrt(1 - (dy / ry) ** 2))
    for (let t = 0; t < thick; t++) {
      setPixel(data, w, cx - dx - t, cy + dy, stroke)
      setPixel(data, w, cx + dx + t, cy + dy, stroke)
    }
  }
}

function roundRect(data, w, x1, y1, x2, y2, r, c) {
  r = Math.round(r)
  fillRect(data, w, x1 + r, y1,     x2 - r, y2, c)
  fillRect(data, w, x1,     y1 + r, x2,     y2 - r, c)
  // corners via quarter circle fill
  for (let dy = 0; dy < r; dy++) {
    const dx = Math.round(r - Math.sqrt(r * r - (r - dy) * (r - dy)))
    fillRect(data, w, x1 + dx, y1 + dy, x2 - dx, y1 + dy + 1, c)
    fillRect(data, w, x1 + dx, y2 - dy - 1, x2 - dx, y2 - dy, c)
  }
}

function makeIcon(size) {
  const s = size / 512  // scale factor relative to SVG viewBox

  const png  = new PNG({ width: size, height: size, filterType: -1 })
  const data = png.data

  // Background
  fillRect(data, size, 0, 0, size, size, BG)

  // Bin body
  roundRect(data, size, 88*s, 212*s, 424*s, 432*s, 16*s, BODY)

  // Bin lid
  roundRect(data, size, 72*s, 164*s, 440*s, 232*s, 12*s, LID)

  // Handle arch (amber arc above lid)
  drawArch(data, size, 256*s, 164*s, 60*s, 56*s, AMBER, Math.max(2, Math.round(9*s)))

  // Label area (inside bin body)
  roundRect(data, size, 120*s, 252*s, 392*s, 392*s, 8*s, LABEL)

  // Amber accent bar at top of label
  roundRect(data, size, 120*s, 252*s, 392*s, 262*s, 5*s, AMBER)

  // Inventory rows
  if (size >= 64) {
    fillRect(data, size, 144*s, 284*s, 240*s, 294*s, MUTED)
    fillRect(data, size, 252*s, 284*s, 316*s, 294*s, AMBER)
    fillRect(data, size, 144*s, 308*s, 280*s, 318*s, MUTED)
    fillRect(data, size, 144*s, 332*s, 220*s, 342*s, MUTED)
    fillRect(data, size, 232*s, 332*s, 320*s, 342*s, AMBER)
  }

  return png
}

const outDir = path.join(__dirname, '..', 'public', 'icons')
fs.mkdirSync(outDir, { recursive: true })

const sizes = [
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
]

for (const { size, name } of sizes) {
  const png  = makeIcon(size)
  const buf  = PNG.sync.write(png)
  const dest = path.join(outDir, name)
  fs.writeFileSync(dest, buf)
  console.log(`✓ ${name} (${size}x${size})`)
}

console.log('Done.')
