import type React from 'react'
import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  ScriptOnce
} from '@tanstack/react-router'
import { COLOR_SCHEME_SCRIPT } from '#/lib/color-scheme.ts'
import appCss from '#/styles.css?url'

type RootDocumentProps = {
  children: React.ReactNode
}

const RootDocument = ({ children }: RootDocumentProps) => {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta
          name="color-scheme"
          content="light dark"
          suppressHydrationWarning
        />
        <HeadContent />
        <ScriptOnce>{COLOR_SCHEME_SCRIPT}</ScriptOnce>
      </head>
      <body>
        <a
          href="#main-content"
          className="sr-only rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-overlay"
        >
          Skip to the content
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    head: () => {
      return {
        meta: [
          { charSet: 'utf8' },
          {
            name: 'viewport',
            content: 'width=device-width, initial-scale=1, viewport-fit=cover'
          },
          { name: 'robots', content: 'noindex, nofollow' },
          {
            name: 'description',
            content:
              'What the workers and the bot of this project do right now.'
          },
          { title: 'What runs now' }
        ],
        links: [
          { rel: 'stylesheet', href: appCss },
          { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }
        ]
      }
    },
    shellComponent: RootDocument,
    component: Outlet
  }
)
