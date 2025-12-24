import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { HillstateIOTHomebridgePlatform } from './platform.js';

/*  HillstateFanPlatformAccessory is responsible for fetching Fan data from the main API
 *  The requests are not asynchronous because HillstateAPI is not asynchronous.
 *  Note that this is virtually identical to the Light accessory.
 */
export class HillstateFanPlatformAccessory {
  private service: Service;
  private fanId: string;

  constructor(
    private readonly platform: HillstateIOTHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    this.service = this.accessory.getService(this.platform.Service.Fan) || this.accessory.addService(this.platform.Service.Fan);
    this.service.setCharacteristic(
      this.platform.Characteristic.Name, 
      accessory.context.device.id);

    this.fanId = this.accessory.displayName;

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))  // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this)); // GET - bind to the `getOn` method below
  }

  async setOn(value: CharacteristicValue) {
    await this.platform.hillstateAPI.setLight(this.fanId, value as boolean);
    this.platform.log.info('Fan ', this.fanId, 'set to ', value);
  }

  async getOn(): Promise<CharacteristicValue> {
    return this.platform.hillstateAPI.getLight(this.fanId);
  }
}
