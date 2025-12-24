import { Logging } from 'homebridge';
import { MutexRW } from 'mutex-ts';

import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { HillstateIOTHomebridgePlatform } from './platform.js';
import { deviceStatusResp } from './types.js';
import { CONSTS } from './consts.js';

/**
 * ThermosAccessory unifies control of AC and heater of the same room.
 */
export class HillstateThermosPlatformAccessory {
  private service: Service;
  private airconId: string;
  private heaterId: string;

  private stateRWMutex: MutexRW               = new MutexRW();
  // DO NOT USE cachedHeaterState and cachedAirconState DIRECTLY!!!! 
  // ALWAYS GET THEM THROUGH updateCache() TO FORCE UPDATE!!!!
  private cachedHeaterState: deviceStatusResp = CONSTS.HILLSTATE_EMPTY_DEVICE_STATUS_RESP;
  private cachedAirconState: deviceStatusResp = CONSTS.HILLSTATE_EMPTY_DEVICE_STATUS_RESP;
  private lastStateFetch: number              = -1;

  // updateCache fetches the new states if the saved data is outdated
  // TODO: Think if forced updated would ever be required
  private async updateCache(): Promise<[deviceStatusResp, deviceStatusResp]> {
    // Get the read lock and check if the data is outdated
    {
      using _ = await this.stateRWMutex.obtainRO();
      if (
        this.lastStateFetch !== -1 &&
        (Date.now() - this.lastStateFetch) < CONSTS.THERMOS_STATE_EXPIRY_MS
      ) {
        this.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}] Using cached data for state fetch`)
        return [this.cachedAirconState, this.cachedHeaterState];
      }
    }

    // Get the write lock and attempt to update the cached data
    {
      using _ = await this.stateRWMutex.obtainRW();

      // Double-check if the state is outdated, this could have been updated by another thread
      if (
        this.lastStateFetch !== -1 &&
        (Date.now() - this.lastStateFetch) < CONSTS.THERMOS_STATE_EXPIRY_MS
      ) {
        this.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}] Using cached data for state fetch`)
        return [this.cachedAirconState, this.cachedHeaterState]
      }

      this.log.info(`[Aircon ${this.airconId}, Heater ${this.heaterId}] Updating cached data...`)
      
      // Simultaneously fetch and wait for both aircon and heater state
      await Promise.all([
        this.platform.hillstateAPI.getAirCon(this.airconId),
        this.platform.hillstateAPI.getHeater(this.heaterId)
      ]).then((values) => {
        this.cachedAirconState = values[0];
        this.cachedHeaterState = values[1];
        this.lastStateFetch    = Date.now();
      });

      return [this.cachedAirconState, this.cachedHeaterState];
    }
  }

  constructor(
    private readonly platform: HillstateIOTHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly log: Logging,
  ) {
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // Set aircon and heater IDs
    this.airconId = this.accessory.displayName;
    this.heaterId = '0' + ((+this.accessory.displayName) - 400).toString();

    this.service = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.context.device.id);

    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this)); // GET - bind to the `getOn` method below

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));
  }

  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: getCurrentHeatingCoolingState called`)
    const [ airconState, heaterState ] = await this.updateCache();

    // If both heater and cooler were on, getTargetHeatingCoolingState would turn the heater off
    if (airconState.data.statusList[0].value === 'on') {
      return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
    } else if (heaterState.data.statusList[0].value === 'on') {
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    }
    return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
  }

  async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: getTargetHeatingCoolingState called`)
    const [ airconState, heaterState ] = await this.updateCache();
    
    // If both AC and heater are on, turn the heater off.
    if (airconState.data.statusList[0].value === 'on' && heaterState.data.statusList[0].value === 'on') {
      this.platform.log.info(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: both found on, turning heater off`);
      this.setTargetHeatingCoolingState(this.platform.Characteristic.TargetHeatingCoolingState.COOL);
      return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
    }

    if (airconState.data.statusList[0].value === 'on') {
      return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
    } else if(heaterState.data.statusList[0].value === 'on'){
      return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    } else {
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    }
  }

  async setTargetHeatingCoolingState(state: CharacteristicValue) {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: setTargetHeatingCoolingState called with ${state}`)
    
    // If set to AUTO, log an error and return; refusing to acknowledge state change
    if (state === this.platform.Characteristic.TargetHeatingCoolingState.AUTO) {
      this.platform.log.error('AUTO is an invalid state for this usecase: ' + this.airconId + ' ' + this.heaterId);
      return;
    }

    // Set stuff accordingly
    let airconProm: Promise<void> = Promise.resolve();
    let heaterProm: Promise<void> = Promise.resolve();

    if (state === this.platform.Characteristic.TargetHeatingCoolingState.OFF) {
      airconProm = this.platform.hillstateAPI.setAirCon(this.airconId, {
        'command': 'power',
        'value': 'off',
      });
      heaterProm = this.platform.hillstateAPI.setHeater(this.heaterId, {
        'command': 'power',
        'value': 'off',
      });
    } else if (state === this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
      airconProm = this.platform.hillstateAPI.setAirCon(this.airconId, {
        'command': 'power',
        'value': 'on',
      });
      heaterProm = this.platform.hillstateAPI.setHeater(this.heaterId, {
        'command': 'power',
        'value': 'off',
      });
    } else if (state === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
      airconProm = this.platform.hillstateAPI.setAirCon(this.airconId, {
        'command': 'power',
        'value': 'off',
      });
      heaterProm = this.platform.hillstateAPI.setHeater(this.heaterId, {
        'command': 'power',
        'value': 'on',
      });
    }

    // Await the devices to change states as requested
    await Promise.all([
      airconProm,
      heaterProm,
    ]);
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: getCurrentTemperature called`)

    const [ airconState, _ ] = await this.updateCache();
    return airconState.data.statusList[4].value;
  }

  async getTargetTemperature(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: getTargetTemperature called`)

    const [ airconState, heaterState ] = await this.updateCache();

    // Return the heater's temp if its on, aircon's temp otherwise
    if (heaterState.data.statusList[0].value === 'on') {
      return heaterState.data.statusList[2].value;
    } else {
      return airconState.data.statusList[3].value;
    }
  }

  async setTargetTemperature(value: CharacteristicValue) {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: setTargetTemperature called with ${value}`)

    const [ airconState, heaterState ] = await this.updateCache();
    const roundedTemp: string = Math.round(Number(value)).toString();
    let cmd: Promise<void> = Promise.resolve();

    if (airconState.data.statusList[0].value === 'on') {
      cmd = this.platform.hillstateAPI.setAirCon(this.airconId, {
        'command': 'setTemperature',
        'value': roundedTemp,
      });
    } else if (heaterState.data.statusList[0].value === 'on') {
      cmd = this.platform.hillstateAPI.setHeater(this.heaterId, {
        'command': 'setTemperature',
        'value': roundedTemp,
      });
    }

    await cmd
  }
}
