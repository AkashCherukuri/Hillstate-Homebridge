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
  
  // Caching properties to reduce redundant fetches
  private lastFetchTime: number = 0;
  private stateOutdated: boolean = true;
  private cachedAirconState: deviceStatusResp = CONSTS.HILLSTATE_EMPTY_DEVICE_STATUS_RESP;
  private cachedHeaterState: deviceStatusResp = CONSTS.HILLSTATE_EMPTY_DEVICE_STATUS_RESP;
  private readonly CACHE_DURATION: number = 2000; // 2 seconds

  constructor(
    private readonly platform: HillstateIOTHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
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

  // fetchStates returns the cached states if the last fetch was within the CACHE_DURATION
  // A new request is made if the cache has expired, or if a set function was called previously.
  private async fetchStates() {
    const now = Date.now();
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: checking cache freshness`)

    // Check if we need to fetch new data
    if (!this.stateOutdated && (now - this.lastFetchTime) < this.CACHE_DURATION) {
      this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: state cache not outdated!`)
      // Return cached data
      return {
        airconState: this.cachedAirconState,
        heaterState: this.cachedHeaterState
      };
    }
    
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: state cache outdated, fetching`)

    // Fetch new data
    try {
      const [airconState, heaterState] = await Promise.all([
        this.platform.hillstateAPI.getAirconStat(this.airconId),
        this.platform.hillstateAPI.getHeaterStat(this.heaterId)
      ]);
      
      // Update cache
      this.cachedAirconState = airconState;
      this.cachedHeaterState = heaterState;
      this.lastFetchTime = now;
      this.stateOutdated = false;
      
      return {
        airconState,
        heaterState
      };
    } catch (error) {
      this.platform.log.error('Failed to fetch thermostat states:', error);
      // Return cached data even if fetch failed
      return {
        airconState: this.cachedAirconState,
        heaterState: this.cachedHeaterState
      };
    }
  }

  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: getCurrentHeatingCoolingState called`)
    const { airconState, heaterState } = await this.fetchStates();

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
    const { airconState, heaterState } = await this.fetchStates();
    
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
      airconProm = this.platform.hillstateAPI.setAirconStat(this.airconId, {
        'command': 'power',
        'value': 'off',
      });
      heaterProm = this.platform.hillstateAPI.setHeaterStat(this.heaterId, {
        'command': 'power',
        'value': 'off',
      });
    } else if (state === this.platform.Characteristic.TargetHeatingCoolingState.COOL) {
      airconProm = this.platform.hillstateAPI.setAirconStat(this.airconId, {
        'command': 'power',
        'value': 'on',
      });
      heaterProm = this.platform.hillstateAPI.setHeaterStat(this.heaterId, {
        'command': 'power',
        'value': 'off',
      });
    } else if (state === this.platform.Characteristic.TargetHeatingCoolingState.HEAT) {
      airconProm = this.platform.hillstateAPI.setAirconStat(this.airconId, {
        'command': 'power',
        'value': 'off',
      });
      heaterProm = this.platform.hillstateAPI.setHeaterStat(this.heaterId, {
        'command': 'power',
        'value': 'on',
      });
    }

    // Mark state as outdated after setting
    this.stateOutdated = true;

    // Await the devices to change states as requested
    await Promise.all([
      airconProm,
      heaterProm,
    ]);
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: getCurrentTemperature called`)

    const { airconState } = await this.fetchStates();
    return airconState.data.statusList[4].value;
  }

  async getTargetTemperature(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: getTargetTemperature called`)

    const { airconState, heaterState } = await this.fetchStates();

    // Return the heater's temp if its on, aircon's temp otherwise
    if (heaterState.data.statusList[0].value === 'on') {
      return heaterState.data.statusList[2].value;
    } else {
      return airconState.data.statusList[3].value;
    }
  }

  async setTargetTemperature(value: CharacteristicValue) {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: setTargetTemperature called with ${value}`)

    const { airconState, heaterState } = await this.fetchStates();
    const roundedTemp: string = Math.round(Number(value)).toString();
    let cmd: Promise<void> = Promise.resolve();

    if (airconState.data.statusList[0].value === 'on') {
      cmd = this.platform.hillstateAPI.setAirconStat(this.airconId, {
        'command': 'setTemperature',
        'value': roundedTemp,
      });
    } else if (heaterState.data.statusList[0].value === 'on') {
      cmd = this.platform.hillstateAPI.setHeaterStat(this.heaterId, {
        'command': 'setTemperature',
        'value': roundedTemp,
      });
    }

    this.stateOutdated = true;
    await cmd
  }
}
