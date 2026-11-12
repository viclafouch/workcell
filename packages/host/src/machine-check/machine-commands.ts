export type MachineCommands = {
  check: string
  setup: string
  setSecret: (name: string) => string
}
