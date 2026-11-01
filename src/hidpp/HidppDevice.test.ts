import { describe, expect, it } from 'vitest'
import { HidppDevice } from './HidppDevice'
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
})
