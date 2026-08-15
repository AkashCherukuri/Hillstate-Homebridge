/*
This file contains all the constants that are used in the application,
and all the structs required for proper and clean requests to Hillstate API
*/

export abstract class CONSTS {
  static readonly LIGHT_DEVICE_TYPE: string = 'light';
  static readonly AIRCON_DEVICE_TYPE: string = 'aircon';
  static readonly VENT_DEVICE_TYPE: string = 'fan';

  static readonly AUTH_PUBLIC_KEY: string     = 'hTsEcret';
  static readonly HILLSTATE_LOGIN_URL: string = 'https://www2.hthomeservice.com/login';
  static readonly HILLSTATE_CTOC_URL: string  = 'https://www2.hthomeservice.com/getctoctoken';

  static readonly HILLSTATE_DISCOVER_DEVICES_URL: string = 'https://www2.hthomeservice.com/proxy/ctoc/devices';
  static readonly HILLSTATE_LIGHT_URL: string = 'https://www2.hthomeservice.com/proxy/ctoc/lights/';
  static readonly HILLSTATE_AIRCON_URL: string = 'https://www2.hthomeservice.com/proxy/ctoc/aircons/';
  static readonly HILLSTATE_HEATER_URL: string = 'https://www2.hthomeservice.com/proxy/ctoc/heaters/';

  static readonly AUTH_TOKEN_EXPIRY_MS: number = 15 * 60 * 1000; // 15 minutes

  /* How long a fetched device state stays usable.

     HomeKit reads every characteristic of every accessory when the Home app is
     opened, so ~17 devices are queried within a few milliseconds of each other.
     This window lets one burst be served by one round of requests.
  */
  static readonly DEVICE_STATE_TTL_MS: number = 5 * 1000;

  /* Ceiling on simultaneous outbound requests.
     A Raspberry Pi Zero W2 is single-core; letting all ~17 device reads open TLS
     connections at once is what made HomeKit's 5s read timeout expire.
  */
  static readonly MAX_CONCURRENT_REQUESTS: number = 4;

  /* Per-request timeout. Must stay comfortably under HomeKit's own ~5s read
     timeout so a hung socket fails fast instead of stalling an accessory.
  */
  static readonly REQUEST_TIMEOUT_MS: number = 3500;
}
