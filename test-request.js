const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const CONCURRENCY = 5;
const WAIT_TIME = 10000;
const MAX_REQUESTS = 20;

async function analyzeBanner(browser, url, allowedDomains) {
    const page = await browser.newPage();

    const assets = {};
    const nameMap = {};
    const duplicates = [];
    const assetRecords = [];

    console.log(`\n🚀 Testing banner: ${url}`);

    let requestCount = 0;
    let stoppedEarly = false;

    page.on("response", async (response) => {
        if (stoppedEarly) return;

        try {
            const req = response.request();
            const resourceUrl = req.url().split("?")[0];
            const hostname = new URL(resourceUrl).hostname;

            if (!allowedDomains.some(d => hostname.includes(d))) return;

            requestCount++;
            if (requestCount > MAX_REQUESTS) {
                stoppedEarly = true;   
                return;
            }

            const resourceType = req.resourceType();
            const frame = response.frame();
            const frameUrl = frame?.url() || "(main)";
            const filename = path.basename(resourceUrl);

            const headers = response.headers();
            const contentLength = headers["content-length"]
                ? parseInt(headers["content-length"], 10)
                : null;

            assets[filename] = (assets[filename] || 0) + 1;

            if (!nameMap[filename]) nameMap[filename] = [];
            if (!nameMap[filename].includes(resourceUrl)) {
                nameMap[filename].push(resourceUrl);
            }

            assetRecords.push({
                filename,
                url: resourceUrl,
                type: resourceType,
                frame: frameUrl,
                status: response.status(),
                sizeBytes: contentLength,
                timestamp: new Date().toISOString(),
            });

            if (assets[filename] === 2) {
                if (!/^track-video/i.test(filename)) {
                    console.log(`⚠️ Duplicate detected: ${filename}`);
                    duplicates.push(filename);
                }
            }

        } catch (err) {
            console.log("⚠️ Error reading response:", err.message);
        }
    });

    try {
        await page.goto(url, { timeout: 20000 });

        if (!stoppedEarly) {
            await page.waitForTimeout(WAIT_TIME);
        }

    } catch (err) {
        console.log(`❌ Error loading banner: ${url}`);
    }

    await page.close();

    console.log(`📦 Total assets analyzed: ${assetRecords.length}`);
    if (duplicates.length === 0) {
        console.log(`✅ No duplicates found for: ${url}`);
    } else {
        console.log(`❌ Found ${duplicates.length} duplicated filenames in: ${url}`);
    }

    return {
        bannerUrl: url,
        stoppedEarly,
        totalRequests: assetRecords.length,
        duplicates: duplicates.map(name => ({
            filename: name,
            count: assets[name],
            urls: nameMap[name]
        })),
        allRequests: assetRecords
    };
}

async function run() {
    const browser = await chromium.launch({ headless: true });

    const bannerUrls = [
        // Nürnberg
        // "https://dashboard.adserve.zone/preview/1402/test/22903",

        // Five Nights at Freddys 2
        "https://dashboard.adserve.zone/preview/1403/test/22912", //2000x600=200kb <- ADD WRAPPER
        "https://dashboard.adserve.zone/preview/1403/test/22913", //2000x300=150kb <- ADD WRAPPER
        "https://dashboard.adserve.zone/preview/1403/test/22910", //980x300=100kb
        "https://dashboard.adserve.zone/preview/1403/test/22911", //970x365=100kb
        "https://dashboard.adserve.zone/preview/1403/test/22914", //970x250=100kb
        "https://dashboard.adserve.zone/preview/1403/test/22916", //640x400=100kb <- MAKE RESPONSIVE (แบบเต็มหน้าจอ)
        "https://dashboard.adserve.zone/preview/1403/test/22915", //(แบบปกติ)
        "https://dashboard.adserve.zone/preview/1403/test/22904", //580x400=100kb
        "https://dashboard.adserve.zone/preview/1403/test/22906", //320x400=100kb - STATE 2 only preview (click on banner = go to landingpage)
        "https://dashboard.adserve.zone/preview/1403/test/22905", //300x600=100kb - STATE 2 only preview (click on banner = go to landingpage)
        "https://dashboard.adserve.zone/preview/1403/test/22907", //300x250=100kb
        "https://dashboard.adserve.zone/preview/1403/test/22908", //180x500=100kb - STATE 2 only preview (click on banner = go to landingpage)
        "https://dashboard.adserve.zone/preview/1403/test/22909", //160x600=100kb - STATE 2 only preview (click on banner = go to landingpage)
    ];

    const allowedDomains = [
        "lab3.adserve.zone",
    ];

    const allReports = [];

    for (let i = 0; i < bannerUrls.length; i += CONCURRENCY) {
        const chunk = bannerUrls.slice(i, i + CONCURRENCY);

        const results = await Promise.all(
            chunk.map(url => analyzeBanner(browser, url, allowedDomains))
        );

        allReports.push(...results);
    }

    const reportDir = path.join(__dirname, "reports");
    if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir);

    const reportPath = path.join(reportDir, "duplicate-assets-report-Five-Nights.json"); // { Nürnberg , Five-Nights at Freddys 2 }
    fs.writeFileSync(reportPath, JSON.stringify(allReports, null, 2));

    console.log("\n💾 Report saved to:", reportPath);
    await browser.close();
}
run();
