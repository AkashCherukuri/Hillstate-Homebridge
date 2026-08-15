# Development Notes

These are notes taken while I work on this project. The official documentation is incorrect, so I hope this helps someone down the line. I'm using a Raspberry Pi Zero W2, which is not powerful enough to build the node appliation; so I will be developing and building the application locally and running it on the Raspberry Pi.

## Development Pipeline

- Building the application

    `npm run build`

- Copy over required files

    `rsync -av --delete --exclude={'node_modules','.github','.git','.claude','src','test'} . pi@homebridge.local:~/work/hillstate-homebridge/`

    `--delete` matters: without it, `rimraf ./dist` locally never propagates and the
    Pi accumulates orphaned `.js` files from sources that no longer exist.

- Install only the packages that you need

    ```
    export PATH=/opt/homebridge/bin:$PATH
    npm install --omit=dev
    ```

    `node` and `npm` are not on the `pi` user's `PATH`; the Homebridge install ships
    its own copies under `/opt/homebridge/bin`. Putting that directory on `PATH` is
    required rather than optional — calling `/opt/homebridge/bin/npm` by absolute
    path still fails, because its shebang resolves `node` via `/usr/bin/env`.

- Link the application to the homebridge application. You might have to restart Homebridge for the new plugin to show up. This step is incorrectly documented.

    `sudo hb-service link`

## Debugging on the Pi

- Logs: `tail -f /var/lib/homebridge/homebridge.log`
- Restart: `sudo hb-service restart`
- Registered accessories: `cat /var/lib/homebridge/accessories/cachedAccessories`
  — if this is `[]` while devices exist upstream, accessory registration is broken.
- Bridge advertisement: `dns-sd -L "Homebridge FD78 5D44" _hap._tcp local`
  — `c#` is the HAP config number; it should stay stable across restarts. Rapid
  growth means accessories are churning.
