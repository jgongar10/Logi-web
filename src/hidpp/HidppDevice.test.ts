import { describe, expect, it } from 'vitest'
import { HidppDevice } from './HidppDevice'
import { FakeMouse } from './testing/fakeMouse'

describe('HidppDevice', () => {
  it('reads battery percentage and charging state', async () => {
    const mouse = new HidppDevice(new FakeMouse(), 1)

    expect(await mouse.getBattery()).toEqual({ percent: 58, charging: false })
  })
})
