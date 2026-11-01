import { describe, expect, it } from 'vitest'
import dump from './fixtures/pro-x-2-onboard-sectors.json'
import { decodeOnboardProfile, encodeOnboardProfile, OnboardProfileError } from './onboardProfile'

const sector = (address: keyof typeof dump.sectors) =>
  Uint8Array.from(dump.sectors[address]!.match(/../g)!, (h) => parseInt(h, 16))

describe('decodeOnboardProfile', () => {
  it('reads the DPI stages, default stage and Polling rate of the active profile', () => {
    expect(decodeOnboardProfile(sector('0001'))).toEqual({
      dpiStages: [850, 1200, 1600, 2400, 3200],
      defaultStage: 0,
      pollingRateHz: { receiver: 1000, cable: 1000 },
    })
  })
  it('refuses a profile whose CRC does not match its contents', () => {
    const corrupted = sector('0001')
    corrupted[0x04] ^= 0x01

    expect(() => decodeOnboardProfile(corrupted)).toThrow(OnboardProfileError)
  })})

describe('encodeOnboardProfile', () => {
  it("reproduces the Ratón's own bytes when nothing changed", () => {
    const original = sector('0001')

    expect(encodeOnboardProfile(original, decodeOnboardProfile(original))).toEqual(original)
  })
})
