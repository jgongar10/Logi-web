<script lang="ts">
  import { parseBackup, serializeBackup } from './hidpp/backup'
  import { LowBatteryError, type Battery, type OnboardMemory, type PollingRate } from './hidpp/HidppDevice'
  import { decodeOnboardProfile, type OnboardProfile } from './hidpp/onboardProfile'
  import { connectMouse, webHidSupported, type ConnectedMouse } from './lib/connectMouse'

  const CABLE_MAX_HZ = 1000
  const MIN_BATTERY_TO_SAVE = 10

  interface MouseSession {
    connected: ConnectedMouse
    mode: 'onboard' | 'host'
    battery: Battery
    pollingRate: PollingRate
    saved: OnboardProfile
    draft: OnboardProfile
    activeStage: number
    memory: OnboardMemory
    backupDownloaded: boolean
  }

  let session = $state<MouseSession | null>(null)
  let busy = $state<string | null>(null)
  let error = $state<string | null>(null)
  let liveNote = $state<string | null>(null)
  let restoreInput = $state<HTMLInputElement | null>(null)

  const cloneProfile = (p: OnboardProfile): OnboardProfile => ({
    dpiStages: [...p.dpiStages],
    defaultStage: p.defaultStage,
    pollingRateHz: { ...p.pollingRateHz },
  })

  const dirty = $derived(
    session !== null && JSON.stringify(session.draft) !== JSON.stringify(session.saved),
  )

  const lowBattery = $derived(
    session !== null && session.battery.percent < MIN_BATTERY_TO_SAVE && !session.battery.charging,
  )

  const connectionRates = $derived.by(() => {
    if (!session) return []
    const { availableHz } = session.pollingRate
    return session.connected.connection === 'cable'
      ? availableHz.filter((hz) => hz <= CABLE_MAX_HZ)
      : availableHz
  })

  const currentDraftHz = $derived.by(() => {
    if (!session) return 1000
    return session.connected.connection === 'cable'
      ? session.draft.pollingRateHz.cable
      : session.draft.pollingRateHz.receiver
  })

  async function loadFromMouse(connected: ConnectedMouse, backupDownloaded = false) {
    const { mouse } = connected
    const mode = await mouse.getMode()
    const battery = await mouse.getBattery()
    const pollingRate = await mouse.getPollingRate()
    const memory = await mouse.readOnboardMemory()
    const activeSector = await mouse.getActiveProfileSector()
    const saved = decodeOnboardProfile(memory.sectors.get(activeSector)!)
    session = {
      connected,
      mode,
      battery,
      pollingRate,
      saved,
      draft: cloneProfile(saved),
      activeStage: saved.defaultStage,
      memory,
      backupDownloaded,
    }
  }

  async function connect() {
    error = null
    liveNote = null
    busy = 'Leyendo el ratón…'
    try {
      const connected = await connectMouse()
      if (!connected) return
      await loadFromMouse(connected)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      busy = null
    }
  }

  function triggerBackupDownload(memory: OnboardMemory) {
    const takenAt = new Date()
    const file = serializeBackup(memory, { deviceName: 'PRO X 2', takenAt })
    const url = URL.createObjectURL(new Blob([file], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `logi-web-copia-${takenAt.toISOString().slice(0, 19).replace(/:/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  function downloadBackup() {
    if (!session) return
    triggerBackupDownload(session.memory)
    session.backupDownloaded = true
  }

  function clampDpi(value: number): number {
    if (!Number.isFinite(value)) return 800
    const stepped = Math.round(value / 50) * 50
    return Math.min(32000, Math.max(100, stepped))
  }

  async function tryLive(fn: () => Promise<void>) {
    try {
      await fn()
      liveNote = null
    } catch {
      liveNote = 'El ratón aplicará este ajuste al pulsar Guardar.'
    }
  }

  function setStageDpi(index: number, raw: number) {
    if (!session) return
    const dpi = clampDpi(raw)
    session.draft.dpiStages[index] = dpi
    session.activeStage = index
    void tryLive(() => session!.connected.mouse.applyLiveDpi(dpi))
  }

  function previewStage(index: number) {
    if (!session) return
    session.activeStage = index
    void tryLive(() => session!.connected.mouse.applyLiveDpi(session!.draft.dpiStages[index]))
  }

  function setDefaultStage(index: number) {
    if (!session) return
    session.draft.defaultStage = index
    previewStage(index)
  }

  function setPollingRate(hz: number) {
    if (!session) return
    if (session.connected.connection === 'cable') {
      session.draft.pollingRateHz.cable = hz
    } else {
      session.draft.pollingRateHz.receiver = hz
    }
    void tryLive(() => session!.connected.mouse.applyLivePollingRate(hz))
  }

  function discard() {
    if (!session) return
    session.draft = cloneProfile(session.saved)
    session.activeStage = session.saved.defaultStage
    liveNote = null
    void tryLive(() => session!.connected.mouse.applyLiveDpi(session!.saved.dpiStages[session!.saved.defaultStage]))
  }

  async function switchToOnboard() {
    if (!session) return
    error = null
    busy = 'Activando perfiles onboard…'
    try {
      await session.connected.mouse.useOnboardProfiles()
      await loadFromMouse(session.connected, session.backupDownloaded)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      busy = null
    }
  }

  async function save() {
    if (!session) return
    error = null
    busy = 'Guardando en el ratón…'
    try {
      if (!session.backupDownloaded) {
        triggerBackupDownload(session.memory)
        session.backupDownloaded = true
      }
      await session.connected.mouse.saveActiveProfile(session.draft)
      await loadFromMouse(session.connected, true)
      liveNote = null
    } catch (e) {
      error =
        e instanceof LowBatteryError
          ? 'Batería por debajo del 10 % sin cargar: conecta el cable antes de guardar.'
          : e instanceof Error
            ? `${e.message}. Puedes restaurar desde tu copia de seguridad.`
            : String(e)
    } finally {
      busy = null
    }
  }

  async function onRestoreFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file || !session) return
    error = null
    busy = 'Restaurando copia de seguridad…'
    try {
      const backup = parseBackup(await file.text())
      await session.connected.mouse.restoreOnboardMemory(backup)
      await loadFromMouse(session.connected, session.backupDownloaded)
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      busy = null
    }
  }

  if (webHidSupported()) {
    navigator.hid.addEventListener('disconnect', (event) => {
      if (event.device === session?.connected.hid) {
        session = null
        error = null
        liveNote = null
      }
    })
  }

  $effect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  })
</script>

<main class:wide={session !== null}>
  <header>
    <div>
      <h1>Logi-web</h1>
      <p class="subtitle">G PRO X SUPERLIGHT 2</p>
    </div>
    {#if session}
      <div class="meta">
        <span>{session.connected.connection === 'receiver' ? 'Receptor Lightspeed' : 'Cable USB'}</span>
        <span class:warn={lowBattery}>
          {session.battery.percent} %{session.battery.charging ? ' · cargando' : ''}
        </span>
      </div>
    {/if}
  </header>

  {#if !webHidSupported()}
    <p class="banner">Este navegador no soporta WebHID. Abre Logi-web en Chrome, Edge o Brave.</p>
  {:else if !session}
    <section class="hero">
      <svg class="mouse" viewBox="0 0 120 200" aria-hidden="true">
        <rect x="18" y="10" width="84" height="180" rx="42" />
        <line x1="60" y1="10" x2="60" y2="82" />
        <rect class="wheel" x="54" y="34" width="12" height="28" rx="6" />
      </svg>
      <button class="primary" onclick={connect} disabled={busy !== null}>
        {busy ?? 'Conectar ratón'}
      </button>
      {#if error}<p class="error">{error}</p>{/if}
    </section>
  {:else}
    {#if session.mode === 'host'}
      <div class="banner">
        <span>El ratón está en modo host (controlado por otro software) y no usa sus perfiles onboard.</span>
        <button onclick={switchToOnboard} disabled={busy !== null}>Usar perfiles onboard</button>
      </div>
    {/if}

    <div class="workspace">
      <section>
        <h2>Etapas DPI</h2>
        <ol class="stages">
          {#each session.draft.dpiStages as dpi, i (i)}
            <li class:selected={i === session.activeStage}>
              <div class="stage-row">
                <button
                  type="button"
                  class="dot"
                  class:default={i === session.draft.defaultStage}
                  title="Marcar como etapa por defecto"
                  onclick={() => setDefaultStage(i)}
                >
                  {i === session.draft.defaultStage ? 'Por defecto' : `Etapa ${i + 1}`}
                </button>
                <input
                  type="number"
                  min="100"
                  max="32000"
                  step="50"
                  value={dpi}
                  onfocus={() => previewStage(i)}
                  onchange={(e) => setStageDpi(i, e.currentTarget.valueAsNumber)}
                />
              </div>
              <input
                type="range"
                min="100"
                max="32000"
                step="50"
                value={dpi}
                oninput={(e) => setStageDpi(i, e.currentTarget.valueAsNumber)}
              />
            </li>
          {/each}
        </ol>
      </section>

      <aside class="center">
        <svg class="mouse" viewBox="0 0 120 200" aria-hidden="true">
          <rect x="18" y="10" width="84" height="180" rx="42" />
          <line x1="60" y1="10" x2="60" y2="82" />
          <rect class="wheel" x="54" y="34" width="12" height="28" rx="6" />
        </svg>
        <div class="readout">
          <strong>{session.draft.dpiStages[session.activeStage]}</strong>
          <span>DPI · {currentDraftHz >= 1000 ? `${currentDraftHz / 1000} kHz` : `${currentDraftHz} Hz`}</span>
        </div>

        <div class="polling">
          <h2>Polling rate</h2>
          <div class="rates">
            {#each connectionRates as hz (hz)}
              <button
                type="button"
                class="pill"
                class:active={hz === currentDraftHz}
                onclick={() => setPollingRate(hz)}
              >
                {hz >= 1000 ? `${hz / 1000}K` : hz}
              </button>
            {/each}
          </div>
        </div>
      </aside>
    </div>

    {#if liveNote}<p class="subtle">{liveNote}</p>{/if}
    {#if lowBattery}
      <p class="subtle warn">Batería baja ({session.battery.percent} %): conecta el cable para poder guardar.</p>
    {/if}
    {#if error}<p class="error">{error}</p>{/if}

    <footer>
      <div class="save-bar">
        <button
          class="primary"
          onclick={save}
          disabled={!dirty || lowBattery || busy !== null}
        >
          {busy ?? (session.backupDownloaded ? 'Guardar' : 'Guardar (descarga copia antes)')}
        </button>
        {#if dirty}
          <button onclick={discard} disabled={busy !== null}>Descartar</button>
        {/if}
      </div>

      <details class="safety">
        <summary>Copia de seguridad</summary>
        <div>
          <button onclick={downloadBackup} disabled={busy !== null}>Descargar copia</button>
          <button onclick={() => restoreInput?.click()} disabled={busy !== null}>Restaurar desde archivo…</button>
          <input
            bind:this={restoreInput}
            type="file"
            accept="application/json,.json"
            hidden
            onchange={onRestoreFile}
          />
        </div>
      </details>
    </footer>
  {/if}
</main>

<style>
  main {
    width: min(28rem, 100%);
    display: grid;
    gap: 2rem;
  }
  main.wide {
    width: min(52rem, 100%);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    flex-wrap: wrap;
  }
  h1 {
    margin: 0;
    font-size: 1.75rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #8a8a92;
  }
  .subtitle,
  .meta,
  .subtle {
    margin: 0.2rem 0 0;
    font-size: 0.9rem;
    color: #8a8a92;
  }
  .meta {
    display: flex;
    gap: 1.25rem;
    font-variant-numeric: tabular-nums;
  }
  .warn {
    color: #f2b866;
  }
  .hero {
    display: grid;
    justify-items: center;
    gap: 1.75rem;
    padding: 2.5rem 0;
  }
  .mouse {
    width: 7.5rem;
    fill: #131316;
    stroke: #2e2e34;
    stroke-width: 1.5;
  }
  .mouse .wheel {
    fill: #2e2e34;
    stroke: none;
  }
  .workspace {
    display: grid;
    grid-template-columns: 1.3fr 1fr;
    gap: 2.5rem;
    align-items: center;
  }
  @media (max-width: 44rem) {
    .workspace {
      grid-template-columns: 1fr;
    }
  }
  .center {
    display: grid;
    justify-items: center;
    gap: 1.5rem;
    text-align: center;
  }
  .readout {
    display: grid;
    gap: 0.15rem;
    font-variant-numeric: tabular-nums;
  }
  .readout strong {
    font-size: 2.75rem;
    font-weight: 600;
    letter-spacing: -0.03em;
    line-height: 1;
  }
  .readout span {
    color: #8a8a92;
    font-size: 0.9rem;
  }
  .polling {
    width: 100%;
  }
  .stages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.65rem;
  }
  .stages li {
    padding: 0.75rem 0.9rem;
    border-radius: 0.85rem;
    background: #131316;
    border: 1px solid #1f1f24;
    display: grid;
    gap: 0.5rem;
  }
  .stages li.selected {
    border-color: #3a3a44;
  }
  .stage-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }
  button {
    font: inherit;
    font-size: 0.9rem;
    padding: 0.65rem 1.1rem;
    border-radius: 0.7rem;
    border: 1px solid #26262c;
    background: #151519;
    color: inherit;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: #3e3e48;
  }
  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .primary {
    background: #ededef;
    color: #0b0b0d;
    border-color: #ededef;
    font-weight: 600;
  }
  .dot {
    padding: 0.25rem 0.65rem;
    border-radius: 999px;
    font-size: 0.78rem;
    color: #8a8a92;
    background: transparent;
  }
  .dot.default {
    background: #ededef;
    color: #0b0b0d;
    border-color: #ededef;
    font-weight: 600;
  }
  input[type='number'] {
    width: 6.5rem;
    font: inherit;
    font-size: 1.25rem;
    font-variant-numeric: tabular-nums;
    text-align: right;
    background: transparent;
    color: inherit;
    border: 1px solid transparent;
    border-radius: 0.45rem;
    padding: 0.15rem 0.35rem;
  }
  input[type='number']:focus {
    outline: none;
    border-color: #3e3e48;
    background: #0b0b0d;
  }
  input[type='range'] {
    width: 100%;
    accent-color: #ededef;
  }
  .rates {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.4rem;
  }
  .pill {
    padding: 0.45rem 0.85rem;
    border-radius: 999px;
    color: #8a8a92;
    font-variant-numeric: tabular-nums;
  }
  .pill.active {
    background: #ededef;
    color: #0b0b0d;
    border-color: #ededef;
    font-weight: 600;
  }
  footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .save-bar {
    display: flex;
    gap: 0.6rem;
  }
  .safety summary {
    cursor: pointer;
    color: #8a8a92;
    font-size: 0.85rem;
    list-style: none;
  }
  .safety div {
    margin-top: 0.6rem;
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .banner,
  .error {
    margin: 0;
    padding: 0.9rem 1.1rem;
    border-radius: 0.85rem;
    background: #131316;
    border: 1px solid #26262c;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .error {
    color: #ff8f8f;
    border-color: #4a2323;
  }
</style>
