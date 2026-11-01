# Logi-web

Configurador web minimalista para el ratón **Logitech G PRO X SUPERLIGHT 2**. Funciona 100 % en el navegador mediante WebHID y el protocolo HID++ 2.0, sin instalar nada ni pasar por un servidor.

**App:** https://jgongar10.github.io/Logi-web/

## Qué permite

- Ver el estado de la **Conexión** (`Receptor` Lightspeed o cable USB) y la batería.
- Editar las 5 **Etapas DPI** del **Perfil activo** (100–32000 en pasos de 50) y elegir la **Etapa por defecto**.
- Cambiar el **Polling rate** entre las opciones que reporta el ratón (hasta 8000 Hz por Receptor; hasta 1000 Hz por cable).
- **Aplicar en vivo** al mover los controles sin desgastar la memoria flash, y **Guardar** explícitamente en el **Perfil onboard** para que los ajustes persistan sin software.
- Descargar y restaurar una **Copia de seguridad** completa de la memoria onboard.
- Detectar si otro software dejó el ratón en modo host y volver a los perfiles onboard bajo petición.

## Seguridad con el hardware

- Antes de la primera escritura de cada sesión se descarga automáticamente una **Copia de seguridad** completa (16 sectores) en JSON.
- **Guardar** hace lectura-modificación-escritura del sector: los bytes que la app no edita (asignación de botones, lift-off por etapa, campos no documentados) se conservan intactos y el CRC-CCITT se recalcula.
- Cada escritura se verifica leyendo el sector de vuelta; si no coincide, restaura el sector anterior.
- **Guardar** se bloquea si la batería está por debajo del 10 % y el ratón no está cargando.
- Sólo se escribe el formato de perfil 7 verificado; nunca se tocan el firmware ni funciones HID++ sin identificar.

## Requisitos

- Un navegador con soporte de **WebHID**: Chrome, Brave o Edge (Firefox y Safari no implementan WebHID).
- **En Linux**, permiso de usuario sobre `/dev/hidraw*` para dispositivos Logitech (`046d`). Crea `/etc/udev/rules.d/70-logitech-hidraw.rules`:

  ```udev
  KERNEL=="hidraw*", SUBSYSTEM=="hidraw", ATTRS{idVendor}=="046d", MODE="0660", TAG+="uaccess"
  ```

  y recarga las reglas:

  ```bash
  sudo udevadm control --reload-rules && sudo udevadm trigger
  ```

## Desarrollo

```bash
npm install
npm run dev      # servidor local en http://localhost:5173/Logi-web/
npm test         # suite de tests sobre respuestas reales capturadas del ratón
npm run check    # comprobación de tipos (Svelte + TypeScript)
npm run build    # compilación estática en dist/
```

Documentación del dominio y decisiones de arquitectura: [`GLOSSARY.md`](./GLOSSARY.md) y [`docs/adr/`](./docs/adr/).
