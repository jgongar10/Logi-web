# Aplicar en vivo y Guardar en el Perfil onboard

Los ajustes se Aplican en vivo (efecto inmediato, temporal) y sólo "Guardar" los escribe en el Perfil activo de la memoria onboard del Ratón, que es la única fuente de verdad. Antes de la primera escritura se descarga una Copia de seguridad completa de la memoria onboard, cada escritura se verifica leyendo de vuelta, y "Guardar" se bloquea con batería < 10 % sin cargar. Se descartó el modo host (la app controla el Ratón en tiempo real) porque los ajustes se perderían al cerrar la app, y se descartó escribir en cada cambio para no desgastar la memoria ni arriesgar escrituras a medias.

## Consequences

- La app nunca cambia el Ratón de modo host a onboard sin pedirlo explícitamente.
- Sólo se escriben funciones HID++ conocidas; nunca firmware ni funciones sin identificar.
- Guardar es lectura-modificación-escritura del sector completo: los bytes que la app no edita (botones, lift-off por Etapa DPI, campos desconocidos) se preservan tal cual. En particular, nunca se modifica el byte de lift-off de una Etapa DPI en el formato de perfil 7: OpenMouse documenta que escribirlo devuelve el error HID++ 0x05.
