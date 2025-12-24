import { AES } from "crypto-ts";
import { Logging } from 'homebridge';
import { MutexRW } from 'mutex-ts';

import { CONSTS } from "./consts.js";
import {
  deviceStatusResp,
  deviceDiscoverResp,
  deviceStatusCommand,
} from './types.js';
import { got } from "got";

/*
  TODO
  - Perform reauthentication only when 40X is returned from requests, not for every error
    I think this can be done using Result types?
*/

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
  // private dong: number;
  // private ho: number;

  // authRWMutex is used to check auth status concurrently
  private authRWMutex = new MutexRW();
  private sidCookie: string = '';
  private lastAuthTime: number = -1;


  /* Constructor implicitly initializes dong and ho
     username and password are encrypted before being stored
  */
  constructor(
    private readonly log: Logging,
    private readonly username: string,
    private readonly password: string,
    private readonly dong: number,
    private readonly ho: number
  ) {
    this.encryptedUsername = AES.encrypt(username, CONSTS.AUTH_PUBLIC_KEY).toString();
    this.encryptedPassword = AES.encrypt(password, CONSTS.AUTH_PUBLIC_KEY).toString();

    this.authenticate();

    this.log.info(`[HillstateAPI] HS Class initialized`);
  }

  // ----------------------------
  // ----- Discover method ------
  // ----------------------------
  public async discoverDevices(): Promise<deviceDiscoverResp> {
    return await this.discoverDevicesInt('');
  }

  // ----------------------------
  // ---- Light API methods -----
  // ----------------------------

  public async getLight(light: string): Promise<boolean> {
    const lightStatus = await this.getDeviceStatusInt(CONSTS.HILLSTATE_LIGHT_URL, light, '');
    return lightStatus.data.statusList[0].value === 'on';
  }

  public async setLight(light: string, state: boolean) {
    const commandBody: deviceStatusCommand = {
      command: 'power',
      value: state ? 'on' : 'off',
    };
    await this.setDeviceStatusInt(CONSTS.HILLSTATE_LIGHT_URL, light, commandBody, '');
  }

  // -----------------------------
  // ---- Aircon API methods -----
  // -----------------------------

  public async getAirCon(aircon: string): Promise<deviceStatusResp> { 
    return await this.getDeviceStatusInt(CONSTS.HILLSTATE_AIRCON_URL, aircon, '');
  }

  public async setAirCon(aircon: string, commandBody: deviceStatusCommand) {
    await this.setDeviceStatusInt(CONSTS.HILLSTATE_AIRCON_URL, aircon, commandBody, '');
  }

  // -----------------------------
  // ---- Heater API methods -----
  // -----------------------------

  public async getHeater(heater: string): Promise<deviceStatusResp> { 
    return await this.getDeviceStatusInt(CONSTS.HILLSTATE_HEATER_URL, heater, '');
  }

  public async setHeater(heater: string, commandBody: deviceStatusCommand) {
    await this.setDeviceStatusInt(CONSTS.HILLSTATE_HEATER_URL, heater, commandBody, '');
  }

  /* authenticate with Hillstate server if the token is expired or is not present
  Returns the authentication cookie string on successful authentication

  authentication is performed if either:
    1. Prev authentication token is expired (based on AUTH_TOKEN_EXPIRY_MS)
    2. calleeCookie is different from the stored sidCookie, implying that another thread has refreshed the cookie 

  This uses a ReadWrite Mutex to ensure that authentication is only done when necessary.
  */
  private async authenticate(calleeCookie: string = '') : Promise<string> {
    // Get read lock and check authentication status
    {
      using _ = await this.authRWMutex.obtainRO();
      if (
        calleeCookie !== this.sidCookie &&                             // Check if stored cookie has been refreshed by another thread
        this.sidCookie !== '' && this.lastAuthTime !== -1 &&           // Check if token and time exist
        (Date.now() - this.lastAuthTime) < CONSTS.AUTH_TOKEN_EXPIRY_MS // Check if token is still valid
      ) {
        this.log.debug(`[HillstateAPI] Auth token is still valid, no need to re-authenticate`);
        return this.sidCookie;
      }
    }

    // Get write lock to perform authentication
    {
      using _ = await this.authRWMutex.obtainRW();
      
      // Double-check authentication status after acquiring write lock
      if (
        calleeCookie !== this.sidCookie &&                             // Check if stored cookie has been refreshed by another thread
        this.sidCookie !== '' && this.lastAuthTime !== -1 &&           // Check if token and time exist
        (Date.now() - this.lastAuthTime) < CONSTS.AUTH_TOKEN_EXPIRY_MS // Check if token is still valid
      ) {
        this.log.debug(`[HillstateAPI] Auth token is still valid, no need to re-authenticate`);
        return this.sidCookie;
      }

      this.log.info(`[HillstateAPI] Authenticating with Hillstate server...`);

      // Perform authentication with Hillstate server
      // No try-catch present, as any authentication errors are critical and should be propagated up
      const authResp = await got.post(CONSTS.HILLSTATE_LOGIN_URL, {
        json: {
          'id': this.encryptedUsername,
          'password': this.encryptedPassword,
          'rememberMe': false,
        },
        headers: this.basicHeaders,
      });

      if (authResp.statusCode !== 200 ) {
        this.log.error('[HillstateAPI] could not authenticate, received: ', authResp.body);
        throw new Error('Authentication error');
      }

      const authRespCookie = authResp.headers['set-cookie'] ?? '';
      this.sidCookie = authRespCookie.toString().split(';')[0];

      // Get the CTOC Token
      this.log.debug('[HillstateAPI] setting CTOC token...');

      const ctocResp = await got.post(CONSTS.HILLSTATE_CTOC_URL, {
        headers: {
          'Cookie': this.sidCookie,
          ...this.basicHeaders,
        },
        json: {
          'siteId':'338',
          'dong':this.dong,
          'ho':this.ho,
          'clientId':'HT-WEB',
          'uuid':'',
        },
      });

      if (ctocResp.statusCode !== 200 ) {
        this.log.error('[HillstateAPI] could not get ctoc token, received: ', ctocResp.body);
        throw new Error('CTOC Token Registration Error');
      }

      this.log.info(`[HillstateAPI] authentication successful, Auth cookie: ${this.sidCookie}`);
      
      this.sidCookie = authRespCookie.toString().split(';')[0];
      this.lastAuthTime = Date.now();

      return this.sidCookie;
    }
  }

  /* discoverDevicesInt tries to discover devices from Hillstate server

  failedAuthCookie is set to '' on the first call. 
  If the authentication fails,
    it retries the call again after triggering re-authentication with the failedAuthCookie
    This ensures that only one re-authentication is performed, even if multiple threads call authenticate
  */
  private async discoverDevicesInt(failedAuthCookie: string): Promise<deviceDiscoverResp> {
      this.log.debug('[HillstateAPI] Discovering devices called');
      const currentSidCookie = await this.authenticate(failedAuthCookie);
  
      try {
        const lightsDiscoverResp = await got.get(CONSTS.HILLSTATE_DISCOVER_DEVICES_URL,{
          headers: {
            'Cookie': currentSidCookie,
            ...this.basicHeaders,
          },
        });
  
        const lightsDiscoverData: deviceDiscoverResp = JSON.parse(lightsDiscoverResp.body as string);
        return lightsDiscoverData;
      } catch (error) {
        // !TODO: Refactor error handling to only reauthenticate on authentication errors
        if (failedAuthCookie === '') {
          this.log.info(`[HillstateAPI] First discover attempt failed with cookie ${currentSidCookie}`);
          return await this.discoverDevicesInt(currentSidCookie);
        }
  
        this.log.error('[HillstateAPI] Discovering devices failed after auth');
        if (error instanceof Error) {
          this.log.error(`[HillstateAPI] ${error.message}`);
          this.log.error(error.stack??'stack trace undefined');
        } else {
          this.log.error('[HillstateAPI] unknown error occured, dig deeper! Rock and Stone!');
        }

        // Return a safe empty response instead of rejecting to avoid unhandled promise rejections
        return CONSTS.EMPTY_DEVICES_DISCOVER_RESP;
      }
  }

  private async getDeviceStatusInt(requestURL: string, deviceID: string, failedAuthCookie: string): Promise<deviceStatusResp> {
      const getRequestURL = requestURL + deviceID;
      this.log.debug(`[HillstateAPI] Getting status for device ${getRequestURL}`);
      const currentSidCookie = await this.authenticate(failedAuthCookie);

      try {

        const deviceGetResp = await got.get(getRequestURL,{
          headers: {
            'Cookie': currentSidCookie,
            ...this.basicHeaders,
          },
        });

        if (deviceGetResp.statusCode !== 200 ) {
          this.log.error(`[HillstateAPI] could not get device status for URL ${getRequestURL}, received: `, deviceGetResp.body);
          throw new Error('Get Device Status Error');
        }

        return JSON.parse(deviceGetResp.body as string) as deviceStatusResp;

      } catch (error) {
        // !TODO: Refactor error handling to only reauthenticate on authentication errors
        if (failedAuthCookie === '') {
          this.log.info(`[HillstateAPI] First getDeviceStatus attempt failed with cookie ${currentSidCookie}`);
          return await this.getDeviceStatusInt(requestURL, deviceID, currentSidCookie);
        }

        this.log.error(`[HillstateAPI] Getting device status for ${getRequestURL} failed after auth`);
        if (error instanceof Error) {
          this.log.error(`[HillstateAPI] ${error.message}`);
          this.log.error(error.stack??'stack trace undefined');
        } else {
          this.log.error('[HillstateAPI] unknown error occured, dig deeper! Rock and Stone!');
        }

        // Return a safe empty response instead of rejecting to avoid unhandled promise rejections
        return CONSTS.HILLSTATE_EMPTY_DEVICE_STATUS_RESP;
      }
  }

  private async setDeviceStatusInt(requestURL: string, deviceID: string, commandBody: deviceStatusCommand, failedAuthCookie: string): Promise<void> {
    const setRequestURL = requestURL + deviceID;
    this.log.debug(`[HillstateAPI] Setting status for device ${setRequestURL} with body ${JSON.stringify(commandBody)}`);
    const currentCookie = await this.authenticate(failedAuthCookie);

    try {

      const deviceSet = await got.put(setRequestURL, {
        headers: {
          'Cookie': currentCookie,
          ...this.basicHeaders,
        },
        json: {
          'commandList': [
            {
              'command': commandBody.command,
              'value': commandBody.value,
            },
          ],
        },
      });

      if (deviceSet.statusCode !== 200 ) {
        this.log.error(`[HillstateAPI] could not set device status for URL ${setRequestURL}, received: `, deviceSet.body);
        throw new Error('Set Device Status Error');
      }

    } catch (error) {
      // !TODO: Refactor error handling to only reauthenticate on authentication errors
      if (failedAuthCookie === '') {
        this.log.info(`[HillstateAPI] First setDeviceStatus attempt failed with cookie ${currentCookie}`);
        return await this.setDeviceStatusInt(requestURL, deviceID, commandBody, currentCookie);
      }

      this.log.error(`[HillstateAPI] Setting device status for ${setRequestURL} failed after auth`);
      if (error instanceof Error) {
        this.log.error(`[HillstateAPI] ${error.message}`);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('[HillstateAPI] unknown error occured, dig deeper! Rock and Stone!');
      }
    }
  }
  
}