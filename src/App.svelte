<script lang="ts">
  import { serializeBackup } from './hidpp/backup'
  import type { Battery, OnboardMemory, PollingRate } from './hidpp/HidppDevice'
  import { decodeOnboardProfile, type OnboardProfile } from './hidpp/onboardProfile'
  import { connectMouse, webHidSupported, type ConnectedMouse } from './lib/connectMouse'

  interface MouseState {
    connected: ConnectedMouse
    battery: Battery
    pollingRate: PollingRate
    profile: OnboardProfile
    memory: OnboardMemory
  }

  let mouseState = $state<MouseState | null>(null)
  let busy = $state(false)
  let error = $state<string | null>(null)

  async function connect() {
    error = null
    busy = true
    try {
      const connected = await connectMouse()
      if (!connected) return
      const { mouse } = connected
      const battery = await mouse.getBattery()
      const pollingRate = await mouse.getPollingRate()
      const memory = await mouse.readOnboardMemory()
      const activeSector = await mouse.getActiveProfileSector()
      const profile = decodeOnboardProfile(memory.sectors.get(activeSector)!)
      mouseState = { connected, battery, pollingRate, profile, memory }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      busy = false
    }
  }

  function downloadBackup() {
    if (!mouseState) return
    const takenAt = new Date()
    const file = serializeBackup(mouseState.memory, { deviceName: 'PRO X 2', takenAt })
    const url = URL.createObjectURL(new Blob([file], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `logi-web-copia-${takenAt.toISOString().slice(0, 19).replace(/:/g, '-')}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  if (webHidSupported()) {
    navigator.hid.addEventListener('disconnect', (event) => {
      if (event.device === mouseState?.connected.hid) mouseState = null
    })
  }
</script>

<main>
  <header>
    <h1>Logi-web</h1>
    <p class="subtitle">PRO X SUPERLIGHT 2</p>
  </header>

  {#if !webHidSupported()}
    <p class="notice">Este navegador no soporta WebHID. Abre Logi-web en Chrome, Edge o Brave.</p>
  {:else if !mouseState}
    <button class="primary" onclick={connect} disabled={busy}>
      {busy ? 'Leyendo el ratón…' : 'Conectar ratón'}
    </button>
    {#if error}<p class="error">{error}</p>{/if}
  {:else}
    <section class="status">
      <span>{mouseState.connected.connection === 'receiver' ? 'Receptor' : 'Cable'}</span>
      <span>Batería {mouseState.battery.percent} %{mouseState.battery.charging ? ' · cargando' : ''}</span>
    </section>

    <section>
      <h2>DPI</h2>
      <ol class="stages">
        {#each mouseState.profile.dpiStages as dpi, i (i)}
          <li class:default={i === mouseState.profile.defaultStage}>
            <span class="value">{dpi}</span>
            {#if i === mouseState.profile.defaultStage}<span class="tag">por defecto</span>{/if}
          </li>
        {/each}
      </ol>
    </section>

    <section>
      <h2>Polling rate</h2>
      <div class="rates">
        {#each mouseState.pollingRate.availableHz as hz (hz)}
          <span class="rate" class:active={hz === mouseState.pollingRate.currentHz}>
            {hz >= 1000 ? `${hz / 1000}K` : hz}
          </span>
        {/each}
      </div>
    </section>

    <footer>
      <button onclick={downloadBackup}>Descargar copia de seguridad</button>
    </footer>
  {/if}
</main>

<style>
  main {
    width: min(32rem, 100vw - 2rem);
    display: grid;
    gap: 2rem;
  }
  h1 {
    margin: 0;
    font-size: 2.5rem;
    font-weight: 600;
    letter-spacing: -0.02em;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.8rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: #8a8a90;
  }
  .subtitle {
    margin: 0.25rem 0 0;
    color: #8a8a90;
  }
  button {
    font: inherit;
    padding: 0.75rem 1.25rem;
    border-radius: 0.75rem;
    border: 1px solid #2a2a2e;
    background: #18181b;
    color: inherit;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.6;
    cursor: progress;
  }
  .primary {
    background: #e8e8ea;
    color: #0e0e10;
    font-weight: 600;
    justify-self: start;
  }
  .status {
    display: flex;
    gap: 1.5rem;
    color: #8a8a90;
  }
  .stages {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.5rem;
  }
  .stages li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-radius: 0.75rem;
    background: #18181b;
  }
  .stages li.default {
    outline: 1px solid #e8e8ea;
  }
  .value {
    font-size: 1.5rem;
    font-variant-numeric: tabular-nums;
  }
  .tag {
    font-size: 0.8rem;
    color: #8a8a90;
  }
  .rates {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .rate {
    padding: 0.5rem 0.9rem;
    border-radius: 999px;
    background: #18181b;
    color: #8a8a90;
    font-variant-numeric: tabular-nums;
  }
  .rate.active {
    background: #e8e8ea;
    color: #0e0e10;
    font-weight: 600;
  }
  .notice,
  .error {
    margin: 0;
    padding: 1rem;
    border-radius: 0.75rem;
    background: #18181b;
  }
  .error {
    color: #ff8a8a;
  }
</style>
