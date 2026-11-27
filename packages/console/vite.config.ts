import { fileURLToPath } from 'node:url'
import { cn } from 'cn/vite'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'

const BROWSER_FLOOR_TARGETS = [
  'chrome123',
  'edge123',
  'firefox121',
  'safari17.5',
  'ios17.5'
]

const SERVER_ONLY_SPECIFIERS = [
  /^@tanstack\/ai-harness\/(server|plugins\/node|plugins\/coding|worker|build|oauth)/u,
  /^@workcell\/(?!console)/u,
  /^node:/u
]

const PACKAGES_SHARED_WITH_THE_HOST = [
  '@workcell/core',
  '@tanstack/ai',
  '@tanstack/ai-harness',
  '@tanstack/ai-persistence',
  '@opentelemetry/api'
]

const DEV_PORT = 7418

const THEME_AWARE_CLASS_MERGE = {
  find: /^cn$/u,
  replacement: fileURLToPath(new URL('src/lib/cn.ts', import.meta.url))
}

const DEVELOPMENT_ALIASES = [
  {
    find: /^#\/server\/development-context\.ts$/u,
    replacement: fileURLToPath(
      new URL('src/server/development-context.dev.ts', import.meta.url)
    )
  }
]

const FONT_PACKAGES = [
  '@fontsource-variable/atkinson-hyperlegible-next',
  '@fontsource-variable/atkinson-hyperlegible-mono'
]

const fontPackageDirectories = FONT_PACKAGES.map((name) => {
  return fileURLToPath(
    new URL('.', import.meta.resolve(`${name}/package.json`))
  )
})

export default defineConfig(({ command }) => {
  return {
    resolve: {
      alias: [
        THEME_AWARE_CLASS_MERGE,
        ...(command === 'serve' ? DEVELOPMENT_ALIASES : [])
      ]
    },
    build: {
      target: BROWSER_FLOOR_TARGETS
    },
    ssr: {
      external: PACKAGES_SHARED_WITH_THE_HOST
    },
    server: {
      port: DEV_PORT,
      strictPort: true,
      warmup: {
        clientFiles: ['./src/routes/**/*.tsx', './src/components/session/*.tsx']
      },
      fs: {
        allow: [
          searchForWorkspaceRoot(process.cwd()),
          ...fontPackageDirectories
        ]
      }
    },
    plugins: [
      tailwindcss(),
      cn({ content: ['src/**/*.{ts,tsx}'], out: 'src/lib/cn-tables.ts' }),
      tanstackStart({
        spa: {
          enabled: true
        },
        importProtection: {
          client: {
            specifiers: SERVER_ONLY_SPECIFIERS
          }
        },
        router: {
          quoteStyle: 'single',
          semicolons: false
        }
      }),
      react({ compiler: { logDiagnostics: true } })
    ]
  }
})
