# Pre-built nodegit binary

Reveal `node-gyp` info.
```
./node_modules/.bin/node-pre-gyp reveal --directory node_modules/nodegit
```

Serve prebuilts from local `prebuilts` folder.
```
npm_config_nodegit_binary_host_mirror=file://$(pwd)/prebuilts pnpm install
```

## Links

* https://axonodegit.s3.amazonaws.com/nodegit/nodegit/nodegit-v0.28.0-alpha.36-node-v127-linux-x64.tar.gz
