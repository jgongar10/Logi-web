import { describe, expect, it } from 'vitest'
import { HidppDevice } from './HidppDevice'
import onboard from './fixtures/pro-x-2-onboard-sectors.json'
import { FakeMouse } from './testing/fakeMouse'

describe('HidppDevice', () => {
  it('reads battery percentage and charging state', async () => {
    const mouse = new HidppDevice(new FakeMouse(), 1)

    expect(await mouse.getBattery()).toEqual({ percent: 58, charging: false })
  })
  it('reads the current Polling rate and the rates the Ratón offers', async () => {
    const mouse = new HidppDevice(new FakeMouse(), 1)

    expect(await mouse.getPollingRate()).toEqual({
      currentHz: 1000,
      availableHz: [125, 250, 500, 1000, 2000, 4000, 8000],
    })
  })
  it('reads the whole onboard memory for a Copia de seguridad', async () => {
    const mouse = new HidppDevice(new FakeMouse(), 1)

    const memory = await mouse.readOnboardMemory()

    expect(memory.profileFormat).toBe(7)
    expect(memory.sectorSize).toBe(255)
    expect([...memory.sectors.keys()]).toEqual([...Array(16).keys()])
    expect(toHex(memory.sectors.get(0x0001)!)).toBe(onboard.sectors['0001'])
    expect(toHex(memory.sectors.get(0x000f)!)).toBe('ff'.repeat(255))
  })
})

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
