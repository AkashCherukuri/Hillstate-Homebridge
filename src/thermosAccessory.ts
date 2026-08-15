import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { HillstateIOTHomebridgePlatform } from './platform.js';
import { deviceStatusCommand, statusIsOn, statusNumber } from './types.js';

/**
 * ThermosAccessory unifies control of AC and heater of the same room.
 */
export class HillstateThermosPlatformAccessory {
  private service: Service;
  private airconId: string;
  private heaterId: string;

  constructor(
    private readonly platform: HillstateIOTHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // The heater serving a room is numbered 400 below its aircon:
    // aircon 012811 -> heater 012411.
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

  /* fetchState returns the aircon and heater status lists.

     There is no caching here any more: HillstateAPI caches and de-duplicates
     these calls, so the four characteristic reads HomeKit issues per thermostat
     collapse into at most two HTTP requests.
  */
  private async fetchState(): Promise<[Array<deviceStatusCommand>, Array<deviceStatusCommand>]> {
    return Promise.all([
      this.platform.hillstateAPI.getAirCon(this.airconId),
      this.platform.hillstateAPI.getHeater(this.heaterId),
    ]);
  }

  private fail(what: string, error: unknown): Error {
    return this.platform.communicationFailure(`[Aircon ${this.airconId}, Heater ${this.heaterId}] ${what}`, error);
  }

  async getCurrentHeatingCoolingState(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: getCurrentHeatingCoolingState called`);

    try {
      const [airconState, heaterState] = await this.fetchState();

      // If both heater and cooler were on, getTargetHeatingCoolingState would turn the heater off
      if (statusIsOn(airconState)) {
        return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
      } else if (statusIsOn(heaterState)) {
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
      }
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    } catch (error) {
      throw this.fail('failed to read current heating/cooling state', error);
    }
  }

  async getTargetHeatingCoolingState(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: getTargetHeatingCoolingState called`);

    try {
      const [airconState, heaterState] = await this.fetchState();

      // If both AC and heater are on, turn the heater off.
      if (statusIsOn(airconState) && statusIsOn(heaterState)) {
        this.platform.log.info(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: both found on, turning heater off`);

        // Deliberately not awaited so the read stays fast, but the rejection must
        // be handled here or it escapes as an unhandled promise rejection.
        this.setTargetHeatingCoolingState(this.platform.Characteristic.TargetHeatingCoolingState.COOL)
          .catch((error) => {
            this.platform.log.error(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: failed to turn heater off: ${error}`);
          });

        return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
      }

      if (statusIsOn(airconState)) {
        return this.platform.Characteristic.TargetHeatingCoolingState.COOL;
      } else if (statusIsOn(heaterState)) {
        return this.platform.Characteristic.TargetHeatingCoolingState.HEAT;
      } else {
        return this.platform.Characteristic.TargetHeatingCoolingState.OFF;
      }
    } catch (error) {
      throw this.fail('failed to read target heating/cooling state', error);
    }
  }

  async setTargetHeatingCoolingState(state: CharacteristicValue) {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: setTargetHeatingCoolingState called with ${state}`);

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
    try {
      await Promise.all([
        airconProm,
        heaterProm,
      ]);
    } catch (error) {
      throw this.fail('failed to set heating/cooling state', error);
    }
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: getCurrentTemperature called`);

    try {
      // The aircon reports ambient temperature even while powered off.
      const airconState = await this.platform.hillstateAPI.getAirCon(this.airconId);
      return statusNumber(airconState, 'currTemperature');
    } catch (error) {
      throw this.fail('failed to read current temperature', error);
    }
  }

  async getTargetTemperature(): Promise<CharacteristicValue> {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: getTargetTemperature called`);

    try {
      const [airconState, heaterState] = await this.fetchState();

      // Return the heater's temp if its on, aircon's temp otherwise
      if (statusIsOn(heaterState)) {
        return statusNumber(heaterState, 'setTemperature');
      }
      return statusNumber(airconState, 'setTemperature');
    } catch (error) {
      throw this.fail('failed to read target temperature', error);
    }
  }

  async setTargetTemperature(value: CharacteristicValue) {
    this.platform.log.debug(`[Aircon ${this.airconId}, Heater ${this.heaterId}]: setTargetTemperature called with ${value}`);

    try {
      const [airconState, heaterState] = await this.fetchState();
      const roundedTemp: string = Math.round(Number(value)).toString();

      if (statusIsOn(airconState)) {
        await this.platform.hillstateAPI.setAirCon(this.airconId, {
          'command': 'setTemperature',
          'value': roundedTemp,
        });
      } else if (statusIsOn(heaterState)) {
        await this.platform.hillstateAPI.setHeater(this.heaterId, {
          'command': 'setTemperature',
          'value': roundedTemp,
        });
      }
    } catch (error) {
      throw this.fail('failed to set target temperature', error);
    }
  }
}
