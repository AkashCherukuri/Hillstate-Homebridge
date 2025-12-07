# Development Notes

These are notes taken while I work on this project. The official documentation is incorrect, so I hope this helps someone down the line. I'm using a Raspberry Pi Zero W2, which is not powerful enough to build the node appliation; so I will be developing and building the application locally and running it on the Raspberry Pi.

## Development Pipeline

- Building the application

    `npm run build`

- Copy over required files

    `rsync -av --exclude={'node_modules','.github','.git','src','test'} . pi@homebridge.local:~/work/hillstate-homebridge/`

- Install only the packages that you need

    `npm install --only=production`

- Link the application to the homebridge application. You might have to restart Homebridge for the new plugin to show up. This step is incorrectly documented.

    `sudo hb-service link`
