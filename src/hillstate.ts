import { Logging } from 'homebridge';
import { AES } from 'crypto-ts';
import got from 'got';

import { CONSTS } from './consts.js';
import {
  OnOrOff,
  deviceStatusResp,
  deviceDiscoverResp,
  deviceStatusCommand,
} from './types.js';

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
  private dong: number;
  private ho: number;

  // sidCookie stores the current session ID cookie to be injected into request headers
  private sidCookie: string = '';
  
  // Authentication state management
  private authPromise: Promise<boolean> | null = null;

  // Initialize this class with the encrypted username and password   
  constructor(
    public readonly log: Logging,
    public readonly username: string,
    public readonly password: string,
    public readonly dongIn: number,
    public readonly hoIn: number,
  ) {
    this.encryptedUsername = AES.encrypt(username, CONSTS.AUTH_PUBLIC_KEY).toString();
    this.encryptedPassword = AES.encrypt(password, CONSTS.AUTH_PUBLIC_KEY).toString();
    this.dong              = dongIn;
    this.ho                = hoIn;

    this.log.info('Hillstate API initialized with encrypted credentials');

    this.authenticate();
  }

  public async getLight(light: string): Promise<boolean> {
    return await this.getLightInt(true, light);
  }

  public async setLight(light: string, cmd: OnOrOff): Promise<boolean> {
    return await this.setLightInt(true, light, cmd);
  }

  public async discoverDevices(): Promise<deviceDiscoverResp> {
    return await this.discoverDevicesInt(true);
  }

  public async getAirconStat(aircon: string): Promise<deviceStatusResp> {
    return this.getAirconStatInt(true, aircon);
  }

  public async setAirconStat(aircon: string, command: deviceStatusCommand) {
    this.log.info(`[HillstateAPI] setAirconStat called for aircon: ${aircon} with command: ${JSON.stringify(command)}`);
    return this.setAirconStatInt(true, aircon, command).catch(err => {
      this.log.error('[HillstateAPI] Failed to set aircon stat:', err);
    });
  }
  
  public async getHeaterStat(heater: string): Promise<deviceStatusResp> {
    return this.getHeaterStatInt(true, heater);
  }

  public async setHeaterStat(heater: string, command: deviceStatusCommand) {
    this.log.info(`[HillstateAPI] setHeaterStat called for heater: ${heater} with command: ${JSON.stringify(command)}`);
    return this.setHeaterStatInt(true, heater, command).catch(err => {
      this.log.error('[HillstateAPI] Failed to set heater stat:', err);
    });
  }

  // discoverDevicesInt returns a JSON of all of the devices in Hillstate after querying the API
  private async discoverDevicesInt(first: boolean): Promise<deviceDiscoverResp> {
    this.log.debug('[HillstateAPI] Discovering devices called');
    
    // Capture the current cookie at the start of the method
    const currentCookie = this.sidCookie;

    try {
      const lightsDiscoverResp = await got.get(CONSTS.HILLSTATE_DISCOVER_DEVICES_URL,{
        headers: {
          'Cookie': currentCookie,
          ...this.basicHeaders,
        },
      });

      const lightsDiscoverData: deviceDiscoverResp = JSON.parse(lightsDiscoverResp.body as string);
      return lightsDiscoverData;
    } catch (error) {
      if (first) {
        this.log.info('[HillstateAPI] First discover attempt failed, attempting auth before re-attempting');
        await this.authenticate(currentCookie);
        return await this.discoverDevicesInt(false);
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

  private async getHeaterStatInt(first: boolean, heater: string): Promise<deviceStatusResp> {
    this.log.debug(`[HillstateAPI] getHeaterStatInt called for heater: ${heater}`);
    
    // Capture the current cookie at the start of the method
    const currentCookie = this.sidCookie;

    try {
      
      const heaterGet = await got.get(CONSTS.HILLSTATE_HEATER_URL + heater, {
        headers: {
          'Cookie': currentCookie,
          ...this.basicHeaders,
        },
      });

      if (heaterGet.statusCode !== 200) {
        this.log.error(`[HillstateAPI] getting heater ${heater} status failed`);
        throw new Error('Error getting heater status');
      }

      const data: deviceStatusResp = JSON.parse(heaterGet.body as string);
      return data;

    } catch (error) {
      if (first) {
        this.log.info(`[HillstateAPI] Attemptng auth before re-attempting getting heater ${heater}`);
        await this.authenticate(currentCookie);
        return await this.getHeaterStatInt(false, heater);
      }

      this.log.error(`[HillstateAPI] getHeaterStatInt failed for ${heater} after re-auth`);
      if (error instanceof Error) {
        this.log.error(error.message);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('unknown error occured, dig deeper! Rock and Stone!');
      }
      // Return a safe empty device status instead of rejecting
      return CONSTS.HILLSTATE_EMPTY_DEVICE_STATUS_RESP;
    }
  }

  // !TODO: This function's parsing is very bad, but it works so I am not changing
  private async setHeaterStatInt(first: boolean, heater: string, command: deviceStatusCommand): Promise<void> {
    this.log.debug(`[HillstateAPI] setHeaterStatInt called for heater: ${heater} with command: ${JSON.stringify(command)}`);
    
    // Capture the current cookie at the start of the method
    const currentCookie = this.sidCookie;

    try {
      
      const heaterSet = await got.put(CONSTS.HILLSTATE_HEATER_URL + heater, {
        headers: {
          'Cookie': currentCookie,
          ...this.basicHeaders,
        },
        json: {
          'commandList': [
            {
              'command': command.command,
              'value': command.value,
            },
          ],
        },
      });

      if (heaterSet.statusCode !== 200) {
        this.log.error(`[HillstateAPI] setting heater ${heater} status to ${JSON.stringify(command)} failed`);
        throw new Error('Error setting heater status');
      }
    } catch (error) {
      if (first) {
        this.log.info(`[HillstateAPI] reattempting auth before setting heater: ${heater} with command: ${JSON.stringify(command)}`);
        await this.authenticate(currentCookie);
        return await this.setHeaterStatInt(false, heater, command);
      }

      this.log.error(`[HillstateAPI] Setting heater: ${heater} with command: ${JSON.stringify(command)} failed after re-auth`);
      if (error instanceof Error) {
        this.log.error(`[HillstateAPI] ${error.message}`);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('[HillstateAPI] unknown error occured, dig deeper! Rock and Stone!');
      }
      // swallow error and return void to avoid crashing caller
      return;
    }
  }

  private async getAirconStatInt(first: boolean, aircon: string): Promise<deviceStatusResp> {
    this.log.debug(`[HillstateAPI] getAirconStatInt called for aircon: ${aircon}`);
    
    // Capture the current cookie at the start of the method
    const currentCookie = this.sidCookie;

    try {
      
      const airconGet = await got.get(CONSTS.HILLSTATE_AIRCON_URL + aircon, {
        headers: {
          'Cookie': currentCookie,
          ...this.basicHeaders,
        },
      });

      if (airconGet.statusCode !== 200) {
        this.log.error(`[HillstateAPI] getAirconStatInt failed for aircon: ${aircon}`);
        throw new Error('Error getting aircon status');
      }

      const data: deviceStatusResp = JSON.parse(airconGet.body as string);
      return data;

    } catch (error) {
      if (first) {
        this.log.info(`[HillstateAPI] Attempting auth before re-attempting getAirconStatInt for aircon: ${aircon}`);
        await this.authenticate(currentCookie);
        return await this.getAirconStatInt(false, aircon);
      }

      this.log.error(`[HillstateAPI] getAirconStatInt failed after re-auth for aircon: ${aircon}`);
      if (error instanceof Error) {
        this.log.error(`[HillstateAPI] ${error.message}`);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('[HillstateAPI] unknown error occured, dig deeper! Rock and Stone!');
      }
      // Return a safe empty device status instead of rejecting
      return CONSTS.HILLSTATE_EMPTY_DEVICE_STATUS_RESP;
    }
  }

  // !TODO: This function's parsing is very bad, but it works so I am not changing
  private async setAirconStatInt(first: boolean, aircon: string, command: deviceStatusCommand): Promise<void> {
    this.log.info(`[HillstateAPI] setAirconStatInt called for aircon: ${aircon} with command: ${JSON.stringify(command)}`);
    
    // Capture the current cookie at the start of the method
    const currentCookie = this.sidCookie;

    try {
      
      const airconSet = await got.put(CONSTS.HILLSTATE_AIRCON_URL + aircon, {
        headers: {
          'Cookie': currentCookie,
          ...this.basicHeaders,
        },
        json: {
          'commandList': [
            {
              'command': command.command,
              'value': command.value,
            },
          ],
        },
      });

      if (airconSet.statusCode !== 200) {
        this.log.error(`[HillstateAPI] setAirconStatInt failed for aircon: ${aircon} with command: ${JSON.stringify(command)}`);
        throw new Error('Error setting aircon status');
      }
    } catch (error) {
      if (first) {
        this.log.info(`[HillstateAPI] Attempting auth before re-attempting setAirconStatInt for aircon: ${aircon} with command: ${JSON.stringify(command)}`);
        await this.authenticate(currentCookie);
        return await this.setAirconStatInt(false, aircon, command);
      }

      this.log.error(`[HillstateAPI] setAirconStatInt failed after auth for aircon: ${aircon} with command: ${JSON.stringify(command)}`);
      if (error instanceof Error) {
        this.log.error(`[HillstateAPI] ${error.message}`);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('[HillstateAPI] unknown error occured, dig deeper! Rock and Stone!');
      }
      // swallow error and return void to avoid crashing caller
      return;
    }
  }

  // getLight gets the status of the light
  // returns True if the light is On, False if Off or there was an error
  private async getLightInt(first: boolean, light: string): Promise<boolean> {
    this.log.info(`[HillstateAPI] getLightInt called for light: ${light}`);
    
    // Capture the current cookie at the start of the method
    const currentCookie = this.sidCookie;

    try {

      const lightGet = await got.get(CONSTS.HILLSTATE_LIGHT_URL + light, {
        headers: {
          'Cookie': currentCookie,
          ...this.basicHeaders,
        },
      });

      if (lightGet.statusCode !== 200) {
        this.log.error(`[HillstateAPI] getting light ${light} failed`);
        throw new Error('Error getting light status');
      }

      const data: deviceStatusResp = JSON.parse(lightGet.body as string);
      return data.data.statusList[0].value === 'on';
      
    } catch (error) {
      if (first) {
        this.log.info(`[HillstateAPI] attempting auth before re-attempting getting light: ${light}`);
        await this.authenticate(currentCookie);
        return await this.getLightInt(false, light);
      }

      this.log.error(`[HillstateAPI] getting light ${light} failed after auth`);
      if (error instanceof Error) {
        this.log.error(`[HillstateAPI] ${error.message}`);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('[HillstateAPI] unknown error occured, dig deeper! Rock and Stone!');
      }
      // Return false on failure instead of rejecting
      return false;
    }
  }

  // setLight gets the status of the hardcoded lightbulb
  // If the call fails, attempt to authenticate and try again!
  private async setLightInt(first: boolean, light: string, cmd: OnOrOff): Promise<boolean> {
    this.log.info(`[HillstateAPI] setLightInt called for light: ${light} with command: ${cmd}`);
    
    // Capture the current cookie at the start of the method
    const currentCookie = this.sidCookie;

    try {
      const lightResp = await got.put(CONSTS.HILLSTATE_LIGHT_URL + light, {
        headers: {
          'Cookie': currentCookie,
          ...this.basicHeaders,
        },
        json: {
          'commandList': [
            {
              'command': 'power',
              'value': cmd,
            },
          ],
        },
      }); 
      
      if (lightResp.statusCode !== 200) {
        this.log.error(`[HillstateAPI] setting light ${light} to ${cmd} failed`);
        throw new Error('Error setting light status');
      }

      this.log.info(`[HillstateAPI] light ${light} set to: ${cmd}`);
      return true;

    } catch (error) {
      if (first) {
        this.log.info(`[HillstateAPI] attempting auth before re-attempting setting light: ${light} to ${cmd}`);
        await this.authenticate(currentCookie);
        return await this.setLightInt(false, light, cmd);
      }

      this.log.error(`[HillstateAPI] setting light ${light} to ${cmd} failed after auth`);
      if (error instanceof Error) {
        this.log.error(`[HillstateAPI] ${error.message}`);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('[HillstateAPI] unknown error occured, dig deeper! Rock and Stone!');
      }
      // Return false instead of rejecting
      return false;
    }
  }

  // authenticate logs in to Hillstate API with encrypted credentials and updates the current sessionID variable
  private async authenticate(failedCookie?: string): Promise<boolean> {
    // If a failed cookie is provided and it doesn't match the current cookie, don't re-authenticate
    if (failedCookie && failedCookie !== this.sidCookie) {
      this.log.info('[HillstateAPI] Skipping authentication - failed cookie does not match current cookie');
      return false;
    }
    
    // If an authentication is already in progress, wait for it to complete
    if (this.authPromise) {
      this.log.info('[HillstateAPI] Authentication already in progress, waiting for completion...');
      return await this.authPromise;
    }
    
    // Start a new authentication process
    this.authPromise = this.performAuthentication();
    
    try {
      const result = await this.authPromise;
      return result;
    } finally {
      // Clear the auth promise when done
      this.authPromise = null;
    }
  }
  
  // Actual authentication implementation
  private async performAuthentication(): Promise<boolean> {
    this.log.info('[HillstateAPI] authentication method initialized...');

    try {
      const authResp = await got.post(CONSTS.HILLSTATE_LOGIN_URL, {
        json: {
          'id': this.encryptedUsername,
          'password': this.encryptedPassword,
          'rememberMe': false,
        },
        headers: this.basicHeaders,
      });

      //! TODO: Need better error handling!
      //!       https://engineering.udacity.com/handling-errors-like-a-pro-in-typescript-d7a314ad4991
      if (authResp.statusCode !== 200 ) {
        this.log.error('[HillstateAPI] could not authenticate, received: ', authResp.body);
        throw new Error('Authentication error');
      }

      const authRespCookie = authResp.headers['set-cookie'] ?? '';
      this.sidCookie = authRespCookie.toString().split(';')[0];

      this.log.info('[HillstateAPI] authentication successful, sid cookie: ', this.sidCookie);

      // Get the CTOC Token
      this.log.info('[HillstateAPI] setting CTOC token...');

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
        this.log.error('[HillstateAPI] could not get ctoc token, received: ', authResp.body);
        throw new Error('CTOC Token Registration Error');
      }

      this.log.info('[HillstateAPI] authentication successful!');
      return true;
    } catch (error) {
      this.log.error('[HillstateAPI] authentication failed');
      if (error instanceof Error) {
        this.log.error(error.message);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('unknown error occured, dig deeper! Rock and Stone!');
      }
      // Return false instead of rejecting to keep callers safe
      return false;
    }
  }
}
