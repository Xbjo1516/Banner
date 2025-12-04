import inquirer from "inquirer";
import path from "path";
import { pathToFileURL } from "url";
import { fileURLToPath } from "url";

console.log("🚀 Welcome to Banner Test Runner\n");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function validateUrls(urls) {
  const invalid = [];
  for (const u of urls) {
    try {
      const res = await fetch(u, { method: "HEAD" });
      if (!res.ok) invalid.push(u);
    } catch {
      invalid.push(u);
    }
  }
  return invalid;
}

async function main() {
  const { linksInput } = await inquirer.prompt([
    {
      type: "input",
      name: "linksInput",
      message:
        "📂 Enter the URL(s) you want to test (separate with commas if there are multiple) : (leave empty to run default)",
    },
  ]);

  let bannerUrls = null;

  if (linksInput && linksInput.trim() !== "") {
    bannerUrls = linksInput
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const invalidUrls = await validateUrls(bannerUrls);
    if (invalidUrls.length) {
      console.error("\n❌ Some URLs do not exist:");
      invalidUrls.forEach((u, i) =>
        console.error(`   ${i + 1}. ${u}`)
      );
      console.error("\n⛔ Test canceled. Please retry with valid URLs.");
      return; 
    }

    console.log("\n✅ All input URLs are valid!");
  }

  const { testType } = await inquirer.prompt([
    {
      type: "list",
      name: "testType",
      message: "🧪 Select the test case you want to run :",
      choices: [
        { name: "404 Test", value: "404" },
        { name: "Duplicate Test", value: "duplicate" },
        { name: "Network Test", value: "network" },
        { name: "Read Elements Test", value: "read-elements" },
      ],
    },
  ]);

  const testModuleFsPath = path.resolve(__dirname, `${testType}.js`);
  const testModuleURL = pathToFileURL(testModuleFsPath).href;

  try {
    const testCase = await import(testModuleURL);

    console.log("\n✅ URLs loaded:");
    if (bannerUrls) {
      bannerUrls.forEach((u, i) =>
        console.log(`   ${i + 1}. ${u}`)
      );
    } else {
      console.log("   (running default from test file)");
    }

    console.log(`✅ Test case selected: ${testType}`);
    console.log("▶️  Running tests...\n");

    if (bannerUrls) {
      await testCase.run(bannerUrls);
    } else {
      await testCase.run();
    }

    console.log("\n🎉 All tests completed!");
  } catch (err) {
    console.error(
      `❌ Error loading test files from: ${testModuleFsPath}\n   ${err.message}`
    );
  }
}

main();
