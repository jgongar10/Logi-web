import { REPORT_RATE_HZ } from './reportRate'

/** The settings of a Perfil onboard that Logi-web edits. */
export interface OnboardProfile {
  dpiStages: number[]
  defaultStage: number
  pollingRateHz: { receiver: number; cable: number }
}

// Profile format 7 (base "v6") layout, confirmed against a real PRO X 2 dump.
const RATE_RECEIVER = 0x00
const RATE_CABLE = 0x01
const DEFAULT_STAGE = 0x02
const FIRST_STAGE = 0x04
const STAGE_SIZE = 5
const STAGE_COUNT = 5
const MIN_DPI = 100
const MAX_DPI = 32000
const DPI_STEP = 50

export class OnboardProfileError extends Error {}

/** CRC-CCITT (polynomial 0x1021, initial value 0xFFFF) as used by 0x8100 sectors. */
function crc16(bytes: Uint8Array): number {
  let crc = 0xffff
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc
}

function storedCrc(sector: Uint8Array): number {
  return (sector[sector.length - 2] << 8) | sector[sector.length - 1]
}

export function decodeOnboardProfile(sector: Uint8Array): OnboardProfile {
  if (crc16(sector.subarray(0, -2)) !== storedCrc(sector)) {
    throw new OnboardProfileError('Onboard profile CRC mismatch')
  }
  const dpiStages: number[] = []
  for (let i = 0; i < STAGE_COUNT; i++) {
    const offset = FIRST_STAGE + i * STAGE_SIZE
    dpiStages.push(sector[offset] | (sector[offset + 1] << 8))
  }
  return {
    dpiStages,
    defaultStage: sector[DEFAULT_STAGE],
    pollingRateHz: {
      receiver: REPORT_RATE_HZ[sector[RATE_RECEIVER]],
      cable: REPORT_RATE_HZ[sector[RATE_CABLE]],
    },
  }
}

function rateIndex(hz: number): number {
  const index = REPORT_RATE_HZ.indexOf(hz)
  if (index === -1) throw new OnboardProfileError(`${hz} Hz is not a storable Polling rate`)
  return index
}

/**
 * Writes `profile` into a copy of `sector`, leaving every byte Logi-web does
 * not edit (buttons, lift-off, unknown fields) untouched, and refreshes the CRC.
 */
export function encodeOnboardProfile(sector: Uint8Array, profile: OnboardProfile): Uint8Array {
  const { dpiStages, defaultStage } = profile
  if (dpiStages.length !== STAGE_COUNT) {
    throw new OnboardProfileError(`Expected ${STAGE_COUNT} DPI stages, got ${dpiStages.length}`)
  }
  if (!Number.isInteger(defaultStage) || defaultStage < 0 || defaultStage >= STAGE_COUNT) {
    throw new OnboardProfileError(`Default stage ${defaultStage} does not exist`)
  }
  for (const dpi of dpiStages) {
    if (!Number.isInteger(dpi) || dpi < MIN_DPI || dpi > MAX_DPI || dpi % DPI_STEP !== 0) {
      throw new OnboardProfileError(`${dpi} DPI is outside ${MIN_DPI}–${MAX_DPI} in steps of ${DPI_STEP}`)
    }
  }
  const result = sector.slice()
  result[RATE_RECEIVER] = rateIndex(profile.pollingRateHz.receiver)
  result[RATE_CABLE] = rateIndex(profile.pollingRateHz.cable)
  result[DEFAULT_STAGE] = profile.defaultStage
  profile.dpiStages.forEach((dpi, i) => {
    const offset = FIRST_STAGE + i * STAGE_SIZE
    result.set([dpi & 0xff, dpi >> 8, dpi & 0xff, dpi >> 8], offset)
  })
  const crc = crc16(result.subarray(0, -2))
  result.set([crc >> 8, crc & 0xff], result.length - 2)
  return result
}
