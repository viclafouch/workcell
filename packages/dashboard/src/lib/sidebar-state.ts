import { SIDEBAR_STATE_COOKIE } from '#/constants/navigation.ts'

export const readIsSidebarOpen = () => {
  const stored = document.cookie
    .split('; ')
    .find((entry) => {
      return entry.startsWith(`${SIDEBAR_STATE_COOKIE}=`)
    })
    ?.split('=')[1]

  return stored !== 'false'
}
