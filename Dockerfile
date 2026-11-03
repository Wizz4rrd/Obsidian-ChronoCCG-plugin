# Lightweight image just to run the plugin's npm scripts.
# We do NOT bake node_modules in — they're installed at first run via the
# bind-mounted volume, so updates to package.json don't require rebuilding.
FROM node:20-alpine

WORKDIR /workspace/plugin

# Non-root for safer host file ownership when bind-mounted.
# `node` user already exists in the image (uid 1000).
USER node
