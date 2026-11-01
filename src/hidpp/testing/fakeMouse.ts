import fixture from '../fixtures/pro-x-2-receiver.json'
import onboard from '../fixtures/pro-x-2-onboard-sectors.json'
import type { HidTransport, InputReport } from '../HidppDevice'

const LONG_REPORT_ID = 0x11
const ERROR_FEATURE_INDEX = 0xff
const ERR_INVALID_ARGUMENT = 0x02
const ONBOARD_PROFILES_INDEX = fixture.featureTable['0x8100']
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
  /** Set to make the Ratón silently store something other than what it was sent. */
  corruptWrites = false
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
      featureIndex === ONBOARD_PROFILES_INDEX && fnSwid >> 4 >= MEMORY_READ
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
      if (this.corruptWrites) stored[0x10] ^= 0xff
      this.sectors.set(sector, stored)
      this.pendingWrite = null
      return ACK
    }
    return undefined
  }
}
