import { describe, expect, it } from 'vitest'
import { HidppDevice, HidppError, LowBatteryError } from './HidppDevice'
import onboard from './fixtures/pro-x-2-onboard-sectors.json'
import { decodeOnboardProfile } from './onboardProfile'
import { parseBackup, serializeBackup } from './backup'
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
      expect(fake.reloadedProfileSector).toBe(0x0001)
    })

    it('restores the original profile when the Ratón does not store what it was sent', async () => {
      const fake = new FakeMouse()
      const original = fake.sectors.get(0x0001)!
      fake.corruptNextWrite = true
      const mouse = new HidppDevice(fake, 1)

      await expect(mouse.saveActiveProfile(edited)).rejects.toThrow(HidppError)

      expect(fake.sectors.get(0x0001)).toEqual(original)
    })

    it('refuses to save on low battery while not charging, without touching memory', async () => {
      const fake = new FakeMouse()
      fake.battery = { percent: 9, charging: false }
      const original = fake.sectors.get(0x0001)!
      const mouse = new HidppDevice(fake, 1)

      await expect(mouse.saveActiveProfile(edited)).rejects.toThrow(LowBatteryError)

      expect(fake.sectors.get(0x0001)).toEqual(original)
    })

    it('saves on low battery while charging', async () => {
      const fake = new FakeMouse()
      fake.battery = { percent: 9, charging: true }
      const mouse = new HidppDevice(fake, 1)

      await mouse.saveActiveProfile(edited)

      expect(decodeOnboardProfile(fake.sectors.get(0x0001)!)).toEqual(edited)
    })

    it('does not write to the Ratón when nothing changed', async () => {
      const fake = new FakeMouse()
      const mouse = new HidppDevice(fake, 1)
      const unchanged = decodeOnboardProfile(fake.sectors.get(0x0001)!)

      await mouse.saveActiveProfile(unchanged)

      const memoryWrites = fake.sent.filter(([, feature, fnSwid]) => feature === 0x0d && fnSwid >> 4 >= 6)
      expect(memoryWrites).toEqual([])
    })
  })
  it('restores onboard memory from a Copia de seguridad, writing only changed sectors', async () => {
    const fake = new FakeMouse()
    const mouse = new HidppDevice(fake, 1)
    const backup = serializeBackup(await mouse.readOnboardMemory(), {
      deviceName: 'PRO X 2',
      takenAt: new Date(),
    })
    await mouse.saveActiveProfile({
      dpiStages: [400, 1200, 1600, 2400, 3200],
      defaultStage: 2,
      pollingRateHz: { receiver: 8000, cable: 1000 },
    })
    fake.sent.length = 0

    await mouse.restoreOnboardMemory(parseBackup(backup))

    expect(toHex(fake.sectors.get(0x0001)!)).toBe(onboard.sectors['0001'])
    const writtenSectors = fake.sent
      .filter(([, feature, fnSwid]) => feature === 0x0d && fnSwid >> 4 === 6)
      .map((bytes) => (bytes[3] << 8) | bytes[4])
    expect(writtenSectors).toEqual([0x0001])
  })
  it('detects host mode and switches back to onboard profiles on request', async () => {
    const fake = new FakeMouse()
    fake.mode = 'host'
    const mouse = new HidppDevice(fake, 1)

    expect(await mouse.getMode()).toBe('host')
    await mouse.useOnboardProfiles()
    expect(await mouse.getMode()).toBe('onboard')
  })
  describe('Aplicar en vivo', () => {
    it('applies DPI to both axes while preserving the sensor lift-off byte', async () => {
      const fake = new FakeMouse()
      const mouse = new HidppDevice(fake, 1)

      await mouse.applyLiveDpi(1600)

      expect(fake.liveDpi).toEqual({ x: 1600, y: 1600, lod: 0x02 })
    })

    it('applies a Polling rate by its HID++ rate index', async () => {
      const fake = new FakeMouse()
      const mouse = new HidppDevice(fake, 1)

      await mouse.applyLivePollingRate(4000)

      expect(fake.liveRateIndex).toBe(5)
    })
  })
})

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
