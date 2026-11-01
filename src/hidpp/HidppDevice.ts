import { encodeOnboardProfile, type OnboardProfile } from './onboardProfile'
import { REPORT_RATE_HZ } from './reportRate'

export interface InputReport {
  reportId: number
  data: DataView
}

type InputReportListener = (event: InputReport) => void

/** The part of WebHID's `HIDDevice` that HID++ needs. */
export interface HidTransport {
  sendReport(reportId: number, data: BufferSource): Promise<void>
  addEventListener(type: 'inputreport', listener: InputReportListener): void
  removeEventListener(type: 'inputreport', listener: InputReportListener): void
}

export interface Battery {
  percent: number
  charging: boolean
}

export interface PollingRate {
  currentHz: number
  availableHz: number[]
}

export interface OnboardMemory {
  profileFormat: number
  sectorSize: number
  /** Flash sectors by address, each `sectorSize` bytes. */
  sectors: Map<number, Uint8Array>
}

const LONG_REPORT_ID = 0x11
const LONG_PARAMS_LENGTH = 16
const ERROR_FEATURE_INDEX = 0xff
const ROOT_FEATURE_INDEX = 0x00
const SOFTWARE_ID = 0x0a
const RESPONSE_TIMEOUT_MS = 2000

const FEATURE_UNIFIED_BATTERY = 0x1004
const FEATURE_EXTENDED_REPORT_RATE = 0x8061
const FEATURE_ONBOARD_PROFILES = 0x8100

const ONBOARD_GET_INFO = 0
const ONBOARD_SET_CURRENT_PROFILE = 3
const ONBOARD_GET_CURRENT_PROFILE = 4
const ONBOARD_MEMORY_READ = 5
const ONBOARD_MEMORY_ADDR_WRITE = 6
const ONBOARD_MEMORY_WRITE = 7
const ONBOARD_MEMORY_WRITE_END = 8


const CHARGING_STATES = new Set([1, 2, 3])

export class HidppError extends Error {}

/** Guardar is refused so the Ratón cannot power off halfway through a memory write. */
export class LowBatteryError extends HidppError {}

const MIN_BATTERY_TO_SAVE = 10

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i])

/** A Ratón reached over HID++ 2.0 through a WebHID transport. */
export class HidppDevice {
  private readonly featureIndexes = new Map<number, number>()

  constructor(
    private readonly transport: HidTransport,
    private readonly deviceIndex: number,
  ) {}

  async getBattery(): Promise<Battery> {
    const [percent, , chargingStatus] = await this.call(FEATURE_UNIFIED_BATTERY, 1)
    return { percent, charging: CHARGING_STATES.has(chargingStatus) }
  }

  async getPollingRate(): Promise<PollingRate> {
    const [maskHigh, maskLow] = await this.call(FEATURE_EXTENDED_REPORT_RATE, 1)
    const [currentIndex] = await this.call(FEATURE_EXTENDED_REPORT_RATE, 2)
    const mask = (maskHigh << 8) | maskLow
    return {
      currentHz: REPORT_RATE_HZ[currentIndex],
      availableHz: REPORT_RATE_HZ.filter((_, index) => mask & (1 << index)),
    }
  }

  async getActiveProfileSector(): Promise<number> {
    const [high, low] = await this.call(FEATURE_ONBOARD_PROFILES, ONBOARD_GET_CURRENT_PROFILE)
    return (high << 8) | low
  }

  /** Writes `profile` into the Perfil activo, keeping every byte it does not edit. */
  private async ensureSafeBattery(): Promise<void> {
    const battery = await this.getBattery()
    if (battery.percent < MIN_BATTERY_TO_SAVE && !battery.charging) {
      throw new LowBatteryError(`Battery at ${battery.percent} %`)
    }
  }

  async saveActiveProfile(profile: OnboardProfile): Promise<void> {
    await this.ensureSafeBattery()
    const sectorSize = await this.sectorSize()
    const address = await this.getActiveProfileSector()
    const current = await this.readSector(address, sectorSize)
    const updated = encodeOnboardProfile(current, profile)
    if (sameBytes(updated, current)) return
    try {
      await this.writeSector(address, updated)
      const stored = await this.readSector(address, sectorSize)
      if (!sameBytes(stored, updated)) throw new HidppError('The Ratón did not store the profile as written')
      await this.reloadProfile(address)
    } catch (error) {
      await this.writeSector(address, current).catch(() => undefined)
      throw error
    }
  }

  async restoreOnboardMemory(backup: OnboardMemory): Promise<void> {
    await this.ensureSafeBattery()
    const current = await this.readOnboardMemory()
    if (backup.sectorSize !== current.sectorSize) {
      throw new HidppError(`Backup sector size ${backup.sectorSize} does not match Ratón ${current.sectorSize}`)
    }
    for (const [address, target] of backup.sectors) {
      const existing = current.sectors.get(address)
      if (!existing || sameBytes(existing, target)) continue
      await this.writeSector(address, target)
      const stored = await this.readSector(address, current.sectorSize)
      if (!sameBytes(stored, target)) {
        throw new HidppError(`The Ratón did not store sector 0x${address.toString(16)} as written`)
      }
    }
    await this.reloadProfile(await this.getActiveProfileSector())
  }

