import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Arquivo de ambiente nao encontrado: ${absolutePath}`);
  }

  const content = fs.readFileSync(absolutePath, "utf8");
  const env = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    env[key] = value;
  }

  return { absolutePath, env };
}

function parseArgs(argv) {
  const args = { envFile: ".env.local", expected: [] };

  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--env-file") {
      args.envFile = argv[index + 1];
      index += 1;
      continue;
    }
    if (value === "--expect-instance") {
      args.expected.push(argv[index + 1]);
      index += 1;
      continue;
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const { absolutePath, env } = loadEnvFile(args.envFile);
  const evolutionApiUrl = env.EVOLUTION_API_URL;
  const evolutionApiKey = env.EVOLUTION_API_KEY;

  if (!evolutionApiUrl || !evolutionApiKey) {
    throw new Error(`EVOLUTION_API_URL e EVOLUTION_API_KEY sao obrigatorios em ${absolutePath}`);
  }

  console.log(`Arquivo de ambiente: ${absolutePath}`);
  console.log(`Base da Evolution: ${evolutionApiUrl}`);

  const response = await fetch(`${evolutionApiUrl}/instance/fetchInstances`, {
    method: "GET",
    headers: { apikey: evolutionApiKey },
  });

  const bodyText = await response.text();
  console.log(`HTTP ${response.status}`);

  if (!response.ok) {
    console.log(bodyText.slice(0, 2000));
    process.exitCode = 1;
    return;
  }

  const instances = JSON.parse(bodyText);
  const summary = instances.map((instance) => ({
    name: instance.name,
    status: instance.connectionStatus,
    number: instance.number,
  }));

  console.log(JSON.stringify(summary, null, 2));

  if (args.expected.length > 0) {
    const names = new Set(summary.map((item) => item.name));
    const missing = args.expected.filter((name) => !names.has(name));
    if (missing.length > 0) {
      console.error(`Instancias ausentes: ${missing.join(", ")}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Instancias esperadas encontradas: ${args.expected.join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
