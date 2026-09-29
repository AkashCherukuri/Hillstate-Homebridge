# CLAUDE.md

Guidance for working in this repository.

## What this is

A Homebridge **dynamic platform plugin** bridging the Hillstate / HT Home Service
apartment IOT API into Apple HomeKit, for Hillstate Gwanggyo Jungangyeok. It exposes
lights, a bathroom vent (as a fan), and unified AC+heater thermostats.

## Build and deploy

The Raspberry Pi Zero W2 that runs this **cannot compile TypeScript** — build locally
and ship `dist/`.

```bash
npm install
npm run build      # rimraf ./dist && tsc
npm run lint       # eslint --max-warnings=0

rsync -av --delete --exclude={'node_modules','.github','.git','.claude','src','test'} . pi@homebridge.local:~/work/hillstate-homebridge/
```

`--delete` is required. Without it `rimraf ./dist` never propagates and the Pi keeps
orphaned `.js` files from deleted sources.

On the Pi, `node`/`npm` are **not** on the `pi` user's `PATH`. You must put Homebridge's
own copies on `PATH` — an absolute path alone still fails, because npm's shebang resolves
`node` via `/usr/bin/env`:

```bash
export PATH=/opt/homebridge/bin:$PATH
npm install --omit=dev
sudo hb-service link      # the official docs get this step wrong
```

## Deployment target

| | |
|---|---|
| Host | `homebridge.local` / `172.30.1.31`, user `pi` |
| Homebridge | v1.11.0, HAP v0.13.1 — devDependency is pinned to `^1.11.0` to match |
| Node | v22.17.1 at `/opt/homebridge/bin/node` (`.nvmrc` pins local dev to 22) |
| Plugin dir | `~/work/hillstate-homebridge` (symlinked into `/var/lib/homebridge/node_modules`) |
| Storage | `/var/lib/homebridge` — `config.json`, `homebridge.log`, `accessories/cachedAccessories` |

## Architecture

`index.ts` registers the platform → `platform.ts` discovers devices and dispatches each
to an accessory class → accessory classes call `hillstate.ts` for all I/O.

- **`PLATFORM_NAME` in [settings.ts](src/settings.ts) must equal `pluginAlias` in
  [config.schema.json](config.schema.json)** (`'Hillstate IOT'`), and `PLUGIN_NAME` must
  equal `name` in `package.json`. Changing one without the other silently breaks config loading.
- Accessory UUIDs derive from `device.id` via `api.hap.uuid.generate`, so they are stable
  across restarts. This is what makes `cachedAccessories` recoverable.

### Device type dispatch (`platform.ts`)

Only `light` and `aircon` are mapped. A `light` whose `deviceLocation` matches
`config.bathroomVentName` becomes a **Fan** instead of a Lightbulb.

The account also reports `heating`, `wallsocket`, `switch`, and a real `fan` device type.
Heaters are reached indirectly through the thermostat; the rest are intentionally unmapped.
`CONSTS.VENT_DEVICE_TYPE` is currently dead code.

### Naming

HomeKit stores a Home app rename **controller-side only**. When Apple drops it — as
happened around 18 Aug 2026, with no restart and no accessory change on the Pi — the
accessory can only offer whatever name it advertises. So the plugin owns names:

- `config.deviceNames` (an array of `{id, name}`) is the durable fallback, backed up with
  `config.json`. Precedence is **Home app rename → `deviceNames` → `deviceLocation` →
  `device.id`**, resolved once in `platform.applyName`.
- A Home app rename arrives on the `ConfiguredName` characteristic and is written into
  `accessory.context.configuredName`, which persists it to `cachedAccessories`.
  `applyName` remembers the config value it last applied in `context.nameFromConfig`, so
  editing `config.json` overrides a stale rename instead of being ignored.
- **Device IDs must come from `accessory.context.device.id`, never `accessory.displayName`.**
  `displayName` now holds a human name. The thermostat is the sharp edge:
  `Number('Bedroom AC') - 400` is `NaN`, which would address a heater called `0NaN`.

### Heater ID convention

A room's heater ID is its aircon ID minus 400, re-padded: aircon `012811` → heater `012411`
(`'0' + (Number(airconId) - 400)`). One HomeKit Thermostat drives both, and turning on
cooling explicitly turns the heater off (and vice versa) to avoid fighting.

### `statusList` layouts

The API returns all values as **strings**. Read them by command name with `statusValue` /
`statusIsOn` / `statusNumber` from [types.ts](src/types.ts) — never by index.

- `light` — `power`
- `aircon` — `power`, `mode`, `wind`, `setTemperature`, `currTemperature`
- `heating` — `power`, `mode`, `setTemperature`, `currTemperature`

**The discover endpoint returns an empty `statusList` for every device.** It is only good
for enumerating devices; state must be fetched per-device (~93 ms each).

## Constraints worth preserving

These encode fixes for outages that took the whole bridge down for months:

1. **Never unregister an accessory.** `syncAccessories` only ever adds and updates.
   HomeKit deletes an unregistered accessory together with its name, room and
   automations, and none of that is recoverable from here; a stale tile after a device
   is genuinely removed upstream is one click in the Homebridge UI. Pruning caused the
   2026-03-04 outage, when a bad discovery response unregistered all 13 accessories at
   once.
2. **Read handlers must not throw raw errors.** Wrap failures via
   `platform.communicationFailure()` so HomeKit shows "No Response" instead of
   "Unhandled error thrown inside read handler".
3. **No un-awaited promises without a `.catch()`.** An unhandled rejection exits Node and
   crash-loops Homebridge. `HillstateAPI` deliberately does *not* authenticate in its
   constructor for this reason.
4. **Keep HomeKit off the network.** A background poller
   (`HillstateAPI.startPolling`, every `CONSTS.POLL_INTERVAL_MS`) refreshes every tracked
   device, so read handlers are cache lookups. `DEVICE_STATE_TTL_MS` must stay longer than
   the poll interval, or reads start re-fetching inline again. Concurrency is still capped
   at `CONSTS.MAX_CONCURRENT_REQUESTS` — the Pi Zero is single-core.
5. **A failed read serves the last known value**, it does not throw. Throwing produced
   ~180 "No Response" events over 17-19 Aug 2026 against an API that was merely slow.
   Only a device that has never been read successfully surfaces an error.
6. **Only re-authenticate on 401/403.** Treating every error as an expired session causes
   a login storm during an outage.
7. **Never log the session cookie.** `homebridge.log` is world-readable.

## Debugging

```bash
tail -f /var/lib/homebridge/homebridge.log
cat /var/lib/homebridge/accessories/cachedAccessories   # []  => registration is broken
dns-sd -L "Homebridge FD78 5D44" _hap._tcp local        # c# should be stable across restarts
sudo hb-service restart
```
