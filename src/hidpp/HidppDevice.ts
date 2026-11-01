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

const LONG_REPORT_ID = 0x11
const LONG_PARAMS_LENGTH = 16
const ERROR_FEATURE_INDEX = 0xff
const ROOT_FEATURE_INDEX = 0x00
const SOFTWARE_ID = 0x0a
const RESPONSE_TIMEOUT_MS = 2000

const FEATURE_UNIFIED_BATTERY = 0x1004
const FEATURE_EXTENDED_REPORT_RATE = 0x8061


const CHARGING_STATES = new Set([1, 2, 3])

export class HidppError extends Error {}

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
