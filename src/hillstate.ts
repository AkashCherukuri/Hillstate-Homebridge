import { Logging } from 'homebridge';
import { AES } from 'crypto-ts';
import got from 'got';

import { CONSTS } from './consts.js';
import {
  OnOrOff,
  deviceStatusResp,
  deviceDiscoverResp,
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
    setInterval(this.authenticate, 5*60*1000);
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
      return CONSTS.EMPTY_DEVICES_DISCOVER_RESP;
    }
  }

  //! TODO: Take light as an argument here!
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
      return false;
    }
  }

  //! TODO: Take a light as an argument and use it to get the status of a lightbulb
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

      return false;
    }
  }
}