// This file defines the types describing the Hillstate API payloads, plus the
// helpers used to read values out of them safely.

export interface deviceDiscoverResp {
  'resultStatus': string
  'transactionId': string
  'data': {
    'totalCount': number
    // NOTE: the live API returns an empty statusList for every device here.
    // Device state must be fetched per-device; see HillstateAPI.getDeviceState.
    'deviceList': Array<{
      'id': string
      'deviceType': string
      'deviceName': string
      'deviceLocation': string
      'state': string
      'deviceDetailName': string | undefined
      'statusList': Array<deviceStatusCommand>
    }>
  }
}

export type AirConWind =
    | 'light'
    | 'mid'
    | 'pow'

export type AirConMode =
    | 'auto'
    | 'cool'
    | 'dehumidify'
    | 'airwash'

export interface deviceStatusCommand {
  'command': string
  'value': string
}

export interface deviceStatusResp {
  'resultStatus': string
  'transactionId': string
  'data': {
    'deviceType': string,
    'statusList': Array<deviceStatusCommand>
    'deviceDetailName': string | undefined
    'id': string
    'state': string
  }
}

/* statusValue looks a command up by name instead of by position.

   The live API happens to return a stable order (aircon: power, mode, wind,
   setTemperature, currTemperature; heater: power, mode, setTemperature,
   currTemperature) but relying on that would silently feed e.g. `wind` into a
   temperature characteristic if the ordering ever changed.

   Throws when the command is absent, so a malformed response surfaces as a
   HomeKit communication failure rather than `undefined` flowing onwards.
*/
export function statusValue(statusList: Array<deviceStatusCommand>, command: string): string {
  const entry = statusList.find((status) => status.command === command);
  if (entry === undefined) {
    throw new Error(`missing '${command}' in status list [${statusList.map((s) => s.command).join(', ')}]`);
  }
  return entry.value;
}

/* statusIsOn reports whether a device's `power` command is on. */
export function statusIsOn(statusList: Array<deviceStatusCommand>): boolean {
  return statusValue(statusList, 'power') === 'on';
}

/* statusNumber reads a command and parses it as a number.
   All Hillstate values arrive as strings ("25", "18"), but HomeKit's
   temperature characteristics require actual numbers.
*/
export function statusNumber(statusList: Array<deviceStatusCommand>, command: string): number {
  const raw = statusValue(statusList, command);
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`'${command}' is not numeric: '${raw}'`);
  }
  return parsed;
}
