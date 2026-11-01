# Web estática solo WebHID, sin backend

La app es un sitio estático (GitHub Pages) que habla con el Ratón únicamente vía WebHID desde el navegador; no hay backend, cuentas ni componente nativo. Esto la limita a navegadores Chromium (Chrome, Edge, Brave): Firefox y Safari no implementan WebHID y no se soportan. Se eligió para que no haya nada que instalar ni mantener del lado del servidor; en Linux requiere una regla udev que dé acceso a `/dev/hidraw*`.

## Considered Options

- **App nativa / Electron**: soporta cualquier SO sin depender del navegador, pero exige instalación y distribución, contrario al objetivo de "abrir y usar".
- **Backend local (daemon + UI web)**: evita la limitación de navegador, pero añade un proceso que instalar y mantener.
