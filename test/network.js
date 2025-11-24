import { firefox } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const WAIT_TIME = 30000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGIN_EMAIL = "access@adserve.no";

function formatSize(bytes) {
    if (bytes > 1024 * 1024)
        return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    if (bytes > 1024)
        return (bytes / 1024).toFixed(2) + " KB";
    return bytes + " B";
}

function deleteOldFolders(rootDir, prefix = "network-") {
    if (!fs.existsSync(rootDir)) return;
    for (const d of fs.readdirSync(rootDir)) {
        const full = path.join(rootDir, d);
        if (fs.statSync(full).isDirectory() && d.startsWith(prefix)) {
            fs.rmSync(full, { recursive: true, force: true });
            console.log(`🧹 Deleted old folder: ${full}`);
        }
    }
}

async function loginIfNeeded(page) {
    await page.waitForTimeout(500);

    const modal = page.locator("#access-modal");
    if (await modal.isVisible().catch(() => false)) {
        await modal.locator('input[type="email"]').first().fill(LOGIN_EMAIL);
        await modal.locator("button").first().click();
        await page.waitForTimeout(1000);
        return console.log("✅ Login success (modal)");
    }

    const pageEmail = page.locator('input[type="email"]');
    if (await pageEmail.isVisible().catch(() => false)) {
        await pageEmail.fill(LOGIN_EMAIL);
        await page.getByRole("button", { name: "Access" }).click();
        await page.waitForTimeout(1200);
        return console.log("✅ Login success (full page)");
    }

    console.log("ℹ️  No login required");
}

async function analyzeUrl(url) {
    const browser = await firefox.launch({ headless: true });
    const page = await browser.newPage({ bypassCSP: true });

    const domainData = {};
    const requests = [];

    console.log(`\n🚀 Testing banner: ${url}`);

    page.on("requestfinished", async req => {
        try {
            const res = await req.response();
            if (!res) return;

            const buffer = await res.body().catch(() => null);
            if (!buffer) return;

            const size = buffer.byteLength;
            const resUrl = req.url();

            const hostname = new URL(resUrl).hostname;

            if (!domainData[hostname]) domainData[hostname] = {};
            const domain = domainData[hostname];

            const fileName = path.basename(new URL(resUrl).pathname) || resUrl;
            const type = req.resourceType();

            if (!domain[type]) domain[type] = {};

            if (!domain[type][fileName]) {
                domain[type][fileName] = { count: 0, size: 0 };
            }

            domain[type][fileName].count += 1;
            domain[type][fileName].size += size;

        } catch { }
    });

    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
    await loginIfNeeded(page);

    await page.waitForTimeout(WAIT_TIME);

    let pageTitle = "N/A";
    try {
        const titleEl = await page.locator("h1.campaign-heading.text-center").first();
        if (await titleEl.isVisible()) {
            pageTitle = await titleEl.textContent();
        }
    } catch {}

    await browser.close();

    return { domainData, pageTitle };
}

function countTotalRequests(domainData) {
    let total = 0;
    for (const types of Object.values(domainData)) {
        for (const files of Object.values(types)) {
            for (const info of Object.values(files)) {
                total += info.count;
            }
        }
    }
    return total;
}

function countRequestsForDomain(types) {
    let total = 0;
    for (const files of Object.values(types)) {
        for (const info of Object.values(files)) {
            total += info.count;
        }
    }
    return total;
}

function calculateDomainSize(types) {
    let total = 0;
    for (const files of Object.values(types)) {
        for (const info of Object.values(files)) {
            total += info.size;
        }
    }
    return total;
}

function calculateTotalSize(domainData) {
    let total = 0;
    for (const types of Object.values(domainData)) {
        total += calculateDomainSize(types);
    }
    return total;
}

async function run() {
    const bannerUrls = process.argv.slice(2);

    if (!bannerUrls.length) {
        console.error("❌ Please provide URL: node script.js <url1> <url2>");
        process.exit(1);
    }

    const rootDir = path.join(__dirname, "..", "reports");
    fs.mkdirSync(rootDir, { recursive: true });
    deleteOldFolders(rootDir);

    const now = new Date();
    const timestamp =
        "network-" +
        now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0") + "_" +
        String(now.getHours()).padStart(2, "0") + "-" +
        String(now.getMinutes()).padStart(2, "0") + "-" +
        String(now.getSeconds()).padStart(2, "0");

    const sessionDir = path.join(rootDir, timestamp);
    fs.mkdirSync(sessionDir);

    for (let i = 0; i < bannerUrls.length; i++) {
        const url = bannerUrls[i];

        const linkDir = path.join(sessionDir, `link-${i + 1}`);
        fs.mkdirSync(linkDir, { recursive: true });

        const { domainData, pageTitle } = await analyzeUrl(url);

        const lines = [`URL: ${url}`, ""];
        lines.push(`Campaign Title: ${pageTitle}`);
        lines.push(`Timestamp: ${timestamp}`);
        lines.push(`Total requests: ${countTotalRequests(domainData)}`);
        lines.push(`Total size: ${formatSize(calculateTotalSize(domainData))}`);
        lines.push("");

        for (const [domain, types] of Object.entries(domainData)) {
            const domainSize = calculateDomainSize(types);

            lines.push(`🎞️ Domain: ${domain}`);
            lines.push(`  Total requests: ${countRequestsForDomain(types)}`);
            lines.push(`  Total size: ${formatSize(domainSize)}`);

            for (const [type, files] of Object.entries(types)) {
                lines.push(`  Type: ${type}`);

                for (const [name, info] of Object.entries(files)) {
                    lines.push(`    - ${name}: count = ${info.count}, size = ${formatSize(info.size)}`);
                }
            }

            lines.push("");
        }

        fs.writeFileSync(path.join(linkDir, "report.txt"), lines.join("\n"), "utf-8");
        console.log(`📁 Saved: ${linkDir}`);
    }
}

run();
