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

  /* How often the background poller refreshes every tracked device.

     The poller is what keeps HomeKit off the network: reads are answered from
     cache, so an upstream that takes seconds to answer no longer shows up as a
     "No Response" tile.
  */
  static readonly POLL_INTERVAL_MS: number = 30 * 1000;

  /* How long a fetched device state is considered fresh enough to serve without
     re-fetching. Deliberately longer than POLL_INTERVAL_MS, so a read lands on a
     value the poller has already refreshed rather than starting its own request.

     Note this is a freshness window, not an eviction policy: a value older than
     this is still kept and served if a refresh fails. See getDeviceState.
  */
  static readonly DEVICE_STATE_TTL_MS: number = 45 * 1000;

  /* Ceiling on simultaneous outbound requests.
     A Raspberry Pi Zero W2 is single-core; letting all ~17 device reads open TLS
     connections at once is what made HomeKit's 5s read timeout expire.
  */
  static readonly MAX_CONCURRENT_REQUESTS: number = 4;

  /* Per-request timeout.

     This was 3500ms to stay under HomeKit's ~5s read timeout, back when a read
     went straight to the network. That ceiling manufactured failures: the logs for
     17-19 Aug 2026 are ~180 'Timeout awaiting request for 3500ms' errors against an
     API that is merely slow. Reads are served from cache now, so nothing
     user-facing waits on this and it can be generous.
  */
  static readonly REQUEST_TIMEOUT_MS: number = 10 * 1000;
}
