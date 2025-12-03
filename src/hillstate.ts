import { Logging } from 'homebridge';
import { AES } from 'crypto-ts';
import got from 'got';
import { CONSTS } from './consts.js';

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
  }

  // authenticate logs in to Hillstate API with encrypted credentials and updates the current sessionID variable
  public async authenticate(): Promise<boolean> {
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

      console.info('authentication successful, sid cookie: ', this.sidCookie);

      // Get the CTOC Token
      console.info('setting CTOC token...');

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