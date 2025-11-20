import { firefox } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import links from '../data/link.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGIN_EMAIL = "access@adserve.no";
const WAIT_TIME = 5000;

const ALLOWED_DOMAINS = [
    "lab3.adserve.zone",
    "cdn3.adserve.zone",
    "dynamic.adserve.zone"
];

function deleteOldTimestampFolders(rootDir) {
    if (!fs.existsSync(rootDir)) return;
    for (const item of fs.readdirSync(rootDir)) {
        const full = path.join(rootDir, item);
        if (fs.statSync(full).isDirectory() && item.startsWith("duplicate-")) {
            fs.rmSync(full, { recursive: true, force: true });
            console.log(`🧹 Deleted old test folder: ${full}`);
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
        console.log("✅ Login success (modal)");
        return;
    }
    const pageEmail = page.locator('input[type="email"]');
    if (await pageEmail.isVisible().catch(() => false)) {
        await pageEmail.fill(LOGIN_EMAIL);
        await page.getByRole("button", { name: "Access" }).click();
        await page.waitForTimeout(1200);
        console.log("✅ Login success (full page)");
        return;
    }
    console.log("ℹ️  No login required");
}

async function analyzeBanner(browser, url, saveDir) {
    const page = await browser.newPage({ bypassCSP: true });

    await page.route("**/*", route => {
        const headers = { ...route.request().headers(), "Cache-Control": "no-cache", "Pragma": "no-cache" };
        route.continue({ headers });
    });

    console.log(`\n🚀 Testing banner: ${url}`);

    let initialKB = 0;
    let initialCount = 0;
    const frameData = new Map();

    page.on("response", async (res) => {
        try {
            const req = res.request();
            const frame = req.frame();
            const resUrl = req.url();
            const hostname = new URL(resUrl).hostname;
            const domainAllowed = ALLOWED_DOMAINS.some(d => hostname.includes(d));

            let kb = 0;
            try { const buffer = await res.body(); kb = buffer.length / 1024; } catch { kb = 0; }

            if (frame === page.mainFrame()) { initialKB += kb; initialCount++; return; }
            if (!domainAllowed) return;

            if (!frameData.has(frame)) frameData.set(frame, { assets: [], totalKB: 0, totalCount: 0 });
            const f = frameData.get(frame);

            f.assets.push({
                filename: path.basename(new URL(resUrl).pathname),
                url: resUrl,
                sizeKB: kb,
                type: req.resourceType(),
                status: res.status()
            });

            f.totalKB += kb;
            f.totalCount++;
        } catch { }
    });

    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => { });
    await loginIfNeeded(page);

    initialKB = 0;
    initialCount = 0;

    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => { });
    await page.waitForTimeout(WAIT_TIME);

    await page.evaluate(async () => {
        const imgs = [...document.querySelectorAll("img")];
        await Promise.all(imgs.map(img => img.complete ? null : new Promise(res => (img.onload = res))));
    }).catch(() => { });

    const screenshotPath = path.join(saveDir, "screenshot.jpg");
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => { });
    await page.close();

    const frameReport = [];
    for (const [frame, data] of frameData.entries()) {
        const nameCount = {};
        data.assets.forEach(a => nameCount[a.filename] = (nameCount[a.filename] || 0) + 1);
        const duplicates = Object.entries(nameCount).filter(([_, count]) => count > 1).map(([name]) => name);

        frameReport.push({ frameUrl: frame.url(), totalKB: data.totalKB.toFixed(2), totalCount: data.totalCount, duplicates });
    }

    return { bannerUrl: url, initial: { kb: initialKB.toFixed(2), count: initialCount }, frames: frameReport };
}

async function run() {
    const browser = await firefox.launch({ headless: true });

    let bannerUrls = process.argv.slice(2);

    let categoryToTest = null;

    if (bannerUrls.length === 0) {
        categoryToTest = "FiveNights"; 
        bannerUrls = links[categoryToTest];
        if (!bannerUrls || bannerUrls.length === 0) {
            console.error(`❌ Category "${categoryToTest}" not found or empty`);
            await browser.close();
            return;
        }
    } else {
        categoryToTest = "Manual Input links";
    }


    const rootDir = path.join(__dirname, "..", "reports");
    if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir);

    deleteOldTimestampFolders(rootDir);

    const now = new Date();
    const timestamp = `duplicate-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;

    const sessionDir = path.join(rootDir, timestamp);
    fs.mkdirSync(sessionDir);

    let index = 1;
    for (const url of bannerUrls) {
        const linkDir = path.join(sessionDir, `link-${index}`);
        fs.mkdirSync(linkDir);

        const report = await analyzeBanner(browser, url, linkDir);

        const lines = [];
        lines.push(`Category: ${categoryToTest}`);
        lines.push(`URL: ${report.bannerUrl}`);
        lines.push(`Timestamp: ${timestamp}`);
        lines.push(`Allowed Domains: ${ALLOWED_DOMAINS.join(", ")}`);
        lines.push("");
        lines.push("=== Initial Load Summary ===");
        lines.push(`Total Size (Resources loaded by main frame): ${report.initial.kb} KB`);
        lines.push(`Requests: ${report.initial.count}`);
        lines.push("");

        report.frames.forEach((f, i) => {
            lines.push(`Frame ${i + 1}: ${f.frameUrl}`);
            lines.push(`Total Size: ${f.totalKB} KB`);
            lines.push(`Requests: ${f.totalCount}`);
            lines.push(`Duplicates: ${f.duplicates.length ? f.duplicates.join(", ") : "None"}`);
            lines.push("");
        });

        fs.writeFileSync(path.join(linkDir, "report.txt"), lines.join("\n"));
        console.log(`📁 Saved report: ${linkDir}`);
        index++;
    }

    await browser.close();
}

run();
