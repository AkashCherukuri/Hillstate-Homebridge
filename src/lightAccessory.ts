import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { HillstateIOTHomebridgePlatform } from './platform.js';
import { OnOrOff } from './types.js';

/*  HillstateLightPlatformAccessory is responsible for fetching light data from the main API
 *  The requests are not asynchronous because HillstateAPI is not asynchronous.
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
      accessory.context.device.id
    );

    this.lightId = this.accessory.displayName;

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this)) // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this)); // GET - bind to the `getOn` method below
  }

  async setOn(value: CharacteristicValue) {
    const cmd:OnOrOff = value?'on':'off';
    await this.platform.hillstateAPI.setLight(this.lightId, cmd);

    this.platform.log.info('Light ', this.lightId, 'set to ', value);
  }

  async getOn(): Promise<CharacteristicValue> {
    return this.platform.hillstateAPI.getLight(this.lightId)
  }
}
