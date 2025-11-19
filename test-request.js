const { firefox } = require("playwright");
const fs = require("fs");
const path = require("path");

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
        if (fs.statSync(full).isDirectory() && item.startsWith("test-dup-")) {
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
    const page = await browser.newPage();
    console.log(`\n🚀 Testing banner: ${url}`);

    let initialKB = 0;
    let initialCount = 0;

    const frameData = new Map(); 

    page.on("response", async (res) => {
        try {
            const req = res.request();
            const frame = req.frame();
            const resUrl = req.url();

            const urlObj = new URL(resUrl);
            const domainAllowed = ALLOWED_DOMAINS.some(d => urlObj.hostname.includes(d));

            const size = parseInt(res.headers()["content-length"] || "0", 10);
            const kb = isNaN(size) ? 0 : size / 1024;

            if (frame === page.mainFrame()) {
                initialKB += kb;
                initialCount++;
                return;
            }

            if (!domainAllowed) return;

            if (!frameData.has(frame)) {
                frameData.set(frame, {
                    assets: [],
                    totalKB: 0,
                    totalCount: 0
                });
            }

            const f = frameData.get(frame);

            f.assets.push({
                filename: path.basename(urlObj.pathname),
                url: resUrl,
                sizeKB: kb,
                type: req.resourceType(),
                status: res.status()
            });

            f.totalKB += kb;
            f.totalCount++;
        } catch { }
    });

    // FIRST LOAD
    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(e => console.log("⚠️ initial goto:", e.message));
    await loginIfNeeded(page);

    initialKB = 0;
    initialCount = 0;

    await page.goto(url, { waitUntil: "domcontentloaded" }).catch(e => console.log("⚠️ goto after login:", e.message));
    await page.waitForTimeout(WAIT_TIME);

    // Wait for images
    await page.evaluate(async () => {
        const imgs = [...document.querySelectorAll("img")];
        await Promise.all(imgs.map(img => img.complete ? null : new Promise(r => img.onload = r)));
    }).catch(() => {});

    // Screenshot
    const screenshotPath = path.join(saveDir, "screenshot.jpg");
    await page.screenshot({ path: screenshotPath, fullPage: true })
        .catch(e => console.log("⚠️ screenshot failed:", e.message));

    await page.close();

    const frameReport = [];
    for (const [frame, data] of frameData.entries()) {
        const nameCount = {};
        data.assets.forEach(a => nameCount[a.filename] = (nameCount[a.filename] || 0) + 1);

        const duplicates = Object.entries(nameCount)
            .filter(([_, count]) => count > 1)
            .map(([name]) => name);

        frameReport.push({
            frameUrl: frame.url(),
            totalKB: data.totalKB.toFixed(2),
            totalCount: data.totalCount,
            duplicates
        });
    }

    return {
        bannerUrl: url,
        initial: {
            kb: initialKB.toFixed(2),
            count: initialCount
        },
        frames: frameReport
    };
}

async function run() {
    const browser = await firefox.launch({ headless: true });

    const defaultUrls = [
        "https://dashboard.adserve.zone/preview/1402/test/22903",
        "https://dashboard.adserve.zone/preview/1403/test/22912",
        "https://dashboard.adserve.zone/preview/1403/test/22913",
        "https://dashboard.adserve.zone/preview/1403/test/22910",
        "https://dashboard.adserve.zone/preview/1403/test/22911",
        "https://dashboard.adserve.zone/preview/1403/test/22914",
        "https://dashboard.adserve.zone/preview/1403/test/22916",
        "https://dashboard.adserve.zone/preview/1403/test/22915",
        "https://dashboard.adserve.zone/preview/1403/test/22904",
        "https://dashboard.adserve.zone/preview/1403/test/22906",
        "https://dashboard.adserve.zone/preview/1403/test/22905",
        "https://dashboard.adserve.zone/preview/1403/test/22907",
        "https://dashboard.adserve.zone/preview/1403/test/22908",
        "https://dashboard.adserve.zone/preview/1403/test/22909",
    ];

    let bannerUrls = process.argv.slice(2);
    if (bannerUrls.length === 0) {
        console.log("ℹ️  No input URLs, using default list.");
        bannerUrls = defaultUrls;
    }

    const rootDir = path.join(__dirname, "reports");
    if (!fs.existsSync(rootDir)) fs.mkdirSync(rootDir);

    deleteOldTimestampFolders(rootDir);

    const now = new Date();
    const timestamp = `test-dup-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;

    const sessionDir = path.join(rootDir, timestamp);
    fs.mkdirSync(sessionDir);

    let index = 1;

    for (const url of bannerUrls) {
        const linkDir = path.join(sessionDir, `link-${index}`);
        fs.mkdirSync(linkDir);

        const report = await analyzeBanner(browser, url, linkDir);

        const lines = [];
        lines.push(`URL: ${report.bannerUrl}`);
        lines.push(`Timestamp: ${timestamp}`);
        lines.push(`Allowed Domains: ${ALLOWED_DOMAINS.join(", ")}`);
        lines.push("");

        lines.push("=== Initial Load Summary ===");
        lines.push(`Total Size: ${report.initial.kb} KB`);
        lines.push(`Total Requests: ${report.initial.count}`);
        lines.push("");

        report.frames.forEach((f, i) => {
            lines.push(`Frame ${i + 1}: ${f.frameUrl}`);
            lines.push(`Total Size: ${f.totalKB} KB`);
            lines.push(`Total Requests: ${f.totalCount}`);
            lines.push(`Duplicates: ${f.duplicates.length ? f.duplicates.join(", ") : "None"}`);
            lines.push("");
        });

        fs.writeFileSync(path.join(linkDir, "report.txt"), lines.join("\n"));
        console.log(`📁 Saved report: ${linkDir}`);
        index++;
    }

    await browser.close();
}run();
