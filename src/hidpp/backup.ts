import type { OnboardMemory } from './HidppDevice'

const FORMAT = 'logi-web-backup'
const VERSION = 1

export class BackupError extends Error {}

interface BackupFile {
  format: typeof FORMAT
  version: typeof VERSION
  deviceName: string
  takenAt: string
  profileFormat: number
  sectorSize: number
  sectors: Record<string, string>
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

export function serializeBackup(
  memory: OnboardMemory,
  meta: { deviceName: string; takenAt: Date },
): string {
  const file: BackupFile = {
    format: FORMAT,
    version: VERSION,
    deviceName: meta.deviceName,
    takenAt: meta.takenAt.toISOString(),
    profileFormat: memory.profileFormat,
    sectorSize: memory.sectorSize,
    sectors: Object.fromEntries(
      [...memory.sectors].map(([address, bytes]) => [address.toString(16).padStart(4, '0'), toHex(bytes)]),
    ),
  }
  return JSON.stringify(file, null, 2)
}

export function parseBackup(text: string): OnboardMemory {
  const file = JSON.parse(text) as Partial<BackupFile>
  if (file.format !== FORMAT || file.version !== VERSION || !file.sectors || !file.sectorSize) {
    throw new BackupError('Not a Logi-web Copia de seguridad')
  }
  const sectors = new Map<number, Uint8Array>()
  for (const [address, hex] of Object.entries(file.sectors)) {
    if (!/^([0-9a-f]{2})*$/.test(hex) || hex.length !== file.sectorSize * 2) {
      throw new BackupError(`Sector ${address} is damaged`)
    }
    sectors.set(parseInt(address, 16), Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16)))
  }
  return { profileFormat: file.profileFormat!, sectorSize: file.sectorSize, sectors }
}
