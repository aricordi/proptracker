// ROBOT TESTS (end-to-end): drives the real app in a browser on the LOCAL emulator, like a person would.
// One command does everything:  npm run e2e
//   1. builds the server functions and the app (emulator mode, into .e2e/dist)
//   2. starts the Firebase emulators (auth, functions, firestore, storage; project demo-proptracker = offline only)
//   3. fills them with the test data (scripts/seed-emulator.mjs --reset)
//   4. serves the app on a free port (vite preview)
//   5. runs the journeys (one at a time, fresh test data per file), then the crawl (every screen, every role)
//   6. stops everything
// Options:
//   --only journeys | --only crawl     run one part
//   --no-build                          reuse the last build (functions/lib + .e2e/dist)
//   anything else is passed to Playwright (e.g. a file name, --grep "Arts", --headed)
//   E2E_REUSE_EMULATORS=1               use emulators that are already running (faster while writing tests)
// Never touches the live database: the emulators only talk to 127.0.0.1 and the "demo-" project.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, '.e2e')
const distDir = path.join(outDir, 'dist')
const args = process.argv.slice(2)
const take = (flag) => { const i = args.indexOf(flag); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v }
const has = (flag) => { const i = args.indexOf(flag); if (i < 0) return false; args.splice(i, 1); return true }
const only = take('--only')
const noBuild = has('--no-build')
const reuse = process.env.E2E_REUSE_EMULATORS === '1'
const EMULATOR_PORTS = [9099, 5001, 8080, 9199]
const children = []

const log = (...m) => console.log('[e2e]', ...m)
function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', ...opts, env: { ...process.env, ...(opts.env ?? {}) } })
  if (r.status !== 0) throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (${r.status})`)
}
function portBusy(port) {
  return new Promise(resolve => {
    const s = createServer().once('error', () => resolve(true)).once('listening', () => s.close(() => resolve(false)))
    s.listen(port, '127.0.0.1')
  })
}
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer().once('error', reject).listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) })
  })
}
async function waitForHttp(url, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try { const r = await fetch(url); if (r.status < 500) return } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300))
  }
  throw new Error(`Timed out waiting for ${url}`)
}
function startChild(name, cmd, cmdArgs, env, readyText, ms) {
  mkdirSync(outDir, { recursive: true })
  const file = createWriteStream(path.join(outDir, `${name}.log`))
  // detached = its own process group, so stopping it also stops the Java emulators it starts.
  const child = spawn(cmd, cmdArgs, { cwd: root, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  return new Promise((resolve, reject) => {
    let seen = ''
    const timer = setTimeout(() => reject(new Error(`${name} didn't start in ${ms / 1000} s (see .e2e/${name}.log)`)), ms)
    const onData = (d) => {
      file.write(d)
      if (!readyText) return
      seen = (seen + d.toString()).slice(-4000)
      if (seen.includes(readyText)) { clearTimeout(timer); resolve(child) }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`${name} stopped early (exit ${code}, see .e2e/${name}.log)`)) })
    if (!readyText) { clearTimeout(timer); resolve(child) }
  })
}
function stopAll() {
  for (const c of children.reverse()) {
    if (c.exitCode !== null) continue
    try { process.kill(-c.pid, 'SIGINT') } catch { /* already gone */ }
  }
}
async function waitStopped(ms) {
  const until = Date.now() + ms
  for (const c of children) {
    while (c.exitCode === null && c.signalCode === null && Date.now() < until) await new Promise(r => setTimeout(r, 200))
    if (c.exitCode === null && c.signalCode === null) { try { process.kill(-c.pid, 'SIGKILL') } catch { /* gone */ } }
  }
}
process.on('SIGINT', () => { stopAll(); process.exit(130) })
process.on('SIGTERM', () => { stopAll(); process.exit(143) })

let failed = false
try {
  if (!noBuild || !existsSync(path.join(distDir, 'index.html'))) {
    log('Building the server functions…')
    run('npm', ['--prefix', 'functions', 'run', 'build'])
    log('Building the app in emulator mode…')
    run('npx', ['vite', 'build', '--outDir', distDir, '--emptyOutDir', '--logLevel', 'warn'], { env: { VITE_USE_EMULATORS: 'true' } })
  }

  if (reuse) {
    log('Using the emulators that are already running.')
  } else {
    for (const p of EMULATOR_PORTS) {
      if (await portBusy(p)) throw new Error(`Port ${p} is busy: stop the running emulator first (or set E2E_REUSE_EMULATORS=1).`)
    }
    log('Starting the Firebase emulators…')
    await startChild('emulators', 'npx', ['firebase', 'emulators:start', '--only', 'auth,functions,firestore,storage', '--project', 'demo-proptracker'],
      {}, 'All emulators ready', 180_000)
  }

  const port = await freePort()
  const baseURL = `http://127.0.0.1:${port}`
  log(`Serving the app on ${baseURL}…`)
  await startChild('app', 'npx', ['vite', 'preview', '--outDir', distDir, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {}, null, 0)
  await waitForHttp(baseURL, 30_000)

  const env = { E2E_BASE_URL: baseURL }
  const parts = only ? [only] : ['journeys', 'crawl']
  for (const part of parts) {
    log(`Filling the emulator with test data, then running the ${part}…`)
    run('node', ['scripts/seed-emulator.mjs', '--reset'])
    const r = spawnSync('npx', ['playwright', 'test', `--project=${part}`, ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, ...env } })
    if (r.status !== 0) { failed = true; log(`${part}: FAILED`) } else log(`${part}: passed`)
  }
} catch (e) {
  failed = true
  console.error('[e2e]', e.message)
} finally {
  stopAll()
  await waitStopped(20_000)
}
process.exit(failed ? 1 : 0)
