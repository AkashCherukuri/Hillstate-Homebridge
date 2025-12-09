/*
This file contains all the constants that are used in the application,
and all the structs required for proper and clean requests to Hillstate API
*/

import { deviceDiscoverResp } from './types.js';

export abstract class CONSTS {
  static readonly LIGHT_DEVICE_TYPE: string = 'light';
  static readonly AIRCON_DEVICE_TYPE: string = 'aircon';
  static readonly VENT_DEVICE_TYPE: string = 'fan';

  static readonly SESH_REFRESH_TIMER: number  = 5*60;

  static readonly AUTH_PUBLIC_KEY: string     = 'hTsEcret';
  static readonly HILLSTATE_LOGIN_URL: string = 'https://www2.hthomeservice.com/login';
  static readonly HILLSTATE_CTOC_URL: string  = 'https://www2.hthomeservice.com/getctoctoken';

  static readonly HILLSTATE_DISCOVER_DEVICES_URL: string = 'https://www2.hthomeservice.com/proxy/ctoc/devices';
  static readonly HILLSTATE_LIGHT_URL: string = 'https://www2.hthomeservice.com/proxy/ctoc/lights/';
  static readonly HILLSTATE_AIRCON_URL: string = 'https://www2.hthomeservice.com/proxy/ctoc/aircons/';
  static readonly HILLSTATE_HEATER_URL: string = 'https://www2.hthomeservice.com/proxy/ctoc/heaters/';

  static readonly EMPTY_DEVICES_DISCOVER_RESP: deviceDiscoverResp = {
    'resultStatus': '',
    'transactionId': '',
    'data': {
      'totalCount': 0,
      'deviceList': [],
    },
  };
}
