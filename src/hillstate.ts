import { AES } from 'crypto-ts';
import { Logging } from 'homebridge';
import { got, HTTPError } from 'got';

import { CONSTS } from './consts.js';
import {
  deviceDiscoverResp,
  deviceStatusCommand,
  deviceStatusResp,
  statusIsOn,
} from './types.js';

/* isSessionExpired reports whether an error means the server rejected our session
   cookie, as opposed to a network fault or a server-side failure. Only the former
   is worth re-authenticating for; treating every error as an expired session is
   what previously turned a brief outage into a login storm.
*/
function isSessionExpired(error: unknown): boolean {
  return error instanceof HTTPError
    && (error.response.statusCode === 401 || error.response.statusCode === 403);
}

export class HillstateAPI {
  private basicHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-GB,en;q=0.9,ko-KR;q=0.8,ko;q=0.7,en-IN;q=0.6,en-US;q=0.5',
    'Content-type': 'application/json',
    'Priority': 'u=1, i',
    'Referer': 'https://www2.hthomeservice.com/login',
    'sec-ch-ua-platform': 'Linux',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  };

  private encryptedUsername: string;
  private encryptedPassword: string;

  /* Session state.

     authPromise is shared by every concurrent caller, so a burst of requests
     triggers exactly one login. authGeneration identifies which session a caller
     used, so that N simultaneous 401s cause one refresh rather than N.
  */
  private authPromise: Promise<string> | null = null;
  private authGeneration: number = 0;
  private sessionExpiresAt: number = 0;

  /* Device state cache.

     stateCache holds recently fetched status lists; inFlight collapses concurrent
     reads of the same device onto a single request.
  */
  private stateCache = new Map<string, { statusList: Array<deviceStatusCommand>; fetchedAt: number }>();
  private inFlight = new Map<string, Promise<Array<deviceStatusCommand>>>();

  /* Every device the accessories care about, as deviceID -> base URL, plus the
     timer that keeps their cached state warm. */
  private tracked = new Map<string, string>();
  private pollTimer: NodeJS.Timeout | null = null;

  /* Outbound request limiter. */
  private activeRequests: number = 0;
  private waitingForSlot: Array<() => void> = [];

  constructor(
    private readonly log: Logging,
    username: string,
    password: string,
    private readonly dong: number,
    private readonly ho: number,
  ) {
    this.encryptedUsername = AES.encrypt(username, CONSTS.AUTH_PUBLIC_KEY).toString();
    this.encryptedPassword = AES.encrypt(password, CONSTS.AUTH_PUBLIC_KEY).toString();

    // No eager authenticate() here on purpose. It used to run un-awaited, so a
    // login failure at boot — likely on a Pi, where Homebridge can start before
    // Wi-Fi is up — became an unhandled rejection that killed the process.
    // Every request path authenticates lazily instead.
    this.log.info('[HillstateAPI] HS Class initialized');
  }

  // ----------------------------
  // ----- Discover method ------
  // ----------------------------

  public async discoverDevices(): Promise<deviceDiscoverResp> {
    this.log.debug('[HillstateAPI] Discovering devices');
    const body = await this.withSession((cookie) => this.send('GET', CONSTS.HILLSTATE_DISCOVER_DEVICES_URL, cookie));
    return JSON.parse(body) as deviceDiscoverResp;
  }

  // ----------------------------
  // ---- Light API methods -----
  // ----------------------------

  public async getLight(light: string): Promise<boolean> {
    return statusIsOn(await this.getDeviceState(CONSTS.HILLSTATE_LIGHT_URL, light));
  }

  public async setLight(light: string, state: boolean): Promise<void> {
    await this.setDeviceStatus(CONSTS.HILLSTATE_LIGHT_URL, light, {
      command: 'power',
      value: state ? 'on' : 'off',
    });
  }

  // -----------------------------
  // ---- Aircon API methods -----
  // -----------------------------

  public async getAirCon(aircon: string): Promise<Array<deviceStatusCommand>> {
    return this.getDeviceState(CONSTS.HILLSTATE_AIRCON_URL, aircon);
  }

  public async setAirCon(aircon: string, commandBody: deviceStatusCommand): Promise<void> {
    await this.setDeviceStatus(CONSTS.HILLSTATE_AIRCON_URL, aircon, commandBody);
  }

  // -----------------------------
  // ---- Heater API methods -----
  // -----------------------------

  public async getHeater(heater: string): Promise<Array<deviceStatusCommand>> {
    return this.getDeviceState(CONSTS.HILLSTATE_HEATER_URL, heater);
  }

  public async setHeater(heater: string, commandBody: deviceStatusCommand): Promise<void> {
    await this.setDeviceStatus(CONSTS.HILLSTATE_HEATER_URL, heater, commandBody);
  }

  // -----------------------------
  // -------- Polling ------------
  // -----------------------------

  /* The accessories declare which devices exist; the poller then refreshes them on
     a timer so that a HomeKit read is a cache lookup rather than an HTTP request.
  */
  public trackLight(deviceID: string): void {
    this.tracked.set(deviceID, CONSTS.HILLSTATE_LIGHT_URL);
  }

  public trackAirCon(deviceID: string): void {
    this.tracked.set(deviceID, CONSTS.HILLSTATE_AIRCON_URL);
  }

  public trackHeater(deviceID: string): void {
    this.tracked.set(deviceID, CONSTS.HILLSTATE_HEATER_URL);
  }

  /* startPolling begins refreshing tracked devices. Called once, after discovery. */
  public startPolling(): void {
    if (this.pollTimer !== null) {
      return;
    }

    this.log.info(`[HillstateAPI] Polling ${this.tracked.size} devices every `
      + `${CONSTS.POLL_INTERVAL_MS / 1000}s`);

    // The rejection handler is not optional: an unhandled rejection exits Node,
    // which crash-loops Homebridge.
    const tick = () => {
      this.refreshTracked().catch((error) => {
        this.log.error(`[HillstateAPI] Background refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    };

    this.pollTimer = setInterval(tick, CONSTS.POLL_INTERVAL_MS);
    tick();
  }

  /* refreshTracked walks every device one at a time.

     Sequential on purpose. The Pi Zero W2 is single-core and nothing is waiting on
     the result, so there is no reason to spend the concurrency budget here and
     make the foreground writes queue behind it.
  */
  private async refreshTracked(): Promise<void> {
    for (const [deviceID, baseURL] of this.tracked) {
      try {
        const statusList = await this.fetchDeviceState(baseURL, deviceID);
        this.stateCache.set(deviceID, { statusList, fetchedAt: Date.now() });
      } catch (error) {
        // Left alone deliberately: the previous value stays cached and servable.
        this.log.debug(`[HillstateAPI] Refresh of ${deviceID} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // -----------------------------
  // ------ Device state ---------
  // -----------------------------

  /* getDeviceState returns a device's status list, reusing a recent result when
     one is available and otherwise sharing a single request between all callers
     asking for the same device.

     This matters because HomeKit reads every characteristic of every accessory
     at once: a thermostat alone issues four reads that resolve to two devices.
     The discover endpoint would be the natural place to fetch everything in one
     call, but the live API returns an empty statusList there, so state has to be
     collected per-device.
  */
  private async getDeviceState(baseURL: string, deviceID: string): Promise<Array<deviceStatusCommand>> {
    const cached = this.stateCache.get(deviceID);
    if (cached !== undefined && (Date.now() - cached.fetchedAt) < CONSTS.DEVICE_STATE_TTL_MS) {
      this.log.debug(`[HillstateAPI] Serving ${deviceID} from cache`);
      return cached.statusList;
    }

    const pending = this.inFlight.get(deviceID);
    if (pending !== undefined) {
      this.log.debug(`[HillstateAPI] Joining in-flight request for ${deviceID}`);
      return pending;
    }

    const request = this.fetchDeviceState(baseURL, deviceID);
    this.inFlight.set(deviceID, request);

    try {
      const statusList = await request;
      this.stateCache.set(deviceID, { statusList, fetchedAt: Date.now() });
      return statusList;
    } catch (error) {
      // A slow or flaky upstream should not blank the tile. Any previous value is
      // a far better answer than "No Response", which is what throwing here
      // produced ~180 times over 17-19 Aug 2026.
      const stale = this.stateCache.get(deviceID);
      if (stale === undefined) {
        throw error;
      }

      const ageSeconds = Math.round((Date.now() - stale.fetchedAt) / 1000);
      this.log.warn(`[HillstateAPI] Read of ${deviceID} failed, serving state from ${ageSeconds}s ago`);
      return stale.statusList;
    } finally {
      this.inFlight.delete(deviceID);
    }
  }

  private async fetchDeviceState(baseURL: string, deviceID: string): Promise<Array<deviceStatusCommand>> {
    const requestURL = baseURL + deviceID;
    this.log.debug(`[HillstateAPI] Getting status for device ${requestURL}`);

    const body = await this.withSession((cookie) => this.send('GET', requestURL, cookie));
    return (JSON.parse(body) as deviceStatusResp).data.statusList;
  }

  private async setDeviceStatus(baseURL: string, deviceID: string, commandBody: deviceStatusCommand): Promise<void> {
    const requestURL = baseURL + deviceID;
    this.log.debug(`[HillstateAPI] Setting status for device ${requestURL} with body ${JSON.stringify(commandBody)}`);

    await this.withSession((cookie) => this.send('PUT', requestURL, cookie, {
      'commandList': [
        {
          'command': commandBody.command,
          'value': commandBody.value,
        },
      ],
    }));

    // Mark the cached state stale rather than dropping it. The next read must go to
    // the network so it reflects the write we just made, but if that read fails the
    // superseded value is still a better answer than "No Response" -- and deleting
    // the entry outright would leave getDeviceState with no fallback at all.
    const cached = this.stateCache.get(deviceID);
    if (cached !== undefined) {
      cached.fetchedAt = 0;
    }

    // Start refetching immediately. A HomeKit read arriving before this finishes
    // joins the in-flight request rather than queuing a second one.
    this.getDeviceState(baseURL, deviceID).catch(() => {
      // Nothing is waiting on this; a genuine failure is reported by the next read.
    });
  }

  // -----------------------------
  // --------- Session -----------
  // -----------------------------

  /* withSession runs an authenticated request, retrying once if the server
     rejects the session. Everything else propagates to the caller, which turns it
     into a HomeKit communication failure.
  */
  private async withSession<T>(request: (cookie: string) => Promise<T>): Promise<T> {
    const session = await this.getSession();

    try {
      return await request(session.cookie);
    } catch (error) {
      if (!isSessionExpired(error)) {
        throw error;
      }

      this.log.info('[HillstateAPI] Session rejected, re-authenticating');
      this.invalidateSession(session.generation);

      const refreshed = await this.getSession();
      return await request(refreshed.cookie);
    }
  }

  /* getSession returns a usable session cookie along with the generation it
     belongs to, so the caller can invalidate exactly that session later.
  */
  private async getSession(): Promise<{ cookie: string; generation: number }> {
    let promise = this.authPromise;
    if (promise === null || Date.now() >= this.sessionExpiresAt) {
      promise = this.beginAuthentication();
    }

    // Captured before awaiting so it names the session we are about to use.
    const generation = this.authGeneration;
    return { cookie: await promise, generation };
  }

  /* beginAuthentication starts a login and publishes it, so callers arriving
     while it is in flight share it instead of starting their own.
  */
  private beginAuthentication(): Promise<string> {
    this.authGeneration += 1;
    // Marked valid up front: otherwise callers arriving mid-login would each see
    // an expired session and kick off another one.
    this.sessionExpiresAt = Date.now() + CONSTS.AUTH_TOKEN_EXPIRY_MS;

    const promise = this.authenticate();
    this.authPromise = promise;

    // A rejected login must not stay cached, or every later request reuses it.
    promise.catch(() => {
      if (this.authPromise === promise) {
        this.authPromise = null;
        this.sessionExpiresAt = 0;
      }
    });

    return promise;
  }

  /* invalidateSession forces the next request to log in again, unless another
     caller has already replaced the session that `generation` refers to.
  */
  private invalidateSession(generation: number): void {
    if (generation === this.authGeneration) {
      this.authPromise = null;
      this.sessionExpiresAt = 0;
    }
  }

  /* authenticate logs in and registers the CTOC token, returning the session
     cookie. Reached only through getSession().
  */
  private async authenticate(): Promise<string> {
    this.log.info('[HillstateAPI] Authenticating with Hillstate server...');

    const authResp = await got.post(CONSTS.HILLSTATE_LOGIN_URL, {
      json: {
        'id': this.encryptedUsername,
        'password': this.encryptedPassword,
        'rememberMe': false,
      },
      headers: this.basicHeaders,
      timeout: { request: CONSTS.REQUEST_TIMEOUT_MS },
    });

    const sidCookie = (authResp.headers['set-cookie'] ?? '').toString().split(';')[0];
    if (sidCookie === '') {
      throw new Error('login returned no session cookie');
    }

    this.log.debug('[HillstateAPI] Setting CTOC token...');

    await got.post(CONSTS.HILLSTATE_CTOC_URL, {
      headers: {
        'Cookie': sidCookie,
        ...this.basicHeaders,
      },
      json: {
        'siteId': '338',
        'dong': this.dong,
        'ho': this.ho,
        'clientId': 'HT-WEB',
        'uuid': '',
      },
      timeout: { request: CONSTS.REQUEST_TIMEOUT_MS },
    });

    // The cookie itself is deliberately not logged: it is a live session token
    // and the Homebridge log is world-readable.
    this.log.info('[HillstateAPI] Authentication successful');
    return sidCookie;
  }

  // -----------------------------
  // ------- HTTP plumbing -------
  // -----------------------------

  /* send performs one outbound call, bounded by the concurrency limiter.
     got throws on any non-2xx response, so there is no status code to check here.
  */
  private async send(method: 'GET' | 'PUT', url: string, cookie: string, json?: unknown): Promise<string> {
    await this.acquireSlot();

    try {
      const response = await got(url, {
        method,
        headers: {
          'Cookie': cookie,
          ...this.basicHeaders,
        },
        timeout: { request: CONSTS.REQUEST_TIMEOUT_MS },
        ...(json === undefined ? {} : { json }),
      });
      return response.body;
    } finally {
      this.releaseSlot();
    }
  }

  /* acquireSlot waits until the request budget allows another call. A Pi Zero W2
     is single-core, and letting all ~17 device reads open TLS connections at once
     is what made HomeKit's read timeout expire.
  */
  private async acquireSlot(): Promise<void> {
    if (this.activeRequests < CONSTS.MAX_CONCURRENT_REQUESTS) {
      this.activeRequests += 1;
      return;
    }

    await new Promise<void>((resolve) => this.waitingForSlot.push(resolve));
  }

  /* releaseSlot hands the freed slot directly to the next waiter, rather than
     decrementing and letting a newcomer take the fast path ahead of the queue.
  */
  private releaseSlot(): void {
    const next = this.waitingForSlot.shift();
    if (next !== undefined) {
      next();
      return;
    }

    this.activeRequests -= 1;
  }
}
