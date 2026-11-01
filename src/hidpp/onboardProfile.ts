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

export function decodeOnboardProfile(sector: Uint8Array): OnboardProfile {
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
