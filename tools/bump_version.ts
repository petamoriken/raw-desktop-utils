const version = Deno.args[0];
if (version === undefined || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(
    "Usage: deno run --allow-read --allow-write tools/bump_version.ts <version>",
  );
  Deno.exit(1);
}

const denoJsonPath = "./deno.json";
const denoJson = await Deno.readTextFile(denoJsonPath);
await Deno.writeTextFile(
  denoJsonPath,
  denoJson.replace(/"version": "[^"]+"/, `"version": "${version}"`),
);

console.log(`Bumped version to v${version}`);
