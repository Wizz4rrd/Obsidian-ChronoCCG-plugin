// `npm version <patch|minor|major>` runs this after bumping package.json:
// syncs the version into plugin/manifest.json, the root manifest.json (read by
// Obsidian's community catalog) and the root versions.json.
import { readFileSync, writeFileSync } from "fs";

const version = process.env.npm_package_version;
const write = (path, data) => writeFileSync(path, JSON.stringify(data, null, "\t") + "\n");

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = version;
write("manifest.json", manifest);
write("../manifest.json", manifest);

const versions = JSON.parse(readFileSync("../versions.json", "utf8"));
versions[version] = manifest.minAppVersion;
write("../versions.json", versions);
console.log(`Synced version ${version} (minAppVersion ${manifest.minAppVersion}).`);
