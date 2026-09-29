import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { HillstateIOTHomebridgePlatform } from './platform.js';

/*  HillstateFanPlatformAccessory exposes the bathroom vent, which Hillstate reports
 *  as a light, to HomeKit as a fan.
 *  Note that this is virtually identical to the Light accessory.
 */
export class HillstateFanPlatformAccessory {
  private service: Service;
  private fanId: string;

  constructor(
    private readonly platform: HillstateIOTHomebridgePlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // See the note in lightAccessory: the ID must not come from displayName.
    this.fanId = this.accessory.context.device.id;
    const name = this.accessory.context.name;

    this.platform.setAccessoryInformation(this.accessory, name);

    this.service = this.accessory.getService(this.platform.Service.Fan)
      || this.accessory.addService(this.platform.Service.Fan);
    this.platform.bindName(this.accessory, this.service, name);

    this.platform.hillstateAPI.trackLight(this.fanId);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))  // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this)); // GET - bind to the `getOn` method below
  }

  async setOn(value: CharacteristicValue) {
    try {
      await this.platform.hillstateAPI.setLight(this.fanId, value as boolean);
    } catch (error) {
      throw this.platform.communicationFailure(`[Fan ${this.fanId}] failed to set power`, error);
    }
    this.platform.log.info('Fan ', this.fanId, 'set to ', value);
  }

  async getOn(): Promise<CharacteristicValue> {
    try {
      return await this.platform.hillstateAPI.getLight(this.fanId);
    } catch (error) {
      throw this.platform.communicationFailure(`[Fan ${this.fanId}] failed to read power`, error);
    }
  }
}
