import fixture from '../fixtures/pro-x-2-receiver.json'
import onboard from '../fixtures/pro-x-2-onboard-sectors.json'
import type { HidTransport, InputReport } from '../HidppDevice'

const LONG_REPORT_ID = 0x11
const ERROR_FEATURE_INDEX = 0xff
const ERR_INVALID_ARGUMENT = 0x02
const ONBOARD_PROFILES_INDEX = fixture.featureTable['0x8100']
const MEMORY_READ = 5
const READ_LENGTH = 16

/** Answers 0x8100 memoryRead from the captured onboard memory dump. */
function readMemory(params: Uint8Array): string | undefined {
  const sector = (params[0] << 8) | params[1]
  const offset = (params[2] << 8) | params[3]
  const hex = onboard.sectors[sector.toString(16).padStart(4, '0') as keyof typeof onboard.sectors]
  if (hex === undefined || offset > onboard.sectorSize - READ_LENGTH) return undefined
  return hex.slice(offset * 2, (offset + READ_LENGTH) * 2)
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/**
 * A stand-in for the WebHID device of the Receptor, answering HID++ long
 * reports with the real responses captured from the Ratón.
 */
export class FakeMouse implements HidTransport {
  readonly sent: Uint8Array[] = []
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
      featureIndex === ONBOARD_PROFILES_INDEX && fnSwid >> 4 === MEMORY_READ
        ? readMemory(bytes.slice(3))
        : key && fixture.responses[key as keyof typeof fixture.responses]
    const reply = new Uint8Array(19)
    reply[0] = deviceIndex
    if (deviceIndex !== fixture.deviceIndex || !hex) {
      reply.set([ERROR_FEATURE_INDEX, featureIndex, fnSwid, ERR_INVALID_ARGUMENT], 1)
    } else {
      reply.set([featureIndex, fnSwid], 1)
      reply.set(hex.match(/../g)!.map((h) => parseInt(h, 16)), 3)
    }
    queueMicrotask(() => {
      const event = { reportId: LONG_REPORT_ID, data: new DataView(reply.buffer) }
      for (const listener of [...this.listeners]) listener(event)
    })
  }
}
