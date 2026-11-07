import { Daytona } from "@daytona/sdk";

// Reads DAYTONA_API_KEY from the environment.
const daytona = new Daytona();

const sandbox = await daytona.create({ language: "typescript" });
console.log(`Created sandbox ${sandbox.id}`);

try {
  const response = await sandbox.process.codeRun('console.log("Hello World from Daytona!")');
  if (response.exitCode !== 0) {
    throw new Error(`Exit code ${response.exitCode}: ${response.result}`);
  }
  console.log(`Output: ${response.result.trim()}`);
} finally {
  await daytona.delete(sandbox);
  console.log(`Deleted sandbox ${sandbox.id}`);
}
