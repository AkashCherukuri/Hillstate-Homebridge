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

type HillstateDevice = deviceDiscoverResp['data']['deviceList'][number];

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

  /* syncAccessories registers everything discovered.

     It deliberately never removes anything. An earlier version pruned accessories
     missing from the discovery response, and on 2026-03-04 a bad response made it
     unregister all 13 at once. HomeKit deletes an unregistered accessory along with
     its name, room and automations, so the damage is not recoverable from here,
     while the opposite failure -- a stale tile after a device is genuinely removed
     upstream -- is one click in the Homebridge UI.
  */
  private syncAccessories(devices: deviceDiscoverResp) {
    const deviceList = devices.data.deviceList;

    if (deviceList.length === 0) {
      this.log.warn('Discovery returned no devices');
      return;
    }

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

      // Logged so config.json's deviceNames map can be filled in with real values:
      // the upstream labels are semi-technical and not obvious from the API docs.
      this.log.info(`Discovered ${device.id} (${device.deviceType}) `
        + `name='${device.deviceName}' location='${device.deviceLocation}'`);

      const uuid = this.api.hap.uuid.generate(device.id);
      const existingAccessory = this.accessories.get(uuid);

      if (existingAccessory !== undefined) {
        // Refresh the stored device metadata in case it changed upstream.
        existingAccessory.context.device = device;
        const name = this.applyName(existingAccessory, device);
        this.log.info(`Restoring existing device from cache: ${device.id} as '${name}'`);
        new accessoryClass(this, existingAccessory);
        this.api.updatePlatformAccessories([existingAccessory]);
      } else {
        const accessory = new this.api.platformAccessory(device.id, uuid);
        accessory.context.device = device;
        const name = this.applyName(accessory, device);
        this.log.info(`Adding new discovered device: ${device.id} as '${name}'`);
        new accessoryClass(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.set(uuid, accessory);
      }
    }

    // Reads are served from cache from here on; see HillstateAPI.startPolling.
    this.hillstateAPI.startPolling();
  }

  /* nameFromConfig looks a device up in the config.json `deviceNames` map.

     This map is the whole point of the naming work: HomeKit stores a Home app
     rename controller-side only, so when Apple drops it there is nothing on disk
     here to fall back to and every light reverts to its raw ID. With the map, the
     fallback is a name the user chose.
  */
  private nameFromConfig(deviceId: string): string | undefined {
    const entries: unknown = this.config.deviceNames;
    if (!Array.isArray(entries)) {
      return undefined;
    }

    const match = entries.find((entry) => entry?.id === deviceId);
    return typeof match?.name === 'string' && match.name !== '' ? match.name : undefined;
  }

  /* applyName decides what this accessory is called and records it on the accessory,
     where updatePlatformAccessories persists it to cachedAccessories.

     Precedence: a Home app rename (stored via the ConfiguredName characteristic)
     wins, then the config map, then the upstream label, then the device ID. The
     config value that was last applied is remembered, so editing config.json
     overrides a stale Home app rename instead of being silently ignored.
  */
  private applyName(accessory: PlatformAccessory, device: HillstateDevice): string {
    const fromConfig = this.nameFromConfig(device.id);
    const context = accessory.context;

    if (fromConfig !== context.nameFromConfig) {
      context.nameFromConfig = fromConfig;
      context.configuredName = undefined;
    }

    const name = context.configuredName || fromConfig || device.deviceLocation || device.id;
    context.name = name;
    accessory.displayName = name;
    return name;
  }

  /* setAccessoryInformation fills in the metadata tile shared by all three
     accessory types. SerialNumber must differ per accessory: they all used to
     report 'Default-Serial', which HomeKit can read as one accessory appearing
     several times.
  */
  public setAccessoryInformation(accessory: PlatformAccessory, name: string): void {
    accessory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'Hyundai Hillstate')
      .setCharacteristic(this.Characteristic.Model, accessory.context.device.deviceType)
      .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device.id)
      .setCharacteristic(this.Characteristic.Name, name);
  }

  /* bindName names a service and makes a Home app rename durable.

     Without ConfiguredName a rename lives only in Apple's database; when that is
     resynced the name is gone and the accessory, which only ever advertised its
     device ID, cannot supply a better one. Writing the rename back into
     accessory.context puts it in cachedAccessories on disk instead.
  */
  public bindName(accessory: PlatformAccessory, service: Service, name: string): void {
    service.setCharacteristic(this.Characteristic.Name, name);
    service.addOptionalCharacteristic(this.Characteristic.ConfiguredName);

    service.getCharacteristic(this.Characteristic.ConfiguredName)
      .updateValue(name)
      .onSet((value) => {
        const renamed = String(value);
        if (renamed === '' || renamed === accessory.context.configuredName) {
          return;
        }

        this.log.info(`Renamed ${accessory.context.device.id} to '${renamed}'`);
        accessory.context.configuredName = renamed;
        accessory.context.name = renamed;
        accessory.displayName = renamed;
        this.api.updatePlatformAccessories([accessory]);
      });
  }
}
