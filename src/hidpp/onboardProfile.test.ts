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
  it('writes only the edited fields and the CRC, leaving lift-off and buttons untouched', () => {
    const original = sector('0001')
    const edited = {
      dpiStages: [400, 1200, 1600, 2400, 3200],
      defaultStage: 2,
      pollingRateHz: { receiver: 8000, cable: 1000 },
    }

    const encoded = encodeOnboardProfile(original, edited)

    expect(decodeOnboardProfile(encoded)).toEqual(edited)
    const changedOffsets = [...encoded.keys()].filter((i) => encoded[i] !== original[i])
    expect(changedOffsets).toEqual([0x00, 0x02, 0x04, 0x05, 0x06, 0x07, 0xfd, 0xfe])
  })
  it('refuses a Polling rate the format cannot store', () => {
    const original = sector('0001')
    const profile = { ...decodeOnboardProfile(original), pollingRateHz: { receiver: 3000, cable: 1000 } }

    expect(() => encodeOnboardProfile(original, profile)).toThrow(OnboardProfileError)
  })

  it.each([50, 32050, 1225])('refuses %i DPI, outside 100–32000 in steps of 50', (dpi) => {
    const original = sector('0001')
    const profile = { ...decodeOnboardProfile(original), dpiStages: [dpi, 1200, 1600, 2400, 3200] }

    expect(() => encodeOnboardProfile(original, profile)).toThrow(OnboardProfileError)
  })
  it.each([
    ['six stages', { dpiStages: [400, 800, 1200, 1600, 2400, 3200], defaultStage: 0 }],
    ['a default stage that does not exist', { dpiStages: [800, 1200, 1600, 2400, 3200], defaultStage: 5 }],
  ])('refuses %s', (_, change) => {
    const original = sector('0001')
    const profile = { ...decodeOnboardProfile(original), ...change }

    expect(() => encodeOnboardProfile(original, profile)).toThrow(OnboardProfileError)
  })
})
