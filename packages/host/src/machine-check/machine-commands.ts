export type MachineCommands = {
  check: string
  setup: string
  migrate: string
  setSecret: (name: string) => string
}
