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
    // Taken from the device metadata, never from displayName: that is a
    // user-facing field, so a rename would otherwise be built into request URLs
    // and break every read and write for this light.
    this.lightId = this.accessory.context.device.id;
    const name = this.accessory.context.name;

    this.platform.setAccessoryInformation(this.accessory, name);

    this.service = this.accessory.getService(this.platform.Service.Lightbulb)
      || this.accessory.addService(this.platform.Service.Lightbulb);
    this.platform.bindName(this.accessory, this.service, name);

    this.platform.hillstateAPI.trackLight(this.lightId);

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
