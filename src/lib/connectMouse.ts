import { HidppDevice } from '../hidpp/HidppDevice'

const LOGITECH_VENDOR_ID = 0x046d
const HIDPP_USAGE_PAGE = 0xff00
const HIDPP_LONG_USAGE = 0x0002
const PRO_X_2_CABLE_PRODUCT_ID = 0xc09b
const DEVICE_INDEX_CABLE = 0xff
const DEVICE_INDEX_RECEIVER = 0x01

export interface ConnectedMouse {
  hid: HIDDevice
  mouse: HidppDevice
  connection: 'receiver' | 'cable'
}

export const webHidSupported = () => typeof navigator !== 'undefined' && 'hid' in navigator

/** Asks the user to pick the Receptor or the Ratón's cable and opens it. */
export async function connectMouse(): Promise<ConnectedMouse | null> {
  const [hid] = await navigator.hid.requestDevice({
    filters: [{ vendorId: LOGITECH_VENDOR_ID, usagePage: HIDPP_USAGE_PAGE, usage: HIDPP_LONG_USAGE }],
  })
  if (!hid) return null
  if (!hid.opened) await hid.open()
  const connection = hid.productId === PRO_X_2_CABLE_PRODUCT_ID ? 'cable' : 'receiver'
  const deviceIndex = connection === 'cable' ? DEVICE_INDEX_CABLE : DEVICE_INDEX_RECEIVER
  return { hid, mouse: new HidppDevice(hid, deviceIndex), connection }
}
