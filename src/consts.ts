/*
This file contains all the constants that are used in the application,
and all the structs required for proper and clean requests to Hillstate API
*/

export abstract class CONSTS {
  static readonly AUTH_PUBLIC_KEY: string     = 'hTsEcret';
  static readonly HILLSTATE_LOGIN_URL: string = 'https://www2.hthomeservice.com/login';
  static readonly HILLSTATE_CTOC_URL: string  = 'https://www2.hthomeservice.com/getctoctoken';
  static readonly UNDEFINED: string           = 'undefined';
}
