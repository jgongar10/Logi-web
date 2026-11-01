import { describe, expect, it } from 'vitest'
import { HidppDevice, HidppError } from './HidppDevice'
import onboard from './fixtures/pro-x-2-onboard-sectors.json'
import { decodeOnboardProfile } from './onboardProfile'
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
  it('finds the sector holding the Perfil activo', async () => {
    const mouse = new HidppDevice(new FakeMouse(), 1)

    expect(await mouse.getActiveProfileSector()).toBe(0x0001)
  })
  describe('Guardar', () => {
    const edited = {
      dpiStages: [400, 1200, 1600, 2400, 3200],
      defaultStage: 1,
      pollingRateHz: { receiver: 8000, cable: 1000 },
    }

    it('stores the edited settings in the Perfil activo', async () => {
      const fake = new FakeMouse()
      const mouse = new HidppDevice(fake, 1)

      await mouse.saveActiveProfile(edited)

      expect(decodeOnboardProfile(fake.sectors.get(0x0001)!)).toEqual(edited)
    })

    it('restores the original profile when the Ratón does not store what it was sent', async () => {
      const fake = new FakeMouse()
      const original = fake.sectors.get(0x0001)!
      fake.corruptNextWrite = true
      const mouse = new HidppDevice(fake, 1)

      await expect(mouse.saveActiveProfile(edited)).rejects.toThrow(HidppError)

      expect(fake.sectors.get(0x0001)).toEqual(original)
    })
  })
})

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
