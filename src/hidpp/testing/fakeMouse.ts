import fixture from '../fixtures/pro-x-2-receiver.json'
import onboard from '../fixtures/pro-x-2-onboard-sectors.json'
import type { HidTransport, InputReport } from '../HidppDevice'

const LONG_REPORT_ID = 0x11
const ERROR_FEATURE_INDEX = 0xff
const ERR_INVALID_ARGUMENT = 0x02
const ONBOARD_PROFILES_INDEX = fixture.featureTable['0x8100']
const BATTERY_INDEX = fixture.featureTable['0x1004']
const EXTENDED_DPI_INDEX = fixture.featureTable['0x2202']
const EXTENDED_RATE_INDEX = fixture.featureTable['0x8061']
const SET_MODE = 1
const GET_MODE = 2
const SET_CURRENT_PROFILE = 3
const MEMORY_READ = 5
const MEMORY_ADDR_WRITE = 6
const MEMORY_WRITE = 7
const MEMORY_WRITE_END = 8
const CHUNK = 16
const ACK = '00'.repeat(16)

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * A stand-in for the WebHID device of the Receptor, answering HID++ long
 * reports with the real responses captured from the Ratón.
 */
export class FakeMouse implements HidTransport {
  readonly sent: Uint8Array[] = []
  /** Onboard memory by sector address, starting from the captured dump. */
  readonly sectors = new Map<number, Uint8Array>(
    Object.entries(onboard.sectors).map(([address, hex]) => [
      parseInt(address, 16),
      Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16)),
    ]),
  )
  /** Set to make the Ratón silently store something other than it was sent, once. */
  corruptNextWrite = false
  /** Overrides the captured battery reading (0x1004 getStatus). */
  battery: { percent: number; charging: boolean } | null = null
  mode: 'onboard' | 'host' = 'onboard'
  liveDpi: { x: number; y: number; lod: number } | null = null
  liveRateIndex: number | null = null
  reloadedProfileSector: number | null = null
  private pendingWrite: { sector: number; length: number; data: number[] } | null = null
  private readonly listeners = new Set<(event: InputReport) => void>()

  addEventListener(_type: 'inputreport', listener: (event: InputReport) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'inputreport', listener: (event: InputReport) => void): void {
    this.listeners.delete(listener)
  }

  async sendReport(reportId: number, data: BufferSource): Promise<void> {
    const bytes = new Uint8Array(ArrayBuffer.isView(data) ? data.buffer : data)
    this.sent.push(bytes)
    if (reportId !== LONG_REPORT_ID) return
    const [deviceIndex, featureIndex, fnSwid] = bytes
    const params = toHex(bytes.slice(3))
    const prefix = `${featureIndex.toString(16).padStart(2, '0')}:${fnSwid >> 4}:`
    const key = Object.keys(fixture.responses).find(
      (k) => k.startsWith(prefix) && params.startsWith(k.slice(prefix.length)),
    )
    const hex =
      featureIndex === EXTENDED_DPI_INDEX && fnSwid >> 4 === 6
        ? this.setLiveDpi(bytes.slice(3))
        : featureIndex === EXTENDED_RATE_INDEX && fnSwid >> 4 === 3
          ? this.setLiveRate(bytes.slice(3))
          : featureIndex === BATTERY_INDEX && fnSwid >> 4 === 1 && this.battery
        ? toHex(Uint8Array.of(this.battery.percent, 0, this.battery.charging ? 1 : 0)).padEnd(32, '0')
        : featureIndex === ONBOARD_PROFILES_INDEX && fnSwid >> 4 >= SET_MODE && fnSwid >> 4 !== 4
        ? this.onboardMemory(fnSwid >> 4, bytes.slice(3))
        : key && fixture.responses[key as keyof typeof fixture.responses]
    const reply = new Uint8Array(19)
    reply[0] = deviceIndex
    if (deviceIndex !== fixture.deviceIndex || !hex) {
      reply.set([ERROR_FEATURE_INDEX, featureIndex, fnSwid, ERR_INVALID_ARGUMENT], 1)
    } else {
      reply.set([featureIndex, fnSwid], 1)
      reply.set(hex.match(/../g)!.map((h) => parseInt(h, 16)), 3)
    }
    this.reply(reply)
  }

  private reply(reply: Uint8Array) {
    queueMicrotask(() => {
      const event = { reportId: LONG_REPORT_ID, data: new DataView(reply.buffer) }
      for (const listener of [...this.listeners]) listener(event)
    })
  }

  /** Models 0x8100 memoryRead / memoryAddrWrite / memoryWrite / memoryWriteEnd. */
  private onboardMemory(fn: number, params: Uint8Array): string | undefined {
    if (fn === SET_MODE) {
      if (params[0] !== 1 && params[0] !== 2) return undefined
      this.mode = params[0] === 1 ? 'onboard' : 'host'
      return ACK
    }
    if (fn === GET_MODE) return (this.mode === 'onboard' ? '01' : '02').padEnd(32, '0')
    if (fn === SET_CURRENT_PROFILE) {
      this.reloadedProfileSector = (params[0] << 8) | params[1]
      return ACK
    }
    if (fn === MEMORY_READ) {
      const sector = this.sectors.get((params[0] << 8) | params[1])
      const offset = (params[2] << 8) | params[3]
      if (!sector || offset > onboard.sectorSize - CHUNK) return undefined
      return toHex(sector.slice(offset, offset + CHUNK))
    }
    if (fn === MEMORY_ADDR_WRITE) {
      const sector = (params[0] << 8) | params[1]
      const length = (params[4] << 8) | params[5]
      if (!this.sectors.has(sector) || length !== onboard.sectorSize) return undefined
      this.pendingWrite = { sector, length, data: [] }
      return ACK
    }
    if (fn === MEMORY_WRITE && this.pendingWrite) {
      this.pendingWrite.data.push(...params.slice(0, CHUNK))
      return ACK
    }
    if (fn === MEMORY_WRITE_END && this.pendingWrite) {
      const { sector, length, data } = this.pendingWrite
      const stored = Uint8Array.from(data.slice(0, length))
      if (this.corruptNextWrite) {
        stored[0x10] ^= 0xff
        this.corruptNextWrite = false
      }
      this.sectors.set(sector, stored)
      this.pendingWrite = null
      return ACK
    }
    return undefined
  }

  private setLiveDpi(params: Uint8Array): string {
    this.liveDpi = { x: (params[1] << 8) | params[2], y: (params[3] << 8) | params[4], lod: params[5] }
    return ACK
  }

  private setLiveRate(params: Uint8Array): string {
    this.liveRateIndex = params[0]
    return ACK
  }
}
