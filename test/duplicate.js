import { firefox } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import links from '../data/link.json' with { type: 'json' };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGIN_EMAIL = "access@adserve.no";
const WAIT_TIME = 5000;
const ALLOWED_DOMAINS = ["lab3.adserve.zone", "cdn3.adserve.zone", "dynamic.adserve.zone"];

function deleteOldFolders(rootDir, prefix = "duplicate-") {
    if (!fs.existsSync(rootDir)) return;
    for (const d of fs.readdirSync(rootDir)) {
        const full = path.join(rootDir, d);
        if (fs.statSync(full).isDirectory() && d.startsWith(prefix)) {
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

async function analyzeBanner(browser, url, saveDir) {
    const page = await browser.newPage({ bypassCSP: true });

    await page.route("**/*", route => route.continue({
        headers: { ...route.request().headers(), "Cache-Control": "no-cache", "Pragma": "no-cache" }
    }));

    console.log(`\n🚀 Testing banner: ${url}`);
    const frameData = new Map();
    let initialKB = 0, initialCount = 0;

    page.on("response", async res => {
        try {
            const req = res.request();
            const frame = req.frame();
            const resUrl = req.url();
            const hostname = new URL(resUrl).hostname;
            if (!ALLOWED_DOMAINS.some(d => hostname.includes(d))) return;

            let kb = 0;
            try { kb = (await res.body()).length / 1024; } catch { }

            if (frame === page.mainFrame()) { initialKB += kb; initialCount++; return; }

            if (!frameData.has(frame)) frameData.set(frame, { assets: [], totalKB: 0, totalCount: 0 });
            const f = frameData.get(frame);

            f.assets.push({
                filename: path.basename(new URL(resUrl).pathname),
                url: resUrl, sizeKB: kb, type: req.resourceType(), status: res.status()
            });
            f.totalKB += kb; f.totalCount++;
        } catch { }
    });

    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => { });
    await loginIfNeeded(page);
    initialKB = 0; initialCount = 0;
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(() => { });
    await page.waitForTimeout(WAIT_TIME);

    await page.evaluate(async () => Promise.all([...document.querySelectorAll("img")].map(img => img.complete ? null : new Promise(res => img.onload = res))));

    const screenshotPath = path.join(saveDir, "screenshot.jpg");
    try {
        await page.waitForTimeout(1000);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`📸 Screenshot saved: ${screenshotPath}`);
    } catch (e) {
        console.log(`⚠️  Screenshot failed: ${e.message}`);
    }
    await page.close();

    const frameReport = [];
    for (const [frame, data] of frameData.entries()) {
        const nameCount = {};
        data.assets.forEach(a => nameCount[a.filename] = (nameCount[a.filename] || 0) + 1);
        const duplicates = Object.entries(nameCount)
            .filter(([name, count]) => count > 1 && !/^track-video/i.test(name))
            .map(([name]) => name);

        frameReport.push({
            frameUrl: frame.url(),
            totalKB: data.totalKB.toFixed(2),
            totalCount: data.totalCount,
            duplicates
        });
    }
    return { bannerUrl: url, initial: { kb: initialKB.toFixed(2), count: initialCount }, frames: frameReport };
}

async function run() {
    const browser = await firefox.launch({ headless: true });
    let bannerUrls = process.argv.slice(2);
    let category = "Manual Input links";
    if (!bannerUrls.length) {
        category = "FiveNights";
        bannerUrls = links[category];
        if (!bannerUrls || !bannerUrls.length) { console.error(`❌ Category "${category}" not found or empty`); await browser.close(); return; }
    }

    const rootDir = path.join(__dirname, "..", "reports");
    fs.mkdirSync(rootDir, { recursive: true });
    deleteOldFolders(rootDir);
    
    const now = new Date();
    const timestamp =
        "duplicate-" +
        now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0") + "_" +
        String(now.getHours()).padStart(2, "0") + "-" +
        String(now.getMinutes()).padStart(2, "0") + "-" +
        String(now.getSeconds()).padStart(2, "0");

    const sessionDir = path.join(rootDir, timestamp);
    fs.mkdirSync(sessionDir);

    let index = 1;
    for (const url of bannerUrls) {
        const linkDir = path.join(sessionDir, `link-${index}`);
        fs.mkdirSync(linkDir, { recursive: true });

        const report = await analyzeBanner(browser, url, linkDir);
        const lines = [
            `Category: ${category}`,
            `URL: ${report.bannerUrl}`,
            `Timestamp: ${timestamp}`,
            `Allowed Domains: ${ALLOWED_DOMAINS.join(",")}`,
            "",
            "=== Initial Load Summary ===",
            `Total size (main frame): ${report.initial.kb} KB`,
            `Requests: ${report.initial.count}`,
            ""
        ];

        report.frames.forEach((f, i) => {
            lines.push(`Frame ${i + 1}: ${f.frameUrl}`);
            lines.push(`Total size (frame): ${f.totalKB} KB`);
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
