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
  public readonly discoveredCacheUUIDs: string[] = [];

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
    
    //!TODO: Read the plugin config and get this data from there!
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

  discoverDevices() {
    const devicesPromise = this.hillstateAPI.discoverDevices();

    // Add the devices once the discover call returns the list of all the lights
    devicesPromise.then((devices: deviceDiscoverResp) => {
      for (const device of devices.data.deviceList) {

        const uuid = this.api.hap.uuid.generate(device.id);
        const existingDevice = this.accessories.get(uuid);

        // Ignore the error flagged by intellisense here
        let PlatformAccessory: any;

        switch (device.deviceType) {
        case CONSTS.LIGHT_DEVICE_TYPE:
          this.log.info(device.deviceLocation, ' ', this.config.bathroomVentName);
          if (device.deviceLocation === this.config.bathroomVentName) {
            PlatformAccessory = HillstateFanPlatformAccessory;
          } else {
            PlatformAccessory = HillstateLightPlatformAccessory;
          }
          break;
        case CONSTS.AIRCON_DEVICE_TYPE:
          PlatformAccessory = HillstateThermosPlatformAccessory;
          break;
        default:
          this.log.info(device.id, ' is not a aircon nor light');
          continue;
        }
      
        if (existingDevice) {
          this.log.info('Restoring existing devicex from cache:', existingDevice.displayName);
          new PlatformAccessory(this, existingDevice);
        } else {
          // Save the device ID as the display name!
          this.log.info('Adding new discovered device:', device.id);
          const accessory = new this.api.platformAccessory(device.id, uuid);
          accessory.context.device = device;
          new PlatformAccessory(this, accessory);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        }

        this.discoveredCacheUUIDs.push(uuid);
      }
    });

    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
