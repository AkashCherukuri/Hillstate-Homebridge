import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { HillstateIOTHomebridgePlatform } from './platform.js';
import { deviceStatusResp } from './types.js';
import { CONSTS } from './consts.js';

/**
 * ThermosAccessory automatically alternates between Heater/Cooler based on the set temperature
 */
export class HillstateThermosPlatformAccessory {
  private service: Service;
  private airconId: string;
  private heaterId: string;

  private airconState: deviceStatusResp = CONSTS.HILLSTATE_EMPTY_DEVICE_STATUS_RESP;
  private heaterState: deviceStatusResp = CONSTS.HILLSTATE_EMPTY_DEVICE_STATUS_RESP;

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
    this.heaterId = '0'+((+this.accessory.displayName)-400).toString();
    
    setInterval(async () => {
      this.airconState = await this.platform.hillstateAPI.getAirconStat(this.airconId);
      this.heaterState = await this.platform.hillstateAPI.getHeaterStat(this.heaterId);

      // If both heater and cooler are ON, turn one off and call the function again
      // Like, why would you ever need both of them to be on at the same time?
      // Prioritize turning off the heater as it is less disruptive and set the state to COOL
      (async function(ts: HillstateThermosPlatformAccessory) {
        const currAirconState = await ts.airconState;
        const currHeaterState = await ts.heaterState;
        if (currAirconState.data.statusList[0].value === 'on' && currHeaterState.data.statusList[0].value === 'on') {
          ts.platform.hillstateAPI.setHeaterStat(ts.heaterId, {
            'command': 'power',
            'value': 'off',
          });
        }
      }(this));
      

    }, 2*1000);

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

  //  I dont like this, there could be a race condition here...
  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    // What if there is a fetch request between these two lines?
    const currAirconState: deviceStatusResp = await this.airconState;
    const currHeaterState: deviceStatusResp = await this.heaterState;


    if (currAirconState.data.statusList[0].value === 'on') {
      return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
    } else if(currHeaterState.data.statusList[0].value === 'on') {
      return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
    }
    return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
  }

  async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    // What if there is a fetch request between these two lines?
    const currAirconState: deviceStatusResp = await this.airconState;
    const currHeaterState: deviceStatusResp = await this.heaterState;

    // If both are off, set AUTO to OFF to prevent them from turning back on
    if (currAirconState.data.statusList[0].value === 'off' && currHeaterState.data.statusList[0].value === 'off') {
      return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
    }
    // If both are ON, getCurrentHeatingCoolingState will turn the heater OFF soon anyways
    if (currAirconState.data.statusList[0].value === 'on') {
      return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
    } else {
      return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
    }
  }

  async setTargetHeatingCoolingState(state: CharacteristicValue) {
    // If set to AUTO, log an error and return; refusing to acknowledge state change
    if (state === this.platform.Characteristic.TargetHeatingCoolingState.AUTO ) {
      this.platform.log.error('AUTO is an invalid state for this usecase: ' + this.airconId + ' ' + this.heaterId);
      return;
    } 

    // Set stuff accordingly
    let airconProm: Promise<void> = Promise.resolve();
    let heaterProm: Promise<void> = Promise.resolve();

    if (state === this.platform.Characteristic.TargetHeatingCoolingState.OFF ) {
      airconProm = this.platform.hillstateAPI.setAirconStat(this.airconId, {
        'command': 'power',
        'value': 'off',
      });
      heaterProm = this.platform.hillstateAPI.setHeaterStat(this.heaterId, {
        'command': 'power',
        'value': 'off',
      });
    } else if (state === this.platform.Characteristic.TargetHeatingCoolingState.COOL ) {
      airconProm = this.platform.hillstateAPI.setAirconStat(this.airconId, {
        'command': 'power',
        'value': 'on',
      });
      heaterProm = this.platform.hillstateAPI.setHeaterStat(this.heaterId, {
        'command': 'power',
        'value': 'off',
      });
    } else if (state === this.platform.Characteristic.TargetHeatingCoolingState.HEAT ) {
      airconProm = this.platform.hillstateAPI.setAirconStat(this.airconId, {
        'command': 'power',
        'value': 'off',
      });
      heaterProm = this.platform.hillstateAPI.setHeaterStat(this.heaterId, {
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
    const currAirconState: deviceStatusResp = await this.airconState;
    return currAirconState.data.statusList[4].value;
  }

  async getTargetTemperature(): Promise<CharacteristicValue> {
    // What if there is a fetch request between these two lines?
    const currAirconState: deviceStatusResp = await this.airconState;
    const currHeaterState: deviceStatusResp = await this.heaterState;

    // Return the heater's temp if its on, aircon's temp otherwise
    if (currHeaterState.data.statusList[0].value === 'on') {
      return currHeaterState.data.statusList[2].value;
    } else {
      return currAirconState.data.statusList[3].value;
    }
  }

  async setTargetTemperature(value: CharacteristicValue) {
    // Actively fetch the statuses
    // this.airconState = this.platform.hillstateAPI.getAirconStat(this.airconId);
    // this.heaterState = this.platform.hillstateAPI.getHeaterStat(this.heaterId);

    const currAirconState = await this.airconState;
    const currHeaterState = await this.heaterState;

    const roundedTemp: string = Math.round(Number(value)).toString();

    if (currAirconState.data.statusList[0].value === 'on') {
      this.platform.hillstateAPI.setAirconStat(this.airconId, {
        'command': 'setTemperature',
        'value': roundedTemp,
      });
    } else if (currHeaterState.data.statusList[0].value === 'on') {
      this.platform.hillstateAPI.setHeaterStat(this.heaterId, {
        'command': 'setTemperature',
        'value': roundedTemp,
      });
    }

    // TODO: Perhaps update the target HeatingCoolingState if the thing is OFF?
  }

  // async getCurrentTemperature(): Promise<CharacteristicValue> {
  //   return this.thisTemp;
  // }

  // async setCurrentTemperature(value: CharacteristicValue) {
  //   this.thisTemp = value;
  // }
}
