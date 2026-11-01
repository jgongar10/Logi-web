import { describe, expect, it } from 'vitest'
import { BackupError, parseBackup, serializeBackup } from './backup'
import { HidppDevice } from './HidppDevice'
import { FakeMouse } from './testing/fakeMouse'

describe('Copia de seguridad', () => {
  it('round-trips the onboard memory through its file', async () => {
    const memory = await new HidppDevice(new FakeMouse(), 1).readOnboardMemory()

    const file = serializeBackup(memory, { deviceName: 'PRO X 2', takenAt: new Date('2026-11-01T22:00:00Z') })

    expect(parseBackup(file)).toEqual(memory)
  })

  it('refuses a file that is not a Logi-web Copia de seguridad', () => {
    expect(() => parseBackup('{"hello": "world"}')).toThrow(BackupError)
  })
})
