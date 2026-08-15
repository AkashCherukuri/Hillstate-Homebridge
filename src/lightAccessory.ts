import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { HillstateIOTHomebridgePlatform } from './platform.js';

/*  HillstateLightPlatformAccessory is responsible for fetching light data from the main API.
 *  Reads go through HillstateAPI's shared cache, so a HomeKit poll covering every
 *  light does not turn into one HTTP request per accessory.
 */
export class HillstateLightPlatformAccessory {
  private service: Service;
  private lightId: string;

  constructor(
    private readonly platform: HillstateIOTHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    this.service = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);

    this.service.setCharacteristic(
      this.platform.Characteristic.Name,
      accessory.context.device.id,
    );

    this.lightId = this.accessory.displayName;

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))  // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this)); // GET - bind to the `getOn` method below
  }

  async setOn(value: CharacteristicValue) {
    try {
      await this.platform.hillstateAPI.setLight(this.lightId, value as boolean);
    } catch (error) {
      throw this.platform.communicationFailure(`[Light ${this.lightId}] failed to set power`, error);
    }
    this.platform.log.info('Light ', this.lightId, 'set to ', value);
  }

  async getOn(): Promise<CharacteristicValue> {
    try {
      return await this.platform.hillstateAPI.getLight(this.lightId);
    } catch (error) {
      throw this.platform.communicationFailure(`[Light ${this.lightId}] failed to read power`, error);
    }
  }
}
