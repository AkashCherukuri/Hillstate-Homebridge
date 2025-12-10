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

  // Initialize this class with the encrypted username and password   
  // Automatically refresh the session cookie every 5 minutes
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
    setInterval(() => this.authenticate(), 5*60*1000);
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
    this.log.info('setting aircon '+aircon+' to '+JSON.stringify(command));
    return this.setAirconStatInt(true, aircon, command).catch(err => {
      this.log.error('Failed to set aircon stat:', err);
    });
  }
  
  public async getHeaterStat(heater: string): Promise<deviceStatusResp> {
    return this.getHeaterStatInt(true, heater);
  }

  public async setHeaterStat(heater: string, command: deviceStatusCommand) {
    this.log.info('setting heater '+heater+' to '+JSON.stringify(command));
    return this.setHeaterStatInt(true, heater, command).catch(err => {
      this.log.error('Failed to set heater stat:', err);
    });
  }

  // discoverDevicesInt returns a JSON of all of the devices in Hillstate after querying the API
  private async discoverDevicesInt(first: boolean): Promise<deviceDiscoverResp> {
    this.log.info('attempting to discover devices');

    try {
      const lightsDiscoverResp = await got.get(CONSTS.HILLSTATE_DISCOVER_DEVICES_URL,{
        headers: {
          'Cookie': this.sidCookie,
          ...this.basicHeaders,
        },
      });

      const lightsDiscoverData: deviceDiscoverResp = JSON.parse(lightsDiscoverResp.body as string);
      return lightsDiscoverData;
    } catch (error) {
      if (first) {
        this.log.info('attempting auth before re-attempting discovering devices');
        await this.authenticate();
        return await this.discoverDevicesInt(false);
      }

      this.log.error('discovering devices failed after auth');
      if (error instanceof Error) {
        this.log.error(error.message);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('unknown error occured, dig deeper! Rock and Stone!');
      }
      // Return a safe empty response instead of rejecting to avoid unhandled promise rejections
      return CONSTS.EMPTY_DEVICES_DISCOVER_RESP;
    }
  }

  private async getHeaterStatInt(first: boolean, heater: string): Promise<deviceStatusResp> {
    this.log.info('attempting to get heater info');

    try {
      
      const heaterGet = await got.get(CONSTS.HILLSTATE_HEATER_URL + heater, {
        headers: {
          'Cookie': this.sidCookie,
          ...this.basicHeaders,
        },
      });

      if (heaterGet.statusCode !== 200) {
        this.log.error('getting heater status failed');
        throw new Error('Error getting heater status');
      }

      const data: deviceStatusResp = JSON.parse(heaterGet.body as string);
      return data;

    } catch (error) {
      if (first) {
        this.log.info('attempting auth before re-attempting getting heater');
        await this.authenticate();
        return await this.getHeaterStatInt(false, heater);
      }

      this.log.error('getting heater failed after auth');
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
    this.log.info('attempting to set heater info');

    try {
      
      const heaterSet = await got.put(CONSTS.HILLSTATE_HEATER_URL + heater, {
        headers: {
          'Cookie': this.sidCookie,
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
        this.log.error('setting heater status failed');
        throw new Error('Error setting heater status');
      }
    } catch (error) {
      if (first) {
        this.log.info('attempting auth before re-attempting setting heater');
        await this.authenticate();
        return await this.setHeaterStatInt(false, heater, command);
      }

      this.log.error('setting heater failed after auth');
      if (error instanceof Error) {
        this.log.error(error.message);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('unknown error occured, dig deeper! Rock and Stone!');
      }
      // swallow error and return void to avoid crashing caller
      return;
    }
  }

  private async getAirconStatInt(first: boolean, aircon: string): Promise<deviceStatusResp> {
    this.log.info('attempting to get aircon info');

    try {
      
      const airconGet = await got.get(CONSTS.HILLSTATE_AIRCON_URL + aircon, {
        headers: {
          'Cookie': this.sidCookie,
          ...this.basicHeaders,
        },
      });

      if (airconGet.statusCode !== 200) {
        this.log.error('getting aircon status failed');
        throw new Error('Error getting aircon status');
      }

      const data: deviceStatusResp = JSON.parse(airconGet.body as string);
      return data;

    } catch (error) {
      if (first) {
        this.log.info('attempting auth before re-attempting getting aircon');
        await this.authenticate();
        return await this.getAirconStatInt(false, aircon);
      }

      this.log.error('getting aircon failed after auth');
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
  private async setAirconStatInt(first: boolean, aircon: string, command: deviceStatusCommand): Promise<void> {
    this.log.info('attempting to set aircon info');

    try {
      
      const airconSet = await got.put(CONSTS.HILLSTATE_AIRCON_URL + aircon, {
        headers: {
          'Cookie': this.sidCookie,
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
        this.log.error('setting aircon status failed');
        throw new Error('Error setting aircon status');
      }
    } catch (error) {
      if (first) {
        this.log.info('attempting auth before re-attempting setting aircon');
        await this.authenticate();
        return await this.setAirconStatInt(false, aircon, command);
      }

      this.log.error('setting aircon failed after auth');
      if (error instanceof Error) {
        this.log.error(error.message);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('unknown error occured, dig deeper! Rock and Stone!');
      }
      // swallow error and return void to avoid crashing caller
      return;
    }
  }

  // getLight gets the status of the light
  // returns True if the light is On, False if Off or there was an error
  private async getLightInt(first: boolean, light: string): Promise<boolean> {
    this.log.info('attempting to get light info');

    try {

      const lightGet = await got.get(CONSTS.HILLSTATE_LIGHT_URL + light, {
        headers: {
          'Cookie': this.sidCookie,
          ...this.basicHeaders,
        },
      });

      if (lightGet.statusCode !== 200) {
        this.log.error('getting light failed');
        throw new Error('Error getting light status');
      }

      const data: deviceStatusResp = JSON.parse(lightGet.body as string);
      return data.data.statusList[0].value === 'on';
      
    } catch (error) {
      if (first) {
        this.log.info('attempting auth before re-attempting getting light');
        await this.authenticate();
        return await this.getLightInt(false, light);
      }

      this.log.error('getting light failed after auth');
      if (error instanceof Error) {
        this.log.error(error.message);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('unknown error occured, dig deeper! Rock and Stone!');
      }
      // Return false on failure instead of rejecting
      return false;
    }
  }

  // setLight gets the status of the hardcoded lightbulb
  // If the call fails, attempt to authenticate and try again!
  private async setLightInt(first: boolean, light: string, cmd: OnOrOff): Promise<boolean> {
    this.log.info('attempting to set the light to: ', cmd);

    try {
      const lightResp = await got.put(CONSTS.HILLSTATE_LIGHT_URL + light, {
        headers: {
          'Cookie': this.sidCookie,
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
        this.log.error('setting light failed');
        throw new Error('Error setting light status');
      }

      this.log.info('light set to: ', cmd);
      return true;

    } catch (error) {
      if (first) {
        this.log.info('attempting auth before re-attempting setting light');
        await this.authenticate();
        return await this.setLightInt(false, light, cmd);
      }

      this.log.error('setting light failed after auth');
      if (error instanceof Error) {
        this.log.error(error.message);
        this.log.error(error.stack??'stack trace undefined');
      } else {
        this.log.error('unknown error occured, dig deeper! Rock and Stone!');
      }
      // Return false instead of rejecting
      return false;
    }
  }

  // authenticate logs in to Hillstate API with encrypted credentials and updates the current sessionID variable
  private async authenticate(): Promise<boolean> {
    this.log.info('authentication method initialized...');

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
        this.log.error('could not authenticate, received: ', authResp.body);
        throw new Error('Authentication error');
      }

      const authRespCookie = authResp.headers['set-cookie'] ?? '';
      this.sidCookie = authRespCookie.toString().split(';')[0];

      this.log.info('authentication successful, sid cookie: ', this.sidCookie);

      // Get the CTOC Token
      this.log.info('setting CTOC token...');

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
        this.log.error('could not get ctoc token, received: ', authResp.body);
        throw new Error('CTOC Token Registration Error');
      }

      this.log.info('authentication successful!');
      return true;
    } catch (error) {
      this.log.error('authentication failed');
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