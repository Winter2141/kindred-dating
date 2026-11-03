// Starts the API for the end-to-end tests on a brand-new SQLite database with demo data.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [apiPort = '8100', webPort = '5190'] = process.argv.slice(2)
const backend = resolve(dirname(fileURLToPath(import.meta.url)), '../../backend')
const scratch = join(backend, '.e2e')
rmSync(scratch, { recursive: true, force: true })
mkdirSync(scratch, { recursive: true })

// The project's virtualenv when there is one (local runs), else whatever python is on PATH (CI).
const venv = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'
const python = process.env.KINDRED_PYTHON ?? (existsSync(join(backend, venv)) ? join(backend, venv) : 'python')

const env = {
  ...process.env,
  KINDRED_DATABASE_URL: `sqlite+aiosqlite:///${join(scratch, 'e2e.db').replaceAll('\\', '/')}`,
  KINDRED_MEDIA_DIR: join(scratch, 'media'),
  KINDRED_APP_URL: `http://localhost:${webPort}`,
  KINDRED_CORS_ORIGINS: JSON.stringify([`http://localhost:${webPort}`]),
  KINDRED_SEED_ON_STARTUP: 'true',
  KINDRED_DEMO_MODE: 'true',
  KINDRED_EXPOSE_OUTBOX: 'true',
  KINDRED_RATE_LIMIT_ENABLED: 'false',
  // Personas still "read" and "type", just quickly.
  KINDRED_PERSONA_READ_DELAY: '[0.2, 0.4]',
  KINDRED_PERSONA_TYPING_DELAY: '[0.4, 0.8]',
}

const api = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--port', apiPort, '--app-dir', backend], {
  cwd: scratch, // so a developer's backend/.env isn't picked up
  env,
  stdio: 'inherit',
})
const stop = () => api.kill()
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.on('exit', stop)
api.on('exit', (code) => process.exit(code ?? 0))