  private async reloadProfile(address: number): Promise<void> {
    await this.call(FEATURE_ONBOARD_PROFILES, ONBOARD_SET_CURRENT_PROFILE, [address >> 8, address & 0xff])
  }

  async readOnboardMemory(): Promise<OnboardMemory> {
    const info = await this.call(FEATURE_ONBOARD_PROFILES, ONBOARD_GET_INFO)
    const profileFormat = info[1]
    const sectorCount = info[6]
    const sectorSize = (info[7] << 8) | info[8]
    const sectors = new Map<number, Uint8Array>()
    for (let address = 0; address < sectorCount; address++) {
      sectors.set(address, await this.readSector(address, sectorSize))
    }
    return { profileFormat, sectorSize, sectors }
  }

  private async sectorSize(): Promise<number> {
    const info = await this.call(FEATURE_ONBOARD_PROFILES, ONBOARD_GET_INFO)
    return (info[7] << 8) | info[8]
  }

  private async writeSector(address: number, bytes: Uint8Array): Promise<void> {
    await this.call(FEATURE_ONBOARD_PROFILES, ONBOARD_MEMORY_ADDR_WRITE, [
      address >> 8, address & 0xff, 0, 0, bytes.length >> 8, bytes.length & 0xff,
    ])
    for (let offset = 0; offset < bytes.length; offset += LONG_PARAMS_LENGTH) {
      const chunk = new Uint8Array(LONG_PARAMS_LENGTH).fill(0xff)
      chunk.set(bytes.subarray(offset, offset + LONG_PARAMS_LENGTH))
      await this.call(FEATURE_ONBOARD_PROFILES, ONBOARD_MEMORY_WRITE, [...chunk])
    }
    await this.call(FEATURE_ONBOARD_PROFILES, ONBOARD_MEMORY_WRITE_END)
  }

  private async readSector(address: number, sectorSize: number): Promise<Uint8Array> {
    const sector = new Uint8Array(sectorSize)
    // Reads return 16 bytes and may not run past the sector, so the last read overlaps.
    const lastOffset = sectorSize - LONG_PARAMS_LENGTH
    for (let offset = 0; offset < sectorSize; offset += LONG_PARAMS_LENGTH) {
      const at = Math.min(offset, lastOffset)
      const chunk = await this.call(FEATURE_ONBOARD_PROFILES, ONBOARD_MEMORY_READ, [
        address >> 8, address & 0xff, at >> 8, at & 0xff,
      ])
      sector.set(chunk, at)
    }
    return sector
  }

  private async call(featureId: number, fn: number, params: number[] = []): Promise<Uint8Array> {
    const featureIndex = await this.featureIndex(featureId)
    return this.request(featureIndex, fn, params)
  }

  private async featureIndex(featureId: number): Promise<number> {
    const cached = this.featureIndexes.get(featureId)
    if (cached !== undefined) return cached
    const [index] = await this.request(ROOT_FEATURE_INDEX, 0, [featureId >> 8, featureId & 0xff])
    if (index === 0) {
      throw new HidppError(`Feature 0x${featureId.toString(16).padStart(4, '0')} not supported`)
    }
    this.featureIndexes.set(featureId, index)
    return index
  }

  private request(featureIndex: number, fn: number, params: number[]): Promise<Uint8Array> {
    const fnSwid = (fn << 4) | SOFTWARE_ID
    const report = new Uint8Array(3 + LONG_PARAMS_LENGTH)
    report.set([this.deviceIndex, featureIndex, fnSwid, ...params])

    return new Promise((resolve, reject) => {
      const onReport = (event: InputReport) => {
        if (event.reportId !== LONG_REPORT_ID) return
        const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
        if (data[0] !== this.deviceIndex) return
        if (data[1] === ERROR_FEATURE_INDEX && data[2] === featureIndex && data[3] === fnSwid) {
          finish()
          reject(new HidppError(`HID++ error 0x${data[4].toString(16)}`))
        } else if (data[1] === featureIndex && data[2] === fnSwid) {
          finish()
          resolve(data.slice(3))
        }
      }
      const timer = setTimeout(() => {
        finish()
        reject(new HidppError('Timed out waiting for the Ratón'))
      }, RESPONSE_TIMEOUT_MS)
      const finish = () => {
        clearTimeout(timer)
        this.transport.removeEventListener('inputreport', onReport)
      }
      this.transport.addEventListener('inputreport', onReport)
      this.transport.sendReport(LONG_REPORT_ID, report).catch((error) => {
        finish()
        reject(error)
      })
    })
  }
}
