import { ITagDriver } from './ITagDriver.js'
import { CliTagDriver, CliBinaries } from './CliTagDriver.js'

export type { ITagDriver, TagMap, TagValue, FileInfo } from './ITagDriver.js'
export { CliTagDriver } from './CliTagDriver.js'

// Registry — drivers are tried in order, first match wins
const drivers: ITagDriver[] = []

export function registerDriver(driver: ITagDriver): void {
  drivers.push(driver)
}

export function driverFor(filePath: string): ITagDriver {
  const driver = drivers.find(d => d.canHandle(filePath))
  if (!driver) throw new Error(`No driver available for: ${filePath}`)
  return driver
}

// Initialise with the CLI driver using the provided binary paths
export function initDrivers(bins: CliBinaries = {}): void {
  drivers.length = 0
  registerDriver(new CliTagDriver(bins))
}
