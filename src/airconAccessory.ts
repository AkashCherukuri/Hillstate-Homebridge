import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { HillstateIOTHomebridgePlatform } from './platform.js';
import { OnOrOff } from './types.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class HillstateAirconPlatformAccessory {
  private service: Service;
  private thisTemp: CharacteristicValue;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  // private exampleStates = {
  //   On: false,
  //   Brightness: 100,
  // };

  constructor(
    private readonly platform: HillstateIOTHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.thisTemp = 35;

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // get the LightBulb service if it exists, otherwise create a new LightBulb service
    // you can create multiple services for each accessory
    
    this.service = this.accessory.getService(this.platform.Service.HeaterCooler) || this.accessory.addService(this.platform.Service.HeaterCooler);

    // if (accessory.context.device.CustomService) {
    //   // This is only required when using Custom Services and Characteristics not support by HomeKit
    //   this.service = this.accessory.getService(this.platform.CustomServices[accessory.context.device.CustomService]) ||
    //     this.accessory.addService(this.platform.CustomServices[accessory.context.device.CustomService]);
    // } else {
    //   this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);
    // }

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.service.setCharacteristic(
      this.platform.Characteristic.Name, 
      accessory.context.device.id);

    // each service must implement at-minimum the "required characteristics" for the given service type
    // see https://developers.homebridge.io/#/service/Lightbulb

    // // register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setOn.bind(this)) // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this)); // GET - bind to the `getOn` method below
    
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeaterCoolerState.bind(this));
    
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onGet(this.getTargetHeaterCoolerState.bind(this))
      .onSet(this.setTargetHeaterCoolerState.bind(this));
    
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this))
      .onSet(this.setCurrentTemperature.bind(this));
  }

  async setOn(value: CharacteristicValue) {
    const cmd:OnOrOff = value===this.platform.api.hap.Characteristic.Active.ACTIVE ? 'on' : 'off';
    this.platform.hillstateAPI.setAirconPower(this.accessory.displayName, cmd);
    this.platform.log.debug('Set Characteristic On ->', value);
  }

  async getOn(): Promise<CharacteristicValue> {
    try {
      const isOn = await this.platform.hillstateAPI.getAirconPower(this.accessory.displayName) === true;
      this.platform.log.debug('Get Characteristic On ->', isOn);
      return isOn ? this.platform.api.hap.Characteristic.Active.ACTIVE : this.platform.api.hap.Characteristic.Active.INACTIVE;
    } catch (error) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getCurrentHeaterCoolerState(): Promise<CharacteristicValue> {
    return this.platform.api.hap.Characteristic.CurrentHeaterCoolerState.COOLING;
  }
  async getTargetHeaterCoolerState(): Promise<CharacteristicValue> {
    return this.platform.api.hap.Characteristic.TargetHeaterCoolerState.COOL;
  }  
  async setTargetHeaterCoolerState(value: CharacteristicValue) {
    this.platform.log.warn('Aircon can onlybe in COOL state, cannot set to ', value);
  }

  async getCurrentTemperature(): Promise<CharacteristicValue> {
    return this.thisTemp;
  }

  async setCurrentTemperature(value: CharacteristicValue) {
    this.thisTemp = value;
  }
}
