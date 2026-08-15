import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { HillstateLightPlatformAccessory } from './lightAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

// This is only required when using Custom Services and Characteristics not support by HomeKit
// import { EveHomeKitTypes } from 'homebridge-lib/EveHomeKitTypes';
import { HillstateAPI } from './hillstate.js';
import { deviceDiscoverResp } from './types.js';
import { CONSTS } from './consts.js';
import { HillstateFanPlatformAccessory } from './fanAccessory.js';
import { HillstateThermosPlatformAccessory } from './thermosAccessory.js';

/* Every accessory handler takes the same two arguments, which lets discoverDevices
   pick a class first and construct it once. */
type AccessoryConstructor = new (
  platform: HillstateIOTHomebridgePlatform,
  accessory: PlatformAccessory,
) => unknown;

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class HillstateIOTHomebridgePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();

  // This is only required when using Custom Services and Characteristics not support by HomeKit

  // public readonly CustomServices: any;

  // public readonly CustomCharacteristics: any;

  public hillstateAPI: HillstateAPI;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    // This is only required when using Custom Services and Characteristics not support by HomeKit
    // this.CustomServices = new EveHomeKitTypes(this.api).Services;
    // this.CustomCharacteristics = new EveHomeKitTypes(this.api).Characteristics;

    // Instantiate the Hillstate API class
    this.hillstateAPI = new HillstateAPI(
      this.log,
      config.username,
      config.password,
      config.dong,
      config.ho,
    );
    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices();
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  /* communicationFailure logs an upstream error and returns the HAP status that
     HomeKit renders as "No Response".

     Read handlers must never let a raw error escape: doing so surfaced as
     "Unhandled error thrown inside read handler" and left the tile broken.
  */
  public communicationFailure(context: string, error: unknown): Error {
    this.log.error(`${context}: ${error instanceof Error ? error.message : String(error)}`);
    return new this.api.hap.HapStatusError(this.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  }

  discoverDevices() {
    this.hillstateAPI.discoverDevices()
      .then((devices) => this.syncAccessories(devices))
      .catch((error) => {
        // Cached accessories are deliberately left in place: a failed discovery
        // says nothing about whether the devices still exist.
        this.log.error('Device discovery failed, keeping cached accessories');
        this.log.error(error instanceof Error ? error.message : String(error));
      });
  }

  /* syncAccessories registers everything discovered and then removes accessories
     that no longer exist upstream.

     The pruning half used to run synchronously alongside the discovery request
     rather than after it, so it always saw an empty result set and unregistered
     every cached accessory on every startup.
  */
  private syncAccessories(devices: deviceDiscoverResp) {
    const deviceList = devices.data.deviceList;

    // An empty list means the account genuinely has no devices, which has never
    // been true here, or that something went wrong upstream. Either way it must
    // not be read as "delete everything".
    if (deviceList.length === 0) {
      this.log.warn('Discovery returned no devices, leaving cached accessories untouched');
      return;
    }

    const discoveredUUIDs = new Set<string>();

    for (const device of deviceList) {
      let accessoryClass: AccessoryConstructor;

      switch (device.deviceType) {
      case CONSTS.LIGHT_DEVICE_TYPE:
        // The bathroom vent is a light upstream, but belongs in HomeKit as a fan.
        accessoryClass = device.deviceLocation === this.config.bathroomVentName
          ? HillstateFanPlatformAccessory
          : HillstateLightPlatformAccessory;
        break;
      case CONSTS.AIRCON_DEVICE_TYPE:
        // The room's heater is folded into the same thermostat accessory.
        accessoryClass = HillstateThermosPlatformAccessory;
        break;
      default:
        this.log.debug(`${device.id} is neither an aircon nor a light, skipping`);
        continue;
      }

      const uuid = this.api.hap.uuid.generate(device.id);
      discoveredUUIDs.add(uuid);

      const existingAccessory = this.accessories.get(uuid);
      if (existingAccessory !== undefined) {
        this.log.info('Restoring existing device from cache:', existingAccessory.displayName);
        // Refresh the stored device metadata in case it changed upstream.
        existingAccessory.context.device = device;
        new accessoryClass(this, existingAccessory);
        this.api.updatePlatformAccessories([existingAccessory]);
      } else {
        // Save the device ID as the display name!
        this.log.info('Adding new discovered device:', device.id);
        const accessory = new this.api.platformAccessory(device.id, uuid);
        accessory.context.device = device;
        new accessoryClass(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
      }
    }

    for (const [uuid, accessory] of this.accessories) {
      if (!discoveredUUIDs.has(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }
}
