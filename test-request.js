const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const LOGIN_EMAIL = "access@adserve.no";
const WAIT_TIME = 5000;
const ALLOWED_DOMAINS = ["lab3.adserve.zone"];
const MAX_REQUESTS_PER_FRAME = 20;

async function loginIfNeeded(page) {
    await page.waitForTimeout(500);
    const modal = page.locator("#access-modal");
    if (await modal.count() && await modal.isVisible().catch(() => false)) {
        console.log("🔐 Login modal detected → logging in...");
        await modal.locator('input[type="email"], input[placeholder*="mail" i]').first().fill(LOGIN_EMAIL);
        await modal.locator('button').first().click();
        await page.waitForTimeout(1000);
        console.log("✅ Login success (modal)");
        return;
    }

    const pageEmail = page.locator('input[type="email"]');
    if (await pageEmail.isVisible().catch(() => false)) {
        console.log("🔐 Login page detected → logging in...");
        await pageEmail.fill(LOGIN_EMAIL);
        await page.getByRole("button", { name: "Access" }).click();
        await page.waitForTimeout(1000);
        console.log("✅ Login success (full page)");
        return;
    }

    console.log("ℹ️ No login required");
}

async function analyzeBanner(browser, url) {
    const page = await browser.newPage();
    console.log(`\n🚀 Testing banner: ${url}`);

    try { await page.goto(url, { waitUntil: "domcontentloaded" }); }
    catch (err) { console.log(`⚠️ initial page.goto failed → ${err.message}`); }

    await loginIfNeeded(page);

    try { await page.goto(url, { waitUntil: "domcontentloaded" }); }
    catch (err) { console.log(`⚠️ page.goto after login failed → ${err.message}`); }

    const frameMap = new Map();

    page.on("response", async (res) => {
        try {
            const req = res.request();
            const frame = req.frame();
            if (!frame || frame === page.mainFrame()) return;

            const urlObj = new URL(req.url());
            if (!ALLOWED_DOMAINS.some(d => urlObj.hostname.includes(d))) return;

            const filename = path.basename(urlObj.pathname);
            // ข้าม track-video
            if (/^track-video/i.test(filename)) return;

            if (!frameMap.has(frame)) frameMap.set(frame, []);
            const assets = frameMap.get(frame);

            // จำกัด Requests ต่อ Frame
            if (assets.length >= MAX_REQUESTS_PER_FRAME) return;

            const size = res.headers()["content-length"] ? parseInt(res.headers()["content-length"], 10) : null;
            assets.push({
                filename,
                url: req.url(),
                type: req.resourceType(),
                sizeBytes: size,
                status: res.status()
            });
        } catch { }
    });

    await page.waitForTimeout(WAIT_TIME);
    await page.close();

    const frameReports = [];
    for (const [frame, assets] of frameMap.entries()) {
        const filenameCount = {};
        for (const a of assets) filenameCount[a.filename] = (filenameCount[a.filename] || 0) + 1;
        const duplicates = Object.entries(filenameCount).filter(([_, c]) => c > 1).map(([n]) => n);

        frameReports.push({
            frameUrl: frame.url(),
            totalRequests: assets.length,
            duplicates,
            assets
        });
    }

    // แสดงผล
    frameReports.forEach((f, idx) => {
        console.log(`\n🖼️  Frame ${idx + 1}: ${f.frameUrl}`);
        console.log(`   Total Requests: ${f.totalRequests}`);
        if (f.duplicates.length > 0) console.log(`   ⚠️ Duplicates: ${f.duplicates.join(", ")}`);
        else console.log("   ✅ No duplicates");
    });

    return { bannerUrl: url, frames: frameReports };
}

async function run() {
    const browser = await chromium.launch({ headless: true });
    const bannerUrls = [
        "https://dashboard.adserve.zone/preview/1403/s/pmuyjvytv1",
        "https://dashboard.adserve.zone/preview/1402/s/tsuzensnj6",
    ];

    const reportDir = path.join(__dirname, "reports");
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir);

    for (const url of bannerUrls) {
        const report = await analyzeBanner(browser, url);

        const urlParts = url.split("/").filter(Boolean);
        const bannerId = urlParts[urlParts.length - 1];

        const reportPath = path.join(reportDir, `duplicate-assets-report-${bannerId}.json`);
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(`\n💾 Report for ${url} saved to: ${reportPath}`);
    }

    await browser.close();
}run();
